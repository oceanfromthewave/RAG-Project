import MessageCard from "./MessageCard";
import { ChatSkeleton } from "./ChatComponents";

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
  handleScroll
}) {
  const lastUserIndex = [...messages].reverse().findIndex(m => m.role === "user");
  const realLastUserIndex = lastUserIndex === -1 ? -1 : messages.length - 1 - lastUserIndex;

  return (
    <section className="chat-panel" aria-label="문서 채팅">
      <div className="chat-panel-head">
        <div className="chat-panel-title">
          <h2>문서 채팅</h2>
          <p>스트리밍 응답 · 근거 문서 표시 · 문맥 검색</p>
        </div>
        <div className="chat-panel-actions">
          <div className="export-dropdown" style={{ position: "relative", display: "inline-block" }}>
            <button type="button" className="btn-ghost" onClick={() => handleExportChat("markdown")} title="Markdown으로 내보내기">
              MD
            </button>
            <button type="button" className="btn-ghost" onClick={() => handleExportChat("json")} title="JSON으로 내보내기" style={{ marginLeft: "5px" }}>
              JSON
            </button>
          </div>
          <button type="button" className="btn-ghost" onClick={handleResetChat} style={{ marginLeft: "10px" }}>채팅 초기화</button>
        </div>
      </div>

      <div className="chat-feed" role="log" aria-live="polite" aria-label="채팅 메시지" onScroll={handleScroll}>
        {historyLoading ? (
          <ChatSkeleton />
        ) : messages.map((message, idx) => (
          <MessageCard
            key={message.id}
            message={message}
            isStreaming={chatLoading && (idx === messages.length - 1 || idx === realLastUserIndex)}
            onFeedback={handleFeedback}
            onRegenerate={handleRegenerate}
            onRetry={handleRegenerate}
            onViewDoc={(title, content, chunkIndex) => setDocSidebar({ isOpen: true, title, content, highlightChunkIndex: chunkIndex })}
            isLastAssistant={idx === messages.length - 1 && message.role === "assistant"}
            isLastUser={idx === realLastUserIndex}
          />
        ))}
        <div ref={chatEndRef} />

        {!isAtBottom && (
          <button 
            className="btn-scroll-bottom" 
            onClick={scrollToBottom}
            aria-label="맨 아래로 이동"
            title="맨 아래로 이동"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 13l5 5 5-5M7 6l5 5 5-5"/>
            </svg>
          </button>
        )}
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
              {chatLoading ? (
                <button type="button" className="btn-stop" onClick={stopGeneration}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  </svg>
                  중단
                </button>
              ) : (
                <button type="button" className="btn-send" onClick={() => sendMessage()} disabled={chatLoading || !input.trim()}>
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
