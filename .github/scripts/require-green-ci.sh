#!/usr/bin/env bash
set -euo pipefail

repo="$1"
sha="$2"
required=(security-audit lint typecheck architecture test build)

runs="$(gh api --paginate "repos/$repo/commits/$sha/check-runs?per_page=100" \
  --jq '.check_runs[] | [.name, (.conclusion // "pending"), (.completed_at // "")] | @tsv')"

failed=0
for name in "${required[@]}"; do
  latest="$(printf '%s\n' "$runs" | awk -F'\t' -v job="$name" '$1 == job' | sort -t$'\t' -k3 | tail -n1 | cut -f2)"
  if [ "$latest" = "success" ]; then
    echo "$name: success"
  else
    echo "::error::CI job $name on $sha is ${latest:-missing}; production needs every CI job green on the deployed commit."
    failed=1
  fi
done

exit "$failed"
