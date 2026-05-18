import { Router } from 'express';
import { CardService } from '../services/cardService';
import { requireUser } from '../middleware/session';
import { writeLimiter } from '../middleware/rateLimit';

export const cardsRouter = Router();
const cardService = new CardService();

cardsRouter.get('/next', requireUser, async (req, res) => {
  try {
    const userId = req.userId!;
    const card = await cardService.getNextCard(userId);

    if (!card) {
      const progress = await cardService.getUserProgress(userId);
      return res.json({
        completed: true,
        progress: {
          totalCards: progress.totalCards,
          seenCards: progress.seenCards,
          completedPercentage: progress.completedPercentage,
        },
      });
    }

    res.json({ card });
  } catch (error) {
    console.error('Error fetching next card:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

cardsRouter.get('/batch', requireUser, async (req, res) => {
  try {
    const userId = req.userId!;
    const count = parseInt(req.query.count as string) || 10;
    const cursor = req.query.cursor as string;

    const result = await cardService.getBatch(userId, count, cursor);

    if (result.cards.length === 0) {
      const progress = await cardService.getUserProgress(userId);
      return res.json({
        completed: true,
        cards: [],
        hasMore: false,
        progress: {
          totalCards: progress.totalCards,
          seenCards: progress.seenCards,
          completedPercentage: progress.completedPercentage,
        },
      });
    }

    res.json({
      cards: result.cards,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
      completed: !result.hasMore,
    });
  } catch (error) {
    console.error('Error fetching batch cards:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Cards the user got wrong, newest first. Drives the /review page.
 * Limited to 50 to keep the response small; if a user has more
 * mistakes than that we surface the most-recent slice.
 */
cardsRouter.get('/wrong', requireUser, async (req, res) => {
  try {
    const userId = req.userId!;
    const cards = await cardService.getWrongCards(userId, 50);
    res.json({ cards });
  } catch (error) {
    console.error('Error fetching wrong cards:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

cardsRouter.post('/answer', writeLimiter, requireUser, async (req, res) => {
  try {
    const userId = req.userId!;
    const cardId = typeof req.body?.cardId === 'string' ? req.body.cardId : '';
    const correct =
      typeof req.body?.correct === 'boolean' ? (req.body.correct as boolean) : undefined;
    if (!cardId) {
      return res.status(400).json({ error: 'cardId is required' });
    }

    await cardService.markCardAsAnswered(userId, cardId, correct);

    res.json({ success: true });
  } catch (error) {
    console.error('Error recording answer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
