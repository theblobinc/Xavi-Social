(function registerSocialStreamPanels() {
  'use strict';

  if (typeof window === 'undefined') return;

  const CSS_ID = 'xavi-social-vite-css';

  const STORAGE_KEYS = {
    jetstreamUrl: 'xavi.workspaceSettings.jetstreamUrl',
    jetstreamWantedCollections: 'xavi.workspaceSettings.jetstreamWantedCollections',
    jetstreamWantedDids: 'xavi.workspaceSettings.jetstreamWantedDids',
    firehoseUrl: 'xavi.workspaceSettings.firehoseUrl',
  };

  function normalizeBaseUrl(value) {
    const v = String(value || '').trim();
    return v ? v.replace(/\/+$/, '') : '';
  }

  function getSocialBase() {
    try {
      const provided = typeof window.XAVI_APP_BASE === 'string' ? window.XAVI_APP_BASE : '';
      const normalized = normalizeBaseUrl(provided);
      if (normalized) return normalized;
    } catch (e) {
      // ignore
    }

    try {
      const apiBase = typeof window.XAVI_API_BASE === 'string' ? window.XAVI_API_BASE : '';
      const normalizedApi = normalizeBaseUrl(apiBase);
      if (normalizedApi.endsWith('/api')) {
        return normalizedApi.slice(0, -'/api'.length);
      }
    } catch (e) {
      // ignore
    }

    return '/social';
  }

  function safeGet(key, fallback = '') {
    try {
      const v = window.localStorage?.getItem?.(key);
      return v == null ? fallback : String(v);
    } catch (e) {
      return fallback;
    }
  }

  function ensureCssLoaded() {
    const v = (typeof window !== 'undefined' && window.XAVI_ASSET_VERSION)
      ? ('?v=' + encodeURIComponent(String(window.XAVI_ASSET_VERSION)))
      : '';

    if (!document.getElementById(CSS_ID)) {
      const link = document.createElement('link');
      link.id = CSS_ID;
      link.rel = 'stylesheet';
      link.href = '/packages/xavi_social/dist/app.css' + v;
      document.head.appendChild(link);
    }
  }

  function buildStreamSrc(stream) {
    const base = getSocialBase();
    const u = new URL(base, window.location.origin);
    u.searchParams.set('embed', String(stream || 'timeline'));

    // For convenience: if Settings has values, pass them through so the iframe
    // doesn't need to rely only on localStorage.
    if (stream === 'jetstream') {
      const jetBase = safeGet(STORAGE_KEYS.jetstreamUrl, '').trim();
      const wantedCollections = safeGet(STORAGE_KEYS.jetstreamWantedCollections, '').trim();
      const wantedDids = safeGet(STORAGE_KEYS.jetstreamWantedDids, '').trim();
      if (jetBase) u.searchParams.set('jetstreamUrl', jetBase);
      if (wantedCollections) u.searchParams.set('wantedCollections', wantedCollections);
      if (wantedDids) u.searchParams.set('wantedDids', wantedDids);
    }

    if (stream === 'firehose') {
      const fireBase = safeGet(STORAGE_KEYS.firehoseUrl, '').trim();
      if (fireBase) u.searchParams.set('firehoseUrl', fireBase);
    }

    return u.toString();
  }

  class XaviSocialStreamFrame extends HTMLElement {
    static get observedAttributes() {
      return ['stream'];
    }

    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._frame = null;
    }

    connectedCallback() {
      ensureCssLoaded();
      this.render();
    }

    attributeChangedCallback() {
      this.render();
    }

    render() {
      const stream = String(this.getAttribute('stream') || 'timeline').trim().toLowerCase();
      const src = buildStreamSrc(stream);

      if (!this._frame) {
        this.shadowRoot.innerHTML = `
          <style>
            :host{display:block; width:100%; height:100%; min-height:0;}
            iframe{border:0; width:100%; height:100%; display:block; background:transparent;}
          </style>
        `;
        this._frame = document.createElement('iframe');
        // Same-origin so it can share auth/session/localStorage.
        this._frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
        this._frame.loading = 'lazy';
        this.shadowRoot.appendChild(this._frame);
      }

      if (this._frame.src !== src) {
        this._frame.src = src;
      }
    }
  }

  if (!customElements.get('xavi-social-stream-frame')) {
    customElements.define('xavi-social-stream-frame', XaviSocialStreamFrame);
  }

  function openPanel(id, title, stream, context = {}) {
    if (!window.XaviColumnPanels || typeof window.XaviColumnPanels.openPanel !== 'function') {
      console.warn('[SocialStreams] Column panels not ready yet.');
      return null;
    }

    return window.XaviColumnPanels.openPanel({
      workspace: context.workspace || null,
      id,
      title,
      colStart: 0,
      colSpan: 1,
      // This module registers taskbar entries; avoid duplicates from column_panels.
      registerInTaskbar: false,
      buildContent: () => {
        if (customElements.get('xavi-social-stream')) {
          const el = document.createElement('xavi-social-stream');
          el.setAttribute('stream', stream);
          return el;
        }

        const el = document.createElement('xavi-social-stream-frame');
        el.setAttribute('stream', stream);
        return el;
      },
    });
  }

  function queuePanelRegistration(factory) {
    const tryRegister = () => {
      if (typeof window.registerTaskbarPanel !== 'function') return false;
      try {
        window.registerTaskbarPanel(factory());
      } catch (err) {
        console.warn('[SocialStreams] Failed to register panel:', err);
      }
      return true;
    };

    if (tryRegister()) return;
    window.addEventListener('xavi-panel-registry-ready', () => tryRegister(), { once: true });
  }

  const panels = [
    {
      id: 'social-pds',
      label: 'PDS Feed',
      icon: '🧾',
      title: 'PDS Feed',
      stream: 'pds',
      priority: 16,
    },
    {
      id: 'social-jetstream',
      label: 'Jetstream',
      icon: '🛰️',
      title: 'Jetstream',
      stream: 'jetstream',
      priority: 17,
    },
    {
      id: 'social-firehose',
      label: 'Firehose',
      icon: '🔥',
      title: 'Firehose',
      stream: 'firehose',
      priority: 18,
    },
  ];

  panels.forEach((p) => {
    queuePanelRegistration(() => ({
      id: p.id,
      label: p.label,
      icon: p.icon,
      category: 'Social',
      priority: p.priority,
      requiresAdmin: false,
      maxInstances: 3,
      launch: (context = {}) => openPanel(p.id, p.title, p.stream, context),
    }));
  });
})();
