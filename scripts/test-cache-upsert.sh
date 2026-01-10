#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Smoke-test Postgres cache upsert + feed/search readback.
#
# Usage:
#   ./public/packages/xavi_social/scripts/test-cache-upsert.sh [BASE_URL]
# or:
#   JWT=... ./public/packages/xavi_social/scripts/test-cache-upsert.sh [BASE_URL]
#
# Auth options:
# - Provide JWT directly (env JWT=...)
# - Provide Concrete cookie session (COOKIE_JAR=... or COOKIE=...)
# - Offline mint (default): will attempt to read Concrete config secret via docker+CLI and mint a JWT
#
# Notes:
# - Requires /social/api/cache/upsert route installed (package update).

BASE_URL="${1:-${BASE_URL:-http://127.0.0.1:6478}}"
BASE_URL="${BASE_URL%/}"

JWT="${JWT:-}"

get_secret_from_concrete_config() {
  # Try to read xavi_social.jwt_secret from the live/ Concrete install via docker.
  if command -v docker >/dev/null 2>&1; then
    (cd "${SCRIPT_DIR}/../../../../.." && docker compose exec -u www-data php bash -lc 'cd live && php vendor/bin/concrete5 c5:config get xavi_social.jwt_secret' 2>/dev/null || true) | tr -d '\r' | tail -n 1
  fi
}

if [[ -z "${JWT}" ]]; then
  # Optional: auto-fetch JWT from a Concrete cookie session.
  GET_JWT_SH="${SCRIPT_DIR}/get-jwt.sh"
  if [[ -x "${GET_JWT_SH}" ]] && { [[ -n "${COOKIE_JAR:-}" ]] || [[ -n "${COOKIE:-}" ]]; }; then
    echo "INFO: JWT missing; attempting to fetch via cookie session..." >&2
    if JWT_FETCHED="$(COOKIE_JAR="${COOKIE_JAR:-}" COOKIE="${COOKIE:-}" "${GET_JWT_SH}" "${BASE_URL}" 2>/dev/null)"; then
      if [[ -n "${JWT_FETCHED}" ]]; then
        JWT="${JWT_FETCHED}"
        echo "INFO: JWT acquired via cookie session." >&2
      fi
    fi
  fi
fi

if [[ -z "${JWT}" ]]; then
  MINT_JWT_PHP="${SCRIPT_DIR}/mint-jwt.php"
  JWT_SUB="${JWT_SUB:-${MINT_USER_ID:-1}}"

  if [[ -f "${MINT_JWT_PHP}" ]]; then
    SECRET="${XAVI_SOCIAL_JWT_SECRET:-}"
    if [[ -z "${SECRET}" ]]; then
      SECRET="$(get_secret_from_concrete_config)"
    fi

    if [[ -n "${SECRET}" ]]; then
      echo "INFO: JWT missing; minting offline (sub=${JWT_SUB})..." >&2
      JWT="$(php "${MINT_JWT_PHP}" --sub="${JWT_SUB}" --iss="${BASE_URL}" --secret="${SECRET}" 2>/dev/null || true)"
      if [[ -n "${JWT}" ]]; then
        echo "INFO: JWT minted offline." >&2
      fi
    fi
  fi
fi

if [[ -z "${JWT}" ]]; then
  echo "ERROR: Unable to acquire JWT (set JWT=..., or COOKIE_JAR/COOKIE, or XAVI_SOCIAL_JWT_SECRET)." >&2
  exit 2
fi

UPSERT_URL="${BASE_URL}/social/api/cache/upsert"
FEED_URL="${BASE_URL}/social/api/feed?limit=50"

NOW="$(date -u +%Y%m%dT%H%M%SZ)"
UNIQ="cachetest-${NOW}"
URI="mock://cached/${UNIQ}"

PAYLOAD=$(cat <<JSON
{"items":[{"uri":"${URI}","cid":"${UNIQ}","text":"hello ${UNIQ}","createdAt":"${NOW}","indexedAt":"${NOW}","audience":"public","author":{"did":"did:mock:${UNIQ}","handle":"${UNIQ}","displayName":"${UNIQ}","avatar":""}}]}
JSON
)

echo "== upsert =="
UPSERT_RESP="$(curl -sS \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${JWT}" \
  --data "${PAYLOAD}" \
  "${UPSERT_URL}")"

echo "${UPSERT_RESP}"

echo
echo "== feed contains uri =="
FEED_RESP="$(curl -sS -H 'Accept: application/json' "${FEED_URL}")"

if command -v jq >/dev/null 2>&1; then
  echo "${FEED_RESP}" | jq -r --arg uri "${URI}" '(.items // []) | map(select(.uri == $uri)) | length' | {
    read -r n
    if [[ "${n}" -lt 1 ]]; then
      echo "ERROR: feed missing expected uri: ${URI}" >&2
      exit 3
    fi
  }
else
  if ! echo "${FEED_RESP}" | grep -q "${URI}"; then
    echo "ERROR: feed missing expected uri: ${URI}" >&2
    exit 3
  fi
fi

echo "OK"

echo
echo "== search contains uri =="
SEARCH_URL="${BASE_URL}/social/api/search?q=${UNIQ}&limit=10"
SEARCH_RESP="$(curl -sS -H 'Accept: application/json' "${SEARCH_URL}")"

if command -v jq >/dev/null 2>&1; then
  echo "${SEARCH_RESP}" | jq -r --arg uri "${URI}" '(.items // []) | map(select(.uri == $uri)) | length' | {
    read -r n
    if [[ "${n}" -lt 1 ]]; then
      echo "ERROR: search missing expected uri: ${URI}" >&2
      exit 4
    fi
  }
else
  if ! echo "${SEARCH_RESP}" | grep -q "${URI}"; then
    echo "ERROR: search missing expected uri: ${URI}" >&2
    exit 4
  fi
fi

echo "OK"

echo
echo "PASS"
