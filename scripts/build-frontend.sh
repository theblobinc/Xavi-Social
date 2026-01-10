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

# Write a lightweight build stamp for debugging cache/deploy issues.
# This file is safe to ship and can be fetched by the SPA.
if [[ -d "${PKG_DIR}/dist" ]]; then
  built_at_epoch="$(date +%s)"
  built_at_utc="$(date -u -Iseconds)"

  pkg_version=""
  if [[ -f "${PKG_DIR}/controller.php" ]]; then
    pkg_version_line="$(grep -F 'protected $pkgVersion' "${PKG_DIR}/controller.php" | head -n 1 || true)"
    if [[ -n "${pkg_version_line}" ]]; then
      pkg_version="$(printf '%s' "${pkg_version_line}" | sed -nE "s/.*'([^']+)'.*/\1/p" || true)"
      if [[ -z "${pkg_version}" ]]; then
        pkg_version="$(printf '%s' "${pkg_version_line}" | sed -nE 's/.*"([^"]+)".*/\1/p' || true)"
      fi
    fi
  fi

  site_dir="$(cd "${PKG_DIR}/../../../../" && pwd)"
  git_sha=""
  if command -v git >/dev/null 2>&1; then
    git_sha="$(git -C "${PKG_DIR}" rev-parse --short HEAD 2>/dev/null || true)"
    if [[ -z "${git_sha}" ]]; then
      git_sha="$(git -C "${site_dir}" rev-parse --short HEAD 2>/dev/null || true)"
    fi
  fi

  cat > "${PKG_DIR}/dist/build.json" <<JSON
{
  "builtAt": "${built_at_utc}",
  "builtAtEpoch": ${built_at_epoch},
  "pkgVersion": "${pkg_version}",
  "gitSha": "${git_sha}"
}
JSON
fi

# Normalize ownership/permissions on build artifacts to avoid root-owned dist when built via Docker.
if [[ -d "${PKG_DIR}/dist" ]]; then
  if command -v chown >/dev/null 2>&1; then
    chown -R "$(id -u):$(id -g)" "${PKG_DIR}/dist" 2>/dev/null || true
  fi
  chmod -R u+rwX "${PKG_DIR}/dist" 2>/dev/null || true
fi
