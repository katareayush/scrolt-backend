import { Router } from 'express';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/connection';
import { users, friends, dailyResults } from '../db/schema';
import { requireAuth } from '../middleware/session';
import { sensitiveLimiter, writeLimiter } from '../middleware/rateLimit';
import { CardService } from '../services/cardService';
import { randomBytes } from 'node:crypto';

/**
 * Friends + friend-code routes.
 *
 *   GET    /api/friends/me      → { friendCode } (generates if absent)
 *   POST   /api/friends/add     → add by code, idempotent + symmetric
 *   DELETE /api/friends/:id     → remove both directions
 *   GET    /api/friends         → list of friends + today's daily status
 *
 * All routes are authenticated — friend graphs don't make sense for
 * anonymous sessions. Anon users get 401 and can sign in to access.
 */
export const friendsRouter = Router();

/** Crockford base32 — no I/L/O/U to avoid look-alikes. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LEN = 6;

function generateCode(): string {
  const bytes = randomBytes(CODE_LEN);
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

/**
 * Get-or-generate the caller's friend code. Generates lazily so we
 * don't burn UUIDs on accounts that never share. Retries on the
 * astronomically rare collision (unique index will throw).
 */
friendsRouter.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const existing = await db
      .select({ friendCode: users.friendCode })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (existing[0]?.friendCode) {
      return res.json({ friendCode: existing[0].friendCode });
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode();
      try {
        await db.update(users).set({ friendCode: code }).where(eq(users.id, userId));
        return res.json({ friendCode: code });
      } catch (err) {
        // Unique-constraint clash on retry. Continue.
        if (attempt === 4) throw err;
      }
    }
    throw new Error('failed to generate friend code');
  } catch (err) {
    console.error('friends.me failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Add a friend by code. Idempotent — re-running with the same code is
 * a no-op. Symmetric — both rows are inserted.
 */
friendsRouter.post('/add', writeLimiter, requireAuth, async (req, res) => {
  try {
    const myId = req.userId!;
    const codeRaw = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    if (!/^[0-9A-HJKMNP-TV-Z]{6}$/.test(codeRaw)) {
      return res.status(400).json({ error: 'invalid friend code' });
    }

    const target = await db
      .select({ id: users.id, name: users.name, image: users.image })
      .from(users)
      .where(eq(users.friendCode, codeRaw))
      .limit(1);

    if (!target[0]) return res.status(404).json({ error: 'no user with that code' });
    if (target[0].id === myId) {
      return res.status(400).json({ error: "that's your own code" });
    }

    // Both directions, ON CONFLICT DO NOTHING for idempotency.
    await db
      .insert(friends)
      .values([
        { userId: myId, friendUserId: target[0].id },
        { userId: target[0].id, friendUserId: myId },
      ])
      .onConflictDoNothing();

    res.json({ ok: true, friend: target[0] });
  } catch (err) {
    console.error('friends.add failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Remove both directions of a friendship. Idempotent. */
friendsRouter.delete('/:friendUserId', sensitiveLimiter, requireAuth, async (req, res) => {
  try {
    const myId = req.userId!;
    const otherId = req.params.friendUserId;
    if (!otherId) return res.status(400).json({ error: 'missing id' });

    await db
      .delete(friends)
      .where(
        sql`(${friends.userId} = ${myId} AND ${friends.friendUserId} = ${otherId})
          OR (${friends.userId} = ${otherId} AND ${friends.friendUserId} = ${myId})`,
      );

    res.json({ ok: true });
  } catch (err) {
    console.error('friends.remove failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * List the caller's friends and each one's daily status for today.
 * Single query — today's daily result joins in via LEFT JOIN so a
 * friend with no run today simply carries null columns.
 */
friendsRouter.get('/', requireAuth, async (req, res) => {
  try {
    const myId = req.userId!;
    res.setHeader('Cache-Control', 'private, max-age=15');

    const today = CardService.todayUtc();
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        image: users.image,
        correct: dailyResults.correct,
        total: dailyResults.total,
      })
      .from(friends)
      .innerJoin(users, eq(users.id, friends.friendUserId))
      .leftJoin(
        dailyResults,
        and(
          eq(dailyResults.userId, friends.friendUserId),
          eq(dailyResults.date, today),
        ),
      )
      .where(eq(friends.userId, myId));

    res.json({
      friends: rows.map((r) => ({
        id: r.id,
        name: r.name,
        image: r.image,
        daily: r.correct === null || r.total === null ? null : { correct: r.correct, total: r.total },
      })),
    });
  } catch (err) {
    console.error('friends.list failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
