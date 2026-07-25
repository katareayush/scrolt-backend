#!/usr/bin/env bash
#
# On-box deploy for the Scrolt backend. Run from the repo root (the CI
# job cd's into /opt/scrolt/backend, resets to origin/main, then calls
# this). Rebuilds the image, runs migrations, swaps the running container,
# and gates on a health check — exiting non-zero (which fails the CI job)
# if the new container doesn't come up healthy.
#
# Idempotent and safe to re-run. Keeps the previous image around until the
# new one is confirmed healthy, then prunes dangling images to reclaim disk.
set -euo pipefail

ENV_FILE=/opt/scrolt/backend.env
NETWORK=scrolt
IMAGE=scrolt-backend:live
CONTAINER=scrolt-api

cd "$(dirname "$0")/.."   # repo root

echo "[deploy] $(git rev-parse --short HEAD) — building image…"
docker build -t "$IMAGE" .

echo "[deploy] running migrations…"
docker run --rm --network "$NETWORK" --env-file "$ENV_FILE" "$IMAGE" node dist/scripts/migrate.js

echo "[deploy] swapping container…"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" --network "$NETWORK" --restart always \
  --env-file "$ENV_FILE" "$IMAGE" >/dev/null

echo "[deploy] waiting for health…"
for i in $(seq 1 20); do
  if docker exec "$CONTAINER" wget -qO- http://127.0.0.1:4000/health >/dev/null 2>&1; then
    echo "[deploy] healthy ✓"
    docker image prune -f >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 2
done

echo "[deploy] ERROR: container did not become healthy" >&2
docker logs --tail 40 "$CONTAINER" >&2 || true
exit 1
