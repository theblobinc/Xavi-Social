# Xavi Social

ConcreteCMS package for the Xavi Social features. This repo contains the package only (not a full ConcreteCMS site).

- Public SPA entry: `https://yourdomain.tld/social`
- API base: `https://yourdomain.tld/social/api`
- API docs: see API.md in this folder.

## Frontend (Vite SPA)

The frontend lives in `frontend/`.

### Build (recommended: Dockerized toolchain)

- `bash docker/scripts/build-frontend.sh`

This runs the pinned Node/Vite image and writes the built assets to `dist/` at the package root.

### Build / dev (host Node)

If you prefer running Node locally:

- `cd frontend`
- `npm install`
- `npm run dev` (dev server)
- `npm run build` (outputs the production build)

## Workflow (per change)

1) Run an AI dump before hand-off: `./AI-DUMP.sh` (or `./ai-dump-light.sh`).
2) Build SPA assets when touching frontend: `./scripts/build-frontend.sh`.
3) Smoke test APIs (cookie or JWT): `./scripts/test-api.sh "$JWT" https://yourdomain.tld`.
4) MCP smoke (auto-mint JWT if secret present): `./scripts/test-mcp.sh https://yourdomain.tld`.
5) Update docs you touched (README, TODO, AI-INSTRUCTIONS, AI-Tests, API.md).
6) Commit and push with a concise summary + tests run.

## Dev datastore (Docker)

This repo includes a minimal local datastore stack (Postgres + Redis + MinIO) for development.

It also includes a Jetstream ingester that consumes the public Bluesky firehose and writes public posts into Postgres (`xavi_social_cached_posts`, `origin='jetstream'`) for the merged public feed.

### Start

1. Copy env file:
   - `cp docker/compose/datastore/.env.example docker/compose/datastore/.env`
2. Bring it up:
   - `bash docker/scripts/up.sh`

Jetstream ingester (public posts)

- `bash docker/scripts/up.sh` starts Jetstream by default.
- Set `XAVI_SOCIAL_ENABLE_JETSTREAM=0` to skip it.
- Manual start/stop/health:
   - `./scripts/jetstream-ingester.sh up`
   - `./scripts/jetstream-ingester.sh down`
   - `./scripts/jetstream-ingester.sh health`

### Status

- `bash docker/scripts/status.sh`

### Stop

- `bash docker/scripts/down.sh`

## More docs

- Docker notes: `docker/README.md`
- API reference: `API.md`
