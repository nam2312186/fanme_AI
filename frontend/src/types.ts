export type ChatRole = 'assistant' | 'user';

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  isSensitive?: boolean;
  requiresLogin?: boolean;
};
