# FanMe AI - Chatbot Nội Bộ

Chatbot AI nội bộ FanMe tích hợp Logto Authentication, AnythingLLM Backend, và Database Prisma + SQLite để lưu trữ lịch sử chat theo user và workspace.

## 🎯 Tính Năng Chính

- ✅ Đăng nhập Logto OAuth
- ✅ Quản lý Workspace (DỰ ÁN)
- ✅ Lịch sử chat riêng biệt theo workspace
- ✅ Tạo, đổi tên, xóa đoạn chat
- ✅ Gọi AnythingLLM API (chat mode)
- ✅ Database Prisma + SQLite
- ✅ HTTPS trên LAN via internal domain/certificate hoặc basic-ssl fallback

## 🚀 Cài Đặt & Chạy

### 1. Backend

```bash
cd backend

# Cài đặt dependencies
npm install

# Generate Prisma Client
npx prisma generate

# Reset DB (nếu cần)
npx prisma migrate reset

# Chạy dev server
npm run dev
```

**Backend chạy tại:** `http://0.0.0.0:8080`

### 2. Frontend

```bash
cd frontend

# Cài đặt dependencies
npm install

# Chạy dev server (HTTPS via internal cert hoặc basic-ssl fallback)
npm run dev
```

**Frontend chạy tại:**
- `https://chatbot.fanme.internal:5173` (khuyến nghị cho nội bộ)
- `https://localhost:5173`
- `https://192.168.0.181:5173` (hoặc IP máy của bạn)

### 3. Internal domain + SSL/TLS certificate

Để không dùng IP trên LAN, dùng domain nội bộ `chatbot.fanme.internal`:

```bash
# Tạo internal CA + certificate cho chatbot.fanme.internal
./scripts/generate-internal-cert.sh chatbot.fanme.internal
```

Sau đó trỏ domain về máy chạy frontend bằng DNS nội bộ, hoặc thêm vào
`/etc/hosts` trên từng máy client:

```text
192.168.0.181 chatbot.fanme.internal
```

Trust CA certificate trên các máy sẽ mở chatbot:

```text
frontend/certs/fanme-internal-ca.crt.pem
```

Vite sẽ tự dùng certificate trong `frontend/certs` nếu tồn tại. Nếu chưa có
cert, Vite vẫn fallback sang `@vitejs/plugin-basic-ssl`.

## ⚙️ Cấu Hình

### Backend `.env` (backend/.env)

```env
PORT=8080
ANYTHINGLLM_API_KEY=your_api_key
ANYTHINGLLM_BASE_URL=http://192.168.0.181:3001
ANYTHINGLLM_WORKSPACE_SLUG=internal
ANYTHINGLLM_CHAT_ENDPOINT=/api/v1/workspace/{slug}/chat
ANYTHINGLLM_CHAT_MODE=chat
ANYTHINGLLM_TIMEOUT_MS=60000

FRONTEND_ORIGINS=https://localhost:5173,https://192.168.0.181:5173,https://chatbot.fanme.internal:5173
DATABASE_URL=file:./dev.db

LOGTO_ENDPOINT=https://o5rihz.logto.app/
LOGTO_API_RESOURCE=https://fanme-chat-api
```

### Frontend `.env` (frontend/.env)

```env
VITE_API_BASE_URL=
DEV_PUBLIC_HOST=chatbot.fanme.internal
DEV_TLS_CERT_FILE=certs/chatbot.fanme.internal.crt.pem
DEV_TLS_KEY_FILE=certs/chatbot.fanme.internal.key.pem
VITE_LOGTO_ENDPOINT=https://o5rihz.logto.app/
VITE_LOGTO_APP_ID=v0xrv4syomeqqzrn69i3v
VITE_LOGTO_API_RESOURCE=https://fanme-chat-api
```

**Lưu ý:** 
- `VITE_API_BASE_URL` để trống vì Frontend dùng Vite Proxy để gọi `/api/*` → `http://localhost:8080/api/*`
- Không hard-code IP trong code

### Logto Console Redirect URIs

Thêm vào Logto Console (Application > Redirect URIs):
```
https://chatbot.fanme.internal:5173/callback
https://localhost:5173/callback
https://192.168.0.181:5173/callback
```

