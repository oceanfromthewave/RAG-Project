import { useEffect, useRef, useState, useCallback } from "react";
import "./App.css";
import { useAuth } from "./AuthContext";
import LoginPage from "./LoginPage";
import AdminPage from "./AdminPage";

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

/* ── Markdown Renderer ────────────────────────────────────── */

function inlineFormat(text, keyPrefix = "") {
  if (!text) return null;
  const parts = [];
  // **bold**, *italic*, `code`, [text](url)
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+?)`|\[(.+?)\]\((.+?)\))/g;
  let lastIndex = 0;
  let match;
  let idx = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={`${keyPrefix}-t${idx++}`}>{text.slice(lastIndex, match.index)}</span>);
    }
    if (match[0].startsWith("**")) {
      parts.push(<strong key={`${keyPrefix}-b${idx++}`}>{match[2]}</strong>);
    } else if (match[0].startsWith("*")) {
      parts.push(<em key={`${keyPrefix}-i${idx++}`}>{match[3]}</em>);
    } else if (match[0].startsWith("`")) {
      parts.push(<code key={`${keyPrefix}-c${idx++}`}>{match[4]}</code>);
    } else if (match[0].startsWith("[")) {
      parts.push(<a key={`${keyPrefix}-a${idx++}`} href={match[6]} target="_blank" rel="noopener noreferrer">{match[5]}</a>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(<span key={`${keyPrefix}-t${idx++}`}>{text.slice(lastIndex)}</span>);
  }
  return parts.length === 0 ? <span key={`${keyPrefix}-fallback`}>{text}</span> : parts;
}

