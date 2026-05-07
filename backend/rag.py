from __future__ import annotations

import math
import re
import threading
from collections import OrderedDict

import ollama

from backend.store import (
    CHAT_MODEL_NAME,
    get_adjacent_chunks,
    get_collection,
    get_embed_model,
    get_reranker,
)
from backend.history import (
    get_document_summary,
    upsert_document_summary,
)

RELEVANCE_THRESHOLD   = 0.45
NO_CONTEXT_ANSWER     = "인덱싱된 문서에서 관련 내용을 찾지 못했습니다. 질문이 문서와 관련이 없거나 더 구체적인 정보가 필요할 수 있습니다."
SYSTEM_MESSAGE = (
    "You are a helpful internal document assistant. "
    "If the user greets you or asks general questions not related to documents, respond naturally and friendly. "
    "When answering based on documents, follow the provided rules strictly. "
    "Always answer in Korean unless requested otherwise."
)
RESPONSE_PROFILE_VERSION  = "v4"
DEFAULT_GENERATION_OPTIONS  = {"num_predict": 900,  "temperature": 0.12}
DETAILED_GENERATION_OPTIONS = {"num_predict": 1400, "temperature": 0.1}

# BM25 파라미터
_BM25_K1 = 1.5
_BM25_B  = 0.75

# 요약 생성에 사용할 최대 텍스트 길이
_SUMMARY_MAX_CHARS = 5000


# ── LRU 캐시 (크기 제한 + thread-safe) ──────────────────────────

class _LRUCache:
    """딕셔너리 기반 LRU 캐시. maxsize 초과 시 가장 오래된 항목을 제거한다."""

    def __init__(self, maxsize: int = 512):
        self._cache: OrderedDict = OrderedDict()
        self._maxsize = maxsize
        self._lock = threading.Lock()

    def get(self, key: str):
        with self._lock:
            if key not in self._cache:
                return _MISS
            self._cache.move_to_end(key)
            return self._cache[key]

    def set(self, key: str, value) -> None:
        with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
            self._cache[key] = value
            if len(self._cache) > self._maxsize:
                self._cache.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()

    def __len__(self) -> int:
        return len(self._cache)


_MISS = object()  # 캐시 미스 센티넬

query_cache     = _LRUCache(maxsize=256)
rewrite_cache   = _LRUCache(maxsize=256)
embedding_cache = _LRUCache(maxsize=1024)
retrieval_cache = _LRUCache(maxsize=256)


# ── ollama 호환성 헬퍼 ─────────────────────────────────────────

def _get_content(response) -> str:
    if response is None:
        return ""
    if isinstance(response, dict):
        msg = response.get("message", {})
        if isinstance(msg, dict):
            return msg.get("content", "") or ""
        return getattr(msg, "content", "") or ""
    msg = getattr(response, "message", None)
    if msg is None:
        return ""
    if isinstance(msg, dict):
        return msg.get("content", "") or ""
    return getattr(msg, "content", "") or ""


def clear_caches():
    query_cache.clear()
    rewrite_cache.clear()
    embedding_cache.clear()
    retrieval_cache.clear()


def cache_key(query: str, user_id: str = "", selected_sources: list[str] | None = None) -> str:
    source_tag = ",".join(sorted(selected_sources)) if selected_sources else "all"
    return f"{RESPONSE_PROFILE_VERSION}:{user_id}:{source_tag}:{query.strip()}"


# ── 쿼리 분류 헬퍼 ────────────────────────────────────────────

def is_detailed_query(query: str) -> bool:
    normalized = query.lower().strip()
    keywords = [
        "할 일", "체크리스트", "단계", "절차", "해야 할", "액션 아이템", "업무",
        "정리해줘", "리스트", "todo", "to-do", "checklist", "action item",
        "steps", "tasks",
    ]
    return any(k in normalized for k in keywords)


def should_retrieve(query: str) -> bool:
    text = query.strip().lower()
    if len(text) < 2:
        return False
    if re.search(r'[가-힣]', text):
        return True
    keywords = [
        "뭐", "무엇", "왜", "어떻게", "설명", "알려", "차이",
        "방법", "이유", "가능", "언제", "어디",
        "rag", "세션", "문서", "db", "api", "파일", "내용", "요약",
        "what", "why", "how", "explain", "difference", "file", "document", "summarize"
    ]
    if any(k in text for k in keywords):
        return True
    if len(text.split()) >= 2:
        return True
    return False


