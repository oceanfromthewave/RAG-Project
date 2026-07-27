from __future__ import annotations

import json
import logging
import threading

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

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


def sanitize_selected_sources(selected_files: list[str], user_id: str) -> list[str]:
    normalized = [normalize_source_name(name) for name in selected_files]
    allowed = set(list_indexed_sources(user_id=user_id))
    missing = [name for name in normalized if name not in allowed]
    if missing:
        raise HTTPException(status_code=400, detail=f"Unknown selected file: {missing[0]}")
    return normalized


# ── 채팅 엔드포인트 ────────────────────────────────────────

@router.post("/ask")
def ask(request: Request, question: Question, current_user: UserInfo = Depends(get_current_user)):
    ask_limiter.check(request)
    history_dicts = [m.model_dump() for m in question.history] if question.history else []
    selected_sources = sanitize_selected_sources(question.selected_files, current_user.id)

    current_session_id = question.session_id
    if not current_session_id:
        title = (question.query[:30] + "...") if len(question.query) > 30 else question.query
        current_session_id = create_session(
            title=title, model=question.model,
            user_id=current_user.id, workspace_id=question.workspace_id
        )
    else:
        owner = get_session_owner(current_session_id)
        if owner and owner != current_user.id:
            raise HTTPException(status_code=403, detail="이 세션에 접근할 권한이 없습니다.")

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

    current_session_id = question.session_id
    is_new_session = False

    if not current_session_id:
        temp_title = (question.query[:30] + "...") if len(question.query) > 30 else question.query
        current_session_id = create_session(
            title=temp_title, model=question.model,
            user_id=current_user.id, workspace_id=question.workspace_id
        )
        is_new_session = True
    else:
        owner = get_session_owner(current_session_id)
        if owner and owner != current_user.id:
            raise HTTPException(status_code=403, detail="이 세션에 접근할 권한이 없습니다.")

    add_message(current_session_id, "user", question.query)

    def generator():
        if is_new_session:
            yield json.dumps({"type": "session", "session_id": current_session_id}, ensure_ascii=False) + "\n"

        full_answer = ""
        meta = None
        message_saved = False

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
                        except Exception as _e:
                            logger.warning(f"자동 제목 생성 실패: {_e}")

                    threading.Thread(target=_gen_title_bg, daemon=True).start()

        except Exception as e:
            logger.error(f"스트림 생성 오류: {e}", exc_info=True)

        finally:
            if not message_saved and (full_answer.strip() or meta):
                final_content = full_answer
                if not final_content.strip():
                    if meta and meta.get("score", 0) < RELEVANCE_THRESHOLD:
                        final_content = NO_CONTEXT_ANSWER
                    else:
                        final_content = "답변 생성 중 세션이 전환되어 중단되었습니다."

                add_message(
                    current_session_id, role="assistant", content=final_content,
                    sources=meta.get("sources") if meta else [],
                    context=meta.get("context") if meta else "",
                    score=meta.get("score") if meta else 0.0,
                )

    return StreamingResponse(generator(), media_type="application/x-ndjson")
