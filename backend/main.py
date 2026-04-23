from __future__ import annotations

import json
import shutil
from pathlib import Path
from uuid import uuid4

import ollama
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.history import (
    add_message,
    create_session,
    delete_session,
    get_session_messages,
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


def save_upload(file: UploadFile, target_path: Path):
    with target_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)


def build_upload_temp_path(source_name: str) -> Path:
    return DATA_DIR / f".upload-{uuid4().hex}{Path(source_name).suffix}"


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


@app.get("/sessions")
def list_chat_sessions():
    return {"sessions": get_sessions()}


@app.get("/sessions/{session_id}")
def get_session(session_id: str):
    messages = get_session_messages(session_id)
    return {"messages": messages}


@app.delete("/sessions/{session_id}")
def remove_session(session_id: str):
    delete_session(session_id)
    return {"message": "Session deleted"}


@app.patch("/sessions/{session_id}")
def rename_session(session_id: str, update: SessionUpdate):
    update_session_title(session_id, update.title)
    return {"message": "Session renamed"}


@app.post("/ask")
def ask(question: Question):
    history_dicts = [m.model_dump() for m in question.history] if question.history else []

    current_session_id = question.session_id
    if not current_session_id:
        title = (question.query[:30] + "...") if len(question.query) > 30 else question.query
        current_session_id = create_session(title=title, model=question.model)

    add_message(current_session_id, "user", question.query)

    result = ask_rag(question.query, model=question.model, history=history_dicts)

    add_message(
        current_session_id,
        "assistant",
        result["answer"],
        sources=result["sources"],
        context=result["context"],
        score=result["score"]
    )

    result["session_id"] = current_session_id
    return result


@app.post("/ask-stream")
def ask_stream(question: Question):
    history_dicts = [m.model_dump() for m in question.history] if question.history else []

    current_session_id = question.session_id
    is_new_session = False
    if not current_session_id:
        title = (question.query[:30] + "...") if len(question.query) > 30 else question.query
        current_session_id = create_session(title=title, model=question.model)
        is_new_session = True

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
            # 클라이언트 연결이 끊기거나 제네레이터가 중단되어도 지금까지 생성된 내용을 저장함
            if full_answer.strip() or meta:
                # 답변이 아예 없는 경우(메타만 있는 경우) 사용자에게 중단되었음을 알리는 문구 추가
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
                    score=meta.get("score") if meta else 0.0
                )

    return StreamingResponse(generator(), media_type="application/x-ndjson")


@app.post("/upload")
async def upload(file: UploadFile = File(...)):
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
def get_files():
    files = sorted(path.name for path in DATA_DIR.iterdir() if path.is_file())
    return {"count": len(files), "files": files}


@app.get("/files-db")
def get_files_from_db():
    files = list_indexed_sources()
    return {"count": len(files), "files": files}


@app.delete("/file")
def delete_file(name: str = Query(...)):
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
