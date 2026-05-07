"""
ChromaDB 벡터 데이터만 초기화하는 스크립트.
history.db / users.db 는 건드리지 않습니다.

사용법:
  python reset_vectordb.py
"""
import shutil
from pathlib import Path

DB_DIR = Path(__file__).resolve().parent / "db"

def reset_chroma():
    removed = []

    # 1. chroma.sqlite3 삭제
    sqlite = DB_DIR / "chroma.sqlite3"
    if sqlite.exists():
        sqlite.unlink()
        removed.append(str(sqlite))

    # 2. UUID 형태 폴더 삭제 (HNSW 인덱스 파일들)
    import re
    uuid_re = re.compile(
        r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    for entry in DB_DIR.iterdir():
        if entry.is_dir() and uuid_re.match(entry.name):
            shutil.rmtree(entry)
            removed.append(str(entry))

    if removed:
        print("✅ 벡터 DB 초기화 완료:")
        for r in removed:
            print(f"   삭제: {r}")
    else:
        print("ℹ️  삭제할 벡터 데이터가 없습니다.")

    # 보존 확인
    preserved = [f for f in ["history.db", "users.db"] if (DB_DIR / f).exists()]
    if preserved:
        print("\n🔒 보존된 파일:")
        for f in preserved:
            print(f"   유지: {DB_DIR / f}")

    print("\n👉 이제 서버를 재시작하고 문서를 다시 업로드하세요.")

if __name__ == "__main__":
    reset_chroma()
