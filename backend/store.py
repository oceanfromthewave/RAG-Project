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

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data" / "docs"
DB_DIR = BASE_DIR / "db"
EMBED_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
RERANK_MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"
CHAT_MODEL_NAME = "mistral"
MAX_SOURCE_NAME_LENGTH = int(os.getenv("MAX_SOURCE_NAME_LENGTH", "128"))
MAX_EXTRACTED_CHARS = int(os.getenv("MAX_EXTRACTED_CHARS", "500000"))
MAX_PDF_PAGES = int(os.getenv("MAX_PDF_PAGES", "100"))
MAX_CHUNKS_PER_DOCUMENT = int(os.getenv("MAX_CHUNKS_PER_DOCUMENT", "1000"))
ALLOWED_SUFFIXES = {
    ".txt", ".pdf", ".docx", ".py", ".js", ".ts", ".jsx", ".tsx",
    ".html", ".css", ".json", ".md", ".java", ".c", ".cpp", ".h", ".go",
    ".yaml", ".yml", ".sql", ".sh", ".bash", ".png", ".jpg", ".jpeg"
}

# 모델 이름에 따라 컬렉션 이름을 다르게 가져가서 차원 충돌 방지
_model_slug = EMBED_MODEL_NAME.split("/")[-1].replace("-", "_")
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
        
        # 🔥 깨진 DB 삭제
        reset_collection(client)
        
        # 🔥 캐시 초기화 (중요)
        get_collection.cache_clear()
        
        # 🔥 다시 생성
        return client.get_or_create_collection(COLLECTION_NAME)


@lru_cache(maxsize=1)
def get_embed_model():
    return SentenceTransformer(EMBED_MODEL_NAME)


@lru_cache(maxsize=1)
def get_reranker():
    return CrossEncoder(RERANK_MODEL_NAME)


def normalize_source_name(filename: str) -> str:
    cleaned = Path(filename).name.strip()
    suffix = Path(cleaned).suffix.lower()
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
    try:
        return limit_extracted_text(path.read_text(encoding="utf-8"))
    except UnicodeDecodeError:
        try:
            return limit_extracted_text(path.read_text(encoding="cp949"))
        except UnicodeDecodeError:
            return limit_extracted_text(path.read_text(encoding="latin-1"))


def read_pdf(path: Path) -> str:
    reader = PdfReader(str(path))
    if len(reader.pages) > MAX_PDF_PAGES:
        raise ValueError(f"PDF has too many pages. Maximum allowed is {MAX_PDF_PAGES}.")
    return limit_extracted_text("".join(page.extract_text() or "" for page in reader.pages))


def read_docx(path: Path) -> str:
    doc = DocxDocument(str(path))
    return limit_extracted_text("\n".join(paragraph.text for paragraph in doc.paragraphs if paragraph.text.strip()))


def read_image(path: Path) -> str:
    """Ollama의 llava 모델을 사용하여 이미지에서 텍스트를 추출하거나 내용을 설명한다."""
    try:
        import ollama
        with open(path, "rb") as f:
            image_bytes = f.read()
        
        # llava 모델을 사용하여 이미지 분석
        response = ollama.generate(
            model="llava",
            prompt="이 이미지에 포함된 모든 텍스트를 추출해서 알려줘. 텍스트가 없다면 이미지의 내용을 상세히 설명해줘. 한국어로 답변해줘.",
            images=[image_bytes],
            stream=False
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
    """텍스트를 의미 있는 단위(단락, 문장)로 최대한 보존하며 분할한다.
    한국어 문장 경계(다/요/죠/습니다 등)를 추가로 인식한다.
    """
    if not text.strip():
        return []

    # 1. 단락 단위로 먼저 분할
    paragraphs = re.split(r'\n\s*\n', text)

    # 2. 한국어 + 영어 문장 분리 정규식
    #    - 영어: .!? 뒤 공백
    #    - 한국어: 다/요/죠/음/함/니다 뒤 . 또는 공백
    _KR_SENT_RE = re.compile(
        r'(?<=[.!?\uFF0E])\s+'
        r'|(?<=\ub2e4[.])\s+'
        r'|(?<=\uc694[.])\s+'
        r'|(?<=\uc8fc[.])\s+'
        r'|(?<=\ub2e4)\n'
        r'|(?<=\uc694)\n'
    )

    chunks = []
    current_chunk = ""

    for p in paragraphs:
        p = p.strip()
        if not p:
            continue

        # 단락이 너무 크면 문장 단위로 쪼개기
        if len(p) > size:
            sentences = _KR_SENT_RE.split(p)
            # 너무 짧게 쪼개진 조각은 앞 문장과 병합
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
                    # 오버랩 처리
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

    # 너무 짧은 청크 필터링 (의미 없는 조각 제거)
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
    where_filter = {}
    if user_id:
        where_filter = {"user_id": user_id}
        
    metadatas = get_collection().get(where=where_filter, include=["metadatas"]).get("metadatas") or []
    sources = {
        metadata.get("source")
        for metadata in metadatas
        if metadata and metadata.get("source")
    }
    return sorted(sources)


def index_document(source: str, text: str, user_id: str = "") -> int:
    chunks = chunk_text(text)
    collection = get_collection()

    if not chunks:
        delete_source(source, user_id=user_id)
        return 0

    embeddings = get_embed_model().encode(chunks).tolist()
    ids = [build_chunk_id(f"{user_id}:{source}" if user_id else source, index, chunk) for index, chunk in enumerate(chunks)]
    metadatas = [
        {"source": source, "chunk_index": index, "user_id": user_id}
        for index, _ in enumerate(chunks)
    ]
    
    if user_id:
        where_filter = {"$and": [{"source": source}, {"user_id": user_id}]}
    else:
        where_filter = {"source": source}
        
    existing_ids = set(collection.get(where=where_filter, include=[]).get("ids") or [])

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
