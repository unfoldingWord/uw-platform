#!/usr/bin/env bash
set -euo pipefail

url="$1"
sha="$2"

for attempt in $(seq 1 24); do
  body="$(curl -fsS "$url" || true)"
  if printf '%s' "$body" | grep -q "\"commit\":\"$sha\""; then
    echo "$url reports $sha"
    exit 0
  fi
  echo "attempt $attempt: $url returned ${body:-nothing}"
  sleep 5
done

echo "::error::$url never reported commit $sha"
exit 1
