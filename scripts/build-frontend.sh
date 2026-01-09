#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
FRONTEND_DIR="${PKG_DIR}/frontend"
COMPOSE_FILE="${PKG_DIR}/docker/compose/frontend/docker-compose.yml"

cd "${FRONTEND_DIR}"

if [[ ! -f package.json ]]; then
  echo "ERROR: package.json not found in ${FRONTEND_DIR}" >&2
  exit 1
fi

if [[ -f "${COMPOSE_FILE}" ]] && command -v docker >/dev/null 2>&1; then
  docker compose -f "${COMPOSE_FILE}" run --rm frontend-build
else
  echo "WARN: Docker compose file not found or docker unavailable; falling back to host npm." >&2

  # Prefer reproducible installs when lockfile exists.
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi

  npm run build
fi

echo "Built frontend to: ${PKG_DIR}/dist"
