from __future__ import annotations

import math
import re

import ollama

from backend.store import CHAT_MODEL_NAME, get_collection, get_embed_model, get_reranker

RELEVANCE_THRESHOLD = 0.6
NO_CONTEXT_ANSWER = "인덱싱된 문서에서 관련 내용을 찾지 못했습니다. 질문이 문서와 관련이 없거나 더 구체적인 정보가 필요할 수 있습니다."
SYSTEM_MESSAGE = (
    "You are a helpful internal document assistant. "
    "If the user greets you or asks general questions not related to documents, respond naturally and friendly. "
    "When answering based on documents, follow the provided rules strictly. "
    "Always answer in Korean unless requested otherwise."
)
RESPONSE_PROFILE_VERSION = "v2"
DEFAULT_GENERATION_OPTIONS = {"num_predict": 900, "temperature": 0.12}
DETAILED_GENERATION_OPTIONS = {"num_predict": 1400, "temperature": 0.1}

query_cache = {}
rewrite_cache = {}
embedding_cache = {}
retrieval_cache = {}


def clear_caches():
    query_cache.clear()
    rewrite_cache.clear()
    embedding_cache.clear()
    retrieval_cache.clear()


def cache_key(query: str, user_id: str = "", selected_sources: list[str] | None = None) -> str:
    source_tag = ",".join(sorted(selected_sources)) if selected_sources else "all"
    return f"{RESPONSE_PROFILE_VERSION}:{user_id}:{source_tag}:{query.strip()}"


def is_detailed_query(query: str) -> bool:
    normalized = query.lower().strip()
    keywords = [
        "할 일", "체크리스트", "단계", "절차", "해야 할", "액션 아이템", "업무",
        "정리해줘", "리스트", "todo", "to-do", "checklist", "action item",
        "steps", "tasks",
    ]
    return any(keyword in normalized for keyword in keywords)

def should_retrieve(query: str) -> bool:
    text = query.strip().lower()

    # 너무 짧으면 컷 (단, 문서/파일 관련 키워드 제외)
    if len(text) < 2:
        return False

    # 질문 키워드 기반
    keywords = [
        "뭐", "무엇", "왜", "어떻게", "설명", "알려", "차이",
        "방법", "이유", "가능", "언제", "어디",
        "rag", "세션", "문서", "db", "api", "파일", "내용", "요약",
        "what", "why", "how", "explain", "difference", "file", "document", "summarize"
    ]

    if any(k in text for k in keywords):
        return True

    # 명사형 질문 (단어 2개 이상)
    if len(text.split()) >= 2:
        return True

    return False


def is_greeting(query: str) -> bool:
    normalized = query.lower().strip()
    greetings = [
        "안녕", "ㅎㅇ", "하이", "반가워", "hello", "hi", "hey",
        "누구야", "뭐해", "반가워요", "좋은 아침", "좋은 점심", "좋은 저녁", "반갑다",
        "고마워", "감사", "수고", "바이", "잘가", "잘 자"
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
        "ㅁㄴㅇㄹ", "ㅂㅈㄷㄱ", "ㅋㅌㅊㅍ", "ㅗㅓㅏㅣ", "ㅐㅔ"
    ]
    low_text = text.lower()
    if any(pattern in low_text for pattern in mashing_patterns):
        return True
    
    if re.search(r"[ㄱ-ㅎㅏ-ㅣ]+", text) and re.search(r"[a-zA-Z]+", text):
        if not re.search(r"[가-힣]", text):
            return True

    return False


def get_embedding(text: str) -> list[float]:
    if text in embedding_cache:
        return embedding_cache[text]
    embedding = get_embed_model().encode(text).tolist()
    embedding_cache[text] = embedding
    return embedding


def rewrite_query(query: str, model: str | None = None, history: list[dict] | None = None) -> str:
    if query in rewrite_cache:
        return rewrite_cache[query]

    target_model = model or CHAT_MODEL_NAME
    if history:
        history_text = "\n".join([f"{m['role']}: {m['content']}" for m in history[-3:]])
        prompt = f"Given history and follow-up, rephrase to a standalone query.\nHistory:\n{history_text}\nFollow-up: {query}\nStandalone:"
    else:
        prompt = f"Rewrite to a search query.\nQuestion: {query}\nRewritten:"

    response = ollama.chat(
        model=target_model,
        messages=[{"role": "user", "content": prompt}],
        options={"temperature": 0.1},
    )
    rewritten = response["message"]["content"].strip() or query
    rewrite_cache[query] = rewritten
    return rewritten

