import type { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'node:crypto';

declare global {
  namespace Express {
    interface Request {
      reqId?: string;
      startedAt?: number;
    }
  }
}

/**
 * Lightweight structured request logger.
 *
 * Generates a short per-request id and logs one line per request on
 * response finish with method, path, status, latency, and the resolved
 * userId (if the session middleware ran first). Replaces ad-hoc
 * console.error scattered through route handlers.
 *
 * Why one line per request, not a logger lib: keeps the dependency
 * surface small. Switch to pino/winston later by replacing `emit()`
 * without touching call sites.
 */
function emit(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (event: string, fields: Record<string, unknown> = {}) => emit('info', event, fields),
  warn: (event: string, fields: Record<string, unknown> = {}) => emit('warn', event, fields),
  error: (event: string, fields: Record<string, unknown> = {}) => emit('error', event, fields),
};

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  req.reqId = randomBytes(6).toString('hex');
  req.startedAt = Date.now();
  res.setHeader('X-Request-Id', req.reqId);

  res.on('finish', () => {
    const ms = Date.now() - (req.startedAt ?? Date.now());
    const level: 'info' | 'warn' | 'error' =
      res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    emit(level, 'http', {
      reqId: req.reqId,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms,
      userId: req.userId ?? null,
      anon: req.userId && !req.isAuthenticated ? true : undefined,
    });
  });

  next();
}