def is_greeting(query: str) -> bool:
    normalized = query.lower().strip()
    greetings = [
        "안녕", "ㅎㅇ", "하이", "반가워", "hello", "hi", "hey",
        "누구야", "뭐해", "반가워요", "좋은 아침", "좋은 점심", "좋은 저녁", "반갑다",
        "고마워", "감사", "수고", "바이", "잘가", "잘 자",
    ]
    return len(normalized) <= 15 and any(g in normalized for g in greetings)


def is_meaningless(query: str) -> bool:
    text = query.strip()
    if len(text) <= 1:
        return True
    if re.match(r"^[ㄱ-ㅎㅏ-ㅣ\s!?.~^]+$", text):
        return True
    if re.search(r"[ㄱ-ㅎㅏ-ㅣ]{3,}", text):
        return True
    if re.search(r"(.)\1\1+", text):
        return True
    if re.match(r"^[a-zA-Z0-9\s!?.~^]+$", text):
        if len(text) > 3 and not re.search(r"[aeiouAEIOU]", text):
            return True
        if text.isdigit() and len(text) > 5:
            return True
    mashing_patterns = [
        "asdf", "qwer", "zxcv", "asdasd", "qwerty",
        "ㅁㄴㅇㄹ", "ㅂㅈㄷㄱ", "ㅋㅌㅊㅍ", "ㅗㅓㅏㅣ", "ㅐㅔ",
    ]
    low_text = text.lower()
    if any(p in low_text for p in mashing_patterns):
        return True
    if re.search(r"[ㄱ-ㅎㅏ-ㅣ]+", text) and re.search(r"[a-zA-Z]+", text):
        if not re.search(r"[가-힣]", text):
            return True
    return False


# ── 임베딩 ────────────────────────────────────────────────────

def get_embedding(text: str) -> list[float]:
    cached = embedding_cache.get(text)
    if cached is not _MISS:
        return cached
    embedding = get_embed_model().encode(text).tolist()
    embedding_cache.set(text, embedding)
    return embedding


# ── BM25 (로컬 후보셋 대상) ───────────────────────────────────

def _tokenize(text: str) -> list[str]:
    return re.findall(r'[가-힣a-zA-Z0-9]{2,}', text.lower())


def _bm25_scores(query_tokens: list[str], docs: list[str]) -> list[float]:
    """후보 문서 목록에 대해 쿼리 토큰 기반 BM25 점수를 계산한다."""
    if not query_tokens or not docs:
        return [0.0] * len(docs)

    # 문서 토큰화
    tokenized = [_tokenize(d) for d in docs]
    dl_list   = [len(t) for t in tokenized]
    avg_dl    = sum(dl_list) / len(dl_list) if dl_list else 1.0

    # 역문서빈도(IDF) 근사: 등장 문서 수 기준
    N = len(docs)
    idf: dict[str, float] = {}
    for term in set(query_tokens):
        df = sum(1 for t in tokenized if term in t)
        idf[term] = math.log((N - df + 0.5) / (df + 0.5) + 1.0)

    scores: list[float] = []
    for tokens, dl in zip(tokenized, dl_list):
        tf_map: dict[str, int] = {}
        for tok in tokens:
            tf_map[tok] = tf_map.get(tok, 0) + 1
        score = 0.0
        for term in query_tokens:
            tf = tf_map.get(term, 0)
            if tf == 0:
                continue
            norm = tf * (_BM25_K1 + 1) / (tf + _BM25_K1 * (1 - _BM25_B + _BM25_B * dl / avg_dl))
            score += idf.get(term, 0.0) * norm
        scores.append(score)

    # 0~1 정규화
    max_s = max(scores) if scores else 1.0
    if max_s > 0:
        scores = [s / max_s for s in scores]
    return scores


# ── 쿼리 재작성 ───────────────────────────────────────────────

def rewrite_query(query: str, model: str | None = None, history: list[dict] | None = None) -> str:
    cached = rewrite_cache.get(query)
    if cached is not _MISS:
        return cached
    target_model = model or CHAT_MODEL_NAME
    if history:
        history_text = "\n".join(f"{m['role']}: {m['content']}" for m in history[-3:])
        prompt = f"Given history and follow-up, rephrase to a standalone query.\nHistory:\n{history_text}\nFollow-up: {query}\nStandalone:"
    else:
        prompt = f"Rewrite to a search query.\nQuestion: {query}\nRewritten:"
    response  = ollama.chat(
        model=target_model,
        messages=[{"role": "user", "content": prompt}],
        options={"temperature": 0.1},
    )
    rewritten = _get_content(response).strip() or query
    rewrite_cache.set(query, rewritten)
    return rewritten


