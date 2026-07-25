import { sql } from 'drizzle-orm';
import { db } from '../db/connection';
import { env } from '../config/env';
import { logger } from '../middleware/logger';

/**
 * Read-side aggregations for the admin dashboard.
 *
 * Two design decisions worth knowing before editing:
 *
 * 1. ACTIVITY IS A UNION OF THREE TABLES. `analytics_events` only starts
 *    filling up once the instrumented frontend ships, so every
 *    engagement/retention metric also reads `user_progress.answered_at`
 *    and `daily_results.completed_at`. That makes the dashboard useful
 *    on day one with full historical backfill instead of showing empty
 *    charts for a month. Mode attribution is the one thing that can only
 *    come from events.
 *
 * 2. LOGGED-OUT USERS COUNT. Anonymous ids are `anon_*` (see the comment
 *    on `user_progress` in schema.ts) and represent real usage — most
 *    first sessions are anonymous. Every metric here is reported three
 *    ways: all / signed-in / anonymous. `IS_ANON` is the single source
 *    of truth for that split.
 *
 * A note on the anon count: an id is per-browser-profile, and signing in
 * migrates the anon rows onto the real account (auth/claim-anon), so
 * "anonymous users" means distinct un-converted browsers, not people.
 */

/**
 * Anonymous-id predicate. `ESCAPE '@'` so the underscore in `anon_` is
 * matched literally without backslash escaping getting mangled between
 * the JS template literal and the SQL string literal.
 */
const IS_ANON = sql`user_id LIKE 'anon@_%' ESCAPE '@'`;

/**
 * Every recorded interaction, one row per (user, moment), across all
 * three sources. Used for DAU/WAU/MAU, retention and per-user recency.
 */
const ACTIVITY = sql`
  SELECT user_id, answered_at AS ts FROM user_progress
  UNION ALL
  SELECT user_id, completed_at AS ts FROM daily_results
  UNION ALL
  SELECT user_id, at AS ts FROM analytics_events
`;

/** One row per (user, calendar day) they were active on. */
const ACTIVE_DAYS = sql`
  SELECT user_id, ts::date AS day
  FROM (${ACTIVITY}) AS activity
  GROUP BY 1, 2
`;

/**
 * pg returns BIGINT/NUMERIC as strings (they can exceed Number.MAX_SAFE_INTEGER).
 * Every count here is far below that, so coerce for JSON output.
 */
function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** `Date` | ISO string | 'YYYY-MM-DD' → 'YYYY-MM-DD'. */
function day(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? '').slice(0, 10);
}

