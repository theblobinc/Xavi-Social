#!/usr/bin/env bash
set -euo pipefail

# Fetch a Bearer JWT from a Concrete cookie session.
#
# Preconditions:
# - You are already logged into Concrete in a browser OR via curl.
# - You have access to the Concrete session cookie(s), provided via either:
#   - COOKIE_JAR: a Netscape cookie-jar file (recommended), OR
#   - COOKIE: a raw Cookie header value (paste from DevTools).
#
# Usage:
#   COOKIE_JAR=./cookies.txt ./public/packages/xavi_social/scripts/get-jwt.sh [BASE_URL]
#   COOKIE='Concrete5=...; other=...' ./public/packages/xavi_social/scripts/get-jwt.sh [BASE_URL]
#
# BASE_URL defaults to http://localhost

BASE_URL="${1:-${BASE_URL:-http://localhost}}"
JWT_URL="${BASE_URL%/}/social/api/jwt"

if [[ -z "${COOKIE_JAR:-}" && -z "${COOKIE:-}" ]]; then
  echo "ERROR: Missing cookie context. Set COOKIE_JAR (cookie file) or COOKIE (raw Cookie header value)." >&2
  exit 1
fi

CURL_ARGS=(
  -sS
  -H "Accept: application/json"
)

if [[ -n "${COOKIE_JAR:-}" ]]; then
  if [[ ! -f "$COOKIE_JAR" ]]; then
    echo "ERROR: COOKIE_JAR file not found: ${COOKIE_JAR}" >&2
    exit 1
  fi
  CURL_ARGS+=( -b "$COOKIE_JAR" )
elif [[ -n "${COOKIE:-}" ]]; then
  CURL_ARGS+=( -H "Cookie: ${COOKIE}" )
fi

RESP="$(curl "${CURL_ARGS[@]}" "$JWT_URL")"

# Print just the token to stdout (easy for scripting).
if command -v jq >/dev/null 2>&1; then
  TOKEN="$(printf '%s' "$RESP" | jq -r '.token // empty')"
  if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
    echo "ERROR: Could not extract token from response." >&2
    echo "$RESP" >&2
    exit 1
  fi
  printf '%s\n' "$TOKEN"
  exit 0
fi

# Fallback parsing without jq.
TOKEN="$(printf '%s' "$RESP" | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]\+\)".*/\1/p' | head -n 1)"
if [[ -z "$TOKEN" ]]; then
  echo "ERROR: Could not extract token from response (install jq for more robust parsing)." >&2
  echo "$RESP" >&2
  exit 1
fi

printf '%s\n' "$TOKEN"
