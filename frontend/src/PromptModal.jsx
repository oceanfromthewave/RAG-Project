import { useEffect, useRef, useState } from "react";

export default function PromptModal({
  isOpen,
  title,
  message,
  placeholder = "",
  defaultValue = "",
  confirmText = "확인",
  cancelText = "취소",
  maxLength = 50,
  onConfirm,
  onCancel,
}) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setValue(defaultValue);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen, defaultValue]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    onConfirm(trimmed);
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h3>{title}</h3></div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {message && <p>{message}</p>}
            <input
              ref={inputRef}
              type="text"
              className="modal-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              maxLength={maxLength}
            />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onCancel}>
              {cancelText}
            </button>
            <button type="submit" className="btn-primary-modal" disabled={!canSubmit}>
              {confirmText}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
