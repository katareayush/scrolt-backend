import { Router } from 'express';
import { pool } from '../db/connection';
import { redis } from '../config/redis';

export const healthRouter = Router();

/**
 * Liveness probe. Returns 200 as long as the process is up. Doesn't
 * touch dependencies — load balancers that route here should expect
 * 1ms response times even when DB / Redis are degraded.
 */
healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'scrolt-backend',
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