def retrieve_context(
    query: str, 
    model: str | None = None, 
    history: list[dict] | None = None, 
    user_id: str = "",
    selected_sources: list[str] | None = None
) -> dict:
    ckey = f"retrieval:{user_id}:{query}:{selected_sources}"
    if ckey in retrieval_cache:
        return retrieval_cache[ckey]

    collection = get_collection()

    # 필터 구성 (ChromaDB 호환성 극대화)
    where_filter = None
    conditions = []

    if user_id:
        conditions.append({"user_id": user_id})

    if selected_sources and len(selected_sources) > 0:
        if len(selected_sources) == 1:
            conditions.append({"source": selected_sources[0]})
        else:
            conditions.append({"source": {"$in": selected_sources}})

    if len(conditions) == 1:
        where_filter = conditions[0]
    elif len(conditions) > 1:
        where_filter = {"$and": conditions}

    if collection.count() == 0:
        return {"hits": [], "max_score": 0.0}

    # 키워드 추출 (단순화: 2글자 이상 단어)
    keywords = [k.lower() for k in re.findall(r'[가-힣a-zA-Z0-9]{2,}', query)]

    candidates = {}
    # 1. 벡터 검색 (Original & Rewritten)
    search_queries = [query]
    
    # 질문이 충분히 길고, 파일이 선택되지 않았을 때만 쿼리 재작성 수행 (오버헤드 방지)
    if not selected_sources and len(query) > 25 and not is_greeting(query):
        search_queries.append(rewrite_query(query, model=model, history=history))

    for current_query in search_queries:
        # 필터링된 검색 시 n_results를 더 넉넉히 가져옴
        results = collection.query(
            query_embeddings=[get_embedding(current_query)],
            n_results=15 if selected_sources else 7, 
            where=where_filter,
            include=["documents", "metadatas"],
        )

        documents = (results.get("documents") or [[]])[0]
        metadatas = (results.get("metadatas") or [[]])[0]

        for document, metadata in zip(documents, metadatas):
            if not document: continue
            source = (metadata or {}).get("source", "unknown")
            chunk_index = (metadata or {}).get("chunk_index", -1)
            key = (source, chunk_index, document)
            if key not in candidates:
                candidates[key] = {
                    "document": document, "source": source, "chunk_index": chunk_index
                }

    # 2. 폴백 (Fallback): 특정 파일을 지정했는데 검색 결과가 부족할 경우 (요약 등 전체 맥락 질문 대응)
    if selected_sources and len(candidates) < 5:
        fallback_res = collection.get(
            where=where_filter,
            limit=10,
            include=["documents", "metadatas"]
        )
        f_docs = fallback_res.get("documents") or []
        f_metas = fallback_res.get("metadatas") or []
        for d, m in zip(f_docs, f_metas):
            key = (m.get("source"), m.get("chunk_index"), d)
            if key not in candidates:
                candidates[key] = {"document": d, "source": m.get("source"), "chunk_index": m.get("chunk_index")}

    if not candidates:
        return {"hits": [], "max_score": 0.0}

    hits = list(candidates.values())
    
    # 2. Reranking (BGE-Reranker)
    scores = get_reranker().predict([[query, hit["document"]] for hit in hits])
    
    for hit, score in zip(hits, scores):
        # Sigmoid normalization for reranker score
        base_score = 1 / (1 + math.exp(-float(score)))
        
        # 3. Keyword Boost (Simple Hybrid)
        keyword_match_count = sum(1 for k in keywords if k in hit["document"].lower())
        boost = 0.0
        if keywords:
            boost = (keyword_match_count / len(keywords)) * 0.15 # Max 15% boost
        
        hit["score"] = min(1.0, base_score + boost)

    ranked_hits = sorted(hits, key=lambda item: (-item["score"], item["chunk_index"]))
    result = {"hits": ranked_hits, "max_score": ranked_hits[0]["score"]}
    retrieval_cache[ckey] = result
    return result


def select_sources(hits: list[dict], limit: int = 4) -> list[dict]:
    selected, seen = [], set()
    for hit in hits:
        if hit["source"] in seen: continue
        selected.append({
            "source": hit["source"], 
            "score": round(hit["score"], 4), 
            "preview": hit["document"][:250].strip() + "...",
            "full_text": hit["document"]
        })
        seen.add(hit["source"])
        if len(selected) == limit: break
    return selected


