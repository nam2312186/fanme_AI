import type { Request, Response, NextFunction, RequestHandler } from 'express';

export type LogtoUserInfo = {
  sub: string;
  email?: string;
  name?: string;
  [key: string]: unknown;
};

export type AuthenticatedRequest = Request & {
  auth?: LogtoUserInfo;
};

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value || !value.trim()) {
    throw new Error(`Missing env ${name}`);
  }

  return value.trim().replace(/\/$/, '');
}

function optionalEnv(name: string): string {
  return (process.env[name] || '').trim();
}

const logtoEndpoint = requiredEnv('LOGTO_ENDPOINT');
const allowedEmailDomains = optionalEnv('ALLOWED_EMAIL_DOMAINS')
  .split(',')
  .map((item) => item.trim().toLowerCase().replace(/^@/, ''))
  .filter(Boolean);

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;

  const [type, token] = header.split(' ');
  if (type !== 'Bearer' || !token) return null;

  return token;
}

function isAllowedEmail(email?: string): boolean {
  if (allowedEmailDomains.length === 0) return true;
  if (!email || !email.includes('@')) return false;

  const domain = email.split('@').pop()?.toLowerCase();
  if (!domain) return false;

  return allowedEmailDomains.includes(domain);
}

async function fetchLogtoUserInfo(token: string): Promise<LogtoUserInfo> {
  const response = await fetch(`${logtoEndpoint}/oidc/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Logto userinfo failed: ${response.status}`);
  }

  const data = await response.json() as Record<string, unknown>;

  if (!data.sub || typeof data.sub !== 'string') {
    throw new Error('Logto userinfo missing sub');
  }

  return data as LogtoUserInfo;
}

export function requireLogtoAuth(_requiredScopes: string[] = []): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = getBearerToken(req);

      if (!token) {
        res.status(401).json({
          message: 'Vui lòng đăng nhập nhân viên để tiếp tục.',
        });
        return;
      }

      const userInfo = await fetchLogtoUserInfo(token);

      if (!isAllowedEmail(userInfo.email)) {
        res.status(403).json({
          message: 'Email của bạn không thuộc domain được phép sử dụng chatbot nội bộ FanMe.',
        });
        return;
      }

      (req as AuthenticatedRequest).auth = userInfo;
      next();
    } catch (error) {
      console.error('Logto auth error:', error);

      res.status(401).json({
        message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.',
      });
    }
  };
}
