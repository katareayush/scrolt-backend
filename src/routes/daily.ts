import { Router } from 'express';
import { db } from '../db/connection';
import { dailyResults } from '../db/schema';
import { eq, and, sql, desc } from 'drizzle-orm';
import { CardService } from '../services/cardService';
import { requireUser } from '../middleware/session';
import { writeLimiter } from '../middleware/rateLimit';

/**
 * Daily Challenge routes.
 *
 *   GET  /api/daily               → today's 10 cards (same for all users)
 *   GET  /api/daily/status        → has the current user completed today?
 *   POST /api/daily/complete      → record { correct, total } for today
 *   GET  /api/daily/leaderboard   → today's top scorers (anon excluded)
 *
 * All routes require a userId (anon or authenticated). Daily perfect-day
 * streaks are tracked via the `daily_results` table — separate from the
 * answer-anything streak so the two can grow independently.
 */
export const dailyRouter = Router();
const cardService = new CardService();

dailyRouter.get('/', requireUser, async (_req, res) => {
  try {
    const cards = await cardService.getDailyCards(CardService.todayUtc(), 10);
    res.json({ date: CardService.todayUtc(), cards });
  } catch (err) {
    console.error('daily.get failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

dailyRouter.get('/status', requireUser, async (req, res) => {
  try {
    const userId = req.userId!;
    const today = CardService.todayUtc();
    const rows = await db
      .select()
      .from(dailyResults)
      .where(and(eq(dailyResults.userId, userId), eq(dailyResults.date, today)))
      .limit(1);

    const row = rows[0];
    res.json({
      date: today,
      completed: Boolean(row),
      correct: row?.correct ?? null,
      total: row?.total ?? null,
    });
  } catch (err) {
    console.error('daily.status failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

dailyRouter.post('/complete', writeLimiter, requireUser, async (req, res) => {
  try {
    const userId = req.userId!;
    const correct = Number.parseInt(String(req.body?.correct ?? ''), 10);
    const total = Number.parseInt(String(req.body?.total ?? ''), 10);

    if (!Number.isFinite(correct) || !Number.isFinite(total) || total <= 0 || correct < 0 || correct > total) {
      return res.status(400).json({ error: 'invalid correct/total' });
    }

    const today = CardService.todayUtc();
    // Idempotent: first completion wins. A retry of the same POST
    // updates nothing.
    await db
      .insert(dailyResults)
      .values({ userId, date: today, correct, total })
      .onConflictDoNothing({
        target: [dailyResults.userId, dailyResults.date],
      });

    res.json({ ok: true, date: today, correct, total });
  } catch (err) {
    console.error('daily.complete failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

dailyRouter.get('/leaderboard', async (_req, res) => {
  try {
    const today = CardService.todayUtc();
    // Top 50 perfect scores for today. Anonymous users (anon_*) excluded
    // — they have no display identity to put on a board.
    const rows = await db.execute(sql`
      SELECT d.user_id, d.correct, d.total, d.completed_at,
             u.name, u.image
      FROM daily_results d
      LEFT JOIN users u ON u.id = d.user_id
      WHERE d.date = ${today}
        AND d.user_id NOT LIKE 'anon_%'
      ORDER BY d.correct DESC, d.completed_at ASC
      LIMIT 50
    `);
    const entries =
      (rows as unknown as {
        rows: {
          user_id: string;
          correct: number;
          total: number;
          completed_at: string;
          name: string | null;
          image: string | null;
        }[];
      }).rows ?? [];
    res.json({ date: today, entries });
  } catch (err) {
    console.error('daily.leaderboard failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
