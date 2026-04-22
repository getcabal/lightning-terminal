#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "usage: $0 <base-url> <skill-id> [auth-header]" >&2
  exit 1
fi

BASE_URL="${1%/}"
SKILL_ID="$2"
AUTH_HEADER="${3:-}"

MANIFEST_URL="$BASE_URL/.well-known/l402/skills/$SKILL_ID"

echo "== manifest =="
MANIFEST="$(curl -sS "$MANIFEST_URL")"
echo "$MANIFEST" | jq

PAID_URL="$(echo "$MANIFEST" | jq -r '.paid_url')"
CONTENT_HASH="$(echo "$MANIFEST" | jq -r '.content_sha256')"

if [[ "$PAID_URL" == "null" || -z "$PAID_URL" ]]; then
  echo "paid_url missing from manifest" >&2
  exit 1
fi

HDRS="$(mktemp)"
BODY="$(mktemp)"
trap 'rm -f "$HDRS" "$BODY"' EXIT

echo
echo "== paywall challenge =="
curl -sS -D "$HDRS" -o "$BODY" "$BASE_URL$PAID_URL"
sed -n '1,20p' "$BODY"
grep -i '^www-authenticate:' "$HDRS" || true

if [[ -n "$AUTH_HEADER" ]]; then
  echo
  echo "== authorized request =="
  curl -sS -D - -H "Authorization: $AUTH_HEADER" "$BASE_URL$PAID_URL" -o /dev/null |
    grep -Ei 'HTTP/|etag:|x-skill-version:|content-type:'
  echo "expected content hash: $CONTENT_HASH"
fi
