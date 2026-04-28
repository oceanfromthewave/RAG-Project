from __future__ import annotations

import os
import json
import shutil
import logging
from pathlib import Path
from uuid import uuid4
from datetime import datetime

import ollama
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile, status, Request, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("security")

from backend.auth import (
    Token,
    UserCreate,
    UserInfo,
    change_password,
    create_access_token,
    create_user,
    get_current_admin,
    get_current_user,
    get_user_by_id,
    get_user_by_username,
    update_user_role,
    verify_password,
)
from backend.security import login_limiter, register_limiter, get_client_ip, login_guard
from backend.history import (
    add_message,
    create_session,
    delete_session,
    get_session_messages,
    get_session_owner,
    get_sessions,
    update_session_title,
)
from backend.rag import (
    NO_CONTEXT_ANSWER,
    RELEVANCE_THRESHOLD,
    ask_rag,
    ask_rag_stream,
    clear_caches,
    should_retrieve,
)
from backend.store import (
    CHAT_MODEL_NAME,
    DATA_DIR,
    EMBED_MODEL_NAME,
    RERANK_MODEL_NAME,
    delete_source,
    ensure_storage_dirs,
    get_collection,
    index_document,
    list_indexed_sources,
    normalize_source_name,
    read_document,
)

app = FastAPI(title="Internal RAG API")

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
MAX_UPLOAD_SIZE = int(os.getenv("MAX_UPLOAD_SIZE", 10485760))
ALLOWED_EXTENSIONS = {
    ".txt", ".pdf", ".docx", ".py", ".js", ".ts", ".jsx", ".tsx",
    ".html", ".css", ".json", ".md", ".java", ".c", ".cpp", ".h", ".go",
    ".yaml", ".yml", ".sql", ".sh", ".bash", ".png", ".jpg", ".jpeg"
}

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Content-Security-Policy"] = "default-src 'self'; frame-ancestors 'none';"
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["*"],
)


# ── Pydantic 모델 ──────────────────────────────────────────

class Message(BaseModel):
    role: str
    content: str


class Question(BaseModel):
    query: str
    model: str | None = None
    history: list[Message] | None = None
    session_id: str | None = None
    selected_files: list[str] = []


class SessionUpdate(BaseModel):
    title: str


class RoleUpdate(BaseModel):
    is_admin: bool


class FeedbackUpdate(BaseModel):
    feedback: int


class PasswordChange(BaseModel):
    old_password: str
    new_password: str


ensure_storage_dirs()


# ── 유틸리티 ───────────────────────────────────────────────

def save_upload(file: UploadFile, target_path: Path):
    target_path.parent.mkdir(parents=True, exist_ok=True)
    with target_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)


def build_upload_temp_path(source_name: str, user_id: str = "") -> Path:
    prefix = f"{user_id}-" if user_id else ""
    return DATA_DIR / f".upload-{prefix}{uuid4().hex}{Path(source_name).suffix}"


# ── 기본 엔드포인트 ────────────────────────────────────────

@app.get("/")
def root():
    return {"message": "RAG API running"}


@app.get("/stats")
def get_stats(current_user: UserInfo = Depends(get_current_user)):
    sources = list_indexed_sources(user_id=current_user.id)
    results = get_collection().get(where={"user_id": current_user.id}, include=[])
    total_chunks = len(results.get("ids") or [])

    user_data_dir = DATA_DIR / current_user.id
    total_size = 0
    if user_data_dir.exists():
        total_size = sum(f.stat().st_size for f in user_data_dir.iterdir() if f.is_file())

    return {
        "indexed_files": len(sources),
        "total_chunks": total_chunks,
        "total_size_bytes": total_size,
        "total_size_mb": round(total_size / (1024 * 1024), 2),
        "embed_model": EMBED_MODEL_NAME,
        "reranker_model": RERANK_MODEL_NAME,
        "chat_model": CHAT_MODEL_NAME,
        "allowed_extensions": sorted(list(ALLOWED_EXTENSIONS)),
        "max_upload_size_mb": MAX_UPLOAD_SIZE // (1024 * 1024),
    }


