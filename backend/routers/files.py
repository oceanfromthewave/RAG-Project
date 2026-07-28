from __future__ import annotations

import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, Request, UploadFile, status

from backend.config import ALLOWED_EXTENSIONS, MAX_FILES_PER_UPLOAD, MAX_UPLOAD_SIZE
from backend.core.background import submit_background
from backend.core.security import upload_limiter
from backend.schemas import FileTagsUpdate
from backend.services.auth import UserInfo, get_current_user
from backend.services.history import delete_document_summary, upsert_document_summary
from backend.services.rag import clear_caches, generate_document_summary
from backend.services.store import (
    DATA_DIR,
    delete_source,
    get_collection,
    index_document,
    get_sources_overview,
    normalize_source_name,
    read_document,
)

logger = logging.getLogger("security")

router = APIRouter(tags=["files"])


# ── 유틸리티 ───────────────────────────────────────────────

def save_upload(file: UploadFile, target_path: Path, max_size: int = MAX_UPLOAD_SIZE):
    target_path.parent.mkdir(parents=True, exist_ok=True)
    total = 0
    with target_path.open("wb") as buffer:
        while chunk := file.file.read(1024 * 1024):
            total += len(chunk)
            if total > max_size:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"File is too large. Maximum allowed size is {max_size // (1024 * 1024)}MB.",
                )
            buffer.write(chunk)


def build_upload_temp_path(source_name: str, user_id: str = "") -> Path:
    prefix = f"{user_id}-" if user_id else ""
    return DATA_DIR / f".upload-{prefix}{uuid4().hex}{Path(source_name).suffix}"


def _run_summary_bg(source_name: str, text: str, user_id: str, model: str | None) -> None:
    """백그라운드 스레드에서 문서 요약 생성 후 DB에 저장한다."""
    try:
        summary = generate_document_summary(text, source_name, model=model)
        if summary:
            upsert_document_summary(source_name, user_id, summary)
            logger.info("[Summary] '%s' 요약 저장 완료 (%d자)", source_name, len(summary))
        else:
            # generate_document_summary 는 LLM 오류를 내부에서 삼키고 빈 문자열을
            # 반환하므로, 빈 요약도 실패로 남겨 관측 가능하게 한다.
            logger.warning("[Summary] '%s' 요약이 비어 저장하지 않음", source_name)
    except Exception:
        logger.warning("[Summary] '%s' 요약 생성 실패", source_name, exc_info=True)


# ── 파일 엔드포인트 ────────────────────────────────────────

@router.post("/upload")
async def upload(
        request: Request,
        files: list[UploadFile] = File(...),
        current_user: UserInfo = Depends(get_current_user),
):
    upload_limiter.check(request)
    if len(files) > MAX_FILES_PER_UPLOAD:
        raise HTTPException(
            status_code=400,
            detail=f"Too many files. Maximum allowed is {MAX_FILES_PER_UPLOAD}.",
        )

    results = []
    user_data_dir = DATA_DIR / current_user.id
    user_data_dir.mkdir(parents=True, exist_ok=True)

    for file in files:
        temp_path: Path | None = None
        ext = Path(file.filename or "").suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            results.append({"file": file.filename, "status": "error", "message": f"허용되지 않는 형식 ({ext})"})
            continue

        content_length = getattr(file, "size", 0) or 0
        if content_length > MAX_UPLOAD_SIZE:
            results.append({
                "file": file.filename, "status": "error",
                "message": f"용량 초과 (최대 {MAX_UPLOAD_SIZE // (1024 * 1024)}MB)",
            })
            continue

        try:
            source_name = normalize_source_name(file.filename or "")
            target_path = user_data_dir / source_name
            temp_path = build_upload_temp_path(source_name, user_id=current_user.id)

            save_upload(file, temp_path, max_size=MAX_UPLOAD_SIZE)
            text = read_document(temp_path)

            if not text.strip():
                results.append({"file": file.filename, "status": "error", "message": "텍스트 없음"})
                temp_path.unlink(missing_ok=True)
                continue

            chunks = index_document(source_name, text, user_id=current_user.id)
            shutil.move(str(temp_path), str(target_path))
            results.append({"file": source_name, "status": "success", "chunks": chunks})

            # ── 백그라운드(제한된 풀)에서 문서 요약 생성 ──
            submit_background(_run_summary_bg, source_name, text, current_user.id, None)

        except Exception:
            logger.exception("파일 업로드 실패: %s", file.filename)
            results.append({
                "file": file.filename, "status": "error",
                "message": "파일 처리 중 오류가 발생했습니다.",
            })
        finally:
            if temp_path and temp_path.exists():
                temp_path.unlink(missing_ok=True)
            await file.close()

    clear_caches()
    success_count = sum(1 for r in results if r["status"] == "success")
    return {
        "message": f"{len(files)}개 중 {success_count}개 파일 업로드 완료",
        "results": results,
    }


