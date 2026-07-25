import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { logger } from './logger';
import { createLimiter } from './rateLimit';

/**
 * Gate for the single-operator admin dashboard.
 *
 * Deliberately NOT tied to the app's user session: the dashboard is
 * served by the API on its own origin, has no NextAuth cookie to read,
 * and is for one person. A static high-entropy token in `ADMIN_TOKEN`
 * is the right amount of machinery here.
 *
 * Behaviour when ADMIN_TOKEN is unset: 404, not 401. An unconfigured
 * deploy shouldn't advertise that an admin surface exists at all.
 */

/** Timing-safe string compare that doesn't leak length via early return. */
function safeEqual(a: string, b: string): boolean {
  // Hash both sides to equal-length digests so timingSafeEqual can't
  // throw on a length mismatch (which itself would leak length).
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Brute-force guard on the token check, keyed by IP (an unauthenticated
 * caller has no userId). 10/min makes guessing a 24-byte token hopeless
 * while never inconveniencing a real dashboard session, whose requests
 * arrive with a valid token anyway.
 *
 * `skip` is overridden because the shared factory skips GETs by default,
 * and every admin request is a GET.
 */
export const adminLimiter = createLimiter({
  max: 10,
  windowMs: 60_000,
  skip: (req) => req.method === 'OPTIONS',
});

/** True when the deploy has an admin token configured at all. */
export function adminEnabled(): boolean {
  return typeof env.ADMIN_TOKEN === 'string' && env.ADMIN_TOKEN.length > 0;
}

/**
 * Extract the presented token. Header is the primary path (the dashboard
 * keeps the token in sessionStorage and sends it on every fetch);
 * `?token=` exists so the page can be opened from a bookmark and for
 * quick curl access.
 */
function presentedToken(req: Request): string | null {
  const header = req.header('x-admin-token');
  if (typeof header === 'string' && header.length > 0) return header;

  const bearer = req.headers.authorization;
  if (bearer?.startsWith('Bearer ')) return bearer.slice(7);

  const query = req.query?.token;
  if (typeof query === 'string' && query.length > 0) return query;

  return null;
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const expected = env.ADMIN_TOKEN;
  if (!expected) {
    res.status(404).json({ error: 'Route not found' });
    return;
  }

  const presented = presentedToken(req);
  if (!presented || !safeEqual(presented, expected)) {
    logger.warn('admin_auth_failed', {
      reqId: req.reqId,
      ip: req.ip ?? null,
      // Strip the query string — `?token=` must never reach the logs.
      path: req.originalUrl.split('?')[0],
      presented: presented ? 'invalid' : 'missing',
    });
    res.status(401).json({ error: 'admin token required' });
    return;
  }

  next();
}
