import { readFile } from 'fs/promises';
import { join } from 'path';
import { db } from '../db/connection';
import { cards, userProgress } from '../db/schema';
import type { NewCard } from '../db/schema';

interface CardData {
  id: string;
  sentence: string;
  options: string[];
  answer: string;
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
  category: 'emotion' | 'everyday' | 'work' | 'opinion' | 'social' | 'precision';
}

const main = async () => {
  try {
    console.log('Loading cards data...');
    const dataPath = join(process.cwd(), 'data', 'cards.json');
    const fileContent = await readFile(dataPath, 'utf-8');
    const cardsData: CardData[] = JSON.parse(fileContent);

    console.log(`Found ${cardsData.length} cards to seed`);

    await db.delete(userProgress);
    console.log('Cleared existing user progress');
    
    await db.delete(cards);
    console.log('Cleared existing cards');

    const newCards: NewCard[] = cardsData.map(card => ({
      id: card.id,
      sentence: card.sentence,
      options: card.options,
      answer: card.answer,
      explanation: card.explanation,
      difficulty: card.difficulty,
      category: card.category,
    }));

    await db.insert(cards).values(newCards);
    console.log(`Seeded ${newCards.length} cards successfully`);
    
    process.exit(0);
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  }
};

main();