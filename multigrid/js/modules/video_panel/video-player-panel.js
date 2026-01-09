(function registerVideoPlayerPanel() {
  'use strict';

  if (typeof window === 'undefined') {
    return;
  }

  function findExistingPanel() {
    return document.querySelector('video-player-panel');
  }

  function findInOpenShadowRoots(selector) {
    const visited = new Set();
    const queue = [document];
    while (queue.length) {
      const root = queue.shift();
      try {
        const found = root?.querySelector?.(selector);
        if (found) return found;
      } catch (err) {
        // ignore
      }

      let nodes = [];
      try {
        nodes = root?.querySelectorAll?.('*') || [];
      } catch (err) {
        nodes = [];
      }

      for (const el of nodes) {
        const sr = el?.shadowRoot;
        if (sr && !visited.has(sr)) {
          visited.add(sr);
          queue.push(sr);
        }
      }
    }
    return null;
  }

  function resolveHostParent() {
    const workspace = document.querySelector('xavi-multi-grid');
    if (workspace) {
      const shadowLayer = workspace.shadowRoot?.getElementById?.('floating-panel-layer');
      if (shadowLayer) {
        return shadowLayer;
      }
      return workspace;
    }
    return document.body || document.documentElement;
  }

  function spawnVideoPlayerPanel(playerEl = null) {
    const existing = findExistingPanel();
    if (existing) {
      existing.focusPanel?.();
      return existing;
    }

    const panel = document.createElement('video-player-panel');
    if (playerEl) {
      panel._playerRef = playerEl;
    }
    resolveHostParent().appendChild(panel);
    panel.focusPanel?.();
    return panel;
  }

  class VideoPlayerPanel extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.gridObject = null;
      this.panelContent = null;
      this.playerSlot = null;
      this.placeholder = null;
      this.closeButton = null;
      this.videoPlayerElement = null;
      this.homeParent = null;
      this.homeNextSibling = null;
      this._targetModeOnClose = 'docked';

      this.boundClose = (event) => this.handleCloseRequest(event);
      this.boundBringToFront = () => this.bringToFront();
    }

    connectedCallback() {
      this.render();
      this.attachVideoPlayer();
      this.initializeGridObject();
      this.bringToFront();
      this.addEventListener('mousedown', this.boundBringToFront);
      this.addEventListener('panel-close-request', this.boundClose);
    }

    disconnectedCallback() {
      this.removeEventListener('mousedown', this.boundBringToFront);
      this.removeEventListener('panel-close-request', this.boundClose);
      if (this.closeButton) {
        this.closeButton.removeEventListener('click', this.boundClose);
      }
      this.detachVideoPlayer();
      if (this.gridObject) {
        this.gridObject.destroy();
        this.gridObject = null;
      }
    }

    render() {
      this.shadowRoot.innerHTML = `
        <style>
          :host {
            position: absolute;
            display: block;
            min-width: 520px;
            min-height: 360px;
            background: rgba(12, 12, 12, 0.95);
            border: 1px solid rgba(255, 255, 255, 0.16);
            border-radius: 12px;
            box-shadow: 0 20px 48px rgba(0, 0, 0, 0.45);
            color: inherit;
            overflow: hidden;
            pointer-events: auto;
            z-index: var(--z-music-expanded, 3600);
          }

          .panel-chrome {
            display: flex;
            flex-direction: column;
            height: 100%;
            background: rgba(8, 8, 8, 0.92);
          }

          header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 14px;
            background: rgba(20, 20, 20, 0.95);
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            cursor: grab;
            user-select: none;
          }

          header h3 {
            margin: 0;
            font-size: 0.95rem;
            font-weight: 600;
            letter-spacing: 0.02em;
          }

          .window-actions {
            display: flex;
            align-items: center;
            gap: 6px;
          }

          button.icon-btn {
            width: 28px;
            height: 28px;
            border-radius: 6px;
            border: 1px solid rgba(255, 255, 255, 0.18);
            background: rgba(255, 255, 255, 0.08);
            color: inherit;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 0.85rem;
          }

          .panel-content {
            flex: 1;
            min-height: 0;
            display: flex;
            flex-direction: column;
            padding: 10px;
            gap: 10px;
          }

          .panel-content ::slotted(video-player) {
            width: 100%;
          }

          .panel-placeholder {
            margin: auto;
            color: rgba(255, 255, 255, 0.6);
            font-size: 0.9rem;
            text-align: center;
          }
        </style>
        <div class="panel-chrome">
          <header>
            <h3>Video Player</h3>
            <div class="window-actions">
              <button type="button" class="icon-btn" id="close-button" aria-label="Close panel" title="Close panel">✕</button>
            </div>
          </header>
          <div class="panel-content" id="panel-content">
            <slot name="player" id="player-slot"></slot>
            <div class="panel-placeholder" id="panel-placeholder">Loading video player…</div>
          </div>
        </div>
      `;

      this.panelContent = this.shadowRoot.getElementById('panel-content');
      this.playerSlot = this.shadowRoot.getElementById('player-slot');
      this.placeholder = this.shadowRoot.getElementById('panel-placeholder');
      this.closeButton = this.shadowRoot.getElementById('close-button');
      if (this.closeButton) {
        this.closeButton.addEventListener('click', this.boundClose);
      }
    }

    showPlaceholder(message) {
      if (!this.placeholder) return;
      this.placeholder.textContent = message;
      this.placeholder.hidden = false;
    }

    setPlaceholderVisible(isVisible) {
      if (!this.placeholder) return;
      this.placeholder.hidden = !isVisible;
    }

    attachVideoPlayer() {
      const player = this._playerRef || findInOpenShadowRoots('video-player');
      if (!player) {
        this.showPlaceholder('Video player component is unavailable.');
        return;
      }

      if (!this.homeParent) {
        this.homeParent = player.parentElement;
        this.homeNextSibling = player.nextSibling;
      }

      // If currently docked, restore to expanded first (panel implies popout/expanded).
      try {
        if (typeof player.restoreFromDock === 'function' && (player.isDocked || player.isTaskbarDocked)) {
          player.restoreFromDock('expanded');
        }
      } catch (err) {
        // ignore restore errors
      }

      this.videoPlayerElement = player;
      player._panelControlled = true;
      player.setAttribute('slot', 'player');
      this.appendChild(player);
      this.setPlaceholderVisible(false);

      try {
        if (typeof player.setExpandedMode === 'function') {
          player.setExpandedMode(true, true);
        }
      } catch (err) {
        // ignore
      }
    }

    detachVideoPlayer() {
      const player = this.videoPlayerElement;
      if (!player) {
        return;
      }

      player._panelControlled = false;

      const parent = this.homeParent && this.homeParent.isConnected ? this.homeParent : resolveHostParent();
      try {
        player.removeAttribute('slot');
      } catch (err) {
        // ignore
      }

      try {
        if (this.homeNextSibling && this.homeNextSibling.isConnected) {
          parent.insertBefore(player, this.homeNextSibling);
        } else {
          parent.appendChild(player);
        }
      } catch (err) {
        // ignore
      }

      const targetMode = this._targetModeOnClose || 'docked';
      try {
        if (targetMode === 'expanded' && typeof player.setExpandedMode === 'function') {
          player.setExpandedMode(true, true);
        } else if (targetMode === 'mini' && typeof player.setMiniMode === 'function') {
          player.setMiniMode(true, true);
        } else if (typeof player.setDockedMode === 'function') {
          player.setDockedMode({ pausePlayback: false, allowPlayback: true });
        }
      } catch (err) {
        // ignore
      }

      this.videoPlayerElement = null;
    }

    initializeGridObject() {
      if (this.gridObject || typeof GridObject === 'undefined') {
        return;
      }

      if (!this.style.left) {
        this.style.left = '110px';
      }
      if (!this.style.top) {
        this.style.top = '90px';
      }

      this.gridObject = new GridObject(this, {
        gridSize: 30,
        gridSnapEnabled: true,
        minWidth: 520,
        minHeight: 360,
        defaultWidth: 720,
        defaultHeight: 480,
        saveStateKey: 'panel.video-player',
        draggable: true,
        resizable: true
      });
    }

    bringToFront() {
      if (!VideoPlayerPanel._zCounter) {
        VideoPlayerPanel._zCounter = 3250;
      }
      VideoPlayerPanel._zCounter += 1;
      this.style.zIndex = String(VideoPlayerPanel._zCounter);
    }

    focusPanel() {
      this.bringToFront();
    }

    handleCloseRequest(event) {
      event?.stopPropagation?.();
      const detail = event?.detail || {};
      const targetMode = detail?.targetMode;
      if (targetMode === 'mini' || targetMode === 'expanded' || targetMode === 'docked') {
        this._targetModeOnClose = targetMode;
      } else {
        this._targetModeOnClose = 'docked';
      }
      this.remove();
    }
  }

  if (!customElements.get('video-player-panel')) {
    customElements.define('video-player-panel', VideoPlayerPanel);
  }

  window.spawnVideoPlayerPanel = spawnVideoPlayerPanel;
})();
