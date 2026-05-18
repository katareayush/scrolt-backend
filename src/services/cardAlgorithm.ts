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
