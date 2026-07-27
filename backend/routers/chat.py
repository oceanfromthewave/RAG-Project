from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from backend.core.background import submit_background
from backend.core.security import ask_limiter
from backend.schemas import Question
from backend.services import llm
from backend.services.auth import UserInfo, get_current_user
from backend.services.history import (
    add_message,
    create_session,
    get_session_owner,
    update_session_title,
)
from backend.services.rag import (
    NO_CONTEXT_ANSWER,
    RELEVANCE_THRESHOLD,
    _get_content,
    ask_rag,
    ask_rag_stream,
    generate_session_title,
    should_retrieve,
)
from backend.services.store import CHAT_MODEL_NAME, list_indexed_sources, normalize_source_name

logger = logging.getLogger("security")

router = APIRouter(tags=["chat"])

# 새 세션 임시 제목으로 쓸 질문 미리보기 길이(자동 제목 생성 전까지 표시).
SESSION_TITLE_PREVIEW_LEN = 30


def sanitize_selected_sources(selected_files: list[str], user_id: str) -> list[str]:
    try:
        normalized = [normalize_source_name(name) for name in selected_files]
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"잘못된 파일명입니다: {e}") from e
    allowed = set(list_indexed_sources(user_id=user_id))
    missing = [name for name in normalized if name not in allowed]
    if missing:
        raise HTTPException(status_code=400, detail=f"Unknown selected file: {missing[0]}")
    return normalized


def resolve_session(question: Question, user_id: str) -> tuple[str, bool]:
    """세션 ID를 확정하고 신규 여부를 돌려준다.

    기존 세션이면 소유권을 확인하고, 없으면 질문 앞부분을 제목으로 새로 만든다.
    ask / ask_stream 이 공유하던 중복 로직을 한곳으로 모은다.
    """
    if question.session_id:
        owner = get_session_owner(question.session_id)
        if owner is None:
            raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")
        if owner != user_id:
            raise HTTPException(status_code=403, detail="이 세션에 접근할 권한이 없습니다.")
        return question.session_id, False

    title = (
        question.query[:SESSION_TITLE_PREVIEW_LEN] + "..."
        if len(question.query) > SESSION_TITLE_PREVIEW_LEN
        else question.query
    )
    session_id = create_session(
        title=title, model=question.model,
        user_id=user_id, workspace_id=question.workspace_id,
    )
    return session_id, True


# ── 채팅 엔드포인트 ────────────────────────────────────────

@router.post("/ask")
def ask(request: Request, question: Question, current_user: UserInfo = Depends(get_current_user)):
    ask_limiter.check(request)
    history_dicts = [m.model_dump() for m in question.history] if question.history else []
    selected_sources = sanitize_selected_sources(question.selected_files, current_user.id)

    current_session_id, _ = resolve_session(question, current_user.id)

    add_message(current_session_id, "user", question.query)

    if not should_retrieve(question.query):
        res = llm.chat(
            model=question.model or CHAT_MODEL_NAME,
            messages=[{"role": "user", "content": question.query}]
        )
        result = {"answer": _get_content(res), "context": "", "sources": [], "score": 0.0}
    else:
        result = ask_rag(
            question.query, model=question.model,
            history=history_dicts, user_id=current_user.id,
            selected_sources=selected_sources
        )

    add_message(
        current_session_id, "assistant", result["answer"],
        sources=result["sources"], context=result["context"], score=result["score"],
    )
    result["session_id"] = current_session_id
    return result


@router.post("/ask-stream")
def ask_stream(request: Request, question: Question, current_user: UserInfo = Depends(get_current_user)):
    ask_limiter.check(request)
    history_dicts = [m.model_dump() for m in question.history] if question.history else []
    selected_sources = sanitize_selected_sources(question.selected_files, current_user.id)

    current_session_id, is_new_session = resolve_session(question, current_user.id)

    add_message(current_session_id, "user", question.query)

    def generator():
        if is_new_session:
            yield json.dumps({"type": "session", "session_id": current_session_id}, ensure_ascii=False) + "\n"

        full_answer = ""
        meta = None
        message_saved = False
        error_message = None

        try:
            for event in ask_rag_stream(
                    question.query, model=question.model,
                    history=history_dicts, user_id=current_user.id,
                    selected_sources=selected_sources
            ):
                if event["type"] == "chunk":
                    full_answer += event["content"]
                elif event["type"] == "meta":
                    meta = event
                yield json.dumps(event, ensure_ascii=False) + "\n"

            if full_answer.strip() or meta:
                final_content = full_answer
                if not final_content.strip():
                    if meta and meta.get("score", 0) < RELEVANCE_THRESHOLD:
                        final_content = NO_CONTEXT_ANSWER
                    else:
                        final_content = "답변 생성 중 오류가 발생했습니다."

                msg_id = add_message(
                    current_session_id, role="assistant", content=final_content,
                    sources=meta.get("sources") if meta else [],
                    context=meta.get("context") if meta else "",
                    score=meta.get("score") if meta else 0.0,
                )
                message_saved = True
                yield json.dumps({"type": "message_id", "id": msg_id}, ensure_ascii=False) + "\n"

                if is_new_session and final_content.strip() and len(final_content) > 30:
                    _sid = current_session_id
                    _query = question.query
                    _model = question.model
                    _fc = final_content

                    def _gen_title_bg():
                        try:
                            auto_title = generate_session_title(_query, _fc, model=_model)
                            if auto_title:
                                update_session_title(_sid, auto_title)
                        except Exception:
                            logger.warning("자동 제목 생성 실패", exc_info=True)

                    submit_background(_gen_title_bg)

        except Exception:
            # 예외를 로그만 남기고 삼키면 클라이언트는 스트림이 이유 없이 끊긴 것으로 본다.
            # NDJSON error 이벤트로 명시적으로 알린다.
            logger.exception("스트림 생성 오류")
            error_message = "답변 생성 중 오류가 발생했습니다."
            yield json.dumps(
                {"type": "error", "message": error_message},
                ensure_ascii=False,
            ) + "\n"

        finally:
            # 초기 스트림 실패 시 full_answer·meta가 모두 비어도, 오류가 있었다면
            # 사용자 질문만 남고 답변이 없는 상태를 막기 위해 오류 메시지를 저장한다.
            if not message_saved and (full_answer.strip() or meta or error_message):
                final_content = full_answer
                if not final_content.strip():
                    if meta and meta.get("score", 0) < RELEVANCE_THRESHOLD:
                        final_content = NO_CONTEXT_ANSWER
                    elif error_message:
                        final_content = f"⚠️ {error_message}"
                    else:
                        final_content = "답변 생성 중 세션이 전환되어 중단되었습니다."

                add_message(
                    current_session_id, role="assistant", content=final_content,
                    sources=meta.get("sources") if meta else [],
                    context=meta.get("context") if meta else "",
                    score=meta.get("score") if meta else 0.0,
                )

    return StreamingResponse(generator(), media_type="application/x-ndjson")
