import { readFile } from 'fs/promises';
import { join } from 'path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { env } from '../config/env';
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

/**
 * Re-seed the cards catalog from data/cards.json.
 *
 * Reliability:
 * - Uses its own short-lived Pool with a 90s connect timeout so Neon's
 *   free-tier cold start doesn't kill the script (same fix as migrate.ts).
 * - Idempotent: uses ON CONFLICT DO UPDATE to overwrite cards by id
 *   instead of DELETE + INSERT. This means we never blow away
 *   `user_progress` rows that FK to the cards table.
 * - Single transaction so a partial failure leaves the catalog
 *   consistent.
 * - Retries the whole thing once on connection timeout (Neon wake-up).
 */
async function run(): Promise<void> {
  const dataPath = join(process.cwd(), 'data', 'cards.json');
  console.log(`[seed] reading ${dataPath}…`);
  const fileContent = await readFile(dataPath, 'utf-8');
  const cardsData: CardData[] = JSON.parse(fileContent);
  console.log(`[seed] loaded ${cardsData.length} cards`);

  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 90_000,
    idleTimeoutMillis: 30_000,
    max: 2,
  });
  pool.on('error', (err) => {
    console.error('[seed] pool error:', err);
  });

  try {
    const db = drizzle(pool);
    const newCards: NewCard[] = cardsData.map((c) => ({
      id: c.id,
      sentence: c.sentence,
      options: c.options,
      answer: c.answer,
      explanation: c.explanation,
      difficulty: c.difficulty,
      category: c.category,
    }));

    await db.transaction(async (tx) => {
      // Upsert in a single statement — much faster than per-row and
      // preserves user_progress (no DELETE step).
      await tx
        .insert(cards)
        .values(newCards)
        .onConflictDoUpdate({
          target: cards.id,
          set: {
            sentence: sql`excluded.sentence`,
            options: sql`excluded.options`,
            answer: sql`excluded.answer`,
            explanation: sql`excluded.explanation`,
            difficulty: sql`excluded.difficulty`,
            category: sql`excluded.category`,
          },
        });

      // Remove any cards that are no longer in the JSON. Cascades into
      // user_progress because we set ON DELETE behavior on the FK to
      // NO ACTION — so this will fail loud if a removed card has
      // history, which is what we want (forces an explicit decision
      // about deprecating cards with user data).
      const keepIds = newCards.map((c) => c.id);
      if (keepIds.length > 0) {
        await tx.execute(
          sql`DELETE FROM cards WHERE id NOT IN (${sql.join(
            keepIds.map((id) => sql`${id}`),
            sql.raw(', '),
          )})`,
        );
      }
    });

    console.log(`[seed] upserted ${newCards.length} cards (user_progress preserved)`);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  try {
    await run();
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isConnTimeout =
      message.includes('Connection terminated') ||
      message.includes('connect ETIMEDOUT') ||
      message.includes('connection timeout');

    if (isConnTimeout) {
      console.warn('[seed] first attempt timed out (probably Neon cold start). retrying once…');
      try {
        await run();
        process.exit(0);
      } catch (retryErr) {
        console.error('[seed] retry also failed:', retryErr);
        process.exit(1);
      }
    }

    console.error('[seed] failed:', err);
    process.exit(1);
  }
}

main();
