import { Router } from 'express';
import { withDbRetry } from '../db/connection';
import { requireAdmin, adminLimiter, adminEnabled } from '../middleware/admin';
import { logger } from '../middleware/logger';
import { env } from '../config/env';
import { dashboardHtml } from '../admin/dashboardHtml';
import {
  getOverview,
  getRetention,
  getModes,
  getContent,
  getUsers,
  getRecentEvents,
  pruneOldEvents,
} from '../services/analyticsService';

export const adminRouter = Router();

/**
 * Admin analytics surface. Two kinds of route:
 *
 * - `GET /admin` serves the dashboard shell. It contains no data — the
 *   page asks for the token, keeps it in sessionStorage, and fetches
 *   everything below with an `X-Admin-Token` header. That way the HTML
 *   is safe to serve before auth and the token never lands in a URL.
 * - `GET /admin/api/*` return JSON and are all behind `requireAdmin`.
 *
 * Every route is no-store: analytics that a proxy could cache and hand
 * to someone else would be a data leak, and stale numbers are useless.
 */

/** Clamp a query param to a safe integer range. */
function intParam(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

adminRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});

/** The dashboard shell. Unauthenticated but data-free. */
adminRouter.get('/', (_req, res) => {
  if (!adminEnabled()) {
    res.status(404).json({ error: 'Route not found' });
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(dashboardHtml);
});

/**
 * Token check for the login box — returns 200/401 and nothing else, so
 * the page can validate a pasted token before rendering the shell.
 */
adminRouter.get('/api/verify', adminLimiter, requireAdmin, (_req, res) => {
  res.json({ ok: true, retentionDays: env.ANALYTICS_RETENTION_DAYS });
});

/**
 * One request populates the whole dashboard. Neon round trips dominate
 * latency here, so batching beats six separate fetches — and it keeps
 * the client trivially simple.
 */
adminRouter.get('/api/summary', adminLimiter, requireAdmin, async (req, res) => {
  const days = intParam(req.query.days, 30, 1, 365);
  const weeks = intParam(req.query.weeks, 8, 1, 52);
  const userLimit = intParam(req.query.users, 50, 1, 500);
  const minAnswers = intParam(req.query.minAnswers, 3, 1, 1000);
  const onlyAuthed = req.query.onlyAuthed === '1';

  try {
    const [overview, retention, modes, content, users, events] = await withDbRetry(() =>
      Promise.all([
        getOverview(days),
        getRetention(weeks),
        getModes(days),
        getContent(minAnswers, 12),
        getUsers(userLimit, onlyAuthed),
        getRecentEvents(30),
      ]),
    );

    // Fire-and-forget; self-throttled to every 6h inside the service.
    void pruneOldEvents();

    res.json({
      generatedAt: new Date().toISOString(),
      params: { days, weeks, userLimit, minAnswers, onlyAuthed },
      retentionDays: env.ANALYTICS_RETENTION_DAYS,
      overview,
      retention,
      modes,
      content,
      users,
      events,
    });
  } catch (err) {
    logger.error('admin_summary_failed', {
      reqId: req.reqId,
      err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
    });
    res.status(500).json({ error: 'failed to build summary' });
  }
});

/**
 * CSV export of the per-user table — for when a spreadsheet is the
 * faster tool for a question the dashboard doesn't answer.
 */
adminRouter.get('/api/users.csv', adminLimiter, requireAdmin, async (req, res) => {
  const limit = intParam(req.query.users, 500, 1, 5000);
  const onlyAuthed = req.query.onlyAuthed === '1';

  try {
    const rows = await withDbRetry(() => getUsers(limit, onlyAuthed));
    const columns = [
      'userId', 'authed', 'email', 'name', 'firstSeen', 'lastSeen',
      'daysSinceSeen', 'activeDays', 'lifespanDays', 'answers',
      'accuracy', 'dailies', 'sessions', 'totalMinutes', 'topMode',
    ];

    // Prefix formula-triggering characters with an apostrophe so a cell
    // like `=HYPERLINK(...)` can't execute when opened in a spreadsheet.
    const escape = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      let s = String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };

    const csv = [
      columns.join(','),
      ...rows.map((r) => columns.map((c) => escape(r[c])).join(',')),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="scrolt-users.csv"');
    res.send(csv);
  } catch (err) {
    logger.error('admin_csv_failed', {
      reqId: req.reqId,
      err: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'failed to build csv' });
  }
});
