import { describe, expect, it } from 'vitest';
import {
  rankCards,
  pickDailyIds,
  fnv1aNormalized,
  type CardMeta,
  type Weights,
} from '../src/services/cardAlgorithm';

/* ─── Fixtures ─────────────────────────────────────────────────── */

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
const CATEGORIES = ['everyday', 'emotion', 'social', 'opinion', 'work', 'precision'] as const;

function makeCatalog(n: number): CardMeta[] {
  const meta: CardMeta[] = [];
  for (let i = 0; i < n; i++) {
    meta.push({
      id: `card_${String(i).padStart(4, '0')}`,
      difficulty: DIFFICULTIES[i % 3]!,
      category: CATEGORIES[i % CATEGORIES.length]!,
    });
  }
  return meta;
}

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

/* ─── Tests ────────────────────────────────────────────────────── */

describe('fnv1aNormalized', () => {
  it('is deterministic for the same input', () => {
    expect(fnv1aNormalized('hello')).toBe(fnv1aNormalized('hello'));
    expect(fnv1aNormalized('user:2026-05-14:card_0001')).toBe(
      fnv1aNormalized('user:2026-05-14:card_0001'),
    );
  });

  it('returns values in [0, 1)', () => {
    for (const s of ['', 'a', 'abc', 'longer-string-with-various-chars-123']) {
      const v = fnv1aNormalized(s);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('distributes well across short keys', () => {
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 1000; i++) {
      const idx = Math.floor(fnv1aNormalized(`user_a:card_${i}`) * 10);
      buckets[idx]++;
    }
    // Each bucket should hold roughly 100. Very loose tolerance — we
    // only assert "not degenerate" (i.e. not all values clumping into
    // a few buckets). FNV-1a on incremental short keys is good but not
    // ideal, so we accept a wide variance.
    for (const b of buckets) {
      expect(b).toBeGreaterThan(20);
      expect(b).toBeLessThan(250);
    }
  });
});

describe('rankCards — feed algorithm', () => {
  it('excludes seen cards', () => {
    const meta = makeCatalog(20);
    const seen = new Set(meta.slice(0, 5).map((m) => m.id));
    const order = rankCards(meta, seen, {
      seedPrefix: 'u1:2026-05-14',
      weights: DEFAULT_WEIGHTS,
    });
    expect(order).toHaveLength(15);
    for (const id of order) expect(seen.has(id)).toBe(false);
  });

  it('produces no duplicates across cursored slices', () => {
    const meta = makeCatalog(200);
    const order = rankCards(meta, new Set(), {
      seedPrefix: 'u1:2026-05-14',
      weights: DEFAULT_WEIGHTS,
    });

    const pages: string[][] = [];
    const pageSize = 20;
    for (let off = 0; off < order.length; off += pageSize) {
      pages.push(order.slice(off, off + pageSize));
    }

    const all = pages.flat();
    expect(all).toHaveLength(meta.length);
    expect(new Set(all).size).toBe(all.length); // no dupes
  });

  it('is order-stable as the seen set grows (no shuffle drift)', () => {
    const meta = makeCatalog(100);
    const before = rankCards(meta, new Set(), {
      seedPrefix: 'u1:2026-05-14',
      weights: DEFAULT_WEIGHTS,
    });

    // Mark the first 10 as seen and re-rank.
    const seen = new Set(before.slice(0, 10));
    const after = rankCards(meta, seen, {
      seedPrefix: 'u1:2026-05-14',
      weights: DEFAULT_WEIGHTS,
    });

    // The remaining ids should appear in the same relative order.
    const expectedTail = before.slice(10);
    expect(after).toEqual(expectedTail);
  });

  it('is deterministic for the same seed', () => {
    const meta = makeCatalog(50);
    const a = rankCards(meta, new Set(), {
      seedPrefix: 'u1:2026-05-14',
      weights: DEFAULT_WEIGHTS,
    });
    const b = rankCards(meta, new Set(), {
      seedPrefix: 'u1:2026-05-14',
      weights: DEFAULT_WEIGHTS,
    });
    expect(a).toEqual(b);
  });

  it('produces different orderings for different users', () => {
    const meta = makeCatalog(50);
    const u1 = rankCards(meta, new Set(), {
      seedPrefix: 'u1:2026-05-14',
      weights: DEFAULT_WEIGHTS,
    });
    const u2 = rankCards(meta, new Set(), {
      seedPrefix: 'u2:2026-05-14',
      weights: DEFAULT_WEIGHTS,
    });
    expect(u1).not.toEqual(u2);
  });

  it('biases easy cards earlier when weights say so', () => {
    const meta = makeCatalog(300);
    const order = rankCards(meta, new Set(), {
      seedPrefix: 'u1:2026-05-14',
      weights: DEFAULT_WEIGHTS,
    });
    // Count difficulty distribution in the first 50 cards.
    const top = order.slice(0, 50);
    const counts = { easy: 0, medium: 0, hard: 0 };
    for (const id of top) {
      const m = meta.find((c) => c.id === id)!;
      counts[m.difficulty]++;
    }
    // Easy weight is 3× hard's — easy must outnumber hard in the head.
    expect(counts.easy).toBeGreaterThan(counts.hard);
  });

  it('boosts review-due cards into the head of the feed', () => {
    const meta = makeCatalog(100);
    // Pick 5 specific ids to mark as review-due.
    const dueIds = new Set(['card_0050', 'card_0060', 'card_0070', 'card_0080', 'card_0090']);

    const without = rankCards(meta, new Set(), {
      seedPrefix: 'u1:2026-05-14',
      weights: DEFAULT_WEIGHTS,
    });
    const withDue = rankCards(meta, new Set(), {
      seedPrefix: 'u1:2026-05-14',
      weights: DEFAULT_WEIGHTS,
      reviewDueIds: dueIds,
    });

    // Each due card should move strictly earlier with the boost (or
    // already be at position 0).
    for (const id of dueIds) {
      const before = without.indexOf(id);
      const after = withDue.indexOf(id);
      expect(after).toBeLessThanOrEqual(before);
    }
    // At least one moved up.
    const movedUp = [...dueIds].filter(
      (id) => withDue.indexOf(id) < without.indexOf(id),
    );
    expect(movedUp.length).toBeGreaterThan(0);
  });

  it('does not allow review-due cards that are also seen to re-enter', () => {
    const meta = makeCatalog(50);
    const dueIds = new Set(['card_0010']);
    const seenIds = new Set(['card_0010']);
    const order = rankCards(meta, seenIds, {
      seedPrefix: 'u1:2026-05-14',
      weights: DEFAULT_WEIGHTS,
      reviewDueIds: dueIds,
    });
    expect(order.includes('card_0010')).toBe(false);
  });
});

describe('pickDailyIds — daily challenge', () => {
  it('returns the same ids for every user on the same date', () => {
    const meta = makeCatalog(100);
    const a = pickDailyIds(meta, '2026-05-14', 10);
    const b = pickDailyIds(meta, '2026-05-14', 10);
    expect(a).toEqual(b);
    expect(a).toHaveLength(10);
  });

  it('returns a different set on a different date', () => {
    const meta = makeCatalog(100);
    const a = pickDailyIds(meta, '2026-05-14', 10);
    const b = pickDailyIds(meta, '2026-05-15', 10);
    expect(a).not.toEqual(b);
  });

  it('respects the catalog size when count > catalog', () => {
    const meta = makeCatalog(5);
    const ids = pickDailyIds(meta, '2026-05-14', 10);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
  });
});
