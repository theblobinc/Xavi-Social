# xavi_social — Execution-Ready TODO (ConcreteCMS v9 package + SPA + ATProto)

This TODO is designed to be *shippable*. It keeps the original scope, but turns it into an execution plan with:
- clear priorities (P0–P3)
- “done when” acceptance checks
- file/area pointers
- a repeatable build/test loop

---

## How to use this TODO

**Daily loop**
1. Pick 1–3 items from **P0 NOW** (finish them fully).
2. Build assets: `./scripts/build-frontend.sh`
3. Clear Concrete cache (or bump asset cache busting) and test the acceptance checklist.
4. Commit with one-liner + screenshots/log excerpt.

**Definition of Done (for any task)**
- ✅ Works in the SPA panel AND in any popup/new-window flows
- ✅ No console errors on happy-path
- ✅ Session state consistent after refresh
- ✅ No caching of auth/session endpoints (`Cache-Control: no-store`)
- ✅ Minimal regression check: load `/social`, post list renders, callback completes, logout works

---

## Project map (where things live)

**ConcreteCMS package root**
- `controller.php` — package registration/events/routes
- `controllers/single_page/social/*` — public `/social/*` pages (thin wrappers)
- `controllers/single_page/xavi_social/*` — core implementations (auth + API)
- `single_pages/social.php` — entry page shell
- `elements/social/*` — rendered fragments for Concrete
- `src/*` — backend helpers (LocalPdsProvisioner, TokenCipher, Postgres)

**Frontend SPA**
- `frontend/src/main.js`
- `frontend/src/app.css`
- `frontend/vite.config.js`
- Build output expected under package `dist/` (via `scripts/build-frontend.sh`)

**Multigrid UI / Taskbar**
- `multigrid/js/modules/taskbar/taskbar.js`
- `multigrid/js/modules/social/social-overlay.js`
- `multigrid/js/modules/*` (panel/overlay tooling)

**Docker helpers**
- `docker/*` (frontend, jetstream, pds)
- `scripts/up.sh`, `down.sh`, `status.sh`

---

## Priority legend

- **P0**: broken/annoying user-facing behavior; must fix before shipping
- **P1**: core UX, correctness, resilience
- **P2**: performance, cleanup, refactors that reduce future bugs
- **P3**: nice-to-have, future roadmap, migrations

---

# P0 NOW — ship blockers (do these first)

## P0-1: Fix “empty window” after login (Concrete login redirect in popup/new window) ✅

**Why:** Users end up with a useless leftover window/panel after completing login.

**Where**
- `controllers/single_page/xavi_social/auth/login.php` (sets post-login URL + redirects to `/login`)
- `controllers/single_page/social/auth/login.php` (wrapper)
- any opener logic in multigrid/taskbar that triggers auth flow

**Plan**
- [x] Add `?popup=1` support so auth can return to `/social?popup=1`
- [x] Update the **post-login URL** to include popup return when requested
- [x] Make the popup page close itself when `session.loggedIn === true`
- [x] Notify opener via `postMessage` and refresh parent

**Done when**
- Open login in a new window/panel → complete login → the login window closes itself and parent refreshes to logged-in state.

---

## P0-2: Fix OAuth callback “phantom window” (ATProto callback in popup/new window) ✅

**Why:** OAuth callback currently finishes and leaves a stray window/panel.

**Where**
- `frontend/src/main.js` callback branch (`page === 'callback'`)

**Plan**
- [x] After successful token save/upsert, if `window.opener` exists:
  - postMessage `{ type: 'xavi_social.oauth.complete' }`
  - `window.close()`
- [x] Parent window listens for that message and reloads session/UI

**Done when**
- OAuth connect launched in a new window/popup closes automatically and parent shows connected account without manual refresh.

---

## P0-3: Theme system (stop hardcoding black backgrounds) ✅

**Why:** Hardcoded `#000` and white text causes clashes when embedded and blocks future theming.

**Where**
- `frontend/src/app.css`

**Plan**
- [x] Convert hardcoded colors to CSS variables:
  - `--xv-bg`, `--xv-fg`, `--xv-muted`, `--xv-border`, `--xv-input-border`, …
- [x] Use `.xv-shell[data-theme="dark|light"]` to set defaults
- [x] Make “light mode” usable (not perfect, but readable)
- [x] Ensure `.panel`, inputs, buttons, muted text all inherit properly

**Done when**
- Switching `data-theme` changes the full app without unreadable text, and embedding inside other pages doesn’t force black behind everything.

---

## P0-4: Settings overlay actually controls theme ✅

**Why:** Settings UI exists, but it needs at least one real, high-value control.

