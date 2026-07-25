import { Router } from 'express';
import { z } from 'zod';
import { db, withDbRetry } from '../db/connection';
import { analyticsEvents } from '../db/schema';
import { requireUser } from '../middleware/session';
import { createLimiter } from '../middleware/rateLimit';
import { logger } from '../middleware/logger';

export const eventsRouter = Router();

const MODES = ['scroll', 'focus', 'speed', 'review', 'daily', 'words', 'other'] as const;
const EVENTS = ['session_start', 'session_end', 'answer', 'complete'] as const;

/** Max events accepted in one flush. Matches the client's buffer cap. */
const MAX_BATCH = 60;

const eventSchema = z.object({
  id: z.string().min(8).max(64),
  event: z.enum(EVENTS),
  mode: z.enum(MODES).optional(),
  variant: z.string().max(64).optional(),
  cardId: z.string().max(255).optional(),
  correct: z.boolean().optional(),
  durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
  /** Client clock, ms epoch. Clamped server-side — see `resolveAt`. */
  at: z.number().int().positive().optional(),
});

const batchSchema = z.object({
  events: z.array(eventSchema).min(1).max(MAX_BATCH),
});

/**
 * Events are buffered client-side and flushed later, so the client
 * timestamp is what we want — but it comes from an untrusted clock. A
 * device with a skewed clock would otherwise scatter rows into the far
 * future (breaking every "last N days" window) or the distant past.
 *
 * We accept client times up to 7 days old (a buffer that survived a long
 * offline stretch) but never in the future, falling back to server-now.
 */
const MAX_BACKDATE_MS = 7 * 24 * 60 * 60 * 1000;

function resolveAt(clientAt: number | undefined, now: number): Date {
  if (clientAt === undefined) return new Date(now);
  if (clientAt > now) return new Date(now);
  if (clientAt < now - MAX_BACKDATE_MS) return new Date(now - MAX_BACKDATE_MS);
  return new Date(clientAt);
}

/**
 * Generous limiter: a flush carries up to 60 events, so an active user
 * needs only a few requests per minute. 30/min leaves plenty of room for
 * retries while capping how fast a script could inflate the table.
 */
const eventsLimiter = createLimiter({ max: 30, windowMs: 60_000 });

/**
 * POST /api/events — record a batch of behavioural events.
 *
 * Accepts both authenticated and anonymous callers (requireUser, not
 * requireAuth) because logged-out usage is exactly what we need to
 * measure. Always answers 202 with the accepted count; analytics must
 * never surface an error into the user's session, so a DB failure is
 * logged and swallowed.
 */
eventsRouter.post('/', eventsLimiter, requireUser, async (req, res) => {
  const parsed = batchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid event batch' });
  }

  const userId = req.userId!;
  const authed = req.isAuthenticated === true;
  const now = Date.now();

  const rows = parsed.data.events.map((e) => ({
    id: e.id,
    userId,
    event: e.event,
    mode: e.mode ?? null,
    variant: e.variant ?? null,
    cardId: e.cardId ?? null,
    correct: e.correct ?? null,
    durationMs: e.durationMs ?? null,
    authed,
    at: resolveAt(e.at, now),
  }));

  try {
    // onConflictDoNothing on the client-generated PK makes a retried
    // flush a no-op rather than a duplicate.
    await withDbRetry(() => db.insert(analyticsEvents).values(rows).onConflictDoNothing());
    res.status(202).json({ accepted: rows.length });
  } catch (err) {
    logger.warn('events_insert_failed', {
      reqId: req.reqId,
      count: rows.length,
      err: err instanceof Error ? err.message : String(err),
    });
    // 202 on purpose: the client already dropped these from its buffer
    // and must not retry forever over a server-side problem.
    res.status(202).json({ accepted: 0 });
  }
});