Post sign-out redirect URIs:
```
https://chatbot.fanme.internal:5173
https://localhost:5173
https://192.168.0.181:5173
```

## 📁 Cấu Trúc Workspace

Backend đang hỗ trợ 3 workspace:

1. **internal** - Không gian chung
2. **hr** - Nhân Sự (HR)
3. **it** - Công Nghệ (IT)

Để thêm workspace mới:
1. Cập nhật `backend/src/config/workspaces.ts`
2. Tạo workspace tương ứng trong AnythingLLM

## 🤖 AnythingLLM Workspace Prompt

Bạn muốn chat thay đổi hành vi AI, hãy vào AnythingLLM Console và cập nhật **Workspace Prompt** trong workspace `internal`:

```
Bạn là trợ lý AI nội bộ của FanMe.
Luôn trả lời bằng tiếng Việt.
Khi người dùng hỏi "bạn là ai", hãy trả lời rằng bạn là trợ lý AI nội bộ của FanMe, hỗ trợ tra cứu thông tin dựa trên tài liệu và công cụ liên quan đến FanMe.
Không hiển thị quá trình suy luận.
Không xuất thẻ <think>.
Nếu tài liệu không có thông tin, hãy nói rõ là tài liệu nội bộ chưa có thông tin này.
Trả lời ngắn gọn, rõ ràng, dễ đọc.
```

**Lưu ý:** Backend không còn bọc prompt dài nữa. Tất cả hành vi được điều khiển từ AnythingLLM Workspace.

## 📚 API Endpoints

### Protected (cần Logto auth)

- `GET /api/chat/workspaces` - Lấy danh sách workspace
- `GET /api/chat/sessions?workspaceSlug=internal` - Lấy danh sách session của workspace
- `POST /api/chat/sessions` - Tạo session mới
- `GET /api/chat/sessions/:sessionId/messages` - Lấy tin nhắn trong session
- `PATCH /api/chat/sessions/:sessionId` - Đổi tên session
- `DELETE /api/chat/sessions/:sessionId` - Xóa session
- `POST /api/chat` - Gửi tin nhắn (tạo session tự động nếu chưa có)

Các endpoint chat/history cần token có scope `chat:internal`.

## 📊 Database Schema

```prisma
model ChatSession {
  id            String        @id @default(uuid())
  logtoUserId   String
  workspaceSlug String
  title         String?
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
  messages      ChatMessage[]

  @@index([logtoUserId])
  @@index([workspaceSlug])
  @@index([logtoUserId, workspaceSlug])
}

model ChatMessage {
  id        String      @id @default(uuid())
  sessionId String
  role      String      // "user" | "assistant"
  content   String
  createdAt DateTime    @default(now())

  session   ChatSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId])
}
```

## 🔒 Bảo Mật

- Tất cả endpoint được bảo vệ Logto JWT auth trừ `GET /api/chat/workspaces`
- Backend kiểm tra `logtoUserId` từ JWT payload để tránh user A truy cập session của user B
- Không cho client tự update `workspaceSlug` với session đã tồn tại
- AnythingLLM API key không được đưa ra frontend

## 🐛 Debugging

### Backend Logs

```bash
# Xem log response từ AnythingLLM
# Tìm chuỗi: [AnythingLLM] Raw response = { ... }
npm run dev
```

### Frontend Logs

Mở DevTools (F12) → Console để xem error & request details.

## 🔧 Troubleshooting

### Port 8080 đang bị chiếm

```bash
# Kill process
kill -9 $(lsof -t -i:8080)
```

### HTTPS error trên LAN (Mixed Content)

Frontend dùng `@vitejs/plugin-basic-ssl` để force HTTPS. Nếu vẫn gặp
lỗi, kiểm tra:
- Frontend chạy `https://192.168.0.181:5173`
- Backend API được call qua `/api/*` proxy (không call trực tiếp HTTP)
- Vite config có `basicSsl()` plugin

### Logto timeout error during middleware

Lỗi chập chờn do mạng không ổn. Chỉ cần reload app hoặc thử lại.

## 📝 License

Internal use only.
