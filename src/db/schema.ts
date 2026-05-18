import {
  pgTable,
  text,
  integer,
  timestamp,
  varchar,
  pgEnum,
  primaryKey,
  boolean,
  date,
} from 'drizzle-orm/pg-core';
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

// user_id accepts both real account ids (uuids from users.id) and
// anonymous ids (anon_*). We deliberately omit a FK so anon swipes work
// before sign-in; the auth/claim-anon endpoint rewrites anon ids to real
// user ids on first login.
//
// Composite PK on (user_id, card_id) prevents duplicate progress rows
// under concurrent writes — the answer endpoint uses ON CONFLICT DO
// NOTHING so retries are safe.
export const userProgress = pgTable(
  'user_progress',
  {
    userId: varchar('user_id', { length: 255 }).notNull(),
    cardId: varchar('card_id', { length: 255 }).notNull().references(() => cards.id),
    answeredAt: timestamp('answered_at').defaultNow().notNull(),
    // null = legacy row from before we tracked correctness.
    correct: boolean('correct'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.cardId] })],
);

/**
 * Daily Challenge results — one row per (user, date). Used for streaks
 * tied to the daily, leaderboards, and "did I do it today?" checks.
 */
export const dailyResults = pgTable(
  'daily_results',
  {
    userId: varchar('user_id', { length: 255 }).notNull(),
    date: date('date').notNull(),
    correct: integer('correct').notNull(),
    total: integer('total').notNull(),
    completedAt: timestamp('completed_at').defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.date] })],
);

// ─── Auth.js / NextAuth tables ────────────────────────────────────
// Schema matches @auth/drizzle-adapter so the frontend can read/write
// the same rows. Column names use camelCase where the adapter requires
// it (userId, emailVerified, etc.) — kept verbatim on purpose.

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: timestamp('emailVerified', { mode: 'date' }),
  image: text('image'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const accounts = pgTable(
  'accounts',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (account) => [primaryKey({ columns: [account.provider, account.providerAccountId] })],
);

export const sessions = pgTable('sessions', {
  sessionToken: text('sessionToken').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
});

export const verificationTokens = pgTable(
  'verificationToken',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
);

export type Card = InferSelectModel<typeof cards>;
export type NewCard = InferInsertModel<typeof cards>;
export type UserProgress = InferSelectModel<typeof userProgress>;
export type NewUserProgress = InferInsertModel<typeof userProgress>;
export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;