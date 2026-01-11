#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Curl safety defaults (override via env if needed)
CURL_CONNECT_TIMEOUT="${CURL_CONNECT_TIMEOUT:-5}"
CURL_MAX_TIME="${CURL_MAX_TIME:-20}"
CURL_TIMEOUT_ARGS=(--connect-timeout "${CURL_CONNECT_TIMEOUT}" --max-time "${CURL_MAX_TIME}")

# Optional network overrides (useful for no-hairpin NAT / vhost routing)
# - CURL_RESOLVE: whitespace-separated list of entries like "host:port:ip" (passed to curl --resolve)
# - CURL_HOST_HEADER: sets an explicit Host header for HTTP requests
CURL_RESOLVE="${CURL_RESOLVE:-}"
CURL_HOST_HEADER="${CURL_HOST_HEADER:-}"
CURL_EXTRA_ARGS=()

if [[ -n "${CURL_RESOLVE}" ]]; then
  read -ra _RESOLVE_ENTRIES <<<"${CURL_RESOLVE}"
  for _entry in "${_RESOLVE_ENTRIES[@]}"; do
    if [[ -n "${_entry}" ]]; then
      CURL_EXTRA_ARGS+=(--resolve "${_entry}")
    fi
  done
fi

if [[ -n "${CURL_HOST_HEADER}" ]]; then
  CURL_EXTRA_ARGS+=(-H "Host: ${CURL_HOST_HEADER}")
fi

# Usage:
#   ./public/packages/xavi_social/scripts/test-api.sh <JWT> [BASE_URL]
# or:
#   JWT=... ./public/packages/xavi_social/scripts/test-api.sh [BASE_URL]
#
# BASE_URL defaults to http://localhost

JWT_ARG="${1:-}"
BASE_URL_ARG="${2:-}"

if [[ -n "$BASE_URL_ARG" ]]; then
  BASE_URL="$BASE_URL_ARG"
