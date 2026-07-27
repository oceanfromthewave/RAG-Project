"""제한된 공용 스레드풀에서 부가 백그라운드 작업을 실행한다.

문서 요약·세션 제목 생성은 사용자 응답 경로 밖에서 도는 부가 기능이다.
과거에는 요청마다 daemon 스레드를 무제한 띄워, 업로드가 몰리면 동시 LLM
호출과 스레드 수가 함께 폭증했다. 고정 크기 스레드풀 + 세마포어로 동시 실행
수와 대기열을 모두 제한하고, 포화 시 작업을 버리고 경고만 남긴다.
"""
from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

from backend.config import BG_MAX_QUEUE, BG_MAX_WORKERS

logger = logging.getLogger("security")

# 총 수용량 = 동시 실행(worker) + 대기열(queue).
_CAPACITY = max(1, BG_MAX_WORKERS) + max(0, BG_MAX_QUEUE)

_lock = threading.Lock()
_executor: ThreadPoolExecutor | None = None
_slots: threading.BoundedSemaphore | None = None


def _ensure() -> tuple[ThreadPoolExecutor, threading.BoundedSemaphore]:
    """스레드풀과 세마포어를 지연 생성한다(첫 제출 시 1회)."""
    global _executor, _slots
    if _executor is None:
        with _lock:
            if _executor is None:
                _slots = threading.BoundedSemaphore(_CAPACITY)
                _executor = ThreadPoolExecutor(
                    max_workers=max(1, BG_MAX_WORKERS),
                    thread_name_prefix="bg",
                )
    assert _executor is not None and _slots is not None
    return _executor, _slots


def submit_background(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> bool:
    """제한된 스레드풀에 작업을 제출한다.

    수용량(동시 실행 + 대기열) 초과 시 작업을 버리고 False, 성공 시 True.
    """
    executor, slots = _ensure()
    if not slots.acquire(blocking=False):
        logger.warning("백그라운드 작업 포화 — %s 건너뜀", getattr(fn, "__name__", repr(fn)))
        return False

    def _wrapped() -> None:
        try:
            fn(*args, **kwargs)
        finally:
            slots.release()

    try:
        executor.submit(_wrapped)
        return True
    except RuntimeError:
        # 인터프리터/풀 종료 중이면 제출 실패. 점유한 슬롯을 되돌린다.
        slots.release()
        logger.warning("백그라운드 작업 제출 실패 — %s", getattr(fn, "__name__", repr(fn)))
        return False


def shutdown_background(wait: bool = False) -> None:
    """앱 종료 시 스레드풀 정리. 대기 중 작업은 취소, 실행 중인 것만 마치게 둔다."""
    global _executor, _slots
    with _lock:
        executor, _executor = _executor, None
        _slots = None
    if executor is not None:
        executor.shutdown(wait=wait, cancel_futures=True)
