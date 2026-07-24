# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A full-stack RAG (Retrieval-Augmented Generation) system for chatting with local documents. FastAPI backend + React/Vite frontend. All LLM inference runs locally via **Ollama** — no external API calls for chat.

## Commands

### Backend
```bash
# Install dependencies (Python 3.10+)
pip install -r requirements.txt

# Run dev server (from repo root)
uvicorn backend.main:app --reload

# Manual ingest from data/docs/ directory (legacy, UI upload is preferred)
python -m backend.ingest

# Reset vector DB only (preserves history.db and users.db)
python scripts/reset_vectordb.py
```

### Frontend
```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run build
npm run lint       # ESLint
```

### Health check
```
GET http://localhost:8000/health   # returns ollama + chromadb + history_db status
```

## Environment

Copy `.env.example` to `.env`. Key variables:
- `CHAT_MODEL_NAME` — Ollama model to use (default: `mistral`)
- `EMBED_MODEL_NAME` — sentence-transformers embedding model (default: `paraphrase-multilingual-MiniLM-L12-v2`)
- `RERANK_MODEL_NAME` — cross-encoder reranker (default: `cross-encoder/ms-marco-MiniLM-L-6-v2`)
- `JWT_SECRET_KEY` — **required in production**; auto-generated (ephemeral) in development
- `APP_ENV=production` enables: JWT secret enforcement, registration disabled by default

**Important:** If `EMBED_MODEL_NAME` is changed, existing vectors become incompatible. Run `python scripts/reset_vectordb.py` then re-upload documents before restarting the server.

## Architecture

### Backend (`backend/`)

| File | Responsibility |
|------|---------------|
| `main.py` | FastAPI app, all HTTP endpoints, rate limiting, streaming |
| `rag.py` | Retrieval pipeline: query rewrite → hybrid search → rerank → context compress → LLM |
| `store.py` | ChromaDB client, embedding model, chunking, document I/O |
| `history.py` | SQLite: sessions, messages, workspaces, document_summaries |
| `auth.py` | JWT tokens, bcrypt passwords, user CRUD (`db/users.db`) |
| `security.py` | In-memory rate limiters (`RateLimiter`) and brute-force guard (`LoginGuard`) |

**RAG pipeline flow** (`rag.py`):
1. `should_retrieve()` — skip retrieval for greetings / trivial inputs
2. `prepare_answer()` — checks pre-computed document summary first for single-file summary requests
3. `retrieve_context()` — vector search via ChromaDB + optional query rewrite; deduplicates candidates
4. Cross-encoder reranking + BM25 hybrid scoring (70% reranker, 30% BM25)
5. `_enrich_with_adjacent()` — adds ±1 chunks around each hit for context continuity
6. `_compress_context()` — trims low-score chunks to 200 chars
7. `build_prompt()` — injects `[1]`, `[2]` citation indices into context
8. Streaming response via `ask_rag_stream()` yields NDJSON: `status` → `meta` → `chunk`... → `suggestions`

**Collection naming:** The ChromaDB collection name is derived from `EMBED_MODEL_NAME` (e.g., `docs_paraphrase_multilingual_MiniLM_L12_v2_v1`). Changing the model automatically creates a new empty collection.

**Document summaries:** On upload, a background thread (`threading.Thread(daemon=True)`) generates a summary via LLM and stores it in `history.db` `document_summaries` table. Used to fast-path "summarize this document" queries.

**Rate limits** (in-memory, reset on restart — except login guard):
- Login: 10/min, with 5-failure lockout for 15 min (persisted to `db/login_guard.db`)
- Ask/stream: 30/min
- Upload: 10/5min

### Frontend (`frontend/src/`)

Single-page React app. All state lives in the `useRag` hook (`useRag.js`) — it handles API calls, streaming, sessions, files, and UI state.

**Stream event types** from `/ask-stream` (NDJSON):
- `session` — new session created, contains `session_id`
- `status` — `{state: "searching"}` shown as thinking indicator
- `meta` — sources, score, context (arrives before chunks)
- `chunk` — text delta to append
- `message_id` — server-assigned message ID after save
- `suggestions` — follow-up question suggestions

**Key components:**
- `App.jsx` — auth wrapper, `AuthContext`
- `Workspace.jsx` — top-level layout, passes `useRag` props down
- `ChatPanel.jsx` — message list + input composer
- `SidePanel.jsx` — file list, upload, tags
- `HistorySidebar.jsx` — session list, workspace switcher
- `useRag.js` — all logic (no business logic in components)

### Databases

All in `db/`:
- `users.db` — `users` table (bcrypt passwords, JWT auth)
- `history.db` — `sessions`, `messages`, `workspaces`, `document_summaries`
- `chroma.sqlite3` — ChromaDB vector store (managed by chromadb library)

Each user's documents are isolated in `data/docs/{user_id}/` and filtered in ChromaDB via `user_id` metadata field.

## Known issues / planned work

- Scanned PDF (image-only) not supported — `pypdf` extracts text only
- `chunk_text()` uses fixed size/overlap — doesn't respect table/code block boundaries
- RateLimiter counters (ask, upload, register) are still in-memory — only LoginGuard is persisted
