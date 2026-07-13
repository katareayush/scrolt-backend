# scrolt-backend

Express + Drizzle (Postgres) + Redis API for Scrolt. Serves the vocabulary
card feed, progress, daily, friends and auth handoff.

## Local development (Docker)

`docker compose up` runs **Redis + the API** locally (no database). Redis
sits behind an Upstash-compatible REST proxy, since the app talks to Redis
via `@upstash/redis` over HTTP. Postgres stays external — point
`DATABASE_URL` at your hosted DB (Neon).

```bash
# 0. Set DATABASE_URL (your hosted Postgres) and AUTH_SECRET
cp .env.example .env

# 1. Build and start Redis + the API (http://localhost:4000)
docker compose up --build

# 2. Run migrations against DATABASE_URL (first boot, and after schema changes)
docker compose run --rm backend node dist/scripts/migrate.js

# 3. Seed the card catalog. Reads data/cards.json, which is gitignored
#    and not baked into the image — mount it in for the one-off run:
docker compose run --rm -v "$PWD/data:/app/data" backend node dist/scripts/seed.js
```

Health checks:

- `GET /health` — liveness, touches no dependencies.
- `GET /health/ready` — readiness, pings Postgres + Redis (503 if degraded).

### Environment

Copy `.env.example` to `.env`. The compose file overrides the Redis + CORS
values to the local proxy, so the two you actually set are `DATABASE_URL`
(your hosted Postgres) and `AUTH_SECRET` (which **must match the
frontend's**):

```bash
DATABASE_URL=<your hosted Postgres URL>
AUTH_SECRET=<32+ char secret, same as frontend>
```

| Var | Docker (base) | Notes |
| --- | --- | --- |
| `DATABASE_URL` | from your `.env` | external/hosted Postgres (e.g. Neon) |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | local REST proxy | overridden by compose; Upstash in prod |
| `CORS_ORIGINS` | `http://localhost:3000` | overridden by compose; comma-separated in prod |
| `AUTH_SECRET` | from your `.env` | shared with frontend |

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