# ── 세션 제목 / 후속 질문 생성 ───────────────────────────────

def generate_session_title(query: str, answer: str, model: str | None = None) -> str:
    prompt = (
        f"다음 질문을 핵심만 담은 20자 이내의 대화 제목으로 만들어줘. "
        f"따옴표나 설명 없이 제목만 출력해.\n\n질문: {query[:200]}"
    )
    try:
        res   = ollama.chat(
            model=model or CHAT_MODEL_NAME,
            messages=[{"role": "user", "content": prompt}],
            options={"temperature": 0.2, "num_predict": 30},
        )
        title = _get_content(res).strip().strip("\"'「」『』").split("\n")[0].strip()
        return title[:40] if title else query[:30]
    except Exception:
        return query[:30]


def generate_suggestions(query: str, answer: str, model: str | None = None) -> list[str]:
    prompt = (
        f"질문: {query}\n"
        f"답변 요약: {answer[:300]}\n\n"
        "위 내용을 바탕으로 사용자가 자연스럽게 이어서 질문할 내용 2가지를 짧게 만들어줘.\n"
        "각 질문은 한 줄씩, 번호나 기호 없이 질문만 출력해:"
    )
    try:
        res     = ollama.chat(
            model=model or CHAT_MODEL_NAME,
            messages=[{"role": "user", "content": prompt}],
            options={"temperature": 0.5, "num_predict": 80},
        )
        content = _get_content(res).strip()
        raw     = [s.strip().lstrip("•-·1234567890.) ") for s in content.split("\n") if s.strip()]
        return [s for s in raw if 5 < len(s) < 80][:2]
    except Exception:
        return []


# ── [신규] 문서 요약 생성 ─────────────────────────────────────

def generate_document_summary(text: str, source: str, model: str | None = None) -> str:
    """
    문서 전체 텍스트를 받아 LLM으로 구조화된 요약을 생성한다.
    업로드 후 백그라운드 스레드에서 호출된다.
    """
    truncated = text[:_SUMMARY_MAX_CHARS]
    prompt = (
        f"다음은 '{source}' 문서의 내용입니다.\n"
        "이 문서의 핵심 내용을 아래 형식으로 한국어로 요약해줘:\n\n"
        "## 문서 개요\n(문서가 다루는 주제와 목적을 2~3문장으로)\n\n"
        "## 핵심 내용\n(중요한 정보, 데이터, 주장을 불렛 포인트로)\n\n"
        "## 주요 결론\n(문서의 결론이나 시사점을 간략히)\n\n"
        f"--- 문서 내용 ---\n{truncated}\n--- 끝 ---\n\n"
        "요약:"
    )
    try:
        res = ollama.chat(
            model=model or CHAT_MODEL_NAME,
            messages=[{"role": "user", "content": prompt}],
            options={"temperature": 0.1, "num_predict": 800},
        )
        summary = _get_content(res).strip()
        return summary if summary else ""
    except Exception as e:
        print(f"[Summary ERROR] {source}: {e}")
        return ""


# ── [개선] 인접 청크 보강 ────────────────────────────────────

def _enrich_with_adjacent(hits: list[dict], user_id: str = "", window: int = 1) -> list[dict]:
    """각 hit의 앞뒤 window 청크를 붙여 컨텍스트를 확장한다."""
    enriched: list[dict] = []
    for hit in hits:
        source      = hit.get("source", "")
        chunk_index = hit.get("chunk_index", -1)
        if chunk_index < 0:
            enriched.append(hit)
            continue
        adjacent = get_adjacent_chunks(source, chunk_index, user_id=user_id, window=window)
        if not adjacent:
            enriched.append(hit)
            continue
        # 인접 청크를 순서대로 결합
        sorted_indices = sorted(adjacent.keys())
        merged_text = "\n".join(adjacent[i] for i in sorted_indices)
        enriched.append({**hit, "document": merged_text})
    return enriched


# ── 검색 (벡터 + BM25 하이브리드) ─────────────────────────────

