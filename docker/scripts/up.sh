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
COMPOSE_DIR="$BASE/compose"

( cd "$COMPOSE_DIR/datastore" && $COMPOSE_CMD up -d )

echo ">> Started: datastore"
