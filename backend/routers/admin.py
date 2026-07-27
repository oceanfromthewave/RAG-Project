from __future__ import annotations

import shutil
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.schemas import RoleUpdate
from backend.services.auth import USERS_DB_PATH, UserInfo, get_current_admin, get_user_by_id, update_user_role
from backend.services.history import HISTORY_DB_PATH, delete_user_history
from backend.services.rag import clear_caches, embedding_cache, query_cache, retrieval_cache, rewrite_cache
from backend.services.store import DATA_DIR, delete_source, get_collection, list_indexed_sources

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users")
def list_all_users(admin: UserInfo = Depends(get_current_admin)):
    with sqlite3.connect(USERS_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT id, username, is_admin, created_at FROM users").fetchall()
        return [dict(r) for r in rows]


@router.get("/users/{user_id}/role")
def get_user_role(user_id: str, admin: UserInfo = Depends(get_current_admin)):
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    return {"is_admin": user["is_admin"]}


@router.patch("/users/{user_id}/role")
def change_user_role(user_id: str, body: RoleUpdate, admin: UserInfo = Depends(get_current_admin)):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="자기 자신의 권한은 변경할 수 없습니다.")
    success = update_user_role(user_id, body.is_admin)
    if not success:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    return {"message": f"권한이 {'관리자로 변경' if body.is_admin else '일반 사용자로 변경'}되었습니다."}


@router.get("/stats/global")
def get_global_stats(admin: UserInfo = Depends(get_current_admin)):
    collection = get_collection()
    total_docs = collection.count()
    with sqlite3.connect(USERS_DB_PATH) as conn:
        user_count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    return {"total_users": user_count, "total_chunks_in_db": total_docs, "server_status": "healthy"}


@router.delete("/users/{user_id}")
def delete_user_account(user_id: str, admin: UserInfo = Depends(get_current_admin)):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="자기 자신은 삭제할 수 없습니다.")
    # 파괴적 삭제(rmtree) 전에 반드시 존재 여부를 먼저 검증한다.
    # 정규화되지 않은 id("../" 등)로 엉뚱한 디렉터리를 지우는 것을 막는다.
    if not get_user_by_id(user_id):
        raise HTTPException(status_code=404, detail="존재하지 않는 사용자입니다.")
    # 경로를 파괴적 작업 시작 전에 검증한다. 안전하지 않으면(정규화 실패·경로 이탈·
    # 심볼릭 링크) 소스/디렉터리/DB 삭제를 하나도 진행하지 않고 중단한다.
    data_root = DATA_DIR.resolve()
    raw_user_dir = DATA_DIR / user_id
    # resolve() 는 링크를 따라가므로, 원본 경로가 링크이면(다른 사용자/시스템
    # 디렉터리를 가리킬 수 있음) resolve 전에 먼저 거부한다.
    if raw_user_dir.is_symlink():
        raise HTTPException(status_code=400, detail="잘못된 사용자 경로입니다.")
    user_data_dir = raw_user_dir.resolve()
    # DATA_DIR 의 직접 하위 디렉터리만 허용한다(중첩 경로·상위 이탈 차단).
    if user_data_dir.parent != data_root:
        raise HTTPException(status_code=400, detail="잘못된 사용자 경로입니다.")
    for source in list_indexed_sources(user_id=user_id):
        delete_source(source, user_id=user_id)
    if user_data_dir.exists():
        shutil.rmtree(user_data_dir)
    delete_user_history(user_id)  # document_summaries도 함께 삭제됨
    clear_caches()
    with sqlite3.connect(USERS_DB_PATH) as conn:
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()
    return {"message": "사용자가 삭제되었습니다."}


@router.get("/cache-stats")
def get_cache_stats(admin: UserInfo = Depends(get_current_admin)):
    """LRU 캐시 크기 및 상태 모니터링."""
    return {
        "query_cache": len(query_cache),
        "rewrite_cache": len(rewrite_cache),
        "embedding_cache": len(embedding_cache),
        "retrieval_cache": len(retrieval_cache),
    }


@router.get("/logs")
def get_activity_logs(
        user_id: str | None = Query(None),
        role: str | None = Query(None),
        limit: int = Query(100, ge=1, le=500),
        admin: UserInfo = Depends(get_current_admin)
):
    user_map = {}
    with sqlite3.connect(USERS_DB_PATH) as u_conn:
        u_conn.row_factory = sqlite3.Row
        users = u_conn.execute("SELECT id, username FROM users").fetchall()
        for u in users:
            user_map[u["id"]] = u["username"]

    with sqlite3.connect(HISTORY_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        query = """
            SELECT m.id, m.role, m.content, m.feedback, m.score, m.created_at, s.user_id, s.title as session_title
            FROM messages m
            JOIN sessions s ON m.session_id = s.id
            WHERE 1=1
        """
        params = []
        if user_id:
            matched_ids = [uid for uid, uname in user_map.items() if user_id.lower() in uname.lower()]
            if matched_ids:
                placeholders = ",".join(["?"] * len(matched_ids))
                query += f" AND s.user_id IN ({placeholders})"
                params.extend(matched_ids)
            else:
                query += " AND s.user_id = 'none'"
        if role:
            if role not in {"user", "assistant"}:
                raise HTTPException(status_code=400, detail="Invalid role filter.")
            query += " AND m.role = ?"
            params.append(role)
        query += " ORDER BY m.created_at DESC LIMIT ?"
        params.append(limit)
        logs = conn.execute(query, params).fetchall()

    result = []
    for log in logs:
        d = dict(log)
        d["username"] = user_map.get(d["user_id"], "Unknown")
        result.append(d)
    return result
