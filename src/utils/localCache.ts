/**
 * In-process TTL cache with a hard entry cap.
 *
 * Entries expire by wall-clock TTL, but nothing re-reads an expired key
 * when cache keys are unique per (user, version, offset) — so expiry alone
 * never reclaims memory. Two mechanisms keep it bounded:
 *
 *  1. On every `set`, if the map is at `maxEntries`, we first sweep all
 *     already-expired entries in one pass. That reclaims the common case
 *     (lots of short-TTL keys that aged out) cheaply and amortized.
 *  2. If the map is *still* at capacity after the sweep (many live
 *     entries), we evict the oldest-inserted key. Map preserves insertion
 *     order, so `keys().next()` is the oldest — an O(1) FIFO eviction.
 *
 * The cap is a memory safety valve, not a hit-rate tuning knob: 50k
 * entries is far above any realistic working set for a single instance,
 * but low enough that a traffic spike or key-space blow-up can't OOM the
 * container.
 */
export class LocalCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly defaultTtlMs: number,
    private readonly maxEntries = 50_000,
  ) {}

  get(key: string): T | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs = this.defaultTtlMs): void {
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      this.evict();
    }
    this.entries.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  /** Current entry count. Exposed for tests and memory diagnostics. */
  size(): number {
    return this.entries.size;
  }

  deleteByPrefix(prefix: string): void {
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  /** Reclaim room: drop all expired entries; if still full, FIFO-evict one. */
  private evict(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }
}