@app.get("/models")
def list_models():
    try:
        models_info = ollama.list()
        model_list = [
            m.model if hasattr(m, "model") else m["model"]
            for m in models_info["models"]
        ]
        return {"models": sorted(model_list)}
    except Exception as error:
        raise HTTPException(status_code=500, detail="모델 목록을 가져오지 못했습니다.") from error


# ── 인증 엔드포인트 ────────────────────────────────────────

@app.post("/auth/register", response_model=Token, status_code=201)
def register(request: Request, body: UserCreate):
    register_limiter.check(request)
    try:
        user = create_user(body.username, body.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    token = create_access_token(user["id"], user["username"], user["is_admin"])
    return Token(access_token=token, token_type="bearer", username=user["username"], is_admin=user["is_admin"])


@app.post("/auth/login", response_model=Token)
def login(request: Request, form: OAuth2PasswordRequestForm = Depends()):
    login_limiter.check(request)
    ip = get_client_ip(request)
    login_guard.check(form.username, ip)

    generic_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="아이디 또는 비밀번호가 올바르지 않습니다.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    user = get_user_by_username(form.username)
    if not user:
        login_guard.record_failure(form.username, ip)
        raise generic_error

    if not verify_password(form.password, user["hashed_password"]):
        login_guard.record_failure(form.username, ip)
        raise generic_error

    login_guard.clear(form.username, ip)
    token = create_access_token(user["id"], user["username"], user["is_admin"])
    return Token(access_token=token, token_type="bearer", username=user["username"], is_admin=user["is_admin"])


@app.get("/auth/me", response_model=UserInfo)
def me(current_user: UserInfo = Depends(get_current_user)):
    return current_user


@app.post("/auth/change-password")
def change_password_endpoint(
    body: PasswordChange,
    current_user: UserInfo = Depends(get_current_user),
):
    """현재 사용자의 비밀번호를 변경합니다."""
    try:
        change_password(current_user.id, body.old_password, body.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"message": "비밀번호가 성공적으로 변경되었습니다."}


# ── 관리자 전용 엔드포인트 ──────────────────────────────

@app.get("/admin/users")
def list_all_users(admin: UserInfo = Depends(get_current_admin)):
    import sqlite3
    from backend.auth import USERS_DB_PATH
    with sqlite3.connect(USERS_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT id, username, is_admin, created_at FROM users").fetchall()
        return [dict(r) for r in rows]


@app.get("/admin/users/{user_id}/role")
def get_user_role(
    user_id: str,
    admin: UserInfo = Depends(get_current_admin),
):
    """특정 사용자의 권한 상태를 조회합니다."""
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    return {"is_admin": user["is_admin"]}


@app.patch("/admin/users/{user_id}/role")
def change_user_role(
    user_id: str,
    body: RoleUpdate,
    admin: UserInfo = Depends(get_current_admin),
):
    """관리자가 특정 사용자의 권한을 변경합니다."""
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="자기 자신의 권한은 변경할 수 없습니다.")
    success = update_user_role(user_id, body.is_admin)
    if not success:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    return {"message": f"권한이 {'관리자로 변경' if body.is_admin else '일반 사용자로 변경'}되었습니다."}


@app.get("/admin/stats/global")
def get_global_stats(admin: UserInfo = Depends(get_current_admin)):
    collection = get_collection()
    total_docs = collection.count()

    import sqlite3
    from backend.auth import USERS_DB_PATH
    with sqlite3.connect(USERS_DB_PATH) as conn:
        user_count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]

    return {
        "total_users": user_count,
        "total_chunks_in_db": total_docs,
        "server_status": "healthy"
    }


