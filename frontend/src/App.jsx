import { useEffect, useRef, useState } from "react";
import "./App.css";
import { useAuth } from "./AuthContext";
import LoginPage from "./LoginPage";

const API_BASE = "http://127.0.0.1:8000";

const QUICK_PROMPTS = [
  "방금 업로드한 문서 핵심만 요약해줘",
  "문서에 나온 주요 리스크를 정리해줘",
  "인덱싱된 문서 기준으로 할 일을 뽑아줘",
  "현재 프로젝트의 전체 일정을 요약해줘",
  "기술 요구사항 중 누락된 부분이 있는지 확인해줘",
  "보안 가이드라인 위반 사례를 찾아줘",
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

const formatScore = (score) => {
  if (score === null || score === undefined) return "-";
  return Number(score).toFixed(4);
};

const getExtension = (name) => name.split(".").pop()?.toUpperCase() || "DOC";

/* ── Sub-components ───────────────────────────────────────── */

function TypingDots() {
  return (
    <span className="typing-dots" aria-label="입력 중">
      <span /><span /><span />
    </span>
  );
}

function ConfirmModal({ isOpen, title, message, onConfirm, onCancel }) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      } else if (e.key === "Escape") {
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onConfirm, onCancel]);

  if (!isOpen) return null;
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-container" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h3>{title}</h3></div>
        <div className="modal-body"><p>{message}</p></div>
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onCancel}>취소</button>
          <button type="button" className="btn-danger" onClick={onConfirm} autoFocus>삭제</button>
        </div>
      </div>
    </div>
  );
}

