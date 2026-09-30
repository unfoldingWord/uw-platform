#!/usr/bin/env bash
set -euo pipefail

repo="$1"
pr="$2"
head_sha="$3"
artifact="$4"

pr_state="$(gh api "repos/$repo/pulls/$pr" --jq '[.state, .head.sha] | @tsv')"
state="$(printf '%s' "$pr_state" | cut -f1)"
current_head="$(printf '%s' "$pr_state" | cut -f2)"

if [ "$state" != "open" ]; then
  echo "::error::PR #$pr is $state; a closed PR gets no Worker."
  exit 1
fi
if [ "$current_head" != "$head_sha" ]; then
  echo "::error::PR #$pr has moved to $current_head; this build of $head_sha is stale."
  exit 1
fi

contents="$(find "$artifact" -mindepth 1 -printf '%P\n' | sort)"
if [ "$contents" != "index.js" ]; then
  echo "::error::The PR artifact must hold only index.js; it holds: $contents"
  exit 1
fi

echo "PR #$pr is open at $head_sha; artifact holds only index.js."
