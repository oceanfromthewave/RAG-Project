from __future__ import annotations

import math
import re

import ollama

from backend.store import CHAT_MODEL_NAME, get_collection, get_embed_model, get_reranker

RELEVANCE_THRESHOLD = 0.35
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


def cache_key(query: str) -> str:
    return f"{RESPONSE_PROFILE_VERSION}:{query.strip()}"


def is_detailed_query(query: str) -> bool:
    normalized = query.lower().strip()
    keywords = [
        "할 일",
        "체크리스트",
        "단계",
        "절차",
        "해야 할",
        "액션 아이템",
        "업무",
        "정리해줘",
        "리스트",
        "todo",
        "to-do",
        "checklist",
        "action item",
        "steps",
        "tasks",
    ]
    return any(keyword in normalized for keyword in keywords)


def is_greeting(query: str) -> bool:
    # 일상적인 인사말 패턴 감지
    normalized = query.lower().strip()
    greetings = [
        "안녕", "ㅎㅇ", "하이", "반가워", "hello", "hi", "hey",
        "누구야", "뭐해", "반가워요", "좋은 아침", "좋은 점심", "좋은 저녁", "반갑다",
        "고마워", "감사", "수고", "바이", "잘가", "잘 자"
    ]
    # 질문이 매우 짧고 인사말을 포함하는지 확인
    return len(normalized) <= 15 and any(g in normalized for g in greetings)


def is_meaningless(query: str) -> bool:
    # 1. 너무 짧은 경우 (공백 제외 1글자 등)
    text = query.strip()
    if len(text) <= 1:
        return True
    
    # 2. 자음/모음만 반복되는 경우 (ㅋㅋㅋ, ㅎㅎㅎ, ㄱㄱㄱ 등)
    if re.match(r"^[ㄱ-ㅎㅏ-ㅣ\s!?.~^]+$", text):
        return True
        
    # 3. 의미 없는 영문/숫자 반복 (asdasd, 123123 등)
    if re.match(r"^[a-zA-Z0-9\s!?.~^]+$", text):
        # 모음이 하나도 없는 영문은 무의미한 문자열일 확률이 높음 (인사말 'hi' 등 제외)
        if len(text) > 3 and not re.search(r"[aeiouAEIOU]", text):
            return True
        # 숫자로만 된 경우
        if text.isdigit() and len(text) > 4:
            return True
            
    # 4. 키보드 연타 패턴 (qwerty, asdfgh 등)
    if any(seq in text.lower() for seq in ["asdf", "qwer", "zxcv"]):
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
    
    # 대화 내역이 있는 경우, 내역을 바탕으로 질문을 독립적인 문장으로 재작성
    if history:
        history_text = "\n".join([f"{m['role']}: {m['content']}" for m in history[-3:]]) # 최근 3개 대화만 참고
        prompt = f"""
Given the following conversation history and a follow-up question, rephrase the follow-up question to be a standalone search query.
If the question is already specific, keep it as is.

History:
{history_text}

Follow-up Question: {query}
Standalone Search Query:
""".strip()
    else:
        prompt = f"""
Rewrite the following question into a short search-friendly query.
Keep the meaning, remove filler words, and stay specific.

Question:
{query}

Rewritten:
""".strip()

    response = ollama.chat(
        model=target_model,
        messages=[{"role": "user", "content": prompt}],
        options={"temperature": 0.1},
    )

    rewritten = response["message"]["content"].strip() or query
    rewrite_cache[query] = rewritten
    return rewritten


