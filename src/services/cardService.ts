import { db } from '../db/connection';
import { cards, userProgress } from '../db/schema';
import { eq, sql, inArray, and } from 'drizzle-orm';
import type { Card } from '../db/schema';
import { redis } from '../config/redis';
import {
  rankCards,
  pickDailyIds,
  fnv1aNormalized,
  type CardMeta,
  type Weights,
} from './cardAlgorithm';

export { rankCards, pickDailyIds, fnv1aNormalized };
export type { CardMeta, Weights };

/**
 * Card selection service.
 *
 * ─── Algorithm (no repeats, deterministic, fast) ──────────────────
 *
 * 1. Catalog metadata (id + difficulty + category for every card) is
 *    cached globally in Redis with a 1-hour TTL — one query feeds every
 *    user's batch request.
 * 2. The user's "seen" card-id set is cached per-user.
 * 3. Each card gets a deterministic score = FNV1a(userId:YYYY-MM-DD:cardId)
 *    divided by its difficulty×category weight. Sorting by score yields
 *    a STABLE, weighted, per-user-per-day shuffle of unseen cards.
 *    - Stable: removing a card (because the user just answered it)
 *      preserves the relative order of the rest. Cursor offsets stay
 *      meaningful.
 *    - Deterministic: same user + same day = same order across reloads.
 *    - Daily-varied: new day = new shuffle, so the user doesn't always
 *      see the same "next 20" if they leave and come back.
 * 4. Cursor is the integer offset into the sorted-unseen list. No SQL
 *    random(), no `id > prevId` drift.
 * 5. Only the sliced page is fetched from `cards`. Everything else runs
 *    in memory against the metadata cache.
 *
 * ─── Invalidation ─────────────────────────────────────────────────
 *
 * Per-user batch caches are keyed by a monotonically incrementing
 * cache-version number (`user:{id}:v`). Invalidation = `INCR` on that
 * key. Old keys orphan and TTL-expire naturally. This avoids
 * `redis.keys(...)` which is O(N) and blocking on Upstash.
 */
export class CardService {
  private static readonly BATCH_TTL = 15 * 60;
  private static readonly SEEN_CARDS_TTL = 30 * 60;
  private static readonly PROGRESS_TTL = 5 * 60;
  private static readonly STREAK_TTL = 5 * 60;
  private static readonly METADATA_TTL = 60 * 60;
  private static readonly METADATA_KEY = 'catalog:metadata:v1';

  private getCacheKey(prefix: string, ...keys: string[]): string {
    return `${prefix}:${keys.join(':')}`;
  }

  private async getCardMetadata(): Promise<CardMeta[]> {
    try {
      const cached = await redis.get(CardService.METADATA_KEY);
      if (cached) return JSON.parse(cached as string) as CardMeta[];
    } catch (err) {
      console.warn('Metadata cache read error:', err);
    }

    const rows = await db
      .select({
        id: cards.id,
        difficulty: cards.difficulty,
        category: cards.category,
      })
      .from(cards);
    const meta: CardMeta[] = rows.map((r) => ({
      id: r.id,
      difficulty: r.difficulty,
      category: r.category,
    }));

    try {
      await redis.set(CardService.METADATA_KEY, JSON.stringify(meta), {
        ex: CardService.METADATA_TTL,
      });
    } catch (err) {
      console.warn('Metadata cache write error:', err);
    }
    return meta;
  }

  /** Bust the global catalog cache after seed/admin changes to `cards`. */
  async invalidateCatalog(): Promise<void> {
    try {
      await redis.del(CardService.METADATA_KEY);
    } catch (err) {
      console.warn('Catalog invalidation error:', err);
    }
  }

  private async getUserCacheVersion(userId: string): Promise<string> {
    try {
      const v = await redis.get(this.getCacheKey('user', userId, 'v'));
      if (v != null) return String(v);
    } catch (err) {
      console.warn('User cache version read error:', err);
    }
    return '1';
  }

