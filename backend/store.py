from __future__ import annotations

from functools import lru_cache
from hashlib import sha1
from pathlib import Path

import chromadb
from pypdf import PdfReader
from sentence_transformers import CrossEncoder, SentenceTransformer

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data" / "docs"
DB_DIR = BASE_DIR / "db"
COLLECTION_NAME = "docs"

EMBED_MODEL_NAME = "BAAI/bge-m3"
RERANK_MODEL_NAME = "BAAI/bge-reranker-v2-m3"
CHAT_MODEL_NAME = "mistral"
ALLOWED_SUFFIXES = {
    ".txt", ".pdf", ".py", ".js", ".ts", ".jsx", ".tsx", 
    ".html", ".css", ".json", ".md", ".java", ".c", ".cpp", ".h", ".go"
}


def ensure_storage_dirs():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DB_DIR.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_client():
    ensure_storage_dirs()
    return chromadb.PersistentClient(path=str(DB_DIR))


@lru_cache(maxsize=1)
def get_collection():
    return get_client().get_or_create_collection(COLLECTION_NAME)


@lru_cache(maxsize=1)
def get_embed_model():
    return SentenceTransformer(EMBED_MODEL_NAME)


@lru_cache(maxsize=1)
def get_reranker():
    return CrossEncoder(RERANK_MODEL_NAME)


def normalize_source_name(filename: str) -> str:
    cleaned = Path(filename).name.strip()
    suffix = Path(cleaned).suffix.lower()

    if not cleaned or cleaned in {".", ".."}:
        raise ValueError("유효한 파일명이 아닙니다.")

    if cleaned != filename.strip():
        raise ValueError("하위 경로나 비정상 파일 경로는 허용되지 않습니다.")

    if suffix not in ALLOWED_SUFFIXES:
        raise ValueError(f"{suffix} 형식은 지원되지 않습니다.")

    return cleaned


def read_txt(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return path.read_text(encoding="latin-1")


def read_pdf(path: Path) -> str:
    reader = PdfReader(str(path))
    return "".join(page.extract_text() or "" for page in reader.pages)


def read_document(path: Path) -> str:
    suffix = path.suffix.lower()

    if suffix == ".pdf":
        return read_pdf(path)

    if suffix in ALLOWED_SUFFIXES:
        return read_txt(path)

    raise ValueError(f"지원하지 않는 파일 형식입니다: {suffix}")


def chunk_text(text: str, size: int = 500, overlap: int = 100) -> list[str]:
    chunks = []
    start = 0

    while start < len(text):
        chunk = text[start:start + size].strip()
        if len(chunk) >= 30:
            chunks.append(chunk)
        start += size - overlap

    return chunks


def build_chunk_id(source: str, chunk_index: int, chunk: str) -> str:
    digest = sha1(f"{source}:{chunk_index}:{chunk}".encode("utf-8")).hexdigest()[:16]
    return f"{source}::{chunk_index}::{digest}"


def delete_source(source: str) -> int:
    collection = get_collection()
    results = collection.get(where={"source": source}, include=[])
    ids = results.get("ids") or []

    if ids:
        collection.delete(ids=ids)

    return len(ids)


def list_indexed_sources() -> list[str]:
    metadatas = get_collection().get(include=["metadatas"]).get("metadatas") or []
    sources = {
        metadata.get("source")
        for metadata in metadatas
        if metadata and metadata.get("source")
    }
    return sorted(sources)


def index_document(source: str, text: str) -> int:
    chunks = chunk_text(text)
    collection = get_collection()

    if not chunks:
        delete_source(source)
        return 0

    embeddings = get_embed_model().encode(chunks).tolist()
    ids = [build_chunk_id(source, index, chunk) for index, chunk in enumerate(chunks)]
    metadatas = [
        {"source": source, "chunk_index": index}
        for index, _ in enumerate(chunks)
    ]
    existing_ids = set(collection.get(where={"source": source}, include=[]).get("ids") or [])

    # Upsert first so a failed refresh does not wipe the previous index.
    collection.upsert(
        documents=chunks,
        embeddings=embeddings,
        ids=ids,
        metadatas=metadatas,
    )
    stale_ids = sorted(existing_ids - set(ids))

    if stale_ids:
        collection.delete(ids=stale_ids)

    return len(chunks)
