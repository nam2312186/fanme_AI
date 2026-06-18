type AskAnythingLLMInput = {
  message: string;
  sessionId?: string;
  workspaceSlug?: string;
};

type AskAnythingLLMOutput = {
  answer: string;
  sessionId?: string;
  sources?: unknown[];
  raw: unknown;
};

export type StreamCallbacks = {
  onToken: (token: string) => void;
  onDone: (fullText: string, sources: unknown[]) => void;
  onError: (error: Error) => void;
  onToolUse?: (tool: string, status: 'start' | 'done') => void;
};

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value || value.trim() === '') {
    throw new Error(`Missing env ${name}`);
  }

  return value.trim();
}

// Cache workspace info to avoid repeated API calls
let cachedWorkspaceInfo: { model: string; slug: string; fetchedAt: number } | null = null;

function getCachedWorkspaceModel(workspaceSlug?: string): string | null {
  const slug = workspaceSlug || process.env.ANYTHINGLLM_WORKSPACE_SLUG || '';

  if (cachedWorkspaceInfo && cachedWorkspaceInfo.slug === slug) {
    return cachedWorkspaceInfo.model;
  }

  return null;
}

async function fetchWorkspaceModel(workspaceSlug?: string): Promise<string> {
  const slug = workspaceSlug || process.env.ANYTHINGLLM_WORKSPACE_SLUG || '';
  const now = Date.now();

  // Cache for 60 seconds — short enough to pick up model changes quickly
  if (cachedWorkspaceInfo && cachedWorkspaceInfo.slug === slug && now - cachedWorkspaceInfo.fetchedAt < 60_000) {
    return cachedWorkspaceInfo.model;
  }

  try {
    const baseUrl = requiredEnv('ANYTHINGLLM_BASE_URL').replace(/\/$/, '');
    const apiKey = requiredEnv('ANYTHINGLLM_API_KEY');
    const headers = { Authorization: `Bearer ${apiKey}` };
    let model = '';

    // Try workspace-level model
    const wsRes = await fetch(`${baseUrl}/api/v1/workspace/${encodeURIComponent(slug)}`, { headers });
    if (wsRes.ok) {
      const wsData = await wsRes.json() as any;
      // Handle: array, { workspace: [...] }, { workspace: {...} }, or plain object
      let raw = wsData?.workspace ?? wsData;
      if (Array.isArray(raw)) raw = raw[0];
      model = raw?.chatModel || raw?.agentModel || '';
    }

    // If workspace uses system default, fetch system LLM
    if (!model) {
      try {
        const sysRes = await fetch(`${baseUrl}/api/v1/system`, { headers });
        if (sysRes.ok) {
          const s = (await sysRes.json() as any)?.settings || {};
          model = s?.OllamaLLMModelPref || s?.LLMModelPref || s?.LLMModel || `${s?.LLMProvider || 'unknown'}`;
        }
      } catch { /* ignore */ }
    }

    model = model || 'unknown';
    cachedWorkspaceInfo = { model, slug, fetchedAt: now };
    return model;
  } catch { /* ignore */ }
  return 'unknown';
}