function CodeBlock({ lang, code }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="md-code-block">
      <div className="md-code-header">
        <span className="md-code-lang">{lang || "code"}</span>
        <button className="md-code-copy" onClick={handleCopy}>
          {copied ? "✓ 복사됨" : "복사"}
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

function TableBlock({ lines, blockIdx }) {
  if (lines.length < 2) return null;
  const parseRow = (line) => line.split("|").filter((_, i, arr) => (i > 0 && i < arr.length - 1) || (arr.length === 1)).map(c => c.trim());
  
  const header = parseRow(lines[0]);
  const rows = lines.slice(2).map(parseRow);

  return (
    <div className="md-table-wrapper">
      <table className="md-table">
        <thead>
          <tr>
            {header.map((h, i) => <th key={`${blockIdx}-th-${i}`}>{inlineFormat(h, `th-${i}`)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={`${blockIdx}-tr-${i}`}>
              {row.map((cell, j) => <td key={`${blockIdx}-td-${i}-${j}`}>{inlineFormat(cell, `td-${i}-${j}`)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TextBlock({ text, blockIdx }) {
  const lines = text.split("\n");
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Heading
    const hMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (hMatch) {
      const level = Math.min(hMatch[1].length, 6);
      const Tag = `h${level}`;
      elements.push(<Tag key={`${blockIdx}-h-${i}`} className="md-heading">{inlineFormat(hMatch[2], `h-${i}`)}</Tag>);
      i++; continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      elements.push(<hr key={`${blockIdx}-hr-${i}`} className="md-hr" />);
      i++; continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      elements.push(<blockquote key={`${blockIdx}-bq-${i}`} className="md-blockquote">{inlineFormat(quoteLines.join("\n"), `bq-${i}`)}</blockquote>);
      continue;
    }

    // Table detection: starts with | and next line has |---|
    if (line.startsWith("|") && lines[i+1]?.trim().match(/^\|?[:\s-]*\|[:\s-]*\|/)) {
      const tableLines = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      elements.push(<TableBlock key={`${blockIdx}-tbl-${i}`} lines={tableLines} blockIdx={blockIdx} />);
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        items.push(<li key={`${blockIdx}-li-${i}`}>{inlineFormat(lines[i].replace(/^[-*+]\s/, ""), `li-${i}`)}</li>);
        i++;
      }
      elements.push(<ul key={`${blockIdx}-ul-${i}`} className="md-ul">{items}</ul>);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(<li key={`${blockIdx}-oli-${i}`}>{inlineFormat(lines[i].replace(/^\d+\.\s/, ""), `oli-${i}`)}</li>);
        i++;
      }
      elements.push(<ol key={`${blockIdx}-ol-${i}`} className="md-ol">{items}</ol>);
      continue;
    }

    // Empty line
    if (line.trim() === "") { i++; continue; }

    // Paragraph: collect consecutive non-special lines
    const stopRe = /^(#{1,6}\s|[-*+]\s|\d+\.\s|> |(-{3,}|\*{3,}|_{3,})$)/;
    const paraLines = [];
    while (i < lines.length && lines[i].trim() !== "" && !stopRe.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      elements.push(<p key={`${blockIdx}-p-${i}`} className="md-p">{inlineFormat(paraLines.join(" "), `p-${i}`)}</p>);
    }
  }

  return <>{elements}</>;
}

function SimpleMarkdown({ content }) {
  if (!content) return null;

  // Split out fenced code blocks
  const parts = [];
  const codeRe = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0;
  let match;
  let idx = 0;

  while ((match = codeRe.exec(content)) !== null) {
    if (match.index > last) {
      parts.push({ type: "text", content: content.slice(last, match.index), idx: idx++ });
    }
    parts.push({ type: "code", lang: match[1], code: match[2].trimEnd(), idx: idx++ });
    last = match.index + match[0].length;
  }
  if (last < content.length) {
    parts.push({ type: "text", content: content.slice(last), idx: idx++ });
  }

  return (
    <div className="markdown-body">
      {parts.map((p) =>
        p.type === "code"
          ? <CodeBlock key={p.idx} lang={p.lang} code={p.code} />
          : <TextBlock key={p.idx} text={p.content} blockIdx={p.idx} />
      )}
    </div>
  );
}

/* ── Sub-components ───────────────────────────────────────── */

function DocViewerModal({ isOpen, title, content, onCancel }) {
  if (!isOpen) return null;
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-container doc-viewer" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-body doc-content">
          <pre>{content}</pre>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onCancel}>닫기</button>
        </div>
      </div>
    </div>
  );
}

function DocSidebar({ isOpen, title, content, onClose }) {
  if (!isOpen) return null;
  return (
    <aside className="doc-sidebar">
      <div className="doc-sidebar-head">
        <h3>문서 원문</h3>
        <button className="btn-close-sidebar" onClick={onClose}>✕</button>
      </div>
      <div className="doc-sidebar-body">
        <div className="doc-sidebar-title">{title}</div>
        <pre className="doc-sidebar-content">{content}</pre>
      </div>
    </aside>
  );
}

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
      if (e.key === "Enter") { e.preventDefault(); onConfirm(); }
      else if (e.key === "Escape") { onCancel(); }
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

function MessageCard({ message, isStreaming, onFeedback, onRegenerate, isLastAssistant, onViewDoc }) {
  const [copied, setCopied] = useState(false);
  const [sourceExpanded, setSourceExpanded] = useState(null);
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
        <div className="msg-actions">
          {!isUser && message.content && (
            <>
              <button 
                className={`msg-action-btn feedback-btn ${message.feedback === 1 ? "active" : ""}`}
                onClick={() => onFeedback(message.id, message.feedback === 1 ? 0 : 1)}
                title="도움이 됨"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill={message.feedback === 1 ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
              </button>
              <button 
                className={`msg-action-btn feedback-btn ${message.feedback === -1 ? "active" : ""}`}
                onClick={() => onFeedback(message.id, message.feedback === -1 ? 0 : -1)}
                title="도움이 안 됨"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill={message.feedback === -1 ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"></path></svg>
              </button>
              {isLastAssistant && !isStreaming && (
                <button className="msg-action-btn" onClick={onRegenerate} title="다시 생성">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                </button>
              )}
            </>
          )}
          {!isUser && message.content && (
            <button className="msg-action-btn" onClick={handleCopy} title="복사">
              {copied ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              )}
            </button>
          )}
        </div>
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
        ) : isUser ? (
          <span style={{ whiteSpace: "pre-wrap" }}>{message.content}</span>
        ) : (
          <SimpleMarkdown content={message.content} />
        )}
      </div>

      {message.sources?.length > 0 && (
        <div className="source-section">
          <span className="source-header">참고 문서 {message.sources.length}</span>
          <div className="source-grid">
            {message.sources.map((src, i) => (
              <div
                key={`${message.id}-src-${i}`}
                className={`source-card ${sourceExpanded === i ? "expanded" : ""}`}
                onClick={() => setSourceExpanded(sourceExpanded === i ? null : i)}
                title="클릭하여 전체 내용 보기"
              >
                <div className="source-top">
                  <strong>{src.source}</strong>
                  <span className="source-score">{formatScore(src.score)}</span>
                </div>
                <p className="source-preview">{src.preview}</p>
                <button 
                  className="btn-view-full" 
                  onClick={(e) => { e.stopPropagation(); onViewDoc(src.source, src.full_text || src.preview); }}
                >전체보기</button>
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

const formatFileSize = (bytes) => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

function App() {
  const { token, user, logout, authFetch } = useAuth();
  if (!token) return <LoginPage />;
  return <AuthenticatedApp authFetch={authFetch} user={user} logout={logout} />;
}

function AuthenticatedApp({ authFetch, user, logout }) {
  const [view, setView]               = useState("chat");
  const [darkMode, setDarkMode]       = useState(() => localStorage.getItem("darkMode") === "true");
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
  const [dragActive, setDragActive]     = useState(false); // 파일 업로드용
  const [composerDragActive, setComposerDragActive] = useState(false); // 채팅 첨부용
  const [fileFilter, setFileFilter]     = useState("");
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [sessionFilter, setSessionFilter] = useState("");
  const [toasts, setToasts]             = useState([]);
  const [confirmData, setConfirmData]   = useState({ isOpen: false, title: "", message: "", onConfirm: null });
  const [viewingDoc, setViewingDoc]     = useState({ isOpen: false, title: "", content: "" });
  const [sidebarOpen, setSidebarOpen]   = useState(window.innerWidth > 960);
  const [streamingMessages, setStreamingMessages] = useState({});
  const [attachedFiles, setAttachedFiles] = useState([]); // 드래그로 추가된 파일들
  const [docSidebar, setDocSidebar]     = useState({ isOpen: false, title: "", content: "" }); // 사이드 뷰어 상태
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  // 세션 제목 편집 상태
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editingTitle, setEditingTitle]         = useState("");

  const chatEndRef      = useRef(null);
  const fileInputRef    = useRef(null);
  const quickPromptsRef = useRef(null);
  const textareaRef     = useRef(null);
  const dropdownRef     = useRef(null);
  const activeStreamsRef = useRef(new Map());
  const messageIdRef    = useRef(0);
  const toastIdRef      = useRef(0);

  // 다크모드 적용
  useEffect(() => {
    localStorage.setItem("darkMode", darkMode);
    if (darkMode) {
      document.body.classList.add("dark");
    } else {
      document.body.classList.remove("dark");
    }
  }, [darkMode]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsModelDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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

  /* ── 유틸 ── */
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
        sources: m.sources || [], score: m.score, context: m.context || "", 
        isSearching: false, feedback: m.feedback || 0,
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

  /* ── 세션 제목 편집 ── */
  const startEditSession = (e, session) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditingTitle(session.title);
  };

  const submitEditSession = async (sessionId) => {
    const newTitle = editingTitle.trim();
    setEditingSessionId(null);
    if (!newTitle) return;

    try {
      await authFetch(`${API_BASE}/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle }),
      });
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: newTitle } : s));
    } catch (err) {
      addToast("제목 변경에 실패했습니다.", "error");
    }
  };

  const handleEditKeyDown = (e, sessionId) => {
    if (e.key === "Enter") { e.preventDefault(); submitEditSession(sessionId); }
    else if (e.key === "Escape") { setEditingSessionId(null); }
    e.stopPropagation();
  };

  const handleFeedback = async (messageId, val) => {
    try {
      await authFetch(`${API_BASE}/messages/${messageId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: val }),
      });
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, feedback: val } : m));
    } catch (err) {
      addToast("피드백 반영에 실패했습니다.", "error");
    }
  };

  const handleExportChat = () => {
    if (messages.length <= 1) return;
    const chatText = messages
      .filter(m => m.id !== "welcome")
      .map(m => `### ${m.role === "user" ? "User" : "Assistant"}\n\n${m.content}\n\n${m.sources?.length ? `*Sources: ${m.sources.map(s => s.source).join(", ")}*` : ""}`)
      .join("\n---\n\n");
    
    const blob = new Blob([chatText], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat-export-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    addToast("대화가 Markdown으로 내보내졌습니다.", "success");
  };

  const handleRegenerate = async () => {
    const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
    if (!lastUserMsg) return;
    
    // 마지막 어시스턴트 메시지 제거 후 다시 요청
    setMessages(prev => {
      const next = [...prev];
      if (next[next.length - 1].role === "assistant") next.pop();
      return next;
    });
    sendMessage(lastUserMsg.content);
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
    let query = (preset ?? input).trim();
    if (!query || (currentSessionId && activeStreamsRef.current.has(currentSessionId))) return;

    const currentAttachments = [...attachedFiles];

    const controller  = new AbortController();
    const userId      = nextId();
    const assistantId = nextId();
    const tempSessionId = currentSessionId || `temp-${Date.now()}`;

    activeStreamsRef.current.set(tempSessionId, controller);

    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", content: query, sources: [], score: null, context: "", isSearching: false, feedback: 0 },
      { id: assistantId, role: "assistant", content: "", sources: [], score: null, context: "", isSearching: false, feedback: 0 },
    ]);
    setStreamingMessages(prev => ({ ...prev, [tempSessionId]: { content: "", sources: [], score: null, context: "", isSearching: false, feedback: 0 } }));

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
        body: JSON.stringify({ 
          query, 
          model: selectedModel, 
          history, 
          session_id: currentSessionId,
          selected_files: currentAttachments 
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || data.message || TEXT.answerFailed);
      }

      setAttachedFiles([]); // 성공 시 비우기

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

          } else if (event.type === "title") {
            setSessions(prev =>
              prev.map(s => s.id === event.session_id ? { ...s, title: event.title } : s)
            );
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

  const uploadFiles = async (fileList) => {
    if (!fileList || fileList.length === 0 || uploading) return;

    const filesArray = Array.from(fileList);
    const formData = new FormData();
    filesArray.forEach(file => formData.append("files", file));

    setUploading(true);
    setStatusMessage(`${filesArray.length}개 파일 업로드 중...`);

    try {
      const response = await authFetch(`${API_BASE}/upload`, { method: "POST", body: formData });
      const data = await readJson(response);
      await refreshSidebar();

      const successCount = data.results.filter(r => r.status === "success").length;
      if (successCount > 0) {
        addToast(`${successCount}개 파일 인덱싱 완료`, "success");
      }

      data.results.forEach(res => {
        if (res.status === "error") {
          addToast(`${res.file}: ${res.message}`, "error");
        }
      });

      setStatusMessage(data.message);
    } catch (err) {
      addToast(err.message || TEXT.uploadFailed, "error");
      setStatusMessage(err.message || TEXT.uploadFailed);
    } finally {
      setUploading(false);
      setDragActive(false);
    }
  };

  const handleUpload = async (e) => { 
    const fileList = e.target.files; 
    if (fileList && fileList.length > 0) {
      await uploadFiles(fileList);
    }
    e.target.value = ""; 
  };
  const handleDrop   = async (e) => { e.preventDefault(); await uploadFiles(e.dataTransfer.files); };

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

  const toggleFileSelection = (name) => {
    setSelectedFiles(prev => prev.includes(name) ? prev.filter(f => f !== name) : [...prev, name]);
  };

  const deleteSelectedFiles = async () => {
    if (selectedFiles.length === 0) return;
    setConfirmData({
      isOpen: true, title: "문서 다중 삭제",
      message: `${selectedFiles.length}개의 파일을 삭제하시겠습니까?`,
      onConfirm: async () => {
        setConfirmData(prev => ({ ...prev, isOpen: false }));
        try {
          const query = selectedFiles.map(f => `names=${encodeURIComponent(f)}`).join("&");
          await authFetch(`${API_BASE}/files/batch?${query}`, { method: "DELETE" });
          setSelectedFiles([]);
          await refreshSidebar();
          addToast("선택한 파일이 삭제되었습니다.", "success");
        } catch (err) {
          addToast(err.message, "error");
        }
      }
    });
  };

  const filteredFiles   = files.filter(f => f.name.toLowerCase().includes(fileFilter.trim().toLowerCase()));
  const libraryDensity  = stats.indexed_files > 0
    ? `${Math.max(1, Math.round(stats.total_chunks / stats.indexed_files))}청크/문서`
    : "비어 있음";

  /* ── Render ─────────────────────────────────────────────── */
  return (
    <div className={`app-shell${darkMode ? " dark" : ""}`}>
      <ToastRegion toasts={toasts} onDismiss={dismissToast} />

      <ConfirmModal
        isOpen={confirmData.isOpen}
        title={confirmData.title}
        message={confirmData.message}
        onConfirm={confirmData.onConfirm}
        onCancel={() => setConfirmData(prev => ({ ...prev, isOpen: false }))}
      />

      {/* 오버레이 (히스토리 또는 문서 뷰어 열려있을 때) */}
      {(sidebarOpen || docSidebar.isOpen) && window.innerWidth <= 960 && (
        <div className="sidebar-overlay" onClick={() => {
          setSidebarOpen(false);
          setDocSidebar({ ...docSidebar, isOpen: false });
        }} />
      )}

      <DocViewerModal
        isOpen={viewingDoc.isOpen}
        title={viewingDoc.title}
        content={viewingDoc.content}
        onCancel={() => setViewingDoc(prev => ({ ...prev, isOpen: false }))}
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
            <img src="/favicon-transparent.png" alt="" />
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

        {/* 다크모드 토글 */}
        <button
          className="btn-dark-toggle"
          onClick={() => setDarkMode(d => !d)}
          title={darkMode ? "라이트 모드" : "다크 모드"}
          aria-label="다크모드 전환"
        >
          {darkMode ? (
            /* 태양 아이콘 */
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
              <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
            </svg>
          ) : (
            /* 달 아이콘 */
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
          )}
        </button>

        {/* 관리자 대시보드 버튼 */}
        {user?.isAdmin && (
          <button
            className={`btn-ghost ${view === "admin" ? "active" : ""}`}
            onClick={() => setView(view === "chat" ? "admin" : "chat")}
            style={{ marginLeft: 8, borderColor: "var(--accent)", color: "var(--accent)" }}
          >
            {view === "chat" ? "시스템 관리" : "채팅으로 복귀"}
          </button>
        )}

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
      {view === "admin" ? (
        <div className="admin-view-container">
          <AdminPage onBack={() => setView("chat")} />
        </div>
      ) : (
        <main className={`workspace ${!sidebarOpen ? "collapsed" : ""} ${docSidebar.isOpen ? "show-doc" : ""}`}>
          {/* History Sidebar */}
          <nav className="history-sidebar" aria-label="대화 기록">
            <div className="history-head">
              <button type="button" className="btn-new-chat" onClick={handleResetChat}>
                <span className="plus-icon">+</span>새 채팅 시작
              </button>
              <div className="history-search">
                <input 
                  type="text" 
                  value={sessionFilter} 
                  onChange={(e) => setSessionFilter(e.target.value)} 
                  placeholder="대화 검색..."
                  aria-label="대화 기록 검색"
                />
              </div>
            </div>
            <div className="history-list">
              {sessions.filter(s => s.title.toLowerCase().includes(sessionFilter.toLowerCase())).length === 0 ? (
                <div className="empty-state" style={{ padding: "40px 20px" }}>
                  <p style={{ opacity: 0.5, fontSize: "0.8rem" }}>{sessions.length === 0 ? "저장된 대화가 없습니다." : "검색 결과가 없습니다."}</p>
                </div>
              ) : (
                sessions
                  .filter(s => s.title.toLowerCase().includes(sessionFilter.toLowerCase()))
                  .map((session) => (
                  <div
                    key={session.id}
                    className={`history-item ${currentSessionId === session.id ? "active" : ""}`}
                    onClick={() => editingSessionId !== session.id && loadSession(session.id)}
                  >
                    <span className="history-icon">
                      {activeStreamsRef.current.has(session.id) ? "⟳" : "💬"}
                    </span>
                    <div className="history-content">
                      {editingSessionId === session.id ? (
                        <input
                          className="history-title-edit"
                          value={editingTitle}
                          autoFocus
                          onChange={e => setEditingTitle(e.target.value)}
                          onBlur={() => submitEditSession(session.id)}
                          onKeyDown={e => handleEditKeyDown(e, session.id)}
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <span
                          className="history-title"
                          onDoubleClick={e => startEditSession(e, session)}
                          title="더블클릭하여 제목 편집"
                        >{session.title}</span>
                      )}
                      <span className="history-date">{new Date(session.updated_at).toLocaleDateString()}</span>
                    </div>
                    {editingSessionId !== session.id && (
                      <button className="btn-history-del" onClick={(e) => deleteChatSession(e, session.id)} title="대화 삭제">✕</button>
                    )}
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
              <div className="chat-panel-actions">
                <button type="button" className="btn-ghost" onClick={handleExportChat} title="Markdown으로 내보내기">
                  내보내기
                </button>
                <button type="button" className="btn-ghost" onClick={handleResetChat}>채팅 초기화</button>
              </div>
            </div>

            <div className="chat-feed" role="log" aria-live="polite" aria-label="채팅 메시지">
              {messages.map((message, idx) => (
                <MessageCard
                  key={message.id}
                  message={message}
                  isStreaming={chatLoading && idx === messages.length - 1}
                  onFeedback={handleFeedback}
                  onRegenerate={handleRegenerate}
                  onViewDoc={(title, content) => setDocSidebar({ isOpen: true, title, content })}
                  isLastAssistant={idx === messages.length - 1 && message.role === "assistant"}
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
              <div 
                className={`composer-box ${composerDragActive ? "drag-over" : ""}`}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes("application/rag-file")) {
                    e.preventDefault();
                    setComposerDragActive(true);
                  }
                }}
                onDragLeave={() => setComposerDragActive(false)}
                onDrop={(e) => {
                  const fileName = e.dataTransfer.getData("application/rag-file");
                  if (fileName) {
                    e.preventDefault();
                    setComposerDragActive(false);
                    if (!attachedFiles.includes(fileName)) {
                      setAttachedFiles(prev => [...prev, fileName]);
                      addToast(`'${fileName}' 문서가 첨부되었습니다.`, "info");
                    }
                  }
                }}
              >
                {attachedFiles.length > 0 && (
                  <div className="composer-attachments">
                    {attachedFiles.map(name => (
                      <span key={name} className="attachment-chip">
                        <span className="chip-name">{name}</span>
                        <button className="chip-del" onClick={() => setAttachedFiles(prev => prev.filter(f => f !== name))}>✕</button>
                      </span>
                    ))}
                  </div>
                )}
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
            <div className="side-panel-content">
              <div className="side-section">
                <div className="side-head">
                  <h3>문서 업로드</h3>
                  <span className="badge">{stats.indexed_files}개 인덱싱됨</span>
                </div>
                <div
                  className={`upload-zone ${dragActive ? "drag-over" : ""} ${uploading ? "uploading" : ""}`}
                  onClick={() => !uploading && fileInputRef.current?.click()}
                  onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
                  onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                  onDragLeave={(e) => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget)) setDragActive(false); }}
                  onDrop={handleDrop}
                  aria-label="파일 업로드 영역"
                  role="button"
                  tabIndex={0}
                >
                  <div className="upload-content">
                    <div className="upload-icon" aria-hidden="true">{uploading ? "⟳" : "↑"}</div>
                    <div className="upload-text">
                      <strong>{uploading ? "인덱싱 중..." : "파일 업로드"}</strong>
                      <p>{dragActive ? TEXT.dragActive : "파일들을 끌어다 놓거나 클릭해서 업로드하세요."}</p>
                    </div>
                  </div>
                  <span className="upload-formats">PDF · TXT · DOCX · MD · CODE · IMG</span>
                </div>
                <input 
                  ref={fileInputRef} 
                  type="file" 
                  accept=".pdf,.txt,.png,.jpg,.jpeg,.docx,.md,.py,.js,.ts" 
                  onChange={handleUpload} 
                  disabled={uploading} 
                  multiple 
                  hidden 
                />
              </div>

              <div className="side-section">
                <div className="side-head">
                  <h3>지식 베이스</h3>
                  <span className="badge badge-neutral">{libraryDensity}</span>
                </div>
                <div className="file-toolbar">
                  <div className="file-search">
                    <input type="text" value={fileFilter} onChange={(e) => setFileFilter(e.target.value)} placeholder="파일명으로 찾기..." aria-label="문서 검색" />
                  </div>
                  {selectedFiles.length > 0 && (
                    <button className="btn-batch-del" onClick={deleteSelectedFiles}>삭제 ({selectedFiles.length})</button>
                  )}
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
                      <div 
                        key={file.name} 
                        className={`file-item ${selectedFiles.includes(file.name) ? "selected" : ""}`} 
                        role="listitem"
                        onClick={() => toggleFileSelection(file.name)}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("application/rag-file", file.name);
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                      >
                        <div className="file-check-wrapper">
                          <input 
                            type="checkbox" 
                            className="file-checkbox"
                            checked={selectedFiles.includes(file.name)} 
                            readOnly
                          />
                          <span className="custom-checkbox"></span>
                        </div>
                        <div className="file-ext" aria-hidden="true">{getExtension(file.name)}</div>
                        <div className="file-info">
                          <span className="file-name" title={file.name}>{file.name}</span>
                          <span className="file-meta">{formatFileSize(file.size)}</span>
                        </div>
                        <button type="button" className="btn-del" onClick={(e) => { e.stopPropagation(); deleteFile(file.name); }} aria-label={`${file.name} 삭제`} title="삭제">✕</button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="model-info" aria-label="모델 정보">
                <p className="model-info-label">AI 모델 설정</p>
                <div className="model-row">
                  <span className="model-row-label">Chat</span>
                  <div className="custom-dropdown" ref={dropdownRef}>
                    <button
                      type="button"
                      className={`model-select-trigger ${isModelDropdownOpen ? "open" : ""}`}
                      onClick={() => !chatLoading && setIsModelDropdownOpen(!isModelDropdownOpen)}
                      disabled={chatLoading}
                    >
                      {selectedModel || stats.chat_model || "선택 안됨"}
                    </button>
                    {isModelDropdownOpen && (
                      <div className="model-dropdown-menu">
                        {availableModels.map(m => (
                          <div
                            key={m}
                            className={`model-option ${selectedModel === m ? "selected" : ""}`}
                            onClick={() => { setSelectedModel(m); setIsModelDropdownOpen(false); }}
                          >
                            {m}
                          </div>
                        ))}
                        {stats.chat_model && !availableModels.includes(stats.chat_model) && (
                          <div
                            className={`model-option ${selectedModel === stats.chat_model ? "selected" : ""}`}
                            onClick={() => { setSelectedModel(stats.chat_model); setIsModelDropdownOpen(false); }}
                          >
                            {stats.chat_model}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
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
            </div>
          </aside>

          {/* Doc Sidebar (신규 원문 뷰어) */}
          <DocSidebar
            isOpen={docSidebar.isOpen}
            title={docSidebar.title}
            content={docSidebar.content}
            onClose={() => setDocSidebar({ ...docSidebar, isOpen: false })}
          />
        </main>
      )}
    </div>
  );
}

export default App;
