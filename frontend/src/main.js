import { BrowserOAuthClient } from '@atproto/oauth-client-browser';

import './app.css';

const root = (() => {
  try {
    const provided = window.__xaviSocialMountRoot;
    if (provided && provided instanceof HTMLElement) {
      return provided;
    }
  } catch (e) {
    // ignore
  }
  return document.getElementById('xavi-social-root');
})();

if (!root) {
  console.error('[xavi_social] Missing mount root (#xavi-social-root).');
}

const STORAGE_KEYS = {
  handleResolver: 'xv_atproto_handleResolver',
  lastHandle: 'xv_atproto_lastHandle',
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getOrigin() {
  return window.location.origin;
}

function buildClientMetadata(origin) {
  return {
    client_id: `${origin}/xavi_social/client_metadata`,
    client_name: 'Princegeorge Social',
    client_uri: `${origin}/xavi_social`,
    redirect_uris: [`${origin}/xavi_social/callback`],
    scope: 'atproto',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
    dpop_bound_access_tokens: true,
  };
}

function normalizeBaseUrl(value) {
  const v = String(value || '').trim();
  return v ? v.replace(/\/+$/, '') : '';
}

function renderApp(session, atproto) {
  const loggedIn = Boolean(session?.loggedIn);
  const userName = session?.userName ? String(session.userName) : null;
  const userId = session?.userId != null ? String(session.userId) : null;
  const localPdsAccount = session?.localPdsAccount && typeof session.localPdsAccount === 'object' ? session.localPdsAccount : null;

  let state = {
    feed: { loading: true, error: null, items: [] },
    posting: false,
    postError: null,
    connectError: null,
    accounts: { loading: false, error: null, items: [] },
  };

  const atprotoSession = atproto?.session || null;
  const atprotoClientFactory = atproto?.getClient || null;

  function relTime(iso) {
    if (!iso) return '';
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const seconds = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (seconds < 60) return 'now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }

  async function fetchJson(url, options = {}) {
    const res = await fetch(url, {
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(options.headers || {}),
      },
      ...options,
    });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (e) {
      json = null;
    }
    if (!res.ok) {
      const message = (json && (json.message || json.error)) || `Request failed (${res.status})`;
      const err = new Error(message);
      err.status = res.status;
      err.payload = json;
      throw err;
    }
    return json;
  }

  function renderAvatarLabel(name) {
    const letter = (String(name).trim()[0] || '?').toUpperCase();
    return `<span class="xv-avatar" aria-hidden="true">${escapeHtml(letter)}</span>`;
  }

  function renderActions(itemId) {
    if (!loggedIn) return '';
    return `
      <div class="xv-actions" role="group" aria-label="Post actions">
        <button type="button" class="btn btn-link btn-xs" data-action="reply" data-id="${escapeHtml(itemId)}">Reply</button>
        <button type="button" class="btn btn-link btn-xs" data-action="repost" data-id="${escapeHtml(itemId)}">Repost</button>
        <button type="button" class="btn btn-link btn-xs" data-action="like" data-id="${escapeHtml(itemId)}">Like</button>
      </div>
    `;
  }


  function renderFeedBody() {
    if (state.feed.loading) {
      return `<div class="panel panel-default"><div class="panel-body text-muted">Loading…</div></div>`;
    }

    if (state.feed.error) {
      return `<div class="panel panel-default"><div class="panel-body">${escapeHtml(String(state.feed.error))}</div></div>`;
    }

    const items = Array.isArray(state.feed.items) ? state.feed.items : [];
    if (items.length === 0) {
      return `<div class="panel panel-default"><div class="panel-body text-muted">No posts yet.</div></div>`;
    }

    return items
      .map((item) => {
        const authorName = (item.author && (item.author.displayName || item.author.handle)) || 'Account';
        const authorHandle = (item.author && item.author.handle) || '';
        const timeLabel = relTime(item.createdAt || item.indexedAt);
        const postId = item.uri || item.cid || authorHandle + ':' + (item.createdAt || '');

        return `
          <article class="panel panel-default xv-post" data-id="${escapeHtml(postId)}">
            <div class="panel-body">
              <div class="media">
                <div class="media-left">
                  ${renderAvatarLabel(authorName)}
                </div>
                <div class="media-body">
                  <div class="xv-meta">
                    <strong>${escapeHtml(authorName)}</strong>
                    ${authorHandle ? `<span class="text-muted">@${escapeHtml(authorHandle)}</span>` : ''}
                    ${timeLabel ? `<span class="text-muted" aria-hidden="true">·</span><span class="text-muted">${escapeHtml(timeLabel)}</span>` : ''}
                  </div>

                  <div class="xv-content">${escapeHtml(item.text || '')}</div>
                  ${renderActions(postId)}
                </div>
              </div>
            </div>
          </article>
        `;
      })
      .join('');
  }

  function renderComposer() {
    if (!loggedIn) {
      return '';
    }

    const postErrorHtml = state.postError
      ? `<div class="alert alert-warning" style="margin-bottom: 10px;">${escapeHtml(String(state.postError))}</div>`
      : '';

    return `
      <div class="panel panel-default xv-composer">
        <div class="panel-body">
          ${postErrorHtml}
          <form id="post-form">
            <div class="form-group" style="margin-bottom: 10px;">
              <textarea id="post-text" class="form-control" rows="3" placeholder="Write a post…" ${state.posting ? 'disabled' : ''}></textarea>
            </div>
            <div class="xv-composer-row">
              <div class="text-muted small" aria-hidden="true">${escapeHtml(userName ?? '')}</div>
              <button type="submit" class="btn btn-primary btn-sm" ${state.posting ? 'disabled' : ''}>${state.posting ? 'Posting…' : 'Post'}</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  function renderLeftColumn() {
    const whoHtml = loggedIn
      ? `
        <div class="panel panel-default">
          <div class="panel-heading"><strong>You</strong></div>
          <div class="panel-body">
            <div class="xv-you">
              ${renderAvatarLabel(userName ?? 'You')}
              <div>
                <div><strong>${escapeHtml(userName ?? 'Account')}</strong></div>
                <div class="text-muted small">${userId ? `User #${escapeHtml(userId)}` : ''}</div>
              </div>
            </div>
          </div>
        </div>
      `
      : `
        <div class="panel panel-default">
          <div class="panel-heading"><strong>Read-only</strong></div>
          <div class="panel-body">
            <div class="text-muted small">Sign-in is handled by the main site. Posting unlocks when you’re logged in.</div>
          </div>
        </div>
      `;

    if (!loggedIn) {
      return whoHtml;
    }

    const resolverDefault =
      normalizeBaseUrl(localStorage.getItem(STORAGE_KEYS.handleResolver)) ||
      normalizeBaseUrl(root?.dataset?.handleResolver) ||
      '';
    const handleDefault = (localStorage.getItem(STORAGE_KEYS.lastHandle) || '').trim();

    const connectErrorHtml = state.connectError
      ? `<div class="alert alert-warning" style="margin-top: 10px; margin-bottom: 0;">${escapeHtml(String(state.connectError))}</div>`
      : '';

    const localHandle = localPdsAccount && localPdsAccount.handle ? String(localPdsAccount.handle) : '';
    const localDid = localPdsAccount && localPdsAccount.did ? String(localPdsAccount.did) : '';

    const sessionHtml = atprotoSession
      ? `<div class="text-muted small">Connected DID: <span style="word-break: break-all;">${escapeHtml(atprotoSession.did)}</span></div>`
      : localHandle || localDid
        ? `<div class="text-muted small">Local PDS account: <strong>@${escapeHtml(localHandle || localDid)}</strong></div>`
        : `<div class="text-muted small">No ATProto account connected.</div>`;

    const connectFormHtml = localHandle || localDid
      ? ''
      : `
            <form id="atproto-connect" style="margin-top: 10px;">
              <div class="form-group" style="margin-bottom: 10px;">
                <label class="control-label" for="atproto-resolver" style="font-size: 12px;">PDS / handle resolver URL</label>
                <input id="atproto-resolver" class="form-control input-sm" placeholder="https://your-pds.example" value="${escapeHtml(resolverDefault)}" />
              </div>

              <div class="form-group" style="margin-bottom: 10px;">
                <label class="control-label" for="atproto-handle" style="font-size: 12px;">Handle</label>
                <input id="atproto-handle" class="form-control input-sm" placeholder="you.example" value="${escapeHtml(handleDefault)}" />
              </div>

              <button type="submit" class="btn btn-default btn-sm">Connect</button>
              ${atprotoSession ? '<button type="button" id="atproto-disconnect" class="btn btn-link btn-sm">Disconnect</button>' : ''}
            </form>
      `;

    return (
      whoHtml +
      `
        <div class="panel panel-default">
          <div class="panel-heading"><strong>ATProto</strong></div>
          <div class="panel-body">
            ${sessionHtml}
            ${connectFormHtml}
            ${connectErrorHtml}
          </div>
        </div>
      `
    );
  }

  function renderRightColumn() {
    return `
      <div class="panel panel-default">
        <div class="panel-heading"><strong>Info</strong></div>
        <div class="panel-body">
          <div class="text-muted small">Timeline source: <strong>${escapeHtml(state.feed.source || '…')}</strong></div>
        </div>
      </div>
    `;
  }

  function paint() {
    root.innerHTML = `
      <div class="xv-shell">
        <div class="xv-layout">
          <aside class="xv-col xv-left" aria-label="Sidebar">
            ${renderLeftColumn()}
          </aside>

          <main class="xv-col xv-center" aria-label="Feed">
            <div class="xv-header">
              <h2 class="h3" style="margin-top: 0;">Feed</h2>
            </div>
            ${renderComposer()}
            <div id="feed" class="xv-feed">${renderFeedBody()}</div>
          </main>

          <aside class="xv-col xv-right" aria-label="Details">
            ${renderRightColumn()}
          </aside>
        </div>
      </div>
    `;

    const postForm = document.getElementById('post-form');
    postForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!loggedIn || state.posting) return;

      const textarea = document.getElementById('post-text');
      const text = textarea && textarea.value ? String(textarea.value).trim() : '';
      if (!text) return;

      state.posting = true;
      state.postError = null;
      paint();

      try {
        if (atprotoSession) {
          const tokenSet = await atprotoSession.getTokenSet('auto');
          const pdsUrl = normalizeBaseUrl(tokenSet?.aud);
          const did = tokenSet?.sub || atprotoSession.did;

          if (!pdsUrl || !did) {
            throw new Error('ATProto session is missing PDS/DID');
          }

          const resp = await atprotoSession.fetchHandler(`${pdsUrl}/xrpc/com.atproto.repo.createRecord`, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              repo: did,
              collection: 'app.bsky.feed.post',
              record: {
                $type: 'app.bsky.feed.post',
                text,
                createdAt: new Date().toISOString(),
              },
            }),
          });

          const postedText = await resp.text();
          const postedJson = postedText ? JSON.parse(postedText) : null;
          if (!resp.ok) {
            const message = (postedJson && (postedJson.message || postedJson.error)) || `ATProto post failed (${resp.status})`;
            throw new Error(message);
          }
        } else {
          await fetchJson('/xavi_social/api/post', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          });
        }

        if (textarea) textarea.value = '';
        await loadFeed();
      } catch (err) {
        state.postError = err?.message || String(err);
      } finally {
        state.posting = false;
        paint();
      }
    });

    root.querySelectorAll('button[data-action]')?.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
      });
    });

    const connectForm = document.getElementById('atproto-connect');
    connectForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!loggedIn) return;

      const resolverInput = document.getElementById('atproto-resolver');
      const handleInput = document.getElementById('atproto-handle');
      const resolver = normalizeBaseUrl(resolverInput?.value);
      const handle = String(handleInput?.value || '').trim();

      state.connectError = null;
      paint();

      if (!resolver) {
        state.connectError = 'Enter your PDS / handle resolver URL.';
        paint();
        return;
      }
      if (!handle) {
        state.connectError = 'Enter a handle.';
        paint();
        return;
      }

      try {
        localStorage.setItem(STORAGE_KEYS.handleResolver, resolver);
        localStorage.setItem(STORAGE_KEYS.lastHandle, handle);

        if (!atprotoClientFactory) {
          throw new Error('OAuth client unavailable.');
        }

        const client = atprotoClientFactory(resolver);
        await client.signIn(handle);
      } catch (err) {
        state.connectError = err?.message || String(err);
        paint();
      }
    });

    const disconnectBtn = document.getElementById('atproto-disconnect');
    disconnectBtn?.addEventListener('click', async (e) => {
      e.preventDefault();
      if (!atprotoSession) return;

      try {
        await atprotoSession.signOut();
      } catch {
        // ignore
      }
      window.location.assign('/xavi_social');
    });
  }

  async function loadFeed() {
    state.feed.loading = true;
    state.feed.error = null;
    paint();

    try {
      if (atprotoSession) {
        const tokenSet = await atprotoSession.getTokenSet('auto');
        const pdsUrl = normalizeBaseUrl(tokenSet?.aud);
        const did = tokenSet?.sub || atprotoSession.did;

        if (!pdsUrl || !did) {
          throw new Error('ATProto session is missing PDS/DID');
        }

        const url = new URL(`${pdsUrl}/xrpc/com.atproto.repo.listRecords`);
        url.searchParams.set('repo', did);
        url.searchParams.set('collection', 'app.bsky.feed.post');
        url.searchParams.set('limit', '30');

        const resp = await atprotoSession.fetchHandler(url.toString(), {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });

        const bodyText = await resp.text();
        const json = bodyText ? JSON.parse(bodyText) : null;
        if (!resp.ok || !json) {
          const message = (json && (json.message || json.error)) || `ATProto feed failed (${resp.status})`;
          throw new Error(message);
        }

        const handle = (localStorage.getItem(STORAGE_KEYS.lastHandle) || '').trim();
        const records = Array.isArray(json.records) ? json.records : [];
        const items = records
          .map((r) => {
            const value = r && typeof r === 'object' ? r.value : null;
            const text = value && typeof value === 'object' ? String(value.text || '') : '';
            const createdAt = value && typeof value === 'object' ? String(value.createdAt || '') : '';
            return {
              uri: String(r.uri || ''),
              cid: String(r.cid || ''),
              text,
              createdAt,
              indexedAt: createdAt,
              author: {
                did,
                handle,
                displayName: handle || did,
                avatar: '',
              },
            };
          })
          .filter((x) => x.text);

        state.feed.source = 'atproto(pds, browser)';
        state.feed.items = items;
      } else {
        const resp = await fetchJson('/xavi_social/api/feed');
        state.feed.source = resp?.source;
        state.feed.items = resp?.items || [];
      }
      state.feed.loading = false;
      state.feed.error = null;
    } catch (err) {
      state.feed.loading = false;
      state.feed.error = err?.message || String(err);
    }

    paint();
  }

  paint();
  loadFeed();
}

async function fetchConcreteSession() {
  const res = await fetch('/xavi_social/api/session', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Session endpoint returned ${res.status}`);
  }
  return await res.json();
}