function buildChatUrl(workspaceSlug?: string, stream = false): string {
  const baseUrl = requiredEnv('ANYTHINGLLM_BASE_URL').replace(/\/$/, '');
  const slug = workspaceSlug || requiredEnv('ANYTHINGLLM_WORKSPACE_SLUG');

  const defaultEndpoint = stream
    ? '/api/v1/workspace/{slug}/stream-chat'
    : '/api/v1/workspace/{slug}/chat';

  const endpointTemplate =
    stream ? defaultEndpoint : (process.env.ANYTHINGLLM_CHAT_ENDPOINT || defaultEndpoint);

  const endpoint = endpointTemplate.replace(
    '{slug}',
    encodeURIComponent(slug)
  );

  return `${baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
}

export function cleanAnswer(text: string): string {
  if (!text) return '';

  let cleaned = text;

  // Remove <think>...</think> blocks
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');

  // Remove stray <think> and </think> tags
  cleaned = cleaned.replace(/<\/?think>/gi, '');

  // Remove bold markers (**)
  cleaned = cleaned.replace(/\*\*/g, '');

  // Remove heading markers (##, ###, ####, etc.)
  cleaned = cleaned.replace(/^#+\s+/gm, '');

  // Remove common meta-text patterns (English)
  cleaned = cleaned
    .replace(/^The user is asking[\s\S]*?(?=[A-ZTíàáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõộôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ])/i, '')
    .replace(/^This is a general question[\s\S]*?(?=[A-ZTíàáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõộôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ])/i, '')
    .replace(/^Looking at the context[\s\S]*?(?=[A-ZTíàáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõộôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ])/i, '')
    .replace(/^From CONTEXT[\s\S]*?(?=[A-ZTíàáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõộôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ])/i, '')
    .trim();

  // Remove problematic meta-text lines
  const badPatterns = [
    /^The user is asking/i,
    /^This is a general question/i,
    /^Looking at the context/i,
    /^From CONTEXT/i,
    /^I can see/i,
    /^I should/i,
    /^I need to/i,
    /^Based on the context/i,
  ];

  cleaned = cleaned
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !badPatterns.some((pattern) => pattern.test(trimmed));
    })
    .join('\n')
    .trim();

  // Collapse multiple empty lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned || 'Không có phản hồi.';
}

/**
 * Parse a line from the stream response.
 * Handles both SSE format ("data: {...}") and plain NDJSON ("{...}")
 */
function parseStreamLine(line: string): any | null {
  let jsonStr = line.trim();
  if (!jsonStr) return null;

  // Strip SSE "data:" prefix if present
  if (jsonStr.startsWith('data:')) {
    jsonStr = jsonStr.slice(5).trim();
  }

  // Skip SSE comments or empty data
  if (!jsonStr || jsonStr === '[DONE]') return null;

  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/**
 * Extract text token from a parsed stream chunk.
 * Handles multiple response formats from different AnythingLLM versions.
 */
function extractTokenFromChunk(parsed: any): { token: string; sources?: unknown[]; isDone?: boolean } {
  let token = '';
  let sources: unknown[] | undefined;
  let isDone = false;

  if (parsed.type === 'textResponseChunk') {
    token = parsed.textResponse || '';
    sources = parsed.sources;
  } else if (parsed.type === 'finalizeResponseStream') {
    token = parsed.textResponse || '';
    sources = parsed.sources;
    isDone = true;
  } else if (parsed.close === true) {
    sources = parsed.sources;
    isDone = true;
  } else if (typeof parsed.textResponse === 'string') {
    token = parsed.textResponse;
    sources = parsed.sources;
    isDone = !!parsed.close;
  }

  return { token, sources, isDone };
}

/**
 * Detect if message should go through AnythingLLM agent mode and prefix with @agent.
 */
function maybeInjectAgent(message: string): { message: string; agentTool: string | null } {
  const hasAgentPrefix = message.trimStart().toLowerCase().startsWith('@agent');
  const userMessage = hasAgentPrefix
    ? message.trimStart().replace(/^@agent\s*/i, '').trim()
    : message;
  const orderPatterns = [
    /(?:tra|kiểm tra|check|xem|tìm|lookup|trạng thái|status).*(?:đơn|đơn hàng|order|đơn đặt)/i,
    /(?:đơn|đơn hàng|order|đơn đặt).*(?:tra|kiểm tra|check|xem|tìm|trạng thái|status)/i,
    /(?:mã đơn|order.?(?:id|number|code)|FM\d+|DH\d+)/i,
    /(?:đơn hàng|order).*(?:của tôi|của mình|my)/i,
  ];
  const revenuePatterns = [
    /(?:tra|kiểm tra|check|xem|tìm|lookup|lấy|tính|thống kê|báo cáo).*(?:doanh thu|revenue|doanh số|sales)/i,
    /(?:doanh thu|revenue|doanh số|sales).*(?:tra|kiểm tra|check|xem|tìm|lookup|lấy|tính|thống kê|báo cáo)/i,
    /(?:doanh thu|revenue|doanh số|sales).*(?:ngày|tháng|năm|quý|tuần|từ|đến|trong|date|month|year|range|q[1-4]|20\d{2})/i,
    /(?:doanh thu|revenue|doanh số|sales).*(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i,
  ];
  const productInventoryPatterns = [
    /(?:tra cứu|truy vấn|lookup|check).*(?:sản phẩm|san pham|product|tồn kho|ton kho|kho|hàng tồn|hang ton|hàng còn|hang con|còn hàng|con hang|current stock|product inventory|inventory|stock)/i,
  ];

  const isOrderQuery = orderPatterns.some((p) => p.test(message));
  if (isOrderQuery) {
    console.log('[AnythingLLM] Detected order query → injecting @agent');
    return {
      message: [
        '@agent',
        'BẮT BUỘC gọi công cụ/API tra cứu đơn hàng nội bộ trước khi trả lời.',
        'Không được trả lời từ context, tài liệu, lịch sử chat hoặc suy luận nếu chưa gọi API.',
        'Sau khi công cụ trả dữ liệu, chỉ dùng dữ liệu công cụ để trả lời.',
        `Câu hỏi người dùng: ${userMessage}`,
      ].join(' '),
      agentTool: 'order_lookup',
    };
  }

  const isRevenueQuery = revenuePatterns.some((p) => p.test(message));
  if (isRevenueQuery) {
    console.log('[AnythingLLM] Detected revenue query → injecting @agent');
    return {
      message: [
        '@agent',
        'BẮT BUỘC gọi công cụ/API doanh thu nội bộ trước khi trả lời.',
        'Không được trả lời từ context, tài liệu, lịch sử chat hoặc suy luận nếu chưa gọi API.',
        'Nếu người dùng hỏi theo tháng/năm, hãy chuyển thành khoảng ngày đầy đủ rồi gọi API.',
        'Sau khi công cụ trả dữ liệu, chỉ dùng dữ liệu công cụ để trả lời.',
        `Câu hỏi người dùng: ${userMessage}`,
      ].join(' '),
      agentTool: 'revenue_lookup',
    };
  }

  const isProductInventoryQuery = productInventoryPatterns.some((p) => p.test(message));
  if (isProductInventoryQuery) {
    console.log('[AnythingLLM] Detected product inventory query → injecting @agent');
    return {
      message: [
        '@agent',
        'BẮT BUỘC gọi công cụ/API tra cứu danh sách sản phẩm và tồn kho hiện tại trước khi trả lời.',
        'Chỉ dùng công cụ này vì người dùng có yêu cầu tra cứu dữ liệu sản phẩm/tồn kho thực tế.',
        'Không được trả lời từ context, tài liệu, lịch sử chat hoặc suy luận nếu chưa gọi API.',
        'Không tự bịa sản phẩm hoặc số lượng tồn kho.',
        'Sau khi công cụ trả dữ liệu, chỉ dùng dữ liệu công cụ để trả lời ngắn gọn bằng tiếng Việt.',
        `Câu hỏi người dùng: ${userMessage}`,
      ].join(' '),
      agentTool: 'product_inventory_lookup',
    };
  }

  return { message, agentTool: null };
}

/**
 * Streaming version - calls AnythingLLM stream-chat endpoint.
 * Falls back to non-streaming if stream endpoint is unavailable.
 */
export async function streamAnythingLLM(
  input: AskAnythingLLMInput,
  callbacks: StreamCallbacks,
  externalAbort?: AbortController
): Promise<void> {
  const apiKey = requiredEnv('ANYTHINGLLM_API_KEY');
  const streamUrl = buildChatUrl(undefined, true);
  const mode = process.env.ANYTHINGLLM_CHAT_MODE || 'chat';
  const timeoutMs = Number(process.env.ANYTHINGLLM_TIMEOUT_MS || 30000);

  console.log(`[AnythingLLM] Stream request → ${streamUrl}`);
  console.log(`[AnythingLLM] model=${getCachedWorkspaceModel(input.workspaceSlug) || 'loading'}, mode=${mode}, timeout=${timeoutMs}ms`);
  void fetchWorkspaceModel(input.workspaceSlug).then((model) => {
    console.log(`[AnythingLLM] model cache refreshed: ${model}`);
  });

  const controller = externalAbort || new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const { message: finalMessage, agentTool } = maybeInjectAgent(input.message);

  // Notify frontend that agent tool is being used
  if (agentTool && callbacks.onToolUse) {
    callbacks.onToolUse(agentTool, 'start');
  }

  try {
    const response = await fetch(streamUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: finalMessage,
        mode,
        sessionId: input.sessionId,
      }),
      signal: controller.signal,
    });

    // If stream endpoint doesn't exist (404) or fails, fallback to non-streaming
    if (!response.ok) {
      if (controller.signal.aborted) return;
      console.warn(`[AnythingLLM] Stream endpoint returned ${response.status}, falling back to non-streaming`);
      clearTimeout(timeout);
      const fallbackResult = await askAnythingLLM(input);
      callbacks.onToken(fallbackResult.answer);
      callbacks.onDone(fallbackResult.answer, fallbackResult.sources || []);
      return;
    }

    if (!response.body) {
      if (controller.signal.aborted) return;
      console.warn('[AnythingLLM] No response body, falling back to non-streaming');
      clearTimeout(timeout);
      const fallbackResult = await askAnythingLLM(input);
      callbacks.onToken(fallbackResult.answer);
      callbacks.onDone(fallbackResult.answer, fallbackResult.sources || []);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let sources: unknown[] = [];
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines (split by newline)
      const lines = buffer.split('\n');
      // Keep last potentially-incomplete line in buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        const parsed = parseStreamLine(line);
        if (!parsed) continue;

        const { token, sources: chunkSources, isDone } = extractTokenFromChunk(parsed);

        if (token) {
          fullText += token;
          callbacks.onToken(token);
        }
        if (chunkSources) {
          sources = chunkSources;
        }
        if (isDone) break;
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      const parsed = parseStreamLine(buffer);
      if (parsed) {
        const { token, sources: chunkSources } = extractTokenFromChunk(parsed);
        if (token) {
          fullText += token;
          callbacks.onToken(token);
        }
        if (chunkSources) {
          sources = chunkSources;
        }
      }
    }

    // If stream returned 200 but no tokens (format not recognized), fallback
    if (!fullText.trim()) {
      if (controller.signal.aborted) return;
      console.warn('[AnythingLLM] Stream returned no tokens, falling back to non-streaming');
      clearTimeout(timeout);
      const fallbackResult = await askAnythingLLM(input);
      callbacks.onToken(fallbackResult.answer);
      callbacks.onDone(fallbackResult.answer, fallbackResult.sources || []);
      return;
    }

    const cleanedText = cleanAnswer(fullText);
    console.log(`[AnythingLLM] ✓ Done — ${fullText.length} chars, ${sources.length} sources`);
    if (agentTool && callbacks.onToolUse) {
      callbacks.onToolUse(agentTool, 'done');
    }
    callbacks.onDone(cleanedText, sources);
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      callbacks.onError(new Error(`Request aborted or timeout after ${timeoutMs}ms`));
      return;
    }
    // On any error, try non-streaming fallback (unless aborted)
    if (controller.signal.aborted) return;
    try {
      console.warn('[AnythingLLM] Stream error, falling back:', (error as Error).message);
      const fallbackResult = await askAnythingLLM(input);
      callbacks.onToken(fallbackResult.answer);
      callbacks.onDone(fallbackResult.answer, fallbackResult.sources || []);
    } catch (fallbackError) {
      callbacks.onError(fallbackError as Error);
    }
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Non-streaming version (fallback)
 */
export async function askAnythingLLM(
  input: AskAnythingLLMInput
): Promise<AskAnythingLLMOutput> {
  const apiKey = requiredEnv('ANYTHINGLLM_API_KEY');
  const chatUrl = buildChatUrl(undefined, false);
  const mode = process.env.ANYTHINGLLM_CHAT_MODE || 'chat';
  const timeoutMs = Number(process.env.ANYTHINGLLM_TIMEOUT_MS || 30000);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const { message: finalMessage } = maybeInjectAgent(input.message);

  try {
    const response = await fetch(chatUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: finalMessage,
        mode,
        sessionId: input.sessionId,
      }),
      signal: controller.signal,
    });

    const text = await response.text();
    let data: any = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { rawText: text };
    }

    if (!response.ok) {
      throw new Error(
        `AnythingLLM returned ${response.status}: ${JSON.stringify(data)}`
      );
    }
    
    console.log('[AnythingLLM] Raw response =', JSON.stringify(data, null, 2));

    // Extract answer from response - look for common field names
    let answer = '';
    if (typeof data?.textResponse === 'string') {
      answer = data.textResponse;
    } else if (typeof data?.response === 'string') {
      answer = data.response;
    } else if (typeof data?.answer === 'string') {
      answer = data.answer;
    } else if (typeof data?.message === 'string') {
      answer = data.message;
    } else if (data?.rawText) {
      answer = data.rawText;
    }

    // Clean the answer
    answer = cleanAnswer(answer);

    return {
      answer,
      sessionId: data?.sessionId || data?.chatId || input.sessionId,
      sources: data?.sources || data?.documents || [],
      raw: data,
    };
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error(`AnythingLLM request timeout after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
