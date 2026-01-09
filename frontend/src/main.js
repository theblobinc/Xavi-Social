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
    route: { name: 'feed' },
    feed: { loading: true, error: null, items: [] },
    thread: { loading: false, error: null, uri: null, post: null, replies: [] },
    profile: { loading: false, error: null, actor: null, profile: null, feed: [] },
    notifications: { loading: false, error: null, items: [] },
    posting: false,
    postError: null,
    connectError: null,
    accounts: { loading: false, error: null, items: [] },
  };

  const atprotoSession = atproto?.session || null;
  const atprotoClientFactory = atproto?.getClient || null;

  function encodeRoutePart(value) {
    return encodeURIComponent(String(value || ''));
  }

  function decodeRoutePart(value) {
    try {
      return decodeURIComponent(String(value || ''));
    } catch {
      return String(value || '');
    }
  }

  function getDefaultActor() {
    const localHandle = localPdsAccount && localPdsAccount.handle ? String(localPdsAccount.handle) : '';
    const localDid = localPdsAccount && localPdsAccount.did ? String(localPdsAccount.did) : '';
    const did = atprotoSession?.did ? String(atprotoSession.did) : '';
    return localHandle || did || localDid || '';
  }

  function parseRouteFromLocation() {
    const raw = (window.location.hash || '').replace(/^#/, '').trim();
    if (!raw) return { name: 'feed' };

    const [head, ...rest] = raw.split('/');
    const name = String(head || '').toLowerCase();
    if (name === 'feed') return { name: 'feed' };
    if (name === 'notifications') return { name: 'notifications' };
    if (name === 'profile') {
      const actor = decodeRoutePart(rest.join('/')) || getDefaultActor();
      return { name: 'profile', actor };
    }
    if (name === 'thread') {
      const uri = decodeRoutePart(rest.join('/'));
      return { name: 'thread', uri };
    }
    return { name: 'feed' };
  }

  function setRoute(nextRoute, { replace = false } = {}) {
    const r = nextRoute && typeof nextRoute === 'object' ? nextRoute : { name: 'feed' };
    let hash = '#feed';
    if (r.name === 'notifications') hash = '#notifications';
    if (r.name === 'profile') hash = `#profile/${encodeRoutePart(r.actor || getDefaultActor())}`;
    if (r.name === 'thread') hash = `#thread/${encodeRoutePart(r.uri || '')}`;

    if (replace) {
      window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}${hash}`);
    } else {
      window.location.hash = hash;
    }
  }

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

  async function atpFetchJson(url, options = {}) {
    if (!atprotoSession) {
      throw new Error('Not connected to ATProto.');
    }
    const res = await atprotoSession.fetchHandler(url, {
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
    } catch {
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

  function normalizeAtprotoPostFromTimeline(postView) {
    const post = postView && typeof postView === 'object' ? postView : null;
    const record = post && post.record && typeof post.record === 'object' ? post.record : null;
    const author = post && post.author && typeof post.author === 'object' ? post.author : null;
    const text = record && typeof record.text === 'string' ? record.text : String(record?.text || '');
    const createdAt = record && record.createdAt ? String(record.createdAt) : '';
    return {
      uri: post && post.uri ? String(post.uri) : '',
      cid: post && post.cid ? String(post.cid) : '',
      text,
      createdAt,
      indexedAt: createdAt,
      author: {
        did: author && author.did ? String(author.did) : '',
        handle: author && author.handle ? String(author.handle) : '',
        displayName: author && (author.displayName || author.handle) ? String(author.displayName || author.handle) : 'Account',
        avatar: author && author.avatar ? String(author.avatar) : '',
      },
      replyCount: typeof post?.replyCount === 'number' ? post.replyCount : null,
      repostCount: typeof post?.repostCount === 'number' ? post.repostCount : null,
      likeCount: typeof post?.likeCount === 'number' ? post.likeCount : null,
    };
  }

  function renderNav() {
    const active = state.route?.name || 'feed';
    const tab = (name, label, href) => {
      const isActive = active === name;
      return `<a class="btn btn-link btn-sm" style="padding-left: 0; ${isActive ? 'font-weight: 700;' : ''}" href="${href}">${escapeHtml(label)}</a>`;
    };
    return `
      <div class="xv-header" style="justify-content: space-between; align-items: center;">
        <div style="display:flex; gap: 12px; flex-wrap: wrap; align-items: baseline;">
          <h2 class="h3" style="margin-top: 0; margin-bottom: 0;">Social</h2>
          ${tab('feed', 'Timeline', '#feed')}
          ${tab('notifications', 'Notifications', '#notifications')}
          ${tab('profile', 'Profile', `#profile/${encodeRoutePart(getDefaultActor())}`)}
        </div>
        <div class="text-muted small" style="white-space: nowrap;">
          ${loggedIn ? 'Signed in' : 'Read-only'}
        </div>
      </div>
    `;
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
        const threadHref = item.uri ? `#thread/${encodeRoutePart(item.uri)}` : '';
        const profileHref = authorHandle ? `#profile/${encodeRoutePart(authorHandle)}` : (item.author?.did ? `#profile/${encodeRoutePart(item.author.did)}` : '');

        return `
          <article class="panel panel-default xv-post" data-id="${escapeHtml(postId)}">
            <div class="panel-body">
              <div class="media">
                <div class="media-left">
                  ${renderAvatarLabel(authorName)}
                </div>
                <div class="media-body">
                  <div class="xv-meta">
                    ${profileHref ? `<a href="${profileHref}"><strong>${escapeHtml(authorName)}</strong></a>` : `<strong>${escapeHtml(authorName)}</strong>`}
                    ${authorHandle ? `${profileHref ? `<a class="text-muted" href="${profileHref}">@${escapeHtml(authorHandle)}</a>` : `<span class="text-muted">@${escapeHtml(authorHandle)}</span>`}` : ''}
                    ${timeLabel ? `<span class="text-muted" aria-hidden="true">·</span><span class="text-muted">${escapeHtml(timeLabel)}</span>` : ''}
                  </div>

                  ${threadHref ? `<a href="${threadHref}" class="xv-content" style="display:block; text-decoration:none;">${escapeHtml(item.text || '')}</a>` : `<div class="xv-content">${escapeHtml(item.text || '')}</div>`}
                  ${renderActions(postId)}
                </div>
              </div>
            </div>
          </article>
        `;
      })
      .join('');
  }

  function renderThreadBody() {
    if (state.thread.loading) {
      return `<div class="panel panel-default"><div class="panel-body text-muted">Loading thread…</div></div>`;
    }
    if (state.thread.error) {
      return `<div class="panel panel-default"><div class="panel-body">${escapeHtml(String(state.thread.error))}</div></div>`;
    }
    if (!state.thread.post) {
      return `<div class="panel panel-default"><div class="panel-body text-muted">No thread loaded.</div></div>`;
    }

    const items = [state.thread.post, ...(Array.isArray(state.thread.replies) ? state.thread.replies : [])];
    return items
      .map((item, idx) => {
        const authorName = (item.author && (item.author.displayName || item.author.handle)) || 'Account';
        const authorHandle = (item.author && item.author.handle) || '';
        const timeLabel = relTime(item.createdAt || item.indexedAt);
        const postId = item.uri || item.cid || authorHandle + ':' + (item.createdAt || '');
        const profileHref = authorHandle ? `#profile/${encodeRoutePart(authorHandle)}` : (item.author?.did ? `#profile/${encodeRoutePart(item.author.did)}` : '');

        const indent = idx === 0 ? 0 : 14;
        return `
          <article class="panel panel-default xv-post" data-id="${escapeHtml(postId)}" style="margin-left: ${indent}px;">
            <div class="panel-body">
              <div class="media">
                <div class="media-left">${renderAvatarLabel(authorName)}</div>
                <div class="media-body">
                  <div class="xv-meta">
                    ${profileHref ? `<a href="${profileHref}"><strong>${escapeHtml(authorName)}</strong></a>` : `<strong>${escapeHtml(authorName)}</strong>`}
                    ${authorHandle ? `${profileHref ? `<a class="text-muted" href="${profileHref}">@${escapeHtml(authorHandle)}</a>` : `<span class="text-muted">@${escapeHtml(authorHandle)}</span>`}` : ''}
                    ${timeLabel ? `<span class="text-muted" aria-hidden="true">·</span><span class="text-muted">${escapeHtml(timeLabel)}</span>` : ''}
                  </div>
                  <div class="xv-content">${escapeHtml(item.text || '')}</div>
                </div>
              </div>
            </div>
          </article>
        `;
      })
      .join('');
  }

  function renderNotificationsBody() {
    if (!loggedIn) {
      return `<div class="panel panel-default"><div class="panel-body text-muted">Log in to view notifications.</div></div>`;
    }
    if (state.notifications.loading) {
      return `<div class="panel panel-default"><div class="panel-body text-muted">Loading notifications…</div></div>`;
    }
    if (state.notifications.error) {
      return `<div class="panel panel-default"><div class="panel-body">${escapeHtml(String(state.notifications.error))}</div></div>`;
    }
    const items = Array.isArray(state.notifications.items) ? state.notifications.items : [];
    if (items.length === 0) {
      return `<div class="panel panel-default"><div class="panel-body text-muted">No notifications.</div></div>`;
    }
    return items
      .map((n) => {
        const author = n.author && typeof n.author === 'object' ? n.author : null;
        const reason = n.reason ? String(n.reason) : 'activity';
        const timeLabel = relTime(n.indexedAt || n.createdAt);
        const name = (author && (author.displayName || author.handle)) || 'Account';
        const handle = author && author.handle ? String(author.handle) : '';
        const profileHref = handle ? `#profile/${encodeRoutePart(handle)}` : (author?.did ? `#profile/${encodeRoutePart(author.did)}` : '');

        return `
          <div class="panel panel-default">
            <div class="panel-body">
              <div class="xv-meta">
                ${profileHref ? `<a href="${profileHref}"><strong>${escapeHtml(name)}</strong></a>` : `<strong>${escapeHtml(name)}</strong>`}
                ${handle ? (profileHref ? `<a class="text-muted" href="${profileHref}">@${escapeHtml(handle)}</a>` : `<span class="text-muted">@${escapeHtml(handle)}</span>`) : ''}
                <span class="text-muted" aria-hidden="true">·</span>
                <span class="text-muted">${escapeHtml(reason)}</span>
                ${timeLabel ? `<span class="text-muted" aria-hidden="true">·</span><span class="text-muted">${escapeHtml(timeLabel)}</span>` : ''}
              </div>
              ${n.record && n.record.text ? `<div class="xv-content">${escapeHtml(String(n.record.text))}</div>` : ''}
            </div>
          </div>
        `;
      })
      .join('');
  }

  function renderProfileBody() {
    if (!loggedIn) {
      return `<div class="panel panel-default"><div class="panel-body text-muted">Log in to view profiles.</div></div>`;
    }
    if (state.profile.loading) {
      return `<div class="panel panel-default"><div class="panel-body text-muted">Loading profile…</div></div>`;
    }
    if (state.profile.error) {
      return `<div class="panel panel-default"><div class="panel-body">${escapeHtml(String(state.profile.error))}</div></div>`;
    }

    const p = state.profile.profile && typeof state.profile.profile === 'object' ? state.profile.profile : null;
    const displayName = p && (p.displayName || p.handle) ? String(p.displayName || p.handle) : (state.profile.actor || 'Profile');
    const handle = p && p.handle ? String(p.handle) : '';
    const did = p && p.did ? String(p.did) : '';
    const desc = p && p.description ? String(p.description) : '';

    const header = `
      <div class="panel panel-default">
        <div class="panel-heading"><strong>${escapeHtml(displayName)}</strong> ${handle ? `<span class="text-muted">@${escapeHtml(handle)}</span>` : ''}</div>
        <div class="panel-body">
          ${did ? `<div class="text-muted small" style="word-break: break-all;">${escapeHtml(did)}</div>` : ''}
          ${desc ? `<div class="xv-content" style="margin-top: 8px;">${escapeHtml(desc)}</div>` : ''}
        </div>
      </div>
    `;

    const items = Array.isArray(state.profile.feed) ? state.profile.feed : [];
    const feedHtml = items.length
      ? items
          .map((item) => {
            const timeLabel = relTime(item.createdAt || item.indexedAt);
            const threadHref = item.uri ? `#thread/${encodeRoutePart(item.uri)}` : '';
            return `
              <article class="panel panel-default xv-post">
                <div class="panel-body">
                  ${timeLabel ? `<div class="text-muted small">${escapeHtml(timeLabel)}</div>` : ''}
                  ${threadHref ? `<a href="${threadHref}" class="xv-content" style="display:block; text-decoration:none;">${escapeHtml(item.text || '')}</a>` : `<div class="xv-content">${escapeHtml(item.text || '')}</div>`}
                </div>
              </article>
            `;
          })
          .join('')
      : `<div class="panel panel-default"><div class="panel-body text-muted">No posts.</div></div>`;

    return header + feedHtml;
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
    const route = parseRouteFromLocation();
    state.route = route;

    let centerTitle = 'Timeline';
    let centerBody = renderFeedBody();
    if (route.name === 'thread') {
      centerTitle = 'Thread';
      centerBody = renderThreadBody();
    } else if (route.name === 'notifications') {
      centerTitle = 'Notifications';
      centerBody = renderNotificationsBody();
    } else if (route.name === 'profile') {
      centerTitle = 'Profile';
      centerBody = renderProfileBody();
    }

    root.innerHTML = `
      <div class="xv-shell">
        <div class="xv-layout">
          <aside class="xv-col xv-left" aria-label="Sidebar">
            ${renderLeftColumn()}
          </aside>

          <main class="xv-col xv-center" aria-label="Feed">
            ${renderNav()}
            <div class="xv-header" style="margin-top: 10px;">
              <h2 class="h3" style="margin-top: 0; margin-bottom: 0;">${escapeHtml(centerTitle)}</h2>
            </div>
            ${route.name === 'feed' ? renderComposer() : ''}
            <div id="feed" class="xv-feed">${centerBody}</div>
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

  async function loadTimeline() {
    state.feed.loading = true;
    state.feed.error = null;
    paint();

    try {
      const resp = await fetchJson('/xavi_social/api/feed?limit=30');
      state.feed.source = resp?.source;
      state.feed.items = resp?.items || [];
      state.feed.loading = false;
      state.feed.error = null;
    } catch (err) {
      state.feed.loading = false;
      state.feed.error = err?.message || String(err);
    }

    paint();
  }

  async function loadThread(uri) {
    state.thread.loading = true;
    state.thread.error = null;
    state.thread.uri = uri || null;
    state.thread.post = null;
    state.thread.replies = [];
    paint();

    try {
      if (!uri) throw new Error('Missing thread URI.');

      const url = `/xavi_social/api/thread?uri=${encodeURIComponent(uri)}`;
      const json = await fetchJson(url);
      state.thread.post = json?.post || null;
      state.thread.replies = json?.replies || [];
      state.thread.loading = false;
      state.thread.error = null;
    } catch (err) {
      state.thread.loading = false;
      state.thread.error = err?.message || String(err);
    }

    paint();
  }

  async function loadProfile(actor) {
    state.profile.loading = true;
    state.profile.error = null;
    state.profile.actor = actor || getDefaultActor();
    state.profile.profile = null;
    state.profile.feed = [];
    paint();

    try {
      const resolvedActor = actor || getDefaultActor();

      const url = resolvedActor
        ? `/xavi_social/api/profile?actor=${encodeURIComponent(resolvedActor)}`
        : '/xavi_social/api/profile';
      const json = await fetchJson(url);
      state.profile.profile = json?.profile || null;
      state.profile.feed = json?.feed || [];

      state.profile.loading = false;
      state.profile.error = null;
    } catch (err) {
      state.profile.loading = false;
      state.profile.error = err?.message || String(err);
    }

    paint();
  }

  async function loadNotifications() {
    state.notifications.loading = true;
    state.notifications.error = null;
    paint();

    try {
      const json = await fetchJson('/xavi_social/api/notifications?limit=30');
      state.notifications.items = json?.items || [];
      state.notifications.loading = false;
      state.notifications.error = null;
    } catch (err) {
      state.notifications.loading = false;
      state.notifications.error = err?.message || String(err);
    }

    paint();
  }

  let _routeLoadToken = 0;
  async function loadForCurrentRoute() {
    const token = ++_routeLoadToken;
    const route = parseRouteFromLocation();
    if (token !== _routeLoadToken) return;

    if (route.name === 'thread') {
      await loadThread(route.uri);
      return;
    }
    if (route.name === 'notifications') {
      await loadNotifications();
      return;
    }
    if (route.name === 'profile') {
      await loadProfile(route.actor);
      return;
    }

    await loadTimeline();
  }

  paint();
  window.addEventListener('hashchange', () => {
    paint();
    loadForCurrentRoute();
  });
  if (!window.location.hash) {
    setRoute({ name: 'feed' }, { replace: true });
  }
  loadForCurrentRoute();
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
