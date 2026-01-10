# Host site notes (ConcreteCMS)

This package (`xavi_social`) runs inside the ConcreteCMS site located at `live/` in this repo.

## Where the host app runs

- Repo compose file: `docker-compose.yml` at the repo root.
- Concrete codebase: `live/`
- Public webroot served by nginx: `live/public/`

The host stack defines these services:

- `php` (Concrete PHP-FPM)
- `nginx` (serves `live/public/`)
- `mariadb` (Concrete DB)
- `phpmyadmin`

Important detail: Concrete is configured to use `DB_HOST=mariadb` inside the docker network.
If you run `./vendor/bin/concrete5 ...` on the host (outside docker), it may fail with:
`getaddrinfo for mariadb failed`.

## Running Concrete CLI (package install/update)

To (re)install single pages/routes and upgrade the package, run the CLI inside the `php` service:

- From repo root:
  - `docker compose exec -T php sh -lc 'cd /var/www/html/live && ./vendor/bin/concrete5 c5:package:update xavi_social'`

This is required whenever we add new single page routes such as:

- `/social/api/me/ensure_account`

## Frontend build

The SPA is built with Vite and is intended to be built via the provided scripts:

- Build (package copy): `live/packages/xavi_social/scripts/build-frontend.sh`
- Build (public mirror): `live/public/packages/xavi_social/scripts/build-frontend.sh`

These scripts output to each package’s `dist/` folder.

## Cache permissions (ConcreteCMS)

ConcreteCMS uses a filesystem cache under:

- `live/public/application/files/cache/expensive`

If those folders become root-owned (often caused by running Concrete CLI cache clear as `root`), Concrete can fail to boot with:

- `Stash\Exception\InvalidArgumentException: Cache path is not writable`

Preferred fix (from repo root):

- `./scripts/c5-clear-cache.sh`

This runs the cache permission fixer and then clears caches as `www-data`.

## Notes about mirrored code

This repo keeps a mirrored copy of the package under:

- `live/packages/xavi_social/` (source-of-truth for development)
- `live/public/packages/xavi_social/` (deployed mirror)

When making changes that must affect runtime immediately, update both (or run whatever sync/deploy step your workflow uses).

## Jetstream ingester (public Bluesky firehose)

The Jetstream ingester is a small Node container that connects to a public Jetstream WebSocket and upserts public posts into Postgres (`xavi_social_cached_posts`) with `origin='jetstream'`.

- Compose stack: `live/packages/xavi_social/docker/compose/jetstream/`
- Helper script:
  - `./live/public/packages/xavi_social/scripts/jetstream-ingester.sh up`
  - `./live/public/packages/xavi_social/scripts/jetstream-ingester.sh health`

End-to-end validation:
- Ensure Postgres datastore is up (private docker network `ai_invest`).
- Start the ingester, then confirm `/social/api/feed` returns cached items and a non-empty `cachedCursor`.
- See `live/AI-Tests.md` → “Test 12 — Jetstream ingestion (public, no login)”.
