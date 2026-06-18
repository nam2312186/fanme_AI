import { useState, useEffect } from 'react';

type ToolUseBlockProps = {
  tool: string;
  status: 'start' | 'done';
};

const TOOL_LABELS: Record<string, { label: string; icon: string }> = {
  order_lookup: { label: 'Tra cứu đơn hàng', icon: '📦' },
  revenue_lookup: { label: 'Tra cứu doanh thu', icon: '₫' },
  product_inventory_lookup: { label: 'Tra cứu tồn kho', icon: '▦' },
  default: { label: 'Đang xử lý', icon: '🔧' },
};

export default function ToolUseBlock({ tool, status }: ToolUseBlockProps) {
  const [dots, setDots] = useState('');
  const info = TOOL_LABELS[tool] || TOOL_LABELS.default;
  const toolClass = `tool-${tool.replace(/[^a-z0-9_-]/gi, '-').toLowerCase()}`;

  useEffect(() => {
    if (status !== 'start') return;
    const interval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'));
    }, 400);
    return () => clearInterval(interval);
  }, [status]);

  return (
    <div className={`tool-use-block ${toolClass} ${status === 'done' ? 'tool-done' : 'tool-active'}`}>
      <div className="tool-use-icon" aria-hidden="true">{info.icon}</div>
      <div className="tool-use-content">
        <span className="tool-use-label">
          {status === 'start' ? `${info.label}${dots}` : `${info.label} ✓`}
        </span>
      </div>
      {status === 'start' && <div className="tool-use-spinner" />}
    </div>
  );
}
