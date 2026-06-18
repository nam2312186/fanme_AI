import React from 'react';
import type { WorkspaceConfig, ChatSession } from '../services/chatApi';
import '../styles/sidebar.css';

interface SidebarProps {
  workspaces: WorkspaceConfig[];
  activeWorkspaceSlug: string;
  sessions: ChatSession[];
  activeSessionId: string;
  onNewChat: () => void;
  onCreateWorkspace: () => void;
  onToggleSidebar: () => void;
  isSidebarVisible: boolean;
  onSelectWorkspace: (slug: string) => void;
  onRenameWorkspace: (slug: string) => void;
  onDeleteWorkspace: (slug: string) => void;
  onSelectSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onProfileClick: () => void;
  isAuthenticated: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  workspaces,
  activeWorkspaceSlug,
  sessions,
  activeSessionId,
  onNewChat,
  onCreateWorkspace,
  onToggleSidebar,
  isSidebarVisible,
  onSelectWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onProfileClick,
  isAuthenticated,
}) => {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-header-actions">
          <button className="new-chat-btn" onClick={onNewChat}>
            + Đoạn chat mới
          </button>
          <button
            type="button"
            className="sidebar-toggle-btn"
            onClick={onToggleSidebar}
            aria-pressed={isSidebarVisible}
            title={isSidebarVisible ? 'Ẩn sidebar' : 'Hiện sidebar'}
          >
            {isSidebarVisible ? '›' : '‹'}
          </button>
        </div>
      </div>

      <div className="sidebar-section">
        <div className="section-header">
          <h3 className="section-title">DỰ ÁN / WORKSPACE</h3>
          <button className="workspace-add-btn" onClick={onCreateWorkspace} title="Tạo workspace mới">
            ＋
          </button>
        </div>
        <div className="workspace-list">
          {workspaces.map((workspace) => (
            <div
              key={workspace.slug}
              className={`workspace-item ${workspace.slug === activeWorkspaceSlug ? 'active' : ''}`}
            >
              <button
                className="workspace-main"
                onClick={() => onSelectWorkspace(workspace.slug)}
              >
                <span className="workspace-icon">📁</span>
                <span className="workspace-name">{workspace.name}</span>
              </button>
              <div className="workspace-actions">
                <button
                  className="session-btn rename-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRenameWorkspace(workspace.slug);
                  }}
                  title="Đổi tên workspace"
                >
                  ✎
                </button>
                <button
                  className="session-btn delete-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteWorkspace(workspace.slug);
                  }}
                  title="Xóa workspace khỏi sidebar"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="sidebar-section">
        <h3 className="section-title">LỊCH SỬ CHAT</h3>
        {sessions.length === 0 ? (
          <p className="no-sessions">Chưa có đoạn chat nào</p>
        ) : (
          <div className="session-list">
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`session-item ${session.id === activeSessionId ? 'active' : ''}`}
                onClick={() => onSelectSession(session.id)}
              >
                <div className="session-title-wrapper">
                  <span className="session-title">{session.title || 'Đoạn chat mới'}</span>
                </div>
                <div className="session-actions">
                  <button
                    className="session-btn rename-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRenameSession(session.id);
                    }}
                    title="Đổi tên"
                  >
                    ✎
                  </button>
                  <button
                    className="session-btn delete-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(session.id);
                    }}
                    title="Xóa"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        {isAuthenticated && (
          <button
            className="avatar user-avatar"
            onClick={onProfileClick}
            title="Đăng xuất"
          >
            ⎋
          </button>
        )}
      </div>
    </aside>
  );
};