@app.delete("/admin/users/{user_id}")
def delete_user_account(user_id: str, admin: UserInfo = Depends(get_current_admin)):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="자기 자신은 삭제할 수 없습니다.")

    import sqlite3
    from backend.auth import USERS_DB_PATH
    with sqlite3.connect(USERS_DB_PATH) as conn:
        cursor = conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="존재하지 않는 사용자입니다.")

    return {"message": "사용자가 삭제되었습니다."}


@app.get("/admin/logs")
def get_activity_logs(
    user_id: str | None = Query(None),
    role: str | None = Query(None),
    limit: int = Query(100),
    admin: UserInfo = Depends(get_current_admin)
):
    import sqlite3
    from backend.history import HISTORY_DB_PATH
    from backend.auth import USERS_DB_PATH

    # 1. 사용자 ID -> 이름 매핑 생성
    user_map = {}
    with sqlite3.connect(USERS_DB_PATH) as u_conn:
        u_conn.row_factory = sqlite3.Row
        users = u_conn.execute("SELECT id, username FROM users").fetchall()
        for u in users:
            user_map[u["id"]] = u["username"]

    # 2. 로그 조회
    with sqlite3.connect(HISTORY_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        
        query = """
            SELECT m.id, m.role, m.content, m.feedback, m.score, m.created_at, s.user_id, s.title as session_title
            FROM messages m
            JOIN sessions s ON m.session_id = s.id
            WHERE 1=1
        """
        params = []
        if user_id:
            # 사용자명으로도 검색 가능하게 함
            matched_ids = [uid for uid, uname in user_map.items() if user_id.lower() in uname.lower()]
            if matched_ids:
                placeholders = ",".join(["?"] * len(matched_ids))
                query += f" AND s.user_id IN ({placeholders})"
                params.extend(matched_ids)
            else:
                query += " AND s.user_id = 'none'" # 검색 결과 없음 처리
        
        if role:
            query += " AND m.role = ?"
            params.append(role)
            
        query += " ORDER BY m.created_at DESC LIMIT ?"
        params.append(limit)
        
        logs = conn.execute(query, params).fetchall()

    # 3. 데이터 결합
    result = []
    for log in logs:
        d = dict(log)
        d["username"] = user_map.get(d["user_id"], "Unknown")
        result.append(d)

    return result


# ── 세션 엔드포인트 ────────────────────────────────────────

@app.get("/sessions")
def list_chat_sessions(current_user: UserInfo = Depends(get_current_user)):
    return {"sessions": get_sessions(user_id=current_user.id)}


@app.get("/sessions/{session_id}")
def get_session(session_id: str, current_user: UserInfo = Depends(get_current_user)):
    messages = get_session_messages(session_id, user_id=current_user.id)
    if messages is None:
        raise HTTPException(status_code=403, detail="이 세션에 접근할 권한이 없습니다.")
    return {"messages": messages}


@app.delete("/sessions/{session_id}")
def remove_session(session_id: str, current_user: UserInfo = Depends(get_current_user)):
    owner = get_session_owner(session_id)
    if owner and owner != current_user.id:
        raise HTTPException(status_code=403, detail="이 세션에 접근할 권한이 없습니다.")
    delete_session(session_id, user_id=current_user.id)
    return {"message": "Session deleted"}


@app.patch("/sessions/{session_id}")
def rename_session(
    session_id: str,
    update: SessionUpdate,
    current_user: UserInfo = Depends(get_current_user),
):
    owner = get_session_owner(session_id)
    if owner and owner != current_user.id:
        raise HTTPException(status_code=403, detail="이 세션에 접근할 권한이 없습니다.")
    update_session_title(session_id, update.title, user_id=current_user.id)
    return {"message": "Session renamed"}


@app.post("/messages/{message_id}/feedback")
def set_message_feedback(
    message_id: str,
    body: FeedbackUpdate,
    current_user: UserInfo = Depends(get_current_user),
):
    from backend.history import update_message_feedback
    success = update_message_feedback(message_id, body.feedback, user_id=current_user.id)
    if not success:
        raise HTTPException(status_code=404, detail="메시지를 찾을 수 없거나 접근 권한이 없습니다.")
    return {"message": "Feedback updated"}


# ── 채팅 엔드포인트 ────────────────────────────────────────

@app.post("/ask")
def ask(question: Question, current_user: UserInfo = Depends(get_current_user)):
    history_dicts = [m.model_dump() for m in question.history] if question.history else []

    current_session_id = question.session_id
    if not current_session_id:
        title = (question.query[:30] + "...") if len(question.query) > 30 else question.query
        current_session_id = create_session(title=title, model=question.model, user_id=current_user.id)
    else:
        owner = get_session_owner(current_session_id)
        if owner and owner != current_user.id:
            raise HTTPException(status_code=403, detail="이 세션에 접근할 권한이 없습니다.")

    add_message(current_session_id, "user", question.query)

    if not should_retrieve(question.query):
        res = ollama.chat(
            model=CHAT_MODEL_NAME,
            messages=[{"role": "user", "content": question.query}]
        )
        result = {"answer": res["message"]["content"], "context": "", "sources": [], "score": 0.0}
    else:
        result = ask_rag(
            question.query,
            model=question.model,
            history=history_dicts,
            user_id=current_user.id,
            selected_sources=question.selected_files
        )

    add_message(
        current_session_id, "assistant", result["answer"],
        sources=result["sources"], context=result["context"], score=result["score"],
    )
    result["session_id"] = current_session_id
    return result


@app.post("/ask-stream")
def ask_stream(question: Question, current_user: UserInfo = Depends(get_current_user)):
    history_dicts = [m.model_dump() for m in question.history] if question.history else []

    current_session_id = question.session_id
    is_new_session = False

    if not current_session_id:
        temp_title = (question.query[:30] + "...") if len(question.query) > 30 else question.query
        current_session_id = create_session(title=temp_title, model=question.model, user_id=current_user.id)
        is_new_session = True
    else:
        owner = get_session_owner(current_session_id)
        if owner and owner != current_user.id:
            raise HTTPException(status_code=403, detail="이 세션에 접근할 권한이 없습니다.")

    add_message(current_session_id, "user", question.query)

    def generator():
        if is_new_session:
            yield json.dumps({"type": "session", "session_id": current_session_id}, ensure_ascii=False) + "\n"

        full_answer = ""
        meta = None

        try:
            for event in ask_rag_stream(
                question.query,
                model=question.model,
                history=history_dicts,
                user_id=current_user.id,
                selected_sources=question.selected_files
            ):
                if event["type"] == "chunk":
                    full_answer += event["content"]
                elif event["type"] == "meta":
                    meta = event
                yield json.dumps(event, ensure_ascii=False) + "\n"

        finally:
            if full_answer.strip() or meta:
                final_content = full_answer
                if not final_content.strip():
                    if meta and meta.get("score", 0) < RELEVANCE_THRESHOLD:
                        final_content = NO_CONTEXT_ANSWER
                    else:
                        final_content = "답변 생성 중 세션이 전환되어 중단되었습니다."

                add_message(
                    current_session_id,
                    role="assistant",
                    content=final_content,
                    sources=meta.get("sources") if meta else [],
                    context=meta.get("context") if meta else "",
                    score=meta.get("score") if meta else 0.0,
                )

    return StreamingResponse(generator(), media_type="application/x-ndjson")


# ── 파일 엔드포인트 ────────────────────────────────────────

@app.post("/upload")
async def upload(
    files: list[UploadFile] = File(...),
    current_user: UserInfo = Depends(get_current_user),
):
    results = []
    user_data_dir = DATA_DIR / current_user.id
    user_data_dir.mkdir(parents=True, exist_ok=True)

    for file in files:
        ext = Path(file.filename or "").suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            results.append({"file": file.filename, "status": "error", "message": f"허용되지 않는 형식 ({ext})"})
            continue

        content_length = file.size if hasattr(file, "size") else 0
        if content_length > MAX_UPLOAD_SIZE:
            results.append({"file": file.filename, "status": "error", "message": "용량 초과 (최대 10MB)"})
            continue

        try:
            source_name = normalize_source_name(file.filename or "")
            target_path = user_data_dir / source_name
            temp_path = build_upload_temp_path(source_name, user_id=current_user.id)

            save_upload(file, temp_path)
            text = read_document(temp_path)

            if not text.strip():
                results.append({"file": file.filename, "status": "error", "message": "텍스트 없음"})
                temp_path.unlink(missing_ok=True)
                continue

            chunks = index_document(source_name, text, user_id=current_user.id)
            shutil.move(str(temp_path), str(target_path))
            results.append({"file": source_name, "status": "success", "chunks": chunks})

        except Exception as error:
            logger.error(f"Error uploading {file.filename}: {error}")
            results.append({"file": file.filename, "status": "error", "message": str(error)})
        finally:
            await file.close()

    clear_caches()
    success_count = sum(1 for r in results if r["status"] == "success")
    return {
        "message": f"{len(files)}개 중 {success_count}개 파일 업로드 완료",
        "results": results,
    }


@app.get("/files")
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
                "updated_at": datetime.fromtimestamp(stat.st_mtime).isoformat()
            })

    return {"count": len(files_info), "files": sorted(files_info, key=lambda x: x["name"])}


