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

function getAppBase() {
  const provided = typeof window.XAVI_APP_BASE === 'string' ? window.XAVI_APP_BASE : '';
  const normalized = normalizeBaseUrl(provided);
  return normalized || '/social';
}

function getApiBase() {
  const provided = typeof window.XAVI_API_BASE === 'string' ? window.XAVI_API_BASE : '';
  const normalized = normalizeBaseUrl(provided);
  return normalized || `${getAppBase()}/api`;
}

function appUrl(path) {
  const base = getAppBase();
  const suffix = String(path || '').replace(/^\/+/, '');
  return suffix ? `${base}/${suffix}` : base;
}

function apiUrl(path) {
  const base = getApiBase();
  const suffix = String(path || '').replace(/^\/+/, '');
  return suffix ? `${base}/${suffix}` : base;
}

function buildClientMetadata(origin) {
  return {
    client_id: `${origin}${appUrl('client_metadata')}`,
    client_name: 'Princegeorge Social',
    client_uri: `${origin}${appUrl('')}`,
    redirect_uris: [`${origin}${appUrl('callback')}`],
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
    feed: {
      loading: true,
      loadingMore: false,
      error: null,
      items: [],
      source: '',
      cachedCursor: '',
      hasMore: true,
    },
    thread: { loading: false, error: null, uri: null, post: null, replies: [] },
    profile: { loading: false, error: null, actor: null, profile: null, feed: [] },
    notifications: { loading: false, error: null, items: [] },
    posting: false,
    postError: null,
    connectError: null,
      accounts: {
        loading: false,
        error: null,
        items: [],
      },
      search: {
        loading: false,
        error: null,
        q: '',
        items: [],
      },
  };

  const atprotoSession = atproto?.session || null;
  const atprotoClientFactory = atproto?.getClient || null;

  let _handlersBound = false;
  let _routeAbortController = null;
  let _feedObserver = null;
  let _feedPollTimer = null;
  let _feedPollAbortController = null;
  let _loadMoreAbortController = null;

  function isAbortError(err) {
    return Boolean(err && (err.name === 'AbortError' || err.code === 20));
  }

  function bindDelegatedHandlers() {
    if (_handlersBound || !root) return;
    _handlersBound = true;

    root.addEventListener('submit', async (e) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;

      if (form.id === 'post-form') {
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
            await fetchJson(apiUrl('post'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text }),
            });
          }

          if (textarea) textarea.value = '';
          await loadFeed();
        } catch (err) {
          if (!isAbortError(err)) {
            state.postError = err?.message || String(err);
          }
        } finally {
          state.posting = false;
          paint();
        }
      }

      if (form.id === 'atproto-connect') {
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
          if (!isAbortError(err)) {
            state.connectError = err?.message || String(err);
            paint();
          }
        }
      }
    });

    root.addEventListener('click', async (e) => {
      const el = e.target instanceof Element ? e.target : null;
      if (!el) return;

      const btn = el.closest('button');
      if (!btn) return;

      if (btn.id === 'atproto-disconnect') {
        e.preventDefault();
        if (!atprotoSession) return;
        try {
          await atprotoSession.signOut();
        } catch {
          // ignore
        }
        window.location.assign(getAppBase());
        return;
      }

      const action = btn.getAttribute('data-action');
      if (!action) return;

      // Prevent default for all action buttons (some are placeholders).
      e.preventDefault();

      if (action === 'remove-account') {
        const id = btn.getAttribute('data-account-id');
        if (!id) return;
        await deleteLinkedAccount(id);
      }
    });
  }

    async function loadLinkedAccounts() {
      if (!loggedIn) return;

      state.accounts.loading = true;
      state.accounts.error = null;
      paint();

      try {
        const json = await fetchJson(apiUrl('accounts'));
        state.accounts.items = Array.isArray(json?.accounts) ? json.accounts : [];
        state.accounts.loading = false;
        state.accounts.error = null;
      } catch (err) {
        state.accounts.loading = false;
        state.accounts.error = err?.message || String(err);
        state.accounts.items = [];
      }

      paint();
    }

    async function deleteLinkedAccount(accountId) {
      if (!loggedIn) return;
      const id = Number(accountId) || 0;
      if (!id) return;

      try {
        await fetchJson(apiUrl('accounts/delete'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: id }),
        });
      } catch (err) {
        state.accounts.error = err?.message || String(err);
        paint();
        return;
      }

      await loadLinkedAccounts();
    }

    async function loadSearch(q, signal) {
      const query = (q || '').trim();
      state.search.q = query;
      state.search.loading = Boolean(query);
      state.search.error = null;
      state.search.items = [];
      paint();

      if (!query) {
        state.search.loading = false;
        paint();
        return;
      }

      try {
        const json = await fetchJson(`${apiUrl('search')}?q=${encodeURIComponent(query)}&limit=50`, { signal });
        state.search.items = Array.isArray(json?.items) ? json.items : [];
        state.search.loading = false;
        state.search.error = null;
      } catch (err) {
        if (isAbortError(err)) return;
        state.search.loading = false;
        state.search.error = err?.message || String(err);
        state.search.items = [];
      }

      paint();
    }

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

  function normalizeActor(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    // DID is always acceptable.
    if (/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(raw)) {
      return raw;
    }

    // Handle: keep this strict to avoid passing local usernames (e.g. "admin-...")
    // into XRPC calls. ATProto handles are DNS-like.
    if (/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(raw)) {
      return raw.toLowerCase();
    }

    return '';
  }

  function getDefaultActor() {
    const localHandle = localPdsAccount && localPdsAccount.handle ? String(localPdsAccount.handle) : '';
    const localDid = localPdsAccount && localPdsAccount.did ? String(localPdsAccount.did) : '';
    const did = atprotoSession?.did ? String(atprotoSession.did) : '';
    // Prefer DID (most reliable for XRPC) over local handle.
    return normalizeActor(did) || normalizeActor(localDid) || normalizeActor(localHandle) || '';
  }

  function parseRouteFromLocation() {
    const raw = (window.location.hash || '').replace(/^#/, '').trim();
    if (!raw) return { name: 'feed' };

    const [head, ...rest] = raw.split('/');
    const name = String(head || '').toLowerCase();
    if (name === 'feed') return { name: 'feed' };
    if (name === 'notifications') return { name: 'notifications' };
    if (name === 'profile') {
      const actor = normalizeActor(decodeRoutePart(rest.join('/'))) || getDefaultActor();
      return { name: 'profile', actor };
    }
    if (name === 'thread') {
      const uri = decodeRoutePart(rest.join('/'));
      return { name: 'thread', uri };
    }
    if (name === 'media') {
      return { name: 'media' };
    }
    if (name === 'search') {
      const query = decodeRoutePart(rest.join('/'));
      return { name: 'search', query };
    }
    return { name: 'feed' };
  }

  function setRoute(nextRoute, { replace = false } = {}) {
    const r = nextRoute && typeof nextRoute === 'object' ? nextRoute : { name: 'feed' };
    let hash = '#feed';
    if (r.name === 'notifications') hash = '#notifications';
    if (r.name === 'profile') {
      const actor = normalizeActor(r.actor) || getDefaultActor();
      hash = actor ? `#profile/${encodeRoutePart(actor)}` : '#profile';
    }
    if (r.name === 'thread') hash = `#thread/${encodeRoutePart(r.uri || '')}`;
    if (r.name === 'media') hash = '#media';
    if (r.name === 'search') {
      const q = String(r.query || '').trim();
      hash = q ? `#search/${encodeRoutePart(q)}` : '#search';
    }

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
          ${tab('media', 'Media', '#media')}
          ${tab('search', 'Search', '#search')}
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

    const feedHtml = items
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

    const moreLabel = state.feed.loadingMore
      ? 'Loading more…'
      : state.feed.hasMore
        ? ' '
        : 'No more posts.';
    return `${feedHtml}<div id="feed-sentinel" class="text-muted small" style="padding: 10px 0;">${escapeHtml(moreLabel)}</div>`;
  }

  function getScrollTop() {
    const se = document.scrollingElement;
    const top = se && typeof se.scrollTop === 'number' ? se.scrollTop : window.scrollY;
    return typeof top === 'number' ? top : 0;
  }

  function stopFeedPolling() {
    if (_feedPollTimer) {
      clearInterval(_feedPollTimer);
      _feedPollTimer = null;
    }
    if (_feedPollAbortController) {
      try {
        _feedPollAbortController.abort();
      } catch {
        // ignore
      }
      _feedPollAbortController = null;
    }
  }

  function startFeedPolling() {
    stopFeedPolling();
    _feedPollTimer = setInterval(async () => {
      if (!root) return;
      if (state.route?.name !== 'feed') return;
      if (state.feed.loading || state.feed.loadingMore) return;
      // Avoid jumpiness: only auto-refresh when the user is near the top.
      if (getScrollTop() > 80) return;

      if (_feedPollAbortController) {
        try {
          _feedPollAbortController.abort();
        } catch {
          // ignore
        }
      }
      _feedPollAbortController = new AbortController();
      const signal = _feedPollAbortController.signal;

      try {
        const limit = 30;
        const localResp = await fetchJson(`${apiUrl('feed')}?limit=${limit}`, { signal });
        const localItems = Array.isArray(localResp?.items) ? localResp.items : [];
        const newCursor = typeof localResp?.cachedCursor === 'string' ? localResp.cachedCursor : '';

        if (newCursor) {
          state.feed.cachedCursor = state.feed.cachedCursor || newCursor;
          state.feed.hasMore = true;
        }

        const existing = Array.isArray(state.feed.items) ? state.feed.items : [];
        const merged = mergeAndSortItems(existing, localItems);
        if (merged.length !== existing.length) {
          state.feed.items = merged;
          paint();
        }
      } catch (err) {
        if (isAbortError(err)) return;
      }
    }, 15000);
  }

  function mergeAndSortItems(existingItems, nextItems) {
    const seen = new Set();
    const merged = [...(Array.isArray(existingItems) ? existingItems : []), ...(Array.isArray(nextItems) ? nextItems : [])].filter((item) => {
      const key = item?.uri ? String(item.uri) : '';
      if (!key) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    merged.sort((a, b) => {
      const ta = Date.parse(a?.indexedAt || a?.createdAt || '') || 0;
      const tb = Date.parse(b?.indexedAt || b?.createdAt || '') || 0;
      if (tb !== ta) return tb - ta;
      const ua = a?.uri ? String(a.uri) : '';
      const ub = b?.uri ? String(b.uri) : '';
      return ub.localeCompare(ua);
    });

    return merged;
  }

  async function loadMoreCached() {
    if (state.route?.name !== 'feed') return;
    if (state.feed.loading || state.feed.loadingMore) return;
    if (!state.feed.hasMore) return;
    const cursor = (state.feed.cachedCursor || '').trim();
    if (!cursor) {
      state.feed.hasMore = false;
      paint();
      return;
    }

    if (_loadMoreAbortController) {
      try {
        _loadMoreAbortController.abort();
      } catch {
        // ignore
      }
    }
    _loadMoreAbortController = new AbortController();
    const signal = _loadMoreAbortController.signal;

    state.feed.loadingMore = true;
    paint();

    try {
      const limit = 30;
      const url = `${apiUrl('feed')}?limit=${limit}&cachedCursor=${encodeURIComponent(cursor)}`;
      const json = await fetchJson(url, { signal });
      const items = Array.isArray(json?.items) ? json.items : [];
      const nextCursor = typeof json?.cachedCursor === 'string' ? json.cachedCursor : '';

      const existing = Array.isArray(state.feed.items) ? state.feed.items : [];
      state.feed.items = mergeAndSortItems(existing, items);
      state.feed.cachedCursor = nextCursor;
      state.feed.hasMore = Boolean(nextCursor);
      state.feed.loadingMore = false;
      paint();
    } catch (err) {
      if (isAbortError(err)) return;
      state.feed.loadingMore = false;
      paint();
    }
  }

  function syncFeedObserver() {
    if (!root) return;

    if (state.route?.name !== 'feed') {
      if (_feedObserver) {
        try {
          _feedObserver.disconnect();
        } catch {
          // ignore
        }
        _feedObserver = null;
      }
      stopFeedPolling();
      return;
    }

    const sentinel = root.querySelector('#feed-sentinel');
    if (!sentinel) return;

    if (_feedObserver) {
      try {
        _feedObserver.disconnect();
      } catch {
        // ignore
      }
      _feedObserver = null;
    }

    _feedObserver = new IntersectionObserver(
      (entries) => {
        const hit = entries && entries.some((e) => e.isIntersecting);
        if (hit) {
          loadMoreCached();
        }
      },
      { root: null, rootMargin: '600px 0px 600px 0px', threshold: 0 }
    );
    _feedObserver.observe(sentinel);
    startFeedPolling();
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

  function hasMedia(item) {
    const embed = item?.embed || item?.media || null;
    if (!embed) return false;
    if (Array.isArray(embed?.images) && embed.images.length) return true;
    if (typeof embed === 'string' && embed) return true;
    if (typeof embed?.uri === 'string' && embed.uri) return true;
    return false;
  }

  function renderMediaBody() {
    if (state.feed.loading) {
      return `<div class="panel panel-default"><div class="panel-body text-muted">Loading…</div></div>`;
    }
    if (state.feed.error) {
      return `<div class="panel panel-default"><div class="panel-body">${escapeHtml(String(state.feed.error))}</div></div>`;
    }

    const items = Array.isArray(state.feed.items) ? state.feed.items : [];
    const mediaItems = items.filter((it) => hasMedia(it));
    if (mediaItems.length === 0) {
      return `<div class="panel panel-default"><div class="panel-body text-muted">No media found in the current timeline yet.</div></div>`;
    }

    // For now, show the posts that contain media (post-level thumbnails can be added later when embed shapes are stable).
    const prevItems = state.feed.items;
    state.feed.items = mediaItems;
    const html = renderFeedBody();
    state.feed.items = prevItems;
    return html;
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

    const localHtml =
      localHandle || localDid
        ? `<div class="text-muted small">Local PDS account: <strong>@${escapeHtml(localHandle || localDid)}</strong></div>`
        : `<div class="text-muted small">Local PDS account not provisioned.</div>`;

    const sessionHtml = atprotoSession
      ? `<div class="text-muted small">Connected DID: <span style="word-break: break-all;">${escapeHtml(atprotoSession.did)}</span></div>`
      : `<div class="text-muted small">No Bluesky/ATProto account connected.</div>`;

    const disconnectHtml = atprotoSession
      ? '<div style="margin-top: 8px;"><button type="button" id="atproto-disconnect" class="btn btn-link btn-sm" style="padding-left: 0;">Disconnect</button></div>'
      : '';

    const connectFormHtml = atprotoSession
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
            </form>
      `;

    const accounts = Array.isArray(state.accounts.items) ? state.accounts.items : [];
    const accountsBody = state.accounts.loading
      ? '<div class="text-muted small">Loading linked accounts…</div>'
      : state.accounts.error
        ? `<div class="text-muted small">Linked accounts error: ${escapeHtml(String(state.accounts.error))}</div>`
        : accounts.length
          ? `
              <ul class="list-unstyled" style="margin: 8px 0 0 0;">
                ${accounts
                  .map((acc) => {
                    const handle = (acc && acc.handle ? String(acc.handle) : '').trim();
                    const did = (acc && acc.did ? String(acc.did) : '').trim();
                    const issuer = (acc && acc.issuer ? String(acc.issuer) : '').trim();
                    const id = acc && acc.id != null ? Number(acc.id) : 0;
                    const label = handle ? `@${handle}` : did ? did : 'Account';
                    const meta = issuer ? 'linked' : 'local';
                    const removeBtn = issuer && id
                      ? ` <button type="button" class="btn btn-link btn-xs" data-action="remove-account" data-account-id="${escapeHtml(String(id))}" style="padding-left: 6px;">Remove</button>`
                      : '';
                    return `<li class="text-muted small" style="margin-top: 4px; word-break: break-all;"><strong>${escapeHtml(label)}</strong> <span>(${escapeHtml(meta)})</span>${removeBtn}</li>`;
                  })
                  .join('')}
              </ul>
            `
          : '<div class="text-muted small">No linked accounts yet.</div>';

    return (
      whoHtml +
      `
        <div class="panel panel-default">
          <div class="panel-heading"><strong>ATProto</strong></div>
          <div class="panel-body">
            ${localHtml}
            ${sessionHtml}
            ${disconnectHtml}
            ${connectFormHtml}
            ${connectErrorHtml}
              <div style="margin-top: 10px;">
                <div class="text-muted" style="font-size: 12px;"><strong>Linked accounts</strong></div>
                ${accountsBody}
              </div>
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
    } else if (route.name === 'media') {
      centerTitle = 'Media';
      centerBody = renderMediaBody();
    } else if (route.name === 'search') {
      centerTitle = 'Search';
      centerBody = renderSearchBody(route.query);
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

    queueMicrotask(() => {
      syncFeedObserver();
    });
  }

  async function loadTimeline(signal) {
    state.feed.loading = true;
    state.feed.error = null;
    state.feed.hasMore = true;
    state.feed.loadingMore = false;
    paint();

    try {
      const limit = 30;

      let localItems = [];
      let localSource = null;
      let remoteItems = [];

      const errors = [];

      // Always fetch the local timeline. For guests, the API returns the public cached/Jetstream feed.
      // For logged-in Concrete users, it can return their local PDS feed.
      try {
        const localResp = await fetchJson(`${apiUrl('feed')}?limit=${limit}`, { signal });
        localSource = localResp?.source || null;
        localItems = Array.isArray(localResp?.items) ? localResp.items : [];
        state.feed.cachedCursor = typeof localResp?.cachedCursor === 'string' ? localResp.cachedCursor : '';
        state.feed.hasMore = Boolean(state.feed.cachedCursor);
      } catch (err) {
        if (isAbortError(err)) return;
        errors.push(err?.message || String(err));
        localItems = [];
      }

      // If the browser has an OAuth session, use it for the authenticated timeline.
      if (atprotoSession) {
        try {
          const tokenSet = await atprotoSession.getTokenSet('auto');
          const base = normalizeBaseUrl(tokenSet?.aud);
          if (!base) throw new Error('ATProto session is missing audience/PDS URL.');

          const json = await atpFetchJson(`${base}/xrpc/app.bsky.feed.getTimeline?limit=${limit}`, { signal });
          const feed = Array.isArray(json?.feed) ? json.feed : [];

          remoteItems = feed
            .map((entry) => normalizeAtprotoPostFromTimeline(entry?.post))
            .filter((p) => p && typeof p === 'object' && p.uri);
        } catch (err) {
          if (isAbortError(err)) return;
          errors.push(err?.message || String(err));
          remoteItems = [];
        }
      }

      const merged = mergeAndSortItems(remoteItems, localItems);

      if (!merged.length) {
        throw new Error(errors[0] || 'No items returned.');
      }

      const sourceParts = [];
      if (remoteItems.length) sourceParts.push('atproto');
      if (localItems.length) sourceParts.push('local');
      state.feed.source = sourceParts.length ? sourceParts.join('+') : localSource || 'unknown';
      state.feed.items = merged;
      state.feed.loading = false;
      state.feed.error = null;
    } catch (err) {
      state.feed.loading = false;
      state.feed.error = err?.message || String(err);
    }

    paint();
  }

  // Back-compat helper (some handlers call loadFeed()).
  async function loadFeed(signal) {
    return await loadTimeline(signal);
  }

  async function loadThread(uri, signal) {
    state.thread.loading = true;
    state.thread.error = null;
    state.thread.uri = uri || null;
    state.thread.post = null;
    state.thread.replies = [];
    paint();

    try {
      if (!uri) throw new Error('Missing thread URI.');

      const url = `${apiUrl('thread')}?uri=${encodeURIComponent(uri)}`;
      const json = await fetchJson(url, { signal });
      state.thread.post = json?.post || null;
      state.thread.replies = json?.replies || [];
      state.thread.loading = false;
      state.thread.error = null;
    } catch (err) {
      if (isAbortError(err)) return;
      state.thread.loading = false;
      state.thread.error = err?.message || String(err);
    }

    paint();
  }

  async function loadProfile(actor, signal) {
    state.profile.loading = true;
    state.profile.error = null;
    state.profile.actor = normalizeActor(actor) || getDefaultActor();
    state.profile.profile = null;
    state.profile.feed = [];
    paint();

    try {
      const resolvedActor = normalizeActor(actor) || getDefaultActor();
      if (!resolvedActor) {
        throw new Error('No valid actor selected.');
      }

      const url = resolvedActor
        ? `${apiUrl('profile')}?actor=${encodeURIComponent(resolvedActor)}`
        : apiUrl('profile');
      const json = await fetchJson(url, { signal });
      state.profile.profile = json?.profile || null;
      state.profile.feed = json?.feed || [];

      state.profile.loading = false;
      state.profile.error = null;
    } catch (err) {
      if (isAbortError(err)) return;
      state.profile.loading = false;
      state.profile.error = err?.message || String(err);
    }

    paint();
  }

  async function loadNotifications(signal) {
    state.notifications.loading = true;
    state.notifications.error = null;
    paint();

    try {
      const json = await fetchJson(`${apiUrl('notifications')}?limit=30`, { signal });
      state.notifications.items = json?.items || [];
      state.notifications.loading = false;
      state.notifications.error = null;
    } catch (err) {
      if (isAbortError(err)) return;
      state.notifications.loading = false;
      state.notifications.error = err?.message || String(err);
    }

    paint();
  }

  let _routeLoadToken = 0;
  async function loadForCurrentRoute() {
    if (_routeAbortController) {
      try {
        _routeAbortController.abort();
      } catch {
        // ignore
      }
    }
    _routeAbortController = new AbortController();
    const signal = _routeAbortController.signal;

    const token = ++_routeLoadToken;
    const route = parseRouteFromLocation();
    if (token !== _routeLoadToken) return;

    if (route.name === 'thread') {
      await loadThread(route.uri, signal);
      return;
    }
    if (route.name === 'notifications') {
      await loadNotifications(signal);
      return;
    }
    if (route.name === 'profile') {
      await loadProfile(route.actor, signal);
      return;
    }

    if (route.name === 'media' || route.name === 'search') {
      if (route.name === 'search') {
        await loadSearch(route.query || '', signal);
        return;
      }

      await loadTimeline(signal);
      return;
    }

    await loadTimeline(signal);
  }

  function renderSearchBody(query) {
    const q = (query || '').trim();
    if (!q) {
      return '<div class="panel panel-default"><div class="panel-body text-muted">Type a search query in the overlay search box (or use #search/&lt;query&gt;).</div></div>';
    }

    if (state.search.loading) {
      return '<div class="panel panel-default"><div class="panel-body text-muted">Searching…</div></div>';
    }
    if (state.search.error) {
      return `<div class="panel panel-default"><div class="panel-body">Search error: ${escapeHtml(String(state.search.error))}</div></div>`;
    }

    const items = Array.isArray(state.search.items) ? state.search.items : [];
    if (!items.length) {
      return '<div class="panel panel-default"><div class="panel-body text-muted">No results.</div></div>';
    }

    const prevItems = state.feed.items;
    const prevLoading = state.feed.loading;
    const prevError = state.feed.error;

    state.feed.items = items;
    state.feed.loading = false;
    state.feed.error = null;

    const html = renderFeedBody();

    state.feed.items = prevItems;
    state.feed.loading = prevLoading;
    state.feed.error = prevError;

    return html;
  }

  paint();
  bindDelegatedHandlers();
  window.addEventListener('hashchange', () => {
    loadForCurrentRoute();
  });
  if (!window.location.hash) {
    setRoute({ name: 'feed' }, { replace: true });
  }
  loadForCurrentRoute();
  loadLinkedAccounts();
}

async function fetchConcreteSession() {
  const res = await fetch(apiUrl('session'), {
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

        const did = String(tokenSet?.sub || oauthSession.did || '').trim();
        const handle = String(localStorage.getItem(STORAGE_KEYS.lastHandle) || '').trim();
        const issuer = normalizeBaseUrl(tokenSet?.iss || oauthSession.issuer || resolver);
        const pdsUrl = normalizeBaseUrl(tokenSet?.aud);
        const scopes = String(tokenSet?.scope || '').trim();
        const refreshToken = String(tokenSet?.refresh_token || tokenSet?.refreshToken || '').trim();
        const accessToken = String(tokenSet?.access_token || tokenSet?.accessToken || '').trim();

        if (did) {
          const upsertBody = {
            did,
            handle,
            issuer,
            pdsUrl,
            appviewUrl: '',
            scopes,
            refreshToken,
            accessToken,
            accessTokenExpiresAt: expiresAtSeconds,
          };

          await fetch(apiUrl('accounts/upsert'), {
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
    window.history.replaceState({}, document.title, getAppBase());
    window.location.assign(getAppBase());
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
      const res = await fetch(apiUrl('me/ensure_account'), {
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
