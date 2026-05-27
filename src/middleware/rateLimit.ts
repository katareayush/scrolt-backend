import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { logger } from './logger';

/**
 * Resolve the rate-limit key. Prefer the authenticated/anonymous userId
 * (set by sessionMiddleware) so a single user behind a shared NAT
 * doesn't get throttled by their roommates' traffic. Falls back to IP.
 */
function keyByUser(req: Request): string {
  return req.userId ?? `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`;
}

/**
 * Factory for endpoint-specific limiters.
 *
 * - `max=60, windowMs=60_000` is intentionally generous: humans can't
 *   click that fast and our retry logic stays well under it. The limit
 *   is here to stop scripts, not honest users.
 * - `standardHeaders: 'draft-7'` returns RateLimit-* headers per the
 *   IETF draft so clients (and Vercel) can read them.
 * - `legacyHeaders: false` suppresses the older X-RateLimit-* set.
 * - Skips OPTIONS (preflight) and idempotent reads so we don't burn
 *   user quota on cache-friendly traffic.
 */
export function createLimiter(opts: Partial<Options> = {}) {
  return rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: keyByUser,
    skip: (req) => req.method === 'OPTIONS' || req.method === 'GET',
    handler: (req, res) => {
      logger.warn('rate_limited', {
        reqId: req.reqId,
        userId: req.userId ?? null,
        path: req.originalUrl,
      });
      res
        .status(429)
        .json({ error: 'too many requests', retryAfter: 60 });
    },
    ...opts,
  });
}

/** General-purpose limiter for write endpoints. */
export const writeLimiter = createLimiter();

/**
 * Tighter limiter for auth-adjacent writes (claim-anon, handoff/create).
 * These shouldn't fire more than a handful of times per hour for any
 * given user under legitimate use.
 */
export const sensitiveLimiter = createLimiter({ max: 20, windowMs: 60_000 });
