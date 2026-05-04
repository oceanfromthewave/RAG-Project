from __future__ import annotations

import os
import time
from collections import defaultdict
from threading import Lock

from fastapi import HTTPException, Request, status

TRUST_PROXY_HEADERS = os.getenv("TRUST_PROXY_HEADERS", "false").lower() == "true"


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


class LoginGuard:
    def __init__(self):
        self._failures: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()

    @staticmethod
    def _key(username: str, ip: str) -> str:
        return f"{username.strip().lower()}::{ip}"

    def check(self, username: str, ip: str) -> None:
        key = self._key(username, ip)
        now = time.monotonic()

        with self._lock:
            self._failures[key] = [
                t for t in self._failures[key] if now - t < _LOCKOUT_SECONDS
            ]
            if len(self._failures[key]) >= _MAX_FAILURES:
                oldest = min(self._failures[key])
                wait = max(1, int(_LOCKOUT_SECONDS - (now - oldest)))
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many failed login attempts. Please try again later.",
                    headers={"Retry-After": str(wait)},
                )

    def record_failure(self, username: str, ip: str) -> None:
        key = self._key(username, ip)
        with self._lock:
            self._failures[key].append(time.monotonic())

    def clear(self, username: str, ip: str) -> None:
        key = self._key(username, ip)
        with self._lock:
            self._failures.pop(key, None)


login_limiter = RateLimiter(max_requests=10, window_seconds=60)
register_limiter = RateLimiter(max_requests=5, window_seconds=300)
ask_limiter = RateLimiter(max_requests=30, window_seconds=60)
upload_limiter = RateLimiter(max_requests=10, window_seconds=300)
login_guard = LoginGuard()
