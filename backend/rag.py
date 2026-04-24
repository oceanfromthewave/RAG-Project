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


def cache_key(query: str, user_id: str = "") -> str:
    return f"{RESPONSE_PROFILE_VERSION}:{user_id}:{query.strip()}"


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

    # 너무 짧으면 검색 안함
    if len(text) < 5:
        return False

    # 질문 키워드
    question_keywords = [
        "뭐", "무엇", "왜", "어떻게", "설명", "알려", "차이",
        "방법", "이유", "가능", "언제", "어디",
        "what", "why", "how", "explain", "difference"
    ]

    if any(k in text for k in question_keywords):
        return True

    # 단어 2개 이상이면 최소한 검색 허용
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
    
    # 1. 한글 자음/모음만 있거나 특수문자만 있는 경우 (이미 존재)
    if re.match(r"^[ㄱ-ㅎㅏ-ㅣ\s!?.~^]+$", text):
        return True
        
    # 2. 자음/모음 비율이 너무 높은 경우 (단어가 아닌 연타)
    # 한글 완성형 단어 없이 자음/모음이 섞여 있는 경우를 위해 정규식 확장
    if re.search(r"[ㄱ-ㅎㅏ-ㅣ]{3,}", text):
        return True

    # 3. 같은 글자가 3번 이상 반복되는 경우 (예: aaaaa, ㅋㅋㅋㅋ)
    if re.search(r"(.)\1\1+", text):
        return True

    # 4. 영문/숫자 조합에서 모음이 없거나 너무 긴 무의미 문자열
    if re.match(r"^[a-zA-Z0-9\s!?.~^]+$", text):
        if len(text) > 3 and not re.search(r"[aeiouAEIOU]", text):
            return True
        if text.isdigit() and len(text) > 5:
            return True

    # 5. 키보드 배열 연타 (한글/영문)
    mashing_patterns = [
        "asdf", "qwer", "zxcv", "asdasd", "qwerty",
        "ㅁㄴㅇㄹ", "ㅂㅈㄷㄱ", "ㅋㅌㅊㅍ", "ㅗㅓㅏㅣ", "ㅐㅔ"
    ]
    low_text = text.lower()
    if any(pattern in low_text for pattern in mashing_patterns):
        return True
    
    # 6. 한글 자음/모음과 영문이 섞여있는데 전체적으로 짧고 의미 없어 보이는 경우
    # (예: ㅁㄴㅇㄹasdf)
    if re.search(r"[ㄱ-ㅎㅏ-ㅣ]+", text) and re.search(r"[a-zA-Z]+", text):
        # 완성된 한글 글자(가-힣)가 하나도 없으면 무의미한 혼용으로 간주
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


def retrieve_context(query: str, model: str | None = None, history: list[dict] | None = None, user_id: str = "") -> dict:
    ckey = f"retrieval:{user_id}:{query}"
    if ckey in retrieval_cache:
        return retrieval_cache[ckey]

    collection = get_collection()
    where_filter = {"user_id": user_id} if user_id else None

    if collection.count() == 0:
        return {"hits": [], "max_score": 0.0}

    candidates = {}
    for current_query in [query, rewrite_query(query, model=model, history=history)]:
        results = collection.query(
            query_embeddings=[get_embedding(current_query)],
            n_results=5,
            where=where_filter,
            include=["documents", "metadatas"],
        )
        documents = (results.get("documents") or [[]])[0]
        metadatas = (results.get("metadatas") or [[]])[0]

        for document, metadata in zip(documents, metadatas):
            if not document: continue
            source = (metadata or {}).get("source", "unknown")
            chunk_index = (metadata or {}).get("chunk_index", -1)
            candidates[(source, chunk_index, document)] = {
                "document": document, "source": source, "chunk_index": chunk_index
            }

    if not candidates:
        return {"hits": [], "max_score": 0.0}

    hits = list(candidates.values())
    scores = get_reranker().predict([[query, hit["document"]] for hit in hits])
    for hit, score in zip(hits, scores):
        hit["score"] = 1 / (1 + math.exp(-float(score)))

    ranked_hits = sorted(hits, key=lambda item: (-item["score"], item["chunk_index"]))
    result = {"hits": ranked_hits, "max_score": ranked_hits[0]["score"]}
    retrieval_cache[ckey] = result
    return result