@app.get("/files-db")
def get_files_from_db(current_user: UserInfo = Depends(get_current_user)):
    """DB에 등록된 소스 목록과 실제 파일 정보, 청크 수를 함께 반환합니다."""
    indexed_names = list_indexed_sources(user_id=current_user.id)
    user_data_dir = DATA_DIR / current_user.id
    collection = get_collection()
    files_info = []

    for name in indexed_names:
        path = user_data_dir / name

        # 파일별 청크 수 및 태그 조회
        try:
            chunk_res = collection.get(
                where={"$and": [{"source": name}, {"user_id": current_user.id}]},
                include=["metadatas"],
            )
            ids = chunk_res.get("ids") or []
            chunk_count = len(ids)
            
            # 첫 번째 청크의 메타데이터에서 태그 추출
            metadatas = chunk_res.get("metadatas") or []
            tags = []
            if metadatas and metadatas[0].get("tags"):
                tags = metadatas[0]["tags"].split(",")
        except Exception:
            chunk_count = 0
            tags = []

        if path.exists():
            stat = path.stat()
            files_info.append({
                "name": name,
                "size": stat.st_size,
                "updated_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                "chunks": chunk_count,
                "tags": tags,
            })
        else:
            files_info.append({
                "name": name,
                "size": 0,
                "updated_at": None,
                "chunks": chunk_count,
                "tags": tags,
            })

    return {"count": len(files_info), "files": sorted(files_info, key=lambda x: x["name"])}


@app.delete("/files/batch")
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
                results.append({"file": source_name, "status": "success"})
            else:
                results.append({"file": source_name, "status": "not_found"})
        except Exception as e:
            results.append({"file": name, "status": "error", "message": str(e)})

    clear_caches()
    return {"results": results}


class FileTagsUpdate(BaseModel):
    tags: list[str]

@app.patch("/file/tags")
def update_file_tags(
    name: str = Query(...),
    body: FileTagsUpdate = Body(...),
    current_user: UserInfo = Depends(get_current_user),
):
    source_name = normalize_source_name(name)
    collection = get_collection()
    where_filter = {"$and": [{"source": source_name}, {"user_id": current_user.id}]}
    
    # 해당 소스의 모든 청크에 대해 태그 업데이트
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
