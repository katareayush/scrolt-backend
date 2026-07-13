import dns from 'node:dns';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
import { env } from '../config/env';
import * as schema from './schema';

// Prefer IPv4 when resolving the Neon host. In some container/network
// environments the host resolves to IPv6 addresses that aren't routable,
// so pg wastes the whole connect timeout on them and surfaces an
// `AggregateError [ETIMEDOUT]` before ever trying IPv4. Forcing IPv4-first
// makes connections fast and reliable.
dns.setDefaultResultOrder('ipv4first');

/**
 * Single Postgres pool for the entire process.
 *
 * - `max: 10` matches Neon's free-tier compute pool size; bump for prod
 *   if you provision a larger compute.
 * - `idleTimeoutMillis: 30s` lets idle connections recycle so we don't
 *   pin Neon connections forever.
 * - `connectionTimeoutMillis: 15s` tolerates Neon scale-to-zero cold
 *   starts, which can take several seconds to wake on the first hit.
 * - `keepAlive` keeps established sockets warm so we reconnect less.
 * - `pool.on('error', ...)` is REQUIRED: without it, a transient
 *   connection error (e.g., Neon scale-to-zero waking up) becomes an
 *   unhandled error event and crashes the Node process.
 */
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
  keepAlive: true,
});

pool.on('error', (err: Error, _client: PoolClient) => {
  // Log and keep running; individual queries retry via withDbRetry.
  console.error('[pg pool] unexpected idle-client error:', err);
});

export const db = drizzle(pool, { schema });
export { pool };

/** Errors that are worth retrying — transient connectivity, not logic. */
const TRANSIENT_DB_ERROR =
  /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|Connection terminated|connection timeout|timeout expired|terminating connection|Client has encountered a connection error|server closed the connection/i;

function isTransient(err: unknown): boolean {
  const parts: string[] = [];
  const collect = (e: unknown) => {
    if (!e) return;
    if (e instanceof Error) {
      parts.push(e.message);
      const code = (e as { code?: string }).code;
      if (code) parts.push(code);
      const cause = (e as { cause?: unknown }).cause;
      if (cause && cause !== e) collect(cause);
      const agg = (e as { errors?: unknown[] }).errors;
      if (Array.isArray(agg)) agg.forEach(collect);
    } else {
      parts.push(String(e));
    }
  };
  collect(err);
  return TRANSIENT_DB_ERROR.test(parts.join(' '));
}

/**
 * Run a DB operation, retrying transient connection failures with a small
 * backoff. Neon's serverless compute can cold-start on the first query
 * after idle, and the container occasionally hits a flaky address before
 * settling — a single retry turns those 500s into a brief delay.
 *
 * Only use for READ / idempotent operations. Do not wrap multi-statement
 * transactions where a partial retry could double-apply writes.
 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  baseDelayMs = 300,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isTransient(err)) throw err;
      await new Promise((r) => setTimeout(r, baseDelayMs * (attempt + 1)));
    }
  }
  throw lastErr;
}