def build_prompt(context: str, query: str, detailed: bool) -> str:
    style_guide = (
        "6. 답변은 상세한 불렛 포인트(Bullet List) 형태로 구성하세요.\n"
        "7. 각 항목은 구체적이고 실용적인 정보를 담아야 합니다.\n"
        "8. 문서의 문맥을 최대한 활용하여 종합적으로 설명하세요."
        if detailed else
        "6. 간결하고 명확하게 답변하세요.\n"
        "7. 불필요한 서술은 생략하고 핵심 정보를 우선적으로 전달하세요."
    )
    
    return (
        "## 지침 (Rules)\n"
        "1. 제공된 '문서 문맥(Context)' 정보만을 기반으로 답변하세요.\n"
        "2. 답변을 위한 정보가 부족한 경우, 반드시 '" + NO_CONTEXT_ANSWER + "'라고 답변하세요.\n"
        "3. 절대 스스로 정보를 지어내거나 외부 지식을 사용하지 마세요.\n"
        "4. 모든 답변은 한국어로 작성하세요.\n"
        "5. 문서의 내용을 왜곡하지 말고 정확하게 전달하세요.\n"
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
    selected_sources: list[str] | None = None
) -> dict:
    retrieval = retrieve_context(query, model=model, history=history, user_id=user_id, selected_sources=selected_sources)
    hits, max_score, detailed = retrieval["hits"], retrieval["max_score"], is_detailed_query(query)

    # 선택된 파일이 있고 '요약/확인' 등 특정 키워드가 포함된 경우 검색 결과가 있으면 무조건 진행
    is_summary_req = any(k in query.lower() for k in ["요약", "확인", "정리", "뭐야", "내용"])
    
    effective_threshold = RELEVANCE_THRESHOLD
    if selected_sources and len(selected_sources) > 0:
        if is_summary_req:
            effective_threshold = 0.0 # 요약 요청 시 검색 결과가 1개라도 있으면 통과
        else:
            effective_threshold = 0.2

    if not hits or max_score < effective_threshold:
        return {"enough_context": False, "prompt": "", "context": "", "sources": [], "score": round(max_score, 4), "detailed": detailed}

    # 요약 요청 시에는 더 많은 맥락(최대 10개 청크)을 제공하여 정보 누락 방지
    top_limit = 10 if is_summary_req else (6 if detailed else 3)
    top_hits = hits[:top_limit]
    
    context = "\n\n".join(f"[Source: {hit['source']}]\n{hit['document']}" for hit in top_hits)
    return {"enough_context": True, "prompt": build_prompt(context, query, detailed or is_summary_req), "context": context, "sources": select_sources(top_hits), "score": round(max_score, 4), "detailed": detailed}


def ask_rag(
    query: str, 
    model: str | None = None, 
    history: list[dict] | None = None, 
    user_id: str = "",
    selected_sources: list[str] | None = None
) -> dict:
    key = cache_key(query, user_id, selected_sources)
    if key in query_cache: return query_cache[key]

    if is_meaningless(query):
        return {"answer": "이해하지 못했습니다.", "context": "", "sources": [], "score": 0.0}

    if is_greeting(query):
        res = ollama.chat(model=model or CHAT_MODEL_NAME, messages=[{"role": "user", "content": query}])
        return {"answer": res["message"]["content"], "context": "", "sources": [], "score": 0.0}

    # 특정 파일이 선택되었다면 무조건 RAG 수행, 그렇지 않다면 검색 필요성 판단
    if not selected_sources and not should_retrieve(query):
        res = ollama.chat(
            model=model or CHAT_MODEL_NAME,
            messages=[{"role": "user", "content": query}]
        )
        return {
            "answer": res["message"]["content"],
            "context": "",
            "sources": [],
            "score": 0.0
        }

    prepared = prepare_answer(query, model=model, history=history, user_id=user_id, selected_sources=selected_sources)

    if not prepared["enough_context"]:
        return {"answer": NO_CONTEXT_ANSWER, "context": "", "sources": [], "score": prepared["score"]}

    messages = [{"role": "system", "content": SYSTEM_MESSAGE}]
    if history: messages.extend(history[-5:])
    messages.append({"role": "user", "content": prepared["prompt"]})

    response = ollama.chat(model=model or CHAT_MODEL_NAME, messages=messages)
    result = {"answer": response["message"]["content"].strip(), "context": prepared["context"], "sources": prepared["sources"], "score": prepared["score"]}
    query_cache[key] = result
    return result


def ask_rag_stream(
    query: str, 
    model: str | None = None, 
    history: list[dict] | None = None, 
    user_id: str = "",
    selected_sources: list[str] | None = None
):
    if is_meaningless(query):
        yield {"type": "meta", "sources": [], "context": "", "score": 0.0}
        yield {"type": "chunk", "content": "이해하지 못했습니다."}
        return

    if is_greeting(query):
        yield {"type": "meta", "sources": [], "context": "", "score": 0.0}
        stream = ollama.chat(model=model or CHAT_MODEL_NAME, messages=[{"role": "user", "content": query}], stream=True)
        for chunk in stream:
            content = chunk.get("message", {}).get("content", "")
            if content: yield {"type": "chunk", "content": content}
        return

    if not selected_sources and not should_retrieve(query):
        yield {"type": "meta", "sources": [], "context": "", "score": 0.0}

        stream = ollama.chat(
            model=model or CHAT_MODEL_NAME,
            messages=[{"role": "user", "content": query}],
            stream=True
        )

        for chunk in stream:
            content = chunk.get("message", {}).get("content", "")
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
    if history: messages.extend(history[-5:])
    messages.append({"role": "user", "content": prepared["prompt"]})

    stream = ollama.chat(model=model or CHAT_MODEL_NAME, messages=messages, stream=True)
    for chunk in stream:
        content = chunk.get("message", {}).get("content", "")
        if content: yield {"type": "chunk", "content": content}
