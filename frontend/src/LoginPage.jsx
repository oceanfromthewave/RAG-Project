import { useState } from "react";
import { useAuth } from "./AuthContext";
import { API_BASE_URL } from "./constants";

const API_BASE = API_BASE_URL;

export default function LoginPage() {
  const { login } = useAuth();
  const [mode, setMode]       = useState("login"); // "login" | "register"
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError("");
    if (!username.trim() || !password) {
      setError("사용자 이름과 비밀번호를 입력해주세요.");
      return;
    }

    setLoading(true);
    try {
      let res;

      if (mode === "login") {
        const body = new URLSearchParams({ username: username.trim(), password });
        res = await fetch(`${API_BASE}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        });
      } else {
        res = await fetch(`${API_BASE}/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            username: username.trim(), 
            password
          }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || "요청에 실패했습니다.");
        return;
      }

      login(data.access_token, data.username, data.is_admin);
    } catch {
      setError("서버에 연결할 수 없습니다. 서버 상태를 확인해주십시오.");
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter") handleSubmit();
  };

  return (
    <div className="login-shell">
      <div className="login-card">
        {/* 로고 */}
        <div className="login-brand">
          <div className="brand-mark large" aria-hidden="true">
            <img src="/favicon-transparent.png" alt="" />
          </div>
          <span className="login-title">acanet Workspace</span>
        </div>

        <p className="login-subtitle">
          {mode === "login" ? "계정에 로그인하세요" : "새 계정을 만드세요"}
        </p>

        {/* 탭 */}
        <div className="login-tabs">
          <button
            className={`login-tab ${mode === "login" ? "active" : ""}`}
            onClick={() => { setMode("login"); setError(""); }}
          >
            로그인
          </button>
          <button
            className={`login-tab ${mode === "register" ? "active" : ""}`}
            onClick={() => { setMode("register"); setError(""); }}
          >
            회원가입
          </button>
        </div>

        {/* 폼 */}
        <div className="login-form">
          <label className="login-label">사용자 이름</label>
          <input
            className="login-input"
            type="text"
            placeholder="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={handleKey}
            autoFocus
            autoComplete="username"
          />

          <label className="login-label">비밀번호</label>
          <input
            className="login-input"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKey}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />

          {error && <p className="login-error">{error}</p>}

          <button
            className="btn-login"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? "처리 중..." : mode === "login" ? "로그인" : "가입하기"}
          </button>
        </div>

        <p className="login-switch">
          {mode === "login" ? (
            <>계정이 없으신가요?{" "}
              <button className="login-link" onClick={() => { setMode("register"); setError(""); }}>
                회원가입
              </button>
            </>
          ) : (
            <>이미 계정이 있으신가요?{" "}
              <button className="login-link" onClick={() => { setMode("login"); setError(""); }}>
                로그인
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