@router.get("/files")
def get_files(current_user: UserInfo = Depends(get_current_user)):
    user_data_dir = DATA_DIR / current_user.id
    if not user_data_dir.exists():
        return {"count": 0, "files": []}

    files_info = []
    for path in user_data_dir.iterdir():
        if path.is_file():
            stat = path.stat()
            files_info.append({
                "name": path.name,
                "size": stat.st_size,
                "updated_at": datetime.fromtimestamp(
                    stat.st_mtime,
                    tz=timezone.utc,
                ).isoformat(),
            })

    return {"count": len(files_info), "files": sorted(files_info, key=lambda x: x["name"])}


@router.get("/files-db")
def get_files_from_db(current_user: UserInfo = Depends(get_current_user)):
    overview = get_sources_overview(user_id=current_user.id)
    user_data_dir = DATA_DIR / current_user.id
    files_info = []

    for name in sorted(overview):
        entry = overview[name]
        path = user_data_dir / name
        if path.exists():
            stat = path.stat()
            files_info.append({
                "name": name, "size": stat.st_size,
                "updated_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                "chunks": entry["chunks"], "tags": entry["tags"],
            })
        else:
            files_info.append({
                "name": name, "size": 0, "updated_at": None,
                "chunks": entry["chunks"], "tags": entry["tags"],
            })

    return {"count": len(files_info), "files": files_info}


@router.delete("/file")
def delete_file_single(name: str = Query(...), current_user: UserInfo = Depends(get_current_user)):
    """단일 파일 삭제 (벡터 DB + 실제 파일 + 요약)."""
    source_name = normalize_source_name(name)
    user_data_dir = DATA_DIR / current_user.id
    target_path = user_data_dir / source_name

    deleted_chunks = delete_source(source_name, user_id=current_user.id)
    if target_path.exists():
        target_path.unlink()
    elif deleted_chunks == 0:
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")

    # ── [신규] 문서 요약 삭제 ──
    delete_document_summary(source_name, current_user.id)

    clear_caches()
    return {"file": source_name, "deleted_chunks": deleted_chunks}


@router.delete("/files/batch")
def delete_files_batch(names: list[str] = Query(...), current_user: UserInfo = Depends(get_current_user)):
    results = []
    user_data_dir = DATA_DIR / current_user.id

    for name in names:
        try:
            source_name = normalize_source_name(name)
            target_path = user_data_dir / source_name
            if target_path.exists():
                delete_source(source_name, user_id=current_user.id)
                target_path.unlink()
                # ── [신규] 요약 삭제 ──
                delete_document_summary(source_name, current_user.id)
                results.append({"file": source_name, "status": "success"})
            else:
                results.append({"file": source_name, "status": "not_found"})
        except Exception:
            logger.exception("파일 삭제 실패: %s", name)
            results.append({
                "file": name, "status": "error",
                "message": "파일 삭제 중 오류가 발생했습니다.",
            })

    clear_caches()
    return {"results": results}


@router.post("/files/reindex")
async def reindex_file(name: str = Query(...), current_user: UserInfo = Depends(get_current_user)):
    """기존 파일을 다시 인덱싱하고 요약도 재생성합니다."""
    source_name = normalize_source_name(name)
    user_data_dir = DATA_DIR / current_user.id
    target_path = user_data_dir / source_name

    if not target_path.exists():
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")

    try:
        text = read_document(target_path)
        if not text.strip():
            raise HTTPException(status_code=400, detail="파일에서 텍스트를 추출할 수 없습니다.")
        chunks = index_document(source_name, text, user_id=current_user.id)
        clear_caches()

        # ── 요약 재생성 (제한된 백그라운드 풀) ──
        submit_background(_run_summary_bg, source_name, text, current_user.id, None)

        return {"file": source_name, "chunks": chunks, "message": "재인덱싱이 완료되었습니다."}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("재인덱싱 실패: %s", name)
        raise HTTPException(
            status_code=500, detail="재인덱싱 중 오류가 발생했습니다."
        ) from e


@router.patch("/file/tags")
def update_file_tags(
        name: str = Query(...),
        body: FileTagsUpdate = Body(...),
        current_user: UserInfo = Depends(get_current_user),
):
    source_name = normalize_source_name(name)
    collection = get_collection()
    where_filter = {"$and": [{"source": source_name}, {"user_id": current_user.id}]}

    res = collection.get(where=where_filter, include=["metadatas"])
    ids = res.get("ids") or []
    metadatas = res.get("metadatas") or []

    if not ids:
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")

    tag_str = ",".join(body.tags)
    for meta in metadatas:
        meta["tags"] = tag_str

    collection.update(ids=ids, metadatas=metadatas)
    return {"message": "Tags updated", "tags": body.tags}
