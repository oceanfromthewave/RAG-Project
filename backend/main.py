from __future__ import annotations

import json
import shutil
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.rag import ask_rag, ask_rag_stream, clear_caches
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


class Question(BaseModel):
    query: str


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


@app.post("/ask")
def ask(question: Question):
    return ask_rag(question.query)


@app.post("/ask-stream")
def ask_stream(question: Question):
    def generator():
        for event in ask_rag_stream(question.query):
            yield json.dumps(event, ensure_ascii=False) + "\n"

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
        raise HTTPException(status_code=400, detail="\uc5c5\ub85c\ub4dc\ud55c \ud30c\uc77c\uc744 \uc77d\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.") from error
    finally:
        await file.close()

    if not text.strip():
        raise HTTPException(status_code=400, detail="\uc77d\uc744 \uc218 \uc788\ub294 \ud14d\uc2a4\ud2b8\uac00 \uc5c6\ub294 \ud30c\uc77c\uc785\ub2c8\ub2e4.")

    try:
        chunks = index_document(source_name, text)
        temp_path.replace(target_path)
    except Exception as error:
        raise HTTPException(status_code=500, detail="\ubb38\uc11c \uc778\ub371\uc2f1 \uc911 \uc624\ub958\uac00 \ubc1c\uc0dd\ud588\uc2b5\ub2c8\ub2e4.") from error
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)

    clear_caches()

    return {
        "message": "\ud30c\uc77c \uc5c5\ub85c\ub4dc\uc640 \uc778\ub371\uc2f1\uc774 \uc644\ub8cc\ub410\uc2b5\ub2c8\ub2e4.",
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
        raise HTTPException(status_code=404, detail="\ud30c\uc77c\uc744 \ucc3e\uc744 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.")

    deleted_chunks = delete_source(source_name)
    target_path.unlink()
    clear_caches()

    return {
        "message": "\ud30c\uc77c \uc0ad\uc81c\uac00 \uc644\ub8cc\ub410\uc2b5\ub2c8\ub2e4.",
        "deleted_chunks": deleted_chunks,
        "file": source_name,
    }
