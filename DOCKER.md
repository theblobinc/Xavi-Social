# Xavi Social — Docker services

This package ships Docker Compose stacks under `docker/compose/`.
They provide the backend services expected by the Social package (local datastore plumbing, Jetstream cache ingestion, and a local PDS for development/self-hosted identity).

## Quick status (example)

- PDS stack (when up): `xavi-social-pds` (containers: `xavi-social-pds-pds-1`, `xavi-social-pds-pds-postgres-1`).
- Jetstream ingester stack (when up): `xavi_social_jetstream` (container: `xavi-social-jetstream-ingester`).

## Network model

All stacks expect a shared Docker network named `xavi_social`:

- Your main ConcreteCMS site stack (nginx/php/etc) should be attached to `xavi_social`.
- These Compose stacks join `xavi_social` as an **external** network so services are reachable by DNS name from other containers.

If you ever need to create it manually:

- `docker network create xavi_social`

## Stacks

### 1) Datastore (Postgres + Redis + MinIO)

Location: `docker/compose/datastore/`

What it’s for:
- Postgres is used by the Jetstream ingester to upsert public posts into `xavi_social_cached_posts`.
- Redis/MinIO are available for future features (queues, blob caching, etc.).

How to configure:
- Copy `docker/compose/datastore/.env.example` → `docker/compose/datastore/.env`

How to run:
- Start: `bash docker/scripts/up.sh` (starts datastore + PDS + Jetstream by default; set `XAVI_SOCIAL_ENABLE_JETSTREAM=0` to skip)
- Stop: `bash docker/scripts/down.sh`
- Status: `bash docker/scripts/status.sh`

Internal addresses (from containers on `xavi_social`):
- Postgres: `postgres:5432`
- Redis: `redis:6379`
- MinIO (S3): `minio:9000`

Ports are *not* published to the host.

### 2) Local PDS (Bluesky Personal Data Server)

Location: `docker/compose/pds/`

What it’s for:
- Local ATProto/Bluesky development and testing.
- It is reachable from other containers over `xavi_social`.

Config:
- `docker/compose/pds/.env` (see `.env.example` for required secrets)

Internal address:
- `http://pds:3000/`

Notes on hostnames:
- `PDS_HOSTNAME` should generally be a dedicated hostname (for example `pds.yourdomain.tld`) if you plan to expose it publicly.
- If you keep it internal-only, it can remain unexposed; other containers can still reach `http://pds:3000`.

Exposing it (when needed):
- Recommended approach is to add an nginx reverse-proxy route in your main stack and serve it on a dedicated hostname.
- Alternative is to publish a host port in the compose file (not recommended for production).

### 3) Jetstream ingester (public firehose → Postgres cache)

Location: `docker/compose/jetstream/`

What it is:
- A small Node service in `jetstream/` that connects to a *public* Bluesky Jetstream websocket (defaults to `wss://jetstream2.us-west.bsky.network/subscribe`).
- It writes/upserts `app.bsky.feed.post` events into Postgres (`xavi_social_cached_posts`).

What it is NOT:
- This is **not** a self-hosted Jetstream relay/server.

Config inputs:
- `JETSTREAM_URL` (websocket URL)
- `WANTED_COLLECTIONS` (comma-separated)
- `WANTED_DIDS` (comma-separated; optional)
- Postgres password comes from `docker/compose/datastore/.env` (`PG_PASSWORD`).

How to run:
- Preferred: `./scripts/jetstream-ingester.sh up`
- Health check: `./scripts/jetstream-ingester.sh health` (expects `xavi-social-datastore` Postgres to be running)

Notes:
- `bash docker/scripts/up.sh` starts the ingester by default. Set `XAVI_SOCIAL_ENABLE_JETSTREAM=0` to skip it.

## Nginx wiring (hostnames)

If you expose these services publicly, it’s recommended to add dedicated vhosts in your main nginx stack:

- `pds.yourdomain.tld` → proxies to the PDS container (`http://pds:3000`).
- `jetstream-ingester.yourdomain.tld` → exposes only `/healthz` and `/metrics` from the ingester’s internal HTTP server.

Local verification depends on how your nginx is published. Example if nginx is bound to `127.0.0.1:6478`:
- `curl -H 'Host: pds.yourdomain.tld' http://127.0.0.1:6478/`
- `curl -H 'Host: jetstream-ingester.yourdomain.tld' http://127.0.0.1:6478/healthz`
- `curl -H 'Host: jetstream-ingester.yourdomain.tld' http://127.0.0.1:6478/metrics`

### 4) Frontend build helper

Location: `docker/compose/frontend/`

What it’s for:
- Builds the Vite SPA bundle using Docker so the host doesn’t need Node installed.

How to run:
- `bash scripts/build-frontend.sh`

## Upstream references

- Jetstream (server project): https://github.com/bluesky-social/jetstream
- ATProto repo: https://github.com/bluesky-social/atproto
- Docs (including PDS/AppView/BGS/PLC concepts): https://github.com/bluesky-social/bsky-docs/tree/main

If you want to add *more* local services (AppView, PLC, BGS, etc.), we should decide:
- internal-only vs public exposure
- where TLS + hostname routing lives (your main nginx stack)
- which components are strictly required for your intended Social UX
