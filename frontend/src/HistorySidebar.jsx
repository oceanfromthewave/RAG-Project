import { useState } from "react";

/* ── 날짜 그룹 레이블 ──────────────────────────────────────── */
function dateGroup(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return "오늘";
  if (diffDays === 1) return "어제";
  if (diffDays <= 7) return "이번 주";
  if (diffDays <= 30) return "이번 달";
  return "이전";
}

function groupSessions(sessions, pinnedIds) {
  const pinned = sessions.filter((s) => pinnedIds.includes(s.id));
  const rest = sessions.filter((s) => !pinnedIds.includes(s.id));

  const groups = {};
  for (const s of rest) {
    const g = dateGroup(s.updated_at);
    if (!groups[g]) groups[g] = [];
    groups[g].push(s);
  }

  const ORDER = ["오늘", "어제", "이번 주", "이번 달", "이전"];
  const result = [];
  if (pinned.length > 0) result.push({ label: "📌 고정됨", items: pinned });
  for (const label of ORDER) {
    if (groups[label]?.length > 0) result.push({ label, items: groups[label] });
  }
  return result;
}

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
  activeStreams,
  pinnedSessions = [],
  togglePinSession,
}) {
  const [isWsOpen, setIsWsOpen] = useState(false);
  const [hoveredSession, setHoveredSession] = useState(null);

  const isSearchMode = sessionSearchResults !== null;
  const displaySessions = isSearchMode
    ? sessionSearchResults
    : sessions.filter((s) =>
        s.title.toLowerCase().includes(sessionFilter.toLowerCase())
      );

  const grouped = isSearchMode
    ? [{ label: null, items: displaySessions }]
    : groupSessions(displaySessions, pinnedSessions ?? []);

  const currentWorkspace = workspaces.find((ws) => ws.id === currentWorkspaceId);

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSessionFilter(val);
    if (handleSessionSearch) handleSessionSearch(val);
  };

  return (
    <nav className="history-sidebar" aria-label="대화 기록">
      {/* ── 워크스페이스 선택기 ── */}
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
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
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
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
                {workspaces.map((ws) => (
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
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── 상단 버튼 + 검색 ── */}
      <div className="history-head">
        <button type="button" className="btn-new-chat" onClick={handleResetChat}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          새 채팅 시작
        </button>
        <div className="history-search" style={{ position: "relative" }}>
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-dim)", pointerEvents: "none" }}
          >
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            value={sessionFilter}
            onChange={handleSearchChange}
            placeholder="대화 전체 검색..."
            aria-label="대화 기록 검색"
            style={{ paddingLeft: 30 }}
          />
          {sessionSearchLoading && (
            <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: "0.7rem", color: "var(--text-muted)", pointerEvents: "none", animation: "spin 1s linear infinite", display: "inline-block" }}>
              ↻
            </span>
          )}
        </div>
        {isSearchMode && (
          <div className="search-result-hint">
            {displaySessions.length > 0
              ? `${displaySessions.length}개 대화에서 발견`
              : "검색 결과 없음"}
            <button
              className="btn-clear-search"
              onClick={() => { setSessionFilter(""); if (handleSessionSearch) handleSessionSearch(""); }}
            >
              ✕ 검색 지우기
            </button>
          </div>
        )}
      </div>

      {/* ── 세션 목록 (그룹화) ── */}
      <div className="history-list">
        {grouped.length === 0 ? (
          <div className="empty-state" style={{ padding: "40px 20px" }}>
            <p style={{ opacity: 0.5, fontSize: "0.8rem" }}>
              {sessions.length === 0 ? "저장된 대화가 없습니다." : "검색 결과가 없습니다."}
            </p>
          </div>
        ) : (
          grouped.map((group) => (
            <div key={group.label ?? "results"} className="session-group">
              {group.label && (
                <div className="session-group-label">{group.label}</div>
              )}
              {group.items.map((session) => (
                <div
                  key={session.id}
                  className={`history-item ${currentSessionId === session.id ? "active" : ""}`}
                  onClick={() => editingSessionId !== session.id && loadSession(session.id)}
                  onMouseEnter={() => setHoveredSession(session.id)}
                  onMouseLeave={() => setHoveredSession(null)}
                >
                  <span className="history-icon">
                    {activeStreams?.has?.(session.id) ? (
                      <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>↻</span>
                    ) : "💬"}
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
                        title={session.title}
                      >
                        {session.title}
                      </span>
                    )}
                    <div className="history-meta">
                      <span className="history-date">
                        {new Date(session.updated_at).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
                      </span>
                      {session.message_count > 0 && (
                        <span className="history-msg-count">{session.message_count}개</span>
                      )}
                    </div>
                    {isSearchMode && session.matched_snippet && (
                      <span
                        className="history-snippet"
                        title={session.matched_snippet}
                      >
                        {session.matched_snippet}
                      </span>
                    )}
                  </div>

                  {/* 편집 + 핀 + 삭제 버튼 */}
                  {editingSessionId !== session.id && (
                    <div
                      className="history-item-actions"
                      style={{ opacity: hoveredSession === session.id ? 1 : 0 }}
                    >
                      {/* 편집 버튼 */}
                      <button
                        className="btn-history-action"
                        onClick={(e) => { e.stopPropagation(); startEditSession(e, session); }}
                        title="제목 편집"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      {togglePinSession && (
                        <button
                          className={`btn-history-action ${pinnedSessions?.includes(session.id) ? "pinned" : ""}`}
                          onClick={(e) => { e.stopPropagation(); togglePinSession(session.id); }}
                          title={pinnedSessions?.includes(session.id) ? "고정 해제" : "고정"}
                        >
                          {pinnedSessions?.includes(session.id) ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1">
                              <path d="M5 3l14 9-14 9V3z"/>
                            </svg>
                          ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                              <circle cx="12" cy="10" r="3"/>
                            </svg>
                          )}
                        </button>
                      )}
                      <button
                        className="btn-history-action btn-history-del-action"
                        onClick={(e) => deleteChatSession(e, session.id)}
                        title="대화 삭제"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                          <path d="M10 11v6M14 11v6"/>
                          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </nav>
  );
}
