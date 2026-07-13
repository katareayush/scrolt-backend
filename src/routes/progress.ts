import { Router } from 'express';
import { CardService } from '../services/cardService';
import { requireUser } from '../middleware/session';
import { withDbRetry } from '../db/connection';

export const progressRouter = Router();
const cardService = new CardService();

progressRouter.get('/', requireUser, async (req, res) => {
  try {
    const userId = req.userId!;
    // The service already serves up-to-30s-stale data from its local
    // cache, so letting the browser hold it for 30s adds no staleness —
    // it just skips the round trip on quick page-to-page navigation.
    res.setHeader('Cache-Control', 'private, max-age=30');
    const [base, streakData] = await withDbRetry(() =>
      Promise.all([
        cardService.getUserProgress(userId),
        cardService.getStreak(userId),
      ]),
    );
    res.json({ ...base, ...streakData });
  } catch (error) {
    console.error('Error fetching progress:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
