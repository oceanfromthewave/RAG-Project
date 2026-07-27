from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.schemas import FeedbackUpdate, SessionUpdate
from backend.services.auth import UserInfo, get_current_user
from backend.services.history import (
    HISTORY_DB_PATH,
    delete_session,
    get_session_messages,
    get_session_owner,
    get_sessions,
    update_message_feedback,
    update_session_title,
)

router = APIRouter(tags=["sessions"])


# ── 세션 엔드포인트 ────────────────────────────────────────

@router.get("/sessions/search")
def search_sessions(q: str = Query(..., min_length=1), current_user: UserInfo = Depends(get_current_user)):
    keyword = f"%{q.strip()}%"
    with sqlite3.connect(HISTORY_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("""
            SELECT DISTINCT s.id, s.title, s.updated_at, s.workspace_id,
                   substr(m.content, 1, 120) AS matched_snippet
            FROM sessions s
            JOIN messages m ON m.session_id = s.id
            WHERE s.user_id = ? AND m.content LIKE ?
            ORDER BY s.updated_at DESC LIMIT 30
        """, (current_user.id, keyword)).fetchall()
    return {"results": [dict(r) for r in rows]}


@router.get("/sessions")
def list_chat_sessions(workspace_id: str | None = Query(None), current_user: UserInfo = Depends(get_current_user)):
    return {"sessions": get_sessions(user_id=current_user.id, workspace_id=workspace_id)}


@router.get("/sessions/{session_id}")
def get_session(session_id: str, current_user: UserInfo = Depends(get_current_user)):
    messages = get_session_messages(session_id, user_id=current_user.id)
    if messages is None:
        raise HTTPException(status_code=403, detail="이 세션에 접근할 권한이 없습니다.")
    return {"messages": messages}


@router.delete("/sessions/{session_id}")
def remove_session(session_id: str, current_user: UserInfo = Depends(get_current_user)):
    owner = get_session_owner(session_id)
    if owner is None:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")
    if owner != current_user.id:
        raise HTTPException(status_code=403, detail="이 세션에 접근할 권한이 없습니다.")
    delete_session(session_id, user_id=current_user.id)
    return {"message": "Session deleted"}


@router.get("/sessions/{session_id}/title")
def get_session_title(session_id: str, current_user: UserInfo = Depends(get_current_user)):
    """세션 제목만 반환 — 프론트엔드에서 자동 생성 제목 폴링용."""
    owner = get_session_owner(session_id)
    if owner and owner != current_user.id:
        raise HTTPException(status_code=403, detail="이 세션에 접근할 권한이 없습니다.")
    with sqlite3.connect(HISTORY_DB_PATH) as conn:
        row = conn.execute(
            "SELECT title FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")
    return {"title": row[0]}


@router.patch("/sessions/{session_id}")
def rename_session(session_id: str, update: SessionUpdate, current_user: UserInfo = Depends(get_current_user)):
    owner = get_session_owner(session_id)
    if owner is None:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")
    if owner != current_user.id:
        raise HTTPException(status_code=403, detail="이 세션에 접근할 권한이 없습니다.")
    update_session_title(session_id, update.title, user_id=current_user.id)
    return {"message": "Session renamed"}


@router.post("/messages/{message_id}/feedback")
def set_message_feedback(message_id: str, body: FeedbackUpdate, current_user: UserInfo = Depends(get_current_user)):
    success = update_message_feedback(message_id, body.feedback, user_id=current_user.id)
    if not success:
        raise HTTPException(status_code=404, detail="메시지를 찾을 수 없거나 접근 권한이 없습니다.")
    return {"message": "Feedback updated"}
