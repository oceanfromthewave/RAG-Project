from __future__ import annotations

import json
import shutil
from pathlib import Path
from uuid import uuid4

import ollama
from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel

from backend.auth import (
    Token,
    UserCreate,
    UserInfo,
    create_access_token,
    create_user,
    get_current_user,
    get_user_by_username,
    verify_password,
)
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["*"],
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


class SessionUpdate(BaseModel):
    title: str


ensure_storage_dirs()


# ── 유틸리티 ───────────────────────────────────────────────

def save_upload(file: UploadFile, target_path: Path):
    with target_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)


def build_upload_temp_path(source_name: str) -> Path:
    return DATA_DIR / f".upload-{uuid4().hex}{Path(source_name).suffix}"


# ── 기본 엔드포인트 ────────────────────────────────────────

@app.get("/")
def root():
    return {"message": "RAG API running"}


@app.get("/stats")
def get_stats():
    sources = list_indexed_sources()
    return {
        "indexed_files": len(sources),
        "total_chunks": get_collection().count(),
        "embed_model": EMBED_MODEL_NAME,
        "reranker_model": RERANK_MODEL_NAME,
        "chat_model": CHAT_MODEL_NAME,
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
def register(body: UserCreate):
    """신규 사용자 등록 후 즉시 토큰 반환."""
    try:
        user = create_user(body.username, body.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    token = create_access_token(user["id"], user["username"])
    return Token(access_token=token, token_type="bearer", username=user["username"])


@app.post("/auth/login", response_model=Token)
def login(form: OAuth2PasswordRequestForm = Depends()):
    """사용자 이름 + 비밀번호로 로그인, JWT 반환."""
    user = get_user_by_username(form.username)
    if not user or not verify_password(form.password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="사용자 이름 또는 비밀번호가 올바르지 않습니다.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = create_access_token(user["id"], user["username"])
    return Token(access_token=token, token_type="bearer", username=user["username"])


@app.get("/auth/me", response_model=UserInfo)
def me(current_user: UserInfo = Depends(get_current_user)):
    """현재 로그인한 사용자 정보 반환."""
    return current_user


# ── 세션 엔드포인트 (인증 필요) ────────────────────────────

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


# ── 채팅 엔드포인트 (인증 필요) ────────────────────────────

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
    result = ask_rag(question.query, model=question.model, history=history_dicts)
    add_message(
        current_session_id,
        "assistant",
        result["answer"],
        sources=result["sources"],
        context=result["context"],
        score=result["score"],
    )

    result["session_id"] = current_session_id
    return result


@app.post("/ask-stream")
def ask_stream(question: Question, current_user: UserInfo = Depends(get_current_user)):
    history_dicts = [m.model_dump() for m in question.history] if question.history else []

    current_session_id = question.session_id
    is_new_session = False

    if not current_session_id:
        title = (question.query[:30] + "...") if len(question.query) > 30 else question.query
        current_session_id = create_session(title=title, model=question.model, user_id=current_user.id)
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
            for event in ask_rag_stream(question.query, model=question.model, history=history_dicts):
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
                    "assistant",
                    final_content,
                    sources=meta.get("sources") if meta else [],
                    context=meta.get("context") if meta else "",
                    score=meta.get("score") if meta else 0.0,
                )

    return StreamingResponse(generator(), media_type="application/x-ndjson")


# ── 파일 엔드포인트 (인증 필요) ────────────────────────────

@app.post("/upload")
async def upload(
    file: UploadFile = File(...),
    current_user: UserInfo = Depends(get_current_user),
):
    temp_path: Path | None = None

    try:
        source_name = normalize_source_name(file.filename or "")
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    target_path = DATA_DIR / source_name
    temp_path = build_upload_temp_path(source_name)

    try:
        save_upload(file, temp_path)
        text = read_document(temp_path)
    except Exception as error:
        raise HTTPException(status_code=400, detail="업로드한 파일을 읽지 못했습니다.") from error
    finally:
        await file.close()

    if not text.strip():
        raise HTTPException(status_code=400, detail="읽을 수 있는 텍스트가 없는 파일입니다.")

    try:
        chunks = index_document(source_name, text)
        temp_path.replace(target_path)
    except Exception as error:
        raise HTTPException(status_code=500, detail="문서 인덱싱 중 오류가 발생했습니다.") from error
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)

    clear_caches()
    return {
        "message": "파일 업로드와 인덱싱이 완료되었습니다.",
        "file": source_name,
        "chunks": chunks,
    }


@app.get("/files")
def get_files(_: UserInfo = Depends(get_current_user)):
    files = sorted(path.name for path in DATA_DIR.iterdir() if path.is_file())
    return {"count": len(files), "files": files}


@app.get("/files-db")
def get_files_from_db(_: UserInfo = Depends(get_current_user)):
    files = list_indexed_sources()
    return {"count": len(files), "files": files}


@app.delete("/file")
def delete_file(name: str = Query(...), _: UserInfo = Depends(get_current_user)):
    try:
        source_name = normalize_source_name(name)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    target_path = DATA_DIR / source_name
    if not target_path.exists():
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")

    deleted_chunks = delete_source(source_name)
    target_path.unlink()
    clear_caches()

    return {
        "message": "파일 삭제가 완료되었습니다.",
        "deleted_chunks": deleted_chunks,
        "file": source_name,
    }
