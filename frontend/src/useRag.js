import { useCallback, useEffect, useRef, useState } from "react";
import {
  API_BASE_URL,
  INITIAL_STATS,
  TEXT,
  WELCOME_MESSAGE,
} from "./constants";

const createWelcomeMessage = () => ({
  id: "welcome",
  role: "assistant",
  content: WELCOME_MESSAGE,
  sources: [],
  score: null,
  context: "",
  isSearching: false,
});

export function useRag(authFetch, user, logout) {
  const [view, setView] = useState("chat");
  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem("darkMode") === "true",
  );
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 960);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const [messages, setMessages] = useState([createWelcomeMessage()]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [streamingMessages, setStreamingMessages] = useState({});
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [statusMessage, setStatusMessage] = useState(TEXT.ready);

  const [workspaces, setWorkspaces] = useState([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState(null);
  const [files, setFiles] = useState([]);
  const [stats, setStats] = useState(INITIAL_STATS);
  const [sessions, setSessions] = useState([]);
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("");

  const [uploading, setUploading] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [composerDragActive, setComposerDragActive] = useState(false);
  const [fileFilter, setFileFilter] = useState("");
  const [fileSortKey, setFileSortKey] = useState("name");
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [sessionFilter, setSessionFilter] = useState("");
  const [sessionSearchResults, setSessionSearchResults] = useState(null);
  const [sessionSearchLoading, setSessionSearchLoading] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [confirmData, setConfirmData] = useState({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: null,
  });
  const [viewingDoc, setViewingDoc] = useState({
    isOpen: false,
    title: "",
    content: "",
    highlightChunkIndex: null,
  });
  const [docSidebar, setDocSidebar] = useState({
    isOpen: false,
    title: "",
    content: "",
    highlightChunkIndex: null,
  });
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [reindexingFile, setReindexingFile] = useState(null);
  const [activeStreamIds, setActiveStreamIds] = useState([]);

  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const quickPromptsRef = useRef(null);
  const textareaRef = useRef(null);
  const dropdownRef = useRef(null);
  const activeStreamsRef = useRef(new Map());
  const messageIdRef = useRef(0);
  const toastIdRef = useRef(0);
  const sessionSearchTimerRef = useRef(null);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback((message, type = "info", onClick = null) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type, onClick }]);
    setTimeout(() => dismissToast(id), 6000);
  }, [dismissToast]);

  const syncActiveStreams = useCallback(() => {
    setActiveStreamIds(Array.from(activeStreamsRef.current.keys()));
  }, []);

  const nextId = () => `msg-${++messageIdRef.current}`;

  const updateMessage = useCallback((id, updater) => {
    setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== id) {
          return message;
        }

        return typeof updater === "function"
          ? updater(message)
          : { ...message, ...updater };
      }),
    );
  }, []);

  const readJson = useCallback(async (response) => {
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || data.message || TEXT.requestFailed);
    }
    return data;
  }, []);

  const fetchSidebarData = useCallback(async () => {
    setFilesLoading(true);
    try {
      const [filesRes, statsRes] = await Promise.all([
        authFetch(`${API_BASE_URL}/files-db`),
        authFetch(`${API_BASE_URL}/stats`),
      ]);
      const [filesData, statsData] = await Promise.all([
        readJson(filesRes),
        readJson(statsRes),
      ]);

      return {
        files: filesData.files || [],
        stats: statsData,
      };
    } finally {
      setFilesLoading(false);
    }
  }, [authFetch, readJson]);

  const refreshSidebar = useCallback(async () => {
    try {
      const data = await fetchSidebarData();
      setFiles(data.files);
      setStats(data.stats);

      const sessionUrl = currentWorkspaceId
        ? `${API_BASE_URL}/sessions?workspace_id=${currentWorkspaceId}`
        : `${API_BASE_URL}/sessions`;

      const [sessionsRes, workspacesRes] = await Promise.all([
        authFetch(sessionUrl),
        authFetch(`${API_BASE_URL}/workspaces`),
      ]);
      const [sessionsData, workspacesData] = await Promise.all([
        readJson(sessionsRes),
        readJson(workspacesRes),
      ]);

      setSessions(sessionsData.sessions || []);
      setWorkspaces(workspacesData.workspaces || []);
    } catch (err) {
      addToast(err.message, "error");
    }
  }, [addToast, authFetch, currentWorkspaceId, fetchSidebarData, readJson]);

  const resetChat = useCallback(() => {
    activeStreamsRef.current.forEach((controller) => controller.abort());
    activeStreamsRef.current.clear();
    syncActiveStreams();

    setMessages([createWelcomeMessage()]);
    setCurrentSessionId(null);
    setStreamingMessages({});
    setInput("");
    setStatusMessage(TEXT.ready);
    setChatLoading(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [syncActiveStreams]);

  const handleResetChat = useCallback(() => {
    if (chatLoading) {
      setConfirmData({
        isOpen: true,
        title: "Stop current answer",
        message: "A response is still streaming. Start a new chat anyway?",
        onConfirm: () => {
          setConfirmData((prev) => ({ ...prev, isOpen: false }));
          resetChat();
        },
      });
      return;
    }

    resetChat();
  }, [chatLoading, resetChat]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const isNewChatKey = event.key === "n" || event.key === "N";

      if (((event.ctrlKey || event.metaKey) || event.altKey) && isNewChatKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        handleResetChat();
      }

      if (event.key === "Escape") {
        setConfirmData((prev) => ({ ...prev, isOpen: false }));
        setViewingDoc((prev) => ({ ...prev, isOpen: false }));
        setDocSidebar((prev) => ({ ...prev, isOpen: false }));
        setIsModelDropdownOpen(false);
        setEditingSessionId(null);
        setSessionSearchResults(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [handleResetChat]);

  useEffect(() => {
    localStorage.setItem("darkMode", darkMode);
    if (darkMode) {
      document.body.classList.add("dark");
    } else {
      document.body.classList.remove("dark");
    }
  }, [darkMode]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsModelDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timerId = window.setTimeout(() => {
      void (async () => {
        try {
          const data = await fetchSidebarData();
          if (cancelled) {
            return;
          }

          setFiles(data.files);
          setStats(data.stats);
          setSelectedModel((prev) => prev || data.stats.chat_model);

          const [modelsRes, workspacesRes, sessionsRes] = await Promise.all([
            authFetch(`${API_BASE_URL}/models`),
            authFetch(`${API_BASE_URL}/workspaces`),
            authFetch(`${API_BASE_URL}/sessions`),
          ]);

          const [modelsData, workspacesData, sessionsData] = await Promise.all([
            readJson(modelsRes),
            readJson(workspacesRes),
            readJson(sessionsRes),
          ]);

          if (cancelled) {
            return;
          }

          setAvailableModels(modelsData.models || []);
          setWorkspaces(workspacesData.workspaces || []);
          setSessions(sessionsData.sessions || []);
        } catch (err) {
          if (!cancelled) {
            addToast(err.message, "error");
          }
        }
      })();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [addToast, authFetch, fetchSidebarData, readJson]);

  useEffect(() => {
    if (!user) {
      return undefined;
    }

    const timerId = window.setTimeout(() => {
      void refreshSidebar();
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [currentWorkspaceId, refreshSidebar, user]);

  useEffect(() => {
    return () => {
      if (sessionSearchTimerRef.current) {
        clearTimeout(sessionSearchTimerRef.current);
      }
    };
  }, []);

  const handleCreateWorkspace = async (name) => {
    if (!name) {
      return;
    }

    try {
      const response = await authFetch(`${API_BASE_URL}/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await readJson(response);
      setWorkspaces((prev) => [data, ...prev]);
      setCurrentWorkspaceId(data.id);
      addToast(`Workspace "${name}" created.`, "success");
    } catch (err) {
      addToast(err.message, "error");
    }
  };

  const handleDeleteWorkspace = async (id) => {
    const workspace = workspaces.find((item) => item.id === id);
    setConfirmData({
      isOpen: true,
      title: "Delete workspace",
      message: `Delete "${workspace?.name || "workspace"}" and its sessions?`,
      onConfirm: async () => {
        setConfirmData((prev) => ({ ...prev, isOpen: false }));
        try {
          await authFetch(`${API_BASE_URL}/workspaces/${id}`, {
            method: "DELETE",
          });
          setWorkspaces((prev) => prev.filter((item) => item.id !== id));
          if (currentWorkspaceId === id) {
            setCurrentWorkspaceId(null);
          }
          addToast("Workspace deleted.", "success");
        } catch (err) {
          addToast(err.message, "error");
        }
      },
    });
  };

  const loadSession = async (sessionId) => {
    if (sessionId === currentSessionId) {
      return;
    }

    setHistoryLoading(true);
    const isRunning = activeStreamsRef.current.has(sessionId);
    setChatLoading(isRunning);
    setStatusMessage(isRunning ? TEXT.thinking : TEXT.ready);

    try {
      const response = await authFetch(`${API_BASE_URL}/sessions/${sessionId}`);
      const data = await readJson(response);
      let formattedMessages = data.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        sources: message.sources || [],
        score: message.score,
        context: message.context || "",
        isSearching: false,
        feedback: message.feedback || 0,
      }));

      const backgroundMessage = streamingMessages[sessionId];
      if (backgroundMessage) {
        const lastMessage = formattedMessages[formattedMessages.length - 1];
        if (lastMessage && lastMessage.role === "assistant" && !lastMessage.content) {
          formattedMessages[formattedMessages.length - 1] = {
            ...lastMessage,
            ...backgroundMessage,
          };
        } else if (!lastMessage || lastMessage.role === "user") {
          formattedMessages.push({
            id: `bg-${sessionId}-${Date.now()}`,
            role: "assistant",
            content: backgroundMessage.content,
            sources: backgroundMessage.sources,
            score: backgroundMessage.score,
            context: backgroundMessage.context,
            isSearching: backgroundMessage.isSearching,
          });
        }
      }

      setMessages(
        formattedMessages.length > 0
          ? formattedMessages
          : [createWelcomeMessage()],
      );
      setCurrentSessionId(sessionId);
      setSessionSearchResults(null);
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
    syncActiveStreams();
    setChatLoading(false);
    setStatusMessage(TEXT.ready);
    addToast("Generation stopped.", "info");
  };

  const processStreamLine = useCallback((line, assistantId, sessionId) => {
    if (!line.trim()) {
      return;
    }

    const event = JSON.parse(line);

    if (event.type === "chunk") {
      const updater = (prev) => ({
        ...prev,
        content: (prev.content || "") + event.content,
        isSearching: false,
      });
      setStreamingMessages((prev) => ({
        ...prev,
        [sessionId]: updater(prev[sessionId] || {}),
      }));
      if (currentSessionId === sessionId) {
        updateMessage(assistantId, updater);
      }
      return;
    }

    if (event.type === "status") {
      const isSearching = event.state === "searching";
      setStreamingMessages((prev) => ({
        ...prev,
        [sessionId]: { ...(prev[sessionId] || {}), isSearching },
      }));
      if (currentSessionId === sessionId) {
        updateMessage(assistantId, { isSearching });
      }
      return;
    }

    if (event.type === "meta") {
      const meta = {
        sources: event.sources || [],
        score: event.score ?? null,
        context: event.context || "",
        isSearching: false,
      };
      setStreamingMessages((prev) => ({
        ...prev,
        [sessionId]: { ...(prev[sessionId] || {}), ...meta },
      }));
      if (currentSessionId === sessionId) {
        updateMessage(assistantId, meta);
      }
      return;
    }

    if (event.type === "message_id") {
      if (currentSessionId === sessionId) {
        updateMessage(assistantId, { id: event.id });
      }
      return;
    }

    if (event.type === "suggestions" && currentSessionId === sessionId) {
      updateMessage(assistantId, { suggestions: event.items || [] });
    }
  }, [currentSessionId, updateMessage]);

  const sendMessage = async (preset, overrideHistory) => {
    const query = (preset ?? input).trim();
    if (!query || (currentSessionId && activeStreamsRef.current.has(currentSessionId))) {
      return;
    }

    const currentAttachments = [...attachedFiles];
    const controller = new AbortController();
    const userId = nextId();
    const assistantId = nextId();
    const tempSessionId = currentSessionId || `temp-${Date.now()}`;

    activeStreamsRef.current.set(tempSessionId, controller);
    syncActiveStreams();

    setMessages((prev) => [
      ...prev,
      {
        id: userId,
        role: "user",
        content: query,
        sources: [],
        score: null,
        context: "",
        isSearching: false,
        feedback: 0,
      },
      {
        id: assistantId,
        role: "assistant",
        content: "",
        sources: [],
        score: null,
        context: "",
        isSearching: false,
        feedback: 0,
        suggestions: [],
      },
    ]);
    setStreamingMessages((prev) => ({
      ...prev,
      [tempSessionId]: {
        content: "",
        sources: [],
        score: null,
        context: "",
        isSearching: false,
        feedback: 0,
      },
    }));
    setInput("");
    setChatLoading(true);
    setStatusMessage(TEXT.thinking);

    const history = (
      overrideHistory
      ?? messages
        .filter((message) => message.id !== "welcome" && message.content.trim() !== "")
        .map((message) => ({ role: message.role, content: message.content }))
    ).slice(-6);

    let actualSessionId = currentSessionId;

    try {
      const response = await authFetch(`${API_BASE_URL}/ask-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          model: selectedModel,
          history,
          session_id: currentSessionId,
          workspace_id: currentWorkspaceId,
          selected_files: currentAttachments,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || data.message || TEXT.answerFailed);
      }

      setAttachedFiles([]);

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }

          const event = JSON.parse(line);
          if (event.type === "session") {
            actualSessionId = event.session_id;
            activeStreamsRef.current.delete(tempSessionId);
            activeStreamsRef.current.set(actualSessionId, controller);
            syncActiveStreams();

            setStreamingMessages((prev) => {
              const next = { ...prev, [actualSessionId]: prev[tempSessionId] };
              delete next[tempSessionId];
              return next;
            });

            setCurrentSessionId((prev) => (
              prev === null || prev?.startsWith?.("temp-")
                ? actualSessionId
                : prev
            ));
            void refreshSidebar();
            continue;
          }

          if (event.type === "title") {
            setSessions((prev) => prev.map((session) => (
              session.id === event.session_id
                ? { ...session, title: event.title }
                : session
            )));
            continue;
          }

          processStreamLine(line, assistantId, actualSessionId || tempSessionId);
        }

        if (done) {
          break;
        }
      }

      if (actualSessionId) {
        setTimeout(() => {
          void refreshSidebar();
        }, 500);
      }

      setCurrentSessionId((prevCurrent) => {
        if (actualSessionId && prevCurrent !== actualSessionId) {
          const title = `${query.slice(0, 15)}${query.length > 15 ? "..." : ""}`;
          addToast(`"${title}" finished in the background.`, "success", () => {
            void loadSession(actualSessionId);
          });
        } else {
          setStatusMessage(TEXT.answerReady);
          addToast(TEXT.answerReady, "success");
        }

        return prevCurrent;
      });
    } catch (err) {
      if (err.name === "AbortError") {
        return;
      }

      const errorMessage = err.message || TEXT.answerFailed;
      const targetId = actualSessionId || tempSessionId;
      setCurrentSessionId((prev) => {
        if (prev === targetId) {
          updateMessage(assistantId, { content: errorMessage });
        }
        return prev;
      });
      addToast(errorMessage, "error");
    } finally {
      const finalId = actualSessionId || tempSessionId;
      activeStreamsRef.current.delete(finalId);
      syncActiveStreams();

      setCurrentSessionId((prev) => {
        if (prev === finalId) {
          setTimeout(() => setChatLoading(false), 0);
        }
        return prev;
      });

      setTimeout(() => {
        setStreamingMessages((prev) => {
          const next = { ...prev };
          delete next[finalId];
          return next;
        });
      }, 2000);
    }
  };

  const handleRegenerate = async () => {
    const lastUserIndex = [...messages].reverse().findIndex(
      (message) => message.role === "user",
    );
    if (lastUserIndex === -1) {
      return;
    }

    const realLastUserIndex = messages.length - 1 - lastUserIndex;
    const lastUserMessage = messages[realLastUserIndex];
    const historyToPoint = messages
      .slice(0, realLastUserIndex)
      .filter((message) => message.id !== "welcome" && message.content.trim() !== "")
      .map((message) => ({ role: message.role, content: message.content }));

    setMessages((prev) => prev.slice(0, realLastUserIndex));
    await sendMessage(lastUserMessage.content, historyToPoint);
  };

  const handleSessionSearch = (query) => {
    setSessionFilter(query);
    setSessionSearchResults(null);

    if (sessionSearchTimerRef.current) {
      clearTimeout(sessionSearchTimerRef.current);
    }

    if (!query.trim()) {
      return;
    }

    sessionSearchTimerRef.current = setTimeout(async () => {
      setSessionSearchLoading(true);
      try {
        const response = await authFetch(
          `${API_BASE_URL}/sessions/search?q=${encodeURIComponent(query.trim())}`,
        );
        const data = await readJson(response);
        setSessionSearchResults(data.results || []);
      } catch {
        setSessionSearchResults([]);
      } finally {
        setSessionSearchLoading(false);
      }
    }, 400);
  };

  const startEditSession = (event, session) => {
    event.stopPropagation();
    setEditingSessionId(session.id);
    setEditingTitle(session.title);
  };

  const submitEditSession = async (sessionId) => {
    const newTitle = editingTitle.trim();
    setEditingSessionId(null);
    if (!newTitle) {
      return;
    }

    try {
      await authFetch(`${API_BASE_URL}/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle }),
      });
      setSessions((prev) => prev.map((session) => (
        session.id === sessionId ? { ...session, title: newTitle } : session
      )));
    } catch {
      addToast("Failed to rename the session.", "error");
    }
  };

  const handleEditKeyDown = (event, sessionId) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void submitEditSession(sessionId);
    } else if (event.key === "Escape") {
      setEditingSessionId(null);
    }
    event.stopPropagation();
  };

  const deleteChatSession = async (event, sessionId) => {
    event.stopPropagation();
    setConfirmData({
      isOpen: true,
      title: "Delete chat",
      message: "Delete this chat session permanently?",
      onConfirm: async () => {
        setConfirmData((prev) => ({ ...prev, isOpen: false }));
        try {
          await authFetch(`${API_BASE_URL}/sessions/${sessionId}`, {
            method: "DELETE",
          });
          if (currentSessionId === sessionId) {
            resetChat();
          }
          addToast("Chat deleted.", "success");
          await refreshSidebar();
        } catch (err) {
          addToast(err.message, "error");
        }
      },
    });
  };

  const uploadFiles = async (fileList) => {
    if (!fileList || fileList.length === 0 || uploading) {
      return;
    }

    const filesArray = Array.from(fileList);
    const formData = new FormData();
    filesArray.forEach((file) => formData.append("files", file));

    setUploading(true);
    setStatusMessage(`${filesArray.length} file(s) uploading...`);

    try {
      const response = await authFetch(`${API_BASE_URL}/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await readJson(response);
      await refreshSidebar();

      const successCount = data.results.filter((result) => result.status === "success").length;
      if (successCount > 0) {
        addToast(`${successCount} file(s) indexed.`, "success");
      }

      data.results.forEach((result) => {
        if (result.status === "error") {
          addToast(`${result.file}: ${result.message}`, "error");
        }
      });

      setStatusMessage(data.message);
    } catch (err) {
      addToast(err.message || TEXT.uploadFailed, "error");
      setStatusMessage(err.message || TEXT.uploadFailed);
    } finally {
      setUploading(false);
      setDragActive(false);
    }
  };

  const handleUpload = async (event) => {
    const fileList = event.target.files;
    if (fileList && fileList.length > 0) {
      await uploadFiles(fileList);
    }
    event.target.value = "";
  };

  const handleDrop = async (event) => {
    event.preventDefault();
    await uploadFiles(event.dataTransfer.files);
  };

  const deleteFile = async (name) => {
    setConfirmData({
      isOpen: true,
      title: "Delete file",
      message: `Delete "${name}" and its indexed chunks?`,
      onConfirm: async () => {
        setConfirmData((prev) => ({ ...prev, isOpen: false }));
        setStatusMessage(`Deleting ${name}...`);

        try {
          const response = await authFetch(
            `${API_BASE_URL}/file?name=${encodeURIComponent(name)}`,
            { method: "DELETE" },
          );
          const data = await readJson(response);
          await refreshSidebar();
          addToast(`${data.file} deleted.`, "success");
          setStatusMessage(`${data.file} deleted.`);
        } catch (err) {
          addToast(err.message || TEXT.deleteFailed, "error");
          setStatusMessage(err.message || TEXT.deleteFailed);
        }
      },
    });
  };

  const toggleFileSelection = (name) => {
    setSelectedFiles((prev) => (
      prev.includes(name)
        ? prev.filter((file) => file !== name)
        : [...prev, name]
    ));
  };

  const deleteSelectedFiles = async () => {
    if (selectedFiles.length === 0) {
      return;
    }

    setConfirmData({
      isOpen: true,
      title: "Delete selected files",
      message: `Delete ${selectedFiles.length} selected file(s)?`,
      onConfirm: async () => {
        setConfirmData((prev) => ({ ...prev, isOpen: false }));
        try {
          const query = selectedFiles
            .map((file) => `names=${encodeURIComponent(file)}`)
            .join("&");
          await authFetch(`${API_BASE_URL}/files/batch?${query}`, {
            method: "DELETE",
          });
          setSelectedFiles([]);
          await refreshSidebar();
          addToast("Selected files deleted.", "success");
        } catch (err) {
          addToast(err.message, "error");
        }
      },
    });
  };

  const reindexFile = async (name) => {
    if (reindexingFile) {
      return;
    }

    setReindexingFile(name);
    try {
      const response = await authFetch(
        `${API_BASE_URL}/files/reindex?name=${encodeURIComponent(name)}`,
        { method: "POST" },
      );
      const data = await readJson(response);
      await refreshSidebar();
      addToast(`"${name}" reindexed (${data.chunks} chunks).`, "success");
    } catch (err) {
      addToast(err.message || "Reindex failed.", "error");
    } finally {
      setReindexingFile(null);
    }
  };

  const handleFeedback = async (messageId, value) => {
    try {
      await authFetch(`${API_BASE_URL}/messages/${messageId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: value }),
      });
      setMessages((prev) => prev.map((message) => (
        message.id === messageId
          ? { ...message, feedback: value }
          : message
      )));
    } catch {
      addToast("Failed to save feedback.", "error");
    }
  };

  const handleExportChat = (format = "markdown") => {
    if (messages.length <= 1) {
      return;
    }

    let content;
    let type;
    let extension;

    if (format === "json") {
      content = JSON.stringify(
        messages.filter((message) => message.id !== "welcome"),
        null,
        2,
      );
      type = "application/json";
      extension = "json";
    } else {
      content = messages
        .filter((message) => message.id !== "welcome")
        .map((message) => (
          `### ${message.role === "user" ? "User" : "Assistant"}\n\n${message.content}\n\n${message.sources?.length ? `*Sources: ${message.sources.map((source) => source.source).join(", ")}*` : ""}`
        ))
        .join("\n---\n\n");
      type = "text/markdown";
      extension = "md";
    }

    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `chat-export-${new Date().toISOString().slice(0, 10)}.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
    addToast(`Exported as ${format.toUpperCase()}.`, "success");
  };

  const handleLogout = () => {
    activeStreamsRef.current.forEach((controller) => controller.abort());
    activeStreamsRef.current.clear();
    syncActiveStreams();
    logout();
  };

  const handleScroll = (event) => {
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
    setIsAtBottom(scrollHeight - scrollTop - clientHeight < 50);
  };

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const updateFileTags = async (name, tags) => {
    try {
      await authFetch(`${API_BASE_URL}/file/tags?name=${encodeURIComponent(name)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags }),
      });
      await refreshSidebar();
      addToast(`Updated tags for "${name}".`, "success");
    } catch (err) {
      addToast(err.message, "error");
    }
  };

  return {
    view,
    setView,
    darkMode,
    setDarkMode,
    sidebarOpen,
    setSidebarOpen,
    messages,
    input,
    setInput,
    chatLoading,
    sessions,
    currentSessionId,
    stats,
    files,
    availableModels,
    selectedModel,
    setSelectedModel,
    workspaces,
    currentWorkspaceId,
    setCurrentWorkspaceId,
    statusMessage,
    uploading,
    filesLoading,
    historyLoading,
    dragActive,
    setDragActive,
    composerDragActive,
    setComposerDragActive,
    fileFilter,
    setFileFilter,
    fileSortKey,
    setFileSortKey,
    selectedFiles,
    sessionFilter,
    setSessionFilter,
    sessionSearchResults,
    sessionSearchLoading,
    toasts,
    confirmData,
    setConfirmData,
    viewingDoc,
    setViewingDoc,
    docSidebar,
    setDocSidebar,
    isModelDropdownOpen,
    setIsModelDropdownOpen,
    editingSessionId,
    editingTitle,
    setEditingTitle,
    isAtBottom,
    attachedFiles,
    setAttachedFiles,
    reindexingFile,
    activeStreamIds,
    chatEndRef,
    fileInputRef,
    quickPromptsRef,
    textareaRef,
    dropdownRef,
    addToast,
    dismissToast,
    loadSession,
    deleteChatSession,
    startEditSession,
    submitEditSession,
    handleEditKeyDown,
    handleFeedback,
    handleExportChat,
    handleRegenerate,
    sendMessage,
    stopGeneration,
    handleResetChat,
    resetChat,
    handleUpload,
    handleDrop,
    deleteFile,
    toggleFileSelection,
    deleteSelectedFiles,
    handleLogout,
    handleScroll,
    scrollToBottom,
    refreshSidebar,
    updateFileTags,
    handleCreateWorkspace,
    handleDeleteWorkspace,
    reindexFile,
    handleSessionSearch,
  };
}
