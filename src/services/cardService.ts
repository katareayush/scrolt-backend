import { db } from '../db/connection';
import { cards, userProgress } from '../db/schema';
import { eq, notInArray, sql, and } from 'drizzle-orm';
import type { Card } from '../db/schema';

export class CardService {
  async getNextCard(userId: string): Promise<Card | null> {
    const seenCardIds = await db
      .select({ cardId: userProgress.cardId })
      .from(userProgress)
      .where(eq(userProgress.userId, userId));

    const seenCardIdValues = seenCardIds.map(row => row.cardId);

    let availableCards;
    if (seenCardIdValues.length === 0) {
      availableCards = await db.select().from(cards);
    } else {
      availableCards = await db
        .select()
        .from(cards)
        .where(notInArray(cards.id, seenCardIdValues));
    }

    if (availableCards.length === 0) {
      return null;
    }

    const seedNumber = this.generateSeed(userId);
    const randomIndex = this.seededRandom(seedNumber + seenCardIdValues.length) % availableCards.length;
    
    return availableCards[randomIndex] ?? null;
  }

  async markCardAsAnswered(userId: string, cardId: string): Promise<void> {
    await db.insert(userProgress).values({
      userId,
      cardId,
      answeredAt: new Date(),
    });
  }

  async hasUserSeenCard(userId: string, cardId: string): Promise<boolean> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(userProgress)
      .where(and(
        eq(userProgress.userId, userId),
        eq(userProgress.cardId, cardId)
      ));

    return (result[0]?.count ?? 0) > 0;
  }

  private generateSeed(userId: string): number {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      const char = userId.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  private seededRandom(seed: number): number {
    const x = Math.sin(seed) * 10000;
    return Math.floor((x - Math.floor(x)) * 1000000);
  }
}