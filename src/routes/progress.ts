import { Router } from 'express';
import { CardService } from '../services/cardService';

export const progressRouter = Router();
const cardService = new CardService();

progressRouter.get('/', async (req, res) => {
  try {
    const userId = req.query.userId as string;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const progress = await cardService.getUserProgress(userId);
    
    res.json(progress);
  } catch (error) {
    console.error('Error fetching progress:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});