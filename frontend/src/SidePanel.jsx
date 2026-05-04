import React, { useState } from "react";
import { FileSkeleton } from "./ChatComponents";

const getExtension = (name) => name.split(".").pop()?.toUpperCase() || "DOC";

const formatFileSize = (bytes) => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

export default function SidePanel({
  stats,
  dragActive,
  setDragActive,
  uploading,
  filesLoading,
  fileInputRef,
  handleDrop,
  handleUpload,
  TEXT,
  libraryDensity,
  fileFilter,
  setFileFilter,
  fileSortKey,
  setFileSortKey,
  selectedFiles,
  deleteSelectedFiles,
  filteredFiles,
  files,
  toggleFileSelection,
  deleteFile,
  reindexFile,
  reindexingFile,
  dropdownRef,
  isModelDropdownOpen,
  setIsModelDropdownOpen,
  chatLoading,
  selectedModel,
  setSelectedModel,
  availableModels,
  updateFileTags
}) {
  const [tagInput, setTagInput] = useState({ name: "", value: "" });

  const handleTagSubmit = (e, fileName) => {
    if (e.key === "Enter") {
      const tags = tagInput.value.split(",").map(t => t.trim()).filter(t => t);
      updateFileTags(fileName, tags);
      setTagInput({ name: "", value: "" });
    } else if (e.key === "Escape") {
      setTagInput({ name: "", value: "" });
    }
  };

  const SORT_OPTIONS = [
    { key: "name",   label: "이름순" },
    { key: "size",   label: "크기순" },
    { key: "date",   label: "날짜순" },
    { key: "chunks", label: "청크순" },
  ];

  return (
    <aside className="side-panel" aria-label="문서 관리">
      <div className="side-panel-content">
        <div className="side-section">
          <div className="side-head">
            <h3>문서 업로드</h3>
            <span className="badge">{stats.indexed_files}개 인덱싱됨</span>
          </div>
          <div
            className={`upload-zone ${dragActive ? "drag-over" : ""} ${uploading ? "uploading" : ""}`}
            onClick={() => !uploading && fileInputRef.current?.click()}
            onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={(e) => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget)) setDragActive(false); }}
            onDrop={handleDrop}
            aria-label="파일 업로드 영역"
            role="button"
            tabIndex={0}
          >
            <div className="upload-content">
              <div className="upload-icon" aria-hidden="true">{uploading ? "⟳" : "↑"}</div>
              <div className="upload-text">
                <strong>{uploading ? "인덱싱 중..." : "파일 업로드"}</strong>
                <p>{dragActive ? TEXT.dragActive : "파일들을 끌어다 놓거나 클릭해서 업로드하세요."}</p>
              </div>
            </div>
            <span className="upload-formats">PDF · TXT · DOCX · MD · CODE · IMG</span>
          </div>
          <input 
            ref={fileInputRef} 
            type="file" 
            accept=".pdf,.txt,.png,.jpg,.jpeg,.docx,.md,.py,.js,.ts" 
            onChange={handleUpload} 
            disabled={uploading} 
            multiple 
            hidden 
          />
        </div>

        <div className="side-section">
          <div className="side-head">
            <h3>지식 베이스</h3>
            <span className="badge badge-neutral">{libraryDensity}</span>
          </div>
          <div className="file-toolbar">
            <div className="file-search">
              <input
                type="text"
                value={fileFilter}
                onChange={(e) => setFileFilter(e.target.value)}
                placeholder="파일명으로 찾기..."
                aria-label="문서 검색"
              />
            </div>
            <div style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "6px" }}>
              {/* 정렬 셀렉터 */}
              <select
                value={fileSortKey}
                onChange={(e) => setFileSortKey(e.target.value)}
                aria-label="정렬 기준"
                style={{
                  fontSize: "0.72rem",
                  padding: "3px 6px",
                  borderRadius: "6px",
                  border: "1px solid var(--line)",
                  background: "var(--surface-raised)",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                {SORT_OPTIONS.map(opt => (
                  <option key={opt.key} value={opt.key}>{opt.label}</option>
                ))}
              </select>
              {selectedFiles.length > 0 && (
                <button className="btn-batch-del" onClick={deleteSelectedFiles} style={{ flex: 1 }}>
                  삭제 ({selectedFiles.length})
                </button>
              )}
            </div>
          </div>
          <div className="file-list" role="list" aria-label="인덱싱된 문서 목록">
            {filesLoading ? (
              <FileSkeleton />
            ) : filteredFiles.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon" aria-hidden="true">{files.length === 0 ? "◎" : "⊘"}</span>
                {files.length === 0 ? (
                  <><p>아직 인덱싱된 문서가 없습니다.</p><p>위에서 파일을 업로드해보세요.</p></>
                ) : (
                  <p>검색 조건에 맞는 문서가 없습니다.</p>
                )}
              </div>
            ) : (
              filteredFiles.map((file) => (
                <React.Fragment key={file.name}>
                <div 
                  className={`file-item ${selectedFiles.includes(file.name) ? "selected" : ""}`} 
                  role="listitem"
                  onClick={() => toggleFileSelection(file.name)}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/rag-file", file.name);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                >
                  <div className="file-check-wrapper">
                    <input 
                      type="checkbox" 
                      className="file-checkbox"
                      checked={selectedFiles.includes(file.name)} 
                      readOnly
                    />
                    <span className="custom-checkbox"></span>
                  </div>
                  <div className="file-ext" aria-hidden="true">{getExtension(file.name)}</div>
                  <div className="file-info">
                    <span className="file-name" title={file.name}>{file.name}</span>
                    <div className="file-meta">
                      <span>{formatFileSize(file.size)}</span>
                      {file.chunks > 0 && (
                        <span style={{ color: "var(--text-muted)", fontSize: "0.68rem" }}>
                          · {file.chunks}청크
                        </span>
                      )}
                      {file.tags && file.tags.length > 0 && (
                        <div className="file-tags" style={{ display: "flex", gap: "4px", marginTop: "4px", flexWrap: "wrap" }}>
                          {file.tags.map(tag => (
                            <span key={tag} className="tag-badge" style={{ fontSize: "0.65rem", background: "var(--accent-light)", color: "var(--accent)", padding: "1px 5px", borderRadius: "4px" }}>{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="file-item-actions" onClick={e => e.stopPropagation()} style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                    {/* 재인덱싱 버튼 */}
                    <button
                      className="btn-tag-edit"
                      onClick={() => reindexFile(file.name)}
                      disabled={reindexingFile === file.name}
                      title="재인덱싱"
                      style={{
                        background: "none", border: "none",
                        color: reindexingFile === file.name ? "var(--accent)" : "var(--text-muted)",
                        cursor: reindexingFile === file.name ? "wait" : "pointer",
                        fontSize: "0.85rem",
                        lineHeight: 1,
                        animation: reindexingFile === file.name ? "spin 1s linear infinite" : "none",
                      }}
                    >
                      ↺
                    </button>
                    <button 
                      className="btn-tag-edit" 
                      onClick={() => setTagInput({ name: file.name, value: file.tags?.join(", ") || "" })}
                      title="태그 편집"
                      style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.8rem" }}
                    >
                      #
                    </button>
                    <button type="button" className="btn-del" onClick={(e) => { e.stopPropagation(); deleteFile(file.name); }} aria-label={`${file.name} 삭제`} title="삭제">✕</button>
                  </div>
                </div>
                {tagInput.name === file.name && (
                  <div className="tag-edit-box" onClick={e => e.stopPropagation()} style={{ padding: "10px", background: "var(--surface-raised)", borderBottom: "1px solid var(--line)" }}>
                    <input 
                      autoFocus
                      type="text" 
                      value={tagInput.value} 
                      onChange={e => setTagInput(prev => ({ ...prev, value: e.target.value }))}
                      onKeyDown={e => handleTagSubmit(e, file.name)}
                      placeholder="태그 입력 (쉼표 구분)"
                      style={{ width: "100%", padding: "5px", fontSize: "0.8rem", borderRadius: "4px", border: "1px solid var(--line)", background: "var(--surface)" }}
                    />
                  </div>
                )}
                </React.Fragment>
              ))
            )}
          </div>
        </div>

        <div className="model-info" aria-label="모델 정보">
          <p className="model-info-label">AI 모델 설정</p>
          <div className="model-row">
            <span className="model-row-label">Chat</span>
            <div className="custom-dropdown" ref={dropdownRef}>
              <button
                type="button"
                className={`model-select-trigger ${isModelDropdownOpen ? "open" : ""}`}
                onClick={() => !chatLoading && setIsModelDropdownOpen(!isModelDropdownOpen)}
                disabled={chatLoading}
              >
                {selectedModel || stats.chat_model || "선택 안됨"}
              </button>
              {isModelDropdownOpen && (
                <div className="model-dropdown-menu">
                  {availableModels.map(m => (
                    <div
                      key={m}
                      className={`model-option ${selectedModel === m ? "selected" : ""}`}
                      onClick={() => { setSelectedModel(m); setIsModelDropdownOpen(false); }}
                    >
                      {m}
                    </div>
                  ))}
                  {stats.chat_model && !availableModels.includes(stats.chat_model) && (
                    <div
                      className={`model-option ${selectedModel === stats.chat_model ? "selected" : ""}`}
                      onClick={() => { setSelectedModel(stats.chat_model); setIsModelDropdownOpen(false); }}
                    >
                      {stats.chat_model}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="model-divider" aria-hidden="true" />
          <div className="model-row">
            <span className="model-row-label">Rerank</span>
            <span className="model-row-val">{stats.reranker_model}</span>
          </div>
          <div className="model-divider" aria-hidden="true" />
          <div className="model-row">
            <span className="model-row-label">Embed</span>
            <span className="model-row-val">{stats.embed_model}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
