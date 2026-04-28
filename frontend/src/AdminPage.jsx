import { useEffect, useState } from "react";
import { useAuth } from "./AuthContext";

const API_BASE = "http://127.0.0.1:8000";

export default function AdminPage({ onBack }) {
  const { authFetch } = useAuth();
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchData = async () => {
    setLoading(true);
    try {
      const [uRes, sRes, lRes] = await Promise.all([
        authFetch(`${API_BASE}/admin/users`),
        authFetch(`${API_BASE}/admin/stats/global`),
        authFetch(`${API_BASE}/admin/logs`)
      ]);
      
      if (!uRes.ok || !sRes.ok || !lRes.ok) throw new Error("데이터를 불러오지 못했습니다.");
      
      const uData = await uRes.json();
      const sData = await sRes.json();
      const lData = await lRes.json();
      
      setUsers(uData);
      setStats(sData);
      setLogs(lData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleChangeRole = async (userId, username, currentIsAdmin) => {
    const action = currentIsAdmin ? "해제" : "부여";
    if (!confirm(`'${username}' 사용자에게 관리자 권한을 ${action}하시겠습니까?`)) return;
    
    try {
      const res = await authFetch(`${API_BASE}/admin/users/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_admin: !currentIsAdmin })
      });
      if (!res.ok) throw new Error("권한 변경에 실패했습니다.");
      alert(`관리자 권한이 ${action}되었습니다.`);
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteUser = async (userId, username) => {
    if (!confirm(`정말로 '${username}' 사용자를 삭제하시겠습니까? 관련 모든 데이터가 삭제됩니다.`)) return;
    
    try {
      const res = await authFetch(`${API_BASE}/admin/users/${userId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("사용자 삭제에 실패했습니다.");
      alert("사용자가 삭제되었습니다.");
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) return <div className="admin-loading">관리자 데이터를 불러오는 중...</div>;
  if (error) return <div className="admin-error">오류: {error}</div>;

  return (
    <div className="admin-container">
      <header className="admin-header">
        <button className="btn-ghost" onClick={onBack}>← 뒤로가기</button>
        <h1>시스템 관리자 대시보드</h1>
      </header>

      <section className="admin-stats-grid">
        <div className="admin-stat-card">
          <label>전체 사용자</label>
          <strong>{stats?.total_users}명</strong>
        </div>
        <div className="admin-stat-card">
          <label>전체 문서 청크</label>
          <strong>{stats?.total_chunks_in_db}개</strong>
        </div>
        <div className="admin-stat-card">
          <label>서버 상태</label>
          <strong className="status-healthy">{stats?.server_status}</strong>
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
              {users.map(u => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>
                    <span className={`badge ${u.is_admin ? "admin" : "user"}`}>
                      {u.is_admin ? "관리자" : "일반"}
                    </span>
                  </td>
                  <td>{new Date(u.created_at).toLocaleDateString()}</td>
                  <td>
                    <div style={{ display: "flex", gap: "10px" }}>
                      <button 
                        className="btn-action-user"
                        onClick={() => handleChangeRole(u.id, u.username, u.is_admin)}
                      >
                        {u.is_admin ? "권한 해제" : "관리자 승격"}
                      </button>
                      <button 
                        className="btn-del-user"
                        onClick={() => handleDeleteUser(u.id, u.username)}
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
        <h3>최근 사용자 활동 및 피드백</h3>
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>시간</th>
                <th>사용자</th>
                <th>내용</th>
                <th>피드백</th>
                <th>신뢰도</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id}>
                  <td title={log.created_at}>{new Date(log.created_at).toLocaleTimeString()}</td>
                  <td>{log.user_id}</td>
                  <td title={log.content}>
                    <div style={{ maxWidth: "300px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      [{log.role}] {log.content}
                    </div>
                  </td>
                  <td>
                    {log.feedback === 1 ? "👍" : log.feedback === -1 ? "👎" : "-"}
                  </td>
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
        
        .admin-loading, .admin-error { padding: 100px; text-align: center; color: var(--text-muted); }
      `}</style>
    </div>
  );
}
