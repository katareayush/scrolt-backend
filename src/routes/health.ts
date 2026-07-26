import { Router } from 'express';
import { pool } from '../db/connection';
import { redis } from '../config/redis';
import { formatDuration } from '../utils/formatDuration';

export const healthRouter = Router();

/**
 * When this process actually began.
 *
 * Derived from `process.uptime()` rather than a `Date.now()` captured at
 * module load: the two agree closely, but uptime covers the whole process
 * including the time Node spent booting before this module was evaluated,
 * so it doesn't drift by the startup cost.
 */
const startedAt = new Date(Date.now() - process.uptime() * 1000);

/** `Sun, 26 Jul 2026 07:13:58 GMT` — unambiguous across timezones. */
function humanTimestamp(date: Date): string {
  return date.toUTCString();
}

/**
 * Liveness probe. Returns 200 as long as the process is up. Doesn't
 * touch dependencies — load balancers that route here should expect
 * 1ms response times even when DB / Redis are degraded.
 *
 * `uptime` and `startedAt` carry both a machine form and a readable one,
 * so the same endpoint answers "is it up?" for a probe and "when did it
 * last restart?" for a human eyeballing it after a deploy.
 */
healthRouter.get('/', (_req, res) => {
  const uptimeSeconds = process.uptime();

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'scrolt-backend',
    uptime: {
      seconds: Math.floor(uptimeSeconds),
      human: formatDuration(uptimeSeconds),
    },
    startedAt: {
      iso: startedAt.toISOString(),
      human: humanTimestamp(startedAt),
    },
  });
});

/**
 * Readiness probe. Pings DB and Redis with short timeouts. Returns 503
 * if either fails so loadbalancers can route around an instance whose
 * upstreams are down. Use this for `livenessProbe` / `readinessProbe`
 * in k8s-style deployments.
 */
healthRouter.get('/ready', async (_req, res) => {
  const timeout = 2_000;
  const started = Date.now();

  const [db, redisCheck] = await Promise.all([
    withTimeout(pool.query('SELECT 1'), timeout, 'db'),
    withTimeout(redis.ping(), timeout, 'redis'),
  ]);

  const ok = db.ok && redisCheck.ok;
  const body = {
    status: ok ? 'ready' : 'degraded',
    ms: Date.now() - started,
    db: db.ok ? { ok: true, ms: db.ms } : { ok: false, error: db.error },
    redis: redisCheck.ok
      ? { ok: true, ms: redisCheck.ms }
      : { ok: false, error: redisCheck.error },
  };

  res.status(ok ? 200 : 503).json(body);
});

interface CheckResult {
  ok: boolean;
  ms: number;
  error?: string;
}

async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    await Promise.race([
      p,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms),
      ),
    ]);
    return { ok: true, ms: Date.now() - t0 };
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
