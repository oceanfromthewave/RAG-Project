from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from uuid import uuid4

from backend.store import DB_DIR

HISTORY_DB_PATH = DB_DIR / "history.db"


def init_db():
    DB_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(HISTORY_DB_PATH) as conn:
        cursor = conn.cursor()

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS workspaces (
                id         TEXT PRIMARY KEY,
                user_id    TEXT NOT NULL,
                name       TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id           TEXT PRIMARY KEY,
                user_id      TEXT NOT NULL DEFAULT '',
                workspace_id TEXT,
                title        TEXT NOT NULL,
                model        TEXT,
                created_at   TEXT NOT NULL,
                updated_at   TEXT NOT NULL,
                FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id         TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role       TEXT NOT NULL,
                content    TEXT NOT NULL,
                sources    TEXT,
                context    TEXT,
                score      REAL,
                feedback   INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
            )
        """)

        # 기존 DB 마이그레이션
        existing_sessions_cols = {row[1] for row in cursor.execute("PRAGMA table_info(sessions)")}
        if "user_id" not in existing_sessions_cols:
            cursor.execute("ALTER TABLE sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT ''")
        if "workspace_id" not in existing_sessions_cols:
            cursor.execute("ALTER TABLE sessions ADD COLUMN workspace_id TEXT")

        existing_msg_cols = {row[1] for row in cursor.execute("PRAGMA table_info(messages)")}
        if "feedback" not in existing_msg_cols:
            cursor.execute("ALTER TABLE messages ADD COLUMN feedback INTEGER DEFAULT 0")

        conn.commit()


# ── Workspaces ────────────────────────────────────────────

def create_workspace(name: str, user_id: str) -> str:
    workspace_id = str(uuid4())
    now = datetime.now().isoformat()
    with sqlite3.connect(HISTORY_DB_PATH) as conn:
        conn.execute(
            "INSERT INTO workspaces (id, user_id, name, created_at) VALUES (?, ?, ?, ?)",
            (workspace_id, user_id, name, now),
        )
        conn.commit()
    return workspace_id


def get_workspaces(user_id: str) -> list[dict]:
    with sqlite3.connect(HISTORY_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM workspaces WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        )
        return [dict(row) for row in cursor.fetchall()]


def delete_workspace(workspace_id: str, user_id: str):
    with sqlite3.connect(HISTORY_DB_PATH) as conn:
        conn.execute(
            "DELETE FROM workspaces WHERE id = ? AND user_id = ?",
            (workspace_id, user_id),
        )
        conn.commit()


# ── Sessions ──────────────────────────────────────────────

def create_session(title: str = "New Chat", model: str | None = None, user_id: str = "", workspace_id: str | None = None) -> str:
    session_id = str(uuid4())
    now = datetime.now().isoformat()
    with sqlite3.connect(HISTORY_DB_PATH) as conn:
        conn.execute(
            "INSERT INTO sessions (id, user_id, workspace_id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (session_id, user_id, workspace_id, title, model, now, now),
        )
        conn.commit()
    return session_id


def get_sessions(user_id: str = "", workspace_id: str | None = None) -> list[dict]:
    """세션 목록 반환 - 메시지 수 포함."""
    with sqlite3.connect(HISTORY_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        if workspace_id:
            cursor.execute(
                """
                SELECT s.*, COUNT(m.id) AS message_count
                FROM sessions s
                LEFT JOIN messages m ON m.session_id = s.id
                WHERE s.user_id = ? AND s.workspace_id = ?
                GROUP BY s.id
                ORDER BY s.updated_at DESC
                """,
                (user_id, workspace_id),
            )
        else:
            cursor.execute(
                """
                SELECT s.*, COUNT(m.id) AS message_count
                FROM sessions s
                LEFT JOIN messages m ON m.session_id = s.id
                WHERE s.user_id = ? AND s.workspace_id IS NULL
                GROUP BY s.id
                ORDER BY s.updated_at DESC
                """,
                (user_id,),
            )
        return [dict(row) for row in cursor.fetchall()]


def get_session_messages(session_id: str, user_id: str = "") -> list[dict]:
    with sqlite3.connect(HISTORY_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        session = cursor.execute(
            "SELECT user_id FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if session is None:
            return []
        if user_id and session["user_id"] and session["user_id"] != user_id:
            return None
        cursor.execute(
            "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC",
            (session_id,),
        )
        messages = []
        for row in cursor.fetchall():
            m = dict(row)
            if m["sources"]:
                m["sources"] = json.loads(m["sources"])
            messages.append(m)
        return messages


def get_session_owner(session_id: str) -> str | None:
    with sqlite3.connect(HISTORY_DB_PATH) as conn:
        row = conn.execute(
            "SELECT user_id FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        return row[0] if row else None


def add_message(
    session_id: str,
    role: str,
    content: str,
    sources: list | None = None,
    context: str | None = None,
    score: float | None = None,
):
    message_id  = str(uuid4())
    now         = datetime.now().isoformat()
    sources_json = json.dumps(sources) if sources else None

    with sqlite3.connect(HISTORY_DB_PATH) as conn:
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, sources, context, score, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (message_id, session_id, role, content, sources_json, context, score, now),
        )
        conn.execute(
            "UPDATE sessions SET updated_at = ? WHERE id = ?", (now, session_id)
        )
        conn.commit()
    return message_id


def delete_session(session_id: str, user_id: str = ""):
    with sqlite3.connect(HISTORY_DB_PATH) as conn:
        if user_id:
            conn.execute(
                "DELETE FROM sessions WHERE id = ? AND user_id = ?", (session_id, user_id)
            )
        else:
            conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        conn.commit()


def delete_user_history(user_id: str) -> None:
    with sqlite3.connect(HISTORY_DB_PATH) as conn:
        conn.execute(
            "DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE user_id = ?)",
            (user_id,),
        )
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM workspaces WHERE user_id = ?", (user_id,))
        conn.commit()


def update_session_title(session_id: str, title: str, user_id: str = ""):
    with sqlite3.connect(HISTORY_DB_PATH) as conn:
        if user_id:
            conn.execute(
                "UPDATE sessions SET title = ? WHERE id = ? AND user_id = ?",
                (title, session_id, user_id),
            )
        else:
            conn.execute(
                "UPDATE sessions SET title = ? WHERE id = ?", (title, session_id)
            )
        conn.commit()


def update_message_feedback(message_id: str, feedback: int, user_id: str = ""):
    with sqlite3.connect(HISTORY_DB_PATH) as conn:
        if user_id:
            cursor = conn.execute("""
                UPDATE messages
                SET feedback = ?
                WHERE id = ? AND session_id IN (SELECT id FROM sessions WHERE user_id = ?)
            """, (feedback, message_id, user_id))
        else:
            cursor = conn.execute("UPDATE messages SET feedback = ? WHERE id = ?", (feedback, message_id))
        conn.commit()
        return cursor.rowcount > 0


# 모듈 import 시 DB 초기화
init_db()
