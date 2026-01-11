# Xavi Social (dev docker)

For a full overview of the stacks (datastore, PDS, Jetstream ingester, frontend build) and how they’re wired on the `xavi_social` network, see `DOCKER.md`.

This folder is intentionally minimal. It’s meant to be a reference/starting point (patterned after the `xavi.app` docker scripts), not a full copy of that stack.

## Datastore stack

Provides Postgres + Redis + MinIO for local development.

These services run on the private Docker network `xavi_social` (the same network as your main ConcreteCMS stack).

- Postgres: `postgres:5432`
- Redis: `redis:6379`
- MinIO S3: `minio:9000`
- MinIO console: `minio:9001` (not published to the host)

### Start

1. Create an env file:
   - Copy `docker/compose/datastore/.env.example` → `docker/compose/datastore/.env`
2. Bring it up:
   - `bash docker/scripts/up.sh`

### Stop

- `bash docker/scripts/down.sh`

### Status

- `bash docker/scripts/status.sh`

## Notes

- These services do not publish ports to the host; they’re intended to be accessed from other containers on `xavi_social`.
- Ensure the `xavi_social` network exists (your main app stack should use it as an external network).
- This is backend plumbing only; ConcreteCMS itself is not containerized here because this repo only contains the package.

## Jetstream ingester (public Bluesky firehose)

Consumes the public Bluesky Jetstream WebSocket and upserts public posts into Postgres (`xavi_social_cached_posts`) with `origin='jetstream'`.

This is intended for the “public merged feed” path (no login required).

### Start

- Preferred:
   - `./scripts/jetstream-ingester.sh up`
- Or manually:
   - `cd docker/compose/jetstream && docker compose up -d --build`

### Stop

- Preferred:
   - `./scripts/jetstream-ingester.sh down`
- Or manually:
   - `cd docker/compose/jetstream && docker compose down`

### Health

- `./scripts/jetstream-ingester.sh health`

Expected:
- prints exactly: `ingesting OK`

### Notes

- The ingester reuses `docker/compose/datastore/.env` for `PG_PASSWORD`.
- Cursor state is persisted in a named Docker volume so restarts resume.

## Frontend build (Dockerized)

The Vite/Node toolchain is intended to run in Docker so the host doesn’t need Node installed.

- Build the SPA bundle:
   - `bash scripts/build-frontend.sh`
   - or: `bash docker/scripts/build-frontend.sh`
- The Node image is pinned in `docker/compose/frontend/docker-compose.yml`.
