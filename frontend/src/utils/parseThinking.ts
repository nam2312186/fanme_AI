export type ParsedContent = {
  thinking: string;
  response: string;
  isThinkingComplete: boolean;
};

/**
 * Parse content that may contain <think>...</think> blocks.
 * Separates thinking from the actual response.
 */
export function parseThinking(content: string): ParsedContent {
  if (!content) return { thinking: '', response: '', isThinkingComplete: true };

  // Check if there's a <think> tag
  const thinkStart = content.indexOf('<think>');
  if (thinkStart === -1) {
    return { thinking: '', response: content, isThinkingComplete: true };
  }

  const thinkEnd = content.indexOf('</think>');

  if (thinkEnd === -1) {
    // Still thinking (no closing tag yet - streaming)
    const thinkingContent = content.slice(thinkStart + 7); // after <think>
    return {
      thinking: thinkingContent,
      response: '',
      isThinkingComplete: false,
    };
  }

  // Complete think block
  const thinkingContent = content.slice(thinkStart + 7, thinkEnd);
  const responseContent = content.slice(thinkEnd + 8).trim(); // after </think>
  const beforeThink = content.slice(0, thinkStart).trim();

  return {
    thinking: thinkingContent,
    response: (beforeThink + ' ' + responseContent).trim(),
    isThinkingComplete: true,
  };
}