def retrieve_context(
    query: str,
    model: str | None = None,
    history: list[dict] | None = None,
    user_id: str = "",
    selected_sources: list[str] | None = None,
) -> dict:
    source_key = tuple(sorted(selected_sources)) if selected_sources else ()
    ckey = f"retrieval:{user_id}:{query}:{source_key}"
    cached = retrieval_cache.get(ckey)
    if cached is not _MISS:
        return cached

    collection = get_collection()
    conditions: list[dict] = []
    if user_id:
        conditions.append({"user_id": user_id})
    if selected_sources:
        if len(selected_sources) == 1:
            conditions.append({"source": selected_sources[0]})
        else:
            conditions.append({"source": {"$in": selected_sources}})
    if len(conditions) == 1:
        where_filter = conditions[0]
    elif len(conditions) > 1:
        where_filter = {"$and": conditions}
    else:
        where_filter = None

    total_docs = collection.count()
    if total_docs == 0:
        return {"hits": [], "max_score": 0.0}

    n_results    = min(20 if selected_sources else 10, total_docs)
    query_tokens = _tokenize(query)

    # ── 벡터 검색 (복수 쿼리) ──
    search_queries = [query]
    if not selected_sources and len(query) > 25 and not is_greeting(query):
        search_queries.append(rewrite_query(query, model=model, history=history))

    candidates: dict[tuple, dict] = {}
    for current_query in search_queries:
        results = collection.query(
            query_embeddings=[get_embedding(current_query)],
            n_results=n_results,
            where=where_filter,
            include=["documents", "metadatas"],
        )
        for doc, meta in zip(
            (results.get("documents") or [[]])[0],
            (results.get("metadatas") or [[]])[0],
        ):
            if not doc:
                continue
            meta  = meta or {}
            key   = (meta.get("source", ""), meta.get("chunk_index", -1), doc)
            if key not in candidates:
                candidates[key] = {
                    "document":    doc,
                    "source":      meta.get("source", "unknown"),
                    "chunk_index": meta.get("chunk_index", -1),
                }

    # ── 폴백: 특정 파일 지정 시 결과 부족 ──
    if selected_sources and len(candidates) < 5:
        fb = collection.get(where=where_filter, limit=10, include=["documents", "metadatas"])
        for d, m in zip(fb.get("documents") or [], fb.get("metadatas") or []):
            m   = m or {}
            key = (m.get("source"), m.get("chunk_index"), d)
            if key not in candidates:
                candidates[key] = {"document": d, "source": m.get("source"), "chunk_index": m.get("chunk_index")}

    if not candidates:
        return {"hits": [], "max_score": 0.0}

    hits = list(candidates.values())
    docs = [h["document"] for h in hits]

    # ── Cross-Encoder 리랭킹 ──
    reranker_scores = get_reranker().predict([[query, d] for d in docs])

    # ── BM25 점수 계산 ──
    bm25_scores = _bm25_scores(query_tokens, docs)

    # ── 하이브리드 스코어링 (Reranker 0.7 + BM25 0.3) ──
    for hit, raw_score, bm25 in zip(hits, reranker_scores, bm25_scores):
        vector_score = 1 / (1 + math.exp(-float(raw_score)))   # sigmoid 정규화
        hit["score"] = round(min(1.0, vector_score * 0.7 + bm25 * 0.3), 4)

    ranked_hits = sorted(hits, key=lambda h: (-h["score"], h["chunk_index"]))

    # ── [개선] 인접 청크 보강 ──
    ranked_hits = _enrich_with_adjacent(ranked_hits, user_id=user_id, window=1)

    result = {"hits": ranked_hits, "max_score": ranked_hits[0]["score"]}
    retrieval_cache.set(ckey, result)
    return result


# ── [개선] 소스 선택: 동일 파일 복수 청크 허용 + citation_index ──

def select_sources(hits: list[dict], limit: int = 5, max_per_source: int = 2) -> list[dict]:
    """
    소스별 최대 max_per_source 개 청크를 허용하여 총 limit 개를 선택한다.
    citation_index는 hits 내에서 이미 부여된 번호를 그대로 사용한다.
    """
    selected: list[dict] = []
    source_count: dict[str, int] = {}

    for hit in hits:
        src = hit["source"]
        if source_count.get(src, 0) >= max_per_source:
            continue
        selected.append({
            "source":         src,
            "score":          hit["score"],
            "preview":        hit["document"][:250].strip() + "...",
            "full_text":      hit["document"],
            "chunk_index":    hit["chunk_index"],
            "citation_index": hit.get("citation_index", 0),  # [신규] citation 번호
        })
        source_count[src] = source_count.get(src, 0) + 1
        if len(selected) >= limit:
            break

    return selected


