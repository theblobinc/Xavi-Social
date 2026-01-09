#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./public/packages/xavi_social/scripts/test-api.sh <JWT> [BASE_URL]
# or:
#   JWT=... ./public/packages/xavi_social/scripts/test-api.sh [BASE_URL]
#
# BASE_URL defaults to https://www.princegeorge.app

JWT_ARG="${1:-}"
BASE_URL_ARG="${2:-}"

if [[ -n "$BASE_URL_ARG" ]]; then
  BASE_URL="$BASE_URL_ARG"
elif [[ -n "$JWT_ARG" && "$JWT_ARG" =~ ^https?:// ]]; then
  # Allow: ./test-api.sh https://host (JWT via env)
  BASE_URL="$JWT_ARG"
  JWT_ARG=""
else
  BASE_URL="${BASE_URL:-https://www.princegeorge.app}"
fi

JWT="${JWT:-$JWT_ARG}"

if [[ -z "$JWT" ]]; then
  echo "ERROR: Missing JWT. Provide as first arg or set JWT env var." >&2
  exit 1
fi

ME_URL="${BASE_URL%/}/xavi_social/api/me"
DEBUG_URL="${BASE_URL%/}/xavi_social/api/debug"
FEED_URL="${BASE_URL%/}/xavi_social/api/feed"
POST_URL="${BASE_URL%/}/xavi_social/api/post"

echo "BASE_URL: ${BASE_URL}"
echo "ME_URL: ${ME_URL}"
echo "DEBUG_URL: ${DEBUG_URL}"
echo "FEED_URL: ${FEED_URL}"
echo "POST_URL: ${POST_URL}"
echo

echo "== /api/me =="
curl -sS -D - \
  -H "Accept: application/json" \
  -H "Authorization: Bearer ${JWT}" \
  "${ME_URL}"

echo

echo "== /api/debug =="
curl -sS -D - \
  -H "Accept: application/json" \
  -H "Authorization: Bearer ${JWT}" \
  "${DEBUG_URL}"

echo

echo "== /api/feed =="
curl -sS -D - \
  -H "Accept: application/json" \
  -H "Authorization: Bearer ${JWT}" \
  "${FEED_URL}"

echo

echo "== /api/post =="
POST_TEXT="test post $(date -u +%Y-%m-%dT%H:%M:%SZ)"
curl -sS -D - \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${JWT}" \
  --data "{\"text\":\"${POST_TEXT}\"}" \
  "${POST_URL}"

echo
