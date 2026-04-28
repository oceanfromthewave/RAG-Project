import { useState } from "react";
import SimpleMarkdown from "./MarkdownRenderer";
import { TypingDots } from "./ChatComponents";

const formatScore = (score) => {
  if (score === null || score === undefined) return "-";
  return Number(score).toFixed(4);
};

export default function MessageCard({ message, isStreaming, onFeedback, onRegenerate, isLastAssistant, isLastUser, onRetry, onViewDoc }) {
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
          {isUser && isLastUser && !isStreaming && (
            <button className="msg-action-btn" onClick={onRetry} title="다시 보내기">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
            </button>
          )}
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
                  onClick={(e) => { e.stopPropagation(); onViewDoc(src.source, src.full_text || src.preview, src.chunk_index); }}
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
