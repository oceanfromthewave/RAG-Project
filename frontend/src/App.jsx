import { Suspense } from "react";
import { Toaster } from "react-hot-toast";
import "./App.css";
import { useAuth } from "./AuthContext";
import LoginPage from "./LoginPage";
import { useRag } from "./useRag";
import Workspace from "./Workspace";
import TopBar from "./TopBar";
import ConfirmModal from "./ConfirmModal";
import { ToastRegion } from "./Toast";
import { DocViewerModal } from "./ChatComponents";

function App() {
  const { token, user, logout, authFetch } = useAuth();
  if (!token) return <LoginPage />;
  return <AuthenticatedApp authFetch={authFetch} user={user} logout={logout} />;
}

function AuthenticatedApp({ authFetch, user, logout }) {
  const rag = useRag(authFetch, user, logout);

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

      <Suspense fallback={<div className="loading-overlay">컴포넌트 로드 중...</div>}>
        <Workspace rag={rag} />
      </Suspense>
    </div>
  );
}

export default App;