function ToastRegion({ toasts, onDismiss }) {
  return (
    <div className="toast-region" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast ${t.type} ${t.onClick ? "clickable" : ""}`}
          role="alert"
          onClick={() => { if (t.onClick) { t.onClick(); onDismiss(t.id); } }}
        >
          <span className="toast-msg">{t.message}</span>
          <button
            className="toast-close"
            onClick={(e) => { e.stopPropagation(); onDismiss(t.id); }}
            aria-label="닫기"
          >✕</button>
        </div>
      ))}
    </div>
  );
}

function MessageCard({ message, isStreaming }) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";
  const showThinking = !isUser && isStreaming && message.isSearching;
  const showDots = !isUser && isStreaming && !message.isSearching && !message.content;

  const handleCopy = () => {
    if (!message.content) return;
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
          <span className="msg-score">신뢰도 {formatScore(message.score)}</span>
        )}
        {!isUser && message.content && (
          <button className="msg-copy-btn" onClick={handleCopy} title="복사">
            {copied ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            )}
          </button>
        )}
      </div>

      <div className="msg-body">
        {showThinking && (
          <div className="thinking-step">
            <TypingDots />
            <span className="thinking-text">문서에서 답변을 찾는 중...</span>
          </div>
        )}
        {showDots && <TypingDots />}
        {(!isUser && !message.content && !showThinking && !showDots) ? (
          <span style={{ opacity: 0.5, fontStyle: "italic" }}>
            {message.sources?.length > 0 ? "답변을 불러오지 못했습니다." : "요청이 처리되지 않았습니다."}
          </span>
        ) : message.content}
      </div>

      {message.sources?.length > 0 && (
        <div className="source-section">
          <span className="source-header">참고 문서 {message.sources.length}</span>
          <div className="source-grid">
            {message.sources.map((src, i) => (
              <div key={`${message.id}-src-${i}`} className="source-card" title={src.preview}>
                <div className="source-top">
                  <strong>{src.source}</strong>
                  <span className="source-score">{formatScore(src.score)}</span>
                </div>
                <p className="source-preview">{src.preview}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {message.context && (
        <details className="context-box">
          <summary>검색 문맥 정보</summary>
          <pre>{message.context}</pre>
        </details>
      )}
    </article>
  );
}

/* ── App ──────────────────────────────────────────────────── */

function App() {
  const { token, user, logout, authFetch } = useAuth();

  // 로그인 안 된 경우 LoginPage 표시
  if (!token) return <LoginPage />;

  return <AuthenticatedApp authFetch={authFetch} user={user} logout={logout} />;
}

function AuthenticatedApp({ authFetch, user, logout }) {
  const [messages, setMessages] = useState([
    { id: "welcome", role: "assistant", content: WELCOME_MESSAGE, sources: [], score: null, context: "", isSearching: false },
  ]);
  const [input, setInput]               = useState("");
  const [chatLoading, setChatLoading]   = useState(false);
  const [uploading, setUploading]       = useState(false);
  const [files, setFiles]               = useState([]);
  const [stats, setStats]               = useState(INITIAL_STATS);
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModel, setSelectedModel]     = useState("");
  const [sessions, setSessions]         = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [statusMessage, setStatusMessage]       = useState(TEXT.ready);
  const [dragActive, setDragActive]     = useState(false);
  const [fileFilter, setFileFilter]     = useState("");
  const [toasts, setToasts]             = useState([]);
  const [confirmData, setConfirmData]   = useState({ isOpen: false, title: "", message: "", onConfirm: null });
  const [sidebarOpen, setSidebarOpen]   = useState(true);
  const [streamingMessages, setStreamingMessages] = useState({});

  const chatEndRef      = useRef(null);
  const fileInputRef    = useRef(null);
  const quickPromptsRef = useRef(null);
  const textareaRef     = useRef(null);
  const activeStreamsRef = useRef(new Map());
  const messageIdRef    = useRef(0);
  const toastIdRef      = useRef(0);

  /* ── Toast ── */
  const dismissToast = (id) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const addToast = (message, type = "info", onClick = null) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type, onClick }]);
    setTimeout(() => dismissToast(id), 6000);
  };

  const nextId = () => `msg-${++messageIdRef.current}`;

  const updateMessage = (id, updater) =>
    setMessages((prev) =>
      prev.map((m) => m.id !== id ? m : typeof updater === "function" ? updater(m) : { ...m, ...updater })
    );

  /* ── Drag-to-scroll for Quick Prompts ── */
  useEffect(() => {
    const slider = quickPromptsRef.current;
    if (!slider) return;

    let isDown = false, startX, scrollLeft, hasMoved = false;

    const start = (e) => {
      isDown = true; hasMoved = false;
      slider.classList.add("active");
      startX = (e.pageX || e.touches?.[0]?.pageX) - slider.offsetLeft;
      scrollLeft = slider.scrollLeft;
    };
    const end = () => { isDown = false; slider.classList.remove("active"); };
    const move = (e) => {
      if (!isDown) return;
      const x = (e.pageX || e.touches?.[0]?.pageX) - slider.offsetLeft;
      const walk = (x - startX) * 1.5;
      if (Math.abs(walk) > 3) hasMoved = true;
      if (hasMoved) { e.preventDefault(); slider.scrollLeft = scrollLeft - walk; }
    };
    const preventClick = (e) => { if (hasMoved) { e.stopImmediatePropagation(); e.preventDefault(); hasMoved = false; } };

    slider.addEventListener("mousedown", start);
    slider.addEventListener("mousemove", move);
    slider.addEventListener("mouseup", end);
    slider.addEventListener("mouseleave", end);
    slider.addEventListener("touchstart", start, { passive: true });
    slider.addEventListener("touchmove", move, { passive: false });
    slider.addEventListener("touchend", end);
    slider.addEventListener("click", preventClick, true);

    textareaRef.current?.focus();

    return () => {
      slider.removeEventListener("mousedown", start);
      slider.removeEventListener("mousemove", move);
      slider.removeEventListener("mouseup", end);
      slider.removeEventListener("mouseleave", end);
      slider.removeEventListener("touchstart", start);
      slider.removeEventListener("touchmove", move);
      slider.removeEventListener("touchend", end);
      slider.removeEventListener("click", preventClick, true);
    };
  }, []);

  /* ── Auto-scroll ── */
  useEffect(() => {
    const chatFeed = chatEndRef.current?.parentElement;
    if (!chatFeed) return;
    const isAtBottom = chatFeed.scrollHeight - chatFeed.scrollTop - chatFeed.clientHeight < 300;
    if (isAtBottom) chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* ── 인증 포함 JSON 응답 유틸 ── */
  const readJson = async (response) => {
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || data.message || TEXT.requestFailed);
    return data;
  };

  const fetchSidebarData = async () => {
    const [filesRes, statsRes] = await Promise.all([
      authFetch(`${API_BASE}/files-db`),
      authFetch(`${API_BASE}/stats`),
    ]);
    const [filesData, statsData] = await Promise.all([readJson(filesRes), readJson(statsRes)]);
    return { files: filesData.files || [], stats: statsData };
  };

  /* ── 초기 데이터 로드 ── */
  useEffect(() => {
    (async () => {
      try {
        const data = await fetchSidebarData();
        setFiles(data.files);
        setStats(data.stats);
        if (!selectedModel) setSelectedModel(data.stats.chat_model);

        const modelsRes = await authFetch(`${API_BASE}/models`);
        const modelsData = await readJson(modelsRes);
        setAvailableModels(modelsData.models || []);

        const sessionsRes = await authFetch(`${API_BASE}/sessions`);
        const sessionsData = await readJson(sessionsRes);
        setSessions(sessionsData.sessions || []);
      } catch (err) {
        addToast(err.message, "error");
      }
    })();
  }, []);

  const refreshSidebar = async () => {
    try {
      const data = await fetchSidebarData();
      setFiles(data.files);
      setStats(data.stats);

      const sessionsRes = await authFetch(`${API_BASE}/sessions`);
      const sessionsData = await readJson(sessionsRes);
      setSessions(sessionsData.sessions || []);
    } catch (err) {
      addToast(err.message, "error");
    }
  };

  const loadSession = async (sessionId) => {
    if (sessionId === currentSessionId) return;

    const isRunning = activeStreamsRef.current.has(sessionId);
    setChatLoading(isRunning);
    setStatusMessage(isRunning ? TEXT.thinking : TEXT.ready);

    try {
      const res = await authFetch(`${API_BASE}/sessions/${sessionId}`);
      const data = await readJson(res);

      let formattedMessages = data.messages.map(m => ({
        id: m.id, role: m.role, content: m.content,
        sources: m.sources || [], score: m.score, context: m.context || "", isSearching: false,
      }));

      const bgMsg = streamingMessages[sessionId];
      if (bgMsg) {
        const lastMsg = formattedMessages[formattedMessages.length - 1];
        if (lastMsg && lastMsg.role === "assistant" && !lastMsg.content) {
          formattedMessages[formattedMessages.length - 1] = { ...lastMsg, ...bgMsg };
        } else if (!lastMsg || lastMsg.role === "user") {
          formattedMessages.push({
            id: `bg-${sessionId}-${Date.now()}`, role: "assistant",
            content: bgMsg.content, sources: bgMsg.sources,
            score: bgMsg.score, context: bgMsg.context, isSearching: bgMsg.isSearching,
          });
        }
      }

      setMessages(formattedMessages.length > 0 ? formattedMessages : [
        { id: "welcome", role: "assistant", content: WELCOME_MESSAGE, sources: [], score: null, context: "", isSearching: false },
      ]);
      setCurrentSessionId(sessionId);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "auto" }), 50);
    } catch (err) {
      addToast(err.message, "error");
    }
  };

  const deleteChatSession = async (e, sessionId) => {
    e.stopPropagation();
    setConfirmData({
      isOpen: true, title: "대화 삭제", message: "이 대화 기록을 영구적으로 삭제하시겠습니까?",
      onConfirm: async () => {
        setConfirmData(prev => ({ ...prev, isOpen: false }));
        try {
          await authFetch(`${API_BASE}/sessions/${sessionId}`, { method: "DELETE" });
          if (currentSessionId === sessionId) resetChat();
          addToast("대화 기록이 삭제되었습니다.", "success");
          await refreshSidebar();
        } catch (err) {
          addToast(err.message, "error");
        }
      },
    });
  };

  const processStreamLine = (line, assistantId, sessionId) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);

    if (event.type === "chunk") {
      const updater = (prev) => ({ ...prev, content: (prev.content || "") + event.content, isSearching: false });
      setStreamingMessages(prev => ({ ...prev, [sessionId]: updater(prev[sessionId] || {}) }));
      if (currentSessionId === sessionId) updateMessage(assistantId, updater);

    } else if (event.type === "status") {
      const isSearching = event.state === "searching";
      setStreamingMessages(prev => ({ ...prev, [sessionId]: { ...(prev[sessionId] || {}), isSearching } }));
      if (currentSessionId === sessionId) updateMessage(assistantId, { isSearching });

    } else if (event.type === "meta") {
      const meta = { sources: event.sources || [], score: event.score ?? null, context: event.context || "", isSearching: false };
      setStreamingMessages(prev => ({ ...prev, [sessionId]: { ...(prev[sessionId] || {}), ...meta } }));
      if (currentSessionId === sessionId) updateMessage(assistantId, meta);
    }
  };

  const sendMessage = async (preset) => {
    const query = (preset ?? input).trim();
    if (!query || (currentSessionId && activeStreamsRef.current.has(currentSessionId))) return;

    const controller  = new AbortController();
    const userId      = nextId();
    const assistantId = nextId();
    const tempSessionId = currentSessionId || `temp-${Date.now()}`;

    activeStreamsRef.current.set(tempSessionId, controller);

    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", content: query, sources: [], score: null, context: "", isSearching: false },
      { id: assistantId, role: "assistant", content: "", sources: [], score: null, context: "", isSearching: false },
    ]);
    setStreamingMessages(prev => ({ ...prev, [tempSessionId]: { content: "", sources: [], score: null, context: "", isSearching: false } }));

    setInput("");
    setChatLoading(true);
    setStatusMessage(TEXT.thinking);

    const history = messages
      .filter(m => m.id !== "welcome" && m.content.trim() !== "")
      .map(m => ({ role: m.role, content: m.content }));

    let actualSessionId = currentSessionId;

    try {
      const response = await authFetch(`${API_BASE}/ask-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, model: selectedModel, history, session_id: currentSessionId }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || data.message || TEXT.answerFailed);
      }

      const reader  = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);

          if (event.type === "session") {
            actualSessionId = event.session_id;
            activeStreamsRef.current.delete(tempSessionId);
            activeStreamsRef.current.set(actualSessionId, controller);

            setStreamingMessages(prev => {
              const next = { ...prev, [actualSessionId]: prev[tempSessionId] };
              delete next[tempSessionId];
              return next;
            });
            setCurrentSessionId(prev =>
              prev === null || prev?.startsWith?.("temp-") ? actualSessionId : prev
            );
            refreshSidebar();
          } else {
            processStreamLine(line, assistantId, actualSessionId || tempSessionId);
          }
        }
        if (done) break;
      }

      setCurrentSessionId(prevCurrent => {
        if (actualSessionId && prevCurrent !== actualSessionId) {
          const title = query.slice(0, 15) + (query.length > 15 ? "..." : "");
          addToast(`'${title}' 답변이 완료되었습니다.`, "success", () => loadSession(actualSessionId));
        } else {
          setStatusMessage(TEXT.answerReady);
          addToast(TEXT.answerReady, "success");
        }
        return prevCurrent;
      });

    } catch (err) {
      if (err.name === "AbortError") return;
      const errorMsg = err.message || TEXT.answerFailed;
      const targetId = actualSessionId || tempSessionId;
      setCurrentSessionId(prev => {
        if (prev === targetId) updateMessage(assistantId, { content: errorMsg });
        return prev;
      });
      addToast(errorMsg, "error");
    } finally {
      const finalId = actualSessionId || tempSessionId;
      activeStreamsRef.current.delete(finalId);
      setCurrentSessionId(prev => { if (prev === finalId) setChatLoading(false); return prev; });
      setTimeout(() => {
        setStreamingMessages(prev => { const next = { ...prev }; delete next[finalId]; return next; });
      }, 2000);
    }
  };

  const uploadFile = async (file) => {
    if (!file || uploading) return;
    const formData = new FormData();
    formData.append("file", file);
    setUploading(true);
    setStatusMessage(`${file.name} 업로드 중...`);
    try {
      const response = await authFetch(`${API_BASE}/upload`, { method: "POST", body: formData });
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

  const handleUpload = async (e) => { const file = e.target.files?.[0]; e.target.value = ""; await uploadFile(file); };
  const handleDrop   = async (e) => { e.preventDefault(); await uploadFile(e.dataTransfer.files?.[0]); };

  const deleteFile = async (name) => {
    setConfirmData({
      isOpen: true, title: "문서 삭제",
      message: `"${name}" 파일을 삭제하시겠습니까? 관련 데이터가 모두 제거됩니다.`,
      onConfirm: async () => {
        setConfirmData(prev => ({ ...prev, isOpen: false }));
        setStatusMessage(`${name} 삭제 중...`);
        try {
          const response = await authFetch(`${API_BASE}/file?name=${encodeURIComponent(name)}`, { method: "DELETE" });
          const data = await readJson(response);
          await refreshSidebar();
          addToast(`${data.file} 삭제 완료`, "success");
          setStatusMessage(`${data.file} 삭제 완료.`);
        } catch (err) {
          addToast(err.message || TEXT.deleteFailed, "error");
          setStatusMessage(err.message || TEXT.deleteFailed);
        }
      },
    });
  };

  const handleResetChat = () => {
    if (chatLoading) {
      setConfirmData({
        isOpen: true, title: "대화 중단",
        message: "현재 답변이 생성 중입니다. 중단하고 새로운 채팅을 시작하시겠습니까?",
        onConfirm: () => { setConfirmData(prev => ({ ...prev, isOpen: false })); resetChat(); },
      });
    } else {
      resetChat();
    }
  };

  const resetChat = () => {
    activeStreamsRef.current.forEach(c => c.abort());
    activeStreamsRef.current.clear();
    setMessages([{ id: "welcome", role: "assistant", content: WELCOME_MESSAGE, sources: [], score: null, context: "", isSearching: false }]);
    setCurrentSessionId(null);
    setStreamingMessages({});
    setInput("");
    setStatusMessage(TEXT.ready);
    setChatLoading(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleLogout = () => {
    activeStreamsRef.current.forEach(c => c.abort());
    activeStreamsRef.current.clear();
    logout();
  };

  const filteredFiles   = files.filter(f => f.toLowerCase().includes(fileFilter.trim().toLowerCase()));
  const libraryDensity  = stats.indexed_files > 0
    ? `${Math.max(1, Math.round(stats.total_chunks / stats.indexed_files))}청크/문서`
    : "비어 있음";

  /* ── Render ─────────────────────────────────────────────── */
  return (
    <div className="app-shell">
      <ToastRegion toasts={toasts} onDismiss={dismissToast} />

      <ConfirmModal
        isOpen={confirmData.isOpen}
        title={confirmData.title}
        message={confirmData.message}
        onConfirm={confirmData.onConfirm}
        onCancel={() => setConfirmData(prev => ({ ...prev, isOpen: false }))}
      />

      {/* Top Bar */}
      <header className="top-bar">
        <button className="btn-sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)} title={sidebarOpen ? "사이드바 접기" : "사이드바 펴기"}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>

        <div className="brand" onClick={handleResetChat} role="button" title="새 채팅 시작">
          <div className="brand-mark" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 1L14 4.5V11.5L8 15L2 11.5V4.5L8 1Z" fill="white" fillOpacity="0.9" />
              <path d="M8 5L11 6.75V10.25L8 12L5 10.25V6.75L8 5Z" fill="white" fillOpacity="0.35" />
            </svg>
          </div>
          <span className="brand-name">acanet Workspace</span>
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
            <strong className="stat-pill-val">{selectedModel || stats.chat_model}</strong>
          </div>
        </div>

        <div className={`top-live ${chatLoading ? "streaming" : ""}`} aria-live="polite">
          <span className="live-dot" />
          <span>{chatLoading ? "생성 중" : "대기 중"}</span>
        </div>

        {/* 사용자 정보 + 로그아웃 */}
        <div className="top-user">
          <span className="top-username" title="로그인된 사용자">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, verticalAlign: "middle" }}>
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
            {user?.username}
          </span>
          <button className="btn-logout" onClick={handleLogout} title="로그아웃">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
            로그아웃
          </button>
        </div>
      </header>

      {/* Workspace */}
      <main className={`workspace ${!sidebarOpen ? "collapsed" : ""}`}>
        {/* History Sidebar */}
        <nav className="history-sidebar" aria-label="대화 기록">
          <div className="history-head">
            <button type="button" className="btn-new-chat" onClick={handleResetChat}>
              <span className="plus-icon">+</span>새 채팅 시작
            </button>
          </div>
          <div className="history-list">
            {sessions.length === 0 ? (
              <div className="empty-state" style={{ padding: "40px 20px" }}>
                <p style={{ opacity: 0.5, fontSize: "0.8rem" }}>저장된 대화가 없습니다.</p>
              </div>
            ) : (
              sessions.map((session) => (
                <div
                  key={session.id}
                  className={`history-item ${currentSessionId === session.id ? "active" : ""}`}
                  onClick={() => loadSession(session.id)}
                >
                  <span className="history-icon">💬</span>
                  <div className="history-content">
                    <span className="history-title">{session.title}</span>
                    <span className="history-date">{new Date(session.updated_at).toLocaleDateString()}</span>
                  </div>
                  <button className="btn-history-del" onClick={(e) => deleteChatSession(e, session.id)} title="대화 삭제">✕</button>
                </div>
              ))
            )}
          </div>
        </nav>

        {/* Chat Panel */}
        <section className="chat-panel" aria-label="문서 채팅">
          <div className="chat-panel-head">
            <div className="chat-panel-title">
              <h2>문서 채팅</h2>
              <p>스트리밍 응답 · 근거 문서 표시 · 문맥 검색</p>
            </div>
            <button type="button" className="btn-ghost" onClick={handleResetChat}>채팅 초기화</button>
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

          <div ref={quickPromptsRef} className="quick-prompts" role="group" aria-label="빠른 질문">
            {QUICK_PROMPTS.map((prompt, i) => (
              <button key={prompt} type="button" className="quick-chip" onClick={() => sendMessage(prompt)} disabled={chatLoading}>
                <span className="quick-num">0{i + 1}</span>
                <span>{prompt}</span>
              </button>
            ))}
          </div>

          <div className="composer">
            <div className="composer-box">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder="정책, 가이드, 사내 문서에 대해 질문해보세요..."
                disabled={chatLoading}
                rows={3}
                aria-label="질문 입력"
              />
              <div className="composer-footer">
                <span className="composer-status">{statusMessage}</span>
                <div className="composer-actions">
                  <span className="key-hint">Shift+Enter 줄바꿈</span>
                  <button type="button" className="btn-send" onClick={() => sendMessage()} disabled={chatLoading || !input.trim()}>
                    {chatLoading ? "생성 중..." : "보내기"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Side Panel */}
        <aside className="side-panel" aria-label="문서 관리">
          <div className="side-section">
            <div className="side-head">
              <h3>문서 업로드</h3>
              <span className="badge">{stats.indexed_files}개 인덱싱됨</span>
            </div>
            <button
              type="button"
              className={`upload-zone ${dragActive ? "drag-over" : ""} ${uploading ? "uploading" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={(e) => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget)) setDragActive(false); }}
              onDrop={handleDrop}
              disabled={uploading}
              aria-label="파일 업로드 영역"
            >
              <input ref={fileInputRef} type="file" accept=".pdf,.txt" onChange={handleUpload} disabled={uploading} hidden />
              <div className="upload-icon" aria-hidden="true">{uploading ? "⟳" : "↑"}</div>
              <strong>{uploading ? "인덱싱 중..." : "파일 업로드"}</strong>
              <p>{dragActive ? TEXT.dragActive : TEXT.dragIdle}</p>
              <span className="upload-formats">PDF · TXT</span>
            </button>
          </div>

          <div className="side-section">
            <div className="side-head">
              <h3>지식 베이스</h3>
              <span className="badge badge-neutral">{libraryDensity}</span>
            </div>
            <div className="file-search">
              <input type="text" value={fileFilter} onChange={(e) => setFileFilter(e.target.value)} placeholder="파일명으로 찾기..." aria-label="문서 검색" />
            </div>
            <div className="file-list" role="list" aria-label="인덱싱된 문서 목록">
              {filteredFiles.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-icon" aria-hidden="true">{files.length === 0 ? "◎" : "⊘"}</span>
                  {files.length === 0 ? (
                    <><p>아직 인덱싱된 문서가 없습니다.</p><p>위에서 파일을 업로드해보세요.</p></>
                  ) : (
                    <p>검색 조건에 맞는 문서가 없습니다.</p>
                  )}
                </div>
              ) : (
                filteredFiles.map((file) => (
                  <div key={file} className="file-item" role="listitem">
                    <div className="file-ext" aria-hidden="true">{getExtension(file)}</div>
                    <span className="file-name" title={file}>{file}</span>
                    <button type="button" className="btn-del" onClick={() => deleteFile(file)} aria-label={`${file} 삭제`} title="삭제">✕</button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="model-info" aria-label="모델 정보">
            <p className="model-info-label">AI 모델 설정</p>
            <div className="model-row">
              <span className="model-row-label">Chat</span>
              <select className="model-select" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} disabled={chatLoading}>
                {availableModels.map(m => <option key={m} value={m}>{m}</option>)}
                {stats.chat_model && !availableModels.includes(stats.chat_model) && (
                  <option value={stats.chat_model}>{stats.chat_model}</option>
                )}
              </select>
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
