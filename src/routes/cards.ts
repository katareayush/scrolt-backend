import { Router } from 'express';
import { CardService } from '../services/cardService';

export const cardsRouter = Router();
const cardService = new CardService();

cardsRouter.get('/next', async (req, res) => {
  try {
    const userId = req.query.userId as string;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const card = await cardService.getNextCard(userId);
    
    if (!card) {
      const progress = await cardService.getUserProgress(userId);
      return res.json({ 
        completed: true,
        progress: {
          totalCards: progress.totalCards,
          seenCards: progress.seenCards,
          completedPercentage: progress.completedPercentage
        }
      });
    }

    res.json({ card });
  } catch (error) {
    console.error('Error fetching next card:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

cardsRouter.post('/answer', async (req, res) => {
  try {
    const { userId, cardId } = req.body;
    
    if (!userId || !cardId) {
      return res.status(400).json({ error: 'userId and cardId are required' });
    }

    await cardService.markCardAsAnswered(userId, cardId);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error recording answer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});