  async getBatch(
    userId: string,
    count: number = 10,
    cursor?: string,
    preferredDifficulty?: string,
    preferredCategory?: string,
  ): Promise<{ cards: Card[]; nextCursor: string | undefined; hasMore: boolean }> {
    const offset = cursor ? Math.max(0, parseInt(cursor, 10) || 0) : 0;

    const version = await this.getUserCacheVersion(userId);
    const batchKey = this.getCacheKey(
      'batch',
      userId,
      version,
      count.toString(),
      offset.toString(),
      preferredDifficulty ?? '_',
      preferredCategory ?? '_',
    );

    try {
      const cached = await redis.get(batchKey);
      if (cached) return JSON.parse(cached as string);
    } catch (err) {
      console.warn('Batch cache read error:', err);
    }

    // Catalog metadata, seen-ids, and review-due ids in parallel.
    const [allMeta, seenIds, reviewDue] = await Promise.all([
      this.getCardMetadata(),
      this.getSeenCardIds(userId),
      this.getCardsDueForReview(userId),
    ]);

    const seenSet = new Set(seenIds);
    const seedPrefix = this.dailySeedPrefix(userId);
    const weights = this.calculateWeights(preferredDifficulty, preferredCategory);

    // Use the pure ranker so behavior is identical to what unit tests
    // verify. Review-due cards (wrong > 24h ago) get a 3× scoring boost.
    const ranked = rankCards(allMeta, seenSet, {
      seedPrefix,
      weights,
      reviewDueIds: reviewDue,
    });
    const scored = ranked.map((id) => ({ id, score: 0 })); // alias for the legacy var name below

    if (offset >= scored.length) {
      const empty = { cards: [] as Card[], nextCursor: undefined, hasMore: false };
      try {
        await redis.set(batchKey, JSON.stringify(empty), { ex: CardService.BATCH_TTL });
      } catch {
        /* swallow */
      }
      return empty;
    }

    const slice = scored.slice(offset, offset + count);

    // Single indexed DB hit for the slice's full card data.
    const cardRows =
      slice.length > 0
        ? await db.select().from(cards).where(inArray(cards.id, slice.map((s) => s.id)))
        : [];
    const lookup = new Map(cardRows.map((c) => [c.id, c] as const));
    const orderedCards = slice
      .map((s) => lookup.get(s.id))
      .filter((c): c is Card => Boolean(c));

    const hasMore = offset + count < scored.length;
    const nextCursor = hasMore ? String(offset + count) : undefined;

    const result = { cards: orderedCards, nextCursor, hasMore };

    try {
      await redis.set(batchKey, JSON.stringify(result), { ex: CardService.BATCH_TTL });
    } catch (err) {
      console.warn('Batch cache write error:', err);
    }
    return result;
  }

  async getNextCard(userId: string): Promise<Card | null> {
    const batch = await this.getBatch(userId, 1);
    return batch.cards[0] || null;
  }

