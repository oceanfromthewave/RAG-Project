from __future__ import annotations

import os
import json
import shutil
import logging
from pathlib import Path
from uuid import uuid4

import ollama
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile, status, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel

# .env 로드
load_dotenv()

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("security")

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
from backend.security import login_limiter, register_limiter, login_guard, get_client_ip
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
    generate_session_title,
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

# 환경 변수 설정
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
MAX_UPLOAD_SIZE = int(os.getenv("MAX_UPLOAD_SIZE", 10485760)) # 기본 10MB
ALLOWED_EXTENSIONS = {".txt", ".pdf", ".docx"}

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


class SessionUpdate(BaseModel):
    title: str


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
    
    return {
        "indexed_files": len(sources),
        "total_chunks": total_chunks,
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
def register(request: Request, body: UserCreate):
    """신규 사용자 등록 후 즉시 토큰 반환."""
    register_limiter.check(request)

    try:
        user = create_user(body.username, body.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    token = create_access_token(user["id"], user["username"])
    return Token(access_token=token, token_type="bearer", username=user["username"])


@app.post("/auth/login", response_model=Token)
def login(request: Request, form: OAuth2PasswordRequestForm = Depends()):
    """사용자 이름 + 비밀번호로 로그인, JWT 반환."""
    login_limiter.check(request)
    ip = get_client_ip(request)
    login_guard.check(form.username, ip)

    user = get_user_by_username(form.username)
    if not user or not verify_password(form.password, user["hashed_password"]):
        login_guard.record_failure(form.username, ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="사용자 이름 또는 비밀번호가 올바르지 않습니다.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    login_guard.clear(form.username, ip)

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

    if not should_retrieve(question.query):
        res = ollama.chat(
            model=CHAT_MODEL_NAME,
            messages=[{"role": "user", "content": question.query}]
        )
        result = {
            "answer": res["message"]["content"],
            "context": "",
            "sources": [],
            "score": 0.0
        }
    else:
        result = ask_rag(
            question.query,
            model=question.model,
            history=history_dicts,
            user_id=current_user.id
        )

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
        # 임시 제목으로 세션 생성 (스트림 완료 후 LLM 제목으로 교체됨)
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
        stream_completed = False  # 스트림 정상 완료 여부 추적

        try:
            for event in ask_rag_stream(question.query, model=question.model, history=history_dicts, user_id=current_user.id):
                if event["type"] == "chunk":
                    full_answer += event["content"]
                elif event["type"] == "meta":
                    meta = event
                yield json.dumps(event, ensure_ascii=False) + "\n"

            stream_completed = True  # for 루프를 정상적으로 다 돌았을 때만 True

        finally:
            # 스트림 완료·중단 여부 관계없이 답변은 항상 저장
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

        # ── 세션 제목 자동 생성 ──────────────────────────────
        # 새 세션이고 스트림이 정상 완료됐고 답변이 있을 때만 실행
        if is_new_session and stream_completed and full_answer.strip():
            try:
                title = generate_session_title(question.query, full_answer, question.model)
                update_session_title(current_session_id, title, user_id=current_user.id)
                logger.info(f"세션 제목 자동 생성: '{title}' (session={current_session_id})")
                yield json.dumps(
                    {"type": "title", "session_id": current_session_id, "title": title},
                    ensure_ascii=False,
                ) + "\n"
            except Exception as exc:
                # 제목 생성 실패는 치명적이지 않으므로 경고만 기록
                logger.warning(f"세션 제목 자동 생성 실패: {exc}")

    return StreamingResponse(generator(), media_type="application/x-ndjson")


# ── 파일 엔드포인트 (인증 필요) ────────────────────────────

@app.post("/upload")
async def upload(
    file: UploadFile = File(...),
    current_user: UserInfo = Depends(get_current_user),
):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400, 
            detail=f"허용되지 않는 파일 형식입니다. ({', '.join(ALLOWED_EXTENSIONS)} 만 가능)"
        )

    content_length = file.size if hasattr(file, "size") else 0
    if content_length > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail="파일 용량이 너무 큽니다. (최대 10MB)")

    temp_path: Path | None = None
    logger.info(f"User {current_user.username} is uploading file: {file.filename}")

    try:
        source_name = normalize_source_name(file.filename or "")
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    user_data_dir = DATA_DIR / current_user.id
    user_data_dir.mkdir(parents=True, exist_ok=True)
    
    target_path = user_data_dir / source_name
    temp_path = build_upload_temp_path(source_name, user_id=current_user.id)

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
        chunks = index_document(source_name, text, user_id=current_user.id)
        shutil.move(str(temp_path), str(target_path))
    except Exception as error:
        logger.error(f"Indexing error: {error}")
        raise HTTPException(status_code=500, detail=f"문서 인덱싱 중 오류가 발생했습니다: {str(error)}")
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
def get_files(current_user: UserInfo = Depends(get_current_user)):
    user_data_dir = DATA_DIR / current_user.id
    if not user_data_dir.exists():
        return {"count": 0, "files": []}
    
    files = sorted(path.name for path in user_data_dir.iterdir() if path.is_file())
    return {"count": len(files), "files": files}


@app.get("/files-db")
def get_files_from_db(current_user: UserInfo = Depends(get_current_user)):
    files = list_indexed_sources(user_id=current_user.id)
    return {"count": len(files), "files": files}


@app.delete("/file")
def delete_file(name: str = Query(...), current_user: UserInfo = Depends(get_current_user)):
    try:
        source_name = normalize_source_name(name)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    user_data_dir = DATA_DIR / current_user.id
    target_path = user_data_dir / source_name
    
    if not target_path.exists():
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없거나 권한이 없습니다.")

    deleted_chunks = delete_source(source_name, user_id=current_user.id)
    target_path.unlink()
    clear_caches()

    return {
        "message": "파일 삭제가 완료되었습니다.",
        "deleted_chunks": deleted_chunks,
        "file": source_name,
    }
