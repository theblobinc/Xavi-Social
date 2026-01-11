/*
  Minimal, no-bundler Social UI primitives for MultiGrid.
  Purpose: replace iframe/Vite-mounted views with native web components.
*/

(() => {
  const profileCache = new Map();

  function getApiBase() {
    // Concrete site root already serves /social/api/*
    // Allow override via window.XAVI_SOCIAL_API_BASE (e.g., proxy/dev).
    if (typeof window.XAVI_SOCIAL_API_BASE === 'string' && window.XAVI_SOCIAL_API_BASE.trim()) {
      return window.XAVI_SOCIAL_API_BASE.replace(/\/$/, '');
    }
    return '/social/api';
  }

  function apiUrl(path) {
    const base = getApiBase();
    const clean = String(path || '').replace(/^\//, '');
    return `${base}/${clean}`;
  }

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function linkify(text) {
    const safe = escapeHtml(text);
    return safe.replace(/(https?:\/\/[\w\-._~:/?#\[\]@!$&'()*+,;=%]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  async function fetchJson(url, signal) {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      signal
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return await res.json();
  }

  async function resolveProfile(actor, signal) {
    const key = String(actor || '').trim();
    if (!key) return null;

    if (profileCache.has(key)) return profileCache.get(key);

    const p = (async () => {
      try {
        const url = new URL(apiUrl('profile'), window.location.origin);
        url.searchParams.set('actor', key);
        const data = await fetchJson(url.toString(), signal);
        return data?.profile || null;
      } catch {
        return null;
      }
    })();

    profileCache.set(key, p);
    return p;
  }

  class XaviDidChip extends HTMLElement {
    static get observedAttributes() {
      return ['actor'];
    }

    constructor() {
      super();
      this._ac = null;
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML = `
        <style>
          :host { display:inline-flex; align-items:center; gap:6px; font: 12px/1.2 system-ui, sans-serif; }
          a { color: inherit; text-decoration: none; opacity: .9; }
          a:hover { text-decoration: underline; opacity: 1; }
          .handle { font-weight: 600; }
          .did { opacity: .7; }
        </style>
        <span class="handle">…</span>
      `;
      this._handleEl = this.shadowRoot.querySelector('.handle');
    }

    connectedCallback() {
      this._load();
    }

    attributeChangedCallback() {
      this._load();
    }

    disconnectedCallback() {
      if (this._ac) this._ac.abort();
    }

    async _load() {
      if (!this.isConnected) return;
      const actor = this.getAttribute('actor') || '';
      if (!actor.trim()) {
        this._handleEl.textContent = '';
        return;
      }

      if (this._ac) this._ac.abort();
      this._ac = new AbortController();
      const signal = this._ac.signal;

      this._handleEl.textContent = actor;

      const profile = await resolveProfile(actor, signal);
      if (!this.isConnected || signal.aborted) return;
      if (!profile) return;

      const displayName = profile.displayName || '';
      const handle = profile.handle || '';
      const did = profile.did || '';

      const label = displayName ? `${displayName}${handle ? ` (@${handle})` : ''}` : (handle ? `@${handle}` : (did || actor));

      const href = handle ? `https://bsky.app/profile/${encodeURIComponent(handle)}` : (did ? `https://bsky.app/profile/${encodeURIComponent(did)}` : '#');

      this.shadowRoot.innerHTML = `
        <style>
          :host { display:inline-flex; align-items:center; gap:6px; font: 12px/1.2 system-ui, sans-serif; }
          a { color: inherit; text-decoration: none; opacity: .9; }
          a:hover { text-decoration: underline; opacity: 1; }
          .handle { font-weight: 600; }
          .did { opacity: .7; }
        </style>
        <a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">
          <span class="handle">${escapeHtml(label)}</span>
        </a>
      `;
    }
  }

  class XaviPostView extends HTMLElement {
    constructor() {
      super();
      this._post = null;
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML = `
        <style>
          :host { display:block; font: 13px/1.4 system-ui, sans-serif; color: var(--xavi-fg, #eaeaea); }
          .card { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 10px; padding: 10px 12px; }
          .row { display:flex; justify-content: space-between; gap: 10px; align-items: baseline; }
          .meta { opacity: .75; font-size: 12px; }
          .text { margin-top: 6px; white-space: pre-wrap; word-break: break-word; }
          a { color: #8ab4ff; }
        </style>
        <div class="card">
          <div class="row">
            <xavi-did-chip class="author"></xavi-did-chip>
            <span class="meta"></span>
          </div>
          <div class="text"></div>
        </div>
      `;
      this._authorEl = this.shadowRoot.querySelector('.author');
      this._metaEl = this.shadowRoot.querySelector('.meta');
      this._textEl = this.shadowRoot.querySelector('.text');
    }

    set post(value) {
      this._post = value;
      this._render();
    }

    get post() {
      return this._post;
    }

    connectedCallback() {
      // Optional: allow setting via attribute for debugging.
      if (!this._post && this.hasAttribute('data-post')) {
        try {
          this._post = JSON.parse(this.getAttribute('data-post'));
        } catch {
          // ignore
        }
      }
      this._render();
    }

    _render() {
      const post = this._post;
      if (!post) {
        this._authorEl.setAttribute('actor', '');
        this._metaEl.textContent = '';
        this._textEl.textContent = '';
        return;
      }

      const authorDid = post?.author?.did || post?.author?.handle || '';
      this._authorEl.setAttribute('actor', authorDid);

      const created = post?.indexedAt || post?.createdAt || '';
      this._metaEl.textContent = created ? new Date(created).toLocaleString() : '';

      const text = post?.text || post?.record?.text || '';
      this._textEl.innerHTML = linkify(text);
    }
  }

  class XaviSocialStream extends HTMLElement {
    static get observedAttributes() {
      return ['stream'];
    }

    constructor() {
      super();
      this._ac = null;
      this._ws = null;
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML = `
        <style>
          :host { display:block; height: 100%; }
          .wrap { display:flex; flex-direction: column; height: 100%; font: 13px/1.4 system-ui, sans-serif; color: var(--xavi-fg, #eaeaea); }
          header { display:flex; align-items:center; justify-content: space-between; gap: 8px; padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,.08); }
          .title { font-weight: 700; }
          .status { opacity: .7; font-size: 12px; }
          .btns { display:flex; gap: 6px; }
          button { background: rgba(255,255,255,.06); color: inherit; border: 1px solid rgba(255,255,255,.10); border-radius: 8px; padding: 5px 8px; cursor: pointer; }
          button:hover { background: rgba(255,255,255,.10); }
          main { padding: 10px; overflow: auto; }
          .list { display:flex; flex-direction: column; gap: 10px; }
          .event { background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.06); border-radius: 10px; padding: 8px 10px; font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; white-space: pre-wrap; word-break: break-word; }
        </style>
        <div class="wrap">
          <header>
            <div>
              <div class="title"></div>
              <div class="status"></div>
            </div>
            <div class="btns">
              <button class="refresh">Refresh</button>
              <button class="clear">Clear</button>
            </div>
          </header>
          <main>
            <div class="list"></div>
          </main>
        </div>
      `;
      this._titleEl = this.shadowRoot.querySelector('.title');
      this._statusEl = this.shadowRoot.querySelector('.status');
      this._listEl = this.shadowRoot.querySelector('.list');

      this.shadowRoot.querySelector('.refresh').addEventListener('click', () => this._start());
      this.shadowRoot.querySelector('.clear').addEventListener('click', () => (this._listEl.innerHTML = ''));
    }

    connectedCallback() {
      this._start();
    }

    attributeChangedCallback() {
      if (this.isConnected) this._start();
    }

    disconnectedCallback() {
      this._stop();
    }

    _stop() {
      if (this._ac) this._ac.abort();
      this._ac = null;
      if (this._ws) {
        try { this._ws.close(); } catch {}
      }
      this._ws = null;
    }

    _setStatus(text) {
      this._statusEl.textContent = text;
    }

    _appendNode(node) {
      this._listEl.prepend(node);
    }

    _appendEvent(text) {
      const el = document.createElement('div');
      el.className = 'event';
      el.textContent = text;
      this._appendNode(el);
    }

    async _start() {
      this._stop();
      this._ac = new AbortController();
      const signal = this._ac.signal;

      const stream = (this.getAttribute('stream') || 'pds').toLowerCase();
      const title = stream === 'pds' ? 'PDS' : (stream === 'jetstream' ? 'Jetstream' : (stream === 'firehose' ? 'Firehose' : stream));
      this._titleEl.textContent = title;

      if (stream === 'pds' || stream === 'timeline') {
        await this._loadPdsFeed(signal);
        return;
      }

      if (stream === 'jetstream') {
        this._connectJetstream();
        return;
      }

      if (stream === 'firehose') {
        this._connectFirehose();
        return;
      }

      this._setStatus('Unknown stream');
    }

    async _loadPdsFeed(signal) {
      this._setStatus('Loading…');
      try {
        const url = new URL(apiUrl('feed'), window.location.origin);
        url.searchParams.set('limit', '30');
        const data = await fetchJson(url.toString(), signal);
        const items = data?.items || data?.feed || [];

        this._setStatus(`Loaded ${items.length}`);

        for (const entry of items) {
          const post = entry?.post || entry;
          const pv = document.createElement('xavi-post-view');
          pv.post = post;
          this._appendNode(pv);
        }
      } catch (err) {
        this._setStatus('Failed to load');
        this._appendEvent(String(err?.message || err));
      }
    }

    _connectJetstream() {
      const defaultUrl = 'wss://jetstream1.us-east.bsky.network/subscribe';
      const url = (localStorage.getItem('xavi.workspaceSettings.jetstreamUrl') || defaultUrl).trim();
      this._setStatus(`Connecting: ${url}`);

      try {
        this._ws = new WebSocket(url);
      } catch (err) {
        this._setStatus('WebSocket failed');
        this._appendEvent(String(err?.message || err));
        return;
      }

      this._ws.addEventListener('open', () => {
        this._setStatus('Connected');
      });

      this._ws.addEventListener('close', () => {
        this._setStatus('Disconnected');
      });

      this._ws.addEventListener('error', () => {
        this._setStatus('Error');
      });

      this._ws.addEventListener('message', (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          // Try to extract something post-like.
          const record = msg?.commit?.record;
          const collection = msg?.commit?.collection;
          if (record && (record.text || record.$type)) {
            const pv = document.createElement('xavi-post-view');
            pv.post = {
              author: { did: msg?.did || '' },
              text: record.text || JSON.stringify(record),
              indexedAt: msg?.time || ''
            };
            this._appendNode(pv);
            return;
          }

          this._appendEvent(JSON.stringify({
            time: msg?.time,
            did: msg?.did,
            collection,
            type: msg?.type
          }, null, 2));
        } catch {
          this._appendEvent(String(ev.data));
        }
      });
    }

    _connectFirehose() {
      const defaultUrl = 'wss://bsky.network/xrpc/com.atproto.sync.subscribeRepos';
      const url = (localStorage.getItem('xavi.workspaceSettings.firehoseUrl') || defaultUrl).trim();
      this._setStatus(`Connecting: ${url}`);

      try {
        this._ws = new WebSocket(url);
      } catch (err) {
        this._setStatus('WebSocket failed');
        this._appendEvent(String(err?.message || err));
        return;
      }

      this._ws.binaryType = 'arraybuffer';

      this._ws.addEventListener('open', () => {
        this._setStatus('Connected (binary)');
      });

      this._ws.addEventListener('close', () => {
        this._setStatus('Disconnected');
      });

      this._ws.addEventListener('error', () => {
        this._setStatus('Error');
      });

      this._ws.addEventListener('message', (ev) => {
        const buf = ev.data;
        if (buf instanceof ArrayBuffer) {
          const bytes = new Uint8Array(buf);
          const head = Array.from(bytes.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
          this._appendEvent(`firehose frame: ${bytes.length} bytes\nhead: ${head}`);
          return;
        }
        this._appendEvent(`firehose frame: ${typeof ev.data}`);
      });
    }
  }

  if (!customElements.get('xavi-did-chip')) customElements.define('xavi-did-chip', XaviDidChip);
  if (!customElements.get('xavi-post-view')) customElements.define('xavi-post-view', XaviPostView);
  if (!customElements.get('xavi-social-stream')) customElements.define('xavi-social-stream', XaviSocialStream);
})();
