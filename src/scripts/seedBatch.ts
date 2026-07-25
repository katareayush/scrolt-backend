/**
 * Append a batch of new cards to the catalog.
 *
 * This is the ADDITIVE counterpart to `seed.ts`. `seed.ts` re-seeds the
 * whole catalog from `data/cards.json` and deletes anything not in that
 * file — it must never be run against the live catalog, which is grown in
 * batches and no longer mirrors that file. This script only ever inserts.
 *
 *   npx ts-node src/scripts/seedBatch.ts data/batches/<file>.json [--dry-run]
 *
 * A batch file is a JSON array of cards WITHOUT ids (ids are assigned
 * sequentially from the current max `scrolt_NNN`).
 *
 * Guarantees:
 * - Validates every card before writing anything: exactly 3 distinct
 *   options, answer among them, a `_____` blank, valid enum values.
 * - Rejects sentences that already exist in the DB or repeat inside the
 *   batch (normalised comparison), so batches stay dedup'd.
 * - Randomises stored option order via `shuffleOptions` — the generator
 *   writes answer-first, and storing it that way makes "always tap the
 *   first option" a winning strategy. This is the same deterministic
 *   per-card shuffle the read path applies, so stored and served order
 *   agree.
 * - Single transaction, ON CONFLICT DO NOTHING, then busts the catalog
 *   cache so new cards show up without waiting out the 1h TTL.
 */
import { readFile } from 'fs/promises';
import { isAbsolute, join } from 'path';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db/connection';
import { cards } from '../db/schema';
import { shuffleOptions } from '../services/cardAlgorithm';
import { CardService } from '../services/cardService';

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
const CATEGORIES = ['emotion', 'everyday', 'work', 'opinion', 'social', 'precision'] as const;

type Difficulty = (typeof DIFFICULTIES)[number];
type Category = (typeof CATEGORIES)[number];

interface BatchCard {
  sentence: string;
  options: string[];
  answer: string;
  explanation: string;
  difficulty: Difficulty;
  category: Category;
}

/** Collapse whitespace/punctuation/case so near-identical prompts collide. */
function sentenceKey(sentence: string): string {
  return sentence
    .toLowerCase()
    .replace(/_+/g, ' _ ')
    .replace(/[^a-z0-9_ ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function validate(batch: unknown, existingKeys: Set<string>): BatchCard[] {
  if (!Array.isArray(batch)) throw new Error('batch file must contain a JSON array');

  const errors: string[] = [];
  const seenKeys = new Set<string>();
  const ok: BatchCard[] = [];

  batch.forEach((raw, i) => {
    const c = raw as Partial<BatchCard>;
    const at = `[${i}] ${String(c.sentence ?? '(no sentence)').slice(0, 60)}`;
    const fail = (msg: string) => errors.push(`${at}: ${msg}`);

    if (typeof c.sentence !== 'string' || !c.sentence.includes('_____')) {
      return fail('sentence missing or has no _____ blank');
    }
    if (typeof c.explanation !== 'string' || c.explanation.trim().length === 0) {
      return fail('explanation missing');
    }
    if (!Array.isArray(c.options) || c.options.length !== 3) {
      return fail(`expected exactly 3 options, got ${c.options?.length ?? 0}`);
    }
    if (new Set(c.options).size !== 3) return fail('options contain a duplicate');
    if (typeof c.answer !== 'string' || !c.options.includes(c.answer)) {
      return fail(`answer "${c.answer}" is not one of the options`);
    }
    if (!DIFFICULTIES.includes(c.difficulty as Difficulty)) {
      return fail(`invalid difficulty "${c.difficulty}"`);
    }
    if (!CATEGORIES.includes(c.category as Category)) {
      return fail(`invalid category "${c.category}"`);
    }

    const key = sentenceKey(c.sentence);
    if (existingKeys.has(key)) return fail('sentence already exists in the DB');
    if (seenKeys.has(key)) return fail('sentence repeats earlier in this batch');
    seenKeys.add(key);

    ok.push(c as BatchCard);
  });

  if (errors.length > 0) {
    throw new Error(`${errors.length} invalid card(s):\n  ${errors.join('\n  ')}`);
  }
  return ok;
}

function positionHistogram(rows: { options: string[]; answer: string }[]): number[] {
  const counts = [0, 0, 0];
  for (const r of rows) {
    const i = r.options.indexOf(r.answer);
    if (i >= 0) counts[i] = (counts[i] ?? 0) + 1;
  }
  return counts;
}

async function run(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const fileArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!fileArg) {
    throw new Error('usage: ts-node src/scripts/seedBatch.ts <batch.json> [--dry-run]');
  }
  const path = isAbsolute(fileArg) ? fileArg : join(process.cwd(), fileArg);

  console.log(`[seedBatch] reading ${path}…`);
  const batchRaw: unknown = JSON.parse(await readFile(path, 'utf-8'));

  const existing = await db.select({ sentence: cards.sentence }).from(cards);
  const existingKeys = new Set(existing.map((r) => sentenceKey(r.sentence)));
  console.log(`[seedBatch] catalog holds ${existing.length} cards`);

  const batch = validate(batchRaw, existingKeys);
  console.log(`[seedBatch] ${batch.length} card(s) passed validation`);

  const { rows: maxRows } = await pool.query<{ max: number | null }>(
    `select max((regexp_replace(id, '\\D', '', 'g'))::int) as max
       from cards
      where id ~ '^scrolt_[0-9]+$'`,
  );
  const startId = (maxRows[0]?.max ?? 0) + 1;
  const width = Math.max(3, String(startId + batch.length - 1).length);

  const prepared = batch.map((c, i) => {
    const id = `scrolt_${String(startId + i).padStart(width, '0')}`;
    return { ...c, id, options: shuffleOptions(id, c.options) };
  });

  console.log(
    `[seedBatch] assigning ${prepared[0]?.id} … ${prepared[prepared.length - 1]?.id}`,
  );
  console.log('[seedBatch] answer position in batch:', positionHistogram(prepared));

  const byCat = prepared.reduce<Record<string, number>>((acc, c) => {
    acc[`${c.category}/${c.difficulty}`] = (acc[`${c.category}/${c.difficulty}`] ?? 0) + 1;
    return acc;
  }, {});
  console.log('[seedBatch] breakdown:', byCat);

  if (dryRun) {
    console.log('[seedBatch] --dry-run: nothing written');
    return;
  }

  let inserted = 0;
  await db.transaction(async (tx) => {
    for (const c of prepared) {
      const res = await tx
        .insert(cards)
        .values({
          id: c.id,
          sentence: c.sentence,
          options: c.options,
          answer: c.answer,
          explanation: c.explanation,
          difficulty: c.difficulty,
          category: c.category,
        })
        .onConflictDoNothing({ target: cards.id });
      inserted += res.rowCount ?? 0;
    }
  });
  console.log(`[seedBatch] inserted ${inserted} card(s)`);

  const totals = await db.select({ count: sql<number>`count(*)::int` }).from(cards);
  console.log(`[seedBatch] catalog now holds ${totals[0]?.count ?? 0} cards`);

  await new CardService().invalidateCatalog();
  console.log('[seedBatch] catalog cache invalidated');
}

run()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[seedBatch] failed:', err instanceof Error ? err.message : err);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
