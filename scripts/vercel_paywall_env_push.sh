#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "usage: $0 <production|preview|development> <env-file> [preview-git-branch]" >&2
  exit 1
fi

ENVIRONMENT="$1"
ENV_FILE="$2"
PREVIEW_GIT_BRANCH="${3:-}"
SCOPE="brianmurray333s-projects"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../paywall-web" && pwd)"

case "$ENVIRONMENT" in
  production|preview|development)
    ;;
  *)
    echo "invalid environment: $ENVIRONMENT" >&2
    exit 1
    ;;
esac

if [[ ! -f "$ENV_FILE" ]]; then
  echo "env file not found: $ENV_FILE" >&2
  exit 1
fi

required_vars=(
  LIGHTNING_NODE_TYPE
  LIGHTNING_NODE_URL
  LIGHTNING_API_KEY
  L402_MACAROON_ROOT_KEY
  ADMIN_PUBLISH_TOKEN
)

optional_vars=(
  DATABASE_URL
  BLOB_READ_WRITE_TOKEN
  EDGE_CONFIG
  VERCEL_ACCESS_TOKEN
  VERCEL_EDGE_CONFIG_ID
  VERCEL_TEAM_ID
  L402_INVOICE_EXPIRY
  L402_MIN_AMOUNT_SATS
  L402_MAX_AMOUNT_SATS
  LIGHTNING_WEBHOOK_SECRET
  L402_SATS_PER_CREDIT
)

read_var() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 1
  fi

  printf '%s' "${line#*=}"
}

looks_like_placeholder() {
  local value="$1"

  case "$value" in
    *replace-with-*|*xxxxxxxx*|*example.com*|*USER:PASSWORD@HOST*|*your-voltage-node-host*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

push_var() {
  local key="$1"
  local value="$2"
  local -a cmd

  if looks_like_placeholder "$value"; then
    echo "refusing to push placeholder value for $key from $ENV_FILE" >&2
    exit 1
  fi

  cmd=(
    vercel env add "$key" "$ENVIRONMENT"
    --scope "$SCOPE"
    --cwd "$PROJECT_DIR"
    --value "$value"
    --yes
    --force
  )

  if [[ "$ENVIRONMENT" == "preview" && -n "$PREVIEW_GIT_BRANCH" ]]; then
    cmd=(
      vercel env add "$key" "$ENVIRONMENT" "$PREVIEW_GIT_BRANCH"
      --scope "$SCOPE"
      --cwd "$PROJECT_DIR"
      --value "$value"
      --yes
      --force
    )
  fi

  "${cmd[@]}" >/dev/null

  echo "set $key for $ENVIRONMENT"
}

for key in "${required_vars[@]}"; do
  if ! value="$(read_var "$key")"; then
    echo "missing required variable in $ENV_FILE: $key" >&2
    exit 1
  fi

  push_var "$key" "$value"
done

for key in "${optional_vars[@]}"; do
  if value="$(read_var "$key")"; then
    push_var "$key" "$value"
  fi
done

echo
echo "done"
echo "next:"
echo "  cd \"$PROJECT_DIR\""
echo "  vercel env ls $ENVIRONMENT --scope $SCOPE"

if [[ "$ENVIRONMENT" == "preview" && -z "$PREVIEW_GIT_BRANCH" ]]; then
  echo
  echo "note:"
  echo "  if Vercel asks for a git branch in non-interactive mode,"
  echo "  rerun with a non-production preview branch as the third argument"
fi
