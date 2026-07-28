from __future__ import annotations

import os
import re
from functools import lru_cache
from hashlib import sha1
from pathlib import Path

import chromadb
from docx import Document as DocxDocument
from pypdf import PdfReader
from sentence_transformers import CrossEncoder, SentenceTransformer

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = BASE_DIR / "data" / "docs"
DB_DIR   = BASE_DIR / "db"

# ── 모델명: 환경변수로 오버라이드 가능 ──────────────────────────
# 기본값을 다국어 모델로 변경 (한국어 품질 대폭 향상)
EMBED_MODEL_NAME  = os.getenv("EMBED_MODEL_NAME",  "paraphrase-multilingual-MiniLM-L12-v2")
RERANK_MODEL_NAME = os.getenv("RERANK_MODEL_NAME", "cross-encoder/ms-marco-MiniLM-L-6-v2")
CHAT_MODEL_NAME   = os.getenv("CHAT_MODEL_NAME",   "mistral")

MAX_SOURCE_NAME_LENGTH  = int(os.getenv("MAX_SOURCE_NAME_LENGTH",  "128"))
MAX_EXTRACTED_CHARS     = int(os.getenv("MAX_EXTRACTED_CHARS",     "500000"))
MAX_PDF_PAGES           = int(os.getenv("MAX_PDF_PAGES",           "100"))
MAX_CHUNKS_PER_DOCUMENT = int(os.getenv("MAX_CHUNKS_PER_DOCUMENT", "1000"))
ALLOWED_SUFFIXES = {
    ".txt", ".pdf", ".docx", ".py", ".js", ".ts", ".jsx", ".tsx",
    ".html", ".css", ".json", ".md", ".java", ".c", ".cpp", ".h", ".go",
    ".yaml", ".yml", ".sql", ".sh", ".bash", ".png", ".jpg", ".jpeg"
}

# 모델 이름에 따라 컬렉션 이름을 다르게 가져가서 차원 충돌 방지
_model_slug    = EMBED_MODEL_NAME.split("/")[-1].replace("-", "_")
COLLECTION_NAME = f"docs_{_model_slug}_v1"


def ensure_storage_dirs():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DB_DIR.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_client():
    ensure_storage_dirs()
    return chromadb.PersistentClient(path=str(DB_DIR))


def reset_collection(client):
    try:
        client.delete_collection(COLLECTION_NAME)
    except Exception:
        pass


@lru_cache(maxsize=1)
def get_collection():
    client = get_client()
    try:
        return client.get_or_create_collection(COLLECTION_NAME)
    except Exception as e:
        print(f"[ChromaDB ERROR] 컬렉션 로드 실패 → 초기화 진행: {e}")
        reset_collection(client)
        get_collection.cache_clear()
        return client.get_or_create_collection(COLLECTION_NAME)


@lru_cache(maxsize=1)
def get_embed_model():
    return SentenceTransformer(EMBED_MODEL_NAME)


@lru_cache(maxsize=1)
def get_reranker():
    return CrossEncoder(RERANK_MODEL_NAME)


def normalize_source_name(filename: str) -> str:
    cleaned = Path(filename).name.strip()
    suffix  = Path(cleaned).suffix.lower()
    if len(cleaned) > MAX_SOURCE_NAME_LENGTH:
        raise ValueError("File name is too long.")
    if any(ord(ch) < 32 for ch in cleaned):
        raise ValueError("File name contains invalid control characters.")
    if not cleaned or cleaned in {".", ".."}:
        raise ValueError("유효한 파일명이 아닙니다.")
    if cleaned != filename.strip():
        raise ValueError("하위 경로나 비정상 파일 경로는 허용되지 않습니다.")
    if suffix not in ALLOWED_SUFFIXES:
        raise ValueError(f"{suffix} 형식은 지원되지 않습니다.")
    return cleaned


