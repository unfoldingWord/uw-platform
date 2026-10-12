#!/usr/bin/env bash
set -euo pipefail

repo="$1"
pr="$2"
head_sha="$3"

pr_state="$(gh api "repos/$repo/pulls/$pr" --jq '[.state, .head.sha] | @tsv')"
state="$(printf '%s' "$pr_state" | cut -f1)"
current_head="$(printf '%s' "$pr_state" | cut -f2)"

if [ "$state" != "open" ]; then
  echo "::error::PR #$pr is $state; a closed PR gets no Neon branch."
  exit 1
fi
if [ "$current_head" != "$head_sha" ]; then
  echo "::error::PR #$pr has moved to $current_head; this run for $head_sha is stale."
  exit 1
fi

echo "PR #$pr is open at $head_sha."
