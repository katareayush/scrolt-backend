import { describe, expect, it } from 'vitest';
import {
  weightsForLevel,
  clampLevel,
  rankCards,
  MAX_DIFFICULTY_LEVEL,
  type CardMeta,
  type Weights,
} from '../src/services/cardAlgorithm';

const CATEGORIES = ['everyday', 'emotion', 'social', 'opinion', 'work', 'precision'] as const;

const FLAT_CATEGORIES: Weights['categories'] = {
  everyday: 1, emotion: 1, social: 1, opinion: 1, work: 1, precision: 1,
};

/** Equal thirds easy/medium/hard, so tier mix is the only variable. */
function makeCatalog(n: number): CardMeta[] {
  const tiers = ['easy', 'medium', 'hard'] as const;
  return Array.from({ length: n }, (_, i) => ({
    id: `card_${String(i).padStart(4, '0')}`,
    difficulty: tiers[i % 3]!,
    category: CATEGORIES[i % CATEGORIES.length]!,
  }));
}

/** Share of the first `take` ranked cards that are `hard`. */
function hardShare(level: number, take = 30): number {
  const meta = makeCatalog(300);
  const byId = new Map(meta.map((m) => [m.id, m]));
  const ranked = rankCards(meta, new Set(), {
    seedPrefix: 'user_1:2026-07-26',
    weights: { ...weightsForLevel(level), categories: FLAT_CATEGORIES },
  });
  const head = ranked.slice(0, take);
  return head.filter((id) => byId.get(id)!.difficulty === 'hard').length / head.length;
}

describe('difficulty ladder — weights', () => {
  it('gets strictly harder at every rung', () => {
    for (let l = 1; l <= MAX_DIFFICULTY_LEVEL; l++) {
      const prev = weightsForLevel(l - 1);
      const cur = weightsForLevel(l);
      expect(cur.hard, `hard should rise at level ${l}`).toBeGreaterThan(prev.hard);
      expect(cur.easy, `easy should fall at level ${l}`).toBeLessThan(prev.easy);
    }
  });

  it('never zeroes a tier, so the feed can always be filled', () => {
    // A zero weight would divide the score by ~0 and effectively remove
    // the tier — a user who exhausted the hard pool would hit an empty
    // deck instead of falling back to medium.
    for (let l = 0; l <= MAX_DIFFICULTY_LEVEL; l++) {
      const w = weightsForLevel(l);
      expect(w.easy).toBeGreaterThan(0);
      expect(w.medium).toBeGreaterThan(0);
      expect(w.hard).toBeGreaterThan(0);
    }
  });

  it('returns a copy — callers must not be able to mutate the table', () => {
    const a = weightsForLevel(2);
    a.hard = 999;
    expect(weightsForLevel(2).hard).not.toBe(999);
  });

  it('clamps out-of-range, fractional and junk levels', () => {
    expect(clampLevel(-5)).toBe(0);
    expect(clampLevel(0)).toBe(0);
    expect(clampLevel(2.7)).toBe(2);
    expect(clampLevel(999)).toBe(MAX_DIFFICULTY_LEVEL);
    expect(clampLevel('3')).toBe(3);
    expect(clampLevel('nonsense')).toBe(0);
    expect(clampLevel(undefined)).toBe(0);
    expect(clampLevel(NaN)).toBe(0);
  });
});

describe('difficulty ladder — effect on the actual ranking', () => {
  it('surfaces more hard cards as the level climbs', () => {
    const shares = Array.from({ length: MAX_DIFFICULTY_LEVEL + 1 }, (_, l) => hardShare(l));
    // Monotonically non-decreasing, and a real spread end to end.
    for (let l = 1; l < shares.length; l++) {
      expect(shares[l]!, `level ${l} vs ${l - 1}`).toBeGreaterThanOrEqual(shares[l - 1]!);
    }
    expect(shares[0]!).toBeLessThan(0.25);
    expect(shares[MAX_DIFFICULTY_LEVEL]!).toBeGreaterThan(0.6);
  });

  it('still returns the whole unseen catalog at the top rung', () => {
    // Weighting reorders; it must never drop cards. This is what stops a
    // high-level user from running out of feed.
    const meta = makeCatalog(120);
    const ranked = rankCards(meta, new Set(), {
      seedPrefix: 'user_1:2026-07-26',
      weights: { ...weightsForLevel(MAX_DIFFICULTY_LEVEL), categories: FLAT_CATEGORIES },
    });
    expect(ranked).toHaveLength(120);
    expect(new Set(ranked).size).toBe(120);
  });

  it('is deterministic for a given user, day and level', () => {
    expect(hardShare(3)).toBe(hardShare(3));
  });
});
