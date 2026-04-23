from __future__ import annotations

import math
import re

import ollama

from backend.store import CHAT_MODEL_NAME, get_collection, get_embed_model, get_reranker

RELEVANCE_THRESHOLD = 0.3
NO_CONTEXT_ANSWER = "\uc778\ub371\uc2f1\ub41c \ubb38\uc11c\uc5d0\uc11c \ucc3e\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4."
SYSTEM_MESSAGE = (
    "You are an internal document assistant. "
    "Unless the user explicitly asks for another language, always answer in Korean."
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


def get_embedding(text: str) -> list[float]:
    if text in embedding_cache:
        return embedding_cache[text]

    embedding = get_embed_model().encode(text).tolist()
    embedding_cache[text] = embedding
    return embedding


def rewrite_query(query: str) -> str:
    if query in rewrite_cache:
        return rewrite_cache[query]

    prompt = f"""
Rewrite the following question into a short search-friendly query.
Keep the meaning, remove filler words, and stay specific.

Question:
{query}

Rewritten:
""".strip()

    response = ollama.chat(
        model=CHAT_MODEL_NAME,
        messages=[{"role": "user", "content": prompt}],
        options={"temperature": 0.1},
    )

    rewritten = response["message"]["content"].strip() or query
    rewrite_cache[query] = rewritten
    return rewritten


def retrieve_context(query: str) -> dict:
    if query in retrieval_cache:
        return retrieval_cache[query]

    collection = get_collection()
    if collection.count() == 0:
        result = {"hits": [], "max_score": 0.0}
        retrieval_cache[query] = result
        return result

    candidates = {}

    for current_query in [query, rewrite_query(query)]:
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


def prepare_answer(query: str) -> dict:
    retrieval = retrieve_context(query)
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


def ask_rag(query: str) -> dict:
    key = cache_key(query)
    if key in query_cache:
        return query_cache[key]

    prepared = prepare_answer(query)

    if not prepared["enough_context"]:
        result = {
            "answer": NO_CONTEXT_ANSWER,
            "context": "",
            "sources": [],
            "score": prepared["score"],
        }
        query_cache[key] = result
        return result

    response = ollama.chat(
        model=CHAT_MODEL_NAME,
        messages=[
            {"role": "system", "content": SYSTEM_MESSAGE},
            {"role": "user", "content": prepared["prompt"]},
        ],
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


def ask_rag_stream(query: str):
    prepared = prepare_answer(query)

    if not prepared["enough_context"]:
        yield {"type": "chunk", "content": NO_CONTEXT_ANSWER}
        yield {
            "type": "meta",
            "sources": [],
            "context": "",
            "score": prepared["score"],
        }
        return

    stream = ollama.chat(
        model=CHAT_MODEL_NAME,
        messages=[
            {"role": "system", "content": SYSTEM_MESSAGE},
            {"role": "user", "content": prepared["prompt"]},
        ],
        stream=True,
        options=DETAILED_GENERATION_OPTIONS if prepared["detailed"] else DEFAULT_GENERATION_OPTIONS,
    )

    done_reason = None
    for chunk in stream:
        content = chunk.get("message", {}).get("content", "")
        if chunk.get("done"):
            done_reason = chunk.get("done_reason")
        if content:
            yield {"type": "chunk", "content": content}

    yield {
        "type": "meta",
        "sources": prepared["sources"],
        "context": prepared["context"],
        "score": prepared["score"],
        "done_reason": done_reason,
        "truncated": done_reason == "length",
    }
