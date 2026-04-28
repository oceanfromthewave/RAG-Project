export default function TopBar({
  sidebarOpen,
  setSidebarOpen,
  setView,
  view,
  stats,
  selectedModel,
  chatLoading,
  darkMode,
  setDarkMode,
  user,
  handleLogout
}) {
  return (
    <header className="top-bar">
      <button 
        className="btn-sidebar-toggle" 
        onClick={() => setSidebarOpen(!sidebarOpen)} 
        title={sidebarOpen ? "사이드바 접기" : "사이드바 펴기"}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="12" x2="21" y2="12"></line>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>
      </button>

      <div className="brand" onClick={() => setView("chat")} role="button" title="홈(채팅)으로 이동">
        <div className="brand-mark" aria-hidden="true">
          <img src="/favicon-transparent.png" alt="" />
        </div>
        <span className="brand-name">acanet Workspace</span>
      </div>

      <div className="top-sep" aria-hidden="true" />

      <div className="top-stats">
        <div className="stat-pill">
          <span className="stat-pill-label">문서</span>
          <strong className="stat-pill-val">{stats.indexed_files}</strong>
        </div>
        <div className="stat-pill">
          <span className="stat-pill-label">청크</span>
          <strong className="stat-pill-val">{stats.total_chunks}</strong>
        </div>
        <div className="stat-pill">
          <span className="stat-pill-label">모델</span>
          <strong className="stat-pill-val">{selectedModel || stats.chat_model}</strong>
        </div>
      </div>

      <div className={`top-live ${chatLoading ? "streaming" : ""}`} aria-live="polite">
        <span className="live-dot" />
        <span>{chatLoading ? "생성 중" : "대기 중"}</span>
      </div>

      {/* 다크모드 토글 */}
      <button
        className="btn-dark-toggle"
        onClick={() => setDarkMode(d => !d)}
        title={darkMode ? "라이트 모드" : "다크 모드"}
        aria-label="다크모드 전환"
      >
        {darkMode ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
            <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
        )}
      </button>

      {/* 관리자 대시보드 버튼 */}
      {user?.isAdmin && (
        <button
          className={`btn-ghost ${view === "admin" ? "active" : ""}`}
          onClick={() => setView(view === "chat" ? "admin" : "chat")}
          style={{ marginLeft: "auto"}}
        >
          {view === "chat" ? "시스템 관리" : "채팅으로 복귀"}
        </button>
      )}

      {/* 사용자 정보 + 로그아웃 */}
      <div className="top-user" style={!user?.isAdmin ? { marginLeft: "auto" } : {}}>
        <span 
          className={`top-username ${view === "mypage" ? "active" : ""}`} 
          onClick={() => setView(view === "mypage" ? "chat" : "mypage")}
          title="마이페이지로 이동"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, verticalAlign: "middle" }}>
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
          {user?.username}
        </span>
        <button className="btn-logout" onClick={handleLogout} title="로그아웃">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
            <polyline points="16 17 21 12 16 7"></polyline>
            <line x1="21" y1="12" x2="9" y2="12"></line>
          </svg>
          로그아웃
        </button>
      </div>
    </header>
  );
}
