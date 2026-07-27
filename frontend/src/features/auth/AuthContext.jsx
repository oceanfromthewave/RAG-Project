import { createContext, useCallback, useContext, useEffect, useState } from "react";

const AuthContext = createContext(null);

const TOKEN_KEY = "rag_access_token";
const USER_KEY  = "rag_user";

export function AuthProvider({ children }) {
  const [token, setToken]   = useState(() => localStorage.getItem(TOKEN_KEY) || null);
  const [user, setUser]     = useState(() => {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); }
    catch { return null; }
  });

  // token 이 바뀔 때마다 localStorage 동기화
  useEffect(() => {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else       localStorage.removeItem(TOKEN_KEY);
  }, [token]);

  useEffect(() => {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else      localStorage.removeItem(USER_KEY);
  }, [user]);

  const login = useCallback((accessToken, username, isAdmin) => {
    setToken(accessToken);
    setUser({ username, isAdmin });
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  /**
   * 인증 헤더를 자동으로 포함하는 fetch 래퍼.
   * 401 응답을 받으면 자동으로 로그아웃 처리합니다.
   */
  const authFetch = useCallback(
    async (url, options = {}) => {
      const headers = {
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
      const res = await fetch(url, { ...options, headers });
      if (res.status === 401) {
        logout();
      }
      return res;
    },
    [token, logout],
  );

  return (
    <AuthContext.Provider value={{ token, user, login, logout, authFetch }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}
