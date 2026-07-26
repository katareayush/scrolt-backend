/**
 * Pure card-selection algorithm.
 *
 * Lives in its own module so unit tests can import the algorithm
 * without dragging in the DB / Redis / env validators that the rest of
 * `cardService` depends on.
 */

export interface CardMeta {
  id: string;
  difficulty: 'easy' | 'medium' | 'hard';
  category: string;
}

export interface Weights {
  easy: number;
  medium: number;
  hard: number;
  categories: {
    everyday: number;
    emotion: number;
    social: number;
    opinion: number;
    work: number;
    precision: number;
  };
}

/**
 * Difficulty ladder.
 *
 * The feed climbs a rung for every run of consecutive correct answers
 * (see the client's `difficultyLadder`), and each rung re-weights the
 * catalog toward harder cards.
 *
 * These are *weights*, not filters, and no tier is ever zero. That is
 * deliberate: `rankCards` ranks the whole unseen catalog, so a heavily
 * weighted tier surfaces first but the feed can never run dry — a user
 * at the top rung who has exhausted every hard card still gets a feed,
 * just a mostly-medium one. Filtering would strand them on an empty
 * deck, which is the failure mode this design exists to avoid.
 *
 * Monotonic by construction: easy falls, hard rises, every step.
 */
export const MAX_DIFFICULTY_LEVEL = 4;

const LEVEL_WEIGHTS: ReadonlyArray<{ easy: number; medium: number; hard: number }> = [
  { easy: 3.0, medium: 2.0, hard: 1.0 }, // 0 — the default mix
  { easy: 1.6, medium: 3.0, hard: 1.6 }, // 1 — medium-leaning
  { easy: 0.8, medium: 2.4, hard: 3.0 }, // 2 — hard starts to lead
  { easy: 0.4, medium: 1.6, hard: 4.0 }, // 3 — hard-dominant
  { easy: 0.2, medium: 1.0, hard: 5.0 }, // 4 — as hard as the catalog goes
];

/** Clamp an arbitrary number to a valid rung. */
export function clampLevel(level: unknown): number {
  const n = typeof level === 'number' ? level : Number(level);
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_DIFFICULTY_LEVEL, Math.max(0, Math.floor(n)));
}

/** Per-difficulty weights for a ladder rung. */
export function weightsForLevel(level: number): { easy: number; medium: number; hard: number } {
  // Non-null is safe: clampLevel pins the index into [0, MAX].
  return { ...LEVEL_WEIGHTS[clampLevel(level)]! };
}

export interface SelectOptions {
  /** Per-user, per-day seed prefix (e.g. `userId:2026-05-14`). */
  seedPrefix: string;
  weights: Weights;
  /**
   * Cards the user answered wrong more than the cooldown window ago.
   * These get a 3× scoring boost so they surface before brand-new ones.
   */
  reviewDueIds?: Set<string>;
}

/**
 * FNV-1a 32-bit hash, normalized to [0, 1).
 *
 * - ~2× faster than crypto-grade hashes.
 * - Deterministic + well-distributed for short keys.
 * - Stable across Node versions (only uses charCodeAt and Math.imul).
 */
export function fnv1aNormalized(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h / 4294967295;
}

/**
 * Deterministic option order — the catalog is generated answer-first, so
 * stored order can't be trusted. Hashing the option TEXT (not its index)
 * makes this stable per card and idempotent, so it can also be applied to
 * cached payloads written before this existed.
 */
export function shuffleOptions(cardId: string, options: string[]): string[] {
  return options
    .map((option) => ({ option, score: fnv1aNormalized(`${cardId}:${option}`) }))
    .sort((a, b) => a.score - b.score || (a.option < b.option ? -1 : 1))
    .map((s) => s.option);
}

/** {@link shuffleOptions} applied to a whole card row. */
export function withShuffledOptions<T extends { id: string; options: string[] }>(
  card: T,
): T {
  if (!Array.isArray(card.options)) return card;
  return { ...card, options: shuffleOptions(card.id, card.options) };
}

/**
 * Rank a catalog by per-user/per-day deterministic score. Lower score =
 * earlier in the feed. Cards already in `seenIds` are filtered out.
 *
 * Stability guarantee: removing a card from the catalog does NOT change
 * the relative order of the remaining cards, so the cursor offsets used
 * by `getBatch` stay meaningful as the user answers cards.
 */
export function rankCards(
  allMeta: CardMeta[],
  seenIds: Set<string>,
  opts: SelectOptions,
): string[] {
  const reviewDue = opts.reviewDueIds ?? new Set<string>();
  const scored: { id: string; score: number }[] = [];
  for (const m of allMeta) {
    if (seenIds.has(m.id)) continue;
    const baseWeight =
      opts.weights[m.difficulty] *
      (opts.weights.categories[m.category as keyof Weights['categories']] ?? 1);
    const reviewBoost = reviewDue.has(m.id) ? 3 : 1;
    const weight = baseWeight * reviewBoost;
    const hash = fnv1aNormalized(opts.seedPrefix + ':' + m.id);
    scored.push({ id: m.id, score: hash / Math.max(weight, 0.0001) });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.map((s) => s.id);
}

/**
 * Deterministic global daily-challenge selection. Same `dateStr` =
 * same N ids, regardless of user.
 */
export function pickDailyIds(
  allMeta: CardMeta[],
  dateStr: string,
  count: number,
): string[] {
  return allMeta
    .map((m) => ({ id: m.id, score: fnv1aNormalized(`daily:${dateStr}:${m.id}`) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, Math.min(count, allMeta.length))
    .map((s) => s.id);
}
