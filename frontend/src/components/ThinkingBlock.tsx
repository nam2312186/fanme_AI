import { useState } from 'react';

type ThinkingBlockProps = {
  content: string;
  isStreaming?: boolean;
};

export function ThinkingBlock({ content, isStreaming = false }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  if (!content.trim()) return null;

  const lines = content.trim().split('\n');
  const previewLines = lines.slice(0, 2).join('\n');
  const hasMore = lines.length > 2;

  return (
    <div className={`thinking-block ${isStreaming ? 'thinking-active' : ''}`}>
      <button
        type="button"
        className="thinking-toggle"
        onClick={() => setExpanded(!expanded)}
      >
        {isStreaming && <span className="thinking-spinner" />}
        {!isStreaming && <span className="thinking-icon">💭</span>}
        <span className="thinking-label">
          {isStreaming ? 'Đang suy luận...' : 'Quá trình suy luận'}
        </span>
        {(hasMore || !isStreaming) && (
          <span className="thinking-arrow">{expanded ? '▾' : '▸'}</span>
        )}
      </button>
      <div className={`thinking-content ${expanded ? 'thinking-expanded' : 'thinking-collapsed'}`}>
        {expanded ? content.trim() : previewLines}
        {!expanded && hasMore && <span className="thinking-ellipsis">...</span>}
      </div>
    </div>
  );
}
