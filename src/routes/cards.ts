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
      return res.status(404).json({ error: 'No more cards available' });
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

    const hasSeenCard = await cardService.hasUserSeenCard(userId, cardId);
    if (hasSeenCard) {
      return res.status(400).json({ error: 'Card already answered by this user' });
    }

    await cardService.markCardAsAnswered(userId, cardId);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error recording answer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});