def select_sources(hits: list[dict], limit: int = 3) -> list[dict]:
    selected, seen = [], set()
    for hit in hits:
        if hit["source"] in seen: continue
        selected.append({"source": hit["source"], "score": round(hit["score"], 4), "preview": hit["document"][:220].strip()})
        seen.add(hit["source"])
        if len(selected) == limit: break
    return selected


def build_prompt(context: str, query: str, detailed: bool) -> str:
    style = "6. Detailed bullet list answer.\n7. Summarize items.\n8. Thorough context usage." if detailed else "6. Concise and practical."
    return f"Rules:\n1. Use context only.\n2. Insufficient? Answer '{NO_CONTEXT_ANSWER}'.\n3. No invention.\n4. Korean.\n5. Accurate.\n{style}\n\nContext:\n{context}\n\nQuestion:\n{query}"


def prepare_answer(query: str, model: str | None = None, history: list[dict] | None = None, user_id: str = "") -> dict:
    retrieval = retrieve_context(query, model=model, history=history, user_id=user_id)
    hits, max_score, detailed = retrieval["hits"], retrieval["max_score"], is_detailed_query(query)

    if max_score < RELEVANCE_THRESHOLD:
        return {"enough_context": False, "prompt": "", "context": "", "sources": [], "score": round(max_score, 4), "detailed": detailed}

    top_hits = hits[:6] if detailed else hits[:3]
    context = "\n\n".join(f"[Source: {hit['source']}]\n{hit['document']}" for hit in top_hits)
    return {"enough_context": True, "prompt": build_prompt(context, query, detailed), "context": context, "sources": select_sources(top_hits), "score": round(max_score, 4), "detailed": detailed}


def ask_rag(query: str, model: str | None = None, history: list[dict] | None = None, user_id: str = "") -> dict:
    key = cache_key(query, user_id)
    if key in query_cache: return query_cache[key]

    if is_meaningless(query):
        return {"answer": "이해하지 못했습니다.", "context": "", "sources": [], "score": 0.0}

    if is_greeting(query):
        res = ollama.chat(model=model or CHAT_MODEL_NAME, messages=[{"role": "user", "content": query}])
        return {"answer": res["message"]["content"], "context": "", "sources": [], "score": 0.0}
    
        # 🔥 추가 (여기 중요)
    if not should_retrieve(query):
        res = ollama.chat(model=model or CHAT_MODEL_NAME, messages=[{"role": "user", "content": query}])
        return {"answer": res["message"]["content"], "context": "", "sources": [], "score": 0.0}

    prepared = prepare_answer(query, model=model, history=history, user_id=user_id)

    if not prepared["enough_context"]:
        return {"answer": NO_CONTEXT_ANSWER, "context": "", "sources": [], "score": prepared["score"]}

    messages = [{"role": "system", "content": SYSTEM_MESSAGE}]
    if history: messages.extend(history[-5:])
    messages.append({"role": "user", "content": prepared["prompt"]})

    response = ollama.chat(model=model or CHAT_MODEL_NAME, messages=messages)
    result = {"answer": response["message"]["content"].strip(), "context": prepared["context"], "sources": prepared["sources"], "score": prepared["score"]}
    query_cache[key] = result
    return result


def ask_rag_stream(query: str, model: str | None = None, history: list[dict] | None = None, user_id: str = ""):
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
    
    if not should_retrieve(query):
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
    prepared = prepare_answer(query, model=model, history=history, user_id=user_id)
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
