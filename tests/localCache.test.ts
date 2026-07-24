import { describe, expect, it } from 'vitest';
import { LocalCache } from '../src/utils/localCache';

describe('LocalCache', () => {
  it('returns stored values before expiry and null after', async () => {
    const cache = new LocalCache<string>(20);
    cache.set('k', 'v');
    expect(cache.get('k')).toBe('v');
    await new Promise((r) => setTimeout(r, 30));
    expect(cache.get('k')).toBeNull();
  });

  it('never exceeds maxEntries even with all-unique keys (the leak guard)', () => {
    // Long TTL so nothing expires — this is the case the old cache leaked:
    // unique keys per (user, version, offset) that are never re-read.
    const cap = 100;
    const cache = new LocalCache<number>(60_000, cap);
    for (let i = 0; i < cap * 50; i++) cache.set(`user_${i}`, i);
    expect(cache.size()).toBeLessThanOrEqual(cap);
  });

  it('sweeps expired entries to make room before FIFO-evicting live ones', async () => {
    const cap = 10;
    const cache = new LocalCache<number>(15, cap);
    for (let i = 0; i < cap; i++) cache.set(`old_${i}`, i);
    await new Promise((r) => setTimeout(r, 25)); // all expire
    // One more insert should reclaim the expired entries, not evict live ones.
    cache.set('fresh', 999);
    expect(cache.get('fresh')).toBe(999);
    expect(cache.size()).toBe(1);
  });

  it('deleteByPrefix removes only matching keys', () => {
    const cache = new LocalCache<number>(60_000);
    cache.set('batch:userA:1', 1);
    cache.set('batch:userA:2', 2);
    cache.set('batch:userB:1', 3);
    cache.deleteByPrefix('batch:userA:');
    expect(cache.get('batch:userA:1')).toBeNull();
    expect(cache.get('batch:userA:2')).toBeNull();
    expect(cache.get('batch:userB:1')).toBe(3);
  });
});
