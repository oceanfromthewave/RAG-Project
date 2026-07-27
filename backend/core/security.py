from __future__ import annotations

import os
import sqlite3
import time
from collections import defaultdict
from threading import Lock

from fastapi import HTTPException, Request, status

from backend.services.store import DB_DIR

TRUST_PROXY_HEADERS = os.getenv("TRUST_PROXY_HEADERS", "false").lower() == "true"

LOGIN_GUARD_DB_PATH = DB_DIR / "login_guard.db"


def get_client_ip(request: Request) -> str:
    if TRUST_PROXY_HEADERS:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()[:64]

    return request.client.host if request.client else "unknown"


class RateLimiter:
    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._store: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()

    def check(self, request: Request, key_suffix: str = "") -> None:
        ip = get_client_ip(request)
        key = f"{ip}:{key_suffix}" if key_suffix else ip
        now = time.monotonic()
        cutoff = now - self.window_seconds

        with self._lock:
            self._store[key] = [t for t in self._store[key] if t > cutoff]
            if len(self._store[key]) >= self.max_requests:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many requests. Please try again later.",
                    headers={"Retry-After": str(self.window_seconds)},
                )
            self._store[key].append(now)


_MAX_FAILURES = 5
_LOCKOUT_SECONDS = 900


def _init_login_guard_db() -> None:
    DB_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(LOGIN_GUARD_DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS login_failures (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                guard_key  TEXT    NOT NULL,
                failed_at  REAL   NOT NULL
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_login_failures_key
            ON login_failures (guard_key, failed_at)
        """)
        conn.commit()


class LoginGuard:
    """Brute-force 방어: 로그인 실패 기록을 SQLite에 영속화한다."""

    def __init__(self):
        self._lock = Lock()
        _init_login_guard_db()

    @staticmethod
    def _key(username: str, ip: str) -> str:
        return f"{username.strip().lower()}::{ip}"

    def check(self, username: str, ip: str) -> None:
        key = self._key(username, ip)
        cutoff = time.time() - _LOCKOUT_SECONDS

        with self._lock:
            with sqlite3.connect(LOGIN_GUARD_DB_PATH) as conn:
                # 만료된 레코드 정리
                conn.execute(
                    "DELETE FROM login_failures WHERE guard_key = ? AND failed_at < ?",
                    (key, cutoff),
                )
                row = conn.execute(
                    "SELECT COUNT(*), MIN(failed_at) FROM login_failures WHERE guard_key = ? AND failed_at >= ?",
                    (key, cutoff),
                ).fetchone()
                count = row[0] or 0
                oldest = row[1]

            if count >= _MAX_FAILURES:
                wait = max(1, int(_LOCKOUT_SECONDS - (time.time() - oldest)))
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many failed login attempts. Please try again later.",
                    headers={"Retry-After": str(wait)},
                )

    def record_failure(self, username: str, ip: str) -> None:
        key = self._key(username, ip)
        with self._lock:
            with sqlite3.connect(LOGIN_GUARD_DB_PATH) as conn:
                conn.execute(
                    "INSERT INTO login_failures (guard_key, failed_at) VALUES (?, ?)",
                    (key, time.time()),
                )
                conn.commit()

    def clear(self, username: str, ip: str) -> None:
        key = self._key(username, ip)
        with self._lock:
            with sqlite3.connect(LOGIN_GUARD_DB_PATH) as conn:
                conn.execute(
                    "DELETE FROM login_failures WHERE guard_key = ?", (key,)
                )
                conn.commit()


login_limiter = RateLimiter(max_requests=10, window_seconds=60)
register_limiter = RateLimiter(max_requests=5, window_seconds=300)
ask_limiter = RateLimiter(max_requests=30, window_seconds=60)
upload_limiter = RateLimiter(max_requests=10, window_seconds=300)
login_guard = LoginGuard()
models_limiter = RateLimiter(max_requests=30, window_seconds=60)
