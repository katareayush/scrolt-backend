import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../config/env';

/**
 * One-shot migration runner.
 *
 * Uses its own short-lived Pool with a 90-second connection timeout
 * because:
 * - Neon's free-tier compute scales to zero after ~5min idle. A cold
 *   start takes 8–30s, sometimes longer on the first connect of the day.
 * - The runtime Pool in `db/connection.ts` uses a 10s timeout (fine for
 *   user requests where we'd rather fail fast and let the next request
 *   retry against a now-warm DB) — that's too aggressive here.
 *
 * Retries once on connection failure: the first attempt frequently
 * times out while it wakes Neon up, the second goes through.
 */
async function withPool<T>(fn: (db: ReturnType<typeof drizzle>) => Promise<T>): Promise<T> {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 90_000,
    idleTimeoutMillis: 30_000,
    max: 2,
  });
  pool.on('error', (err) => {
    console.error('[migrate] pool error:', err);
  });
  try {
    return await fn(drizzle(pool));
  } finally {
    await pool.end();
  }
}

async function run(): Promise<void> {
  console.log('[migrate] starting…');
  console.log('[migrate] tip: first run after idle may wait ~30s for Neon to wake up.');
  const t0 = Date.now();

  await withPool(async (db) => {
    await migrate(db, { migrationsFolder: './drizzle' });
  });

  console.log(`[migrate] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

async function main(): Promise<void> {
  try {
    await run();
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isConnTimeout =
      message.includes('Connection terminated') ||
      message.includes('connect ETIMEDOUT') ||
      message.includes('connection timeout');

    if (isConnTimeout) {
      console.warn('[migrate] first attempt timed out (probably Neon cold start). retrying once…');
      try {
        await run();
        process.exit(0);
      } catch (retryErr) {
        console.error('[migrate] retry also failed:', retryErr);
        console.error(
          '\nTroubleshooting:\n' +
            '  1. Open your Neon project dashboard — if compute is paused, click the\n' +
            '     branch to wake it, wait ~10s, then re-run this command.\n' +
            '  2. Verify DATABASE_URL in backend/.env matches the Neon pooler URL\n' +
            "     (should include `-pooler.` and `?sslmode=require`).\n" +
            '  3. From this machine, `nslookup <neon-host>` should resolve.',
        );
        process.exit(1);
      }
    }

    console.error('[migrate] failed:', err);
    process.exit(1);
  }
}

main();
