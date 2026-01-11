# Xavi Social API

Base URL: https://your-site.example/social/api
Local dev base: http://127.0.0.1:6478/social/api

Authentication
- Cookie (Concrete session) for browser usage.
- Bearer JWT (`Authorization: Bearer <token>`) for tooling/agents.
- JWT issuance: `/social/api/jwt` (requires Concrete session). Offline mint: `XAVI_SOCIAL_JWT_SECRET=... php scripts/mint-jwt.php --sub=1 --iss=http://127.0.0.1:6478`.

Core endpoints
- GET /social/api/session — Session status and popup-aware login/logout URLs.
- GET /social/api/jwt — Issue short-lived JWT for current Concrete user.
- GET /social/api/me — Authenticated identity (`authenticated`, `userId`, `userName`, `authMethod`).
- GET /social/api/debug — Echo headers/auth info for troubleshooting.
- GET /social/api/feed — Timeline (mock unless ATProto/AppView configured). Supports `limit`/`cursor`.
- POST /social/api/post — Create a post (JWT or cookie required). Requires local PDS/AppView config; returns 501/404 if upstream not available.
- GET /social/api/thread?uri=at://... — Fetch thread for a post (JWT required).
- GET /social/api/profile?actor=<did-or-handle> — Fetch profile (JWT required).
- GET /social/api/notifications?limit=10 — Notifications (JWT required; may return empty if upstream not configured).
- GET /social/api/search?q=<text> — Search cached posts (no auth if cache configured).

Testing shortcuts
- End-to-end smoke (auto-mints JWT if `XAVI_SOCIAL_JWT_SECRET` + `MINT_USER_ID` provided):
  - `XAVI_SOCIAL_JWT_SECRET=... MINT_USER_ID=1 ./scripts/test-api.sh http://127.0.0.1:6478`
- Cookie→JWT helper (requires Concrete session cookie):
  - `COOKIE_JAR=./cookies.txt ./scripts/get-jwt.sh https://yourdomain.tld`

Environment/config hints
- HS256 secret: `xavi_social.jwt_secret` (Concrete config) or `XAVI_SOCIAL_JWT_SECRET`.
- ATProto optional vars: `XAVI_SOCIAL_ATPROTO_*` (PDS host, identifier, password, mode, invite code).
- AppView for public lookups: `XAVI_SOCIAL_ATPROTO_APPVIEW_HOST` (optional; defaults to public fallback unless disabled).
- Public AppView fallback toggle: `XAVI_SOCIAL_ATPROTO_PUBLIC_APPVIEW_FALLBACK=0` to disable using `https://public.api.bsky.app`.

Notes
- SPA is served at `/social` and calls the same `/social/api/...` routes.
- If thread/profile return “Could not locate record”, set `XAVI_SOCIAL_ATPROTO_APPVIEW_HOST` (or allow the public fallback) so non-local posts can be resolved.

Docker-backed services
- This package includes Compose stacks under `docker/compose/` (see `DOCKER.md`).
- Local PDS (internal-only by default): reachable from other containers on `xavi_social` at `http://pds:3000/`.
- Jetstream ingester: connects to a public Bluesky Jetstream websocket and writes to Postgres (`xavi_social_cached_posts`) for the unauthenticated “public cache” path.
- Datastore: Postgres/Redis/MinIO plumbing used by the ingester and future features; ports are not published to the host.