def limit_extracted_text(text: str) -> str:
    return text[:MAX_EXTRACTED_CHARS]


def read_txt(path: Path) -> str:
    for enc in ("utf-8", "cp949", "latin-1"):
        try:
            return limit_extracted_text(path.read_text(encoding=enc))
        except UnicodeDecodeError:
            continue
    return ""


def read_pdf(path: Path) -> str:
    reader = PdfReader(str(path))
    if len(reader.pages) > MAX_PDF_PAGES:
        raise ValueError(f"PDF has too many pages. Maximum allowed is {MAX_PDF_PAGES}.")
    return limit_extracted_text("".join(page.extract_text() or "" for page in reader.pages))


def read_docx(path: Path) -> str:
    doc = DocxDocument(str(path))
    return limit_extracted_text("\n".join(p.text for p in doc.paragraphs if p.text.strip()))


def read_image(path: Path) -> str:
    try:
        import ollama
        with open(path, "rb") as f:
            image_bytes = f.read()
        response = ollama.generate(
            model="llava",
            prompt="이 이미지에 포함된 모든 텍스트를 추출해서 알려줘. 텍스트가 없다면 이미지의 내용을 상세히 설명해줘. 한국어로 답변해줘.",
            images=[image_bytes],
            stream=False,
        )
        return limit_extracted_text(response.get("response", "").strip())
    except Exception as e:
        print(f"Image processing error: {e}")
        return f"[이미지 분석 실패: {path.name}]"


