import { type CSSProperties, useEffect, useId, useState } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'base',
  themeVariables: {
    fontFamily: 'Outfit, sans-serif',
    primaryColor: '#eff6ff',
    primaryTextColor: '#1f2937',
    primaryBorderColor: '#2563eb',
    lineColor: '#2563eb',
    secondaryColor: '#f0fdfa',
    tertiaryColor: '#ffffff',
  },
});

type MermaidDiagramProps = {
  code: string;
};

type XyChart = {
  title: string;
  xLabels: string[];
  yLabel: string;
  yMax: number;
  kind: 'bar' | 'line';
  values: number[];
};

function parseArrayLine(line: string): string[] {
  const match = line.match(/\[(.*)\]/);
  if (!match) return [];

  return match[1]
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((item) => item.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

function parseXyChart(code: string): XyChart | null {
  const lines = code
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines[0] !== 'xychart-beta') return null;

  const titleLine = lines.find((line) => line.startsWith('title '));
  const xAxisLine = lines.find((line) => line.startsWith('x-axis '));
  const yAxisLine = lines.find((line) => line.startsWith('y-axis '));
  const barLine = lines.find((line) => line.startsWith('bar '));
  const lineLine = lines.find((line) => line.startsWith('line '));
  const seriesLine = barLine || lineLine;

  if (!xAxisLine || !yAxisLine || !seriesLine) return null;

  const title = titleLine?.match(/"(.+)"/)?.[1] || 'Biểu đồ';
  const xLabels = parseArrayLine(xAxisLine);
  const values = parseArrayLine(seriesLine)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
  const yLabel = yAxisLine.match(/"(.+?)"/)?.[1] || '';
  const yMaxMatch = yAxisLine.match(/-->\s*([0-9.]+)/);
  const yMax = Number(yMaxMatch?.[1] || Math.max(...values, 1));

  if (xLabels.length === 0 || values.length === 0 || xLabels.length !== values.length || !Number.isFinite(yMax) || yMax <= 0) {
    return null;
  }

  return {
    title,
    xLabels,
    yLabel,
    yMax,
    kind: barLine ? 'bar' : 'line',
    values,
  };
}

function ResponsiveXyChart({ chart }: { chart: XyChart }) {
  const ticks = [chart.yMax, chart.yMax * 0.75, chart.yMax * 0.5, chart.yMax * 0.25, 0]
    .map((value) => Math.round(value));
  const points = chart.values
    .map((value, index) => {
      const x = chart.values.length === 1 ? 50 : (index / (chart.values.length - 1)) * 100;
      const y = 100 - Math.max(0, Math.min(100, (value / chart.yMax) * 100));
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div className="responsive-chart" role="img" aria-label={chart.title}>
      <h3>{chart.title}</h3>
      <div className="responsive-chart-body">
        <div className="responsive-chart-y-title">{chart.yLabel}</div>
        <div className="responsive-chart-y-axis">
          {ticks.map((tick) => (
            <span key={tick}>{tick}</span>
          ))}
        </div>
        <div className="responsive-chart-plot">
          <div className="responsive-chart-grid">
            {ticks.map((tick) => (
              <span key={tick} />
            ))}
          </div>
          {chart.kind === 'bar' ? (
            <div className="responsive-chart-bars">
              {chart.values.map((value, index) => (
                <div className="responsive-chart-bar-slot" key={`${chart.xLabels[index]}-${index}`}>
                  <div
                    className="responsive-chart-bar"
                    style={{ height: `${Math.max(2, (value / chart.yMax) * 100)}%` }}
                    title={`${chart.xLabels[index]}: ${value}`}
                  />
                </div>
              ))}
            </div>
          ) : (
            <svg className="responsive-chart-line" viewBox="0 0 100 100" preserveAspectRatio="none">
              <polyline points={points} />
              {chart.values.map((value, index) => {
                const x = chart.values.length === 1 ? 50 : (index / (chart.values.length - 1)) * 100;
                const y = 100 - Math.max(0, Math.min(100, (value / chart.yMax) * 100));
                return <circle key={`${chart.xLabels[index]}-${index}`} cx={x} cy={y} r="1.4" />;
              })}
            </svg>
          )}
        </div>
      </div>
      <div
        className="responsive-chart-x-axis"
        style={{ '--chart-label-count': chart.xLabels.length } as CSSProperties}
      >
        <span />
        {chart.xLabels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  );
}

export function MermaidDiagram({ code }: MermaidDiagramProps) {
  const id = useId().replace(/:/g, '');
  const xyChart = parseXyChart(code);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (xyChart) {
    return <ResponsiveXyChart chart={xyChart} />;
  }

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      try {
        setError(null);
        const result = await mermaid.render(`mermaid-${id}`, code.trim());

        if (!cancelled) {
          setSvg(result.svg);
        }
      } catch (err) {
        if (!cancelled) {
          setSvg('');
          setError(err instanceof Error ? err.message : 'Không thể render biểu đồ.');
        }
      }
    }

    void renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [code, id]);

  if (error) {
    return (
      <div className="mermaid-error">
        <p>Không thể hiển thị biểu đồ Mermaid.</p>
        <pre>{code}</pre>
      </div>
    );
  }

  if (!svg) {
    return <div className="mermaid-loading">Đang vẽ biểu đồ...</div>;
  }

  return (
    <div
      className="mermaid-diagram"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
