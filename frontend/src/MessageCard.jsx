import { useEffect, useRef, useState } from "react";
import SimpleMarkdown from "./MarkdownRenderer";
import { TypingDots } from "./ChatComponents";

function relativeTime(isoString) {
  if (!isoString) return "";
  const diff = Math.floor((Date.now() - new Date(isoString)) / 1000);
  if (diff < 10)  return "방금";
  if (diff < 60)  return `${diff}초 전`;
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return new Date(isoString).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

function scoreColor(score) {
  if (score === null || score === undefined) return "var(--text-dim)";
  if (score >= 0.7) return "#22c55e";
  if (score >= 0.45) return "var(--accent)";
  return "var(--danger)";
}

const formatScore = (score) => {
  if (score === null || score === undefined) return "-";
  return Number(score).toFixed(3);
};

/**
 * 답변 텍스트의 [숫자] 패턴을 클릭 가능한 citation 뱃지로 변환한다.
 * sources 배열의 citation_index와 매핑되어 해당 소스 카드를 하이라이트한다.
 */
function CitationContent({ content, sources, onCitationClick }) {
  if (!sources?.length || !content) {
    return <SimpleMarkdown content={content} />;
  }

  // [숫자] 패턴을 기준으로 텍스트를 분할한 뒤 뱃지로 교체
  const citationRe = /\[(\d+)\]/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  // citation 번호가 있는지 확인
  const hasCitations = citationRe.test(content);
  citationRe.lastIndex = 0; // reset after test

  if (!hasCitations) {
    return <SimpleMarkdown content={content} />;
  }

  // 텍스트를 segments로 분할
  const segments = [];
  while ((match = citationRe.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", value: content.slice(lastIndex, match.index) });
    }
    segments.push({ type: "citation", num: parseInt(match[1], 10) });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    segments.push({ type: "text", value: content.slice(lastIndex) });
  }

  return (
    <span>
      {segments.map((seg, i) => {
        if (seg.type === "text") {
          return <SimpleMarkdown key={i} content={seg.value} />;
        }
        // citation 뱃지
        const num = seg.num;
        const matchedSrc = sources.find((s) => s.citation_index === num);
        return (
          <button
            key={i}
            className="citation-badge"
            title={matchedSrc ? `출처: ${matchedSrc.source}` : `[${num}]`}
            onClick={() => matchedSrc && onCitationClick(num)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 18,
              height: 18,
              borderRadius: "50%",
              fontSize: 10,
              fontWeight: 700,
              background: matchedSrc ? "var(--accent)" : "var(--border)",
              color: matchedSrc ? "#fff" : "var(--text-dim)",
              border: "none",
              cursor: matchedSrc ? "pointer" : "default",
              marginLeft: 2,
              marginRight: 2,
              verticalAlign: "super",
              lineHeight: 1,
              flexShrink: 0,
              transition: "opacity 0.15s",
            }}
          >
            {num}
          </button>
        );
      })}
    </span>
  );
}

export default function MessageCard({ message, isStreaming, onFeedback, onRegenerate, isLastAssistant, isLastUser, onRetry, onViewDoc, onSuggestionClick }) {
  const [copied, setCopied] = useState(false);
  const [sourceExpanded, setSourceExpanded] = useState(null);
  const [highlightedCitation, setHighlightedCitation] = useState(null);
  const [, setTick] = useState(0);
  const sourceRefs = useRef({});
  const isUser = message.role === "user";
  const showThinking = !isUser && isStreaming && message.isSearching;
  const showDots = !isUser && isStreaming && !message.isSearching && !message.content;
  const charCount = message.content?.length ?? 0;

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // citation 클릭 시 해당 소스 카드를 열고 스크롤
  const handleCitationClick = (citationIndex) => {
    const sources = message.sources || [];
    const srcIdx = sources.findIndex((s) => s.citation_index === citationIndex);
    if (srcIdx === -1) return;

    setSourceExpanded(srcIdx);
    setHighlightedCitation(citationIndex);

    // 잠시 후 스크롤 (DOM 업데이트 대기)
    setTimeout(() => {
      sourceRefs.current[srcIdx]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 80);

    // 하이라이트 2초 후 해제
    setTimeout(() => setHighlightedCitation(null), 2000);
  };

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
        <span className="msg-role">{isUser ? "나" : "AI"}</span>
        {!isUser && message.score !== null && message.score !== undefined && (
          <span className="msg-score" title={`관련성 점수: ${formatScore(message.score)}`}
            style={{ color: scoreColor(message.score), background: scoreColor(message.score) + "18", border: `1px solid ${scoreColor(message.score)}44` }}>
            {formatScore(message.score)}
          </span>
        )}
        {isStreaming && charCount > 0 && (
          <span className="msg-char-count">{charCount.toLocaleString()}자</span>
        )}
        {message.createdAt && !isStreaming && (
          <span className="msg-timestamp" title={new Date(message.createdAt).toLocaleString("ko-KR")}>
            {relativeTime(message.createdAt)}
          </span>
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
          // ── [개선] citation 뱃지 렌더링 ──
          <CitationContent
            content={message.content}
            sources={message.sources}
            onCitationClick={handleCitationClick}
          />
        )}
      </div>

      {message.sources?.length > 0 && (
        <div className="source-section">
          <span className="source-header">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 5, verticalAlign: "middle" }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            참고 문서 {message.sources.length}개
          </span>
          <div className="source-grid">
            {message.sources.map((src, i) => {
              const isHighlighted = highlightedCitation !== null && src.citation_index === highlightedCitation;
              return (
                <div
                  key={`${message.id}-src-${i}`}
                  ref={(el) => { sourceRefs.current[i] = el; }}
                  className={`source-card ${sourceExpanded === i ? "expanded" : ""}`}
                  onClick={() => setSourceExpanded(sourceExpanded === i ? null : i)}
                  title="클릭하여 전체 내용 보기"
                  style={isHighlighted ? {
                    outline: "2px solid var(--accent)",
                    outlineOffset: 2,
                    transition: "outline 0.2s",
                  } : undefined}
                >
                  <div className="source-top">
                    {/* ── [신규] citation 번호 배지 ── */}
                    {src.citation_index != null && src.citation_index > 0 && (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          fontSize: 10,
                          fontWeight: 700,
                          background: "var(--accent)",
                          color: "#fff",
                          marginRight: 5,
                          flexShrink: 0,
                        }}
                        title={`출처 번호 [${src.citation_index}]`}
                      >
                        {src.citation_index}
                      </span>
                    )}
                    <span className="source-ext">{src.source.split(".").pop()?.toUpperCase() || "DOC"}</span>
                    <strong className="source-name">{src.source}</strong>
                    <span className="source-score" style={{ color: scoreColor(src.score), background: scoreColor(src.score) + "18" }}>
                      {formatScore(src.score)}
                    </span>
                  </div>
                  <p className="source-preview">{src.preview}</p>
                  <button
                    className="btn-view-full"
                    onClick={(e) => { e.stopPropagation(); onViewDoc(src.source, src.full_text || src.preview, src.chunk_index); }}
                  >» 원문 보기</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 후속 질문 추천 칩 */}
      {!isUser && !isStreaming && message.suggestions?.length > 0 && onSuggestionClick && (
        <div className="suggestion-chips" role="group" aria-label="후속 질문 추천">
          <span className="suggestion-label">이어서 물어보기</span>
          <div className="suggestion-list">
            {message.suggestions.map((s, i) => (
              <button
                key={i}
                className="suggestion-chip"
                onClick={() => onSuggestionClick(s)}
                title={s}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 5, flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
                </svg>
                {s}
              </button>
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