**Where**
- `multigrid/js/modules/taskbar/taskbar.js` (Settings overlay IDs + persistence)
- the settings overlay UI implementation (where tabs are rendered)

**Plan**
- [x] Add “Theme: Dark/Light/System” selector
- [x] Store in `localStorage` key `xavi.theme`
- [x] Apply by setting `.xv-shell.dataset.theme`
- [x] If “System”, use `prefers-color-scheme` and listen for changes

**Done when**
- Toggle theme in Settings → refresh page → theme persists and applies.

---

## P0-5: Build pipeline sanity + cache busting

**Why:** You need reliable “edit → build → see changes” without stale assets.

**Where**
- `scripts/build-frontend.sh`
- whatever includes/loads the built JS/CSS into the page/overlay

**Plan**
- [ ] Ensure build outputs deterministic assets (or adds hash + correct references)
- [ ] Add “build stamp” file (e.g., `dist/build.json` with timestamp/git sha)
- [ ] If Concrete caches assets, ensure the include uses cache-busting query `?v=...`

**Done when**
- Changing `frontend/src/main.js` shows up after build + one reload (no mystery cache fights).

---

# P1 NEXT — core UX + correctness

## P1-1: Make session/auth URLs popup-aware

**Where**
- `controllers/single_page/xavi_social/api/session.php` (returns loginUrl/logoutUrl)

**Plan**
- [ ] If current page is in popup mode (query `popup=1`), return `loginUrl` that includes `?popup=1`
- [ ] Make sure logout returns to a sane place without leaving overlays in broken state

**Done when**
- Any login/logout link used from within popup/overlay routes returns cleanly.

---

## P1-2: Router reliability (route changes don’t leak timers/observers)

**Where**
- `frontend/src/main.js`

**Plan**
- [ ] Ensure route transitions abort outstanding fetches (AbortController)
- [ ] Ensure feed observers/timers are cleared on route change
- [ ] Add a `cleanupCurrentRoute()` that always runs before rendering a new route

**Done when**
- Navigating between views for 2+ minutes does not accumulate timers, duplicate fetches, or observers.

---

## P1-3: Social feed baseline UX (read-only still feels complete)

**Plan**
- [ ] When logged out, show a clear banner with “Log in to post / follow”
- [ ] Provide a visible “Connect ATProto account” call-to-action
- [ ] Ensure empty states are helpful (no blank screens)

**Done when**
- Logged-out users understand what they’re looking at and what actions are available.

---

## P1-4: Post composer correctness (client-side + server-side validation)

**Plan**
- [ ] Enforce max length + basic validation in UI
- [ ] Mirror validation on the API
- [ ] Normalize whitespace; prevent invisible “empty” posts
- [ ] Show API errors inline (not just console)

**Done when**
- Posting shows clear errors and never creates broken records.

---

## P1-5: Linked accounts management UX (connect/disconnect is safe)

**Where**
- API: `controllers/single_page/*/api/accounts/*`
- UI: `frontend/src/main.js` linked accounts view

**Plan**
- [ ] Confirm before disconnect
- [ ] Show last refresh/token expiry hints
- [ ] Handle “missing refresh token” gracefully

**Done when**
- Users can connect/disconnect without confusing states.

---

# P2 — performance + maintainability

## P2-1: Break up the monolithic SPA file into modules

**Where**
- `frontend/src/main.js`

**Plan**
- [ ] Split into:
  - `api/client.js` (fetch wrapper, JSON parsing, error normalization)
  - `ui/components/*` (render helpers)
  - `routes/*` (route handlers)
  - `state/store.js` (single source of truth)
- [ ] Add small unit tests for parsing/normalization (even if minimal)

**Done when**
- `main.js` becomes a thin bootstrap + router; features live in named modules.

---

## P2-2: Feed loading: pagination + “load more” without duplication

**Plan**
- [ ] Ensure stable cursor or createdAt/id ordering
- [ ] De-dup posts on client merge
- [ ] Add “load more” + skeleton loading
- [ ] Add “refresh” that doesn’t jump scroll

**Done when**
- Scrolling doesn’t repeat items; load-more never spams the server.

---

## P2-3: Caching strategy (fast repeat views; no stale auth)

**Plan**
- [ ] Cache *public* feed responses short-term (ETag / If-None-Match)
- [ ] Never cache session/auth/jwt endpoints
- [ ] Add server-side cache for computed feed results (keyed by filters)
- [ ] Add cache invalidation when posting

**Done when**
- Back/forward navigation is quick without security regressions.

---

## P2-4: Error reporting + observability

**Plan**
- [ ] Frontend: centralized logger (toggleable with `localStorage.xavi.debug=1`)
- [ ] Backend: structured logs (userId, endpoint, correlationId)
- [ ] Add a “Diagnostics” panel showing:
  - app version/build stamp
  - session state
  - connected account summary
  - last error

