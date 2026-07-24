#!/bin/bash
set -euxo pipefail
# ─────────────────────────────────────────────────────────────────────────
# Scrolt backend — one-shot EC2 bootstrap (paste into "User data" at launch).
#
# Target AMI : Amazon Linux 2023
# Instance   : t3.small or larger (t3.micro's 1 GB RAM is tight)
# Security group inbound: 22 (you), 80 + 443 (0.0.0.0/0 — Caddy needs both).
#
# PREREQ (the only manual step): point a DNS A-record at this instance's
# public IP, e.g.  api.scrolt.app -> <public-ip>.  Caddy uses it to get a
# free auto-renewing TLS cert. Without HTTPS the Vercel frontend can't call
# this API (mixed content). Set the four values below, launch, done.
# ─────────────────────────────────────────────────────────────────────────

# ===== FILL THESE FOUR =====================================================
API_DOMAIN="api.scrolt.app"                       # the A-record you created
DATABASE_URL="postgresql://USER:PASS@HOST/DB?sslmode=require"   # Neon pooler URL
AUTH_SECRET="REPLACE_WITH_32B_SECRET"             # MUST equal frontend AUTH_SECRET
CORS_ORIGINS="https://scrolt.vercel.app"          # your frontend origin(s), comma-sep
UPSTASH_REDIS_REST_URL="https://YOUR.upstash.io"  # from Upstash console
UPSTASH_REDIS_REST_TOKEN="YOUR_UPSTASH_TOKEN"
# ===========================================================================

dnf -y update
dnf -y install docker git
systemctl enable --now docker

# --- fetch + build the backend image --------------------------------------
install -d -o root -g root /opt/scrolt
git clone --depth 1 https://github.com/katareayush/scrolt-backend.git /opt/scrolt/backend
cd /opt/scrolt/backend
docker build -t scrolt-backend:live .

# --- runtime env + private docker network ---------------------------------
cat > /opt/scrolt/backend.env <<EOF
NODE_ENV=production
PORT=4000
DATABASE_URL=${DATABASE_URL}
AUTH_SECRET=${AUTH_SECRET}
CORS_ORIGINS=${CORS_ORIGINS}
UPSTASH_REDIS_REST_URL=${UPSTASH_REDIS_REST_URL}
UPSTASH_REDIS_REST_TOKEN=${UPSTASH_REDIS_REST_TOKEN}
EOF
chmod 600 /opt/scrolt/backend.env
docker network create scrolt || true

# --- run DB migrations once (idempotent) ----------------------------------
docker run --rm --network scrolt --env-file /opt/scrolt/backend.env \
  scrolt-backend:live node dist/scripts/migrate.js

# --- backend container (auto-restart, internal only) ----------------------
docker rm -f scrolt-api 2>/dev/null || true
docker run -d --name scrolt-api --network scrolt --restart always \
  --env-file /opt/scrolt/backend.env scrolt-backend:live

# --- Caddy in front: terminates HTTPS, auto-renews, proxies to the API -----
cat > /opt/scrolt/Caddyfile <<EOF
${API_DOMAIN} {
    reverse_proxy scrolt-api:4000
}
EOF
docker rm -f scrolt-caddy 2>/dev/null || true
docker run -d --name scrolt-caddy --network scrolt --restart always \
  -p 80:80 -p 443:443 \
  -v /opt/scrolt/Caddyfile:/etc/caddy/Caddyfile:ro \
  -v caddy_data:/data -v caddy_config:/config \
  caddy:2

echo "Scrolt backend up at https://${API_DOMAIN}  (health: /health)"
