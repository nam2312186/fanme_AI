import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export type AuthenticatedRequest = Request & {
  auth?: JWTPayload;
};

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value || !value.trim()) {
    throw new Error(`Missing env ${name}`);
  }

  return value.trim().replace(/\/$/, '');
}

const logtoEndpoint = requiredEnv('LOGTO_ENDPOINT');
const audience = requiredEnv('LOGTO_API_RESOURCE');
const issuer = `${logtoEndpoint}/oidc`;
const jwks = createRemoteJWKSet(new URL(`${issuer}/jwks`));

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;

  const [type, token] = header.split(' ');
  if (type !== 'Bearer' || !token) return null;

  return token;
}

function getTokenScopes(payload: JWTPayload): Set<string> {
  const scope = payload.scope;

  if (typeof scope !== 'string') {
    return new Set();
  }

  return new Set(scope.split(' ').map((item) => item.trim()).filter(Boolean));
}

export function requireLogtoAuth(requiredScopes: string[] = []): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = getBearerToken(req);

      if (!token) {
        res.status(401).json({
          message: 'Vui lòng đăng nhập nhân viên để tiếp tục.',
        });
        return;
      }

      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience,
      });

      const tokenScopes = getTokenScopes(payload);
      const missingScopes = requiredScopes.filter((scope) => !tokenScopes.has(scope));

      if (missingScopes.length > 0) {
        res.status(403).json({
          message: 'Tài khoản của bạn chưa được cấp quyền sử dụng chatbot nội bộ. Vui lòng liên hệ quản trị viên và đăng nhập lại sau khi được cấp quyền để hệ thống cập nhật quyền truy cập.',
        });
        return;
      }

      (req as AuthenticatedRequest).auth = payload;
      next();
    } catch (error) {
      console.error('Logto auth error:', error);

      res.status(401).json({
        message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.',
      });
    }
  };
}
