#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BASE_URL_DEFAULT="https://www.princegeorge.app"
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
  curl -sS -D - -H "Accept: application/json" "${SESSION_URL}" || true
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
  curl -sS -D - -H "Accept: application/json" "${JWT_URL}" || true
fi

exit 0
