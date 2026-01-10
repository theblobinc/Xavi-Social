# Xavi Social API

Base URL: https://www.princegeorge.app/social/api
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
  - `COOKIE_JAR=./cookies.txt ./scripts/get-jwt.sh https://www.princegeorge.app`

Environment/config hints
- HS256 secret: `xavi_social.jwt_secret` (Concrete config) or `XAVI_SOCIAL_JWT_SECRET`.
- ATProto/AppView optional vars: `XAVI_SOCIAL_ATPROTO_*` (host, identifier, password, mode, public DIDs).

Notes
- SPA is served at `/social` and calls the same `/social/api/...` routes.
- If posting/thread/profile fail with 404/502, the local PDS/AppView is likely not configured; feed may still return mock data.
