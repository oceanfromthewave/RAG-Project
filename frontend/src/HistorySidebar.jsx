export default function HistorySidebar({
  sessions,
  sessionFilter,
  setSessionFilter,
  currentSessionId,
  loadSession,
  editingSessionId,
  editingTitle,
  setEditingTitle,
  submitEditSession,
  handleEditKeyDown,
  startEditSession,
  deleteChatSession,
  handleResetChat,
  activeStreams
}) {
  const filteredSessions = sessions.filter(s =>
    s.title.toLowerCase().includes(sessionFilter.toLowerCase())
  );

  return (
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
        {filteredSessions.length === 0 ? (
          <div className="empty-state" style={{ padding: "40px 20px" }}>
            <p style={{ opacity: 0.5, fontSize: "0.8rem" }}>
              {sessions.length === 0 ? "저장된 대화가 없습니다." : "검색 결과가 없습니다."}
            </p>
          </div>
        ) : (
          filteredSessions.map((session) => (
            <div
              key={session.id}
              className={`history-item ${currentSessionId === session.id ? "active" : ""}`}
              onClick={() => editingSessionId !== session.id && loadSession(session.id)}
            >
              <span className="history-icon">
                {activeStreams.has(session.id) ? "⟳" : "💬"}
              </span>
              <div className="history-content">
                {editingSessionId === session.id ? (
                  <input
                    className="history-title-edit"
                    value={editingTitle}
                    autoFocus
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onBlur={() => submitEditSession(session.id)}
                    onKeyDown={(e) => handleEditKeyDown(e, session.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span
                    className="history-title"
                    onDoubleClick={(e) => startEditSession(e, session)}
                    title="더블클릭하여 제목 편집"
                  >
                    {session.title}
                  </span>
                )}
                <span className="history-date">
                  {new Date(session.updated_at).toLocaleDateString()}
                </span>
              </div>
              {editingSessionId !== session.id && (
                <button
                  className="btn-history-del"
                  onClick={(e) => deleteChatSession(e, session.id)}
                  title="대화 삭제"
                >
                  ✕
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </nav>
  );
}
