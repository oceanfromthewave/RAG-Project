import { Suspense, useEffect, useState, useCallback } from "react";
import { Toaster } from "react-hot-toast";
import "./App.css";
import { useAuth } from "./features/auth/AuthContext";
import LoginPage from "./features/auth/LoginPage";
import { useRag } from "./features/chat/useRag";
import Workspace from "./pages/Workspace";
import TopBar from "./components/TopBar";
import ConfirmModal from "./components/ConfirmModal";
import { ToastRegion } from "./components/Toast";
import { DocViewerModal, ShortcutsModal } from "./features/chat/ChatComponents";

function App() {
  const { token, user, logout, authFetch } = useAuth();
  if (!token) return <LoginPage />;
  return <AuthenticatedApp authFetch={authFetch} user={user} logout={logout} />;
}

function AuthenticatedApp({ authFetch, user, logout }) {
  const rag = useRag(authFetch, user, logout);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const handleGlobalKeys = useCallback((e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "/") {
      e.preventDefault();
      setShowShortcuts((prev) => !prev);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleGlobalKeys);
    return () => window.removeEventListener("keydown", handleGlobalKeys);
  }, [handleGlobalKeys]);

  return (
    <div className={`app-shell${rag.darkMode ? " dark" : ""}`}>
      <Toaster position="top-right" />
      <ToastRegion toasts={rag.toasts} onDismiss={rag.dismissToast} />

      <ConfirmModal
        isOpen={rag.confirmData.isOpen}
        title={rag.confirmData.title}
        message={rag.confirmData.message}
        onConfirm={rag.confirmData.onConfirm}
        onCancel={() => rag.setConfirmData(prev => ({ ...prev, isOpen: false }))}
      />

      <ShortcutsModal
        isOpen={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />

      {/* 모바일 대응 오버레이 */}
      {(rag.sidebarOpen || rag.docSidebar.isOpen) && window.innerWidth <= 960 && (
        <div className="sidebar-overlay" onClick={() => {
          rag.setSidebarOpen(false);
          rag.setDocSidebar({ ...rag.docSidebar, isOpen: false });
        }} />
      )}

      <DocViewerModal
        isOpen={rag.viewingDoc.isOpen}
        title={rag.viewingDoc.title}
        content={rag.viewingDoc.content}
        highlightChunkIndex={rag.viewingDoc.highlightChunkIndex}
        onCancel={() => rag.setViewingDoc(prev => ({ ...prev, isOpen: false }))}
      />

      <TopBar
        sidebarOpen={rag.sidebarOpen}
        setSidebarOpen={rag.setSidebarOpen}
        setView={rag.setView}
        view={rag.view}
        stats={rag.stats}
        selectedModel={rag.selectedModel}
        chatLoading={rag.chatLoading}
        darkMode={rag.darkMode}
        setDarkMode={rag.setDarkMode}
        user={user}
        handleLogout={rag.handleLogout}
      />

      <Suspense fallback={<LoadingScreen />}>
        <Workspace rag={rag} />
      </Suspense>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-content">
        <div className="loading-logo">
          <img src="/favicon.png" alt="RAG Logo" />
        </div>
        <div className="loading-spinner"></div>
        <p>애플리케이션을 준비하는 중...</p>
      </div>
    </div>
  );
}

export default App;
