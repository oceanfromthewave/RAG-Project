from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from backend.config import ALLOWED_EXTENSIONS, MAX_UPLOAD_SIZE
from backend.core.security import models_limiter
from backend.services import llm
from backend.services.auth import UserInfo, get_current_user
from backend.services.store import (
    DATA_DIR,
    EMBED_MODEL_NAME,
    RERANK_MODEL_NAME,
    get_collection,
    list_indexed_sources,
)

logger = logging.getLogger("security")

router = APIRouter(tags=["system"])


# ── 기본 엔드포인트 ────────────────────────────────────────

@router.get("/")
def root():
    return {"message": "RAG API running"}


@router.get("/health")
def health_check():
    """ollama 연결 및 ChromaDB 상태를 확인하는 헬스체크 엔드포인트."""
    checks: dict[str, str] = {}

    try:
        checks["llm"] = llm.health()
    except Exception:
        logger.exception("health check failed: llm")
        checks["llm"] = "error"

    try:
        total = get_collection().count()
        checks["chromadb"] = f"ok ({total} chunks)"
    except Exception:
        logger.exception("health check failed: chromadb")
        checks["chromadb"] = "error"

    try:
        from backend.services.history import HISTORY_DB_PATH
        import sqlite3
        with sqlite3.connect(HISTORY_DB_PATH) as conn:
            conn.execute("SELECT 1")
        checks["history_db"] = "ok"
    except Exception:
        logger.exception("health check failed: history_db")
        checks["history_db"] = "error"

    all_ok = all(v.startswith("ok") for v in checks.values())
    return {
        "status": "healthy" if all_ok else "degraded",
        "checks": checks,
    }


@router.get("/stats")
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
        "chat_model": llm.active_model(),
        "allowed_extensions": sorted(list(ALLOWED_EXTENSIONS)),
        "max_upload_size_mb": MAX_UPLOAD_SIZE // (1024 * 1024),
    }


@router.get("/models")
def list_models(request: Request, current_user: UserInfo = Depends(get_current_user)):
    models_limiter.check(request)
    if llm.using_claude():
        return {"models": [llm.active_model()]}
    try:
        import ollama
        models_info = ollama.list()
        if isinstance(models_info, dict):
            raw_models = models_info.get("models", [])
        else:
            raw_models = getattr(models_info, "models", [])

        model_list = []
        for m in raw_models:
            if isinstance(m, dict):
                name = m.get("model") or m.get("name", "")
            else:
                name = getattr(m, "model", None) or getattr(m, "name", "") or str(m)
            if name:
                model_list.append(name)

        return {"models": sorted(model_list)}
    except Exception as error:
        logger.exception("모델 목록 조회 실패")
        raise HTTPException(status_code=500, detail="모델 목록을 가져오지 못했습니다.") from error
