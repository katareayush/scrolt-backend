import { Router } from 'express';
import { HandoffService } from '../services/handoffService';
import { CardService } from '../services/cardService';

export const handoffRouter = Router();
const handoffService = new HandoffService();
const cardService = new CardService();

handoffRouter.post('/create', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const seenCardIds = await cardService.getSeenCardIds(userId);
    const token = await handoffService.createHandoffToken(userId, seenCardIds);
    
    res.json({ 
      token,
      expiresIn: 600
    });
  } catch (error) {
    console.error('Error creating handoff token:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

handoffRouter.post('/resolve', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'token is required' });
    }

    const handoffData = await handoffService.resolveHandoffToken(token);
    
    if (!handoffData) {
      return res.status(404).json({ error: 'Invalid or expired token' });
    }

    const progress = await cardService.getUserProgress(handoffData.userId);
    
    res.json({
      userId: handoffData.userId,
      progress: {
        seenCardIds: handoffData.progressSnapshot.seenCardIds,
        totalCards: progress.totalCards,
        seenCards: progress.seenCards,
        completedPercentage: progress.completedPercentage
      }
    });
  } catch (error) {
    console.error('Error resolving handoff token:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});