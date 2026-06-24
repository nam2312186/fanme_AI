import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLogto } from "@logto/react";
import { Sidebar } from './components/Sidebar';
import { ChatMessage } from './components/ChatMessage';
import { ThinkingBlock } from './components/ThinkingBlock';
import ToolUseBlock from './components/ToolUseBlock';
import { parseThinking } from './utils/parseThinking';
import { isSensitiveQuestion } from './utils/sensitivity';
import type { ChatMessage as ChatMessageType } from './types';
import assistantLogo from './assets/logo.png';
import {
  fetchWorkspaces,
  createWorkspace,
  renameWorkspace,
  deleteWorkspace,
  fetchSessions,
  createSession,
  fetchSessionMessages,
  renameSession as renameChatSession,
  deleteSession as deleteChatSession,
  streamChatMessage,
  isForbiddenError,
  type WorkspaceConfig,
  type ChatSession,
} from './services/chatApi';

function createMessage(
  role: ChatMessageType['role'],
  content: string,
  isSensitive = false,
  id: string = crypto.randomUUID()
): ChatMessageType {
  return {
    id,
    role,
    content,
    isSensitive,
    createdAt: new Date().toISOString(),
  };
}

const suggestions = [
  { icon: '📄', text: 'Quy trình vận hành sản phẩm mới' },
  { icon: '👥', text: 'Cơ cấu tổ chức phòng Engineering' },
  { icon: '🔒', text: 'Chính sách bảo mật dữ liệu FanMe' },
  { icon: '🚀', text: 'Định hướng công ty Q3 2026' }
];

const PERMISSION_DENIED_MESSAGE =
  'Tài khoản của bạn chưa được cấp quyền sử dụng chatbot nội bộ. Vui lòng liên hệ quản trị viên và đăng nhập lại sau khi được cấp quyền để hệ thống cập nhật quyền truy cập.';

