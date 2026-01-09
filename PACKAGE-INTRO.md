we want it to be a concretecms version 9 single page application.
tho later we may make mobile apps later.

Host-site/docker notes: see `HOST-SITE-NOTES.md`.

we also need to figure out that auth system and signups.

ideally we want all atproto users to be able to login.

Got it. ConcreteCMS v9 SPA is a totally workable “shell” for an ATProto client — you basically treat Concrete as the router + HTML container, and your JS bundle is the real app.

Recommended shape in ConcreteCMS v9

Do this as a package, not a theme hack, so you can ship it cleanly and update it.

Pages

 /xavi_social → SPA shell (single page): loads `packages/xavi_social/dist/app.js` and renders into `#xavi-social-root`.

 /xavi_social/callback → OAuth callback landing route (still part of SPA; there’s also a minimal PHP controller in place).

Assets

Build your frontend with whatever you like (Web Components / Lit / vanilla / React). Output into packages/YourPkg/dist/.

Register + require assets using Concrete’s asset system (AssetList) so cache-busting and loading are sane.

If you want a boilerplate starting point for a v9 package (single page, entities, etc.), this template is decent to crib structure from:

Auth: how ATProto login should work (for “all ATProto users”)

ATProto’s direction is OAuth, not app-password + createSession.
Key difference vs “Sign in with Google” style OAuth: ATProto requires discovery (find the user’s auth server) and often automated client registration, because the network has many independent PDS instances.

For a browser SPA, the easiest path is:

Use @atproto/oauth-client-browser (MIT) — it’s specifically for browser apps and uses WebCrypto + IndexedDB.

User flow (high level)

User enters their handle (e.g. name.bsky.social or name.custom-domain.com)

Your client does ATProto identity + server discovery to determine:

their DID/PDS

the authorization server

Start OAuth (public client + PKCE), redirect them to authorize

Callback returns to /at/callback, exchange code for tokens
Callback returns to /xavi_social/callback, exchange code for tokens

Store tokens (IndexedDB), then use them to call XRPC endpoints

This is exactly the “Browser Apps (single-page apps)” category described in the OAuth client guidance.

Signups: what you can (and can’t) promise
Bluesky signup specifically

Bluesky removed invite codes and opened public signup back on Feb 6, 2024.

ATProto-wide signup (any PDS)

Account creation happens on the user’s chosen PDS. There is an XRPC endpoint to create an account: com.atproto.server.createAccount.

But: different PDS instances can have different rules (invite codes, closed registration, etc.). There’s also a “describe server” endpoint that explicitly reports account creation requirements (including whether an invite code is needed).

Practical recommendation

Phase 1: Support “Login with ATProto” (OAuth) for existing accounts everywhere.

Phase 2 (optional): If you run your own PDS (or partner with one), add “Create account” against that PDS (call describeServer → show form → call createAccount).

That’s the only honest way to say “signup” while still supporting “all ATProto users.”

Public vs confidential client (what you should choose first)

For a ConcreteCMS SPA, you’ll almost certainly start as a public client (tokens live in the browser). The Bluesky team has been explicitly documenting the tradeoffs and improving OAuth UX over time.

If later you want higher security (or longer-lived sessions), you can move the sensitive bits to your PHP backend and behave more like a web service client — but don’t block on that for v1.

What I’d build first (minimum viable vertical slice)

Concrete single page /at loads SPA bundle

“Sign in” screen:

handle input

“Login” button → OAuth start

Callback handler at /at/callback

After login:

fetch and show profile + home feed

basic “post” composer (write record)

If you tell me your preferred frontend approach inside Concrete (pure Web Components vs React/Vue/etc.), I’ll map the exact folder layout + Concrete package wiring + the OAuth routes in a way that fits your current “/dist folder” habits.

Dev docker (reference)

There is a minimal backend datastore compose in `packages/xavi_social/docker/` (patterned after `xavi.app`), intended for local Postgres/Redis/MinIO only.