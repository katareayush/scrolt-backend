import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const AUTH_SECRET_PLACEHOLDER = 'replace-me-with-a-32-byte-random-string';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PORT: z.string().default('4000').transform(Number).pipe(z.number().min(1).max(65535)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  UPSTASH_REDIS_REST_URL: z.string().min(1, 'UPSTASH_REDIS_REST_URL is required'),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1, 'UPSTASH_REDIS_REST_TOKEN is required'),
  CORS_ORIGINS: z.string().optional().default(''),
  AUTH_SECRET: z
    .string()
    .min(32, 'AUTH_SECRET must be at least 32 characters — generate with `npx auth secret`')
    .refine(
      (v) => v !== AUTH_SECRET_PLACEHOLDER,
      'AUTH_SECRET is still the placeholder — generate a real value with `npx auth secret`',
    ),
  /**
   * Password for the admin analytics dashboard at GET /admin.
   *
   * Optional on purpose: when unset, the dashboard and every /api/admin
   * route return 404 as though they don't exist. That's the safe default
   * — a deploy that forgets this var exposes nothing rather than
   * exposing everything. Must be ≥20 chars so it can't be guessed.
   */
  ADMIN_TOKEN: z
    .string()
    .min(20, 'ADMIN_TOKEN must be at least 20 characters — generate with `openssl rand -hex 24`')
    .optional(),
  /**
   * How long raw analytics events are kept. Pruning runs opportunistically
   * (see routes/admin.ts) so the table can't grow unbounded on Neon's
   * free tier. Aggregate history still comes from user_progress, which is
   * never pruned.
   */
  ANALYTICS_RETENTION_DAYS: z
    .string()
    .default('120')
    .transform(Number)
    .pipe(z.number().int().min(7).max(3650)),
});

const parseEnv = () => {
  const result = envSchema.safeParse(process.env);
  
  if (!result.success) {
    console.error('Invalid environment variables:');
    result.error.issues.forEach(issue => {
      console.error(`${issue.path.join('.')}: ${issue.message}`);
    });
    process.exit(1);
  }
  
  return result.data;
};

export const env = parseEnv();