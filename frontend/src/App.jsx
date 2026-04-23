import { useEffect, useRef, useState } from "react";
import "./App.css";

const API_BASE = "http://127.0.0.1:8000";

const QUICK_PROMPTS = [
  "방금 업로드한 문서 핵심만 요약해줘",
  "문서에 나온 주요 리스크를 정리해줘",
  "인덱싱된 문서 기준으로 할 일을 뽑아줘",
];

const INITIAL_STATS = {
  indexed_files: 0,
  total_chunks: 0,
  embed_model: "-",
  reranker_model: "-",
  chat_model: "-",
};

const WELCOME_MESSAGE =
  "인덱싱된 사내 문서에 대해 질문해보세요. 근거 문서와 검색 문맥까지 함께 보여드릴게요.";

const TEXT = {
  ready: "준비됐습니다.",
  thinking: "답변을 생성하고 있습니다...",
  answerReady: "답변이 준비됐습니다.",
  requestFailed: "요청 처리에 실패했습니다.",
  answerFailed: "답변을 불러오지 못했습니다.",
  uploadFailed: "업로드에 실패했습니다.",
  deleteFailed: "삭제에 실패했습니다.",
  dragIdle: "PDF 또는 TXT 파일을 끌어다 놓거나 클릭해서 업로드하세요.",
  dragActive: "여기에 파일을 놓으면 바로 인덱싱합니다.",
};

const readJson = async (response) => {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || data.message || TEXT.requestFailed);
  }
  return data;
};

const fetchSidebarData = async () => {
  const [filesRes, statsRes] = await Promise.all([
    fetch(`${API_BASE}/files-db`),
    fetch(`${API_BASE}/stats`),
  ]);
  const [filesData, statsData] = await Promise.all([readJson(filesRes), readJson(statsRes)]);
  return { files: filesData.files || [], stats: statsData };
};

const getExtension = (name) => name.split(".").pop()?.toUpperCase() || "DOC";

const formatScore = (score) => {
  if (score === null || score === undefined) return "-";
  return Number(score).toFixed(4);
};

/* ── Sub-components ───────────────────────────────────────── */

function TypingDots() {
  return (
    <span className="typing-dots" aria-label="입력 중">
      <span />
      <span />
      <span />
    </span>
  );
}

