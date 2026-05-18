import type { Request, Response, NextFunction } from 'express';
import { jwtVerify } from 'jose';
import { env } from '../config/env';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      isAuthenticated?: boolean;
    }
  }
}

const ANON_ID_RE = /^anon_[a-z0-9_]{4,64}$/i;
const USER_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

const secretBytes = new TextEncoder().encode(env.AUTH_SECRET);

export async function sessionMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;

  if (token) {
    try {
      const { payload } = await jwtVerify(token, secretBytes, {
        algorithms: ['HS256'],
        issuer: 'scrolt-web',
        audience: 'scrolt-api',
      });
      if (typeof payload.sub === 'string' && USER_ID_RE.test(payload.sub)) {
        req.userId = payload.sub;
        req.isAuthenticated = true;
        return next();
      }
    } catch {
      // Fall through to anon handling. Don't 401 here — many endpoints
      // are usable while anonymous.
    }
  }

  const anonHeader = req.header('x-anon-id');
  const anonBody = typeof req.body?.userId === 'string' ? req.body.userId : undefined;
  const anonQuery = typeof req.query?.userId === 'string' ? (req.query.userId as string) : undefined;
  const candidate = anonHeader ?? anonBody ?? anonQuery;

  if (candidate && ANON_ID_RE.test(candidate)) {
    req.userId = candidate;
    req.isAuthenticated = false;
  }

  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.isAuthenticated || !req.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.userId) {
    res.status(400).json({ error: 'No user identifier provided' });
    return;
  }
  next();
}
