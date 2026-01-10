# Xavi Social

ConcreteCMS package for the Xavi Social features. This repo contains the package only (not a full ConcreteCMS site).

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

## Dev datastore (Docker)

This repo includes a minimal local datastore stack (Postgres + Redis + MinIO) for development.

It also includes an optional Jetstream ingester that consumes the public Bluesky firehose and writes public posts into Postgres (`xavi_social_cached_posts`, `origin='jetstream'`) for the merged public feed.

### Start

1. Copy env file:
   - `cp docker/compose/datastore/.env.example docker/compose/datastore/.env`
2. Bring it up:
   - `bash docker/scripts/up.sh`

Optional: Jetstream ingester (public posts)

- Start/stop/health:
   - `./scripts/jetstream-ingester.sh up`
   - `./scripts/jetstream-ingester.sh down`
   - `./scripts/jetstream-ingester.sh health`

### Status

- `bash docker/scripts/status.sh`

### Stop

- `bash docker/scripts/down.sh`

## More docs

- Docker notes: `docker/README.md`