function ToastRegion({ toasts, onDismiss }) {
  return (
    <div className="toast-region" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`} role="alert">
          <span className="toast-msg">{t.message}</span>
          <button className="toast-close" onClick={() => onDismiss(t.id)} aria-label="닫기">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

function MessageCard({ message, isStreaming }) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";
  const showDots = !isUser && isStreaming && !message.content;

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <article className={`message-card ${isUser ? "user" : "assistant"}`}>
      <div className="msg-header">
        <span className="msg-role">{isUser ? "나" : "어시스턴트"}</span>
        {message.score !== null && message.score !== undefined && (
          <span className="msg-score">점수 {formatScore(message.score)}</span>
        )}
        {message.content && (
          <button className="msg-copy-btn" onClick={handleCopy} title="복사">
            {copied ? "✓ 복사됨" : "복사"}
          </button>
        )}
      </div>

      <div className="msg-body">
        {showDots ? <TypingDots /> : message.content}
      </div>

      {message.sources?.length > 0 && (
        <div className="source-list">
          <p className="source-header">참고 문서</p>
          {message.sources.map((src) => (
            <div key={`${message.id}-${src.source}`} className="source-card">
              <div className="source-top">
                <strong>{src.source}</strong>
                <span className="source-score">{formatScore(src.score)}</span>
              </div>
              <p className="source-preview">{src.preview}</p>
            </div>
          ))}
        </div>
      )}

      {message.context && (
        <details className="context-box">
          <summary>검색된 문맥 보기</summary>
          <pre>{message.context}</pre>
        </details>
      )}
    </article>
  );
}

/* ── App ──────────────────────────────────────────────────── */

function App() {
  const [messages, setMessages] = useState([
    {
      id: "welcome",
      role: "assistant",
      content: WELCOME_MESSAGE,
      sources: [],
      score: null,
      context: "",
    },
  ]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [files, setFiles] = useState([]);
  const [stats, setStats] = useState(INITIAL_STATS);
  const [statusMessage, setStatusMessage] = useState(TEXT.ready);
  const [dragActive, setDragActive] = useState(false);
  const [fileFilter, setFileFilter] = useState("");
  const [toasts, setToasts] = useState([]);

  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const messageIdRef = useRef(0);
  const toastIdRef = useRef(0);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchSidebarData();
        setFiles(data.files);
        setStats(data.stats);
      } catch (err) {
        addToast(err.message, "error");
      }
    })();
  }, []);

  /* Toast helpers */
  const addToast = (message, type = "info") => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => dismissToast(id), 4200);
  };

  const dismissToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const nextId = () => `msg-${++messageIdRef.current}`;

  const updateMessage = (id, updater) =>
    setMessages((prev) =>
      prev.map((m) =>
        m.id !== id ? m : typeof updater === "function" ? updater(m) : { ...m, ...updater },
      ),
    );

  const refreshSidebar = async () => {
    try {
      const data = await fetchSidebarData();
      setFiles(data.files);
      setStats(data.stats);
    } catch (err) {
      addToast(err.message, "error");
    }
  };

  const processStreamLine = (line, assistantId) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "chunk") {
      updateMessage(assistantId, (m) => ({ ...m, content: m.content + event.content }));
    } else if (event.type === "meta") {
      updateMessage(assistantId, {
        sources: event.sources || [],
        score: event.score ?? null,
        context: event.context || "",
      });
    }
  };

  const sendMessage = async (preset) => {
    const query = (preset ?? input).trim();
    if (!query || chatLoading) return;

    const userId = nextId();
    const assistantId = nextId();

    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", content: query, sources: [], score: null, context: "" },
      { id: assistantId, role: "assistant", content: "", sources: [], score: null, context: "" },
    ]);
    setInput("");
    setChatLoading(true);
    setStatusMessage(TEXT.thinking);

    try {
      const response = await fetch(`${API_BASE}/ask-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || data.message || TEXT.answerFailed);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) processStreamLine(line, assistantId);

        if (done) {
          if (buffer.trim()) processStreamLine(buffer, assistantId);
          break;
        }
      }

      setStatusMessage(TEXT.answerReady);
    } catch (err) {
      updateMessage(assistantId, {
        content: err.message || TEXT.answerFailed,
        sources: [],
        score: null,
        context: "",
      });
      addToast(err.message || TEXT.requestFailed, "error");
      setStatusMessage(err.message || TEXT.requestFailed);
    } finally {
      setChatLoading(false);
    }
  };

  const uploadFile = async (file) => {
    if (!file || uploading) return;

    const formData = new FormData();
    formData.append("file", file);

    setUploading(true);
    setStatusMessage(`${file.name} 업로드 중...`);

    try {
      const response = await fetch(`${API_BASE}/upload`, { method: "POST", body: formData });
      const data = await readJson(response);
      await refreshSidebar();
      addToast(`${data.file} 인덱싱 완료 (${data.chunks}개 청크)`, "success");
      setStatusMessage(`${data.file} 인덱싱 완료.`);
    } catch (err) {
      addToast(err.message || TEXT.uploadFailed, "error");
      setStatusMessage(err.message || TEXT.uploadFailed);
    } finally {
      setUploading(false);
      setDragActive(false);
    }
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    await uploadFile(file);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    await uploadFile(e.dataTransfer.files?.[0]);
  };

  const deleteFile = async (name) => {
    if (!window.confirm(`${name} 파일을 삭제할까요?`)) return;

    setStatusMessage(`${name} 삭제 중...`);

    try {
      const response = await fetch(`${API_BASE}/file?name=${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      const data = await readJson(response);
      await refreshSidebar();
      addToast(`${data.file} 삭제됨 (${data.deleted_chunks}개 청크 제거)`, "success");
      setStatusMessage(`${data.file} 삭제 완료.`);
    } catch (err) {
      addToast(err.message || TEXT.deleteFailed, "error");
      setStatusMessage(err.message || TEXT.deleteFailed);
    }
  };

  const resetChat = () => {
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        content: WELCOME_MESSAGE,
        sources: [],
        score: null,
        context: "",
      },
    ]);
    setStatusMessage(TEXT.ready);
  };

  const filteredFiles = files.filter((f) =>
    f.toLowerCase().includes(fileFilter.trim().toLowerCase()),
  );

  const libraryDensity =
    stats.indexed_files > 0
      ? `${Math.max(1, Math.round(stats.total_chunks / stats.indexed_files))}청크/문서`
      : "비어 있음";

  /* ── Render ─────────────────────────────────────────────── */
  return (
    <div className="app-shell">
      <ToastRegion toasts={toasts} onDismiss={dismissToast} />

      {/* Top Bar */}
      <header className="top-bar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 1L14 4.5V11.5L8 15L2 11.5V4.5L8 1Z" fill="white" fillOpacity="0.9" />
              <path d="M8 5L11 6.75V10.25L8 12L5 10.25V6.75L8 5Z" fill="white" fillOpacity="0.35" />
            </svg>
          </div>
          <span className="brand-name">RAG Workspace</span>
        </div>

        <div className="top-sep" aria-hidden="true" />

        <div className="top-stats">
          <div className="stat-pill">
            <span className="stat-pill-label">문서</span>
            <strong className="stat-pill-val">{stats.indexed_files}</strong>
          </div>
          <div className="stat-pill">
            <span className="stat-pill-label">청크</span>
            <strong className="stat-pill-val">{stats.total_chunks}</strong>
          </div>
          <div className="stat-pill">
            <span className="stat-pill-label">모델</span>
            <strong className="stat-pill-val">{stats.chat_model}</strong>
          </div>
        </div>

        <div className={`top-live ${chatLoading ? "streaming" : ""}`} aria-live="polite">
          <span className="live-dot" />
          <span>{chatLoading ? "생성 중" : "대기 중"}</span>
        </div>
      </header>

      {/* Workspace */}
      <main className="workspace">
        {/* Chat Panel */}
        <section className="chat-panel" aria-label="문서 채팅">
          <div className="chat-panel-head">
            <div className="chat-panel-title">
              <h2>문서 채팅</h2>
              <p>스트리밍 응답 · 근거 문서 표시 · 문맥 검색</p>
            </div>
            <button type="button" className="btn-ghost" onClick={resetChat}>
              채팅 초기화
            </button>
          </div>

          <div className="chat-feed" role="log" aria-live="polite" aria-label="채팅 메시지">
            {messages.map((message, idx) => (
              <MessageCard
                key={message.id}
                message={message}
                isStreaming={chatLoading && idx === messages.length - 1}
              />
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Quick Prompts */}
          <div className="quick-prompts" role="group" aria-label="빠른 질문">
            {QUICK_PROMPTS.map((prompt, i) => (
              <button
                key={prompt}
                type="button"
                className="quick-chip"
                onClick={() => sendMessage(prompt)}
                disabled={chatLoading}
              >
                <span className="quick-num">0{i + 1}</span>
                <span>{prompt}</span>
              </button>
            ))}
          </div>

          {/* Composer */}
          <div className="composer">
            <div className="composer-box">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder="정책, 가이드, 사내 문서에 대해 질문해보세요..."
                disabled={chatLoading}
                rows={3}
                aria-label="질문 입력"
              />
              <div className="composer-footer">
                <span className="composer-status">{statusMessage}</span>
                <div className="composer-actions">
                  <span className="key-hint">Shift+Enter 줄바꿈</span>
                  <button
                    type="button"
                    className="btn-send"
                    onClick={() => sendMessage()}
                    disabled={chatLoading || !input.trim()}
                  >
                    {chatLoading ? "생성 중..." : "보내기"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Side Panel */}
        <aside className="side-panel" aria-label="문서 관리">
          {/* Upload */}
          <div className="side-section">
            <div className="side-head">
              <h3>문서 업로드</h3>
              <span className="badge">{stats.indexed_files}개 인덱싱됨</span>
            </div>
            <button
              type="button"
              className={`upload-zone ${dragActive ? "drag-over" : ""} ${uploading ? "uploading" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                if (!e.currentTarget.contains(e.relatedTarget)) setDragActive(false);
              }}
              onDrop={handleDrop}
              disabled={uploading}
              aria-label="파일 업로드 영역. 클릭하거나 파일을 끌어다 놓으세요."
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt"
                onChange={handleUpload}
                disabled={uploading}
                hidden
              />
              <div className="upload-icon" aria-hidden="true">
                {uploading ? "⟳" : "↑"}
              </div>
              <strong>{uploading ? "인덱싱 중..." : "파일 업로드"}</strong>
              <p>{dragActive ? TEXT.dragActive : TEXT.dragIdle}</p>
              <span className="upload-formats">PDF · TXT</span>
            </button>
          </div>

          {/* File Manager */}
          <div className="side-section">
            <div className="side-head">
              <h3>지식 베이스</h3>
              <span className="badge badge-neutral">{libraryDensity}</span>
            </div>
            <div className="file-search">
              <input
                type="text"
                value={fileFilter}
                onChange={(e) => setFileFilter(e.target.value)}
                placeholder="파일명으로 찾기..."
                aria-label="문서 검색"
              />
            </div>
            <div className="file-list" role="list" aria-label="인덱싱된 문서 목록">
              {filteredFiles.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-icon" aria-hidden="true">
                    {files.length === 0 ? "◎" : "⊘"}
                  </span>
                  {files.length === 0 ? (
                    <>
                      <p>아직 인덱싱된 문서가 없습니다.</p>
                      <p>위에서 파일을 업로드해보세요.</p>
                    </>
                  ) : (
                    <p>검색 조건에 맞는 문서가 없습니다.</p>
                  )}
                </div>
              ) : (
                filteredFiles.map((file) => (
                  <div key={file} className="file-item" role="listitem">
                    <div className="file-ext" aria-hidden="true">
                      {getExtension(file)}
                    </div>
                    <span className="file-name" title={file}>
                      {file}
                    </span>
                    <button
                      type="button"
                      className="btn-del"
                      onClick={() => deleteFile(file)}
                      aria-label={`${file} 삭제`}
                      title="삭제"
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Model Info */}
          <div className="model-info" aria-label="모델 정보">
            <p className="model-info-label">사용 중인 모델</p>
            <div className="model-row">
              <span className="model-row-label">Chat</span>
              <span className="model-row-val">{stats.chat_model}</span>
            </div>
            <div className="model-divider" aria-hidden="true" />
            <div className="model-row">
              <span className="model-row-label">Rerank</span>
              <span className="model-row-val">{stats.reranker_model}</span>
            </div>
            <div className="model-divider" aria-hidden="true" />
            <div className="model-row">
              <span className="model-row-label">Embed</span>
              <span className="model-row-val">{stats.embed_model}</span>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

export default App;