# ── [개선] 컨텍스트 압축: 저점수 청크 트리밍 ──────────────────

def _compress_context(hits: list[dict], threshold: float = 0.25) -> list[dict]:
    """
    reranker score가 너무 낮은 청크는 전체 텍스트 대신 앞 200자만 사용하여
    LLM 컨텍스트 윈도우 낭비를 줄인다.
    """
    compressed: list[dict] = []
    for hit in hits:
        if hit["score"] < threshold:
            compressed.append({**hit, "document": hit["document"][:200] + "..."})
        else:
            compressed.append(hit)
    return compressed


# ── [개선] 프롬프트 빌더 — citation 번호 포함 ────────────────

def build_prompt(context: str, query: str, detailed: bool) -> str:
    style_guide = (
        "7. 답변은 상세한 불렛 포인트(Bullet List) 형태로 구성하세요.\n"
        "8. 각 항목은 구체적이고 실용적인 정보를 담아야 합니다.\n"
        "9. 문서의 문맥을 최대한 활용하여 종합적으로 설명하세요."
        if detailed else
        "7. 간결하고 명확하게 답변하세요.\n"
        "8. 불필요한 서술은 생략하고 핵심 정보를 우선적으로 전달하세요."
    )
    return (
        "## 지침 (Rules)\n"
        "1. 제공된 '문서 문맥(Context)' 정보만을 기반으로 답변하세요.\n"
        "2. 답변을 위한 정보가 부족한 경우, 반드시 '" + NO_CONTEXT_ANSWER + "'라고 답변하세요.\n"
        "3. 절대 스스로 정보를 지어내거나 외부 지식을 사용하지 마세요.\n"
        "4. 모든 답변은 한국어로 작성하세요.\n"
        "5. 문서의 내용을 왜곡하지 말고 정확하게 전달하세요.\n"
        "6. 문서 내용을 인용할 때는 반드시 해당 출처의 번호를 [1], [2] 형태로 문장 끝에 표시하세요. "
        "예: '이 기능은 v2.0부터 지원됩니다. [1]' 또는 '설치 방법은 두 가지입니다. [2][3]'\n"
        f"{style_guide}\n\n"
        "## 문서 문맥 (Context)\n"
        f"{context}\n\n"
        "## 사용자 질문 (Question)\n"
        f"{query}\n\n"
        "## 답변 (Answer):"
    )


def prepare_answer(
    query: str,
    model: str | None = None,
    history: list[dict] | None = None,
    user_id: str = "",
    selected_sources: list[str] | None = None,
) -> dict:
    is_summary_req = any(k in query.lower() for k in ["요약", "확인", "정리", "뭐야", "내용"])
    detailed       = is_detailed_query(query)

    # ── [신규] 단일 파일 요약 요청 시 pre-computed summary 우선 사용 ──
    if is_summary_req and selected_sources and len(selected_sources) == 1:
        pre_summary = get_document_summary(selected_sources[0], user_id)
        if pre_summary:
            source_name = selected_sources[0]
            context     = f"[1] [출처: {source_name}]\n{pre_summary}"
            sources     = [{
                "source":         source_name,
                "score":          1.0,
                "preview":        pre_summary[:250].strip() + "...",
                "full_text":      pre_summary,
                "chunk_index":    -1,
                "citation_index": 1,
            }]
            return {
                "enough_context": True,
                "prompt":   build_prompt(context, query, detailed=True),
                "context":  context,
                "sources":  sources,
                "score":    1.0,
                "detailed": True,
            }

    # ── 기존 청크 검색 로직 ──
    retrieval = retrieve_context(query, model=model, history=history, user_id=user_id, selected_sources=selected_sources)
    hits, max_score = retrieval["hits"], retrieval["max_score"]

    effective_threshold = RELEVANCE_THRESHOLD
    if selected_sources:
        effective_threshold = 0.0 if is_summary_req else 0.2

    if not hits or max_score < effective_threshold:
        return {"enough_context": False, "prompt": "", "context": "", "sources": [], "score": round(max_score, 4), "detailed": detailed}

    top_limit = 10 if is_summary_req else (6 if detailed else 4)
    top_hits  = _compress_context(hits[:top_limit])

    # ── [신규] citation_index 부여 (1-based) ──
    for i, hit in enumerate(top_hits):
        hit["citation_index"] = i + 1

    # ── [개선] context에 번호 삽입 ──
    context = "\n\n".join(
        f"[{h['citation_index']}] [출처: {h['source']}]\n{h['document']}"
        for h in top_hits
    )

    return {
        "enough_context": True,
        "prompt":   build_prompt(context, query, detailed or is_summary_req),
        "context":  context,
        "sources":  select_sources(top_hits),
        "score":    round(max_score, 4),
        "detailed": detailed,
    }


