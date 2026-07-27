import { useCallback, useEffect, useRef, useState } from "react";
import ConfirmModal from "../../components/ConfirmModal";
import { API_BASE_URL } from "../../lib/constants";
import { ToastRegion } from "../../components/Toast";
import { useAuth } from "../auth/AuthContext";

const API_BASE = API_BASE_URL;

export default function AdminPage({ onBack }) {
  const { authFetch } = useAuth();
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirmData, setConfirmData] = useState({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: null,
    confirmText: "확인",
    confirmType: "danger",
  });
  const [toasts, setToasts] = useState([]);
  const [logFilter, setLogFilter] = useState({ user_id: "", role: "", limit: 100 });
  const [searchInput, setSearchInput] = useState("");
  const toastIdRef = useRef(0);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback((message, type = "info") => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => dismissToast(id), 6000);
  }, [dismissToast]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const logParams = new URLSearchParams();
      if (logFilter.user_id) {
        logParams.append("user_id", logFilter.user_id);
      }
      if (logFilter.role) {
        logParams.append("role", logFilter.role);
      }
      logParams.append("limit", String(logFilter.limit));

      const [usersRes, statsRes, logsRes] = await Promise.all([
        authFetch(`${API_BASE}/admin/users`),
        authFetch(`${API_BASE}/admin/stats/global`),
        authFetch(`${API_BASE}/admin/logs?${logParams.toString()}`),
      ]);

      if (!usersRes.ok || !statsRes.ok || !logsRes.ok) {
        throw new Error("관리자 데이터를 불러오지 못했습니다.");
      }

      const [usersData, statsData, logsData] = await Promise.all([
        usersRes.json(),
        statsRes.json(),
        logsRes.json(),
      ]);

      setUsers(usersData);
      setStats(statsData);
      setLogs(logsData);
      setError("");
    } catch (err) {
      setError(err.message);
      addToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }, [addToast, authFetch, logFilter]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void fetchData();
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [fetchData]);

  const handleSearchKeyDown = (event) => {
    if (event.key === "Enter") {
      setLogFilter((prev) => ({ ...prev, user_id: searchInput.trim() }));
    }
  };

  const handleChangeRole = (userId, username, currentIsAdmin) => {
    const actionLabel = currentIsAdmin ? "관리자 권한을 회수" : "관리자 권한을 부여";

    setConfirmData({
      isOpen: true,
      title: "권한 변경",
      message: `"${username}" 사용자에게 ${actionLabel}하시겠습니까?`,
      confirmText: "변경",
      confirmType: "primary",
      onConfirm: async () => {
        setConfirmData((prev) => ({ ...prev, isOpen: false }));
        try {
          const response = await authFetch(`${API_BASE}/admin/users/${userId}/role`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_admin: !currentIsAdmin }),
          });
          if (!response.ok) {
            throw new Error("권한 변경에 실패했습니다.");
          }
          addToast("사용자 권한이 변경되었습니다.", "success");
          await fetchData();
        } catch (err) {
          addToast(err.message, "error");
        }
      },
    });
  };

  const handleDeleteUser = (userId, username) => {
    setConfirmData({
      isOpen: true,
      title: "사용자 삭제",
      message: `"${username}" 계정을 영구적으로 삭제할까요?`,
      confirmText: "삭제",
      confirmType: "danger",
      onConfirm: async () => {
        setConfirmData((prev) => ({ ...prev, isOpen: false }));
        try {
          const response = await authFetch(`${API_BASE}/admin/users/${userId}`, {
            method: "DELETE",
          });
          if (!response.ok) {
            throw new Error("사용자 삭제에 실패했습니다.");
          }
          addToast("사용자가 삭제되었습니다.", "success");
          await fetchData();
        } catch (err) {
          addToast(err.message, "error");
        }
      },
    });
  };

  if (loading) {
    return <div className="admin-loading">관리자 데이터를 불러오는 중...</div>;
  }

  if (error) {
    return <div className="admin-error">오류: {error}</div>;
  }

  return (
    <div className="admin-container">
      <ToastRegion toasts={toasts} onDismiss={dismissToast} />
      <ConfirmModal
        isOpen={confirmData.isOpen}
        title={confirmData.title}
        message={confirmData.message}
        confirmText={confirmData.confirmText}
        confirmType={confirmData.confirmType}
        onConfirm={confirmData.onConfirm}
        onCancel={() => setConfirmData((prev) => ({ ...prev, isOpen: false }))}
      />

      <header className="admin-header">
        <button className="btn-ghost" onClick={onBack}>← 뒤로가기</button>
        <h1>관리자 대시보드</h1>
      </header>

      <section className="admin-stats-grid">
        <div className="admin-stat-card">
          <label>전체 사용자</label>
          <strong>{stats?.total_users ?? 0}</strong>
        </div>
        <div className="admin-stat-card">
          <label>전체 청크 수</label>
          <strong>{stats?.total_chunks_in_db ?? 0}</strong>
        </div>
        <div className="admin-stat-card">
          <label>서버 상태</label>
          <strong className="status-healthy">{stats?.server_status || "알 수 없음"}</strong>
        </div>
      </section>

      <section className="admin-user-section">
        <h3>사용자 관리</h3>
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>사용자명</th>
                <th>권한</th>
                <th>가입일</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {users.map((userItem) => (
                <tr key={userItem.id}>
                  <td>{userItem.username}</td>
                  <td>
                    <span className={`badge ${userItem.is_admin ? "admin" : "user"}`}>
                      {userItem.is_admin ? "관리자" : "일반"}
                    </span>
                  </td>
                  <td>{new Date(userItem.created_at).toLocaleDateString()}</td>
                  <td>
                    <div style={{ display: "flex", gap: "10px" }}>
                      <button
                        className="btn-action-user"
                        onClick={() => handleChangeRole(userItem.id, userItem.username, userItem.is_admin)}
                      >
                        {userItem.is_admin ? "관리자 해제" : "관리자 지정"}
                      </button>
                      <button
                        className="btn-del-user"
                        onClick={() => handleDeleteUser(userItem.id, userItem.username)}
                        title="계정 삭제"
                      >
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-user-section" style={{ marginTop: "40px" }}>
        <div className="admin-log-header">
          <h3>최근 활동</h3>
          <div className="admin-filter-bar">
            <div className="filter-item">
              <span className="filter-icon">U</span>
              <input
                type="text"
                placeholder="사용자 검색"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                onKeyDown={handleSearchKeyDown}
              />
            </div>
            <div className="filter-item">
              <span className="filter-icon">R</span>
              <select
                value={logFilter.role}
                onChange={(event) => setLogFilter((prev) => ({ ...prev, role: event.target.value }))}
              >
                <option value="">전체 역할</option>
                <option value="user">사용자</option>
                <option value="assistant">AI</option>
              </select>
            </div>
            <div className="filter-item">
              <span className="filter-icon">L</span>
              <select
                value={logFilter.limit}
                onChange={(event) => setLogFilter((prev) => ({
                  ...prev,
                  limit: Number.parseInt(event.target.value, 10),
                }))}
              >
                <option value="50">50개</option>
                <option value="100">100개</option>
                <option value="200">200개</option>
                <option value="500">500개</option>
              </select>
            </div>
            <button className="btn-refresh-logs" onClick={() => void fetchData()} title="새로고침">
              새로고침
            </button>
          </div>
        </div>

        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>시각</th>
                <th>사용자</th>
                <th>내용</th>
                <th>피드백</th>
                <th>점수</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td title={log.created_at}>{new Date(log.created_at).toLocaleTimeString()}</td>
                  <td>
                    <span className="log-user" title={log.user_id}>{log.username}</span>
                  </td>
                  <td title={log.content}>
                    <div style={{ maxWidth: "300px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <span className={`log-role-tag ${log.role}`}>
                        {log.role === "user" ? log.username : "AI"}
                      </span>
                      {log.content}
                    </div>
                  </td>
                  <td>{log.feedback === 1 ? "👍" : log.feedback === -1 ? "👎" : "-"}</td>
                  <td>{log.score ? log.score.toFixed(4) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <style>{`
        .admin-container { padding: 30px 20px; max-width: 1000px; margin: 0 auto; color: var(--text); }
        @media (max-width: 600px) {
          .admin-container { padding: 20px 15px; }
          .admin-stats-grid { grid-template-columns: 1fr !important; }
          .admin-header h1 { font-size: 1.2rem; }
        }
        .admin-header { display: flex; align-items: center; gap: 20px; margin-bottom: 30px; }
        .admin-header h1 { font-size: 1.5rem; font-weight: 700; }

        .admin-stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 40px; }
        .admin-stat-card { background: var(--surface-raised); border: 1px solid var(--line-strong); padding: 20px; border-radius: var(--r-lg); }
        .admin-stat-card label { display: block; font-size: 0.8rem; color: var(--text-muted); margin-bottom: 8px; }
        .admin-stat-card strong { font-size: 1.4rem; font-weight: 700; color: var(--accent); }
        .status-healthy { color: #10b981 !important; text-transform: uppercase; }

        .admin-user-section h3 { margin-bottom: 15px; font-weight: 700; }
        .admin-table-wrapper { background: var(--surface); border: 1px solid var(--line-strong); border-radius: var(--r-lg); overflow-x: auto; }
        .admin-table { width: 100%; border-collapse: collapse; text-align: left; min-width: 600px; }
        .admin-table th { background: var(--surface-inset); padding: 12px 15px; font-size: 0.85rem; color: var(--text-muted); }
        .admin-table td { padding: 12px 15px; border-top: 1px solid var(--line); font-size: 0.9rem; }

        .badge.admin { background: var(--accent-light); color: var(--accent); }
        .badge.user { background: var(--surface-inset); color: var(--text-muted); }

        .btn-action-user { color: var(--accent); font-size: 0.8rem; background: none; border: none; cursor: pointer; font-weight: 600; }
        .btn-action-user:hover { text-decoration: underline; }

        .btn-del-user { color: var(--danger); font-size: 0.8rem; background: none; border: none; cursor: pointer; font-weight: 600; }
        .btn-del-user:hover { text-decoration: underline; }

        .admin-log-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; gap: 20px; flex-wrap: wrap; }
        .admin-filter-bar { display: flex; align-items: center; gap: 10px; background: var(--surface-inset); padding: 8px 15px; border-radius: var(--r-md); border: 1px solid var(--line-strong); }
        .filter-item { display: flex; align-items: center; gap: 6px; border-right: 1px solid var(--line-strong); padding-right: 10px; }
        .filter-item:last-child { border-right: none; }
        .filter-icon { font-size: 0.9rem; opacity: 0.7; }
        .filter-item input, .filter-item select { background: transparent; border: none; color: var(--text); font-size: 0.85rem; outline: none; padding: 4px 0; }
        .filter-item input { width: 120px; }
        .btn-refresh-logs { background: none; border: none; color: var(--accent); cursor: pointer; font-size: 0.9rem; padding: 0 5px; }

        .log-user { font-weight: 600; color: var(--text); }
        .log-role-tag { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; font-weight: 700; margin-right: 8px; text-transform: uppercase; }
        .log-role-tag.user { background: var(--surface-raised); color: var(--text-muted); border: 1px solid var(--line); }
        .log-role-tag.assistant { background: var(--accent-light); color: var(--accent); }

        .admin-loading, .admin-error { padding: 100px; text-align: center; color: var(--text-muted); }
      `}</style>
    </div>
  );
}
