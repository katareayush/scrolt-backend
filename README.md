# scrolt-backend

Express + Drizzle (Postgres) + Redis API for Scrolt. Serves the vocabulary
card feed, progress, daily, friends and auth handoff.

## Local development (Docker)

`docker compose up` brings up a fully local stack — Postgres, Redis (behind
an Upstash-compatible REST proxy, since the app talks to Redis via
`@upstash/redis` over HTTP), and the API — with no external services.

```bash
# 1. Build and start everything (API on http://localhost:4000)
docker compose up --build

# 2. Run migrations (first boot, and after any schema change)
docker compose run --rm backend node dist/scripts/migrate.js

# 3. Seed the card catalog. Reads data/cards.json, which is gitignored
#    and not baked into the image — mount it in for the one-off run:
docker compose run --rm -v "$PWD/data:/app/data" backend node dist/scripts/seed.js
```

Health checks:

- `GET /health` — liveness, touches no dependencies.
- `GET /health/ready` — readiness, pings Postgres + Redis (503 if degraded).

### Environment

The compose file wires local defaults. The only value you should override is
`AUTH_SECRET`, which **must match the frontend's** — put it in a `.env` next
to `docker-compose.yml`:

```bash
AUTH_SECRET=<32+ char secret, same as frontend>
```

| Var | Local default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | local Postgres container | Neon pooler URL in prod |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | local REST proxy | Upstash in prod |
| `CORS_ORIGINS` | `http://localhost:3000` | comma-separated in prod |
| `AUTH_SECRET` | placeholder — override it | shared with frontend |

## Production

The `Dockerfile` builds a slim, non-root runtime image (compiled `dist/` +
`drizzle/` migrations, prod deps only). Point `DATABASE_URL` at Neon and the
`UPSTASH_*` vars at Upstash, then run migrations once against the target DB:

```bash
docker run --rm --env-file .env.production <image> node dist/scripts/migrate.js
```

## Without Docker

```bash
cp .env.example .env   # fill in Neon + Upstash creds
npm install
npm run db:migrate
npm run db:seed
npm run dev
```
