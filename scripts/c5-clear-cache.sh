#!/usr/bin/env sh
set -eu

# Convenience wrapper: clears Concrete cache using the repo's Docker-aware helper.
# This avoids "getaddrinfo for mariadb failed" when running Concrete CLI on the host.

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$PKG_DIR/../../../../" && pwd)"

if [ -x "$REPO_DIR/scripts/c5-clear-cache.sh" ]; then
  exec "$REPO_DIR/scripts/c5-clear-cache.sh"
fi

echo "ERROR: expected $REPO_DIR/scripts/c5-clear-cache.sh to exist and be executable" >&2
exit 1
