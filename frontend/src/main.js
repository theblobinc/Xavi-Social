import { BrowserOAuthClient } from '@atproto/oauth-client-browser';

import './app.css';

const COLUMN_WIDTH = 350;

function getEmbedMode() {
  try {
    const provided = typeof window.XAVI_SOCIAL_EMBED_MODE === 'string' ? window.XAVI_SOCIAL_EMBED_MODE : '';
    const normalized = String(provided || '').trim().toLowerCase();
    if (normalized) return normalized;
  } catch (e) {
    // ignore
  }

  try {
    const params = new URLSearchParams(window.location.search || '');
    const fromQuery = String(params.get('embed') || '').trim().toLowerCase();
    return fromQuery;
  } catch (e) {
    return '';
  }
}

function isEmbedTimeline() {
  return getEmbedMode() === 'timeline';
}

function isEmbedPds() {
  return getEmbedMode() === 'pds';
}

function isEmbedJetstream() {
  return getEmbedMode() === 'jetstream';
}

function isEmbedFirehose() {
  return getEmbedMode() === 'firehose';
}

function isEmbedSingleStream() {
  const mode = getEmbedMode();
  return mode === 'pds' || mode === 'jetstream' || mode === 'firehose';
}

function isEmbedSettings() {
  return getEmbedMode() === 'settings';
}

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
  theme: 'xavi.theme',
  authPing: 'xavi.auth.ping',
  workspaceStreamMode: 'xavi.workspaceSettings.streamMode',
  workspaceJetstreamUrl: 'xavi.workspaceSettings.jetstreamUrl',
  workspaceFirehoseUrl: 'xavi.workspaceSettings.firehoseUrl',
  workspaceJetstreamWantedCollections: 'xavi.workspaceSettings.jetstreamWantedCollections',
  workspaceJetstreamWantedDids: 'xavi.workspaceSettings.jetstreamWantedDids',
};

function readWorkspaceStreamSettings() {
  const out = {
    streamMode: 'jetstream',
    jetstreamUrl: '',
    firehoseUrl: '',
  };

  try {
    const raw = String(localStorage.getItem(STORAGE_KEYS.workspaceStreamMode) || '').trim().toLowerCase();
    if (raw === 'jetstream' || raw === 'firehose') {
      out.streamMode = raw;
    }
  } catch (e) {
    // ignore
  }

  try {
    out.jetstreamUrl = String(localStorage.getItem(STORAGE_KEYS.workspaceJetstreamUrl) || '').trim();
  } catch (e) {
    // ignore
  }

  try {
    out.firehoseUrl = String(localStorage.getItem(STORAGE_KEYS.workspaceFirehoseUrl) || '').trim();
  } catch (e) {
    // ignore
  }

  return out;
}

function safeLsGet(key, fallback = '') {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : String(v);
  } catch (e) {
    return fallback;
  }
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitCsvOrNewlines(value) {
  return String(value || '')
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function uniq(arr) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(arr) ? arr : []) {
    const v = String(raw || '').trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function safeJsonArrayParse(raw, max) {
  try {
    const parsed = JSON.parse(String(raw || ''));
    if (!Array.isArray(parsed)) return [];
    return parsed.map((v) => String(v || '').trim()).filter(Boolean).slice(0, max);
  } catch {
    return [];
  }
}

function readWorkspaceJetstreamFilters() {
  const out = { wantedCollections: [], wantedDids: [] };
  out.wantedCollections = safeJsonArrayParse(safeLsGet(STORAGE_KEYS.workspaceJetstreamWantedCollections, ''), 20);
  out.wantedDids = safeJsonArrayParse(safeLsGet(STORAGE_KEYS.workspaceJetstreamWantedDids, ''), 200);
  return out;
}

function writeWorkspaceJetstreamFilters({ wantedCollections = [], wantedDids = [] } = {}) {
  try {
    localStorage.setItem(
      STORAGE_KEYS.workspaceJetstreamWantedCollections,
      JSON.stringify(uniq(wantedCollections).slice(0, 20))
    );
  } catch {
    // ignore
  }
  try {
    localStorage.setItem(STORAGE_KEYS.workspaceJetstreamWantedDids, JSON.stringify(uniq(wantedDids).slice(0, 200)));
  } catch {
    // ignore
  }
}

function readStreamOverridesFromQuery() {
  const out = {
    jetstreamUrl: '',
    wantedCollections: [],
    wantedDids: [],
    firehoseUrl: '',
  };
  try {
    const params = new URLSearchParams(window.location.search || '');
    out.jetstreamUrl = String(params.get('jetstreamUrl') || '').trim();
    out.firehoseUrl = String(params.get('firehoseUrl') || '').trim();
    out.wantedCollections = splitCsv(params.get('wantedCollections') || '').slice(0, 20);
    out.wantedDids = splitCsv(params.get('wantedDids') || '').slice(0, 200);
  } catch (e) {
    // ignore
  }
  return out;
}

function hexPrefix(buffer, bytes = 16) {
  try {
    const u8 = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(0);
    const n = Math.min(bytes, u8.length);
    let out = '';
    for (let i = 0; i < n; i++) {
      out += u8[i].toString(16).padStart(2, '0');
      if (i < n - 1) out += ' ';
    }
    return out;
  } catch (e) {
    return '';
  }
}

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

function isTruthyFlag(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function isPopupMode() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    return isTruthyFlag(params.get('popup'));
  } catch (e) {
    return false;
  }
}

const THEME_OPTIONS = ['dark', 'light', 'system'];

function readThemePreference() {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.theme);
    if (stored && THEME_OPTIONS.includes(stored)) {
      return stored;
    }
  } catch (e) {
    // ignore
  }
  return 'system';
}

function resolveTheme(preference) {
  const pref = THEME_OPTIONS.includes(preference) ? preference : 'system';
  if (pref === 'dark' || pref === 'light') {
    return pref;
  }
  const mql = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  return mql && typeof mql.matches === 'boolean' && mql.matches ? 'dark' : 'light';
}