# ── 메인 RAG 함수 ─────────────────────────────────────────────

def ask_rag(
    query: str,
    model: str | None = None,
    history: list[dict] | None = None,
    user_id: str = "",
    selected_sources: list[str] | None = None,
) -> dict:
    key    = cache_key(query, user_id, selected_sources)
    cached = query_cache.get(key)
    if cached is not _MISS:
        return cached

    if is_meaningless(query):
        return {"answer": "이해하지 못했습니다.", "context": "", "sources": [], "score": 0.0}

    if is_greeting(query):
        res = ollama.chat(model=model or CHAT_MODEL_NAME, messages=[{"role": "user", "content": query}])
        return {"answer": _get_content(res), "context": "", "sources": [], "score": 0.0}

    if not selected_sources and not should_retrieve(query):
        res = ollama.chat(model=model or CHAT_MODEL_NAME, messages=[{"role": "user", "content": query}])
        return {"answer": _get_content(res), "context": "", "sources": [], "score": 0.0}

    prepared = prepare_answer(query, model=model, history=history, user_id=user_id, selected_sources=selected_sources)
    if not prepared["enough_context"]:
        return {"answer": NO_CONTEXT_ANSWER, "context": "", "sources": [], "score": prepared["score"]}

    messages = [{"role": "system", "content": SYSTEM_MESSAGE}]
    if history:
        messages.extend(history[-5:])
    messages.append({"role": "user", "content": prepared["prompt"]})

    response = ollama.chat(model=model or CHAT_MODEL_NAME, messages=messages)
    result   = {
        "answer":  _get_content(response).strip(),
        "context": prepared["context"],
        "sources": prepared["sources"],
        "score":   prepared["score"],
    }
    query_cache.set(key, result)
    return result


def ask_rag_stream(
    query: str,
    model: str | None = None,
    history: list[dict] | None = None,
    user_id: str = "",
    selected_sources: list[str] | None = None,
):
    target_model = model or CHAT_MODEL_NAME

    if is_meaningless(query):
        yield {"type": "meta", "sources": [], "context": "", "score": 0.0}
        yield {"type": "chunk", "content": "이해하지 못했습니다."}
        return

    if is_greeting(query):
        yield {"type": "meta", "sources": [], "context": "", "score": 0.0}
        for chunk in ollama.chat(model=target_model, messages=[{"role": "user", "content": query}], stream=True):
            content = _get_content(chunk)
            if content:
                yield {"type": "chunk", "content": content}
        return

    if not selected_sources and not should_retrieve(query):
        yield {"type": "meta", "sources": [], "context": "", "score": 0.0}
        for chunk in ollama.chat(model=target_model, messages=[{"role": "user", "content": query}], stream=True):
            content = _get_content(chunk)
            if content:
                yield {"type": "chunk", "content": content}
        return

    yield {"type": "status", "state": "searching"}
    prepared = prepare_answer(query, model=model, history=history, user_id=user_id, selected_sources=selected_sources)
    yield {"type": "meta", "sources": prepared["sources"], "context": prepared["context"], "score": prepared["score"]}

    if not prepared["enough_context"]:
        yield {"type": "chunk", "content": NO_CONTEXT_ANSWER}
        return

    messages = [{"role": "system", "content": SYSTEM_MESSAGE}]
    if history:
        messages.extend(history[-5:])
    messages.append({"role": "user", "content": prepared["prompt"]})

    full_answer = ""
    for chunk in ollama.chat(model=target_model, messages=messages, stream=True):
        content = _get_content(chunk)
        if content:
            full_answer += content
            yield {"type": "chunk", "content": content}

    if full_answer.strip() and len(full_answer) > 50:
        suggestions = generate_suggestions(query, full_answer, model=model)
        if suggestions:
            yield {"type": "suggestions", "items": suggestions}
