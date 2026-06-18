export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
};

export type ChatSession = {
  id: string;
  title: string | null;
  workspaceSlug: string;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
};

export type WorkspaceConfig = {
  slug: string;
  name: string;
};

function getAuthHeaders(accessToken: string) {
  return {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function isForbiddenError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

async function ensureOk(response: Response, fallbackMessage: string): Promise<void> {
  if (response.ok) return;

  const errorData = await response.json().catch(() => ({}));
  const message = typeof errorData.message === 'string' ? errorData.message : fallbackMessage;

  throw new ApiError(response.status, message);
}

export async function fetchWorkspaces(accessToken: string): Promise<WorkspaceConfig[]> {
  const response = await fetch(`${apiBaseUrl}/api/chat/workspaces`, {
    headers: getAuthHeaders(accessToken),
  });
  await ensureOk(response, 'Failed to fetch workspaces');
  const data = await response.json();
  return data.items || [];
}

export async function createWorkspace(
  accessToken: string,
  name: string
): Promise<WorkspaceConfig> {
  const response = await fetch(`${apiBaseUrl}/api/chat/workspaces`, {
    method: 'POST',
    headers: getAuthHeaders(accessToken),
    body: JSON.stringify({ name }),
  });
  await ensureOk(response, 'Failed to create workspace');
  return response.json();
}

export async function renameWorkspace(
  accessToken: string,
  slug: string,
  name: string
): Promise<WorkspaceConfig> {
  const response = await fetch(`${apiBaseUrl}/api/chat/workspaces/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: getAuthHeaders(accessToken),
    body: JSON.stringify({ name }),
  });
  await ensureOk(response, 'Failed to rename workspace');
  return response.json();
}

export async function deleteWorkspace(accessToken: string, slug: string): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/chat/workspaces/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
    headers: getAuthHeaders(accessToken),
  });
  await ensureOk(response, 'Failed to delete workspace');
}

export async function fetchSessions(accessToken: string, workspaceSlug: string): Promise<ChatSession[]> {
  const response = await fetch(`${apiBaseUrl}/api/chat/sessions?workspaceSlug=${encodeURIComponent(workspaceSlug)}`, {
    headers: getAuthHeaders(accessToken),
  });
  await ensureOk(response, 'Failed to fetch sessions');
  const data = await response.json();
  return data.items || [];
}

export async function createSession(
  accessToken: string,
  workspaceSlug: string,
  title?: string
): Promise<ChatSession> {
  const response = await fetch(`${apiBaseUrl}/api/chat/sessions`, {
    method: 'POST',
    headers: getAuthHeaders(accessToken),
    body: JSON.stringify({
      workspaceSlug,
      title,
    }),
  });
  await ensureOk(response, 'Failed to create session');
  return response.json();
}

export async function fetchSessionMessages(accessToken: string, sessionId: string): Promise<ChatMessage[]> {
  const response = await fetch(`${apiBaseUrl}/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`, {
    headers: getAuthHeaders(accessToken),
  });
  await ensureOk(response, 'Failed to fetch messages');
  const data = await response.json();
  return data.items || [];
}

export async function renameSession(
  accessToken: string,
  sessionId: string,
  title: string
): Promise<ChatSession> {
  const response = await fetch(`${apiBaseUrl}/api/chat/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    headers: getAuthHeaders(accessToken),
    body: JSON.stringify({ title }),
  });
  await ensureOk(response, 'Failed to rename session');
  return response.json();
}

export async function deleteSession(accessToken: string, sessionId: string): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/chat/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    headers: getAuthHeaders(accessToken),
  });
  await ensureOk(response, 'Failed to delete session');
}

export async function sendChatMessage(
  accessToken: string,
  payload: {
    message: string;
    sessionId?: string;
    workspaceSlug: string;
  }
): Promise<{
  answer: string;
  sessionId: string;
  workspaceSlug: string;
  sources: unknown[];
}> {
  const response = await fetch(`${apiBaseUrl}/api/chat`, {
    method: 'POST',
    headers: getAuthHeaders(accessToken),
    body: JSON.stringify(payload),
  });
  await ensureOk(response, 'Failed to send message');
  return response.json();
}

export type StreamChatCallbacks = {
  onSession: (sessionId: string, workspaceSlug: string) => void;
  onToken: (token: string) => void;
  onDone: (answer: string, sources: unknown[]) => void;
  onError: (error: string, status?: number) => void;
  onToolUse?: (tool: string, status: 'start' | 'done') => void;
};

export function streamChatMessage(
  accessToken: string,
  payload: {
    message: string;
    sessionId?: string;
    workspaceSlug: string;
  },
  callbacks: StreamChatCallbacks,
  abortSignal?: AbortSignal
): void {
  const url = `${apiBaseUrl}/api/chat/stream`;

  fetch(url, {
    method: 'POST',
    headers: getAuthHeaders(accessToken),
    body: JSON.stringify(payload),
    signal: abortSignal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        callbacks.onError(errorData.message || `HTTP ${response.status}`, response.status);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        callbacks.onError('No response body');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last incomplete line in buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const data = JSON.parse(jsonStr);

            switch (data.type) {
              case 'session':
                callbacks.onSession(data.sessionId, data.workspaceSlug);
                break;
              case 'tool':
                callbacks.onToolUse?.(data.tool, data.status);
                break;
              case 'token':
                callbacks.onToken(data.token);
                break;
              case 'done':
                callbacks.onDone(data.answer, data.sources || []);
                break;
              case 'error':
                callbacks.onError(data.message);
                break;
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }

      // Process any remaining buffer
      if (buffer.startsWith('data: ')) {
        const jsonStr = buffer.slice(6).trim();
        if (jsonStr) {
          try {
            const data = JSON.parse(jsonStr);
            if (data.type === 'done') {
              callbacks.onDone(data.answer, data.sources || []);
            } else if (data.type === 'token') {
              callbacks.onToken(data.token);
            }
          } catch {
            // Skip
          }
        }
      }
    })
    .catch((error) => {
      if (error.name === 'AbortError') return;
      callbacks.onError(error.message || 'Network error');
    });
}
