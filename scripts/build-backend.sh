#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SITE_DIR="$(cd "${PKG_DIR}/../../../../" && pwd)"

PHP_CONTAINER="${PGAPP_PHP_CONTAINER:-}"
PHP_USER="${PGAPP_PHP_USER:-www-data}"
C5_BIN="/var/www/html/live/public/concrete/bin/concrete5"

SKIP_CACHE_CLEAR=0
SKIP_ENTITIES_REFRESH=0
SKIP_PACKAGE_UPDATE=0

usage() {
  cat <<'USAGE'
Usage: build-backend.sh [options]

Runs ConcreteCMS backend maintenance steps inside the main PHP container.

Options:
  --skip-cache-clear       Do not run c5:clear-cache
  --skip-entities-refresh  Do not run c5:entities:refresh
  --skip-package-update    Do not run c5:package:update xavi_social
  -h, --help               Show help

Env:
  PGAPP_PHP_CONTAINER      Override PHP container name/id (default: auto-detect via docker compose service 'php')
  PGAPP_PHP_USER           Override user for docker exec (default: www-data)
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-cache-clear) SKIP_CACHE_CLEAR=1; shift ;;
    --skip-entities-refresh) SKIP_ENTITIES_REFRESH=1; shift ;;
    --skip-package-update) SKIP_PACKAGE_UPDATE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "ERROR: Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required to run backend build steps (Concrete DB host is docker-only)." >&2
  exit 1
fi

if [[ -z "$PHP_CONTAINER" ]]; then
  if docker compose version >/dev/null 2>&1 && [[ -f "${SITE_DIR}/docker-compose.yml" ]]; then
    PHP_CONTAINER="$(cd "${SITE_DIR}" && docker compose ps -q php || true)"
  fi
fi

if [[ -z "$PHP_CONTAINER" ]] || ! docker inspect "$PHP_CONTAINER" >/dev/null 2>&1; then
  echo "ERROR: PHP container not found." >&2
  echo "Hint: set PGAPP_PHP_CONTAINER explicitly, or start the stack: (cd ${SITE_DIR} && docker compose up -d php)" >&2
  exit 1
fi

run_c5() {
  # Prefer a non-root user to avoid interactive "root discouraged" prompts.
  # Fall back to root if the user doesn't exist in the container.
  if docker exec -u "$PHP_USER" "$PHP_CONTAINER" php "$C5_BIN" "$@"; then
    return 0
  fi

  if [[ "${1:-}" == "c5:clear-cache" ]]; then
    docker exec "$PHP_CONTAINER" php "$C5_BIN" "$@" --allow-as-root
  else
    docker exec "$PHP_CONTAINER" php "$C5_BIN" "$@"
  fi
}

echo "Backend build: site=${SITE_DIR} pkg=${PKG_DIR}"

echo "Checking Concrete install state..."
run_c5 c5:is-installed >/dev/null

echo "Clearing caches..."
if [[ $SKIP_CACHE_CLEAR -eq 0 ]]; then
  run_c5 c5:clear-cache
else
  echo "(skip) c5:clear-cache"
fi

echo "Refreshing entities..."
if [[ $SKIP_ENTITIES_REFRESH -eq 0 ]]; then
  run_c5 c5:entities:refresh
else
  echo "(skip) c5:entities:refresh"
fi

echo "Updating package xavi_social..."
if [[ $SKIP_PACKAGE_UPDATE -eq 0 ]]; then
  if ! run_c5 c5:package:update xavi_social; then
    echo "Package update failed; attempting install then update..." >&2
    run_c5 c5:package:install xavi_social
    run_c5 c5:package:update xavi_social
  fi
else
  echo "(skip) c5:package:update xavi_social"
fi

# Clear caches again so updated package changes are visible immediately.
if [[ $SKIP_CACHE_CLEAR -eq 0 ]]; then
  echo "Clearing caches (post-update)..."
  run_c5 c5:clear-cache
fi

echo "Done."
