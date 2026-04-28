import { useState } from "react";
import { useAuth } from "./AuthContext";
import { API_BASE_URL } from "./constants";
import ConfirmModal from "./ConfirmModal";

export default function MyPage({ onBack, userStats }) {
  const { user, authFetch } = useAuth();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });
  const [showConfirm, setShowConfirm] = useState(false);

  const handlePasswordChange = async () => {
    if (!oldPassword || !newPassword || !confirmPassword) {
      setMessage({ text: "모든 필드를 입력해주세요.", type: "error" });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ text: "새 비밀번호가 일치하지 않습니다.", type: "error" });
      return;
    }
    if (newPassword.length < 8) {
      setMessage({ text: "새 비밀번호는 8자 이상이어야 합니다.", type: "error" });
      return;
    }

    setLoading(true);
    setMessage({ text: "", type: "" });

    try {
      const res = await authFetch(`${API_BASE_URL}/auth/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          old_password: oldPassword,
          new_password: newPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "비밀번호 변경에 실패했습니다.");

      setMessage({ text: "비밀번호가 성공적으로 변경되었습니다.", type: "success" });
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setMessage({ text: err.message, type: "error" });
    } finally {
      setLoading(false);
      setShowConfirm(false);
    }
  };

  return (
    <div className="mypage-container">
      <header className="mypage-header">
        <button className="btn-ghost" onClick={onBack}>← 뒤로가기</button>
        <h1>마이페이지</h1>
      </header>

      <div className="mypage-grid">
        <section className="mypage-section profile-card">
          <h3>계정 정보</h3>
          <div className="profile-info">
            <div className="info-item">
              <label>사용자명</label>
              <span>{user?.username}</span>
            </div>
            <div className="info-item">
              <label>권한</label>
              <span className={`badge ${user?.isAdmin ? "admin" : "user"}`}>
                {user?.isAdmin ? "시스템 관리자" : "일반 사용자"}
              </span>
            </div>
          </div>

          <div className="usage-stats" style={{ marginTop: "30px" }}>
            <h3>내 문서 통계</h3>
            <div className="stats-mini-grid">
              <div className="stat-mini-card">
                <label>인덱싱된 문서</label>
                <strong>{userStats?.indexed_files || 0}개</strong>
              </div>
              <div className="stat-mini-card">
                <label>저장 용량</label>
                <strong>{( (userStats?.total_size_bytes || 0) / 1024 / 1024).toFixed(2)} MB</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="mypage-section password-card">
          <h3>비밀번호 변경</h3>
          <div className="form-group">
            <label>현재 비밀번호</label>
            <input 
              type="password" 
              value={oldPassword} 
              onChange={e => setOldPassword(e.target.value)}
              placeholder="현재 비밀번호를 입력하세요"
            />
          </div>
          <div className="form-group">
            <label>새 비밀번호</label>
            <input 
              type="password" 
              value={newPassword} 
              onChange={e => setNewPassword(e.target.value)}
              placeholder="새 비밀번호 (8자 이상)"
            />
          </div>
          <div className="form-group">
            <label>새 비밀번호 확인</label>
            <input 
              type="password" 
              value={confirmPassword} 
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="새 비밀번호 다시 입력"
            />
          </div>

          {message.text && (
            <div className={`form-message ${message.type}`}>
              {message.text}
            </div>
          )}

          <button 
            className="btn-primary" 
            style={{ width: "100%", marginTop: "10px" }}
            onClick={() => setShowConfirm(true)}
            disabled={loading}
          >
            {loading ? "변경 중..." : "비밀번호 변경"}
          </button>
        </section>
      </div>

      <ConfirmModal 
        isOpen={showConfirm}
        title="비밀번호 변경"
        message="비밀번호를 변경하시겠습니까? 변경 후에는 새로운 비밀번호로 로그인해야 합니다."
        confirmText="변경하기"
        confirmType="primary"
        onConfirm={handlePasswordChange}
        onCancel={() => setShowConfirm(false)}
      />

      <style>{`
        .mypage-container { padding: 30px 20px; max-width: 900px; margin: 0 auto; color: var(--text); }
        .mypage-header { display: flex; align-items: center; gap: 20px; margin-bottom: 30px; }
        .mypage-header h1 { font-size: 1.5rem; font-weight: 700; }

        .mypage-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; }
        @media (max-width: 768px) {
          .mypage-grid { grid-template-columns: 1fr; }
        }

        .mypage-section { 
          background: var(--surface); 
          border: 1px solid var(--line-strong); 
          padding: 24px; 
          border-radius: var(--r-lg);
          box-shadow: var(--shadow-sm);
        }
        .mypage-section h3 { margin-bottom: 20px; font-weight: 700; font-size: 1.1rem; color: var(--accent); }

        .info-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--line); }
        .info-item label { color: var(--text-muted); font-size: 0.9rem; }
        .info-item span { font-weight: 600; }

        .stats-mini-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 10px; }
        .stat-mini-card { background: var(--surface-inset); padding: 15px; border-radius: var(--r-md); border: 1px solid var(--line); }
        .stat-mini-card label { display: block; font-size: 0.75rem; color: var(--text-muted); margin-bottom: 5px; }
        .stat-mini-card strong { font-size: 1.1rem; color: var(--text); }

        .form-group { margin-bottom: 16px; }
        .form-group label { display: block; font-size: 0.85rem; color: var(--text-muted); margin-bottom: 6px; }
        .form-group input { 
          width: 100%; 
          padding: 10px 12px; 
          border-radius: var(--r-md); 
          border: 1px solid var(--line-strong); 
          background: var(--surface-inset); 
          color: var(--text);
          font-size: 0.9rem;
        }
        .form-group input:focus { outline: none; border-color: var(--accent); }

        .form-message { padding: 10px; border-radius: var(--r-md); font-size: 0.85rem; margin-bottom: 15px; text-align: center; }
        .form-message.error { background: rgba(220, 38, 38, 0.1); color: var(--danger); border: 1px solid var(--danger); }
        .form-message.success { background: rgba(16, 185, 129, 0.1); color: #10b981; border: 1px solid #10b981; }

        .btn-primary {
          background: var(--accent);
          color: white;
          padding: 10px 20px;
          border-radius: var(--r-md);
          font-weight: 600;
          border: none;
          cursor: pointer;
          transition: all 0.2s;
        }
        .btn-primary:hover:not(:disabled) { filter: brightness(1.1); transform: translateY(-1px); }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
