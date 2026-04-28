import { useState, useEffect, useRef, useCallback } from "react";
import { 
  API_BASE_URL, 
  WELCOME_MESSAGE, 
  TEXT, 
  INITIAL_STATS 
} from "./constants";

export function useRag(authFetch, user, logout) {
  // UI States
  const [view, setView]               = useState("chat");
  const [darkMode, setDarkMode]       = useState(() => localStorage.getItem("darkMode") === "true");
  const [sidebarOpen, setSidebarOpen]   = useState(window.innerWidth > 960);
  const [isAtBottom, setIsAtBottom]     = useState(true);
  
  // Chat States
  const [messages, setMessages] = useState([
    { id: "welcome", role: "assistant", content: WELCOME_MESSAGE, sources: [], score: null, context: "", isSearching: false },
  ]);
  const [input, setInput]               = useState("");
  const [chatLoading, setChatLoading]   = useState(false);
  const [streamingMessages, setStreamingMessages] = useState({});
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [statusMessage, setStatusMessage]       = useState(TEXT.ready);
  
  // Data States
  const [workspaces, setWorkspaces]     = useState([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState(null);
  const [files, setFiles]               = useState([]);
  const [stats, setStats]               = useState(INITIAL_STATS);
  const [sessions, setSessions]         = useState([]);
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModel, setSelectedModel]     = useState("");
  
  // Interaction States
  const [uploading, setUploading]       = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [dragActive, setDragActive]     = useState(false);
  const [composerDragActive, setComposerDragActive] = useState(false);
  const [fileFilter, setFileFilter]     = useState("");
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [sessionFilter, setSessionFilter] = useState("");
  const [toasts, setToasts]             = useState([]);
  const [confirmData, setConfirmData]   = useState({ isOpen: false, title: "", message: "", onConfirm: null });
  const [viewingDoc, setViewingDoc]     = useState({ isOpen: false, title: "", content: "", highlightChunkIndex: null });
  const [docSidebar, setDocSidebar]     = useState({ isOpen: false, title: "", content: "", highlightChunkIndex: null });
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editingTitle, setEditingTitle]         = useState("");

  // Refs
  const chatEndRef      = useRef(null);
  const fileInputRef    = useRef(null);
  const quickPromptsRef = useRef(null);
  const textareaRef     = useRef(null);
  const dropdownRef     = useRef(null);
  const activeStreamsRef = useRef(new Map());
  const messageIdRef    = useRef(0);
  const toastIdRef      = useRef(0);

  /* ── Effects ── */
  useEffect(() => {
    const handleKeyDown = (e) => {
      const isN = e.key === "n" || e.key === "N";
      
      // Ctrl + N 또는 Alt + N: 새 채팅
      if (((e.ctrlKey || e.metaKey) || e.altKey) && isN) {
        e.preventDefault();
        e.stopImmediatePropagation(); // 브라우저 가로채기 방지 강화
        handleResetChat();
      }
      
      // Esc: 모든 모달/사이드바 닫기
      if (e.key === "Escape") {
        setConfirmData(prev => ({ ...prev, isOpen: false }));
        setViewingDoc(prev => ({ ...prev, isOpen: false }));
        setDocSidebar(prev => ({ ...prev, isOpen: false }));
        setIsModelDropdownOpen(false);
        setEditingSessionId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true); // true: 캡처링 단계에서 먼저 가로챔
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [chatLoading, currentSessionId]);

  useEffect(() => {
    localStorage.setItem("darkMode", darkMode);
    if (darkMode) document.body.classList.add("dark");
    else document.body.classList.remove("dark");
  }, [darkMode]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsModelDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  /* ── Toast ── */
  const dismissToast = (id) => setToasts((prev) => prev.filter((t) => t.id !== id));
  const addToast = (message, type = "info", onClick = null) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type, onClick }]);
    setTimeout(() => dismissToast(id), 6000);
  };

  /* ── Helpers ── */
  const nextId = () => `msg-${++messageIdRef.current}`;
  const updateMessage = (id, updater) =>
    setMessages((prev) =>
      prev.map((m) => m.id !== id ? m : typeof updater === "function" ? updater(m) : { ...m, ...updater })
    );

  const readJson = async (response) => {
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || data.message || TEXT.requestFailed);
    return data;
  };

  const fetchSidebarData = async () => {
    setFilesLoading(true);
    try {
      const [filesRes, statsRes] = await Promise.all([
        authFetch(`${API_BASE_URL}/files-db`),
        authFetch(`${API_BASE_URL}/stats`),
      ]);
      const [filesData, statsData] = await Promise.all([readJson(filesRes), readJson(statsRes)]);
      return { files: filesData.files || [], stats: statsData };
    } finally {
      setFilesLoading(false);
    }
  };

  const refreshSidebar = async () => {
    try {
      const data = await fetchSidebarData();
      setFiles(data.files);
      setStats(data.stats);
      
      const sessionUrl = currentWorkspaceId 
        ? `${API_BASE_URL}/sessions?workspace_id=${currentWorkspaceId}` 
        : `${API_BASE_URL}/sessions`;
      const sessionsRes = await authFetch(sessionUrl);
      const sessionsData = await readJson(sessionsRes);
      setSessions(sessionsData.sessions || []);

      const wsRes = await authFetch(`${API_BASE_URL}/workspaces`);
      const wsData = await readJson(wsRes);
      setWorkspaces(wsData.workspaces || []);
    } catch (err) {
      addToast(err.message, "error");
    }
  };

  /* ── Initial Load ── */
  useEffect(() => {
    (async () => {
      try {
        const data = await fetchSidebarData();
        setFiles(data.files);
        setStats(data.stats);
        if (!selectedModel) setSelectedModel(data.stats.chat_model);

        const modelsRes = await authFetch(`${API_BASE_URL}/models`);
        const modelsData = await readJson(modelsRes);
        setAvailableModels(modelsData.models || []);

        const wsRes = await authFetch(`${API_BASE_URL}/workspaces`);
        const wsData = await readJson(wsRes);
        setWorkspaces(wsData.workspaces || []);

        const sessionsRes = await authFetch(`${API_BASE_URL}/sessions`);
        const sessionsData = await readJson(sessionsRes);
        setSessions(sessionsData.sessions || []);
      } catch (err) {
        addToast(err.message, "error");
      }
    })();
  }, []);

  useEffect(() => {
    if (user) refreshSidebar();
  }, [currentWorkspaceId]);

  /* ── Workspace Logic ── */
  const handleCreateWorkspace = async (name) => {
    if (!name) return;
    try {
      const res = await authFetch(`${API_BASE_URL}/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      const data = await readJson(res);
      setWorkspaces(prev => [data, ...prev]);
      setCurrentWorkspaceId(data.id);
      addToast(`워크스페이스 '${name}'이(가) 생성되었습니다.`, "success");
    } catch (err) { addToast(err.message, "error"); }
  };

  const handleDeleteWorkspace = async (id) => {
    const ws = workspaces.find(w => w.id === id);
    setConfirmData({
      isOpen: true, title: "워크스페이스 삭제", message: `'${ws?.name}' 워크스페이스와 그 안의 모든 대화가 삭제됩니다. 계속하시겠습니까?`,
      onConfirm: async () => {
        setConfirmData(prev => ({ ...prev, isOpen: false }));
        try {
          await authFetch(`${API_BASE_URL}/workspaces/${id}`, { method: "DELETE" });
          setWorkspaces(prev => prev.filter(w => w.id !== id));
          if (currentWorkspaceId === id) setCurrentWorkspaceId(null);
          addToast("워크스페이스가 삭제되었습니다.", "success");
        } catch (err) { addToast(err.message, "error"); }
      }
    });
  };

  /* ── Chat Logic ── */
  const resetChat = () => {
    activeStreamsRef.current.forEach(c => c.abort());
    activeStreamsRef.current.clear();
    setMessages([{ id: "welcome", role: "assistant", content: WELCOME_MESSAGE, sources: [], score: null, context: "", isSearching: false }]);
    setCurrentSessionId(null);
    setStreamingMessages({});
    setInput("");
    setStatusMessage(TEXT.ready);
    setChatLoading(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleResetChat = () => {
    if (chatLoading) {
      setConfirmData({
        isOpen: true, title: "대화 중단",
        message: "현재 답변이 생성 중입니다. 중단하고 새로운 채팅을 시작하시겠습니까?",
        onConfirm: () => { setConfirmData(prev => ({ ...prev, isOpen: false })); resetChat(); },
      });
    } else {
      resetChat();
    }
  };

  const loadSession = async (sessionId) => {
    if (sessionId === currentSessionId) return;
    setHistoryLoading(true);
    const isRunning = activeStreamsRef.current.has(sessionId);
    setChatLoading(isRunning);
    setStatusMessage(isRunning ? TEXT.thinking : TEXT.ready);
    try {
      const res = await authFetch(`${API_BASE_URL}/sessions/${sessionId}`);
      const data = await readJson(res);
      let formattedMessages = data.messages.map(m => ({
        id: m.id, role: m.role, content: m.content,
        sources: m.sources || [], score: m.score, context: m.context || "", 
        isSearching: false, feedback: m.feedback || 0,
      }));
      const bgMsg = streamingMessages[sessionId];
      if (bgMsg) {
        const lastMsg = formattedMessages[formattedMessages.length - 1];
        if (lastMsg && lastMsg.role === "assistant" && !lastMsg.content) {
          formattedMessages[formattedMessages.length - 1] = { ...lastMsg, ...bgMsg };
        } else if (!lastMsg || lastMsg.role === "user") {
          formattedMessages.push({
            id: `bg-${sessionId}-${Date.now()}`, role: "assistant",
            content: bgMsg.content, sources: bgMsg.sources,
            score: bgMsg.score, context: bgMsg.context, isSearching: bgMsg.isSearching,
          });
        }
      }
      setMessages(formattedMessages.length > 0 ? formattedMessages : [
        { id: "welcome", role: "assistant", content: WELCOME_MESSAGE, sources: [], score: null, context: "", isSearching: false },
      ]);
      setCurrentSessionId(sessionId);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "auto" }), 50);
    } catch (err) {
      addToast(err.message, "error");
    } finally {
      setHistoryLoading(false);
    }
  };

  const stopGeneration = () => {
    activeStreamsRef.current.forEach((controller) => controller.abort());
    activeStreamsRef.current.clear();
    setChatLoading(false);
    setStatusMessage(TEXT.ready);
    addToast("답변 생성이 중단되었습니다.", "info");
  };

  const processStreamLine = (line, assistantId, sessionId) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "chunk") {
      const updater = (prev) => ({ ...prev, content: (prev.content || "") + event.content, isSearching: false });
      setStreamingMessages(prev => ({ ...prev, [sessionId]: updater(prev[sessionId] || {}) }));
      if (currentSessionId === sessionId) updateMessage(assistantId, updater);
    } else if (event.type === "status") {
      const isSearching = event.state === "searching";
      setStreamingMessages(prev => ({ ...prev, [sessionId]: { ...(prev[sessionId] || {}), isSearching } }));
      if (currentSessionId === sessionId) updateMessage(assistantId, { isSearching });
    } else if (event.type === "meta") {
      const meta = { sources: event.sources || [], score: event.score ?? null, context: event.context || "", isSearching: false };
      setStreamingMessages(prev => ({ ...prev, [sessionId]: { ...(prev[sessionId] || {}), ...meta } }));
      if (currentSessionId === sessionId) updateMessage(assistantId, meta);
    }
  };

  const sendMessage = async (preset, overrideHistory) => {
    let query = (preset ?? input).trim();
    if (!query || (currentSessionId && activeStreamsRef.current.has(currentSessionId))) return;
    const currentAttachments = [...attachedFiles];
    const controller  = new AbortController();
    const userId      = nextId();
    const assistantId = nextId();
    const tempSessionId = currentSessionId || `temp-${Date.now()}`;
    activeStreamsRef.current.set(tempSessionId, controller);
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", content: query, sources: [], score: null, context: "", isSearching: false, feedback: 0 },
      { id: assistantId, role: "assistant", content: "", sources: [], score: null, context: "", isSearching: false, feedback: 0 },
    ]);
    setStreamingMessages(prev => ({ ...prev, [tempSessionId]: { content: "", sources: [], score: null, context: "", isSearching: false, feedback: 0 } }));
    setInput("");
    setChatLoading(true);
    setStatusMessage(TEXT.thinking);
    const history = (overrideHistory ?? messages
      .filter(m => m.id !== "welcome" && m.content.trim() !== "")
      .map(m => ({ role: m.role, content: m.content }))).slice(-6);
    let actualSessionId = currentSessionId;
    try {
      const response = await authFetch(`${API_BASE_URL}/ask-stream`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          query, 
          model: selectedModel, 
          history, 
          session_id: currentSessionId, 
          workspace_id: currentWorkspaceId,
          selected_files: currentAttachments 
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || data.message || TEXT.answerFailed);
      }
      setAttachedFiles([]);
      const reader  = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "session") {
            actualSessionId = event.session_id;
            activeStreamsRef.current.delete(tempSessionId);
            activeStreamsRef.current.set(actualSessionId, controller);
            setStreamingMessages(prev => {
              const next = { ...prev, [actualSessionId]: prev[tempSessionId] };
              delete next[tempSessionId];
              return next;
            });
            setCurrentSessionId(prev => prev === null || prev?.startsWith?.("temp-") ? actualSessionId : prev);
            refreshSidebar();
          } else if (event.type === "title") {
            setSessions(prev => prev.map(s => s.id === event.session_id ? { ...s, title: event.title } : s));
          } else {
            processStreamLine(line, assistantId, actualSessionId || tempSessionId);
          }
        }
        if (done) break;
      }
      setCurrentSessionId(prevCurrent => {
        if (actualSessionId && prevCurrent !== actualSessionId) {
          const title = query.slice(0, 15) + (query.length > 15 ? "..." : "");
          addToast(`'${title}' 답변이 완료되었습니다.`, "success", () => loadSession(actualSessionId));
        } else {
          setStatusMessage(TEXT.answerReady);
          addToast(TEXT.answerReady, "success");
        }
        return prevCurrent;
      });
    } catch (err) {
      if (err.name === "AbortError") return;
      const errorMsg = err.message || TEXT.answerFailed;
      const targetId = actualSessionId || tempSessionId;
      setCurrentSessionId(prev => { if (prev === targetId) updateMessage(assistantId, { content: errorMsg }); return prev; });
      addToast(errorMsg, "error");
    } finally {
      const finalId = actualSessionId || tempSessionId;
      activeStreamsRef.current.delete(finalId);
      setCurrentSessionId(prev => { if (prev === finalId) setChatLoading(false); return prev; });
      setTimeout(() => { setStreamingMessages(prev => { const next = { ...prev }; delete next[finalId]; return next; }); }, 2000);
    }
  };

  const handleRegenerate = async () => {
    const lastUserIdx = [...messages].reverse().findIndex(m => m.role === "user");
    if (lastUserIdx === -1) return;
    const realLastUserIdx = messages.length - 1 - lastUserIdx;
    const lastUserMsg = messages[realLastUserIdx];
    const historyToPoint = messages.slice(0, realLastUserIdx).filter(m => m.id !== "welcome" && m.content.trim() !== "").map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => prev.slice(0, realLastUserIdx));
    sendMessage(lastUserMsg.content, historyToPoint);
  };

  /* ── Session Edit ── */
  const startEditSession = (e, session) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditingTitle(session.title);
  };
  const submitEditSession = async (sessionId) => {
    const newTitle = editingTitle.trim();
    setEditingSessionId(null);
    if (!newTitle) return;
    try {
      await authFetch(`${API_BASE_URL}/sessions/${sessionId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: newTitle }) });
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: newTitle } : s));
    } catch (err) { addToast("제목 변경에 실패했습니다.", "error"); }
  };
  const handleEditKeyDown = (e, sessionId) => {
    if (e.key === "Enter") { e.preventDefault(); submitEditSession(sessionId); }
    else if (e.key === "Escape") { setEditingSessionId(null); }
    e.stopPropagation();
  };
  const deleteChatSession = async (e, sessionId) => {
    e.stopPropagation();
    setConfirmData({
      isOpen: true, title: "대화 삭제", message: "이 대화 기록을 영구적으로 삭제하시겠습니까?",
      onConfirm: async () => {
        setConfirmData(prev => ({ ...prev, isOpen: false }));
        try {
          await authFetch(`${API_BASE_URL}/sessions/${sessionId}`, { method: "DELETE" });
          if (currentSessionId === sessionId) resetChat();
          addToast("대화 기록이 삭제되었습니다.", "success");
          await refreshSidebar();
        } catch (err) { addToast(err.message, "error"); }
      },
    });
  };

  /* ── File Logic ── */
  const uploadFiles = async (fileList) => {
    if (!fileList || fileList.length === 0 || uploading) return;
    const filesArray = Array.from(fileList);
    const formData = new FormData();
    filesArray.forEach(file => formData.append("files", file));
    setUploading(true);
    setStatusMessage(`${filesArray.length}개 파일 업로드 중...`);
    try {
      const response = await authFetch(`${API_BASE_URL}/upload`, { method: "POST", body: formData });
      const data = await readJson(response);
      await refreshSidebar();
      const successCount = data.results.filter(r => r.status === "success").length;
      if (successCount > 0) addToast(`${successCount}개 파일 인덱싱 완료`, "success");
      data.results.forEach(res => { if (res.status === "error") addToast(`${res.file}: ${res.message}`, "error"); });
      setStatusMessage(data.message);
    } catch (err) { addToast(err.message || TEXT.uploadFailed, "error"); setStatusMessage(err.message || TEXT.uploadFailed); }
    finally { setUploading(false); setDragActive(false); }
  };
  const handleUpload = async (e) => { const fileList = e.target.files; if (fileList && fileList.length > 0) await uploadFiles(fileList); e.target.value = ""; };
  const handleDrop   = async (e) => { e.preventDefault(); await uploadFiles(e.dataTransfer.files); };
  const deleteFile = async (name) => {
    setConfirmData({
      isOpen: true, title: "문서 삭제", message: `"${name}" 파일을 삭제하시겠습니까? 관련 데이터가 모두 제거됩니다.`,
      onConfirm: async () => {
        setConfirmData(prev => ({ ...prev, isOpen: false }));
        setStatusMessage(`${name} 삭제 중...`);
        try {
          const response = await authFetch(`${API_BASE_URL}/file?name=${encodeURIComponent(name)}`, { method: "DELETE" });
          const data = await readJson(response);
          await refreshSidebar();
          addToast(`${data.file} 삭제 완료`, "success");
          setStatusMessage(`${data.file} 삭제 완료.`);
        } catch (err) { addToast(err.message || TEXT.deleteFailed, "error"); setStatusMessage(err.message || TEXT.deleteFailed); }
      },
    });
  };
  const toggleFileSelection = (name) => setSelectedFiles(prev => prev.includes(name) ? prev.filter(f => f !== name) : [...prev, name]);
  const deleteSelectedFiles = async () => {
    if (selectedFiles.length === 0) return;
    setConfirmData({
      isOpen: true, title: "문서 다중 삭제", message: `${selectedFiles.length}개의 파일을 삭제하시겠습니까?`,
      onConfirm: async () => {
        setConfirmData(prev => ({ ...prev, isOpen: false }));
        try {
          const query = selectedFiles.map(f => `names=${encodeURIComponent(f)}`).join("&");
          await authFetch(`${API_BASE_URL}/files/batch?${query}`, { method: "DELETE" });
          setSelectedFiles([]);
          await refreshSidebar();
          addToast("선택한 파일이 삭제되었습니다.", "success");
        } catch (err) { addToast(err.message, "error"); }
      }
    });
  };

  /* ── Other Logic ── */
  const handleFeedback = async (messageId, val) => {
    try {
      await authFetch(`${API_BASE_URL}/messages/${messageId}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedback: val }) });
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, feedback: val } : m));
    } catch (err) { addToast("피드백 반영에 실패했습니다.", "error"); }
  };
  const handleExportChat = (format = "markdown") => {
    if (messages.length <= 1) return;
    
    let content, type, ext;
    if (format === "json") {
      content = JSON.stringify(messages.filter(m => m.id !== "welcome"), null, 2);
      type = "application/json";
      ext = "json";
    } else {
      content = messages.filter(m => m.id !== "welcome").map(m => `### ${m.role === "user" ? "User" : "Assistant"}\n\n${m.content}\n\n${m.sources?.length ? `*Sources: ${m.sources.map(s => s.source).join(", ")}*` : ""}`).join("\n---\n\n");
      type = "text/markdown";
      ext = "md";
    }
    
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `chat-export-${new Date().toISOString().slice(0, 10)}.${ext}`; a.click();
    URL.revokeObjectURL(url); addToast(`대화가 ${format.toUpperCase()}으로 내보내졌습니다.`, "success");
  };
  const handleLogout = () => { activeStreamsRef.current.forEach(c => c.abort()); activeStreamsRef.current.clear(); logout(); };
  const handleScroll = (e) => { const { scrollTop, scrollHeight, clientHeight } = e.currentTarget; setIsAtBottom(scrollHeight - scrollTop - clientHeight < 50); };
  const scrollToBottom = () => chatEndRef.current?.scrollIntoView({ behavior: "smooth" });

  const updateFileTags = async (name, tags) => {
    try {
      await authFetch(`${API_BASE_URL}/file/tags?name=${encodeURIComponent(name)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags })
      });
      await refreshSidebar();
      addToast(`'${name}' 태그가 업데이트되었습니다.`, "success");
    } catch (err) {
      addToast(err.message, "error");
    }
  };

  return {
    // States
    view, setView, darkMode, setDarkMode, sidebarOpen, setSidebarOpen, messages, input, setInput, chatLoading,
    sessions, currentSessionId, stats, files, availableModels, selectedModel, setSelectedModel,
    workspaces, currentWorkspaceId, setCurrentWorkspaceId,
    statusMessage, uploading, filesLoading, historyLoading, dragActive, setDragActive, composerDragActive, setComposerDragActive,
    fileFilter, setFileFilter, selectedFiles, sessionFilter, setSessionFilter, toasts, confirmData, setConfirmData,
    viewingDoc, setViewingDoc, docSidebar, setDocSidebar, isModelDropdownOpen, setIsModelDropdownOpen,
    editingSessionId, editingTitle, setEditingTitle, isAtBottom, attachedFiles, setAttachedFiles,
    
    // Refs
    chatEndRef, fileInputRef, quickPromptsRef, textareaRef, dropdownRef, activeStreams: activeStreamsRef.current,
    
    // Functions
    addToast, dismissToast, loadSession, deleteChatSession, startEditSession, submitEditSession, handleEditKeyDown,
    handleFeedback, handleExportChat, handleRegenerate, sendMessage, stopGeneration, handleResetChat, resetChat,
    handleUpload, handleDrop, deleteFile, toggleFileSelection, deleteSelectedFiles, handleLogout, handleScroll, scrollToBottom,
    refreshSidebar, updateFileTags, handleCreateWorkspace, handleDeleteWorkspace
  };
}
