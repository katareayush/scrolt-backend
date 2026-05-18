import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
import { env } from '../config/env';
import * as schema from './schema';

/**
 * Single Postgres pool for the entire process.
 *
 * - `max: 10` matches Neon's free-tier compute pool size; bump for prod
 *   if you provision a larger compute.
 * - `idleTimeoutMillis: 30s` lets idle connections recycle so we don't
 *   pin Neon connections forever.
 * - `pool.on('error', ...)` is REQUIRED: without it, a transient
 *   connection error (e.g., Neon scale-to-zero waking up) becomes an
 *   unhandled error event and crashes the Node process.
 */
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err: Error, _client: PoolClient) => {
  // Log and keep running; individual queries will retry via their callers.
  console.error('[pg pool] unexpected idle-client error:', err);
});

export const db = drizzle(pool, { schema });
export { pool };