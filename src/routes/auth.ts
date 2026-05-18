import { Router } from 'express';
import { db } from '../db/connection';
import { userProgress } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/session';
import { sensitiveLimiter } from '../middleware/rateLimit';
import { CardService } from '../services/cardService';

export const authRouter = Router();
const cardService = new CardService();

const ANON_ID_RE = /^anon_[a-z0-9_]{4,64}$/i;

/**
 * Transfer all user_progress rows from an anonymous session id to the
 * authenticated user. Called by the frontend right after first sign-in.
 *
 * Idempotent: if some rows already exist for the real user, INSERT IGNORE
 * semantics via ON CONFLICT DO NOTHING (composite uniqueness emulated via
 * SELECT + filter — there's no PK on user_progress today).
 */
authRouter.post('/claim-anon', sensitiveLimiter, requireAuth, async (req, res) => {
  const anonId = typeof req.body?.anonId === 'string' ? req.body.anonId : '';
  if (!ANON_ID_RE.test(anonId)) {
    return res.status(400).json({ error: 'invalid anonId' });
  }
  const realUserId = req.userId!;
  if (anonId === realUserId) {
    return res.json({ moved: 0, alreadySame: true });
  }

  try {
    // Move only the anon rows whose cardId hasn't already been recorded
    // for the real user, to avoid creating duplicate seen-card entries.
    const result = await db.execute(sql`
      UPDATE user_progress
      SET user_id = ${realUserId}
      WHERE user_id = ${anonId}
        AND card_id NOT IN (
          SELECT card_id FROM user_progress WHERE user_id = ${realUserId}
        )
    `);

    // Drop any remaining anon rows that were duplicates of the real user's.
    await db
      .delete(userProgress)
      .where(eq(userProgress.userId, anonId));

    // Bust caches so the new merged progress takes effect immediately.
    await cardService.invalidateUser(realUserId);
    await cardService.invalidateUser(anonId);

    const moved = (result as unknown as { rowCount?: number }).rowCount ?? 0;
    res.json({ moved, anonId, realUserId });
  } catch (err) {
    console.error('claim-anon failed:', err);
    res.status(500).json({ error: 'claim failed' });
  }
});

/**
 * Lightweight introspection endpoint: returns { userId, isAuthenticated }.
 * Used by the frontend to confirm the API JWT it minted is accepted by
 * the backend.
 */
authRouter.get('/me', (req, res) => {
  res.json({
    userId: req.userId ?? null,
    isAuthenticated: Boolean(req.isAuthenticated),
  });
});