  /**
   * Returns the same N cards for every user on a given UTC date.
   *
   * Selection is a deterministic shuffle (FNV-1a hash of
   * `daily:{dateStr}:{cardId}`, sort ascending, take first N). No
   * personalization — that's the point: shared experience drives the
   * leaderboard and "did you play today" social signal.
   *
   * Cached globally per date for a day; cache is set on first request
   * of the day and never invalidated (the seed is the date itself).
   */
  async getDailyCards(dateStr: string, count = 10): Promise<Card[]> {
    const cacheKey = `daily:cards:${dateStr}:${count}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached as string) as Card[];
    } catch (err) {
      console.warn('Daily cache read error:', err);
    }

    const allMeta = await this.getCardMetadata();
    if (allMeta.length === 0) return [];

    const ids = pickDailyIds(allMeta, dateStr, count);

    const cardRows = await db
      .select()
      .from(cards)
      .where(inArray(cards.id, ids));
    const lookup = new Map(cardRows.map((c) => [c.id, c] as const));
    const ordered = ids
      .map((id) => lookup.get(id))
      .filter((c): c is Card => Boolean(c));

    try {
      // 25h TTL: covers any timezone edge near midnight.
      await redis.set(cacheKey, JSON.stringify(ordered), { ex: 60 * 60 * 25 });
    } catch (err) {
      console.warn('Daily cache write error:', err);
    }
    return ordered;
  }

  /** Today's UTC date in `YYYY-MM-DD`. */
  static todayUtc(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Record an answered card. Idempotent on the composite PK; a retry of
   * the same (user, card) is a no-op at the DB layer.
   *
   * Wrong answers update the existing row so the spaced-repetition
   * filter can find them; right answers never overwrite (so a later
   * correct attempt promotes a previously-wrong card back to "done").
   */
  async markCardAsAnswered(userId: string, cardId: string, correct?: boolean): Promise<void> {
    const result = await db
      .insert(userProgress)
      .values({ userId, cardId, answeredAt: new Date(), correct: correct ?? null })
      .onConflictDoUpdate({
        target: [userProgress.userId, userProgress.cardId],
        // Only "upgrade" the row when this attempt was correct. Keeps
        // wrong answers visible to spaced-repetition until the user
        // eventually gets them right.
        set: {
          correct: sql`CASE WHEN ${userProgress.correct} IS DISTINCT FROM TRUE AND ${correct ?? null} = TRUE THEN TRUE ELSE ${userProgress.correct} END`,
          answeredAt: sql`CASE WHEN ${userProgress.correct} IS DISTINCT FROM TRUE AND ${correct ?? null} = TRUE THEN NOW() ELSE ${userProgress.answeredAt} END`,
        },
      });

    const affected = (result as unknown as { rowCount?: number }).rowCount ?? 0;
    if (affected > 0) {
      await this.invalidateUser(userId);
    }
  }

  /**
   * Spaced-repetition window: a wrong answer earns the card a 24h
   * cooldown, then it re-enters the unseen pool with boosted priority.
   * Set to 0 to disable (e.g. inside tests).
   */
  private static readonly RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

  /**
   * Ids the user has effectively "completed" — correct, unknown
   * correctness, or wrong within the retry window. Cards excluded from
   * this set will re-enter the feed via spaced repetition.
   */
  async getSeenCardIds(userId: string): Promise<string[]> {
    const cacheKey = this.getCacheKey('seen_cards', userId);
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached as string) as string[];
    } catch (err) {
      console.warn('Seen-cards cache read error:', err);
    }

    // Pull both ids and answer state so we can apply the retry window
    // in one pass.
    const rows = await db
      .select({
        cardId: userProgress.cardId,
        correct: userProgress.correct,
        answeredAt: userProgress.answeredAt,
      })
      .from(userProgress)
      .where(eq(userProgress.userId, userId));

    const cutoff = Date.now() - CardService.RETRY_WINDOW_MS;
    const result: string[] = [];
    for (const row of rows) {
      const wrongAndDue =
        row.correct === false &&
        new Date(row.answeredAt).getTime() <= cutoff;
      // wrongAndDue cards drop out of the seen set so they re-appear.
      if (!wrongAndDue) result.push(row.cardId);
    }

    try {
      await redis.set(cacheKey, JSON.stringify(result), {
        ex: CardService.SEEN_CARDS_TTL,
      });
    } catch (err) {
      console.warn('Seen-cards cache write error:', err);
    }
    return result;
  }

  /**
   * Cards the user has answered correctly, most recent first. Drives
   * the /words collection page. Capped per-request to keep the payload
   * sane on power users.
   */
  async getMasteredCards(userId: string, limit = 200): Promise<Card[]> {
    const cap = Math.max(1, Math.min(limit, 1000));
    const rows = await db.execute(sql`
      SELECT c.*
      FROM user_progress p
      JOIN cards c ON c.id = p.card_id
      WHERE p.user_id = ${userId}
        AND p.correct = TRUE
      ORDER BY p.answered_at DESC
      LIMIT ${cap}
    `);
    return ((rows as unknown as { rows: Card[] }).rows ?? []);
  }

  /**
   * Most recently wrong cards, ordered newest-first. Used by /review.
   *
   * Returns full Card objects (not just ids) because the review page
   * needs them immediately and the set is small (capped at `limit`).
   */
  async getWrongCards(userId: string, limit = 50): Promise<Card[]> {
    const cap = Math.max(1, Math.min(limit, 200));
    const rows = await db.execute(sql`
      SELECT c.*
      FROM user_progress p
      JOIN cards c ON c.id = p.card_id
      WHERE p.user_id = ${userId}
        AND p.correct = FALSE
      ORDER BY p.answered_at DESC
      LIMIT ${cap}
    `);
    return ((rows as unknown as { rows: Card[] }).rows ?? []);
  }

  /**
   * Cards the user got wrong more than {@link RETRY_WINDOW_MS} ago.
   * The algorithm gives these a scoring boost so they surface earlier
   * than brand-new cards — the user retries them while they're still
   * fresh in memory.
   */
  async getCardsDueForReview(userId: string): Promise<Set<string>> {
    const cacheKey = this.getCacheKey('review_due', userId);
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return new Set(JSON.parse(cached as string) as string[]);
    } catch (err) {
      console.warn('Review-due cache read error:', err);
    }

    const cutoff = new Date(Date.now() - CardService.RETRY_WINDOW_MS);
    const dueRows = await db.execute(sql`
      SELECT card_id
      FROM user_progress
      WHERE user_id = ${userId}
        AND correct = FALSE
        AND answered_at <= ${cutoff.toISOString()}
    `);
    const dueSet = new Set<string>(
      ((dueRows as unknown as { rows: { card_id: string }[] }).rows ?? []).map(
        (r) => r.card_id,
      ),
    );

    try {
      await redis.set(
        cacheKey,
        JSON.stringify(Array.from(dueSet)),
        { ex: 10 * 60 },
      );
    } catch (err) {
      console.warn('Review-due cache write error:', err);
    }
    return dueSet;
  }

  async getUserProgress(
    userId: string,
  ): Promise<{ totalCards: number; seenCards: number; completedPercentage: number }> {
    const cacheKey = this.getCacheKey('progress', userId);
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached as string);
    } catch (err) {
      console.warn('Progress cache read error:', err);
    }

    // Use the cached catalog count for totals — no need to COUNT(cards)
    // on every progress check.
    const meta = await this.getCardMetadata();
    const seenResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(userProgress)
      .where(eq(userProgress.userId, userId));

    const totalCards = meta.length;
    const seenCards = Number(seenResult[0]?.count ?? 0);
    const completedPercentage =
      totalCards > 0 ? Math.round((seenCards / totalCards) * 100) : 0;

    const result = { totalCards, seenCards, completedPercentage };
    try {
      await redis.set(cacheKey, JSON.stringify(result), {
        ex: CardService.PROGRESS_TTL,
      });
    } catch (err) {
      console.warn('Progress cache write error:', err);
    }
    return result;
  }

  async getStreak(userId: string): Promise<{
    streak: number;
    todayCount: number;
    totalAnswered: number;
    lastAnsweredAt: string | null;
  }> {
    const cacheKey = this.getCacheKey('streak', userId);
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached as string);
    } catch (err) {
      console.warn('Streak cache read error:', err);
    }

    const dayRows = await db.execute(sql`
      SELECT DISTINCT DATE(answered_at AT TIME ZONE 'UTC') AS day
      FROM user_progress
      WHERE user_id = ${userId}
      ORDER BY day DESC
      LIMIT 365
    `);
    const days: string[] = ((dayRows as unknown as { rows: { day: string }[] }).rows ?? []).map(
      (r) => r.day,
    );

    let streak = 0;
    if (days.length > 0) {
      const todayStr = new Date().toISOString().slice(0, 10);
      const cursor = new Date(`${todayStr}T00:00:00.000Z`);
      const mostRecent = new Date(`${days[0]}T00:00:00.000Z`);
      const diffDays = Math.round(
        (cursor.getTime() - mostRecent.getTime()) / 86_400_000,
      );
      if (diffDays <= 1) {
        let expected = new Date(mostRecent);
        for (const day of days) {
          const d = new Date(`${day}T00:00:00.000Z`);
          if (d.getTime() === expected.getTime()) {
            streak++;
            expected.setUTCDate(expected.getUTCDate() - 1);
          } else {
            break;
          }
        }
      }
    }

    const todayUtc = new Date().toISOString().slice(0, 10);
    const aggRows = await db.execute(sql`
      SELECT
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE DATE(answered_at AT TIME ZONE 'UTC') = ${todayUtc})::text AS today_count,
        MAX(answered_at)::text AS last_at
      FROM user_progress
      WHERE user_id = ${userId}
    `);
    const agg =
      ((aggRows as unknown as {
        rows: { total: string; today_count: string; last_at: string | null }[];
      }).rows ?? [])[0] ?? { total: '0', today_count: '0', last_at: null };

    const result = {
      streak,
      todayCount: Number(agg.today_count) || 0,
      totalAnswered: Number(agg.total) || 0,
      lastAnsweredAt: agg.last_at,
    };

    try {
      await redis.set(cacheKey, JSON.stringify(result), {
        ex: CardService.STREAK_TTL,
      });
    } catch (err) {
      console.warn('Streak cache write error:', err);
    }
    return result;
  }

  private dailySeedPrefix(userId: string): string {
    return `${userId}:${new Date().toISOString().slice(0, 10)}`;
  }

  private calculateWeights(
    preferredDifficulty?: string,
    preferredCategory?: string,
  ): Weights {
    const w: Weights = {
      easy: 3.0,
      medium: 2.0,
      hard: 1.0,
      categories: {
        everyday: 2.5,
        emotion: 2.0,
        social: 2.0,
        opinion: 1.8,
        work: 1.5,
        precision: 1.2,
      },
    };
    if (preferredDifficulty === 'easy') w.easy = 4.0;
    else if (preferredDifficulty === 'medium') w.medium = 3.5;
    else if (preferredDifficulty === 'hard') w.hard = 3.0;

    if (
      preferredCategory &&
      preferredCategory in w.categories
    ) {
      w.categories[preferredCategory as keyof Weights['categories']] = 3.5;
    }
    return w;
  }

  /**
   * Invalidate per-user caches. Bumps the user's cache version so all
   * existing batch keys become orphaned (no expensive scan/delete).
   * Also drops the seen-cards/progress/streak keys directly.
   */
  async invalidateUser(userId: string): Promise<void> {
    try {
      const versionKey = this.getCacheKey('user', userId, 'v');
      await Promise.all([
        redis.incr(versionKey),
        redis.del(this.getCacheKey('seen_cards', userId)),
        redis.del(this.getCacheKey('progress', userId)),
        redis.del(this.getCacheKey('streak', userId)),
        redis.del(this.getCacheKey('review_due', userId)),
      ]);
      // Keep the version key around for a long time so consumers see a
      // stable version across short-lived restarts.
      await redis.expire(versionKey, 60 * 60 * 24 * 30);
    } catch (err) {
      console.warn('Cache invalidation error:', err);
    }
  }
}