**Done when**
- When something breaks, you can diagnose in <5 minutes.

---

# P3 — feature roadmap / deeper refactors

## P3-1: Social features

- [ ] Follow/unfollow
- [ ] Likes/reposts
- [ ] Replies/threads rendering
- [ ] Notifications stream
- [ ] Profiles + bio edit
- [ ] Search improvements (people/posts)

**Done when**
- Each feature has an API contract + UI spec + test plan.

---

## P3-2: Privacy & compliance

- [ ] Block/mute
- [ ] Privacy settings (discoverability, replies)
- [ ] Data export (GDPR-ish)
- [ ] Account deletion workflow (soft delete, retention window)

---

## P3-3: Security hardening

- [ ] CSRF strategy for POST endpoints
- [ ] Content Security Policy (CSP) tuned for Vite-built assets
- [ ] Rate limiting (login, post, search)
- [ ] Sanitize user-generated content (server-side)
- [ ] Token storage review (encrypt refresh/access tokens at rest)

---

## P3-4: Optional frontend migration / modernization

- [ ] Consider moving UI to Web Components modules or a tiny framework
- [ ] Keep build pipeline simple (Vite)
- [ ] Avoid framework lock-in; prefer progressive enhancement

---

# Detailed task backlog (expanded from the original TODO)

Below is the “everything list”, rewritten so each item is actionable. If it’s not in P0/P1, it defaults to P2/P3.

---

## 1) UI/UX structure issues

- [ ] **Auth popup lifecycle**
  - Repro checklist: open login/connect from taskbar/start-menu, complete flow, confirm no empty window remains.
  - Implement: `popup=1` return mode, `postMessage`, and self-close logic.
  - Done when: both Concrete login and ATProto callback self-close when appropriate.

- [ ] **Theme + contrast**
  - Add CSS variables + `data-theme`.
  - Audit contrast: muted text, borders, input placeholders.
  - Done when: readable in dark and light without manual CSS overrides.

- [ ] **Layout responsiveness**
  - Ensure 3-column grid collapses cleanly on mobile widths.
  - Done when: no horizontal scroll; primary column is usable on 360px width.

---

## 2) Settings panel fixes

- [ ] **Persistence**
  - Tabs: ensure last active tab persists.
  - Overlay width/state: persist keys `xavi.settings.overlayWidth`, `xavi.settings.overlayState`.
  - Done when: reload preserves user settings.

- [ ] **Real settings**
  - Theme (P0), Feed algorithm (P1/P2), Notifications toggle (P3).
  - Done when: each setting has storage + UI + applied behavior.

---

## 3) Social feed improvements

- [ ] **Feed container structure**
  - Implement a stable list component (dedupe + keys).
  - Add “loading / empty / error” states.
  - Done when: feed never appears blank without an explanation.

- [ ] **Sorting / filtering**
  - Reverse-chronological baseline.
  - Optional: “Following”, “Local PDS”, “Global ATProto”.
  - Done when: filter changes reflect in URL + can be shared/bookmarked.

- [ ] **Timeline enhancements**
  - Infinite scroll with backpressure.
  - “New posts” indicator without scroll-jump.
  - Done when: long sessions don’t degrade performance.

---

## 4) ATProto integration fixes

- [ ] **Token lifecycle**
  - Store refresh/access tokens securely (server-side encryption).
  - Track expiry; refresh when needed.
  - Done when: connected accounts stay connected across days.

- [ ] **Handle resolver robustness**
  - Validate/normalize resolver URLs.
  - Provide default resolver and override UI.
  - Done when: bad resolver doesn’t brick the app (shows error + reset).

- [ ] **Multi-account support**
  - Choose active account; show which account is used for posting.
  - Done when: user can switch active DID safely.

---

## 5) Component architecture

- [ ] **Extract modules**
  - API client module
  - Route modules
  - UI render helpers
  - State store
  - Done when: new features don’t require editing 2000-line functions.

- [ ] **Error boundaries**
  - Global try/catch around route render
  - Inline error boxes near failing components
  - Done when: one broken endpoint doesn’t blank the whole UI.

---

## 6) Database & caching

- [ ] **Schema**
  - Ensure tables for: accounts, posts cache, user prefs, notifications.
  - Add indexes: did, createdAt, userId, handle.
  - Done when: queries stay fast under load.

- [ ] **Caching**
  - Cache computed feeds; invalidate on post.
  - Never cache auth/session/jwt.
  - Done when: repeat feed loads are faster without stale session issues.

---

## 7) Multi-window / multi-tab support

