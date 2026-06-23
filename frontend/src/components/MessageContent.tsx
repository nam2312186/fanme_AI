import { MermaidDiagram } from './MermaidDiagram';

type Segment =
  | { type: 'text'; content: string }
  | { type: 'mermaid'; content: string }
  | { type: 'code'; content: string; language: string };

function parseSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  const codeBlockPattern = /```(\w+)?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockPattern.exec(content)) !== null) {
    const [fullMatch, language = '', code = ''] = match;

    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        content: content.slice(lastIndex, match.index),
      });
    }

    const normalizedLanguage = language.trim().toLowerCase();
    if (normalizedLanguage === 'mermaid') {
      segments.push({ type: 'mermaid', content: code });
    } else {
      segments.push({ type: 'code', language: normalizedLanguage, content: code });
    }

    lastIndex = match.index + fullMatch.length;
  }

  if (lastIndex < content.length) {
    segments.push({ type: 'text', content: content.slice(lastIndex) });
  }

  return segments.filter((segment) => segment.content.trim().length > 0);
}

export function MessageContent({ content }: { content: string }) {
  const segments = parseSegments(content);

  if (segments.length === 0) {
    return null;
  }

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === 'mermaid') {
          return <MermaidDiagram key={`${index}-mermaid`} code={segment.content} />;
        }

        if (segment.type === 'code') {
          return (
            <pre key={`${index}-code`} className="message-code-block">
              <code>{segment.content.trim()}</code>
            </pre>
          );
        }

        return <p key={`${index}-text`}>{segment.content.trim()}</p>;
      })}
    </>
  );
}
