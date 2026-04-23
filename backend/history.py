from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from backend.store import DB_DIR

HISTORY_DB_PATH = DB_DIR / "history.db"


def init_db():
    DB_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(HISTORY_DB_PATH) as conn:
        cursor = conn.cursor()
        
        # Sessions table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                model TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        
        # Messages table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                sources TEXT,
                context TEXT,
                score REAL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
            )
        """)
        conn.commit()


def create_session(title: str = "New Chat", model: str | None = None) -> str:
    session_id = str(uuid4())
    now = datetime.now().isoformat()
    with sqlite3.connect(HISTORY_DB_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO sessions (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (session_id, title, model, now, now)
        )
        conn.commit()
    return session_id


def get_sessions() -> list[dict]:
    with sqlite3.connect(HISTORY_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM sessions ORDER BY updated_at DESC")
        return [dict(row) for row in cursor.fetchall()]


def get_session_messages(session_id: str) -> list[dict]:
    with sqlite3.connect(HISTORY_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC", (session_id,))
        messages = []
        for row in cursor.fetchall():
            m = dict(row)
            if m["sources"]:
                m["sources"] = json.loads(m["sources"])
            messages.append(m)
        return messages


def add_message(session_id: str, role: str, content: str, sources: list | None = None, context: str | None = None, score: float | None = None):
    message_id = str(uuid4())
    now = datetime.now().isoformat()
    sources_json = json.dumps(sources) if sources else None
    
    with sqlite3.connect(HISTORY_DB_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO messages (id, session_id, role, content, sources, context, score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (message_id, session_id, role, content, sources_json, context, score, now)
        )
        # Update session updated_at
        cursor.execute("UPDATE sessions SET updated_at = ? WHERE id = ?", (now, session_id))
        conn.commit()
    return message_id


def delete_session(session_id: str):
    with sqlite3.connect(HISTORY_DB_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        conn.commit()


def update_session_title(session_id: str, title: str):
    with sqlite3.connect(HISTORY_DB_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE sessions SET title = ? WHERE id = ?", (title, session_id))
        conn.commit()


# Initialize on import
init_db()
