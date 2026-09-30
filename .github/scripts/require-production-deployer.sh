#!/usr/bin/env bash
set -euo pipefail

repo="$1"
actor="$2"

permission="$(gh api "repos/$repo/collaborators/$actor/permission" --jq .permission)"
if [ "$permission" != "admin" ]; then
  echo "::error::$actor has $permission permission on $repo; production deploys need admin."
  exit 1
fi

deployers="$(gh api "repos/$repo/contents/.github/production-deployers?ref=main" --jq .content | base64 -d)"
if ! printf '%s\n' "$deployers" | grep -qxF "$actor"; then
  echo "::error::$actor is not in .github/production-deployers on main; only the listed org admins deploy production."
  exit 1
fi

echo "$actor is a repository admin listed in main's production-deployers."
