import { useEffect } from "react";

export default function ConfirmModal({ isOpen, title, message, onConfirm, onCancel, confirmText = "삭제", confirmType = "danger" }) {
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
          <button 
            type="button" 
            className={`btn-${confirmType === "danger" ? "danger" : "primary"}`} 
            onClick={onConfirm} 
            autoFocus
            style={confirmType === "primary" ? {
              padding: "8px 18px",
              borderRadius: "var(--r-md)",
              background: "var(--accent)",
              color: "white",
              fontSize: "0.85rem",
              fontWeight: "600",
              border: "none",
              cursor: "pointer"
            } : {}}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
