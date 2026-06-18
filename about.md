# FanMe Chatbot - System Architecture & Audit Report

**Last Updated:** May 7, 2026  
**Status:** Architecture Review Complete

---

## 1. Tổng Quan Hệ Thống

### Kiến Trúc Tổng Thể

FanMe Chatbot là ứng dụng chat hybrid giữa Frontend React và Backend Node.js, tích hợp AnythingLLM làm backbone AI:

```
Frontend (React + Vite) 
    ↓ (POST /api/chat)
Backend (Express + Prisma SQLite) 
    ↓ (POST /api/v1/workspace/internal/chat)
AnythingLLM (192.168.0.181:3001) 
    ↓ Response
Backend: cleanAnswer() 
    ↓
Frontend: Render + Auto-scroll
```

### Công Nghệ Stack

- **Frontend:** React 18, TypeScript, Vite, Logto (Authentication)
- **Backend:** Node.js/Express, TypeScript, Prisma ORM, SQLite
- **External:** AnythingLLM (http://192.168.0.181:3001)
- **Auth:** Logto (OIDC, JWT Bearer tokens)

---

## 2. Luồng Xử Lý Request

### Từ lúc User gửi tin nhắn đến nhận response:

1. **Frontend (App.tsx:sendMessage())**
   - User nhấn Enter → `handleSubmit()` trigger
   - Append user message vào state
   - Gọi `scrollToBottom()` với double requestAnimationFrame
   - POST `/api/chat` với Logto access token

2. **Backend Auth (logto-auth.middleware.ts:requireLogtoAuth)**
   - Verify Bearer token từ header
   - Extract JWT payload → `logtoUserId`
   - Nếu token invalid → 401 Unauthorized

3. **Backend Processing (chat.routes.ts:POST /api/chat)**
   - Validate message không rỗng
   - Nếu `sessionId` tồn tại: fetch từ DB
   - Nếu không: create new session với `workspaceSlug`
   - Lưu user message → `ChatMessage` table
   - Gọi `askAnythingLLM()`

4. **AnythingLLM Call (anythingllm.service.ts:askAnythingLLM)**
   - **Workspace: LUÔN 'internal'** (hardcoded, không tùy chỉnh)
   - POST `/api/v1/workspace/internal/chat`
   - Auth: `Bearer {ANYTHINGLLM_API_KEY}`
   - Payload: `{ message, mode: 'chat', sessionId }`

5. **Response Processing (cleanAnswer)**
   - Parse response: textResponse → response → answer → message → rawText
   - Loại bỏ: `<think>`, `**bold**`, `##headings`, meta-text (English)
   - Collapse multiple newlines

6. **Backend Response**
   - Lưu assistant message → DB
   - Return: `{ answer, sessionId, workspaceSlug, sources }`

7. **Frontend Render**
   - Append assistant message vào state
   - Gọi `scrollToBottom()` smooth scroll
   - Render ChatMessage component

---

## 3. Cấu Hình & Environment Variables

### Backend (.env)
```env
PORT=8080
ANYTHINGLLM_API_KEY="42NH7GG-RMGMFR1-JPK5CKW-J0VKNW1"
ANYTHINGLLM_BASE_URL="http://192.168.0.181:3001"
ANYTHINGLLM_WORKSPACE_SLUG="internal"
ANYTHINGLLM_CHAT_ENDPOINT="/api/v1/workspace/{slug}/chat"
ANYTHINGLLM_CHAT_MODE="chat"
ANYTHINGLLM_TIMEOUT_MS="500000"  # 500 seconds
FRONTEND_ORIGINS="https://localhost:5173,https://192.168.0.181:5173"
DATABASE_URL="file:./dev.db"
LOGTO_ENDPOINT="https://o5rihz.logto.app/"
LOGTO_API_RESOURCE="https://fanme-chat-api"
```

### Frontend (.env.example)
```env
VITE_API_BASE_URL=http://localhost:8080
VITE_LOGTO_ENDPOINT=https://o5rihz.logto.app/
VITE_LOGTO_APP_ID=v0xrv4syomeqqzrn69i3v
VITE_LOGTO_API_RESOURCE=https://fanme-chat-api
```

---

## 4. Database Schema

### Models (Prisma)

```prisma
model ChatSession {
  id              String        @id @default(uuid())
  logtoUserId     String        # User ID từ Logto
  workspaceSlug   String        # Workspace label (UI only)
  title           String?       # Session title
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  messages        ChatMessage[]
}

model Workspace {
  slug            String        @id  # Primary key
  name            String        # Display name
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
}

model ChatMessage {
  id              String        @id @default(uuid())
  sessionId       String
  role            String        # "user" | "assistant"
  content         String        # Message text
  createdAt       DateTime      @default(now())
  session         ChatSession   @relation(fields: [sessionId], references: [id], onDelete: Cascade)
}
```

### Default Workspaces (workspaces.ts)
```
- internal: "Không gian chung" (default)
- hr: "Nhân Sự (HR)"
- it: "Công Nghệ (IT)"
```

---

## 5. API Endpoints

| Method | Endpoint | Auth | Chức năng |
|--------|----------|------|----------|
| POST | /api/chat | JWT | Gửi tin nhắn |
| GET | /api/chat/workspaces | JWT | Danh sách workspaces |
| POST | /api/chat/workspaces | JWT | Tạo workspace |
| PATCH | /api/chat/workspaces/:slug | JWT | Đổi tên workspace |
| DELETE | /api/chat/workspaces/:slug | JWT | Xóa workspace |
| POST | /api/chat/sessions | JWT | Tạo session |
| GET | /api/chat/sessions?workspaceSlug=X | JWT | Danh sách sessions |
| GET | /api/chat/sessions/:id/messages | JWT | Lịch sử chat |
| PATCH | /api/chat/sessions/:id | JWT | Đổi tên session |
| DELETE | /api/chat/sessions/:id | JWT | Xóa session |

---

## 6. Đặc Điểm Chính

### ✅ Những gì hiện có

1. **Multi-workspace support** trong UI (internal, hr, it)
2. **Session-based chat history** với DB persistence
3. **Response cleaning** - loại bỏ thinking traces, formatting
4. **Logto authentication** - employee login required
5. **Auto-scroll UI** - scroll to bottom on Enter
6. **Workspace CRUD** - create/rename/delete workspaces

### ❌ Những gì KHÔNG có

1. **System prompt** - không được gửi tất cả requests
2. **Domain guardrails** - không filter câu hỏi ngoài phạm vi FanMe
3. **Order lookup** - không có logic tra cứu đơn hàng
4. **Tool/Agent calling** - không dùng AnythingLLM agent mode
5. **Sensitive filtering** - hàm `isSensitiveQuestion()` import nhưng không dùng
6. **Intent detection** - không detect loại câu hỏi
7. **Workspace-specific knowledge** - luôn gọi workspace 'internal'

---

## 7. AnythingLLM Integration Details

### Payload Structure
```typescript
type AskAnythingLLMInput = {
  message: string;           // User message
  sessionId?: string;        // Optional session ID
  workspaceSlug?: string;    // NOT USED - always 'internal'
};
```

### Response Parsing
```typescript
// Try fields in order:
answer = data.textResponse ?? 
         data.response ?? 
         data.answer ?? 
         data.message ?? 
         data.rawText
```

### Workspace Behavior
- **User selects workspace in UI** → only affects DB session.workspaceSlug
- **All AnythingLLM calls** → always use 'internal' workspace
- **Implication:** FanMe UI workspaces are just organization labels, not actual workspace switching

---

## 8. Response Post-Processing

### cleanAnswer() Logic (anythingllm.service.ts)

```
Input: Response từ AnythingLLM
  ↓
1. Remove <think>...</think> blocks
2. Remove stray <think> </think> tags
3. Remove bold markers (**)
4. Remove heading markers (##, ###, ###)
5. Remove English meta-text lines:
   - "The user is asking..."
   - "This is a general question..."
   - "Looking at the context..."
   - "From CONTEXT..."
   - "I can see..." / "I should..." / "I need to..."
   - "Based on the context..."
6. Collapse multiple newlines (\n{3,} → \n\n)
  ↓
Output: Cleaned response
```

---

## 9. Frontend Components

| Component | File | Chức năng |
|-----------|------|----------|
| App | src/App.tsx | Main app, state management, chat logic |
| Sidebar | src/components/Sidebar.tsx | Workspaces, sessions list, new chat |
| ChatMessage | src/components/ChatMessage.tsx | Render user/assistant messages |
| SuggestedQuestions | src/components/SuggestedQuestions.tsx | Suggested prompts |

### Key Hooks
- `useLogto()` - Authentication from @logto/react
- `useRef()` - messagesContainerRef for scroll target
- `useEffect()` - Fetch workspaces, sessions, messages on mount/change
- `useCallback()` - Handler functions

---

## 10. Backend Services

| File | Chức năng |
|------|----------|
| index.ts | Bootstrap server, seed DEFAULT_WORKSPACES |
| routes/chat.routes.ts | All API endpoints |
| services/anythingllm.service.ts | AnythingLLM API call + response cleaning |
| middlewares/logto-auth.middleware.ts | JWT verification |
| config/workspaces.ts | DEFAULT_WORKSPACES, slug normalization |
| lib/prisma.ts | Prisma client export |

---

## 11. Sensitive Question Detection

### Current Status: **INACTIVE**

**File:** 
- `frontend/src/utils/sensitivity.ts`
- `backend/src/utils/sensitivity.ts`

**Keywords:**
```
'đơn hàng', 'mã đơn', 'khách hàng', 'số điện thoại', 'địa chỉ',
'doanh thu', 'báo cáo', 'tồn kho', 'số lượng còn', 'nhân viên',
'lương', 'nội bộ', 'api key', 'database', 'cơ sở dữ liệu'
```

**Status:** Imported in App.tsx but **NOT USED** in sendMessage flow

**To activate:**
1. Add check in backend `chat.routes.ts` POST /api/chat
2. Log sensitive questions or add response filtering

---

## 12. Key Differences: FanMe vs AnythingLLM Direct

| Factor | FanMe | AnythingLLM UI | Impact |
|--------|-------|----------------|--------|
| Workspace | Always 'internal' | User selectable | Medium - if docs differ |
| Session ID | FanMe DB UUID | AnythingLLM managed | Low |
| History | DB persistence | AnythingLLM thread | Medium - reset behavior |
| Post-process | cleanAnswer() active | None | High - format differs |
| System prompt | Not sent | May be configured | High - behavior differs |
| Auth | FanMe API key | AnythingLLM auth | Low |

**Main Reason for Different Responses:**
1. **Response cleaning** removes thinking/formatting
2. **System prompt** in AnythingLLM workspace may differ

---

## 13. Known Limitations

1. **No domain restriction** - will answer ANY question AnythingLLM answers
2. **Workspace isolation** - all workspaces hit same AnythingLLM workspace
3. **No custom system prompt** - relies on AnythingLLM workspace config
4. **No tool calling** - basic chat mode only
5. **No order integration** - cannot look up customer orders
6. **Timeout is long** - 500 seconds (should be 30-60s in production)

---

## 14. To Deploy to Production

1. Update `.env` with production AnythingLLM URL/key
2. Set `DATABASE_URL` to production SQLite or PostgreSQL
3. Update `FRONTEND_ORIGINS` to production domains
4. Update Logto `LOGTO_ENDPOINT` if using different tenant
5. Run `npm run build` on frontend
6. Run backend on production server (PORT 8080)
7. Set up reverse proxy (nginx) with SSL
8. Seed databases with initial workspaces

---

## 15. To Activate FanMe-Only Mode

### Option 1: Backend System Prompt
```typescript
// In anythingllm.service.ts, modify payload:
body: JSON.stringify({
  message: input.message,
  mode,
  sessionId: input.sessionId,
  systemPrompt: "You are FanMe assistant. Only answer questions about FanMe company..."
})
```

### Option 2: Response Filtering
```typescript
// In chat.routes.ts POST /api/chat:
const result = await askAnythingLLM(...);
// Add check to see if response is off-topic
if (isOffTopic(result.answer)) {
  result.answer = "Xin lỗi, tôi chỉ được trả lời câu hỏi về FanMe.";
}
```

### Option 3: Activate Sensitive Question Filter
```typescript
// In sendMessage():
if (isSensitiveQuestion(message)) {
  // Block or warn user
}
```

---

## 16. Repository Structure

```
fanme-chat/
├── README.md
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── dev.db
│   └── src/
│       ├── index.ts
│       ├── routes/chat.routes.ts
│       ├── services/anythingllm.service.ts
│       ├── middlewares/logto-auth.middleware.ts
│       ├── config/workspaces.ts
│       ├── utils/sensitivity.ts
│       └── lib/prisma.ts
├── frontend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── .env.example
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── App.css
│       ├── types.ts
│       ├── services/chatApi.ts
│       ├── utils/sensitivity.ts
│       ├── components/
│       │   ├── ChatMessage.tsx
│       │   ├── Sidebar.tsx
│       │   └── SuggestedQuestions.tsx
│       └── assets/logo.png
└── about.md (this file)
```

---

## 17. Recent Changes (May 2026)

1. ✅ Added auto-scroll to bottom on Enter key
2. ✅ Added multi-workspace UI support
3. ✅ Added Workspace CRUD (create/rename/delete)
4. ✅ Fixed TypeScript type errors in routes
5. ✅ Prisma migration: added Workspace model
6. ✅ Backend seed: default workspaces on startup

---

## 18. Next Recommended Steps

1. **Activate domain guardrails** - system prompt or response filtering
2. **Reduce timeout** - from 500s to 30-60s production
3. **Add monitoring** - log all requests/responses for audit
4. **Test multi-workspace** - verify workspace switching works end-to-end
5. **Performance test** - load test with multiple concurrent users
6. **Security audit** - verify Logto integration, token validation

---

**Document Version:** 1.0  
**Audit Date:** May 7, 2026  
**Auditor:** Code Analysis Agent  
**Status:** Ready for Review
