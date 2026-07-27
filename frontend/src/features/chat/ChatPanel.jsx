import { useEffect, useRef, useState, useCallback } from "react";
import MessageCard from "./MessageCard";
import { ChatSkeleton } from "./ChatComponents";

/* ── 빈 채팅 화면 안내 카드 ─────────────────────────────── */
function EmptyChat({ sendMessage, chatLoading }) {
  const tips = [
    { icon: "📄", label: "문서 요약", prompt: "업로드된 문서를 간단히 요약해줘", color: "#4f46e5" },
    { icon: "🔍", label: "핵심 구절 찾기", prompt: "가장 중요한 내용이나 키워드를 찾아줘", color: "#0891b2" },
    { icon: "❓", label: "콘텐츠 Q&A", prompt: "이 데이터에서 가장 중요한 포인트가 뭐야?", color: "#059669" },
    { icon: "📊", label: "비교 분석", prompt: "문서들의 핵심 내용을 서로 비교해줘", color: "#d97706" },
  ];
  return (
    <div className="empty-chat-v2">
      <div className="empty-chat-hero">
        <div className="hero-icon-stack">
          <div className="hero-icon-bg"></div>
          <div className="hero-icon">📚</div>
        </div>
        <h3 className="empty-chat-title">무엇을 도와드릴까요?</h3>
        <p className="empty-chat-sub">업로드한 문서를 바탕으로 AI와 대화를 나눠보세요.</p>
      </div>
      <div className="empty-chat-grid">
        {tips.map((t) => (
          <button
            key={t.prompt}
            className="empty-chat-card"
            onClick={() => sendMessage(t.prompt)}
            disabled={chatLoading}
          >
            <div className="card-icon" style={{ backgroundColor: t.color + "15", color: t.color }}>
              {t.icon}
            </div>
            <div className="card-content">
              <span className="card-label">{t.label}</span>
              <span className="card-prompt">"{t.prompt}"</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── 파일 첨부 드롭다운 ──────────────────────────────────── */
function FileAttachDropdown({ files, attachedFiles, setAttachedFiles, addToast, onClose }) {
  const ref = useRef(null);
  const [search, setSearch] = useState("");

  const filtered = files.filter((f) =>
    f.name.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const toggle = (name) => {
    if (attachedFiles.includes(name)) {
      setAttachedFiles((prev) => prev.filter((f) => f !== name));
    } else {
      setAttachedFiles((prev) => [...prev, name]);
      addToast(`'${name}' 문서가 첨부되었습니다.`, "info");
    }
  };

  return (
    <div className="file-attach-dropdown" ref={ref}>
      <div className="file-attach-header">
        <span>📎 문서 첨부</span>
        <button className="file-attach-close" onClick={onClose}>✕</button>
      </div>
      {files.length > 5 && (
        <div className="file-attach-search">
          <input
            autoFocus
            type="text"
            placeholder="파일 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}
      <div className="file-attach-list">
        {filtered.length === 0 ? (
          <div className="file-attach-empty">
            {files.length === 0
              ? "인덱싱된 문서가 없습니다."
              : "검색 결과가 없습니다."}
          </div>
        ) : (
          filtered.map((file) => {
            const isSelected = attachedFiles.includes(file.name);
            const ext = file.name.split(".").pop()?.toUpperCase() || "DOC";
            return (
              <div
                key={file.name}
                className={`file-attach-item ${isSelected ? "selected" : ""}`}
                onClick={() => toggle(file.name)}
              >
                <span className="file-attach-ext">{ext}</span>
                <span className="file-attach-name">{file.name}</span>
                <span className={`file-attach-check ${isSelected ? "visible" : ""}`}>✓</span>
              </div>
            );
          })
        )}
      </div>
      {attachedFiles.length > 0 && (
        <div className="file-attach-footer">
          <span>{attachedFiles.length}개 선택됨</span>
          <button onClick={() => setAttachedFiles([])}>전체 해제</button>
        </div>
      )}
    </div>
  );
}

export default function ChatPanel({
  messages,
  chatLoading,
  historyLoading,
  handleFeedback,
  handleRegenerate,
  setDocSidebar,
  chatEndRef,
  isAtBottom,
  scrollToBottom,
  quickPromptsRef,
  QUICK_PROMPTS,
  sendMessage,
  composerDragActive,
  setComposerDragActive,
  attachedFiles,
  setAttachedFiles,
  addToast,
  textareaRef,
  input,
  setInput,
  statusMessage,
  stopGeneration,
  handleExportChat,
  handleResetChat,
  handleScroll,
  // 새로 추가된 props
  currentSession,
  files,
}) {
  const lastUserIndex = [...messages].reverse().findIndex((m) => m.role === "user");
  const realLastUserIndex =
    lastUserIndex === -1 ? -1 : messages.length - 1 - lastUserIndex;

  const [showFileDropdown, setShowFileDropdown] = useState(false);

  /* textarea 자동 높이 조절 */
  const innerRef = useRef(null);
  const mergedRef = (el) => {
    innerRef.current = el;
    if (textareaRef && typeof textareaRef === "object") textareaRef.current = el;
  };
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [input]);

  /* 빠른 질문 칩 드래그 스크롤 */
  const isDragging = useRef(false);
  const startX = useRef(0);
  const scrollLeft = useRef(0);

  const onChipMouseDown = useCallback((e) => {
    if (!quickPromptsRef?.current) return;
    isDragging.current = true;
    startX.current = e.pageX - quickPromptsRef.current.offsetLeft;
    scrollLeft.current = quickPromptsRef.current.scrollLeft;
    quickPromptsRef.current.classList.add("active");
  }, [quickPromptsRef]);

  const onChipMouseMove = useCallback((e) => {
    if (!isDragging.current || !quickPromptsRef?.current) return;
    e.preventDefault();
    const x = e.pageX - quickPromptsRef.current.offsetLeft;
    quickPromptsRef.current.scrollLeft = scrollLeft.current - (x - startX.current);
  }, [quickPromptsRef]);

  const onChipMouseUp = useCallback(() => {
    isDragging.current = false;
    if (quickPromptsRef?.current) quickPromptsRef.current.classList.remove("active");
  }, [quickPromptsRef]);

  const CHAR_LIMIT = 2000;
  const isNearLimit = input.length > CHAR_LIMIT * 0.85;
  const isOverLimit = input.length > CHAR_LIMIT;

  /* 웰컴 메시지만 있으면 빈 채팅으로 간주 */
  const isEmptyChat =
    messages.length === 1 && messages[0].id === "welcome";

  /* 현재 세션 제목 */
  const sessionTitle = currentSession?.title || null;

  return (
    <section className="chat-panel" aria-label="문서 채팅">
      {/* ── 헤더 ── */}
      <div className="chat-panel-head">
        <div className="chat-panel-title">
          {sessionTitle ? (
            <>
              <h2 className="chat-session-title" title={sessionTitle}>{sessionTitle}</h2>
              <p>스트리밍 응답 · 근거 문서 표시 · 문맥 검색</p>
            </>
          ) : (
            <>
              <h2>문서 채팅</h2>
              <p>스트리밍 응답 · 근거 문서 표시 · 문맥 검색</p>
            </>
          )}
        </div>
        <div className="chat-panel-actions">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => handleExportChat("markdown")}
            title="Markdown으로 내보내기"
          >
            MD
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => handleExportChat("json")}
            title="JSON으로 내보내기"
          >
            JSON
          </button>
          <button type="button" className="btn-ghost" onClick={handleResetChat}>
            초기화
          </button>
        </div>
      </div>

      {/* ── 채팅 피드 ── */}
      <div
        className="chat-feed"
        role="log"
        aria-live="polite"
        aria-label="채팅 메시지"
        onScroll={handleScroll}
      >
        {historyLoading ? (
          <ChatSkeleton />
        ) : isEmptyChat ? (
          <EmptyChat sendMessage={sendMessage} chatLoading={chatLoading} />
        ) : (
          messages.map((message, idx) => (
            <MessageCard
              key={message.id}
              message={message}
              isStreaming={
                chatLoading &&
                (idx === messages.length - 1 || idx === realLastUserIndex)
              }
              onFeedback={handleFeedback}
              onRegenerate={handleRegenerate}
              onRetry={handleRegenerate}
              onViewDoc={(title, content, chunkIndex) =>
                setDocSidebar({
                  isOpen: true,
                  title,
                  content,
                  highlightChunkIndex: chunkIndex,
                })
              }
              isLastAssistant={
                idx === messages.length - 1 && message.role === "assistant"
              }
              isLastUser={idx === realLastUserIndex}
              onSuggestionClick={(s) => sendMessage(s)}
            />
          ))
        )}
        <div ref={chatEndRef} />

        {!isAtBottom && (
          <button
            className="btn-scroll-bottom"
            onClick={scrollToBottom}
            aria-label="맨 아래로 이동"
            title="맨 아래로 이동"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M7 13l5 5 5-5M7 6l5 5 5-5" />
            </svg>
          </button>
        )}
      </div>

      {/* ── 빠른 질문 칩 ── */}
      <div
        ref={quickPromptsRef}
        className="quick-prompts"
        role="group"
        aria-label="빠른 질문"
        onMouseDown={onChipMouseDown}
        onMouseMove={onChipMouseMove}
        onMouseUp={onChipMouseUp}
        onMouseLeave={onChipMouseUp}
      >
        {QUICK_PROMPTS.map((prompt, i) => (
          <button
            key={prompt}
            type="button"
            className="quick-chip"
            onClick={() => !isDragging.current && sendMessage(prompt)}
            disabled={chatLoading}
          >
            <span className="quick-num">0{i + 1}</span>
            <span>{prompt}</span>
          </button>
        ))}
      </div>

      {/* ── 입력창 ── */}
      <div className="composer">
        {/* 파일 첨부 드롭다운 */}
        {showFileDropdown && (
          <FileAttachDropdown
            files={files || []}
            attachedFiles={attachedFiles}
            setAttachedFiles={setAttachedFiles}
            addToast={addToast}
            onClose={() => setShowFileDropdown(false)}
          />
        )}

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
                setAttachedFiles((prev) => [...prev, fileName]);
                addToast(`'${fileName}' 문서가 첨부되었습니다.`, "info");
              }
            }
          }}
        >
          {attachedFiles.length > 0 && (
            <div className="composer-attachments">
              {attachedFiles.map((name) => (
                <span key={name} className="attachment-chip">
                  <span className="chip-ext">{name.split(".").pop()?.toUpperCase()}</span>
                  <span className="chip-name">{name}</span>
                  <button
                    className="chip-del"
                    onClick={() =>
                      setAttachedFiles((prev) => prev.filter((f) => f !== name))
                    }
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* 자동 높이 textarea */}
          <textarea
            ref={mergedRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!isOverLimit) sendMessage();
              }
            }}
            placeholder="정책, 가이드, 사내 문서에 대해 질문해보세요..."
            disabled={chatLoading}
            rows={1}
            style={{ minHeight: 44, maxHeight: 160 }}
            aria-label="질문 입력"
          />

          <div className="composer-footer">
            <div className="composer-left">
              {/* 📎 파일 첨부 버튼 */}
              <button
                type="button"
                className={`btn-attach ${showFileDropdown ? "active" : ""} ${attachedFiles.length > 0 ? "has-files" : ""}`}
                onClick={() => setShowFileDropdown((v) => !v)}
                title="문서 첨부"
                disabled={chatLoading}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                </svg>
                {attachedFiles.length > 0 && (
                  <span className="attach-badge">{attachedFiles.length}</span>
                )}
              </button>
              <span className="composer-status">{statusMessage}</span>
            </div>
            <div className="composer-actions">
              <span className="key-hint">Shift+Enter 줄바꿈</span>

              {/* 글자수 카운터 */}
              {input.length > 0 && (
                <span
                  className="char-counter"
                  style={{
                    color: isOverLimit
                      ? "var(--danger)"
                      : isNearLimit
                      ? "#f59e0b"
                      : "var(--text-dim)",
                    fontWeight: isNearLimit ? 600 : 400,
                  }}
                >
                  {input.length.toLocaleString()} / {CHAR_LIMIT.toLocaleString()}
                </span>
              )}

              {chatLoading ? (
                <button
                  type="button"
                  className="btn-stop"
                  onClick={stopGeneration}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    style={{ marginRight: 6 }}
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                  </svg>
                  중단
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-send"
                  onClick={() => sendMessage()}
                  disabled={chatLoading || !input.trim() || isOverLimit}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 5 }}>
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                  </svg>
                  보내기
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
