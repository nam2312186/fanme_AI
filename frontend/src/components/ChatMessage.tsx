import { useLogto } from '@logto/react';
import type { ChatMessage as ChatMessageType } from '../types';
import { parseThinking } from '../utils/parseThinking';
import { ThinkingBlock } from './ThinkingBlock';
import { MessageContent } from './MessageContent';
import assistantLogo from '../assets/logo.png';

export function ChatMessage({ message }: { message: ChatMessageType }) {
  const isUser = message.role === 'user';
  const { signIn } = useLogto();

  const parsed = !isUser ? parseThinking(message.content) : null;

  return (
    <div className={`message-row ${isUser ? 'message-row-user' : ''}`}>
      {!isUser && (
        <div className="avatar assistant-avatar assistant-avatar-image">
          <img src={assistantLogo} alt="FanMe AI" />
        </div>
      )}

      {isUser && <div className="avatar user-message-avatar">👤</div>}

      <div className={`message-bubble ${isUser ? 'user-bubble' : 'assistant-bubble'}`}>
        {isUser && <p>{message.content}</p>}

        {!isUser && parsed && (
          <>
            {parsed.thinking && (
              <ThinkingBlock
                content={parsed.thinking}
                isStreaming={!parsed.isThinkingComplete}
              />
            )}
            {parsed.response && <MessageContent content={parsed.response} />}
          </>
        )}

        {message.isSensitive && (
          <span className="sensitive-note">
            Câu hỏi này có thể cần đăng nhập nhân viên để xác thực quyền truy cập.
          </span>
        )}

        {message.requiresLogin && (
          <div style={{ marginTop: '16px', display: 'flex', gap: '12px' }}>
            <button 
              onClick={() => signIn(`${window.location.origin}/callback`)} 
              style={{
                background: 'linear-gradient(135deg, var(--primary), var(--accent))',
                color: '#fff',
                padding: '8px 24px',
                borderRadius: '8px',
                fontWeight: '500',
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 4px 15px var(--primary-glow)'
              }}
            >
              Đăng nhập ngay
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