def read_document(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return read_pdf(path)
    if suffix == ".docx":
        return read_docx(path)
    if suffix in {".png", ".jpg", ".jpeg"}:
        return read_image(path)
    if suffix in ALLOWED_SUFFIXES:
        return read_txt(path)
    raise ValueError(f"지원하지 않는 파일 형식입니다: {suffix}")


def chunk_text(text: str, size: int = 600, overlap: int = 120) -> list[str]:
    """텍스트를 의미 있는 단위(단락, 문장)로 최대한 보존하며 분할한다."""
    if not text.strip():
        return []

    paragraphs = re.split(r'\n\s*\n', text)

    _KR_SENT_RE = re.compile(
        r'(?<=[.!?\uFF0E])\s+'
        r'|(?<=\ub2e4[.])\s+'
        r'|(?<=\uc694[.])\s+'
        r'|(?<=\uc8fc[.])\s+'
        r'|(?<=\ub2e4)\n'
        r'|(?<=\uc694)\n'
    )

    chunks: list[str] = []
    current_chunk = ""

    for p in paragraphs:
        p = p.strip()
        if not p:
            continue
        if len(p) > size:
            sentences = _KR_SENT_RE.split(p)
            merged: list[str] = []
            buf = ""
            for s in sentences:
                s = s.strip()
                if not s:
                    continue
                if buf and len(buf) + len(s) < size // 3:
                    buf = buf + " " + s
                else:
                    if buf:
                        merged.append(buf)
                    buf = s
            if buf:
                merged.append(buf)
            for s in merged:
                if len(current_chunk) + len(s) > size:
                    if current_chunk:
                        chunks.append(current_chunk.strip())
                    current_chunk = (current_chunk[-overlap:] + " " + s) if len(current_chunk) > overlap else s
                else:
                    current_chunk = (current_chunk + " " + s).strip()
        else:
            if len(current_chunk) + len(p) > size:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                current_chunk = (current_chunk[-overlap:] + " " + p) if len(current_chunk) > overlap else p
            else:
                current_chunk = (current_chunk + "\n\n" + p).strip()

    if current_chunk:
        chunks.append(current_chunk.strip())

    return [c for c in chunks if len(c) >= 40][:MAX_CHUNKS_PER_DOCUMENT]


def build_chunk_id(source: str, chunk_index: int, chunk: str) -> str:
    digest = sha1(f"{source}:{chunk_index}:{chunk}".encode("utf-8")).hexdigest()[:16]
    return f"{source}::{chunk_index}::{digest}"


def delete_source(source: str, user_id: str = "") -> int:
    collection = get_collection()
    if user_id:
        where_filter = {"$and": [{"source": source}, {"user_id": user_id}]}
    else:
        where_filter = {"source": source}
    results = collection.get(where=where_filter, include=[])
    ids = results.get("ids") or []
    if ids:
        collection.delete(ids=ids)
    return len(ids)


def list_indexed_sources(user_id: str = "") -> list[str]:
    where_filter = {"user_id": user_id} if user_id else {}
    metadatas = get_collection().get(where=where_filter, include=["metadatas"]).get("metadatas") or []
    sources = {m.get("source") for m in metadatas if m and m.get("source")}
    return sorted(sources)


def get_sources_overview(user_id: str = "") -> dict[str, dict]:
    """사용자의 모든 청크 메타데이터를 1회 조회해 소스별 청크 수·태그를 집계한다.

    파일 목록(get_files_from_db)이 소스마다 collection.get 을 호출하던 N+1 을
    단일 쿼리로 대체한다.
    """
    where_filter = {"user_id": user_id} if user_id else {}
    metadatas = get_collection().get(where=where_filter, include=["metadatas"]).get("metadatas") or []

    overview: dict[str, dict] = {}
    for meta in metadatas:
        if not meta:
            continue
        source = meta.get("source")
        if not source:
            continue
        entry = overview.get(source)
        if entry is None:
            # 태그는 소스 내 모든 청크에 동일하게 기록되므로 첫 청크에서만 파싱한다.
            tag_str = meta.get("tags") or ""
            entry = {"chunks": 0, "tags": tag_str.split(",") if tag_str else []}
            overview[source] = entry
        entry["chunks"] += 1
    return overview


def index_document(source: str, text: str, user_id: str = "") -> int:
    chunks = chunk_text(text)
    collection = get_collection()

    if not chunks:
        delete_source(source, user_id=user_id)
        return 0

    embeddings = get_embed_model().encode(chunks).tolist()
    ids = [build_chunk_id(f"{user_id}:{source}" if user_id else source, i, c) for i, c in enumerate(chunks)]
    metadatas = [{"source": source, "chunk_index": i, "user_id": user_id} for i, _ in enumerate(chunks)]

    where_filter = {"$and": [{"source": source}, {"user_id": user_id}]} if user_id else {"source": source}
    existing_ids = set(collection.get(where=where_filter, include=[]).get("ids") or [])

    collection.upsert(documents=chunks, embeddings=embeddings, ids=ids, metadatas=metadatas)

    stale_ids = sorted(existing_ids - set(ids))
    if stale_ids:
        collection.delete(ids=stale_ids)

    return len(chunks)


# ── [신규] 인접 청크 조회 ─────────────────────────────────────
def get_adjacent_chunks(source: str, chunk_index: int, user_id: str = "", window: int = 1) -> dict[int, str]:
    """특정 청크의 앞뒤 window 범위 청크를 일괄 조회한다."""
    if chunk_index < 0:
        return {}
    indices = list(range(max(0, chunk_index - window), chunk_index + window + 1))

    collection = get_collection()
    conditions: list[dict] = [{"source": source}]
    if user_id:
        conditions.append({"user_id": user_id})

    if len(indices) == 1:
        conditions.append({"chunk_index": indices[0]})
    else:
        conditions.append({"chunk_index": {"$in": indices}})

    where = {"$and": conditions} if len(conditions) > 1 else conditions[0]
    try:
        res = collection.get(where=where, include=["documents", "metadatas"])
    except Exception:
        return {}

    result: dict[int, str] = {}
    for doc, meta in zip(res.get("documents") or [], res.get("metadatas") or []):
        if doc and meta:
            idx = meta.get("chunk_index")
            if idx is not None:
                result[int(idx)] = doc
    return result