let themePreference = readThemePreference();
let activeTheme = resolveTheme(themePreference);

function setThemePreference(nextPreference) {
  themePreference = THEME_OPTIONS.includes(nextPreference) ? nextPreference : 'system';
  try {
    localStorage.setItem(STORAGE_KEYS.theme, themePreference);
  } catch (e) {
    // ignore
  }
  applyThemeToShell();
}

function applyThemeToShell() {
  activeTheme = resolveTheme(themePreference);
  const shell = root?.querySelector('.xv-shell');
  if (shell) {
    shell.dataset.theme = activeTheme;
    shell.dataset.themePref = themePreference;
  }
}

const AUTH_MESSAGES = {
  loginComplete: 'xavi_social.login.complete',
  oauthComplete: 'xavi_social.oauth.complete',
};

function notifyAuthComplete(type, detail = {}) {
  const payload = { type, ...detail };
  const origin = window.location.origin;
  try {
    if (window.opener) {
      window.opener.postMessage(payload, origin);
    }
  } catch (e) {
    // ignore
  }

  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(payload, origin);
    }
  } catch (e) {
    // ignore
  }

  try {
    localStorage.setItem(STORAGE_KEYS.authPing, `${type}:${Date.now()}`);
  } catch (e) {
    // ignore
  }
}

function closePopupWindow(fallbackUrl) {
  try {
    window.close();
  } catch (e) {
    // ignore
  }

  if (window.closed) {
    return;
  }

  if (fallbackUrl) {
    setTimeout(() => {
      if (!window.closed) {
        window.location.replace(fallbackUrl);
      }
    }, 150);
  }
}

function setupCrossContextListeners() {
  window.addEventListener('message', (event) => {
    if (!event || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    const { type } = data;
    if (type === AUTH_MESSAGES.loginComplete || type === AUTH_MESSAGES.oauthComplete) {
      window.location.reload();
    }
  });

  window.addEventListener('storage', (event) => {
    if (!event) return;
    if (event.key === STORAGE_KEYS.authPing) {
      window.location.reload();
    }
    if (event.key === STORAGE_KEYS.theme) {
      themePreference = readThemePreference();
      applyThemeToShell();
    }

    // Workspace settings live in localStorage (set via Multi-Grid panel). When the
    // Timeline is embedded, it should refresh immediately as the stream mode changes.
    if (
      event.key === STORAGE_KEYS.workspaceStreamMode ||
      event.key === STORAGE_KEYS.workspaceJetstreamUrl ||
      event.key === STORAGE_KEYS.workspaceFirehoseUrl ||
      event.key === STORAGE_KEYS.workspaceJetstreamWantedCollections ||
      event.key === STORAGE_KEYS.workspaceJetstreamWantedDids
    ) {
      if (isEmbedTimeline() || isEmbedSingleStream()) {
        window.location.reload();
      }
    }
  });

  const mql = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  if (mql && typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', () => {
      if (themePreference === 'system') {
        applyThemeToShell();
      }
    });
  } else if (mql && typeof mql.addListener === 'function') {
    mql.addListener(() => {
      if (themePreference === 'system') {
        applyThemeToShell();
      }
    });
  }

  window.addEventListener('xavi:theme-change', (event) => {
    const next = event?.detail?.theme;
    if (next) {
      setThemePreference(next);
    }
  });
}

