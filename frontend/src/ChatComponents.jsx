export function DocViewerModal({ isOpen, title, content, onCancel }) {
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

export function DocSidebar({ isOpen, title, content, onClose }) {
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

export function TypingDots() {
  return (
    <span className="typing-dots" aria-label="입력 중">
      <span /><span /><span />
    </span>
  );
}
