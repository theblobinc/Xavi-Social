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

BASE_URL_DEFAULT="http://localhost"
BASE_URL_ARG="${1:-}"  # optional

# Allow BASE_URL as env var override
if [[ -n "${BASE_URL_ARG}" ]]; then
  BASE_URL="${BASE_URL_ARG}"
else
  BASE_URL="${BASE_URL:-$BASE_URL_DEFAULT}"
fi

BASE_URL="${BASE_URL%/}"
SESSION_URL="${BASE_URL}/social/api/session"
JWT_URL="${BASE_URL}/social/api/jwt"

MINT_USER_ID="${MINT_USER_ID:-${JWT_SUB:-1}}"
SECRET="${XAVI_SOCIAL_JWT_SECRET:-}"  # required for offline mint
MINT_JWT_PHP="${SCRIPT_DIR}/mint-jwt.php"

JWT="${JWT:-${JWT_ARG:-}}"

echo "BASE_URL: ${BASE_URL}" >&2

# 1) Check session (cookie-based) — helpful for browser-provided cookies during MCP runs
if command -v curl >/dev/null 2>&1; then
  echo "== /api/session ==" >&2
  curl -sS -D - \
    "${CURL_TIMEOUT_ARGS[@]}" \
    "${CURL_EXTRA_ARGS[@]}" \
    -H "Accept: application/json" \
    "${SESSION_URL}" || true
  echo >&2
else
  echo "WARN: curl not found; skipping session check" >&2
fi

# 2) Try to mint a JWT offline if not already provided
if [[ -z "${JWT}" ]]; then
  if [[ -z "${SECRET}" ]]; then
    echo "WARN: XAVI_SOCIAL_JWT_SECRET not set; skipping offline mint. Provide JWT or secret to test auth endpoints." >&2
  elif [[ ! -f "${MINT_JWT_PHP}" ]]; then
    echo "WARN: mint-jwt.php missing at ${MINT_JWT_PHP}; cannot mint." >&2
  else
    echo "INFO: minting JWT via mint-jwt.php (sub=${MINT_USER_ID}, iss=${BASE_URL})" >&2
    if JWT_MINTED="$(XAVI_SOCIAL_JWT_SECRET="${SECRET}" php "${MINT_JWT_PHP}" --sub="${MINT_USER_ID}" --iss="${BASE_URL}" 2>/dev/null)"; then
      if [[ -n "${JWT_MINTED}" ]]; then
        JWT="${JWT_MINTED}"
        echo "INFO: JWT minted successfully." >&2
      else
        echo "WARN: JWT mint returned empty output." >&2
      fi
    else
      echo "WARN: JWT mint failed." >&2
    fi
  fi
fi

# 3) If still missing JWT, attempt cookie-based fetch via test-api helper
if [[ -z "${JWT}" ]]; then
  if [[ -x "${SCRIPT_DIR}/get-jwt.sh" ]]; then
    echo "INFO: trying cookie-based JWT fetch via get-jwt.sh" >&2
    if JWT_FETCHED="$("${SCRIPT_DIR}/get-jwt.sh" "${BASE_URL}" 2>/dev/null)"; then
      if [[ -n "${JWT_FETCHED}" ]]; then
        JWT="${JWT_FETCHED}"
        echo "INFO: JWT fetched from cookie session." >&2
      fi
    fi
  fi
fi

# 4) Invoke the broader API smoke test
if [[ -n "${JWT}" ]]; then
  echo "INFO: Running test-api.sh with minted/fetched JWT" >&2
  JWT="${JWT}" "${SCRIPT_DIR}/test-api.sh" "${BASE_URL}" || true
else
  echo "WARN: No JWT available; running public portions of test-api.sh" >&2
  "${SCRIPT_DIR}/test-api.sh" "${BASE_URL}" || true
fi

# 5) Explicit /api/jwt check to confirm server-side secret wiring
if [[ -n "${SECRET}" ]]; then
  echo >&2
  echo "== /api/jwt (server) ==" >&2
  # Do not print tokens to output logs.
  BODY_FILE="$(mktemp)"
  trap 'rm -f "${BODY_FILE}"' EXIT
  curl -sS -D - -o "${BODY_FILE}" \
    "${CURL_TIMEOUT_ARGS[@]}" \
    "${CURL_EXTRA_ARGS[@]}" \
    -H "Accept: application/json" \
    "${JWT_URL}" || true

  if command -v jq >/dev/null 2>&1; then
    TOKEN_LEN="$(jq -r '(.token // "") | tostring | length' "${BODY_FILE}" 2>/dev/null || echo 0)"
    if [[ "${TOKEN_LEN}" != "0" ]]; then
      echo "(token redacted; length=${TOKEN_LEN})" >&2
    else
      cat "${BODY_FILE}" >&2
    fi
  else
    # Best-effort redaction without jq.
    if grep -q '"token"' "${BODY_FILE}" 2>/dev/null; then
      sed -E 's/("token"[[:space:]]*:[[:space:]]*")([^"]+)(")/\1***redacted***\3/g' "${BODY_FILE}" >&2
    else
      cat "${BODY_FILE}" >&2
    fi
  fi
fi

exit 0