/** Percentage with one decimal, or null when the denominator is 0. */
function pct(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * drizzle's `db.execute` returns the pg result; `.rows` holds the data.
 * Typed loosely on purpose — these are ad-hoc analytical shapes, and
 * every field is funnelled through `num()`/`day()` before it escapes.
 */
type Row = Record<string, unknown>;

async function query(statement: ReturnType<typeof sql>): Promise<Row[]> {
  const result = await db.execute(statement);
  return (result.rows ?? []) as Row[];
}

export interface DayPoint {
  day: string;
  activeAll: number;
  activeAuthed: number;
  activeAnon: number;
  /** Cards answered for the first time (from user_progress). */
  newCards: number;
  newCardsCorrect: number;
  /** Every answer including replays — events only, so 0 before rollout. */
  answerEvents: number;
  sessions: number;
  signups: number;
  dailyChallenges: number;
}

/**
 * Headline numbers plus a per-day series for the requested window.
 */
export async function getOverview(days: number): Promise<{
  window: { days: number; from: string; to: string };
  totals: Record<string, number | null>;
  series: DayPoint[];
}> {
  const [seriesRows, totalRows] = await Promise.all([
    query(sql`
      WITH span AS (
        SELECT generate_series(
          CURRENT_DATE - ${days - 1}::int,
          CURRENT_DATE,
          '1 day'::interval
        )::date AS day
      ),
      active AS (
        SELECT day,
               COUNT(*) AS all_users,
               COUNT(*) FILTER (WHERE NOT (${IS_ANON})) AS authed_users,
               COUNT(*) FILTER (WHERE ${IS_ANON}) AS anon_users
        FROM (${ACTIVE_DAYS}) AS ad
        WHERE day >= CURRENT_DATE - ${days - 1}::int
        GROUP BY day
      ),
      progress AS (
        SELECT answered_at::date AS day,
               COUNT(*) AS new_cards,
               COUNT(*) FILTER (WHERE correct) AS new_cards_correct
        FROM user_progress
        WHERE answered_at::date >= CURRENT_DATE - ${days - 1}::int
        GROUP BY 1
      ),
      ev AS (
        SELECT at::date AS day,
               COUNT(*) FILTER (WHERE event = 'answer') AS answer_events,
               COUNT(*) FILTER (WHERE event = 'session_start') AS sessions
        FROM analytics_events
        WHERE at::date >= CURRENT_DATE - ${days - 1}::int
        GROUP BY 1
      ),
      signups AS (
        SELECT created_at::date AS day, COUNT(*) AS signups
        FROM users
        WHERE created_at::date >= CURRENT_DATE - ${days - 1}::int
        GROUP BY 1
      ),
      dailies AS (
        SELECT date AS day, COUNT(*) AS daily_challenges
        FROM daily_results
        WHERE date >= CURRENT_DATE - ${days - 1}::int
        GROUP BY 1
      )
      SELECT span.day,
             COALESCE(active.all_users, 0)          AS active_all,
             COALESCE(active.authed_users, 0)       AS active_authed,
             COALESCE(active.anon_users, 0)         AS active_anon,
             COALESCE(progress.new_cards, 0)        AS new_cards,
             COALESCE(progress.new_cards_correct, 0) AS new_cards_correct,
             COALESCE(ev.answer_events, 0)          AS answer_events,
             COALESCE(ev.sessions, 0)               AS sessions,
             COALESCE(signups.signups, 0)           AS signups,
             COALESCE(dailies.daily_challenges, 0)  AS daily_challenges
      FROM span
      LEFT JOIN active   ON active.day = span.day
      LEFT JOIN progress ON progress.day = span.day
      LEFT JOIN ev       ON ev.day = span.day
      LEFT JOIN signups  ON signups.day = span.day
      LEFT JOIN dailies  ON dailies.day = span.day
      ORDER BY span.day
    `),
    query(sql`
      WITH ad AS (${ACTIVE_DAYS})
      SELECT
        (SELECT COUNT(*) FROM users) AS total_accounts,
        (SELECT COUNT(DISTINCT user_id) FROM ad) AS ever_active,
        (SELECT COUNT(DISTINCT user_id) FROM ad WHERE NOT (${IS_ANON})) AS ever_active_authed,
        (SELECT COUNT(DISTINCT user_id) FROM ad WHERE ${IS_ANON}) AS ever_active_anon,
        (SELECT COUNT(DISTINCT user_id) FROM ad WHERE day = CURRENT_DATE) AS dau,
        (SELECT COUNT(DISTINCT user_id) FROM ad WHERE day >= CURRENT_DATE - 6) AS wau,
        (SELECT COUNT(DISTINCT user_id) FROM ad WHERE day >= CURRENT_DATE - 29) AS mau,
        (SELECT COUNT(DISTINCT user_id) FROM ad
           WHERE day >= CURRENT_DATE - 29 AND NOT (${IS_ANON})) AS mau_authed,
        (SELECT COUNT(DISTINCT user_id) FROM ad
           WHERE day >= CURRENT_DATE - 29 AND ${IS_ANON}) AS mau_anon,
        (SELECT COUNT(*) FROM user_progress) AS answers_all_time,
        (SELECT COUNT(*) FROM user_progress WHERE correct) AS correct_all_time,
        (SELECT COUNT(*) FROM user_progress WHERE correct IS NOT NULL) AS graded_all_time,
        (SELECT COUNT(*) FROM cards) AS total_cards,
        (SELECT COUNT(*) FROM analytics_events) AS total_events,
        (SELECT COUNT(*) FROM daily_results) AS daily_completions,
        (SELECT COUNT(*) FROM friends) / 2 AS friendships
    `),
  ]);

  const t = totalRows[0] ?? {};
  const series: DayPoint[] = seriesRows.map((r) => ({
    day: day(r.day),
    activeAll: num(r.active_all),
    activeAuthed: num(r.active_authed),
    activeAnon: num(r.active_anon),
    newCards: num(r.new_cards),
    newCardsCorrect: num(r.new_cards_correct),
    answerEvents: num(r.answer_events),
    sessions: num(r.sessions),
    signups: num(r.signups),
    dailyChallenges: num(r.daily_challenges),
  }));

  const mau = num(t.mau);
  const graded = num(t.graded_all_time);

  return {
    window: {
      days,
      from: series[0]?.day ?? day(new Date()),
      to: series[series.length - 1]?.day ?? day(new Date()),
    },
    totals: {
      totalAccounts: num(t.total_accounts),
      everActive: num(t.ever_active),
      everActiveAuthed: num(t.ever_active_authed),
      everActiveAnon: num(t.ever_active_anon),
      dau: num(t.dau),
      wau: num(t.wau),
      mau,
      mauAuthed: num(t.mau_authed),
      mauAnon: num(t.mau_anon),
      // Classic stickiness. Low single digits = people try it once.
      stickiness: pct(num(t.dau), mau),
      answersAllTime: num(t.answers_all_time),
      accuracyAllTime: pct(num(t.correct_all_time), graded),
      totalCards: num(t.total_cards),
      totalEvents: num(t.total_events),
      dailyCompletions: num(t.daily_completions),
      friendships: num(t.friendships),
      signupRate: pct(num(t.ever_active_authed), num(t.ever_active)),
    },
    series,
  };
}

export interface CohortRow {
  cohort: string;
  size: number;
  /** Retained user count per week offset; index 0 is the cohort week. */
  weeks: (number | null)[];
}

/**
 * Retention, three ways.
 *
 * `returnedByDay` uses an UNBOUNDED definition — "of the users whose
 * first day was at least N days ago, how many were active on day N or
 * later". At Scrolt's volume the classic exact-day-N definition produces
 * mostly zeroes and reads as broken; unbounded is the honest,
 * interpretable version and the UI labels it as such.
 *
 * `cohorts` is a weekly grid where week N means "days N*7 .. N*7+6 after
 * that user's own first day" — rolling per user, not calendar weeks, so
 * someone who joined on a Friday isn't punished by a 2-day first week.
 */
export async function getRetention(weeks: number): Promise<{
  returnedByDay: Array<{
    day: number;
    all: number | null;
    authed: number | null;
    anon: number | null;
    eligible: number;
  }>;
  nextDayReturn: number | null;
  cohorts: CohortRow[];
  maxWeekOffset: number;
}> {
  const milestones = [1, 3, 7, 14, 30];

  const [returnRows, exactRows, cohortRows] = await Promise.all([
    query(sql`
      WITH ad AS (${ACTIVE_DAYS}),
      firsts AS (SELECT user_id, MIN(day) AS first_day FROM ad GROUP BY 1),
      milestones AS (SELECT unnest(${sql.raw(`ARRAY[${milestones.join(',')}]`)}::int[]) AS n),
      pairs AS (
        SELECT m.n,
               f.user_id,
               ${IS_ANON} AS anon,
               EXISTS (
                 SELECT 1 FROM ad
                 WHERE ad.user_id = f.user_id
                   AND ad.day >= f.first_day + m.n
               ) AS returned
        FROM firsts f
        CROSS JOIN milestones m
        -- Only users who have HAD the chance to come back by day n.
        WHERE f.first_day <= CURRENT_DATE - m.n
      )
      SELECT n,
             COUNT(*) AS eligible,
             COUNT(*) FILTER (WHERE returned) AS returned_all,
             COUNT(*) FILTER (WHERE NOT anon) AS eligible_authed,
             COUNT(*) FILTER (WHERE returned AND NOT anon) AS returned_authed,
             COUNT(*) FILTER (WHERE anon) AS eligible_anon,
             COUNT(*) FILTER (WHERE returned AND anon) AS returned_anon
      FROM pairs
      GROUP BY n
      ORDER BY n
    `),
    query(sql`
      WITH ad AS (${ACTIVE_DAYS}),
      firsts AS (SELECT user_id, MIN(day) AS first_day FROM ad GROUP BY 1),
      eligible AS (SELECT * FROM firsts WHERE first_day <= CURRENT_DATE - 1)
      SELECT COUNT(*) AS eligible,
             COUNT(*) FILTER (
               WHERE EXISTS (
                 SELECT 1 FROM ad
                 WHERE ad.user_id = e.user_id AND ad.day = e.first_day + 1
               )
             ) AS returned
      FROM eligible e
    `),
    query(sql`
      WITH ad AS (${ACTIVE_DAYS}),
      firsts AS (SELECT user_id, MIN(day) AS first_day FROM ad GROUP BY 1),
      cohort AS (
        SELECT user_id, first_day,
               date_trunc('week', first_day)::date AS cohort_week
        FROM firsts
        WHERE first_day >= date_trunc('week', CURRENT_DATE - ${weeks * 7}::int)::date
      ),
      hits AS (
        SELECT c.cohort_week,
               ((ad.day - c.first_day) / 7)::int AS week_offset,
               ad.user_id
        FROM cohort c
        JOIN ad ON ad.user_id = c.user_id
      )
      SELECT cohort_week,
             week_offset,
             COUNT(DISTINCT user_id) AS users
      FROM hits
      GROUP BY 1, 2
      ORDER BY 1, 2
    `),
  ]);

  const returnedByDay = returnRows.map((r) => ({
    day: num(r.n),
    eligible: num(r.eligible),
    all: pct(num(r.returned_all), num(r.eligible)),
    authed: pct(num(r.returned_authed), num(r.eligible_authed)),
    anon: pct(num(r.returned_anon), num(r.eligible_anon)),
  }));

  const exact = exactRows[0] ?? {};

  // Pivot (cohort_week, week_offset) → one row per cohort with a dense
  // array of weekly counts, and blank out weeks that haven't happened
  // yet so the UI can distinguish "0% retained" from "not measurable".
  const byCohort = new Map<string, Map<number, number>>();
  let maxWeekOffset = 0;
  for (const r of cohortRows) {
    const key = day(r.cohort_week);
    const offset = num(r.week_offset);
    if (offset < 0) continue;
    maxWeekOffset = Math.max(maxWeekOffset, offset);
    const inner = byCohort.get(key) ?? new Map<number, number>();
    inner.set(offset, num(r.users));
    byCohort.set(key, inner);
  }

  const today = new Date();
  const elapsedFor = (cohort: string): number =>
    Math.floor(
      (today.getTime() - new Date(`${cohort}T00:00:00Z`).getTime()) / (7 * 24 * 60 * 60 * 1000),
    );

  // Widen the grid to every week that is *measurable*, not just weeks
  // where somebody happened to return. Otherwise a cohort with zero
  // retention silently loses its columns and the grid understates how
  // much history we actually have — "no W2 column" reads as "no data"
  // when the truth is "nobody came back in week 2".
  const widest = [...byCohort.keys()].reduce((m, c) => Math.max(m, elapsedFor(c)), 0);
  maxWeekOffset = Math.min(Math.max(maxWeekOffset, widest), weeks);

  const cohorts: CohortRow[] = [...byCohort.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([cohort, inner]) => {
      const size = inner.get(0) ?? 0;
      const weeksElapsed = elapsedFor(cohort);
      const cells: (number | null)[] = [];
      for (let i = 0; i <= maxWeekOffset; i++) {
        cells.push(i <= weeksElapsed ? inner.get(i) ?? 0 : null);
      }
      return { cohort, size, weeks: cells };
    });

  return {
    returnedByDay,
    nextDayReturn: pct(num(exact.returned), num(exact.eligible)),
    cohorts,
    maxWeekOffset,
  };
}

/**
 * What people actually play. Events-only — this is the metric the old
 * schema could not answer at all, so it reads as empty until the
 * instrumented frontend has been live for a while.
 */
export async function getModes(days: number): Promise<{
  modes: Array<Record<string, number | string | null>>;
  variants: Array<Record<string, number | string | null>>;
  hasData: boolean;
}> {
  const [modeRows, variantRows] = await Promise.all([
    query(sql`
      SELECT COALESCE(mode, 'unknown') AS mode,
             COUNT(*) FILTER (WHERE event = 'session_start') AS sessions,
             COUNT(*) FILTER (WHERE event = 'answer') AS answers,
             COUNT(*) FILTER (WHERE event = 'answer' AND correct) AS correct,
             COUNT(*) FILTER (WHERE event = 'answer' AND correct IS NOT NULL) AS graded,
             COUNT(DISTINCT user_id) AS users,
             COUNT(DISTINCT user_id) FILTER (WHERE NOT (${IS_ANON})) AS users_authed,
             COUNT(DISTINCT user_id) FILTER (WHERE ${IS_ANON}) AS users_anon,
             ROUND(AVG(duration_ms) FILTER (WHERE event = 'session_end')) AS avg_session_ms,
             ROUND(AVG(duration_ms) FILTER (WHERE event = 'answer')) AS avg_answer_ms,
             COUNT(*) FILTER (WHERE event = 'complete') AS completions
      FROM analytics_events
      WHERE at >= NOW() - ${sql.raw(`INTERVAL '${days} days'`)}
      GROUP BY 1
      -- Sessions first: it's what the dashboard plots, and a mode can
      -- legitimately have sessions but no answers yet (someone opened it
      -- and left), which ordering by answers would bury.
      ORDER BY sessions DESC, answers DESC
    `),
    query(sql`
      SELECT mode, variant,
             COUNT(*) FILTER (WHERE event = 'answer') AS answers,
             COUNT(*) FILTER (WHERE event = 'answer' AND correct) AS correct,
             COUNT(DISTINCT user_id) AS users
      FROM analytics_events
      WHERE at >= NOW() - ${sql.raw(`INTERVAL '${days} days'`)}
        AND variant IS NOT NULL
      GROUP BY 1, 2
      ORDER BY answers DESC
      LIMIT 20
    `),
  ]);

  const modes = modeRows.map((r) => ({
    mode: String(r.mode ?? 'unknown'),
    sessions: num(r.sessions),
    answers: num(r.answers),
    accuracy: pct(num(r.correct), num(r.graded)),
    users: num(r.users),
    usersAuthed: num(r.users_authed),
    usersAnon: num(r.users_anon),
    avgSessionSec: num(r.avg_session_ms) ? Math.round(num(r.avg_session_ms) / 1000) : 0,
    avgAnswerSec: num(r.avg_answer_ms) ? Math.round(num(r.avg_answer_ms) / 100) / 10 : 0,
    answersPerSession: num(r.sessions)
      ? Math.round((num(r.answers) / num(r.sessions)) * 10) / 10
      : 0,
    completions: num(r.completions),
  }));

  return {
    modes,
    variants: variantRows.map((r) => ({
      mode: String(r.mode ?? ''),
      variant: String(r.variant ?? ''),
      answers: num(r.answers),
      accuracy: pct(num(r.correct), num(r.answers)),
      users: num(r.users),
    })),
    hasData: modeRows.length > 0,
  };
}

/**
 * Card-level difficulty. Reads user_progress (full history, first-try
 * answers only) which is exactly the right signal for "is this card
 * badly worded or genuinely hard" — replays would contaminate it.
 */
export async function getContent(minAnswers: number, limit: number): Promise<{
  hardest: Row[];
  easiest: Row[];
  byCategory: Row[];
  byDifficulty: Row[];
  unseen: number;
}> {
  const cardStats = sql`
    SELECT c.id, c.answer, c.category, c.difficulty,
           COUNT(p.card_id) AS attempts,
           COUNT(*) FILTER (WHERE p.correct) AS correct,
           COUNT(*) FILTER (WHERE p.correct IS NOT NULL) AS graded
    FROM cards c
    JOIN user_progress p ON p.card_id = c.id
    GROUP BY c.id, c.answer, c.category, c.difficulty
    HAVING COUNT(*) FILTER (WHERE p.correct IS NOT NULL) >= ${minAnswers}
  `;

  const [hardest, easiest, byCategory, byDifficulty, unseenRows] = await Promise.all([
    query(sql`
      SELECT *, ROUND(100.0 * correct / graded, 1) AS accuracy
      FROM (${cardStats}) s
      -- Exclude perfect cards: padding "hardest" with 100%-accuracy rows
      -- when few cards have ever been missed makes the list meaningless.
      WHERE correct < graded
      ORDER BY (1.0 * correct / graded) ASC, graded DESC
      LIMIT ${limit}
    `),
    query(sql`
      SELECT *, ROUND(100.0 * correct / graded, 1) AS accuracy
      FROM (${cardStats}) s
      ORDER BY (1.0 * correct / graded) DESC, graded DESC
      LIMIT ${limit}
    `),
    query(sql`
      SELECT c.category AS label,
             COUNT(p.card_id) AS attempts,
             COUNT(DISTINCT p.user_id) AS users,
             ROUND(
               100.0 * COUNT(*) FILTER (WHERE p.correct)
               / NULLIF(COUNT(*) FILTER (WHERE p.correct IS NOT NULL), 0), 1
             ) AS accuracy
      FROM cards c
      LEFT JOIN user_progress p ON p.card_id = c.id
      GROUP BY 1
      ORDER BY attempts DESC
    `),
    query(sql`
      SELECT c.difficulty AS label,
             COUNT(p.card_id) AS attempts,
             COUNT(DISTINCT p.user_id) AS users,
             ROUND(
               100.0 * COUNT(*) FILTER (WHERE p.correct)
               / NULLIF(COUNT(*) FILTER (WHERE p.correct IS NOT NULL), 0), 1
             ) AS accuracy
      FROM cards c
      LEFT JOIN user_progress p ON p.card_id = c.id
      GROUP BY 1
      ORDER BY attempts DESC
    `),
    query(sql`
      SELECT COUNT(*) AS unseen
      FROM cards c
      WHERE NOT EXISTS (SELECT 1 FROM user_progress p WHERE p.card_id = c.id)
    `),
  ]);

  const shape = (rows: Row[]): Row[] =>
    rows.map((r) => ({
      id: String(r.id ?? ''),
      answer: String(r.answer ?? ''),
      category: String(r.category ?? ''),
      difficulty: String(r.difficulty ?? ''),
      attempts: num(r.attempts),
      accuracy: r.accuracy === null ? null : num(r.accuracy),
    }));

  const bucket = (rows: Row[]): Row[] =>
    rows.map((r) => ({
      label: String(r.label ?? ''),
      attempts: num(r.attempts),
      users: num(r.users),
      accuracy: r.accuracy === null ? null : num(r.accuracy),
    }));

  return {
    hardest: shape(hardest),
    easiest: shape(easiest),
    byCategory: bucket(byCategory),
    byDifficulty: bucket(byDifficulty),
    unseen: num(unseenRows[0]?.unseen),
  };
}

/**
 * Per-user rows, most recently active first — anonymous and signed-in
 * together, since that's the only way to see the whole funnel. Email and
 * name are joined in for real accounts and null for anon ids.
 */
export async function getUsers(limit: number, onlyAuthed: boolean): Promise<Row[]> {
  const rows = await query(sql`
    WITH ad AS (${ACTIVE_DAYS}),
    base AS (
      SELECT user_id,
             MIN(day) AS first_seen,
             MAX(day) AS last_seen,
             COUNT(*) AS active_days
      FROM ad
      GROUP BY user_id
      ${onlyAuthed ? sql`HAVING NOT (user_id LIKE 'anon@_%' ESCAPE '@')` : sql``}
    ),
    answers AS (
      SELECT user_id,
             COUNT(*) AS answers,
             COUNT(*) FILTER (WHERE correct) AS correct,
             COUNT(*) FILTER (WHERE correct IS NOT NULL) AS graded
      FROM user_progress
      GROUP BY 1
    ),
    dailies AS (
      SELECT user_id, COUNT(*) AS dailies FROM daily_results GROUP BY 1
    ),
    -- The mode each user has logged the most answers in.
    top_mode AS (
      SELECT DISTINCT ON (user_id) user_id, mode, cnt
      FROM (
        SELECT user_id, mode, COUNT(*) AS cnt
        FROM analytics_events
        WHERE event = 'answer' AND mode IS NOT NULL
        GROUP BY 1, 2
      ) m
      ORDER BY user_id, cnt DESC
    ),
    ev AS (
      SELECT user_id,
             COUNT(*) FILTER (WHERE event = 'session_start') AS sessions,
             SUM(duration_ms) FILTER (WHERE event = 'session_end') AS total_ms
      FROM analytics_events
      GROUP BY 1
    )
    SELECT b.user_id,
           NOT (b.user_id LIKE 'anon@_%' ESCAPE '@') AS authed,
           u.email, u.name, u.created_at,
           b.first_seen, b.last_seen, b.active_days,
           CURRENT_DATE - b.last_seen AS days_since_seen,
           (b.last_seen - b.first_seen) + 1 AS lifespan_days,
           COALESCE(a.answers, 0) AS answers,
           ROUND(100.0 * a.correct / NULLIF(a.graded, 0), 1) AS accuracy,
           COALESCE(d.dailies, 0) AS dailies,
           COALESCE(e.sessions, 0) AS sessions,
           e.total_ms,
           t.mode AS top_mode
    FROM base b
    LEFT JOIN users u   ON u.id = b.user_id
    LEFT JOIN answers a ON a.user_id = b.user_id
    LEFT JOIN dailies d ON d.user_id = b.user_id
    LEFT JOIN ev e      ON e.user_id = b.user_id
    LEFT JOIN top_mode t ON t.user_id = b.user_id
    ORDER BY b.last_seen DESC, COALESCE(a.answers, 0) DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    userId: String(r.user_id ?? ''),
    authed: r.authed === true,
    email: r.email === null ? null : String(r.email),
    name: r.name === null ? null : String(r.name),
    firstSeen: day(r.first_seen),
    lastSeen: day(r.last_seen),
    daysSinceSeen: num(r.days_since_seen),
    activeDays: num(r.active_days),
    lifespanDays: num(r.lifespan_days),
    answers: num(r.answers),
    accuracy: r.accuracy === null ? null : num(r.accuracy),
    dailies: num(r.dailies),
    sessions: num(r.sessions),
    totalMinutes: r.total_ms === null ? null : Math.round(num(r.total_ms) / 60000),
    topMode: r.top_mode === null ? null : String(r.top_mode),
  }));
}

/**
 * The most recent events, newest first — a live tail for eyeballing
 * whether instrumentation is actually firing.
 */
export async function getRecentEvents(limit: number): Promise<Row[]> {
  const rows = await query(sql`
    SELECT id, user_id, event, mode, variant, card_id, correct, duration_ms, authed, at
    FROM analytics_events
    ORDER BY at DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    userId: String(r.user_id ?? ''),
    event: String(r.event ?? ''),
    mode: r.mode === null ? null : String(r.mode),
    variant: r.variant === null ? null : String(r.variant),
    cardId: r.card_id === null ? null : String(r.card_id),
    correct: r.correct === null ? null : r.correct === true,
    durationMs: r.duration_ms === null ? null : num(r.duration_ms),
    authed: r.authed === true,
    at: r.at instanceof Date ? r.at.toISOString() : String(r.at ?? ''),
  }));
}

/**
 * Delete events past the retention window.
 *
 * Called opportunistically from the dashboard's own requests rather than
 * on a timer: this is a single-operator dashboard, so "prune whenever
 * the operator looks at it" is enough to bound the table, and it adds no
 * background work to a box that's otherwise serving user traffic.
 * Throttled in-process so a page refresh doesn't re-run the DELETE.
 */
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
let lastPruneAt = 0;

export async function pruneOldEvents(force = false): Promise<number | null> {
  const now = Date.now();
  if (!force && now - lastPruneAt < PRUNE_INTERVAL_MS) return null;
  lastPruneAt = now;

  try {
    const result = await db.execute(sql`
      DELETE FROM analytics_events
      WHERE at < NOW() - ${sql.raw(`INTERVAL '${env.ANALYTICS_RETENTION_DAYS} days'`)}
    `);
    const deleted = result.rowCount ?? 0;
    if (deleted > 0) {
      logger.info('analytics_pruned', { deleted, keepDays: env.ANALYTICS_RETENTION_DAYS });
    }
    return deleted;
  } catch (err) {
    logger.warn('analytics_prune_failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
