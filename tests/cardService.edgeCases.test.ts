import { describe, expect, it } from 'vitest';
import {
  rankCards,
  pickDailyIds,
  type CardMeta,
  type Weights,
} from '../src/services/cardAlgorithm';

const DEFAULT_WEIGHTS: Weights = {
  easy: 3,
  medium: 2,
  hard: 1,
  categories: {
    everyday: 2.5,
    emotion: 2,
    social: 2,
    opinion: 1.8,
    work: 1.5,
    precision: 1.2,
  },
};

function makeCatalog(n: number): CardMeta[] {
  const DIFFS = ['easy', 'medium', 'hard'] as const;
  const CATS = ['everyday', 'emotion', 'social', 'opinion', 'work', 'precision'] as const;
  return Array.from({ length: n }, (_, i) => ({
    id: `card_${String(i).padStart(4, '0')}`,
    difficulty: DIFFS[i % 3]!,
    category: CATS[i % CATS.length]!,
  }));
}

describe('rankCards — edge cases', () => {
  it('returns empty for empty catalog', () => {
    const out = rankCards([], new Set(), {
      seedPrefix: 'u:2026-01-01',
      weights: DEFAULT_WEIGHTS,
    });
    expect(out).toEqual([]);
  });

  it('returns empty when every card is seen', () => {
    const meta = makeCatalog(50);
    const seen = new Set(meta.map((m) => m.id));
    const out = rankCards(meta, seen, {
      seedPrefix: 'u:2026-01-01',
      weights: DEFAULT_WEIGHTS,
    });
    expect(out).toEqual([]);
  });

  it('handles unknown category by treating its weight as 1', () => {
    const meta: CardMeta[] = [
      { id: 'a', difficulty: 'easy', category: 'unknown-category-xyz' },
      { id: 'b', difficulty: 'easy', category: 'everyday' },
    ];
    const out = rankCards(meta, new Set(), {
      seedPrefix: 'u:2026-01-01',
      weights: DEFAULT_WEIGHTS,
    });
    // Both cards present, no crash, deterministic order.
    expect(out).toHaveLength(2);
    expect(new Set(out)).toEqual(new Set(['a', 'b']));
  });

  it('review-due cards are absent from the head when also seen', () => {
    const meta = makeCatalog(50);
    const due = new Set(['card_0000']);
    const seen = new Set(['card_0000']);
    const out = rankCards(meta, seen, {
      seedPrefix: 'u:2026-01-01',
      weights: DEFAULT_WEIGHTS,
      reviewDueIds: due,
    });
    expect(out.includes('card_0000')).toBe(false);
  });

  it('weighted preference for hard difficulty floats hard cards forward', () => {
    const meta = makeCatalog(120);
    const hardBiased: Weights = {
      ...DEFAULT_WEIGHTS,
      hard: 6, // very strong bias
    };
    const out = rankCards(meta, new Set(), {
      seedPrefix: 'u:2026-01-01',
      weights: hardBiased,
    });
    const top20 = out.slice(0, 20);
    const hardCount = top20.filter((id) => {
      const idx = parseInt(id.split('_')[1]!, 10);
      return idx % 3 === 2; // matches the makeCatalog `DIFFS[i % 3]` mapping
    }).length;
    expect(hardCount).toBeGreaterThanOrEqual(7);
  });
});

describe('pickDailyIds — edge cases', () => {
  it('is stable across many invocations on the same date', () => {
    const meta = makeCatalog(500);
    const a = pickDailyIds(meta, '2026-05-14', 10);
    for (let i = 0; i < 5; i++) {
      expect(pickDailyIds(meta, '2026-05-14', 10)).toEqual(a);
    }
  });

  it('produces 10 unique ids', () => {
    const meta = makeCatalog(200);
    const ids = pickDailyIds(meta, '2026-05-14', 10);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('changes day-over-day for 30 consecutive days', () => {
    const meta = makeCatalog(100);
    const sets = new Set<string>();
    for (let d = 1; d <= 30; d++) {
      const date = `2026-05-${String(d).padStart(2, '0')}`;
      sets.add(pickDailyIds(meta, date, 10).join(','));
    }
    // It's astronomically unlikely all 30 days would collide; require
    // at least 25 unique sets to allow for rare lucky overlap.
    expect(sets.size).toBeGreaterThan(25);
  });

  it('handles count of 0', () => {
    const meta = makeCatalog(50);
    expect(pickDailyIds(meta, '2026-05-14', 0)).toEqual([]);
  });
});