function renderApp(session, atproto) {
  const loggedIn = Boolean(session?.loggedIn);
  const userName = session?.userName ? String(session.userName) : null;
  const userId = session?.userId != null ? String(session.userId) : null;
  const localPdsAccount = session?.localPdsAccount && typeof session.localPdsAccount === 'object' ? session.localPdsAccount : null;

  const workspaceStream = readWorkspaceStreamSettings();

  let state = {
    route: { name: 'feed' },
    build: {
      loading: true,
      error: null,
      info: null,
    },
    feed: {
      loading: true,
      loadingMore: false,
      error: null,
      items: [],
      source: '',
      cachedCursor: '',
      hasMore: true,
    },
    jetstream: {
      loading: true,
      loadingMore: false,
      error: null,
      items: [],
      source: '',
      cachedCursor: '',
      hasMore: false,
    },
    firehose: {
      loading: true,
      loadingMore: false,
      error: null,
      items: [],
      source: '',
      cachedCursor: '',
      hasMore: false,
    },
    columnOrder: ['pds', 'jetstream'],
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

  // Embed modes:
  // - timeline: the default two-column UI
  // - pds/jetstream/firehose: single-column stream panels
  if (isEmbedPds()) {
    state.columnOrder = ['pds'];
  } else if (isEmbedJetstream()) {
    state.columnOrder = ['jetstream'];
  } else if (isEmbedFirehose()) {
    state.columnOrder = ['firehose'];
  } else {
    state.columnOrder = ['pds', 'jetstream'];
  }

  const atprotoSession = atproto?.session || null;
  const atprotoClientFactory = atproto?.getClient || null;

  let _handlersBound = false;
  let _routeAbortController = null;
  let _feedObserver = null;
  let _feedPollTimer = null;
  let _feedPollAbortController = null;
  let _loadMoreAbortController = null;
  let _columnDrag = null;

  let _jetstreamWs = null;
  let _firehoseWs = null;
  const _jetstreamDidToHandle = new Map();
  let _jetstreamPaintTick = 0;
  let _firehosePaintTick = 0;
  let _firehoseSeq = 0;

  function isAbortError(err) {
    return Boolean(err && (err.name === 'AbortError' || err.code === 20));
  }

  function bindDelegatedHandlers() {
    if (_handlersBound || !root) return;
    _handlersBound = true;

    root.addEventListener('submit', async (e) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;

      const formType = form.getAttribute('data-form') || '';

      if (formType === 'jetstream-embed-settings') {
        e.preventDefault();
        const url = String(form.querySelector('[name="jetstreamUrl"]')?.value || '').trim();
        const collectionsRaw = String(form.querySelector('[name="wantedCollections"]')?.value || '');
        const didsRaw = String(form.querySelector('[name="wantedDids"]')?.value || '');

        const wantedCollections = uniq(splitCsvOrNewlines(collectionsRaw)).slice(0, 20);
        const wantedDids = uniq(splitCsvOrNewlines(didsRaw)).slice(0, 200);

        try {
          localStorage.setItem(STORAGE_KEYS.workspaceJetstreamUrl, url);
        } catch {
          // ignore
        }
        writeWorkspaceJetstreamFilters({ wantedCollections, wantedDids });

        // Prefer localStorage after an explicit save from inside the embed UI.
        try {
          const next = new URL(window.location.href);
          next.searchParams.delete('jetstreamUrl');
          next.searchParams.delete('wantedCollections');
          next.searchParams.delete('wantedDids');
          window.history.replaceState({}, '', next.toString());
        } catch {
          // ignore
        }

        await loadForCurrentRoute();
        return;
      }

      if (formType === 'firehose-embed-settings') {
        e.preventDefault();
        const url = String(form.querySelector('[name="firehoseUrl"]')?.value || '').trim();
        try {
          localStorage.setItem(STORAGE_KEYS.workspaceFirehoseUrl, url);
        } catch {
          // ignore
        }

        // Prefer localStorage after an explicit save from inside the embed UI.
        try {
          const next = new URL(window.location.href);
          next.searchParams.delete('firehoseUrl');
          window.history.replaceState({}, '', next.toString());
        } catch {
          // ignore
        }
        await loadForCurrentRoute();
        return;
      }

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

      if (action === 'reset-jetstream-embed-settings') {
        try {
          localStorage.removeItem(STORAGE_KEYS.workspaceJetstreamUrl);
        } catch {
          // ignore
        }
        try {
          localStorage.removeItem(STORAGE_KEYS.workspaceJetstreamWantedCollections);
        } catch {
          // ignore
        }
        try {
          localStorage.removeItem(STORAGE_KEYS.workspaceJetstreamWantedDids);
        } catch {
          // ignore
        }
        await loadForCurrentRoute();
        return;
      }

      if (action === 'reset-firehose-embed-settings') {
        try {
          localStorage.removeItem(STORAGE_KEYS.workspaceFirehoseUrl);
        } catch {
          // ignore
        }
        await loadForCurrentRoute();
        return;
      }

      if (action === 'remove-account') {
        const id = btn.getAttribute('data-account-id');
        if (!id) return;
        await deleteLinkedAccount(id);
      }
    });

    root.addEventListener('pointerdown', (e) => {
      const handle = e.target instanceof Element ? e.target.closest('[data-action="drag-column"]') : null;
      if (!handle) return;
      const colId = handle.getAttribute('data-col-id') || '';
      if (!colId) return;
      _columnDrag = { colId };
    });

    root.addEventListener('pointerup', (e) => {
      if (!_columnDrag) return;
      finishColumnDrag(e.clientX);
    });

    root.addEventListener('pointercancel', () => {
      _columnDrag = null;
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
    // Embed modes clamp routing to a single view.
    if (isEmbedTimeline() || isEmbedSettings() || isEmbedSingleStream()) return { name: 'feed' };

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
    if (isEmbedTimeline() || isEmbedSettings() || isEmbedSingleStream()) {
      return '';
    }
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



  function getPrimaryFeedEl() {
    if (!root) return null;
    return root.querySelector('.xv-feed[data-col-body="pds"]') || root.querySelector('.xv-feed');
  }

  function captureFeedAnchor() {
    if (!root || state.route?.name !== 'feed') return null;
    const feedEl = getPrimaryFeedEl();
    if (!feedEl) return null;
    const first = feedEl.querySelector('.xv-post');
    if (!first) return null;
    const rect = first.getBoundingClientRect();
    return {
      id: first.getAttribute('data-id') || '',
      top: rect.top,
    };
  }

  function restoreFeedAnchor(anchor) {
    if (!anchor || !root || state.route?.name !== 'feed') return;
    const feedEl = getPrimaryFeedEl();
    if (!feedEl) return;
    const posts = Array.from(feedEl.querySelectorAll('.xv-post'));
    const match = posts.find((p) => (p.getAttribute('data-id') || '') === anchor.id) || posts[0];
    if (!match) return;
    const rect = match.getBoundingClientRect();
    const delta = rect.top - anchor.top;
    if (Math.abs(delta) > 1) {
      window.scrollBy(0, delta);
    }
  }

  function setFeedItems(nextItems, { preserveScroll = false } = {}) {
    const anchor = preserveScroll ? captureFeedAnchor() : null;
    state.feed.items = nextItems;
    paint();
    if (anchor && preserveScroll) {
      queueMicrotask(() => restoreFeedAnchor(anchor));
    }
  }

  function renderFeedSkeleton(count = 3) {
    const cards = Array.from({ length: count }).map(() => {
      return `
        <article class="panel panel-default xv-post xv-skeleton-card">
          <div class="panel-body">
            <div class="media">
              <div class="media-left">
                <span class="xv-avatar xv-skeleton-block"></span>
              </div>
              <div class="media-body">
                <div class="xv-skeleton-line" style="width: 40%;"></div>
                <div class="xv-skeleton-line" style="width: 95%;"></div>
                <div class="xv-skeleton-line" style="width: 88%;"></div>
              </div>
            </div>
          </div>
        </article>
      `;
    });
    return cards.join('');
  }

  function renderFeedState(title, body) {
    return `
      <div class="panel panel-default xv-feed-state">
        <div class="panel-body">
          <div class="xv-feed-state__title">${escapeHtml(title)}</div>
          <div class="text-muted">${escapeHtml(body)}</div>
        </div>
      </div>
    `;
  }

  function renderFeedBody(feedState = state.feed, options = {}) {
    const sentinelId = options.sentinelId || 'feed-sentinel';
    const showSentinel = options.showSentinel !== false;

    if (feedState.loading) {
      return renderFeedSkeleton(4);
    }

    if (feedState.error) {
      return renderFeedState('Feed failed to load', feedState.error || 'Please retry.');
    }

    const items = Array.isArray(feedState.items) ? feedState.items : [];
    if (items.length === 0) {
      return renderFeedState('No posts yet', 'Try refreshing or connecting an account.');
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

    const moreLabel = feedState.loadingMore
      ? 'Loading more…'
      : feedState.hasMore
        ? ' '
        : 'No more posts.';

    const sentinelHtml = showSentinel
      ? `<div id="${escapeHtml(sentinelId)}" class="text-muted small" style="padding: 10px 0;">${escapeHtml(moreLabel)}</div>`
      : '';

    return `${feedHtml}${sentinelHtml}`;
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
          setFeedItems(merged, { preserveScroll: true });
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
      const merged = mergeAndSortItems(existing, items);
      state.feed.cachedCursor = nextCursor;
      state.feed.hasMore = Boolean(nextCursor);
      state.feed.loadingMore = false;
      setFeedItems(merged, { preserveScroll: true });
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
    const jetstreamStatus = state.jetstream?.error ? 'unavailable' : state.jetstream?.source || 'unknown';
    const orderList = Array.isArray(state.columnOrder) ? state.columnOrder : [];
    const orderLabel = orderList.length ? orderList.join(' | ') : 'pds | jetstream';

    const buildInfo = state.build?.info && typeof state.build.info === 'object' ? state.build.info : null;
    const buildLine = state.build?.loading
      ? '<div class="text-muted small">Build: <strong>loading…</strong></div>'
      : state.build?.error
        ? `<div class="text-muted small">Build: <strong>${escapeHtml(String(state.build.error))}</strong></div>`
        : buildInfo
          ? `<div class="text-muted small">Build: <strong>${escapeHtml(buildInfo.pkgVersion || '')}${buildInfo.gitSha ? ' ' + escapeHtml(buildInfo.gitSha) : ''}</strong> <span style="opacity:0.8;">${escapeHtml(buildInfo.builtAt || '')}</span></div>`
          : '<div class="text-muted small">Build: <strong>unknown</strong></div>';

    return `
      <div class="panel panel-default">
        <div class="panel-heading"><strong>Info</strong></div>
        <div class="panel-body">
          <div class="text-muted small">PDS: <strong>${escapeHtml(state.feed.source || 'unknown')}</strong></div>
          <div class="text-muted small">Jetstream: <strong>${escapeHtml(jetstreamStatus)}</strong></div>
          <div class="text-muted small">Columns: <strong>${escapeHtml(orderLabel)}</strong></div>
          ${buildLine}
        </div>
      </div>
    `;
  }

  function getPackageBaseUrl() {
    const base = typeof window.XAVI_MULTIGRID_BASE === 'string' ? String(window.XAVI_MULTIGRID_BASE) : '';
    if (base.includes('/packages/xavi_social/')) {
      return base.replace(/\/multigrid\/?$/, '');
    }
    return '/packages/xavi_social';
  }

  async function loadBuildStamp() {
    state.build.loading = true;
    state.build.error = null;
    paint();

    try {
      const v = typeof window.XAVI_ASSET_VERSION !== 'undefined' ? String(window.XAVI_ASSET_VERSION) : String(Date.now());
      const url = `${getPackageBaseUrl()}/dist/build.json?v=${encodeURIComponent(v)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      state.build.loading = false;
      state.build.error = null;
      state.build.info = json && typeof json === 'object' ? json : null;
      paint();
    } catch (err) {
      state.build.loading = false;
      state.build.error = err?.message || String(err);
      state.build.info = null;
      paint();
    }
  }

  function getColumnMeta(colId) {
    const id = colId || 'column';
    if (id === 'pds') {
      return {
        id,
        title: 'PDS Feed',
        subtitle: state.feed.source ? `Source: ${state.feed.source}` : 'Local timeline',
        feedState: state.feed,
        composer: true,
        sentinelId: 'feed-sentinel',
        showSentinel: true,
      };
    }
    if (id === 'jetstream') {
      const subtitle = state.jetstream.error
        ? state.jetstream.error
        : state.jetstream.source
          ? `Source: ${state.jetstream.source}`
          : 'Bluesky Jetstream';
      return {
        id,
        title: 'Jetstream',
        subtitle,
        feedState: state.jetstream,
        composer: false,
        sentinelId: 'jetstream-sentinel',
        showSentinel: false,
      };
    }
    if (id === 'firehose') {
      const subtitle = state.firehose.error
        ? state.firehose.error
        : state.firehose.source
          ? `Source: ${state.firehose.source}`
          : 'ATProto Firehose';
      return {
        id,
        title: 'Firehose',
        subtitle,
        feedState: state.firehose,
        composer: false,
        sentinelId: 'firehose-sentinel',
        showSentinel: false,
      };
    }
    return {
      id,
      title: 'Reserved',
      subtitle: 'Unused column',
      feedState: { loading: false, loadingMore: false, error: 'This column is empty.', items: [], hasMore: false },
      composer: false,
      sentinelId: `${id}-sentinel`,
      showSentinel: false,
    };
  }

  function renderTimelineColumn(colId, index) {
    const meta = getColumnMeta(colId);
    const feedContent =
      meta.id === 'firehose'
        ? renderFirehoseBody(meta.feedState)
        : renderFeedBody(meta.feedState, { sentinelId: meta.sentinelId, showSentinel: meta.showSentinel });

    const embedControls = (() => {
      if (!isEmbedSingleStream()) return '';

      const overrides = readStreamOverridesFromQuery();
      const liveWorkspaceStream = readWorkspaceStreamSettings();

      if (meta.id === 'jetstream' && isEmbedJetstream()) {
        const storedFilters = readWorkspaceJetstreamFilters();
        const jetstreamUrl = (overrides.jetstreamUrl || liveWorkspaceStream.jetstreamUrl || '').trim();
        const wantedCollections =
          Array.isArray(overrides.wantedCollections) && overrides.wantedCollections.length
            ? overrides.wantedCollections
            : storedFilters.wantedCollections;
        const wantedDids =
          Array.isArray(overrides.wantedDids) && overrides.wantedDids.length ? overrides.wantedDids : storedFilters.wantedDids;

        const collectionsText = (wantedCollections || []).join('\n');
        const didsText = (wantedDids || []).join('\n');

        return `
          <form data-form="jetstream-embed-settings" class="panel panel-default" style="margin: 0 0 10px 0;">
            <div class="panel-heading" style="display:flex; justify-content: space-between; align-items: center; gap: 8px;">
              <strong>Connection</strong>
              <button type="button" class="btn btn-default btn-xs" data-action="reset-jetstream-embed-settings">Reset</button>
            </div>
            <div class="panel-body" style="padding: 10px;">
              <div class="form-group" style="margin-bottom: 8px;">
                <label class="text-muted small" style="margin-bottom: 4px;">Jetstream WS URL</label>
                <input class="form-control input-sm" name="jetstreamUrl" placeholder="wss://…" value="${escapeHtml(jetstreamUrl)}" />
              </div>
              <div class="form-group" style="margin-bottom: 8px;">
                <label class="text-muted small" style="margin-bottom: 4px;">wantedCollections (one per line; max 20)</label>
                <textarea class="form-control input-sm" name="wantedCollections" rows="2" placeholder="app.bsky.feed.post\napp.bsky.feed.like">${escapeHtml(
                  collectionsText
                )}</textarea>
              </div>
              <div class="form-group" style="margin-bottom: 10px;">
                <label class="text-muted small" style="margin-bottom: 4px;">wantedDids (one per line; max 200)</label>
                <textarea class="form-control input-sm" name="wantedDids" rows="2" placeholder="did:plc:…">${escapeHtml(
                  didsText
                )}</textarea>
              </div>
              <div style="display:flex; gap: 8px; align-items: center; justify-content: flex-end;">
                <button type="submit" class="btn btn-primary btn-sm">Save & reconnect</button>
              </div>
              ${state.jetstream?.source ? `<div class="text-muted small" style="margin-top: 8px;">Active: ${escapeHtml(String(state.jetstream.source))}</div>` : ''}
            </div>
          </form>
        `;
      }

      if (meta.id === 'firehose' && isEmbedFirehose()) {
        const firehoseUrl = (overrides.firehoseUrl || liveWorkspaceStream.firehoseUrl || '').trim();
        return `
          <form data-form="firehose-embed-settings" class="panel panel-default" style="margin: 0 0 10px 0;">
            <div class="panel-heading" style="display:flex; justify-content: space-between; align-items: center; gap: 8px;">
              <strong>Connection</strong>
              <button type="button" class="btn btn-default btn-xs" data-action="reset-firehose-embed-settings">Reset</button>
            </div>
            <div class="panel-body" style="padding: 10px;">
              <div class="form-group" style="margin-bottom: 10px;">
                <label class="text-muted small" style="margin-bottom: 4px;">Firehose WS URL</label>
                <input class="form-control input-sm" name="firehoseUrl" placeholder="wss://…" value="${escapeHtml(firehoseUrl)}" />
              </div>
              <div style="display:flex; gap: 8px; align-items: center; justify-content: flex-end;">
                <button type="submit" class="btn btn-primary btn-sm">Save & reconnect</button>
              </div>
              ${state.firehose?.source ? `<div class="text-muted small" style="margin-top: 8px;">Active: ${escapeHtml(String(state.firehose.source))}</div>` : ''}
            </div>
          </form>
        `;
      }

      return '';
    })();
    const handleBtn = isEmbedSingleStream()
      ? ''
      : `<button type="button" class="xv-column__handle" data-action="drag-column" data-col-id="${escapeHtml(meta.id)}" title="Drag or swipe to reorder">::</button>`;
    return `
      <section class="xv-column" data-col-id="${escapeHtml(meta.id)}" data-col-index="${escapeHtml(String(index))}">
        <div class="xv-column__header">
          <div>
            <div class="xv-column__title">${escapeHtml(meta.title)}</div>
            <div class="xv-column__meta">${escapeHtml(meta.subtitle)}</div>
          </div>
          ${handleBtn}
        </div>
        <div class="xv-feed-wrapper">
          ${embedControls}
          ${meta.composer && state.route?.name === 'feed' ? renderComposer() : ''}
          <div class="xv-feed" data-col-body="${escapeHtml(meta.id)}">${feedContent}</div>
        </div>
      </section>
    `;
  }

  function renderFirehoseBody(feedState = state.firehose) {
    if (feedState.loading) {
      return renderFeedState('Connecting…', 'Waiting for binary frames.');
    }
    if (feedState.error) {
      return renderFeedState('Firehose error', feedState.error || 'Please retry.');
    }

    const items = Array.isArray(feedState.items) ? feedState.items : [];
    if (items.length === 0) {
      return renderFeedState('No events yet', 'Once connected, frames will appear here.');
    }

    return items
      .map((it) => {
        const seq = it && it.seq != null ? String(it.seq) : '';
        const bytes = it && it.bytes != null ? String(it.bytes) : '';
        const prefix = it && it.prefix ? String(it.prefix) : '';
        const at = it && it.receivedAt ? String(it.receivedAt) : '';
        return `
          <article class="panel panel-default xv-post" data-id="firehose:${escapeHtml(seq)}">
            <div class="panel-body">
              <div class="text-muted small" style="display:flex; justify-content: space-between; gap: 10px;">
                <div><strong>#${escapeHtml(seq)}</strong> ${bytes ? `${escapeHtml(bytes)} bytes` : ''}</div>
                <div>${escapeHtml(at)}</div>
              </div>
              ${prefix ? `<pre class="text-muted" style="margin-top: 8px; margin-bottom: 0; font-size: 11px; line-height: 1.3; white-space: pre-wrap;">${escapeHtml(prefix)}</pre>` : ''}
            </div>
          </article>
        `;
      })
      .join('');
  }

  function renderTimelineGrid() {
    const order = Array.isArray(state.columnOrder) && state.columnOrder.length ? state.columnOrder : ['pds', 'jetstream'];
    const cols = order.map((id, idx) => renderTimelineColumn(id, idx)).join('');
    return `
      <div class="xv-lightbox">
        <div class="xv-lightbox__content">
          <div class="xv-column-grid" style="--xv-column-width:${COLUMN_WIDTH}px;" aria-label="Timeline columns">
            ${cols}
          </div>
        </div>
      </div>
    `;
  }

  function reorderColumns(colId, targetIndex) {
    const order = Array.isArray(state.columnOrder) ? [...state.columnOrder] : [];
    const currentIndex = order.indexOf(colId);
    if (currentIndex === -1 || targetIndex === currentIndex) return;
    if (targetIndex < 0 || targetIndex >= order.length) return;
    order.splice(currentIndex, 1);
    order.splice(targetIndex, 0, colId);
    state.columnOrder = order;
    paint();
  }

  function finishColumnDrag(clientX) {
    if (!_columnDrag) return;
    const grid = root?.querySelector('.xv-column-grid');
    const order = Array.isArray(state.columnOrder) ? state.columnOrder : [];
    if (!grid || !order.length) {
      _columnDrag = null;
      return;
    }
    const rect = grid.getBoundingClientRect();
    const relativeX = clientX - rect.left;
    const targetIndex = Math.max(0, Math.min(order.length - 1, Math.floor(relativeX / COLUMN_WIDTH)));
    reorderColumns(_columnDrag.colId, targetIndex);
    _columnDrag = null;
  }

  function paint() {
    const route = parseRouteFromLocation();
    state.route = route;

    const themeForRender = resolveTheme(themePreference);
    activeTheme = themeForRender;

    const isFeedRoute = route.name === 'feed';
    let centerTitle = 'Timeline';
    let centerBodyMarkup = renderTimelineGrid();
    let headerNote = 'Drag or swipe columns to reorder';

    if (route.name === 'thread') {
      centerTitle = 'Thread';
      centerBodyMarkup = renderThreadBody();
      headerNote = '';
    } else if (route.name === 'notifications') {
      centerTitle = 'Notifications';
      centerBodyMarkup = renderNotificationsBody();
      headerNote = '';
    } else if (route.name === 'profile') {
      centerTitle = 'Profile';
      centerBodyMarkup = renderProfileBody();
      headerNote = '';
    } else if (route.name === 'media') {
      centerTitle = 'Media';
      centerBodyMarkup = renderMediaBody();
      headerNote = '';
    } else if (route.name === 'search') {
      centerTitle = 'Search';
      centerBodyMarkup = renderSearchBody(route.query);
      headerNote = '';
    }

    if (isEmbedTimeline()) {
      root.innerHTML = `
        <div class="xv-shell" data-theme="${escapeHtml(themeForRender)}" data-theme-pref="${escapeHtml(themePreference)}">
          <div class="xv-embed xv-embed-timeline">
            ${centerBodyMarkup}
          </div>
        </div>
      `;
    } else if (isEmbedSettings()) {
      root.innerHTML = `
        <div class="xv-shell" data-theme="${escapeHtml(themeForRender)}" data-theme-pref="${escapeHtml(themePreference)}">
          <div class="xv-embed xv-embed-settings" style="max-width:${COLUMN_WIDTH}px;">
            ${renderLeftColumn()}
          </div>
        </div>
      `;
    } else {
      root.innerHTML = `
        <div class="xv-shell" data-theme="${escapeHtml(themeForRender)}" data-theme-pref="${escapeHtml(themePreference)}">
          <div class="xv-layout">
            <aside class="xv-col xv-left" aria-label="Sidebar">
              ${renderLeftColumn()}
            </aside>

            <main class="xv-col xv-center" aria-label="Feed">
              ${renderNav()}
              <div class="xv-header" style="margin-top: 10px; ${isFeedRoute ? 'justify-content: space-between; align-items: center;' : ''}">
                <h2 class="h3" style="margin-top: 0; margin-bottom: 0;">${escapeHtml(centerTitle)}</h2>
                ${isFeedRoute && headerNote ? `<div class="text-muted small">${escapeHtml(headerNote)}</div>` : ''}
              </div>
              ${isFeedRoute ? centerBodyMarkup : `<div id="feed" class="xv-feed">${centerBodyMarkup}</div>`}
            </main>

            <aside class="xv-col xv-right" aria-label="Details">
              ${renderRightColumn()}
            </aside>
          </div>
        </div>
      `;
    }

    applyThemeToShell();

    queueMicrotask(() => {
      syncFeedObserver();
    });
  }

  async function loadTimeline(signal) {
    const workspaceStream = readWorkspaceStreamSettings();
    const wantsPds = Array.isArray(state.columnOrder) && state.columnOrder.includes('pds');
    const wantsJetstream = Array.isArray(state.columnOrder) && state.columnOrder.includes('jetstream');
    const wantsFirehose = Array.isArray(state.columnOrder) && state.columnOrder.includes('firehose');

    const overrides = readStreamOverridesFromQuery();
    const jetstreamUrl = (overrides.jetstreamUrl || workspaceStream.jetstreamUrl || '').trim();
    const storedFilters = readWorkspaceJetstreamFilters();
    const wantedCollections =
      Array.isArray(overrides.wantedCollections) && overrides.wantedCollections.length
        ? overrides.wantedCollections
        : storedFilters.wantedCollections;
    const wantedDids =
      Array.isArray(overrides.wantedDids) && overrides.wantedDids.length ? overrides.wantedDids : storedFilters.wantedDids;
    const firehoseUrl = (overrides.firehoseUrl || workspaceStream.firehoseUrl || '').trim();

    const stopJetstream = () => {
      if (_jetstreamWs) {
        try {
          _jetstreamWs.onopen = null;
          _jetstreamWs.onmessage = null;
          _jetstreamWs.onerror = null;
          _jetstreamWs.onclose = null;
          _jetstreamWs.close();
        } catch {
          // ignore
        }
        _jetstreamWs = null;
      }
    };

    const stopFirehose = () => {
      if (_firehoseWs) {
        try {
          _firehoseWs.onopen = null;
          _firehoseWs.onmessage = null;
          _firehoseWs.onerror = null;
          _firehoseWs.onclose = null;
          _firehoseWs.close();
        } catch {
          // ignore
        }
        _firehoseWs = null;
      }
    };

    const startJetstream = () => {
      if (_jetstreamWs) return;
      if (!jetstreamUrl) {
        state.jetstream.loading = false;
        state.jetstream.error = 'No Jetstream URL configured.';
        state.jetstream.source = 'jetstream';
        paint();
        return;
      }

      let wsUrl;
      try {
        const url = new URL(jetstreamUrl);
        if (wantedCollections.length) url.searchParams.set('wantedCollections', wantedCollections.join(','));
        if (wantedDids.length) url.searchParams.set('wantedDids', wantedDids.join(','));
        wsUrl = url.toString();
      } catch {
        state.jetstream.loading = false;
        state.jetstream.error = 'Invalid Jetstream URL.';
        state.jetstream.source = 'jetstream';
        paint();
        return;
      }

      state.jetstream.loading = true;
      state.jetstream.error = null;
      state.jetstream.source = wsUrl;
      paint();

      try {
        const ws = new WebSocket(wsUrl);
        _jetstreamWs = ws;
        ws.onopen = () => {
          state.jetstream.loading = false;
          state.jetstream.error = null;
          paint();
        };
        ws.onmessage = (ev) => {
          if (!ev || typeof ev.data !== 'string') return;
          let msg;
          try {
            msg = JSON.parse(ev.data);
          } catch {
            return;
          }

          // Jetstream frames vary; we only handle common shapes.
          const identity = msg && (msg.kind === 'identity' || msg.type === 'identity') ? msg : null;
          const commit = msg && (msg.kind === 'commit' || msg.type === 'commit') ? msg : null;

          if (identity) {
            const did = String(identity.did || '').trim();
            const handle = String(identity.handle || '').trim();
            if (did && handle) {
              _jetstreamDidToHandle.set(did, handle);
            }
            return;
          }

          if (!commit) return;

          const ops = Array.isArray(commit.ops) ? commit.ops : [];
          const time = String(commit.time || commit.createdAt || new Date().toISOString());
          const repo = String(commit.repo || commit.did || '').trim();
          const handle = repo ? _jetstreamDidToHandle.get(repo) || '' : '';

          for (const op of ops) {
            if (!op || op.action !== 'create') continue;
            const path = String(op.path || '').trim();
            if (!path.startsWith('app.bsky.feed.post/')) continue;

            const record = op.record && typeof op.record === 'object' ? op.record : null;
            const text = record && typeof record.text === 'string' ? record.text : String(record?.text || '');
            const createdAt = record && record.createdAt ? String(record.createdAt) : time;
            const rkey = path.split('/')[1] || '';
            const uri = repo && rkey ? `at://${repo}/app.bsky.feed.post/${rkey}` : '';

            const item = {
              uri,
              cid: op.cid ? String(op.cid) : '',
              text,
              createdAt,
              indexedAt: createdAt,
              author: {
                did: repo,
                handle,
                displayName: handle ? `@${handle}` : repo ? repo : 'Account',
                avatar: '',
              },
              replyCount: null,
              repostCount: null,
              likeCount: null,
            };

            const existing = Array.isArray(state.jetstream.items) ? state.jetstream.items : [];
            const next = [item, ...existing].slice(0, 200);
            state.jetstream.items = next;

            // Throttle repaint a bit under heavy traffic.
            _jetstreamPaintTick++;
            if (_jetstreamPaintTick % 3 === 0) {
              paint();
            }
          }
        };
        ws.onerror = () => {
          state.jetstream.loading = false;
          state.jetstream.error = 'Jetstream connection error.';
          paint();
        };
        ws.onclose = () => {
          _jetstreamWs = null;
          if (wantsJetstream) {
            state.jetstream.loading = false;
            state.jetstream.error = state.jetstream.error || 'Jetstream disconnected.';
            paint();
          }
        };
      } catch {
        state.jetstream.loading = false;
        state.jetstream.error = 'Failed to start Jetstream.';
        paint();
      }
    };

    const startFirehose = () => {
      if (_firehoseWs) return;
      const url = firehoseUrl || 'wss://bsky.network/xrpc/com.atproto.sync.subscribeRepos';

      state.firehose.loading = true;
      state.firehose.error = null;
      state.firehose.source = url;
      paint();

      try {
        const ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer';
        _firehoseWs = ws;

        ws.onopen = () => {
          state.firehose.loading = false;
          state.firehose.error = null;
          paint();
        };

        ws.onmessage = (ev) => {
          const data = ev ? ev.data : null;
          if (!(data instanceof ArrayBuffer)) {
            return;
          }
          const bytes = data.byteLength;
          const entry = {
            seq: ++_firehoseSeq,
            bytes,
            prefix: hexPrefix(data, 24),
            receivedAt: new Date().toISOString(),
          };

          const existing = Array.isArray(state.firehose.items) ? state.firehose.items : [];
          const next = [entry, ...existing].slice(0, 300);
          state.firehose.items = next;

          _firehosePaintTick++;
          if (_firehosePaintTick % 4 === 0) {
            paint();
          }
        };

        ws.onerror = () => {
          state.firehose.loading = false;
          state.firehose.error = 'Firehose connection error.';
          paint();
        };

        ws.onclose = () => {
          _firehoseWs = null;
          if (wantsFirehose) {
            state.firehose.loading = false;
            state.firehose.error = state.firehose.error || 'Firehose disconnected.';
            paint();
          }
        };
      } catch {
        state.firehose.loading = false;
        state.firehose.error = 'Failed to start Firehose.';
        paint();
      }
    };

    state.feed.loading = true;
    state.feed.error = null;
    state.feed.hasMore = true;
    state.feed.loadingMore = false;
    state.feed.items = [];
    state.feed.source = '';

    state.jetstream.loading = true;
    state.jetstream.error = null;
    state.jetstream.items = [];
    state.jetstream.source = '';
    state.jetstream.hasMore = false;
    state.jetstream.loadingMore = false;

    state.firehose.loading = true;
    state.firehose.error = null;
    state.firehose.items = [];
    state.firehose.source = '';
    state.firehose.hasMore = false;
    state.firehose.loadingMore = false;

    paint();

    const limit = 30;

    let pdsError = null;
    let jetError = null;
    let fireError = null;

    if (wantsPds) {
      try {
        const localResp = await fetchJson(`${apiUrl('feed')}?limit=${limit}`, { signal });
        state.feed.items = Array.isArray(localResp?.items) ? localResp.items : [];
        state.feed.cachedCursor = typeof localResp?.cachedCursor === 'string' ? localResp.cachedCursor : '';
        state.feed.hasMore = Boolean(state.feed.cachedCursor);
        state.feed.source = localResp?.source || 'pds';
      } catch (err) {
        if (isAbortError(err)) return;
        pdsError = err?.message || String(err);
        state.feed.items = [];
        state.feed.cachedCursor = '';
        state.feed.hasMore = false;
        state.feed.source = 'pds';
      }
    } else {
      state.feed.items = [];
      state.feed.cachedCursor = '';
      state.feed.hasMore = false;
      state.feed.source = 'pds';
      state.feed.loading = false;
      state.feed.error = null;
    }

    if (wantsJetstream && atprotoSession) {
      try {
        const tokenSet = await atprotoSession.getTokenSet('auto');
        const base = normalizeBaseUrl(tokenSet?.aud);
        if (!base) throw new Error('ATProto session is missing audience/PDS URL.');

        const json = await atpFetchJson(`${base}/xrpc/app.bsky.feed.getTimeline?limit=${limit}`, { signal });
        const feed = Array.isArray(json?.feed) ? json.feed : [];

        state.jetstream.items = feed
          .map((entry) => normalizeAtprotoPostFromTimeline(entry?.post))
          .filter((p) => p && typeof p === 'object' && p.uri);
        state.jetstream.source = base || 'jetstream';
      } catch (err) {
        if (isAbortError(err)) return;
        jetError = err?.message || String(err);
        state.jetstream.items = [];
        state.jetstream.source = 'jetstream';
      }
    } else if (wantsJetstream) {
      // Jetstream embed uses websocket + does not require ATProto OAuth.
      if (!isEmbedJetstream()) {
        jetError = 'Connect Bluesky/ATProto to view Jetstream.';
        state.jetstream.items = [];
        state.jetstream.source = 'jetstream';
      }
    } else {
      state.jetstream.items = [];
      state.jetstream.source = '';
      state.jetstream.loading = false;
      state.jetstream.error = null;
    }

    if (wantsFirehose) {
      // Firehose is websocket-only.
      state.firehose.items = [];
      state.firehose.source = firehoseUrl || 'wss://bsky.network/xrpc/com.atproto.sync.subscribeRepos';
    } else {
      state.firehose.items = [];
      state.firehose.source = '';
      state.firehose.loading = false;
      state.firehose.error = null;
    }

    if (wantsPds) {
      state.feed.loading = false;
      state.feed.error = pdsError;
    }
    state.jetstream.loading = false;
    state.jetstream.error = jetError;

    if (wantsFirehose) {
      state.firehose.loading = false;
      state.firehose.error = fireError;
    }

    // Websocket streams: start/stop based on what this view needs.
    if (wantsJetstream && isEmbedJetstream()) {
      startJetstream();
    } else {
      stopJetstream();
    }

    if (wantsFirehose) {
      startFirehose();
    } else {
      stopFirehose();
    }

    // Preserve scroll anchoring while updating the PDS column.
    if (wantsPds) {
      setFeedItems(state.feed.items, { preserveScroll: true });
    }

    if (wantsJetstream && isEmbedJetstream()) {
      paint();
    }

    if (wantsFirehose) {
      paint();
    }
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
  loadBuildStamp();
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
  const sessionUrl = isPopupMode() ? `${apiUrl('session')}?popup=1` : apiUrl('session');
  const res = await fetch(sessionUrl, {
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

  setupCrossContextListeners();

  const page = root.dataset.page;
  const origin = getOrigin();
  const popupMode = isPopupMode();

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

      notifyAuthComplete(AUTH_MESSAGES.oauthComplete, { ok: true, did });
      if (window.opener) {
        closePopupWindow(getAppBase());
        return;
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

  if (popupMode && session?.loggedIn) {
    notifyAuthComplete(AUTH_MESSAGES.loginComplete, { userId: session.userId ?? null });
    closePopupWindow(getAppBase());
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
