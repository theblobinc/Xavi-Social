(function registerMediaViewerPanel() {
  'use strict';

  if (typeof window === 'undefined') {
    return;
  }

  const STORAGE_KEY_LAST_URL = 'xavi.mediaViewer.lastUrl';

  function getColumnWidth() {
    const workspace = document.querySelector('xavi-multi-grid');
    let raw = '';
    try {
      raw = workspace?.style?.getPropertyValue?.('--xavi-col-w') || '';
    } catch (e) {
      raw = '';
    }
    if (!raw) {
      try {
        raw = (typeof getComputedStyle === 'function' && workspace) ? (getComputedStyle(workspace).getPropertyValue('--xavi-col-w') || '') : '';
      } catch (e) {
        raw = '';
      }
    }
    const parsed = parseInt(String(raw || '').trim().replace('px', ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 350;
  }

  function getWorkspaceRect() {
    const workspace = document.querySelector('xavi-multi-grid');
    const host = workspace?.shadowRoot?.host || workspace;
    try {
      return host?.getBoundingClientRect?.() || null;
    } catch (e) {
      return null;
    }
  }

  function suggestSpan() {
    const colW = getColumnWidth();
    const rect = getWorkspaceRect();
    const cols = rect ? Math.max(1, Math.floor(rect.width / colW)) : 3;
    // On a wide workspace (eg ~1920px => ~5 cols), default to 2 columns.
    return cols >= 5 ? 2 : 1;
  }

  function suggestStart(span) {
    const colW = getColumnWidth();
    const rect = getWorkspaceRect();
    const cols = rect ? Math.max(1, Math.floor(rect.width / colW)) : 3;
    // Try to avoid the Timeline default (col 1-2). Prefer col 3 for 2-col panels.
    if (cols >= 5 && span >= 2) return 3;
    if (cols >= 4 && span === 1) return 3;
    return 1;
  }

  function normalizeUrl(raw) {
    const v = String(raw || '').trim();
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    // Allow users to paste without scheme.
    if (/^[a-z0-9.-]+\.[a-z]{2,}([/:?#]|$)/i.test(v)) {
      return 'https://' + v;
    }
    return v;
  }

  function isLikelyImage(url) {
    return /\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(url);
  }

  function isLikelyAudio(url) {
    return /\.(mp3|m4a|aac|wav|ogg)(\?|#|$)/i.test(url);
  }

  function isLikelyVideo(url) {
    return /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i.test(url);
  }

  function toEmbedUrl(url) {
    const u = normalizeUrl(url);
    if (!/^https?:\/\//i.test(u)) return u;

    try {
      const parsed = new URL(u);

      // YouTube
      if (/(^|\.)youtube\.com$/i.test(parsed.hostname)) {
        const id = parsed.searchParams.get('v');
        if (id) {
          return `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
        }
        if (parsed.pathname.startsWith('/embed/')) {
          return u;
        }
      }
      if (/^youtu\.be$/i.test(parsed.hostname)) {
        const id = parsed.pathname.replace(/^\//, '');
        if (id) {
          return `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
        }
      }

      // Vimeo
      if (/(^|\.)vimeo\.com$/i.test(parsed.hostname)) {
        const id = parsed.pathname.split('/').filter(Boolean)[0];
        if (id && /^\d+$/.test(id)) {
          return `https://player.vimeo.com/video/${encodeURIComponent(id)}`;
        }
      }

      return u;
    } catch (e) {
      return u;
    }
  }

  function createMediaViewerContent({ initialUrl = '' } = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = 'xavi-media-viewer';
    wrapper.innerHTML = `
      <style>
        .xavi-media-viewer {
          height: 100%;
          display: flex;
          flex-direction: column;
          min-height: 0;
          color: rgba(255,255,255,0.92);
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif;
        }
        .xavi-media-viewer__bar {
          display: flex;
          gap: 8px;
          padding: 10px;
          border-bottom: 1px solid rgba(255,255,255,0.10);
          background: rgba(255,255,255,0.04);
          align-items: center;
        }
        .xavi-media-viewer__bar input {
          flex: 1 1 auto;
          min-width: 0;
          height: 32px;
          padding: 0 10px;
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.18);
          background: rgba(0,0,0,0.20);
          color: rgba(255,255,255,0.92);
          outline: none;
        }
        .xavi-media-viewer__bar button {
          height: 32px;
          padding: 0 10px;
          border-radius: 8px;
          border: 0;
          background: rgba(255,255,255,0.12);
          color: rgba(255,255,255,0.92);
          cursor: pointer;
        }
        .xavi-media-viewer__bar button:hover {
          background: rgba(255,255,255,0.18);
        }
        .xavi-media-viewer__body {
          flex: 1 1 auto;
          min-height: 0;
          overflow: hidden;
          background: rgba(0,0,0,0.12);
        }
        .xavi-media-viewer__frame,
        .xavi-media-viewer__video,
        .xavi-media-viewer__audio,
        .xavi-media-viewer__img {
          width: 100%;
          height: 100%;
          border: 0;
          display: block;
          background: transparent;
        }
        .xavi-media-viewer__audio {
          height: auto;
          padding: 16px;
        }
        .xavi-media-viewer__empty {
          padding: 14px;
          color: rgba(255,255,255,0.70);
          line-height: 1.35;
        }
      </style>

      <div class="xavi-media-viewer__bar">
        <input type="text" placeholder="Paste a media URL (YouTube, MP4, image, etc)…" />
        <button type="button" data-action="open">Open</button>
        <button type="button" data-action="newtab" title="Open in a new tab">↗</button>
        <button type="button" data-action="clear" title="Clear">×</button>
      </div>

      <div class="xavi-media-viewer__body">
        <div class="xavi-media-viewer__empty">Paste a URL above to preview media.\n\nSupports: YouTube/Vimeo embeds, direct MP4/WebM videos, audio files, images, and generic iframe pages.</div>
      </div>
    `;

    const input = wrapper.querySelector('input');
    const body = wrapper.querySelector('.xavi-media-viewer__body');

    function setContent(el) {
      body.innerHTML = '';
      body.appendChild(el);
    }

    function render(url) {
      const normalized = normalizeUrl(url);
      if (!normalized) {
        const empty = document.createElement('div');
        empty.className = 'xavi-media-viewer__empty';
        empty.textContent = 'Paste a URL above to preview media.';
        setContent(empty);
        return;
      }

      try {
        window.localStorage?.setItem?.(STORAGE_KEY_LAST_URL, normalized);
      } catch (e) {
        // ignore
      }

      if (isLikelyImage(normalized)) {
        const img = document.createElement('img');
        img.className = 'xavi-media-viewer__img';
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        img.src = normalized;
        img.style.objectFit = 'contain';
        setContent(img);
        return;
      }

      if (isLikelyAudio(normalized)) {
        const audio = document.createElement('audio');
        audio.className = 'xavi-media-viewer__audio';
        audio.controls = true;
        audio.preload = 'metadata';
        audio.src = normalized;
        setContent(audio);
        return;
      }

      if (isLikelyVideo(normalized)) {
        const video = document.createElement('video');
        video.className = 'xavi-media-viewer__video';
        video.controls = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.src = normalized;
        setContent(video);
        return;
      }

      const iframe = document.createElement('iframe');
      iframe.className = 'xavi-media-viewer__frame';
      iframe.src = toEmbedUrl(normalized);
      iframe.loading = 'lazy';
      iframe.referrerPolicy = 'no-referrer';
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen';
      setContent(iframe);
    }

    function readInitial() {
      const fromArg = normalizeUrl(initialUrl);
      if (fromArg) return fromArg;
      try {
        const stored = window.localStorage?.getItem?.(STORAGE_KEY_LAST_URL) || '';
        return normalizeUrl(stored);
      } catch (e) {
        return '';
      }
    }

    const initial = readInitial();
    if (input) {
      input.value = initial;
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          render(input.value);
        }
      });
    }

    wrapper.querySelectorAll('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        if (action === 'open') {
          render(input?.value || '');
        } else if (action === 'newtab') {
          const u = normalizeUrl(input?.value || '');
          if (u) {
            try {
              window.open(u, '_blank', 'noopener');
            } catch (e) {
              // ignore
            }
          }
        } else if (action === 'clear') {
          if (input) input.value = '';
          render('');
        }
      });
    });

    if (initial) {
      render(initial);
    }

    return wrapper;
  }

  function queuePanelRegistration(factory) {
    const tryRegister = () => {
      if (typeof window.registerTaskbarPanel !== 'function') {
        return false;
      }
      try {
        window.registerTaskbarPanel(factory());
      } catch (err) {
        console.warn('[MediaViewer] Failed to register panel entry:', err);
      }
      return true;
    };

    if (tryRegister()) return;

    window.addEventListener('xavi-panel-registry-ready', () => {
      tryRegister();
    }, { once: true });
  }

  function findExistingPanel(context = {}) {
    const workspace = context.workspace || document.querySelector('xavi-multi-grid');
    const roots = [];
    if (workspace) {
      if (workspace.shadowRoot) roots.push(workspace.shadowRoot);
      if (typeof workspace.getFloatingLayer === 'function') {
        const layer = workspace.getFloatingLayer();
        if (layer) roots.push(layer);
      }
      roots.push(workspace);
    }
    roots.push(document);

    for (const root of roots) {
      if (!root || typeof root.querySelector !== 'function') continue;
      const colMatch = root.querySelector('xavi-column-panel[panel-id="media-viewer"]');
      if (colMatch) return colMatch;
      const legacy = root.querySelector('xavi-media-viewer-panel');
      if (legacy) return legacy;
    }
    return null;
  }

  function spawnMediaViewerPanel(options = {}) {
    const context = options.context || {};
    const url = context.url || options.url || '';

    const existing = findExistingPanel(context);
    if (existing) {
      existing.hidden = false;
      existing.style.display = 'block';
      existing.bringToFront?.();
      return existing;
    }

    // Prefer column panels.
    if (window.XaviColumnPanels && typeof window.XaviColumnPanels.openPanel === 'function') {
      const span = suggestSpan();
      const start = suggestStart(span);
      return window.XaviColumnPanels.openPanel({
        workspace: context.workspace || null,
        id: 'media-viewer',
        title: 'Media Viewer',
        colStart: start,
        colSpan: span,
        buildContent: () => createMediaViewerContent({ initialUrl: url })
      });
    }

    // Fallback: raw floating panel.
    const host = document.querySelector('xavi-multi-grid')?.shadowRoot?.getElementById?.('floating-panel-layer') || document.body;
    if (!host) return null;

    const el = document.createElement('xavi-media-viewer-panel');
    if (url) {
      el.setAttribute('data-initial-url', String(url));
    }
    host.appendChild(el);
    el.focusPanel?.();
    return el;
  }

  class XaviMediaViewerPanel extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.gridObject = null;
      this._rendered = false;
      this._zCounter = 5600;
      this.boundBringToFront = () => this.bringToFront();
    }

    connectedCallback() {
      if (!this._rendered) {
        this.render();
        this._rendered = true;
      }

      this.initializeGridObject();
      this.addEventListener('pointerdown', this.boundBringToFront);
      this.bringToFront();
    }

    disconnectedCallback() {
      this.removeEventListener('pointerdown', this.boundBringToFront);
      if (this.gridObject && typeof this.gridObject.destroy === 'function') {
        this.gridObject.destroy();
      }
      this.gridObject = null;
    }

    render() {
      const initialUrl = this.getAttribute('data-initial-url') || '';
      this.shadowRoot.innerHTML = `
        <style>
          :host {
            position: absolute;
            left: 90px;
            top: 90px;
            width: 980px;
            height: 720px;
            display: block;
            background: rgba(12, 12, 12, 0.96);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 10px;
            backdrop-filter: blur(10px);
            box-sizing: border-box;
            overflow: hidden;
            color: rgba(255, 255, 255, 0.92);
          }
          .panel {
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            min-height: 0;
          }
          .titlebar {
            height: 28px;
            flex: 0 0 28px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 8px;
            background: rgba(255, 255, 255, 0.06);
            border-bottom: 1px solid rgba(255, 255, 255, 0.10);
            cursor: move;
            user-select: none;
          }
          .title {
            font-size: 13px;
            letter-spacing: 0.2px;
          }
          button {
            appearance: none;
            border: 0;
            background: rgba(255, 255, 255, 0.08);
            color: rgba(255, 255, 255, 0.92);
            width: 26px;
            height: 20px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
            line-height: 20px;
          }
          button:hover { background: rgba(255, 255, 255, 0.16); }
          .body {
            flex: 1 1 auto;
            min-height: 0;
            overflow: hidden;
          }
        </style>
        <div class="panel" role="dialog" aria-label="Media Viewer">
          <div class="titlebar" part="handle">
            <div class="title">Media Viewer</div>
            <div class="actions"><button type="button" aria-label="Close">×</button></div>
          </div>
          <div class="body"></div>
        </div>
      `;

      const body = this.shadowRoot.querySelector('.body');
      if (body) {
        body.appendChild(createMediaViewerContent({ initialUrl }));
      }

      const closeBtn = this.shadowRoot.querySelector('button[aria-label="Close"]');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.hidden = true;
          this.style.display = 'none';
          this.dispatchEvent(new CustomEvent('panel-closed', { bubbles: true, composed: true, detail: { panelId: 'media-viewer' } }));
        });
      }
    }

    initializeGridObject() {
      if (this.gridObject || typeof window.GridObject === 'undefined') {
        return;
      }

      this.gridObject = new window.GridObject(this, {
        gridSize: 1,
        gridSnapEnabled: false,
        minWidth: 520,
        minHeight: 360,
        defaultWidth: 980,
        defaultHeight: 720,
        saveStateKey: 'panel.media-viewer',
        draggable: true,
        resizable: true
      });
    }

    bringToFront() {
      if (window.ZIndexManager) {
        this.style.zIndex = String(window.ZIndexManager.getNextGridPanel());
      } else {
        this._zCounter += 1;
        this.style.zIndex = String(this._zCounter);
      }

      this.dispatchEvent(new CustomEvent('floating-panel-focus', {
        bubbles: true,
        composed: true,
        detail: { panelId: 'media-viewer', panelElement: this }
      }));
    }

    focusPanel() {
      this.hidden = false;
      this.style.display = 'block';
      this.bringToFront();
    }
  }

  if (!customElements.get('xavi-media-viewer-panel')) {
    customElements.define('xavi-media-viewer-panel', XaviMediaViewerPanel);
  }

  const entryConfig = {
    id: 'media-viewer',
    label: 'Media Viewer',
    icon: '📺',
    category: 'Media',
    priority: 32,
    requiresAdmin: false,
    maxInstances: 1,
    launch: (context = {}) => spawnMediaViewerPanel({ context })
  };

  queuePanelRegistration(() => entryConfig);
  window.spawnMediaViewerPanel = spawnMediaViewerPanel;
})();
