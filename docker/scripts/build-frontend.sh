#!/usr/bin/env bash
set -euo pipefail

find_compose() {
  if docker compose version >/dev/null 2>&1; then echo "docker compose"; return; fi
  if command -v docker-compose >/dev/null 2>&1; then echo "docker-compose"; return; fi
  echo "ERROR: Neither 'docker compose' nor 'docker-compose' found." >&2
  exit 1
}
COMPOSE_CMD="$(find_compose)"

BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$BASE/compose/frontend/docker-compose.yml"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "ERROR: Frontend compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

$COMPOSE_CMD -f "$COMPOSE_FILE" run --rm frontend-build

echo ">> Built frontend to: $BASE/../dist"
