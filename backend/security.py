"""
인메모리 보안 유틸리티
- 슬라이딩 윈도우 IP 기반 속도 제한
- 로그인 실패 계정 잠금
"""
from __future__ import annotations

import time
from collections import defaultdict
from threading import Lock

from fastapi import HTTPException, Request, status


# ── 슬라이딩 윈도우 속도 제한 ──────────────────────────────

class RateLimiter:
    """
    window_seconds 내에 max_requests 초과 시 429 반환.
    X-Forwarded-For 헤더를 우선 사용하고, 없으면 직접 연결 IP 사용.
    """

    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._store: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()

    def _extract_ip(self, request: Request) -> str:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    def check(self, request: Request) -> None:
        key = self._extract_ip(request)
        now = time.monotonic()
        cutoff = now - self.window_seconds

        with self._lock:
            self._store[key] = [t for t in self._store[key] if t > cutoff]
            if len(self._store[key]) >= self.max_requests:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"요청이 너무 많습니다. {self.window_seconds}초 후 다시 시도해주세요.",
                    headers={"Retry-After": str(self.window_seconds)},
                )
            self._store[key].append(now)


# 엔드포인트별 속도 제한 인스턴스
# 로그인: 1분에 10회, 회원가입: 5분에 5회
login_limiter    = RateLimiter(max_requests=10, window_seconds=60)
register_limiter = RateLimiter(max_requests=5,  window_seconds=300)


# ── 로그인 실패 계정 잠금 ──────────────────────────────────

_MAX_FAILURES    = 5     # 최대 실패 허용 횟수
_LOCKOUT_SECONDS = 900   # 잠금 지속 시간: 15분


class LoginGuard:
    """
    사용자명 + IP 조합으로 실패를 추적하고,
    _MAX_FAILURES 초과 시 _LOCKOUT_SECONDS 동안 잠급니다.
    성공 로그인 시 실패 기록을 초기화합니다.
    """

    def __init__(self):
        self._failures: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()

    @staticmethod
    def _key(username: str, ip: str) -> str:
        return f"{username.lower()}::{ip}"

    def check(self, username: str, ip: str) -> None:
        key = self._key(username, ip)
        now = time.monotonic()

        with self._lock:
            # 잠금 기간이 지난 기록 제거
            self._failures[key] = [
                t for t in self._failures[key] if now - t < _LOCKOUT_SECONDS
            ]
            count = len(self._failures[key])
            if count >= _MAX_FAILURES:
                oldest = min(self._failures[key])
                wait = int(_LOCKOUT_SECONDS - (now - oldest))
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"로그인 시도가 너무 많습니다. {wait}초 후에 다시 시도해주세요.",
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


login_guard = LoginGuard()


# ── 공통 유틸 ──────────────────────────────────────────────

def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
