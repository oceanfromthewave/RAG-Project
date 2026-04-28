export function DocViewerModal({ isOpen, title, content, highlightChunkIndex, onCancel }) {
  if (!isOpen) return null;
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-container doc-viewer" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <h3>{title}</h3>
            {highlightChunkIndex !== null && (
              <span className="badge highlight-badge">검색된 단락 #{highlightChunkIndex}</span>
            )}
          </div>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-body doc-content">
          <div className={highlightChunkIndex !== null ? "highlighted-box" : ""}>
            <pre>{content}</pre>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onCancel}>닫기</button>
        </div>
      </div>
    </div>
  );
}

export function DocSidebar({ isOpen, title, content, highlightChunkIndex, onClose }) {
  if (!isOpen) return null;
  return (
    <aside className="doc-sidebar">
      <div className="doc-sidebar-head">
        <div className="sidebar-title-group">
          <h3>문서 원문</h3>
          {highlightChunkIndex !== null && (
            <span className="badge highlight-badge">검색된 단락 #{highlightChunkIndex}</span>
          )}
        </div>
        <button className="btn-close-sidebar" onClick={onClose}>✕</button>
      </div>
      <div className="doc-sidebar-body">
        <div className="doc-sidebar-title">{title}</div>
        <div className={`doc-sidebar-content-wrapper ${highlightChunkIndex !== null ? "highlighted-box" : ""}`}>
          <pre className="doc-sidebar-content">{content}</pre>
        </div>
      </div>
    </aside>
  );
}

export function FileSkeleton() {
  return (
    <div className="file-skeleton-container">
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="file-item-skeleton">
          <div className="skeleton icon" />
          <div className="skeleton text" />
        </div>
      ))}
    </div>
  );
}

export function ChatSkeleton() {
  return (
    <div className="chat-history-skeleton">
      <div className="skeleton msg assistant" />
      <div className="skeleton msg user" />
      <div className="skeleton msg assistant" />
    </div>
  );
}

export function TypingDots() {
  return (
    <span className="typing-dots" aria-label="입력 중">
      <span /><span /><span />
    </span>
  );
}