export default function App() {
  const resource = import.meta.env.VITE_LOGTO_API_RESOURCE?.trim() || undefined;
  const { isAuthenticated, isLoading: isAuthLoading, signIn, signOut, getAccessToken } = useLogto();

  // Workspace & Session States
  const [workspaces, setWorkspaces] = useState<WorkspaceConfig[]>([]);
  const [activeWorkspaceSlug, setActiveWorkspaceSlug] = useState<string>('internal');
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isSidebarVisible, setIsSidebarVisible] = useState(() => (
    typeof window === 'undefined' ? true : window.innerWidth > 768
  ));

  // Chat States
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [toolUse, setToolUse] = useState<{ tool: string; status: 'start' | 'done' } | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);

  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const activeWorkspace = workspaces.find((w) => w.slug === activeWorkspaceSlug);

  const canSend = useMemo(
    () => input.trim().length > 0 && !loading,
    [input, loading]
  );

  async function getAccessTokenOrThrow(): Promise<string> {
    const token = await getAccessToken(resource);

    if (!token) {
      throw new Error('Missing Logto access token');
    }

    return token;
  }

  function showPermissionDenied() {
    setPermissionDenied(true);
    setSessions([]);
    setCurrentSessionId(null);
    setMessages([createMessage('assistant', PERMISSION_DENIED_MESSAGE)]);
  }

  // Keep the newest message in view immediately, without a visible smooth-scroll jump.
  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [messages, loading, streamingContent]);

  // Imperative scroll helper used when pressing Enter
  const scrollToBottom = (smooth = false) => {
    const container = messagesContainerRef.current;
    if (!container) {
      bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
      return;
    }

    requestAnimationFrame(() => {
      try {
        container.scrollTo({ top: container.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
      } catch (e) {
        container.scrollTop = container.scrollHeight;
      }
    });
  };

  // Fetch workspaces on mount
  useEffect(() => {
    const loadWorkspaces = async () => {
      try {
        const token = await getAccessTokenOrThrow();
        const data = await fetchWorkspaces(token);
        setWorkspaces(data);
        if (data.length > 0 && !data.some((w) => w.slug === activeWorkspaceSlug)) {
          setActiveWorkspaceSlug(data[0].slug);
        }
      } catch (err) {
        if (isForbiddenError(err)) {
          showPermissionDenied();
          return;
        }

        console.error('Failed to load workspaces:', err);
      }
    };
    if (isAuthenticated) {
      loadWorkspaces();
    }
  }, [isAuthenticated, getAccessToken, resource]);

  // Fetch sessions when workspace changes
  useEffect(() => {
    const loadSessions = async () => {
      if (!isAuthenticated) return;
      try {
        const token = await getAccessTokenOrThrow();
        const data = await fetchSessions(token, activeWorkspaceSlug);
        setPermissionDenied(false);
        setSessions(data);
        
        // Auto-select first session or clear if none
        if (data.length > 0) {
          setCurrentSessionId(data[0].id);
        } else {
          setCurrentSessionId(null);
          setMessages([]);
        }
      } catch (err) {
        if (isForbiddenError(err)) {
          showPermissionDenied();
          return;
        }

        console.error('Failed to load sessions:', err);
      }
    };
    
    loadSessions();
  }, [activeWorkspaceSlug, isAuthenticated, getAccessToken, resource]);

  // Fetch messages when session changes
  useEffect(() => {
    const loadMessages = async () => {
      if (!isAuthenticated || !currentSessionId) {
        if (!permissionDenied) {
          setMessages([]);
        }
        return;
      }
      try {
        const token = await getAccessTokenOrThrow();
        const data = await fetchSessionMessages(token, currentSessionId);
        setPermissionDenied(false);
        setMessages(data.map((m) => createMessage(m.role, m.content, false, m.id)));
      } catch (err) {
        if (isForbiddenError(err)) {
          showPermissionDenied();
          return;
        }

        console.error('Failed to load messages:', err);
        setMessages([]);
      }
    };
    
    loadMessages();
  }, [currentSessionId, isAuthenticated, getAccessToken, resource, permissionDenied]);

  const handleNewChat = async () => {
    if (!isAuthenticated) return;
    try {
      const token = await getAccessTokenOrThrow();
      const session = await createSession(token, activeWorkspaceSlug, 'Đoạn chat mới');
      setPermissionDenied(false);
      setSessions((prev) => [session, ...prev]);
      setCurrentSessionId(session.id);
      setMessages([]);
    } catch (err) {
      if (isForbiddenError(err)) {
        showPermissionDenied();
        return;
      }

      console.error('Failed to create session:', err);
    }
  };

  const handleSelectWorkspace = (slugFromSidebar: string) => {
    setActiveWorkspaceSlug(slugFromSidebar);
    // Sessions will auto-load via useEffect
  };

  const handleRenameWorkspace = (slug: string) => {
    const workspace = workspaces.find((item) => item.slug === slug);
    if (!workspace) return;

    const nextName = window.prompt('Nhập tên mới cho workspace:', workspace.name);
    if (!nextName || !nextName.trim()) return;

    void (async () => {
      try {
        const token = await getAccessTokenOrThrow();
        await renameWorkspace(token, slug, nextName.trim());
        setWorkspaces((prev) =>
          prev.map((item) =>
            item.slug === slug ? { ...item, name: nextName.trim() } : item
          )
        );
      } catch (err) {
        console.error('Failed to rename workspace:', err);
      }
    })();
  };

  const handleDeleteWorkspace = (slug: string) => {
    const workspace = workspaces.find((item) => item.slug === slug);
    if (!workspace) return;

    const confirmed = window.confirm(`Xóa workspace "${workspace.name}" khỏi sidebar?`);
    if (!confirmed) return;

    void (async () => {
      try {
        const token = await getAccessTokenOrThrow();
        await deleteWorkspace(token, slug);
        const nextWorkspaces = workspaces.filter((item) => item.slug !== slug);
        setWorkspaces(nextWorkspaces);

        if (activeWorkspaceSlug === slug) {
          const fallbackSlug = nextWorkspaces[0]?.slug || 'internal';
          setActiveWorkspaceSlug(fallbackSlug);
          setCurrentSessionId(null);
          setMessages([]);
        }
      } catch (err) {
        console.error('Failed to delete workspace:', err);
      }
    })();
  };

  const handleCreateWorkspace = () => {
    const name = window.prompt('Nhập tên workspace mới:');
    if (!name || !name.trim()) return;

    void (async () => {
      try {
        const token = await getAccessTokenOrThrow();
        const created = await createWorkspace(token, name.trim());
        setWorkspaces((prev) => [...prev, created]);
        setActiveWorkspaceSlug(created.slug);
      } catch (err) {
        console.error('Failed to create workspace:', err);
      }
    })();
  };

  const handleSelectSession = (sessionId: string) => {
    setCurrentSessionId(sessionId);
  };

  const handleAuthAction = () => {
    if (isAuthenticated) {
      void signOut(window.location.origin);
      return;
    }

    void signIn(`${window.location.origin}/callback`);
  };

  const toggleSidebar = () => {
    setIsSidebarVisible((visible) => !visible);
  };

  const handleRenameSession = async (sessionId: string) => {
    if (!isAuthenticated) return;
    const newTitle = window.prompt('Nhập tên mới cho đoạn chat:', currentSession?.title || '');
    if (newTitle === null || !newTitle.trim()) return;
    
    try {
      const token = await getAccessTokenOrThrow();
      const updated = await renameChatSession(token, sessionId, newTitle.trim());
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, title: updated.title } : s))
      );
    } catch (err) {
      if (isForbiddenError(err)) {
        showPermissionDenied();
        return;
      }

      console.error('Failed to rename session:', err);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!isAuthenticated) return;
    if (!window.confirm('Bạn chắc chắn muốn xóa đoạn chat này?')) return;
    
    try {
      const token = await getAccessTokenOrThrow();
      await deleteChatSession(token, sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      
      // If deleted session is current, switch to most recent or clear
      if (currentSessionId === sessionId) {
        setSessions((prev) => {
          if (prev.length > 0) {
            setCurrentSessionId(prev[0].id);
          } else {
            setCurrentSessionId(null);
            setMessages([]);
          }
          return prev;
        });
      }
    } catch (err) {
      if (isForbiddenError(err)) {
        showPermissionDenied();
        return;
      }

      console.error('Failed to delete session:', err);
    }
  };

  function handleAbort() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // Show partial content as final message if any tokens arrived
    if (streamingContent.trim()) {
      const partialContent = streamingContent;
      setMessages((m) => [...m, createMessage('assistant', partialContent + '\n\n_(Đã dừng)_', false)]);
    }
    setLoading(false);
    setStreamingContent('');
    setToolUse(null);
    streamingMessageIdRef.current = null;
  }

  async function sendMessage(messageText: string) {
    const trimmed = messageText.trim();
    if (!trimmed || loading) return;

    const userMessage = createMessage('user', trimmed, false);
    setMessages((m) => [...m, userMessage]);
    requestAnimationFrame(() => scrollToBottom(false));
    setInput('');
    setLoading(true);
    setStreamingContent('');

    if (!isAuthenticated) {
      setMessages((m) => [
        ...m,
        {
          ...createMessage(
            'assistant',
            'Vui lòng đăng nhập để tiếp tục trò chuyện.',
            false
          ),
          requiresLogin: true,
        },
      ]);

      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }

    try {
      const token = await getAccessTokenOrThrow();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const assistantMsgId = crypto.randomUUID();
      streamingMessageIdRef.current = assistantMsgId;

      streamChatMessage(
        token,
        {
          message: trimmed,
          sessionId: currentSessionId || undefined,
          workspaceSlug: activeWorkspaceSlug,
        },
        {
          onSession(sessionId, workspaceSlug) {
            if (!currentSessionId) {
              setPermissionDenied(false);
              setCurrentSessionId(sessionId);
              // Optimistic: add session to list immediately
              setSessions((prev) => {
                if (prev.some((s) => s.id === sessionId)) return prev;
                return [
                  {
                    id: sessionId,
                    title: trimmed.substring(0, 100),
                    workspaceSlug,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    messageCount: 1,
                  },
                  ...prev,
                ];
              });
            }
          },
          onToolUse(tool, status) {
            setToolUse({ tool, status });
          },
          onToken(token) {
            setStreamingContent((prev) => prev + token);
            requestAnimationFrame(() => scrollToBottom(false));
          },
          onDone(answer, _sources) {
            setPermissionDenied(false);
            setMessages((m) => [...m, createMessage('assistant', answer, false, assistantMsgId)]);
            setStreamingContent('');
            setToolUse(null);
            setLoading(false);
            streamingMessageIdRef.current = null;
            abortControllerRef.current = null;
            requestAnimationFrame(() => scrollToBottom(false));
            setTimeout(() => inputRef.current?.focus(), 0);
          },
          onError(errorMsg, status) {
            console.error('[Stream error]', errorMsg);
            setStreamingContent('');
            setToolUse(null);
            setMessages((m) => [
              ...m,
              createMessage(
                'assistant',
                status === 403 ? PERMISSION_DENIED_MESSAGE : 'Hiện tại trợ lý chưa thể phản hồi. Vui lòng thử lại.'
              ),
            ]);
            setLoading(false);
            streamingMessageIdRef.current = null;
            abortControllerRef.current = null;
            requestAnimationFrame(() => scrollToBottom(false));
            setTimeout(() => inputRef.current?.focus(), 0);
          },
        },
        abortController.signal
      );
    } catch (error) {
      console.error(error);
      setMessages((m) => [...m, createMessage('assistant', 'Hiện tại trợ lý chưa thể phản hồi. Vui lòng kiểm tra backend hoặc thử lại.')]);
      setLoading(false);
      setStreamingContent('');
      requestAnimationFrame(() => scrollToBottom(false));
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  if (isAuthLoading) {
    return (
      <div className="app-shell" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div className="welcome-banner">
          <h2>Đang tải thông tin đăng nhập...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className={`app-shell ${isSidebarVisible ? 'sidebar-open' : 'sidebar-closed'}`}>
      {!isSidebarVisible && (
        <button
          type="button"
          className="sidebar-float-toggle"
          onClick={toggleSidebar}
          aria-pressed={isSidebarVisible}
          title="Hiện sidebar"
        >
          <span>☰</span>
        </button>
      )}

      {isSidebarVisible && (
        <>
          <button
            type="button"
            className="sidebar-backdrop"
            onClick={toggleSidebar}
            aria-label="Đóng sidebar"
          />
          <Sidebar
            workspaces={workspaces}
            activeWorkspaceSlug={activeWorkspaceSlug}
            sessions={sessions}
            activeSessionId={currentSessionId || ''}
            onNewChat={handleNewChat}
            onCreateWorkspace={handleCreateWorkspace}
            onToggleSidebar={toggleSidebar}
            isSidebarVisible={isSidebarVisible}
            onSelectWorkspace={handleSelectWorkspace}
            onRenameWorkspace={handleRenameWorkspace}
            onDeleteWorkspace={handleDeleteWorkspace}
            onSelectSession={handleSelectSession}
            onRenameSession={handleRenameSession}
            onDeleteSession={handleDeleteSession}
            onProfileClick={() => signOut(window.location.origin)}
            isAuthenticated={isAuthenticated}
          />
        </>
      )}

      <main className="chat-container">
        <header className="chat-header">
          <button
            type="button"
            className="mobile-menu-btn"
            onClick={toggleSidebar}
            aria-label="Mở sidebar"
            title="Mở sidebar"
          >
            ☰
          </button>
          <h2>
            FanMe <span>AI</span>
            {activeWorkspace && (
              <span
                style={{
                  fontSize: '14px',
                  color: 'var(--text)',
                  fontWeight: '500',
                  marginLeft: '12px',
                  background: 'var(--bg-sidebar)',
                  padding: '6px 12px',
                  borderRadius: '12px',
                }}
              >
                📁 {activeWorkspace.name}
              </span>
            )}
          </h2>
          <div className="header-actions">
            {isAuthenticated && (
              <button
                onClick={handleAuthAction}
                style={{
                  background: 'transparent',
                  color: 'var(--text-dim)',
                  border: '1px solid var(--panel-border)',
                  padding: '6px 12px',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                }}
              >
                Đăng xuất
              </button>
            )}
          </div>
        </header>

        <div className="chat-messages-container" ref={messagesContainerRef}>
          <div className="chat-messages-inner">
            {messages.length === 0 && (
              <div className="welcome-banner">
                <h1>{activeWorkspace?.name || 'Xin chào,'}</h1>
                <h2>Tôi có thể giúp gì cho bạn hôm nay?</h2>

                <div className="suggestions-grid">
                  {suggestions.map((item, index) => (
                    <button
                      key={index}
                      className="suggestion-card"
                      onClick={() => void sendMessage(item.text)}
                    >
                      <span className="icon">{item.icon}</span>
                      <span>{item.text}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}

            {loading && streamingContent && (() => {
              const parsed = parseThinking(streamingContent);
              return (
                <div className="message-row">
                  <div className="avatar assistant-avatar assistant-avatar-image">
                    <img src={assistantLogo} alt="FanMe AI" />
                  </div>
                  <div className="message-bubble assistant-bubble">
                    {toolUse && (
                      <ToolUseBlock tool={toolUse.tool} status={toolUse.status} />
                    )}
                    {parsed.thinking && (
                      <ThinkingBlock
                        content={parsed.thinking}
                        isStreaming={!parsed.isThinkingComplete}
                      />
                    )}
                    {parsed.response && (
                      <p style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {parsed.response}
                        <span className="streaming-cursor">▊</span>
                      </p>
                    )}
                    {!parsed.response && parsed.isThinkingComplete && (
                      <span className="streaming-cursor">▊</span>
                    )}
                  </div>
                </div>
              );
            })()}

            {loading && !streamingContent && (
              <div className="message-row">
                <div className="avatar assistant-avatar assistant-avatar-image">
                  <img src={assistantLogo} alt="FanMe AI" />
                </div>
                <div className="message-bubble assistant-bubble">
                  {toolUse && (
                    <ToolUseBlock tool={toolUse.tool} status={toolUse.status} />
                  )}
                  {!toolUse && (
                    <div className="typing">
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                    </div>
                  )}
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        <div className="chat-input-container">
          <div className="chat-input-wrapper">
            <form className="chat-input-form" onSubmit={handleSubmit}>
              <input
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={activeWorkspace ? `Hỏi trong ${activeWorkspace.name}...` : 'Nhập câu lệnh tại đây...'}
              />
              {loading ? (
                <button type="button" onClick={handleAbort} className="send-btn stop-btn" title="Dừng">
                  ◼
                </button>
              ) : (
                <button type="submit" disabled={!canSend} className="send-btn">
                  ➤
                </button>
              )}
            </form>
            <p className="disclaimer">
              FanMe AI có thể đưa ra câu trả lời không chính xác, vì vậy hãy kiểm tra thông tin cẩn thận.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
