#!/usr/bin/env bash
set -euo pipefail

repo="$1"
actor="$2"

deployers="$(gh api "repos/$repo/contents/.github/production-deployers?ref=main" --jq .content | base64 -d)"
if ! printf '%s\n' "$deployers" | grep -qxF "$actor"; then
  echo "::error::$actor is not in .github/production-deployers on main; only the listed DRIs deploy production."
  exit 1
fi

echo "$actor is listed in main's .github/production-deployers."
