"""테스트 공통 픽스처.

핵심 원칙 두 가지.

1. 테스트는 사용자의 실제 DB(db/)와 문서(data/docs/)를 절대 건드리지 않는다.
2. 테스트는 실제 LLM 을 호출하지 않는다. 느리고(호출당 약 3.5초), 결과가
   비결정적이라 단언을 쓸 수 없으며, CI 에는 인증 자체가 없다.
"""
from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def clear_rag_caches():
    """테스트 간 캐시 오염을 막는다.

    rag 모듈의 LRU 캐시는 모듈 전역이라 테스트끼리 상태를 공유한다.
    이걸 비우지 않으면 단독 실행은 통과하고 전체 실행만 깨지는,
    가장 디버깅하기 어려운 종류의 실패가 난다.
    """
    from backend.rag import clear_caches

    clear_caches()
    yield
    clear_caches()


@pytest.fixture
def temp_users_db(tmp_path, monkeypatch):
    """users.db 를 임시 경로로 격리한 auth 모듈을 준다."""
    import backend.auth as auth

    monkeypatch.setattr(auth, "USERS_DB_PATH", tmp_path / "users.db")
    auth.init_users_db()
    return auth


class FakeLLM:
    """llm.chat 을 대체하는 스텁. 호출 내역을 기록한다.

    calls 를 들여다보면 "LLM 을 몇 번, 어떤 프롬프트로 불렀는가"를
    단언할 수 있다. 캐시 적중 여부 검증에 특히 유용하다.
    """

    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.reply = "stub response"

    def chat(self, model=None, messages=None, stream=False, options=None):
        self.calls.append({"model": model, "messages": messages, "options": options})
        if stream:
            return iter([{"message": {"content": self.reply}}])
        return {"message": {"content": self.reply}}

    @property
    def call_count(self) -> int:
        return len(self.calls)

    def last_prompt(self) -> str:
        """가장 최근 호출의 user 메시지 본문."""
        if not self.calls:
            raise AssertionError("LLM 이 한 번도 호출되지 않았습니다.")
        return self.calls[-1]["messages"][-1]["content"]


@pytest.fixture
def fake_llm(monkeypatch):
    """rag 모듈이 보는 llm.chat 을 가로챈다."""
    import backend.rag as rag

    fake = FakeLLM()
    monkeypatch.setattr(rag.llm, "chat", fake.chat)
    return fake


@pytest.fixture
def make_hit():
    """검색 결과(hit) dict 를 만드는 헬퍼.

    retrieve_context 가 돌려주는 모양을 그대로 흉내내서,
    ChromaDB 없이 순수 함수만 테스트할 수 있게 한다.
    """
    def _make(chunk_index: int, *, source: str = "doc.txt",
              score: float = 0.9, document: str = "본문") -> dict:
        return {
            "source": source,
            "chunk_index": chunk_index,
            "score": score,
            "document": document,
        }

    return _make
