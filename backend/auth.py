from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

from backend.store import DB_DIR

USERS_DB_PATH = DB_DIR / "users.db"

# 운영 환경에서는 반드시 환경 변수로 교체하세요
SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "rag-project-secret-key-change-in-production-!!!")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__truncate_error=False)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


# ── Pydantic 모델 ──────────────────────────────────────────

class UserCreate(BaseModel):
    username: str
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str
    username: str


class UserInfo(BaseModel):
    id: str
    username: str


# ── DB 초기화 ──────────────────────────────────────────────

def init_users_db():
    DB_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(USERS_DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id              TEXT PRIMARY KEY,
                username        TEXT UNIQUE NOT NULL,
                hashed_password TEXT NOT NULL,
                created_at      TEXT NOT NULL
            )
        """)
        conn.commit()


# ── 사용자 조회 / 생성 ─────────────────────────────────────

def get_user_by_username(username: str) -> dict | None:
    with sqlite3.connect(USERS_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ).fetchone()
        return dict(row) if row else None


def create_user(username: str, password: str) -> dict:
    if len(username.strip()) < 2:
        raise ValueError("사용자 이름은 2자 이상이어야 합니다.")
    if len(password) < 4:
        raise ValueError("비밀번호는 4자 이상이어야 합니다.")
    if len(password.encode("utf-8")) > 72:
        raise ValueError("비밀번호는 72바이트를 초과할 수 없습니다.")
    if get_user_by_username(username):
        raise ValueError("이미 사용 중인 사용자 이름입니다.")

    user_id = str(uuid4())
    now = datetime.now(timezone.utc).isoformat()
    hashed = pwd_context.hash(password)

    with sqlite3.connect(USERS_DB_PATH) as conn:
        conn.execute(
            "INSERT INTO users (id, username, hashed_password, created_at) VALUES (?, ?, ?, ?)",
            (user_id, username.strip(), hashed, now),
        )
        conn.commit()

    return {"id": user_id, "username": username.strip()}


# ── 비밀번호 검증 / 토큰 생성 ─────────────────────────────

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: str, username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    payload = {"sub": user_id, "username": username, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


# ── FastAPI 의존성: 현재 사용자 추출 ──────────────────────

def get_current_user(token: str = Depends(oauth2_scheme)) -> UserInfo:
    exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="인증이 필요합니다. 다시 로그인해주세요.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str | None = payload.get("sub")
        username: str | None = payload.get("username")
        if not user_id or not username:
            raise exc
    except JWTError:
        raise exc
    return UserInfo(id=user_id, username=username)


# 모듈 import 시 DB 초기화
init_users_db()
