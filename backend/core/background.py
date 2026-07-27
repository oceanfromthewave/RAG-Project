"""제한된 공용 워커 풀에서 부가 백그라운드 작업을 실행한다.

문서 요약·세션 제목 생성은 사용자 응답 경로 밖에서 도는 부가 기능이다.
과거에는 요청마다 daemon 스레드를 무제한 띄워, 업로드가 몰리면 동시 LLM
호출과 스레드 수가 함께 폭증했다. 여기서는 **고정 개수의 daemon 워커 +
유한 큐**로 동시 실행 수와 대기열을 모두 제한하고, 큐가 차면 작업을 버리고
경고만 남긴다(요약/제목은 유실돼도 핵심 기능에 지장 없음).

워커를 daemon 으로 두는 이유: 멈춘 LLM 호출이 인터프리터 종료를 무한정
막지 못하게 하기 위함이다.
"""
from __future__ import annotations

import logging
import queue
import threading
from typing import Any, Callable

from backend.config import BG_MAX_QUEUE, BG_MAX_WORKERS

logger = logging.getLogger("security")

_WORKERS = max(1, BG_MAX_WORKERS)
_QUEUE_SIZE = max(1, BG_MAX_QUEUE)

_Job = tuple[Callable[..., Any], tuple[Any, ...], dict[str, Any]]

_lock = threading.Lock()
_queue: queue.Queue[_Job] = queue.Queue(maxsize=_QUEUE_SIZE)
_workers: list[threading.Thread] = []
_started = False
_shutdown = False


def _worker_loop() -> None:
    while True:
        fn, args, kwargs = _queue.get()
        try:
            fn(*args, **kwargs)
        except Exception:
            # 워커는 절대 죽으면 안 된다 — 죽으면 풀이 영구히 줄어든다. 그래서
            # 한 작업의 실패는 로깅 후 삼킨다. 요약/제목은 best-effort 라
            # 재시도하지 않는다(관측은 exc_info 로그로 충분).
            logger.warning(
                "백그라운드 작업 실행 실패 — %s",
                getattr(fn, "__name__", repr(fn)),
                exc_info=True,
            )
        finally:
            _queue.task_done()


def _ensure_started_locked() -> None:
    """daemon 워커들을 지연 기동한다(첫 제출 시 1회). 호출자가 _lock 을 보유해야 한다."""
    global _started
    if not _started:
        for i in range(_WORKERS):
            t = threading.Thread(target=_worker_loop, name=f"bg-{i}", daemon=True)
            t.start()
            _workers.append(t)
        _started = True


def submit_background(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> bool:
    """제한된 백그라운드 워커에 작업을 제출한다.

    종료됐거나 대기열이 가득 차면 작업을 버리고 ``False``, 성공 시 ``True``.
    ``_shutdown`` 검사와 큐 삽입을 같은 ``_lock`` 으로 묶어, 종료와 경합하는
    제출도 확실히 거절된다(종료 후 워커 기동/큐 삽입 불가).
    """
    with _lock:
        if _shutdown:
            logger.warning("백그라운드 종료 상태 — %s 거절", getattr(fn, "__name__", repr(fn)))
            return False
        _ensure_started_locked()
        try:
            _queue.put_nowait((fn, args, kwargs))
        except queue.Full:
            logger.warning("백그라운드 작업 포화 — %s 건너뜀", getattr(fn, "__name__", repr(fn)))
            return False
        else:
            return True


def shutdown_background() -> None:
    """앱 종료 시 이후 제출을 영구 거절하고 대기 중인 작업을 비운다.

    ``_shutdown`` 은 한 번 켜지면 꺼지지 않으므로 종료와 경합하는 제출도
    새 풀을 만들지 못한다. 대기열에 남은(아직 워커가 집지 않은) 작업은
    ``get_nowait()`` 로 비운다. 이미 실행 중인 작업은 취소하지 못하지만,
    워커가 daemon 이라 프로세스와 함께 사라진다(멈춘 LLM 호출이 종료를
    막지 않게).
    """
    global _shutdown
    with _lock:
        _shutdown = True
        while True:
            try:
                _queue.get_nowait()
            except queue.Empty:
                break
            else:
                _queue.task_done()
