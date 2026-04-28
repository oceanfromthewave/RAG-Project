import AdminPage from "./AdminPage";
import MyPage from "./MyPage";
import HistorySidebar from "./HistorySidebar";
import ChatPanel from "./ChatPanel";
import SidePanel from "./SidePanel";
import { DocSidebar } from "./ChatComponents";
import { QUICK_PROMPTS, TEXT } from "./constants";

export default function Workspace({ rag, user }) {
  const { 
    view, setView, sidebarOpen, docSidebar, setDocSidebar, stats,
    sessions, sessionFilter, setSessionFilter, currentSessionId, loadSession,
    editingSessionId, editingTitle, setEditingTitle, submitEditSession,
    handleEditKeyDown, startEditSession, deleteChatSession, handleResetChat,
    activeStreams, messages, chatLoading, handleFeedback, handleRegenerate,
    chatEndRef, isAtBottom, scrollToBottom, quickPromptsRef, sendMessage,
    composerDragActive, setComposerDragActive, attachedFiles, setAttachedFiles,
    addToast, textareaRef, input, setInput, statusMessage, stopGeneration,
    handleExportChat, handleScroll, dragActive, setDragActive, uploading, filesLoading, historyLoading,
    fileInputRef, handleDrop, handleUpload, fileFilter, setFileFilter,
    selectedFiles, deleteSelectedFiles, files, toggleFileSelection, deleteFile,
    dropdownRef, isModelDropdownOpen, setIsModelDropdownOpen, selectedModel,
    setSelectedModel, availableModels, updateFileTags,
    workspaces, currentWorkspaceId, setCurrentWorkspaceId, handleCreateWorkspace, handleDeleteWorkspace
  } = rag;

  if (view === "admin") {
    return (
      <div className="admin-view-container">
        <AdminPage onBack={() => setView("chat")} />
      </div>
    );
  }

  if (view === "mypage") {
    return (
      <div className="admin-view-container">
        <MyPage onBack={() => setView("chat")} userStats={stats} />
      </div>
    );
  }

  const libraryDensity = stats.indexed_files > 0
    ? `${Math.max(1, Math.round(stats.total_chunks / stats.indexed_files))}청크/문서`
    : "비어 있음";

  const filteredFiles = files.filter(f => f.name.toLowerCase().includes(fileFilter.trim().toLowerCase()));

  return (
    <main className={`workspace ${!sidebarOpen ? "collapsed" : ""} ${docSidebar.isOpen ? "show-doc" : ""}`}>
      <HistorySidebar
        workspaces={workspaces}
        currentWorkspaceId={currentWorkspaceId}
        setCurrentWorkspaceId={setCurrentWorkspaceId}
        handleCreateWorkspace={handleCreateWorkspace}
        handleDeleteWorkspace={handleDeleteWorkspace}
        sessions={sessions}
        sessionFilter={sessionFilter}
        setSessionFilter={setSessionFilter}
        currentSessionId={currentSessionId}
        loadSession={loadSession}
        editingSessionId={editingSessionId}
        editingTitle={editingTitle}
        setEditingTitle={setEditingTitle}
        submitEditSession={submitEditSession}
        handleEditKeyDown={handleEditKeyDown}
        startEditSession={startEditSession}
        deleteChatSession={deleteChatSession}
        handleResetChat={handleResetChat}
        activeStreams={activeStreams}
      />

      <ChatPanel
        messages={messages}
        chatLoading={chatLoading}
        historyLoading={historyLoading}
        handleFeedback={handleFeedback}
        handleRegenerate={handleRegenerate}
        setDocSidebar={setDocSidebar}
        chatEndRef={chatEndRef}
        isAtBottom={isAtBottom}
        scrollToBottom={scrollToBottom}
        quickPromptsRef={quickPromptsRef}
        QUICK_PROMPTS={QUICK_PROMPTS}
        sendMessage={sendMessage}
        composerDragActive={composerDragActive}
        setComposerDragActive={setComposerDragActive}
        attachedFiles={attachedFiles}
        setAttachedFiles={setAttachedFiles}
        addToast={addToast}
        textareaRef={textareaRef}
        input={input}
        setInput={setInput}
        statusMessage={statusMessage}
        stopGeneration={stopGeneration}
        handleExportChat={handleExportChat}
        handleResetChat={handleResetChat}
        handleScroll={handleScroll}
      />

      <SidePanel
        stats={stats}
        dragActive={dragActive}
        setDragActive={setDragActive}
        uploading={uploading}
        filesLoading={filesLoading}
        fileInputRef={fileInputRef}
        handleDrop={handleDrop}
        handleUpload={handleUpload}
        TEXT={TEXT}
        libraryDensity={libraryDensity}
        fileFilter={fileFilter}
        setFileFilter={setFileFilter}
        selectedFiles={selectedFiles}
        deleteSelectedFiles={deleteSelectedFiles}
        filteredFiles={filteredFiles}
        files={files}
        toggleFileSelection={toggleFileSelection}
        deleteFile={deleteFile}
        dropdownRef={dropdownRef}
        isModelDropdownOpen={isModelDropdownOpen}
        setIsModelDropdownOpen={setIsModelDropdownOpen}
        chatLoading={chatLoading}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        availableModels={availableModels}
        updateFileTags={updateFileTags}
      />

      <DocSidebar
        isOpen={docSidebar.isOpen}
        title={docSidebar.title}
        content={docSidebar.content}
        highlightChunkIndex={docSidebar.highlightChunkIndex}
        onClose={() => setDocSidebar({ ...docSidebar, isOpen: false })}
      />
    </main>
  );
}
