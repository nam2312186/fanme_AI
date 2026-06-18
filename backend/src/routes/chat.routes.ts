import { Router, Response } from 'express';
import { z } from 'zod';
import { askAnythingLLM, streamAnythingLLM } from '../services/anythingllm.service.js';
import { prisma } from '../lib/prisma.js';
import { requireLogtoAuth, AuthenticatedRequest } from '../middlewares/logto-auth.middleware.js';
import { getDefaultWorkspaceSlug, normalizeWorkspaceSlug } from '../config/workspaces.js';

export const chatRouter = Router();
const CHAT_INTERNAL_SCOPES = ['chat:internal'];

function singleQueryValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }

  return undefined;
}

function canUseWorkspace(workspace: { logtoUserId: string | null }, logtoUserId: string): boolean {
  return workspace.logtoUserId === null || workspace.logtoUserId === logtoUserId;
}

function touchSession(sessionId: string): void {
  prisma.chatSession.update({
    where: { id: sessionId },
    data: { updatedAt: new Date() },
  }).catch((error) => console.error('[ChatSession] Failed to touch session:', error));
}

// GET /api/chat/workspaces - List shared + user's own workspaces
chatRouter.get('/workspaces', requireLogtoAuth(), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const logtoUserId = req.auth?.sub;
  if (!logtoUserId) { res.status(401).json({ message: 'Unauthorized' }); return; }

  try {
    const items = await prisma.workspace.findMany({
      where: {
        OR: [
          { logtoUserId: null },
          { logtoUserId },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ items });
  } catch (error) {
    console.error('Error listing workspaces:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// POST /api/chat/workspaces - Create private workspace for user
chatRouter.post('/workspaces', requireLogtoAuth(), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const logtoUserId = req.auth?.sub;
  if (!logtoUserId) { res.status(401).json({ message: 'Unauthorized' }); return; }

  try {
    const schema = z.object({
      name: z.string().trim().min(1).max(100),
    });

    const parsed = schema.parse(req.body);
    const baseSlug = normalizeWorkspaceSlug(parsed.name);

    if (!baseSlug) {
      res.status(400).json({ message: 'Tên workspace không hợp lệ' });
      return;
    }

    // Make slug unique per user by appending short userId hash
    const slug = `${baseSlug}-${logtoUserId.slice(-6)}`;

    const existing = await prisma.workspace.findUnique({ where: { slug } });
    if (existing) {
      res.status(409).json({ message: 'Workspace đã tồn tại' });
      return;
    }

    const created = await prisma.workspace.create({
      data: {
        slug,
        name: parsed.name,
        logtoUserId,
      },
    });

    res.status(201).json(created);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: 'Dữ liệu không hợp lệ' });
      return;
    }

    console.error('Error creating workspace:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// PATCH /api/chat/workspaces/:slug - Rename workspace (only user's own)
chatRouter.patch('/workspaces/:slug', requireLogtoAuth(), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const logtoUserId = req.auth?.sub;
  if (!logtoUserId) { res.status(401).json({ message: 'Unauthorized' }); return; }

  try {
    const slug = singleQueryValue(req.params.slug);
    const schema = z.object({
      name: z.string().trim().min(1).max(100),
    });

    const parsed = schema.parse(req.body);

    const workspace = await prisma.workspace.findUnique({ where: { slug } });
    if (!workspace) {
      res.status(404).json({ message: 'Không tìm thấy workspace' });
      return;
    }

    // Cannot rename shared/default workspaces
    if (!workspace.logtoUserId) {
      res.status(403).json({ message: 'Không thể đổi tên workspace mặc định' });
      return;
    }

    // Can only rename own workspaces
    if (workspace.logtoUserId !== logtoUserId) {
      res.status(403).json({ message: 'Không có quyền đổi tên workspace này' });
      return;
    }

    const updated = await prisma.workspace.update({
      where: { slug },
      data: { name: parsed.name },
    });

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: 'Dữ liệu không hợp lệ' });
      return;
    }

    console.error('Error renaming workspace:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// DELETE /api/chat/workspaces/:slug - Delete workspace (only user's own)
chatRouter.delete('/workspaces/:slug', requireLogtoAuth(), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const logtoUserId = req.auth?.sub;
  if (!logtoUserId) { res.status(401).json({ message: 'Unauthorized' }); return; }

  try {
    const slug = singleQueryValue(req.params.slug);

    const workspace = await prisma.workspace.findUnique({ where: { slug } });
    if (!workspace) {
      res.status(404).json({ message: 'Không tìm thấy workspace' });
      return;
    }

    // Cannot delete shared/default workspaces
    if (!workspace.logtoUserId) {
      res.status(403).json({ message: 'Không thể xóa workspace mặc định' });
      return;
    }

    // Can only delete own workspaces
    if (workspace.logtoUserId !== logtoUserId) {
      res.status(403).json({ message: 'Không có quyền xóa workspace này' });
      return;
    }

    await prisma.chatSession.updateMany({
      where: { workspaceSlug: slug },
      data: { workspaceSlug: getDefaultWorkspaceSlug() },
    });

    await prisma.workspace.delete({ where: { slug } });

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting workspace:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// POST /api/chat/sessions - Create a new chat session
chatRouter.post('/sessions', requireLogtoAuth(CHAT_INTERNAL_SCOPES), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const logtoUserId = req.auth?.sub;
  if (!logtoUserId) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  try {
    const { workspaceSlug, title } = req.body;
    const slug = workspaceSlug || getDefaultWorkspaceSlug();

    const workspace = await prisma.workspace.findUnique({ where: { slug } });
    if (!workspace) {
      res.status(400).json({ message: 'Invalid workspace slug' });
      return;
    }
    if (!canUseWorkspace(workspace, logtoUserId)) {
      res.status(403).json({ message: 'Forbidden' });
      return;
    }

    const session = await prisma.chatSession.create({
      data: {
        logtoUserId,
        workspaceSlug: slug,
        title: (title || 'Đoạn chat mới').substring(0, 100),
      },
    });

    res.json(session);
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// GET /api/chat/sessions - List sessions for a workspace
chatRouter.get('/sessions', requireLogtoAuth(CHAT_INTERNAL_SCOPES), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const logtoUserId = req.auth?.sub;
  if (!logtoUserId) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  try {
    const workspaceSlug = singleQueryValue(req.query.workspaceSlug as unknown);
    const slug = workspaceSlug || getDefaultWorkspaceSlug();

    const workspace = await prisma.workspace.findUnique({ where: { slug } });

    if (!workspace) {
      res.status(400).json({ message: 'Invalid workspace slug' });
      return;
    }
    if (!canUseWorkspace(workspace, logtoUserId)) {
      res.status(403).json({ message: 'Forbidden' });
      return;
    }

    const sessions = await prisma.chatSession.findMany({
      where: {
        logtoUserId,
        workspaceSlug: slug,
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        workspaceSlug: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { messages: true },
        },
      },
    });

    const items = sessions.map((session) => ({
      id: session.id,
      title: session.title,
      workspaceSlug: session.workspaceSlug,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session._count.messages,
    }));

    res.json({ items });
  } catch (error) {
    console.error('Error listing sessions:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// GET /api/chat/sessions/:sessionId/messages - Get messages in a session
chatRouter.get(
  '/sessions/:sessionId/messages',
  requireLogtoAuth(CHAT_INTERNAL_SCOPES),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const logtoUserId = req.auth?.sub;
    const sessionId = singleQueryValue(req.params.sessionId);

    if (!logtoUserId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    try {
      const session = await prisma.chatSession.findUnique({
        where: { id: sessionId },
      });

      if (!session || session.logtoUserId !== logtoUserId) {
        res.status(403).json({ message: 'Forbidden' });
        return;
      }

      const messages = await prisma.chatMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
      });

      res.json({
        session,
        items: messages,
      });
    } catch (error) {
      console.error('Error getting messages:', error);
      res.status(500).json({ message: 'Lỗi server' });
    }
  }
);

// PATCH /api/chat/sessions/:sessionId - Rename a session
chatRouter.patch(
  '/sessions/:sessionId',
  requireLogtoAuth(CHAT_INTERNAL_SCOPES),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const logtoUserId = req.auth?.sub;
    const sessionId = singleQueryValue(req.params.sessionId);
    const { title } = req.body;

    if (!logtoUserId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    try {
      const session = await prisma.chatSession.findUnique({
        where: { id: sessionId },
      });

      if (!session || session.logtoUserId !== logtoUserId) {
        res.status(403).json({ message: 'Forbidden' });
        return;
      }

      if (!title || typeof title !== 'string' || !title.trim()) {
        res.status(400).json({ message: 'Title không được rỗng' });
        return;
      }

      const newTitle = title.trim().substring(0, 100);

      const updatedSession = await prisma.chatSession.update({
        where: { id: sessionId },
        data: { title: newTitle },
      });

      res.json(updatedSession);
    } catch (error) {
      console.error('Error updating session:', error);
      res.status(500).json({ message: 'Lỗi server' });
    }
  }
);

// DELETE /api/chat/sessions/:sessionId - Delete a session
chatRouter.delete(
  '/sessions/:sessionId',
  requireLogtoAuth(CHAT_INTERNAL_SCOPES),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const logtoUserId = req.auth?.sub;
    const sessionId = singleQueryValue(req.params.sessionId);

    if (!logtoUserId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    try {
      const session = await prisma.chatSession.findUnique({
        where: { id: sessionId },
      });

      if (!session || session.logtoUserId !== logtoUserId) {
        res.status(403).json({ message: 'Forbidden' });
        return;
      }

      await prisma.chatSession.delete({
        where: { id: sessionId },
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting session:', error);
      res.status(500).json({ message: 'Lỗi server' });
    }
  }
);

// POST /api/chat - Send a chat message (non-streaming fallback)
chatRouter.post('/', requireLogtoAuth(CHAT_INTERNAL_SCOPES), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const logtoUserId = req.auth?.sub;
  if (!logtoUserId) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const { message, sessionId: rawSessionId, workspaceSlug: rawWorkspaceSlug } = req.body as { message: string; sessionId?: unknown; workspaceSlug?: unknown };

  const sessionId = typeof rawSessionId === 'string' && rawSessionId.trim() ? rawSessionId : undefined;
  const requestedWorkspaceSlug = typeof rawWorkspaceSlug === 'string' && rawWorkspaceSlug.trim() ? rawWorkspaceSlug : undefined;

  if (!message || typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ error: 'BAD_REQUEST', message: 'Message không được rỗng.' });
    return;
  }

  try {
    let session;
    let finalWorkspaceSlug = requestedWorkspaceSlug || getDefaultWorkspaceSlug();
    let workspaceUsed = finalWorkspaceSlug;

    if (sessionId) {
      session = await prisma.chatSession.findUnique({
        where: { id: sessionId },
      });

      if (!session || session.logtoUserId !== logtoUserId) {
        res.status(403).json({ message: 'Forbidden' });
        return;
      }

      finalWorkspaceSlug = session.workspaceSlug;
      workspaceUsed = finalWorkspaceSlug;
    } else {
      const workspace = await prisma.workspace.findUnique({ where: { slug: finalWorkspaceSlug } });

      if (!workspace) {
        res.status(400).json({ message: 'Invalid workspace slug' });
        return;
      }
      if (!canUseWorkspace(workspace, logtoUserId)) {
        res.status(403).json({ message: 'Forbidden' });
        return;
      }

      session = await prisma.chatSession.create({
        data: {
          logtoUserId,
          workspaceSlug: finalWorkspaceSlug,
          title: message.trim().substring(0, 100),
        },
      });
    }

    // Save user message in parallel with LLM call
    const [, result] = await Promise.all([
      prisma.chatMessage.create({
        data: {
          sessionId: session.id,
          role: 'user',
          content: message.trim(),
        },
      }),
      askAnythingLLM({
        message: message.trim(),
        sessionId: session.id,
        workspaceSlug: finalWorkspaceSlug,
      }),
    ]);

    const assistantMessage = await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'assistant',
        content: result.answer,
      },
    });
    touchSession(session.id);

    res.json({
      answer: result.answer,
      sessionId: session.id,
      workspaceSlug: workspaceUsed,
      workspaceRequested: requestedWorkspaceSlug || finalWorkspaceSlug,
      assistantMessage,
      sources: result.sources || [],
    });
  } catch (error) {
    const err = error as Error;
    console.error('[POST /api/chat] error:', err.message);

    res.status(502).json({
      error: 'ANYTHINGLLM_ERROR',
      message: 'Hiện tại trợ lý chưa thể phản hồi.',
      detail: err.message,
    });
  }
});

// POST /api/chat/stream - SSE streaming chat endpoint
chatRouter.post('/stream', requireLogtoAuth(CHAT_INTERNAL_SCOPES), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const logtoUserId = req.auth?.sub;
  if (!logtoUserId) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const { message, sessionId: rawSessionId, workspaceSlug: rawWorkspaceSlug } = req.body as { message: string; sessionId?: unknown; workspaceSlug?: unknown };

  const sessionId = typeof rawSessionId === 'string' && rawSessionId.trim() ? rawSessionId : undefined;
  const requestedWorkspaceSlug = typeof rawWorkspaceSlug === 'string' && rawWorkspaceSlug.trim() ? rawWorkspaceSlug : undefined;

  if (!message || typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ error: 'BAD_REQUEST', message: 'Message không được rỗng.' });
    return;
  }

  console.log(`[POST /api/chat/stream] user=${logtoUserId}, message="${message.trim().substring(0, 50)}..."`);

  try {
    let session;
    let finalWorkspaceSlug = requestedWorkspaceSlug || getDefaultWorkspaceSlug();

    if (sessionId) {
      session = await prisma.chatSession.findUnique({
        where: { id: sessionId },
      });

      if (!session || session.logtoUserId !== logtoUserId) {
        res.status(403).json({ message: 'Forbidden' });
        return;
      }

      finalWorkspaceSlug = session.workspaceSlug;
    } else {
      const workspace = await prisma.workspace.findUnique({ where: { slug: finalWorkspaceSlug } });

      if (!workspace) {
        res.status(400).json({ message: 'Invalid workspace slug' });
        return;
      }
      if (!canUseWorkspace(workspace, logtoUserId)) {
        res.status(403).json({ message: 'Forbidden' });
        return;
      }

      session = await prisma.chatSession.create({
        data: {
          logtoUserId,
          workspaceSlug: finalWorkspaceSlug,
          title: message.trim().substring(0, 100),
        },
      });
    }

    // Save user message (non-blocking, don't wait)
    prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'user',
        content: message.trim(),
      },
    }).then(() => touchSession(session!.id)).catch((err) => console.error('[Stream] Failed to save user message:', err));

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send session info immediately so frontend knows the sessionId
    res.write(`data: ${JSON.stringify({ type: 'session', sessionId: session.id, workspaceSlug: finalWorkspaceSlug })}\n\n`);

    const abortController = new AbortController();

    // Handle client disconnect — abort AnythingLLM request immediately
    req.on('close', () => {
      console.log('[Stream] Client disconnected, aborting AnythingLLM request');
      abortController.abort();
    });

    await streamAnythingLLM(
      {
        message: message.trim(),
        sessionId: session.id,
        workspaceSlug: finalWorkspaceSlug,
      },
      {
        onToolUse(tool, status) {
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: 'tool', tool, status })}\n\n`);
          }
        },
        onToken(token) {
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: 'token', token })}\n\n`);
          }
        },
        onDone(fullText, sources) {
          // Save assistant message to DB
          prisma.chatMessage.create({
            data: {
              sessionId: session!.id,
              role: 'assistant',
              content: fullText,
            },
          }).then(() => touchSession(session!.id)).catch((err) => console.error('[Stream] Failed to save assistant message:', err));

          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: 'done', answer: fullText, sources })}\n\n`);
            res.end();
          }
        },
        onError(error) {
          console.error('[POST /api/chat/stream] error:', error.message);
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
            res.end();
          }
        },
      },
      abortController
    );

    // If stream finished without calling onDone/onError (edge case)
    if (!res.writableEnded) {
      res.end();
    }
  } catch (error) {
    const err = error as Error;
    console.error('[POST /api/chat/stream] error:', err.message);

    if (!res.headersSent) {
      res.status(502).json({
        error: 'ANYTHINGLLM_ERROR',
        message: 'Hiện tại trợ lý chưa thể phản hồi.',
        detail: err.message,
      });
    } else if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    }
  }
});
