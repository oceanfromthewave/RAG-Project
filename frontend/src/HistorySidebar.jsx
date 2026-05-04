import { useState } from "react";

export default function HistorySidebar({
  workspaces,
  currentWorkspaceId,
  setCurrentWorkspaceId,
  handleCreateWorkspace,
  handleDeleteWorkspace,
  sessions,
  sessionFilter,
  setSessionFilter,
  handleSessionSearch,
  sessionSearchResults,
  sessionSearchLoading,
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
  activeStreamIds
}) {
  const [isWsOpen, setIsWsOpen] = useState(false);

  // sessionSearchResults가 null이면 제목 기반 필터, 아니면 전체 검색 결과 사용
  const isSearchMode = sessionSearchResults !== null;
  const displaySessions = isSearchMode
    ? sessionSearchResults
    : sessions.filter(s => s.title.toLowerCase().includes(sessionFilter.toLowerCase()));

  const currentWorkspace = workspaces.find(ws => ws.id === currentWorkspaceId);

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSessionFilter(val);
    if (handleSessionSearch) handleSessionSearch(val);
  };

  return (
    <nav className="history-sidebar" aria-label="대화 기록">
      <div className="workspace-selector">
        <div className="ws-header">
          <label>워크스페이스</label>
          <button 
            className="btn-ws-add" 
            onClick={() => {
              const name = prompt("새 워크스페이스 이름을 입력하세요:");
              if (name) handleCreateWorkspace(name);
            }}
            title="새 워크스페이스 추가"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          </button>
        </div>

        <div className="ws-custom-dropdown">
          <button 
            className={`ws-trigger ${isWsOpen ? "active" : ""}`}
            onClick={() => setIsWsOpen(!isWsOpen)}
          >
            <div className="ws-trigger-content">
              <span className="ws-folder-icon">
                {currentWorkspaceId ? "📂" : "👤"}
              </span>
              <span className="ws-selected-name">
                {currentWorkspace?.name || "개인 워크스페이스"}
              </span>
            </div>
            <span className={`ws-chevron ${isWsOpen ? "open" : ""}`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </span>
          </button>

          {isWsOpen && (
            <>
              <div className="ws-dropdown-overlay" onClick={() => setIsWsOpen(false)} />
              <div className="ws-options">
                <div 
                  className={`ws-option ${!currentWorkspaceId ? "selected" : ""}`}
                  onClick={() => { setCurrentWorkspaceId(null); setIsWsOpen(false); }}
                >
                  <span className="ws-option-icon">👤</span>
                  <span className="ws-option-name">개인 워크스페이스</span>
                </div>
                
                {workspaces.map(ws => (
                  <div 
                    key={ws.id} 
                    className={`ws-option ${currentWorkspaceId === ws.id ? "selected" : ""}`}
                    onClick={() => { setCurrentWorkspaceId(ws.id); setIsWsOpen(false); }}
                  >
                    <span className="ws-option-icon">📂</span>
                    <span className="ws-option-name">{ws.name}</span>
                    <button 
                      className="btn-option-del"
                      onClick={(e) => { e.stopPropagation(); handleDeleteWorkspace(ws.id); }}
                      title="워크스페이스 삭제"
                    >✕</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="history-head">
        <button type="button" className="btn-new-chat" onClick={handleResetChat}>
          <span className="plus-icon">+</span>새 채팅 시작
        </button>
        <div className="history-search" style={{ position: "relative" }}>
          <input
            type="text"
            value={sessionFilter}
            onChange={handleSearchChange}
            placeholder="대화 전체 검색..."
            aria-label="대화 기록 검색"
          />
          {sessionSearchLoading && (
            <span style={{
              position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)",
              fontSize: "0.7rem", color: "var(--text-muted)", pointerEvents: "none"
            }}>
              ⟳
            </span>
          )}
        </div>
        {isSearchMode && (
          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", padding: "2px 4px" }}>
            {displaySessions.length > 0
              ? `${displaySessions.length}개 대화에서 발견`
              : "검색 결과 없음"}
          </div>
        )}
      </div>

      <div className="history-list">
        {displaySessions.length === 0 ? (
          <div className="empty-state" style={{ padding: "40px 20px" }}>
            <p style={{ opacity: 0.5, fontSize: "0.8rem" }}>
              {sessions.length === 0 ? "저장된 대화가 없습니다." : "검색 결과가 없습니다."}
            </p>
          </div>
        ) : (
          displaySessions.map((session) => (
            <div
              key={session.id}
              className={`history-item ${currentSessionId === session.id ? "active" : ""}`}
              onClick={() => editingSessionId !== session.id && loadSession(session.id)}
            >
              <span className="history-icon">
                {activeStreamIds.includes(session.id) ? "⟳" : "💬"}
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
                {/* 전체 검색 모드에서 매칭 스니펫 표시 */}
                {isSearchMode && session.matched_snippet && (
                  <span style={{
                    display: "block",
                    fontSize: "0.68rem",
                    color: "var(--text-muted)",
                    marginTop: "2px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: "180px",
                  }} title={session.matched_snippet}>
                    {session.matched_snippet}
                  </span>
                )}
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
