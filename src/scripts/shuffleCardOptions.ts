/**
 * One-time repair: rewrite stored option order so the correct answer
 * isn't always first.
 *
 * The generated catalog was written answer-first — 1085 of 1086 cards
 * had `answer` at index 0 — so "always tap the top option" scored ~100%.
 * Serving already normalizes order via `shuffleOptions` (see
 * cardService), but the stored rows stay biased, which anything reading
 * `cards` directly (admin, exports, a future consumer) would inherit.
 * This aligns the data with what the API serves.
 *
 * Safe to re-run: `shuffleOptions` is idempotent and keyed on option
 * text, so a second pass updates nothing. Only `options` is written —
 * `answer` is untouched, and rows whose answer isn't in their options
 * are skipped and reported rather than rewritten.
 *
 *   npx ts-node src/scripts/shuffleCardOptions.ts [--dry-run]
 */
import { db } from '../db/connection';
import { eq } from 'drizzle-orm';
import { cards } from '../db/schema';
import { shuffleOptions } from '../services/cardAlgorithm';

interface Row {
  id: string;
  options: string[];
  answer: string;
}

function positionHistogram(rows: { options: string[]; answer: string }[]): number[] {
  const counts: number[] = [];
  for (const r of rows) {
    const i = r.options.indexOf(r.answer);
    if (i < 0) continue;
    counts[i] = (counts[i] ?? 0) + 1;
  }
  return counts;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const rows: Row[] = await db
    .select({ id: cards.id, options: cards.options, answer: cards.answer })
    .from(cards);
  console.log(`Loaded ${rows.length} cards`);
  console.log('Answer position before:', positionHistogram(rows));

  const orphans = rows.filter((r) => !r.options.includes(r.answer));
  if (orphans.length > 0) {
    console.warn(
      `⚠ ${orphans.length} card(s) whose answer is not among their options — skipping:`,
      orphans.map((r) => r.id).join(', '),
    );
  }

  const updates = rows
    .filter((r) => r.options.includes(r.answer))
    .map((r) => ({ id: r.id, before: r.options, options: shuffleOptions(r.id, r.options) }))
    .filter((u) => u.options.some((opt, i) => opt !== u.before[i]));

  console.log(`${updates.length} card(s) need a new option order`);
  console.log(
    'Answer position after:',
    positionHistogram(
      rows.map((r) => ({
        options: r.options.includes(r.answer) ? shuffleOptions(r.id, r.options) : r.options,
        answer: r.answer,
      })),
    ),
  );

  if (dryRun) {
    console.log('--dry-run: no rows written');
    return;
  }

  let written = 0;
  for (const u of updates) {
    await db.update(cards).set({ options: u.options }).where(eq(cards.id, u.id));
    written++;
    if (written % 200 === 0) console.log(`  ...${written}/${updates.length}`);
  }
  console.log(`✓ Updated ${written} card(s)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('shuffleCardOptions failed:', err);
    process.exit(1);
  });
