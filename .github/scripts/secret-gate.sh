#!/usr/bin/env bash
set -euo pipefail

name="$1"
value="${!name:-}"

if [[ -n "$value" ]]; then
  echo "configured=true" >> "$GITHUB_OUTPUT"
else
  echo "configured=false" >> "$GITHUB_OUTPUT"
  echo "::notice::$name is not set, so this job skips its go-live steps and stays green."
fi
