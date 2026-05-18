import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { healthRouter } from './routes/health';
import { cardsRouter } from './routes/cards';
import { handoffRouter } from './routes/handoff';
import { progressRouter } from './routes/progress';
import { authRouter } from './routes/auth';
import { dailyRouter } from './routes/daily';
import { sessionMiddleware } from './middleware/session';
import { requestLogger, logger } from './middleware/logger';

const app = express();

/**
 * Trust the first proxy (Vercel, Render, Fly etc.) so that
 * `req.ip`, `req.protocol`, and Set-Cookie's `secure` flag work
 * correctly behind a load balancer.
 */
app.set('trust proxy', 1);

/**
 * Allowed CORS origins. Localhost dev origins are auto-allowed in
 * development; production hosts must be listed via the comma-separated
 * `CORS_ORIGINS` env var.
 */
const devOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://localhost:3000',
] as const;
const configuredOrigins = env.CORS_ORIGINS
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const allowedOrigins =
  env.NODE_ENV === 'development'
    ? [...new Set([...devOrigins, ...configuredOrigins])]
    : configuredOrigins;

app.use(
  helmet({
    // The backend serves JSON only; relax content-security-policy so the
    // health page (if anyone fetches it) doesn't fight inline browser
    // tools. Frontend has its own CSP via next.config.ts.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);

app.use(
  cors({
    origin: (origin, callback) => {
      // No Origin header → same-origin / server-side call.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Anon-Id'],
    exposedHeaders: ['X-Request-Id'],
  }),
);

/**
 * gzip / deflate JSON responses. Batch card payloads are 5-20KB
 * uncompressed; this cuts them roughly 60%. Threshold of 1KB avoids
 * spending CPU on already-tiny responses (health, status, etc).
 */
app.use(compression({ threshold: 1024 }));

app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());
app.use(requestLogger);
app.use(sessionMiddleware);

app.use('/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/cards', cardsRouter);
app.use('/api/daily', dailyRouter);
app.use('/api/handoff', handoffRouter);
app.use('/api/progress', progressRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('unhandled', {
    reqId: req.reqId,
    err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
  });
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(env.PORT, () => {
  logger.info('listening', { port: env.PORT, env: env.NODE_ENV });
});

/**
 * Graceful shutdown: stop accepting new connections, then exit. We don't
 * close the pg.Pool here because in-flight requests still need it, and
 * `server.close()` is given a finite window before the process exits.
 */
function shutdown(signal: string): void {
  logger.info('shutdown.start', { signal });
  server.close(() => {
    logger.info('shutdown.done');
    process.exit(0);
  });
  setTimeout(() => {
    logger.warn('shutdown.timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