elif [[ -n "$JWT_ARG" && "$JWT_ARG" =~ ^https?:// ]]; then
  # Allow: ./test-api.sh https://host (JWT via env)
  BASE_URL="$JWT_ARG"
  JWT_ARG=""
else
  BASE_URL="${BASE_URL:-http://localhost}"
fi

JWT="${JWT:-$JWT_ARG}"

if [[ -z "$JWT" ]]; then
  # Optional: auto-fetch JWT from a Concrete cookie session.
  GET_JWT_SH="${SCRIPT_DIR}/get-jwt.sh"
  if [[ -x "${GET_JWT_SH}" ]] && { [[ -n "${COOKIE_JAR:-}" ]] || [[ -n "${COOKIE:-}" ]]; }; then
    echo "INFO: JWT missing; attempting to fetch via cookie session..." >&2
    if JWT_FETCHED="$(COOKIE_JAR="${COOKIE_JAR:-}" COOKIE="${COOKIE:-}" "${GET_JWT_SH}" "${BASE_URL}" 2>/dev/null)"; then
      if [[ -n "$JWT_FETCHED" ]]; then
        JWT="$JWT_FETCHED"
        echo "INFO: JWT acquired via cookie session." >&2
      fi
    fi
  fi

  # Optional: mint a JWT offline for automation (requires secret + user id).
  # This avoids having to export browser cookies when running MCP/CI smoke tests.
  if [[ -z "$JWT" ]]; then
    MINT_JWT_PHP="${SCRIPT_DIR}/mint-jwt.php"
    JWT_SUB="${JWT_SUB:-${MINT_USER_ID:-}}"
    if [[ -n "${JWT_SUB}" ]] && [[ -f "${MINT_JWT_PHP}" ]]; then
      if [[ -n "${XAVI_SOCIAL_JWT_SECRET:-}" ]]; then
        echo "INFO: JWT missing; attempting offline mint (JWT_SUB=${JWT_SUB})..." >&2
        if JWT_MINTED="$(php "${MINT_JWT_PHP}" --sub="${JWT_SUB}" --iss="${BASE_URL}" 2>/dev/null)"; then
          if [[ -n "$JWT_MINTED" ]]; then
            JWT="$JWT_MINTED"
            echo "INFO: JWT minted offline." >&2
          fi
        fi
      fi
    fi
  fi

  if [[ -z "$JWT" ]]; then
    echo "WARN: Missing JWT. Auth-required endpoint tests will be skipped." >&2
  fi
fi

ME_URL="${BASE_URL%/}/social/api/me"
DEBUG_URL="${BASE_URL%/}/social/api/debug"
FEED_URL="${BASE_URL%/}/social/api/feed"
POST_URL="${BASE_URL%/}/social/api/post"
THREAD_URL="${BASE_URL%/}/social/api/thread"
PROFILE_URL="${BASE_URL%/}/social/api/profile"
NOTIFICATIONS_URL="${BASE_URL%/}/social/api/notifications"

TEST_FEED_LIMIT="${TEST_FEED_LIMIT:-20}"

echo "BASE_URL: ${BASE_URL}"
echo "ME_URL: ${ME_URL}"
echo "DEBUG_URL: ${DEBUG_URL}"
echo "FEED_URL: ${FEED_URL}"
echo "POST_URL: ${POST_URL}"
echo "THREAD_URL: ${THREAD_URL}"
echo "PROFILE_URL: ${PROFILE_URL}"
echo "NOTIFICATIONS_URL: ${NOTIFICATIONS_URL}"
echo

echo "== /api/me =="
if [[ -z "$JWT" ]]; then
  echo "SKIP: /api/me (requires JWT)" >&2
else
  curl -sS -D - \
    "${CURL_TIMEOUT_ARGS[@]}" \
    "${CURL_EXTRA_ARGS[@]}" \
    -H "Accept: application/json" \
    -H "Authorization: Bearer ${JWT}" \
    "${ME_URL}"
fi

echo

echo "== /api/debug =="
if [[ -z "$JWT" ]]; then
  echo "SKIP: /api/debug (requires JWT)" >&2
else
  curl -sS -D - \
    "${CURL_TIMEOUT_ARGS[@]}" \
    "${CURL_EXTRA_ARGS[@]}" \
    -H "Accept: application/json" \
    -H "Authorization: Bearer ${JWT}" \
    "${DEBUG_URL}"
fi

echo

echo "== /api/feed =="
FEED_HEADERS_FILE="$(mktemp)"
FEED_BODY_FILE="$(mktemp)"
POST_HEADERS_FILE="$(mktemp)"
POST_BODY_FILE="$(mktemp)"
trap 'rm -f "${FEED_HEADERS_FILE}" "${FEED_BODY_FILE}" "${POST_HEADERS_FILE}" "${POST_BODY_FILE}"' EXIT

if [[ -z "$JWT" ]]; then
  curl -sS -D "${FEED_HEADERS_FILE}" -o "${FEED_BODY_FILE}" \
    "${CURL_TIMEOUT_ARGS[@]}" \
    "${CURL_EXTRA_ARGS[@]}" \
    -G \
    -H "Accept: application/json" \
    --data-urlencode "limit=${TEST_FEED_LIMIT}" \
    "${FEED_URL}"
else
  curl -sS -D "${FEED_HEADERS_FILE}" -o "${FEED_BODY_FILE}" \
    "${CURL_TIMEOUT_ARGS[@]}" \
    "${CURL_EXTRA_ARGS[@]}" \
    -G \
    -H "Accept: application/json" \
    -H "Authorization: Bearer ${JWT}" \
    --data-urlencode "limit=${TEST_FEED_LIMIT}" \
    "${FEED_URL}"
fi

cat "${FEED_HEADERS_FILE}"
cat "${FEED_BODY_FILE}"

THREAD_URI="${TEST_THREAD_URI:-}"
PROFILE_ACTOR="${TEST_PROFILE_ACTOR:-}"

if command -v jq >/dev/null 2>&1; then
  if [[ -z "${THREAD_URI}" ]]; then
    THREAD_URI="$(jq -r '(
      .items[0].post.uri //
      .items[0].uri //
      .feed[0].post.uri //
      .feed[0].uri //
      ""
    )' "${FEED_BODY_FILE}" 2>/dev/null || true)"
  fi

  if [[ -z "${PROFILE_ACTOR}" ]]; then
    PROFILE_ACTOR="$(jq -r '(
      .items[0].post.author.did //
      .items[0].post.author.handle //
      .feed[0].post.author.did //
      .feed[0].post.author.handle //
      ""
    )' "${FEED_BODY_FILE}" 2>/dev/null || true)"
  fi
