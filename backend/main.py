from __future__ import annotations

import logging

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.config import ALLOWED_ORIGINS
from backend.routers import admin, auth, chat, files, sessions, system, workspaces
from backend.services.store import ensure_storage_dirs

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("security")

app = FastAPI(title="Internal RAG API")


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
    allow_credentials="*" not in ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["*"],
)


# ── 전역 예외 핸들러 ─────────────────────────────────────

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    if isinstance(exc, HTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
        )

    logger.error(f"UNHANDLED ERROR: {request.method} {request.url}")
    logger.error(f"Exception Type: {type(exc).__name__}")
    logger.error(f"Exception Detail: {str(exc)}", exc_info=True)

    return JSONResponse(
        status_code=500,
        content={"detail": "예기치 못한 서버 오류가 발생했습니다. 관리자에게 문의해 주세요."},
    )


ensure_storage_dirs()

# ── 라우터 등록 ──────────────────────────────────────────
app.include_router(system.router)
app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(workspaces.router)
app.include_router(sessions.router)
app.include_router(chat.router)
app.include_router(files.router)
