#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_DIR="$ROOT_DIR/docker/compose/jetstream"

usage() {
  cat <<'USAGE'
Usage:
  ./public/packages/xavi_social/scripts/jetstream-ingester.sh up
  ./public/packages/xavi_social/scripts/jetstream-ingester.sh down
  ./public/packages/xavi_social/scripts/jetstream-ingester.sh health

Commands:
  up      Build + start the Jetstream ingester container
  down    Stop the Jetstream ingester container
  health  Print one line: "ingesting OK" (or exit non-zero)
USAGE
}

cmd="${1:-}"
if [[ -z "$cmd" ]]; then
  usage
  exit 2
fi

cd "$COMPOSE_DIR"

case "$cmd" in
  up)
    if ! docker inspect -f '{{.State.Status}}' xavi-social-datastore-postgres-1 >/dev/null 2>&1; then
      echo "WARN: datastore Postgres not found (expected container: xavi-social-datastore-postgres-1)." >&2
      echo "      Start it with: bash docker/scripts/up.sh" >&2
    fi
    docker compose up -d --build
    ;;
  down)
    docker compose down
    ;;
  health)
    # Health definition:
    # - at least one jetstream row exists
    # - max(updated_at) for origin='jetstream' is recent (<= 120s)

    if ! docker inspect -f '{{.State.Status}}' xavi-social-datastore-postgres-1 >/dev/null 2>&1; then
      echo "datastore Postgres not running (expected container: xavi-social-datastore-postgres-1)" >&2
      echo "Start it with: bash docker/scripts/up.sh" >&2
      exit 1
    fi

    # Returns epoch seconds or empty.
    max_epoch="$(docker exec -i xavi-social-datastore-postgres-1 psql -U xavi_social -d xavi_social -Atc \
      "select coalesce(extract(epoch from max(updated_at))::bigint, 0) from xavi_social_cached_posts where origin='jetstream';" \
      | tr -d '\r' || true)"

    if [[ -z "$max_epoch" || "$max_epoch" == "0" ]]; then
      exit 1
    fi

    now_epoch="$(date -u +%s)"
    age="$(( now_epoch - max_epoch ))"

    if (( age <= 120 )); then
      echo "ingesting OK"
      exit 0
    fi

    exit 1
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage
    exit 2
    ;;
esac