def retrieve_context(query: str, model: str | None = None, history: list[dict] | None = None) -> dict:
    if query in retrieval_cache:
        return retrieval_cache[query]

    collection = get_collection()
    if collection.count() == 0:
        result = {"hits": [], "max_score": 0.0}
        retrieval_cache[query] = result
        return result

    candidates = {}

    for current_query in [query, rewrite_query(query, model=model, history=history)]:
        results = collection.query(
            query_embeddings=[get_embedding(current_query)],
            n_results=5,
            include=["documents", "metadatas"],
        )

        documents = (results.get("documents") or [[]])[0]
        metadatas = (results.get("metadatas") or [[]])[0]

        for document, metadata in zip(documents, metadatas):
            if not document:
                continue

            source = (metadata or {}).get("source", "unknown")
            chunk_index = (metadata or {}).get("chunk_index", -1)
            key = (source, chunk_index, document)
            candidates[key] = {
                "document": document,
                "source": source,
                "chunk_index": chunk_index,
            }

    if not candidates:
        result = {"hits": [], "max_score": 0.0}
        retrieval_cache[query] = result
        return result

    hits = list(candidates.values())
    scores = get_reranker().predict([[query, hit["document"]] for hit in hits])

    for hit, score in zip(hits, scores):
        hit["score"] = 1 / (1 + math.exp(-float(score)))

    ranked_hits = sorted(hits, key=lambda item: (-item["score"], item["chunk_index"]))
    result = {"hits": ranked_hits, "max_score": ranked_hits[0]["score"]}
    retrieval_cache[query] = result
    return result


def select_sources(hits: list[dict], limit: int = 3) -> list[dict]:
    selected = []
    seen = set()

    for hit in hits:
        if hit["source"] in seen:
            continue

        selected.append(
            {
                "source": hit["source"],
                "score": round(hit["score"], 4),
                "preview": hit["document"][:220].strip(),
            }
        )
        seen.add(hit["source"])

        if len(selected) == limit:
            break

    return selected


def build_prompt(context: str, query: str, detailed: bool) -> str:
    style_rule = (
        "6. If the user asks for action items, tasks, steps, checklist, or what to do, "
        "answer as a detailed bullet list with grouped items when possible.\n"
        "7. Prefer summarizing the practical work items instead of copying raw lines.\n"
        "8. Do not stop after a few bullets if the context clearly contains more relevant items."
        if detailed
        else
        "6. Keep the answer concise and practical."
    )

    return f"""
Rules:
1. Use only the information in the context.
2. If the context is insufficient, answer exactly "{NO_CONTEXT_ANSWER}".
3. Do not invent facts.
4. Answer in Korean unless the user explicitly requested another language.
5. Make the answer accurate and easy to scan.
{style_rule}

Context:
{context}

Question:
{query}
""".strip()


def prepare_answer(query: str, model: str | None = None, history: list[dict] | None = None) -> dict:
    retrieval = retrieve_context(query, model=model, history=history)
    hits = retrieval["hits"]
    max_score = retrieval["max_score"]
    detailed = is_detailed_query(query)

    if max_score < RELEVANCE_THRESHOLD:
        return {
            "enough_context": False,
            "prompt": "",
            "context": "",
            "sources": [],
            "score": round(max_score, 4),
            "detailed": detailed,
        }

    top_hits = hits[:6] if detailed else hits[:3]
    context = "\n\n".join(f"[Source: {hit['source']}]\n{hit['document']}" for hit in top_hits)

    return {
        "enough_context": True,
        "prompt": build_prompt(context, query, detailed),
        "context": context,
        "sources": select_sources(top_hits),
        "score": round(max_score, 4),
        "detailed": detailed,
    }


