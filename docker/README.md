# Xavi Social (dev docker)

This folder is intentionally minimal. It’s meant to be a reference/starting point (patterned after the `xavi.app` docker scripts), not a full copy of that stack.

## Datastore stack

Provides Postgres + Redis + MinIO for local development.

- Postgres: `127.0.0.1:5432`
- Redis: `127.0.0.1:6379`
- MinIO S3: `127.0.0.1:9000`
- MinIO console: `127.0.0.1:9001`

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

- These services bind to localhost. If you already have Postgres/Redis running on the host, you’ll get port conflicts.
- This is backend plumbing only; ConcreteCMS itself is not containerized here because this repo only contains the package.

## Frontend build (Dockerized)

The Vite/Node toolchain is intended to run in Docker so the host doesn’t need Node installed.

- Build the SPA bundle:
   - `bash scripts/build-frontend.sh`
   - or: `bash docker/scripts/build-frontend.sh`
- The Node image is pinned in `docker/compose/frontend/docker-compose.yml`.
