import { pgTable, text, timestamp, varchar, pgEnum } from 'drizzle-orm/pg-core';
import { InferSelectModel, InferInsertModel } from 'drizzle-orm';

export const difficultyEnum = pgEnum('difficulty', ['easy', 'medium', 'hard']);
export const categoryEnum = pgEnum('category', ['emotion', 'everyday', 'work', 'opinion', 'social', 'precision']);

export const cards = pgTable('cards', {
  id: varchar('id', { length: 255 }).primaryKey(),
  sentence: text('sentence').notNull(),
  options: text('options').array().notNull(),
  answer: text('answer').notNull(),
  explanation: text('explanation').notNull(),
  difficulty: difficultyEnum('difficulty').notNull(),
  category: categoryEnum('category').notNull(),
});

export const userProgress = pgTable('user_progress', {
  userId: varchar('user_id', { length: 255 }).notNull(),
  cardId: varchar('card_id', { length: 255 }).notNull().references(() => cards.id),
  answeredAt: timestamp('answered_at').defaultNow().notNull(),
});

export type Card = InferSelectModel<typeof cards>;
export type NewCard = InferInsertModel<typeof cards>;
export type UserProgress = InferSelectModel<typeof userProgress>;
export type NewUserProgress = InferInsertModel<typeof userProgress>;