async function main() {
  if (!root) return;

  const page = root.dataset.page;
  const origin = getOrigin();

  if (page === 'callback') {
    root.innerHTML = '<p>Completing…</p>';

    const resolver =
      normalizeBaseUrl(localStorage.getItem(STORAGE_KEYS.handleResolver)) ||
      normalizeBaseUrl(root?.dataset?.handleResolver) ||
      '';

    const client = new BrowserOAuthClient({
      handleResolver: resolver,
      clientMetadata: buildClientMetadata(origin),
    });

    try {
      const result = await client.init();
      const oauthSession = result?.session;
      if (oauthSession) {
        const tokenSet = await oauthSession.getTokenSet('auto');
        const expiresAtRaw = tokenSet?.expires_at;
        const expiresAtSeconds =
          typeof expiresAtRaw === 'number'
            ? Math.floor(expiresAtRaw > 1e12 ? expiresAtRaw / 1000 : expiresAtRaw)
            : 0;

        const upsertBody = {
          did: String(tokenSet?.sub || oauthSession.did || ''),
          handle: (localStorage.getItem(STORAGE_KEYS.lastHandle) || '').trim(),
          issuer: String(tokenSet?.iss || ''),
          pdsUrl: normalizeBaseUrl(tokenSet?.aud || ''),
          appviewUrl: '',
          scopes: String(tokenSet?.scope || ''),
          refreshToken: String(tokenSet?.refresh_token || ''),
          accessToken: String(tokenSet?.access_token || ''),
          accessTokenExpiresAt: expiresAtSeconds,
        };

        if (upsertBody.did) {
          await fetch('/xavi_social/api/accounts/upsert', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(upsertBody),
          }).catch(() => {});
        }
      }
    } catch (err) {
      root.innerHTML = `<p>Callback error: ${escapeHtml(String(err))}</p>`;
      return;
    }
    window.history.replaceState({}, document.title, '/xavi_social');
    window.location.assign('/xavi_social');
    return;
  }

  let session;
  try {
    session = await fetchConcreteSession();
  } catch (err) {
    // If session can't be determined, default to read-only feed.
    renderApp({ loggedIn: false }, null);
    return;
  }

  let localPdsAccount = null;
  if (session?.loggedIn) {
    try {
      const res = await fetch('/xavi_social/api/me/ensure_account', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const bodyText = await res.text();
      const json = bodyText ? JSON.parse(bodyText) : null;
      if (res.ok && json && typeof json === 'object' && json.ok && json.account && typeof json.account === 'object') {
        localPdsAccount = json.account;
      }
    } catch {
      // Best-effort; if provisioning fails, the UI can still work read-only.
    }
  }

  if (session && typeof session === 'object') {
    session = { ...session, localPdsAccount };
  }

  const getClient = (resolver) =>
    new BrowserOAuthClient({
      handleResolver: normalizeBaseUrl(resolver),
      clientMetadata: buildClientMetadata(origin),
    });

  let atprotoSession = null;
  try {
    const resolver =
      normalizeBaseUrl(localStorage.getItem(STORAGE_KEYS.handleResolver)) ||
      normalizeBaseUrl(root?.dataset?.handleResolver) ||
      '';
    if (resolver) {
      const client = getClient(resolver);
      const result = await client.init();
      atprotoSession = result?.session || null;
    }
  } catch {
    atprotoSession = null;
  }

  renderApp(session, {
    session: atprotoSession,
    getClient,
  });
}

main();
