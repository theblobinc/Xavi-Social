(function registerMusicPlayerPanel() {
    'use strict';
    
    if (typeof window === 'undefined') {
        return;
    }

    try {
        initializePanel();
    } catch (err) {
        console.error('[MusicPlayerPanel] Initialization failed:', err);
    }

    function initializePanel() {

    class MusicPlayerPanel extends HTMLElement {
        constructor() {
            super();
            this.attachShadow({ mode: 'open' });
            this.gridObject = null;
            this.panelContent = null;
            this.playerSlot = null;
            this.placeholder = null;
            this.closeButton = null;
            this.musicPlayerElement = null;
            this.homeParent = null;
            this.homeNextSibling = null;
            this.boundClose = (event) => this.handleCloseClick(event);
            this.boundBringToFront = () => this.bringToFront();
            this.boundEmbeddedHandler = () => this.handleEmbeddedEvent();
        }

        static get observedAttributes() {
            return ['panel-id'];
        }

        attributeChangedCallback(name, _oldValue, newValue) {
            if (name === 'panel-id' && this.isConnected) {
                this.dataset.panelId = newValue || '';
            }
        }

        connectedCallback() {
            this.render();
            this.attachMusicPlayer();
            this.initializeGridObject();
            this.bringToFront();
            this.addEventListener('mousedown', this.boundBringToFront);
            this.addEventListener('panel-close-request', this.boundClose);
            document.addEventListener('music-player-embedded', this.boundEmbeddedHandler);
        }

        disconnectedCallback() {
            document.removeEventListener('music-player-embedded', this.boundEmbeddedHandler);
            this.removeEventListener('mousedown', this.boundBringToFront);
            this.removeEventListener('panel-close-request', this.boundClose);
            this.detachMusicPlayer();
            if (this.closeButton) {
                this.closeButton.removeEventListener('click', this.boundClose);
            }
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
                        min-width: 380px;
                        min-height: 260px;
                        background: rgba(12, 12, 12, 0.95);
                        border: 1px solid rgba(255, 255, 255, 0.16);
                        border-radius: 12px;
                        box-shadow: 0 20px 48px rgba(0, 0, 0, 0.45);
                        color: #fff;
                        font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
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
                        padding: 12px 18px;
                        background: linear-gradient(120deg, rgba(28, 28, 28, 0.95), rgba(10, 10, 10, 0.9));
                        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                        cursor: grab;
                        user-select: none;
                    }

                    header h3 {
                        margin: 0;
                        font-size: 0.95rem;
                        font-weight: 600;
                        letter-spacing: 0.02em;
                        display: flex;
                        align-items: center;
                        gap: 8px;
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
                        color: #fff;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        cursor: pointer;
                        font-size: 0.85rem;
                        transition: background 0.2s ease, border-color 0.2s ease;
                    }

                    button.icon-btn:hover {
                        background: rgba(255, 255, 255, 0.18);
                        border-color: rgba(74, 158, 255, 0.8);
                    }

                    button.close-btn:hover {
                        background: rgba(235, 87, 87, 0.25);
                        border-color: rgba(235, 87, 87, 0.9);
                    }

                    .panel-content {
                        flex: 1;
                        min-height: 0;
                        display: flex;
                        flex-direction: column;
                        padding: 12px;
                        gap: 12px;
                        background: rgba(5, 5, 5, 0.92);
                    }

                    .panel-content ::slotted(music-player) {
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
                        <h3>🎵 Music Player</h3>
                        <div class="window-actions">
                            <button type="button" class="icon-btn close-btn" id="close-button" aria-label="Close panel" title="Close panel">✕</button>
                        </div>
                    </header>
                    <div class="panel-content" id="panel-content">
                        <slot name="player" id="player-slot"></slot>
                        <div class="panel-placeholder" id="panel-placeholder">Loading music player…</div>
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

        attachMusicPlayer() {
            const player = document.querySelector('music-player');
            if (!player) {
                this.showPlaceholder('Music player component is unavailable.');
                return;
            }

            if (!this.homeParent) {
                this.homeParent = player.parentElement;
                this.homeNextSibling = player.nextSibling;
            }
            this.musicPlayerElement = player;
            player.setAttribute('slot', 'player');
            this.appendChild(player);
            this.setPlaceholderVisible(false);

            if (player.style) {
                player.style.removeProperty('display');
            }

            if (typeof player.setNormalMode === 'function') {
                player.setNormalMode({ skipSave: true });
            } else {
                player.removeAttribute('dock-mode');
            }
        }

        detachMusicPlayer() {
            const player = this.musicPlayerElement;
            if (!player) {
                return;
            }

            const destination = this.resolveHomeParent();
            if (destination) {
                if (this.homeNextSibling && this.homeNextSibling.parentNode === destination) {
                    destination.insertBefore(player, this.homeNextSibling);
                } else {
                    destination.appendChild(player);
                }
            }

            if (typeof player.setEmbeddedMode === 'function') {
                player.setEmbeddedMode({ skipSave: true });
            } else if (player.style) {
                player.style.display = 'none';
            }

            player.removeAttribute('slot');
            this.musicPlayerElement = null;
            this.setPlaceholderVisible(true);
        }

        resolveHomeParent() {
            if (this.homeParent?.isConnected) {
                return this.homeParent;
            }
            const workspace = document.querySelector('xavi-multi-grid');
            if (workspace) {
                return workspace;
            }
            return document.body || document.documentElement;
        }

        showPlaceholder(message) {
            if (!this.placeholder) {
                return;
            }
            this.placeholder.textContent = message;
            this.placeholder.hidden = false;
        }

        setPlaceholderVisible(isVisible) {
            if (!this.placeholder) {
                return;
            }
            this.placeholder.hidden = !isVisible;
        }

        initializeGridObject() {
            if (this.gridObject || typeof GridObject === 'undefined') {
                return;
            }

            if (!this.style.left) {
                this.style.left = '90px';
            }
            if (!this.style.top) {
                this.style.top = '90px';
            }

            this.gridObject = new GridObject(this, {
                gridSize: 30,
                gridSnapEnabled: true,
                minWidth: 400,
                minHeight: 260,
                defaultWidth: 520,
                defaultHeight: 320,
                saveStateKey: 'panel.music-player',
                draggable: true,
                resizable: true
            });
        }

        bringToFront() {
            if (!MusicPlayerPanel._zCounter) {
                MusicPlayerPanel._zCounter = 3200;
            }
            MusicPlayerPanel._zCounter += 1;
            this.style.zIndex = String(MusicPlayerPanel._zCounter);
            this.dispatchEvent(new CustomEvent('floating-panel-focus', {
                bubbles: true,
                composed: true,
                detail: {
                    panelId: this.getAttribute('panel-id') || 'music-player',
                    panelElement: this
                }
            }));
        }

        focusPanel() {
            this.bringToFront();
        }

        handleCloseClick(event) {
            event?.stopPropagation?.();
            this.dispatchEvent(new CustomEvent('panel-closed', {
                bubbles: true,
                composed: true,
                detail: { panelId: this.getAttribute('panel-id') || 'music-player' }
            }));
            this.remove();
        }

        handleEmbeddedEvent() {
            if (this.isConnected) {
                this.dispatchEvent(new CustomEvent('panel-closed', {
                    bubbles: true,
                    composed: true,
                    detail: { panelId: this.getAttribute('panel-id') || 'music-player', reason: 'embedded' }
                }));
                this.remove();
            }
        }
    }

    if (!customElements.get('music-player-panel')) {
        customElements.define('music-player-panel', MusicPlayerPanel);
    }

    const entryConfig = {
        id: 'music-player',
        label: 'Music Player',
        icon: '🎵',
        category: 'Music',
        priority: 56,
        requiresAdmin: false,
        maxInstances: 1,
        launch: (context = {}) => spawnMusicPlayerPanel({ context })
    };

    queuePanelRegistration(() => entryConfig);
    window.spawnMusicPlayerPanel = spawnMusicPlayerPanel;

    function spawnMusicPlayerPanel(options = {}) {
        const context = options.context || {};
        const existing = findExistingPanel(context);
        if (existing) {
            existing.focusPanel?.();
            return existing;
        }

        const workspace = getWorkspace(context);
        const host = getFloatingHost(context, workspace);
        if (!host) {
            console.warn('[MusicPlayerPanel] Unable to resolve host element.');
            return null;
        }

        const panel = document.createElement('music-player-panel');
        panel.setAttribute('panel-id', entryConfig.id);
        if (workspace && typeof workspace.attachFloatingPanel === 'function') {
            workspace.attachFloatingPanel(panel);
        } else {
            host.appendChild(panel);
        }
        panel.focusPanel?.();
        return panel;
    }

    function findExistingPanel(context = {}) {
        const workspace = getWorkspace(context);
        const roots = [];
        if (workspace) {
            if (workspace.shadowRoot) {
                roots.push(workspace.shadowRoot);
            }
            if (typeof workspace.getFloatingLayer === 'function') {
                const layer = workspace.getFloatingLayer();
                if (layer) {
                    roots.push(layer);
                }
            }
            roots.push(workspace);
        }
        roots.push(document);

        for (const root of roots) {
            if (root && typeof root.querySelector === 'function') {
                const match = root.querySelector('music-player-panel');
                if (match) {
                    return match;
                }
            }
        }
        return null;
    }

    function getWorkspace(context = {}) {
        if (context.workspace) {
            return context.workspace;
        }
        return document.querySelector('xavi-multi-grid');
    }

    function getFloatingHost(context = {}, workspace = null) {
        if (context.hostElement) {
            return context.hostElement;
        }
        const resolvedWorkspace = workspace || getWorkspace(context);
        if (resolvedWorkspace) {
            if (typeof resolvedWorkspace.getFloatingLayer === 'function') {
                const layer = resolvedWorkspace.getFloatingLayer();
                if (layer) {
                    return layer;
                }
            }
            if (resolvedWorkspace.shadowRoot) {
                return resolvedWorkspace.shadowRoot;
            }
            return resolvedWorkspace;
        }
        return document.body || document.documentElement;
    }

    function queuePanelRegistration(factory) {
        const tryRegister = () => {
            if (typeof window.registerTaskbarPanel !== 'function') {
                return false;
            }
            try {
                window.registerTaskbarPanel(factory());
            } catch (err) {
                console.warn('[MusicPlayerPanel] Failed to register panel entry:', err);
            }
            return true;
        };

        if (tryRegister()) {
            return;
        }

        window.addEventListener('xavi-panel-registry-ready', () => {
            tryRegister();
        }, { once: true });
    }
    }
})();
