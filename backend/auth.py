from __future__ import annotations

import os
import re
import secrets
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

APP_ENV = os.getenv("APP_ENV", os.getenv("NODE_ENV", "development")).lower()
_SECRET_FROM_ENV = os.getenv("JWT_SECRET_KEY")
_DEFAULT_SECRET = secrets.token_urlsafe(32)

if APP_ENV in {"prod", "production"} and not _SECRET_FROM_ENV:
    raise RuntimeError("JWT_SECRET_KEY must be set in production.")

SECRET_KEY = _SECRET_FROM_ENV or _DEFAULT_SECRET
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))
JWT_ISSUER = os.getenv("JWT_ISSUER", "rag-project")
MIN_PASSWORD_LENGTH = int(os.getenv("MIN_PASSWORD_LENGTH", "12"))
MAX_PASSWORD_LENGTH = 72
USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{3,32}$")

pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto",
    bcrypt__truncate_error=True,
)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


class UserCreate(BaseModel):
    username: str
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str
    username: str
    is_admin: bool


class UserInfo(BaseModel):
    id: str
    username: str
    is_admin: bool


def init_users_db() -> None:
    DB_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(USERS_DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id              TEXT PRIMARY KEY,
                username        TEXT UNIQUE NOT NULL,
                hashed_password TEXT NOT NULL,
                is_admin        INTEGER NOT NULL DEFAULT 0,
                created_at      TEXT NOT NULL
            )
        """)
        cursor = conn.cursor()
        existing_cols = {row[1] for row in cursor.execute("PRAGMA table_info(users)")}
        if "is_admin" not in existing_cols:
            cursor.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
        conn.commit()


def _row_to_user(row: sqlite3.Row | None) -> dict | None:
    if not row:
        return None
    user = dict(row)
    user["is_admin"] = bool(user["is_admin"])
    return user


def validate_username(username: str) -> str:
    normalized = username.strip().lower()
    if not USERNAME_RE.fullmatch(normalized):
        raise ValueError(
            "Username must be 3-32 characters and use only letters, numbers, dots, underscores, or hyphens."
        )
    return normalized


def validate_password(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
    if len(password) > MAX_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at most {MAX_PASSWORD_LENGTH} characters.")
    if password.strip() != password:
        raise ValueError("Password cannot start or end with whitespace.")
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        raise ValueError("Password must include at least one letter and one number.")


def count_users() -> int:
    with sqlite3.connect(USERS_DB_PATH) as conn:
        return conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]


def get_user_by_username(username: str) -> dict | None:
    with sqlite3.connect(USERS_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM users WHERE username = ?",
            (username.strip().lower(),),
        ).fetchone()
        return _row_to_user(row)


def get_user_by_id(user_id: str) -> dict | None:
    with sqlite3.connect(USERS_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        return _row_to_user(row)


def create_user(username: str, password: str) -> dict:
    username = validate_username(username)
    validate_password(password)
    if get_user_by_username(username):
        raise ValueError("Username is already in use.")

    user_id = str(uuid4())
    now = datetime.now(timezone.utc).isoformat()
    hashed = pwd_context.hash(password)
    with sqlite3.connect(USERS_DB_PATH) as conn:
        conn.execute(
            "INSERT INTO users (id, username, hashed_password, is_admin, created_at) VALUES (?, ?, ?, 0, ?)",
            (user_id, username, hashed, now),
        )
        conn.commit()

    return {"id": user_id, "username": username, "is_admin": False}


def update_user_role(user_id: str, is_admin: bool) -> bool:
    with sqlite3.connect(USERS_DB_PATH) as conn:
        cursor = conn.execute(
            "UPDATE users SET is_admin = ? WHERE id = ?",
            (1 if is_admin else 0, user_id),
        )
        conn.commit()
        return cursor.rowcount > 0


def change_password(user_id: str, old_password: str, new_password: str) -> None:
    validate_password(new_password)
    if old_password == new_password:
        raise ValueError("New password must be different from the current password.")

    with sqlite3.connect(USERS_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT hashed_password FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not row:
            raise ValueError("User not found.")
        if not verify_password(old_password, row["hashed_password"]):
            raise ValueError("Current password is incorrect.")

        conn.execute(
            "UPDATE users SET hashed_password = ? WHERE id = ?",
            (pwd_context.hash(new_password), user_id),
        )
        conn.commit()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return pwd_context.verify(plain, hashed)
    except ValueError:
        return False


def create_access_token(user_id: str, username: str, is_admin: bool) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": user_id,
        "username": username,
        "is_admin": is_admin,
        "iat": now,
        "exp": expire,
        "iss": JWT_ISSUER,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(token: str = Depends(oauth2_scheme)) -> UserInfo:
    exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication is required. Please sign in again.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str | None = payload.get("sub")
        username: str | None = payload.get("username")
        if payload.get("iss") != JWT_ISSUER or not user_id or not username:
            raise exc
    except JWTError:
        raise exc

    user = get_user_by_id(user_id)
    if not user or user["username"] != username:
        raise exc

    return UserInfo(id=user["id"], username=user["username"], is_admin=user["is_admin"])


def get_current_admin(current_user: UserInfo = Depends(get_current_user)) -> UserInfo:
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges are required.",
        )
    return current_user


init_users_db()