fi

echo

echo "== /api/post =="
if [[ -z "$JWT" ]]; then
  echo "SKIP: /api/post (requires JWT)" >&2
else
  POST_TEXT="test post $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  curl -sS -D "${POST_HEADERS_FILE}" -o "${POST_BODY_FILE}" \
    "${CURL_TIMEOUT_ARGS[@]}" \
    "${CURL_EXTRA_ARGS[@]}" \
    -H "Accept: application/json" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${JWT}" \
    --data "{\"text\":\"${POST_TEXT}\"}" \
    "${POST_URL}"

  cat "${POST_HEADERS_FILE}"
  cat "${POST_BODY_FILE}"

  # If feed is mock (or jq couldn't derive params), derive a usable at:// URI and actor from the post response.
  if command -v jq >/dev/null 2>&1; then
    if [[ -z "${THREAD_URI}" || ! "${THREAD_URI}" =~ ^at:// ]]; then
      THREAD_URI="$(jq -r '(.uri // "")' "${POST_BODY_FILE}" 2>/dev/null || true)"
    fi

    if [[ -z "${PROFILE_ACTOR}" ]]; then
      PROFILE_ACTOR="$(jq -r '(.pdsAccount.did // .pdsAccount.handle // "")' "${POST_BODY_FILE}" 2>/dev/null || true)"
    fi
  else
    if [[ -z "${THREAD_URI}" || ! "${THREAD_URI}" =~ ^at:// ]]; then
      THREAD_URI="$(sed -n 's/.*"uri":"\(at:\/\/[^\"]*\)".*/\1/p' "${POST_BODY_FILE}" | head -n 1)"
    fi

    if [[ -z "${PROFILE_ACTOR}" ]]; then
      PROFILE_ACTOR="$(sed -n 's/.*"pdsAccount".*"did":"\([^\"]*\)".*/\1/p' "${POST_BODY_FILE}" | head -n 1)"
    fi
  fi
fi

echo

echo "== /api/thread =="
if [[ -z "${THREAD_URI}" ]]; then
  echo "SKIP: missing thread uri. Set TEST_THREAD_URI=at://... (or install jq to auto-derive from /api/feed)." >&2
elif [[ -z "$JWT" ]]; then
  echo "SKIP: /api/thread (requires JWT)" >&2
else
  curl -sS -D - \
    "${CURL_TIMEOUT_ARGS[@]}" \
    "${CURL_EXTRA_ARGS[@]}" \
    -G \
    -H "Accept: application/json" \
    -H "Authorization: Bearer ${JWT}" \
    --data-urlencode "uri=${THREAD_URI}" \
    "${THREAD_URL}"
fi

echo

echo "== /api/profile =="
if [[ -z "${PROFILE_ACTOR}" ]]; then
  echo "SKIP: missing profile actor. Set TEST_PROFILE_ACTOR=<did-or-handle> (or install jq to auto-derive from /api/feed)." >&2
elif [[ -z "$JWT" ]]; then
  echo "SKIP: /api/profile (requires JWT)" >&2
else
  curl -sS -D - \
    "${CURL_TIMEOUT_ARGS[@]}" \
    -G \
    -H "Accept: application/json" \
    -H "Authorization: Bearer ${JWT}" \
    --data-urlencode "actor=${PROFILE_ACTOR}" \
    "${PROFILE_URL}"
fi

echo

echo "== /api/notifications =="
if [[ -z "$JWT" ]]; then
  echo "SKIP: /api/notifications (requires JWT)" >&2
else
  curl -sS -D - \
    -G \
    -H "Accept: application/json" \
    -H "Authorization: Bearer ${JWT}" \
    --data-urlencode "limit=10" \
    "${NOTIFICATIONS_URL}"
fi

echo
