export function ToastRegion({ toasts, onDismiss }) {
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