def ask_rag(query: str, model: str | None = None, history: list[dict] | None = None) -> dict:
    key = cache_key(query)
    if key in query_cache:
        return query_cache[key]

    target_model = model or CHAT_MODEL_NAME

    # 1. 무의미한 입력 처리
    if is_meaningless(query):
        result = {
            "answer": "죄송합니다. 입력하신 내용을 이해하지 못했습니다. 질문을 구체적으로 입력해주시면 답변을 도와드릴 수 있습니다.",
            "context": "",
            "sources": [],
            "score": 0.0,
        }
        query_cache[key] = result
        return result

    # 2. 인사말인 경우 RAG를 생략하고 바로 답변
    if is_greeting(query):
        messages = [
            {"role": "system", "content": SYSTEM_MESSAGE},
        ]
        if history:
            messages.extend(history[-3:])
        messages.append({"role": "user", "content": query})
        
        response = ollama.chat(model=target_model, messages=messages)
        result = {
            "answer": response["message"]["content"].strip(),
            "context": "",
            "sources": [],
            "score": 0.0,
        }
        query_cache[key] = result
        return result

    prepared = prepare_answer(query, model=model, history=history)

    if not prepared["enough_context"]:
        result = {
            "answer": NO_CONTEXT_ANSWER,
            "context": "",
            "sources": [],
            "score": prepared["score"],
        }
        query_cache[key] = result
        return result

    # 대화 내역 구성 (시스템 메시지 + 히스토리 + 현재 질문)
    messages = [{"role": "system", "content": SYSTEM_MESSAGE}]
    if history:
        messages.extend(history[-5:]) # 최근 5개 대화만 포함
    messages.append({"role": "user", "content": prepared["prompt"]})

    response = ollama.chat(
        model=target_model,
        messages=messages,
        options=DETAILED_GENERATION_OPTIONS if prepared["detailed"] else DEFAULT_GENERATION_OPTIONS,
    )

    result = {
        "answer": response["message"]["content"].strip(),
        "context": prepared["context"],
        "sources": prepared["sources"],
        "score": prepared["score"],
        "done_reason": response.get("done_reason"),
        "truncated": response.get("done_reason") == "length",
    }
    query_cache[key] = result
    return result


def ask_rag_stream(query: str, model: str | None = None, history: list[dict] | None = None):
    target_model = model or CHAT_MODEL_NAME

    # 1. 무의미한 입력 처리
    if is_meaningless(query):
        yield {"type": "status", "state": "thinking"}
        yield {"type": "meta", "sources": [], "context": "", "score": 0.0}
        yield {"type": "chunk", "content": "죄송합니다. 입력하신 내용을 이해하지 못했습니다. 질문을 구체적으로 입력해주시면 답변을 도와드릴 수 있습니다."}
        return

    # 2. 인사말인 경우 RAG를 생략하고 스트리밍 답변
    if is_greeting(query):
        yield {"type": "status", "state": "thinking"}
        yield {"type": "meta", "sources": [], "context": "", "score": 0.0}
        messages = [
            {"role": "system", "content": SYSTEM_MESSAGE},
        ]
        if history:
            messages.extend(history[-3:])
        messages.append({"role": "user", "content": query})

        stream = ollama.chat(model=target_model, messages=messages, stream=True)
        for chunk in stream:
            content = chunk.get("message", {}).get("content", "")
            if content:
                yield {"type": "chunk", "content": content}
        return

    # 3. RAG 처리 - 검색 시작 알림
    yield {"type": "status", "state": "searching"}

    prepared = prepare_answer(query, model=model, history=history)

    # 메타 정보(검색 결과 등)를 답변 생성 전에 먼저 전송하여 세션 전환 시에도 정보가 보존되도록 함
    meta = {
        "type": "meta",
        "sources": prepared["sources"],
        "context": prepared["context"],
        "score": prepared["score"],
    }
    yield meta

    if not prepared["enough_context"]:
        yield {"type": "chunk", "content": NO_CONTEXT_ANSWER}
        return

    # 대화 내역 구성
    messages = [{"role": "system", "content": SYSTEM_MESSAGE}]
    if history:
        messages.extend(history[-5:])
    messages.append({"role": "user", "content": prepared["prompt"]})

    stream = ollama.chat(
        model=target_model,
        messages=messages,
        stream=True,
        options=DETAILED_GENERATION_OPTIONS if prepared["detailed"] else DEFAULT_GENERATION_OPTIONS,
    )

    for chunk in stream:
        content = chunk.get("message", {}).get("content", "")
        if content:
            yield {"type": "chunk", "content": content}

