#!/usr/bin/env bash
set -euo pipefail

host="${DATABASE_TUNNEL_HOST:-}"
port="${DATABASE_TUNNEL_PORT:-15432}"
version="${CLOUDFLARED_VERSION:-2025.7.0}"

if [[ -z "$host" ]]; then
  echo "::notice::DATABASE_TUNNEL_HOST is not set, so migrations connect to DATABASE_URL directly."
  exit 0
fi

if [[ -z "${DATABASE_TUNNEL_CLIENT_ID:-}" || -z "${DATABASE_TUNNEL_CLIENT_SECRET:-}" ]]; then
  echo "::error::DATABASE_TUNNEL_HOST is set, so DATABASE_TUNNEL_CLIENT_ID and DATABASE_TUNNEL_CLIENT_SECRET (the Access service token) must be set too."
  exit 1
fi

bin="${RUNNER_TEMP:-/tmp}/cloudflared"
curl -fsSL -o "$bin" "https://github.com/cloudflare/cloudflared/releases/download/${version}/cloudflared-linux-amd64"
chmod +x "$bin"

nohup "$bin" access tcp \
  --hostname "$host" \
  --url "127.0.0.1:${port}" \
  --service-token-id "$DATABASE_TUNNEL_CLIENT_ID" \
  --service-token-secret "$DATABASE_TUNNEL_CLIENT_SECRET" \
  > "${RUNNER_TEMP:-/tmp}/cloudflared.log" 2>&1 &

for _ in $(seq 1 30); do
  if (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null; then
    echo "The database tunnel listens on 127.0.0.1:${port}; DATABASE_URL must point there."
    exit 0
  fi
  sleep 1
done

echo "::error::The database tunnel did not open on 127.0.0.1:${port} within 30 seconds."
cat "${RUNNER_TEMP:-/tmp}/cloudflared.log" || true
exit 1
