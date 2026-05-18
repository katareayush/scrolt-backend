import { Router } from 'express';
import { CardService } from '../services/cardService';
import { requireUser } from '../middleware/session';

export const progressRouter = Router();
const cardService = new CardService();

progressRouter.get('/', requireUser, async (req, res) => {
  try {
    const userId = req.userId!;
    const [base, streakData] = await Promise.all([
      cardService.getUserProgress(userId),
      cardService.getStreak(userId),
    ]);
    res.json({ ...base, ...streakData });
  } catch (error) {
    console.error('Error fetching progress:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