- [ ] **Cross-tab sync**
  - When login completes in one tab, other tabs refresh session state.
  - Use `BroadcastChannel` or `storage` events.
  - Done when: you don’t need to reload every tab manually.

- [ ] **Window naming + positioning**
  - Workspace windows opened by taskbar should have predictable names and restore placement.
  - Done when: “new workspace” doesn’t spawn duplicates accidentally.

---

## 8) Visual design updates

- [ ] **Iconography**
  - Ensure consistent icons for actions (post, reply, like, settings).
  - Done when: no mixed emoji/unstyled controls in primary flows.

- [ ] **Typography**
  - Use existing theme fonts; avoid custom font loads.
  - Done when: layout is consistent with the surrounding site.

---

## 9) Performance optimization

- [ ] **Avoid unnecessary rerenders**
  - Only update changed parts of DOM.
  - Done when: scrolling stays smooth on mid-range hardware.

- [ ] **Network**
  - Debounce search.
  - Backoff on polling.
  - Done when: idle page doesn’t constantly hammer endpoints.

---

## 10) Security

- [ ] **Input validation**
  - Server-side validation for all POST bodies.
  - Done when: malformed JSON can’t crash endpoints.

- [ ] **Rate limiting**
  - Protect search/post/login endpoints.
  - Done when: basic abuse doesn’t DOS you.

- [ ] **CSP + headers**
  - Add CSP suitable for Vite assets.
  - Add `X-Content-Type-Options`, `Referrer-Policy`, etc.
  - Done when: scan shows no obvious missing headers.

---

## 11) Testing & documentation

- [ ] **Tests**
  - Minimal unit tests (JS utility parsing)
  - API smoke tests (PHP)
  - E2E (Playwright) for login + callback + posting
  - Done when: CI can catch the most common breakages.

- [ ] **Docs**
  - “How to run locally”
  - “How auth works (popup mode)”
  - “How to add a new endpoint/route”
  - Done when: new dev can contribute in <1 day.

---

## 12) Specific file-by-file checklist (high leverage)

### `controllers/single_page/xavi_social/auth/login.php`
- [x] Add `popup` support for post-login URL
- [x] Ensure `Cache-Control: no-store` on redirect response
- [x] Done when: login works in normal + popup mode

### `controllers/single_page/xavi_social/api/session.php`
- [x] Optionally return popup-aware loginUrl
- [x] Done when: UI can safely use returned URLs in any context

### `frontend/src/main.js`
- [x] Add popup-close logic for callback and (if needed) popup=1 social page
- [x] Add cross-tab sync for auth completion
- [ ] Refactor toward modules (P2)
- [x] Done when: no stray windows; clear errors; stable routing

### `frontend/src/app.css`
- [x] CSS variables + theme selector support
- [x] Done when: no hardcoded backgrounds; readable light/dark

### `multigrid/js/modules/taskbar/taskbar.js`
- [ ] Ensure settings overlay state persistence is correct
- [ ] Ensure any “open social/login” actions pass popup=1 if they open a new window
- [x] Done when: taskbar-driven flows don’t spawn junk windows

---

# Configuration needed (fill these in)

Create a `config.md` (or keep notes here) with the live values you want:

- [ ] App base: `XAVI_APP_BASE` (default `/social`)
- [ ] API base: `XAVI_API_BASE` (default `${appBase}/api`)
- [ ] Default handle resolver (e.g., `https://bsky.social`)
- [ ] Local PDS provisioning:
  - enable/disable flag
  - invite handling
  - domain suffix policy
- [ ] Token encryption key / cipher config

---

# Database migrations (planned)

> Keep migrations small and incremental. Add indexes early.

- [ ] `xavi_social_accounts`
- [ ] `xavi_social_posts_cache`
- [ ] `xavi_social_user_prefs` (theme, feed algorithm, notifications)
- [ ] `xavi_social_notifications_cache`

Suggested prefs table:
```sql
CREATE TABLE xavi_social_user_prefs (
  user_id INT PRIMARY KEY,
  theme VARCHAR(20) DEFAULT 'dark',
  feed_algorithm VARCHAR(50) DEFAULT 'reverse-chronological',
  notifications_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

# Release checklist (every deploy)

- [ ] `./scripts/build-frontend.sh`
- [ ] Confirm `dist/` updated (timestamp/hash)
- [ ] Clear Concrete cache
- [ ] Smoke test:
  - `/social` loads
  - login works
  - callback works
  - posting works (if logged in)
  - logout works
- [ ] Tag release + short changelog entry

---

## Notes / guiding principles

- Keep ConcreteCMS integration patterns (single pages + controllers) stable.
- Prefer progressive enhancement and small modules.
- Treat auth/session endpoints as **no-store** always.
- Fix the “window lifecycle” first: it’s the #1 trust-breaker.

