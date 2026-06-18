import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { chatRouter } from './routes/chat.routes.js';
import { prisma } from './lib/prisma.js';
import { DEFAULT_WORKSPACES } from './config/workspaces.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 8080;

const allowedOrigins = (process.env.FRONTEND_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json());

app.use('/api/chat', chatRouter);

async function bootstrap() {
  for (const workspace of DEFAULT_WORKSPACES) {
    await prisma.workspace.upsert({
      where: { slug: workspace.slug },
      update: { name: workspace.name },
      create: workspace,
    });
  }

  app.listen(Number(port), '0.0.0.0', () => {
    console.log(`Backend server running on http://0.0.0.0:${port}`);
  });
}

void bootstrap();
