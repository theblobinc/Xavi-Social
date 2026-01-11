(function registerTimelinePanel() {
    if (typeof window === 'undefined') {
        return;
    }

    class XaviTimelinePanel extends HTMLElement {
        constructor() {
            super();
            this.attachShadow({ mode: 'open' });
            this.gridObject = null;
            this._rendered = false;
            this._zCounter = 5200;
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
        }

        render() {
            const panelId = this.getAttribute('panel-id') || 'social-timeline';
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
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }

                    .actions {
                        display: flex;
                        gap: 6px;
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

                    button:hover {
                        background: rgba(255, 255, 255, 0.16);
                    }

                    .body {
                        flex: 1 1 auto;
                        min-height: 0;
                        overflow: auto;
                    }

                    xavi-social-stream {
                        display: block;
                        height: 100%;
                    }
                </style>

                <div class="panel" role="dialog" aria-label="Timeline" data-panel-id="${panelId}">
                    <div class="titlebar" part="handle">
                        <div class="title">Timeline</div>
                        <div class="actions">
                            <button type="button" aria-label="Close">×</button>
                        </div>
                    </div>
                    <div class="body">
                        <xavi-social-stream stream="pds"></xavi-social-stream>
                    </div>
                </div>
            `;

            const closeBtn = this.shadowRoot.querySelector('button[aria-label="Close"]');
            if (closeBtn) {
                closeBtn.addEventListener('click', (event) => this.handleCloseClick(event));
            }
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
                gridSize: 1,
                gridSnapEnabled: false,
                minWidth: 520,
                minHeight: 360,
                defaultWidth: 980,
                defaultHeight: 720,
                saveStateKey: 'panel.social-timeline',
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

            const panelId = this.getAttribute('panel-id') || 'social-timeline';
            this.dispatchEvent(new CustomEvent('floating-panel-focus', {
                bubbles: true,
                composed: true,
                detail: {
                    panelId,
                    panelElement: this
                }
            }));
        }

        focusPanel() {
            this.hidden = false;
            this.style.display = 'block';
            this.bringToFront();
        }

        handleCloseClick(event) {
            event?.stopPropagation?.();
            const panelId = this.getAttribute('panel-id') || 'social-timeline';

            this.hidden = true;
            this.style.display = 'none';

            this.dispatchEvent(new CustomEvent('panel-closed', {
                bubbles: true,
                composed: true,
                detail: { panelId }
            }));
        }
    }

    if (!customElements.get('xavi-timeline-panel')) {
        customElements.define('xavi-timeline-panel', XaviTimelinePanel);
    }

    const entryConfig = {
        id: 'social-timeline',
        label: 'Timeline',
        icon: '📰',
        category: 'Social',
        priority: 18,
        requiresAdmin: false,
        maxInstances: 1,
        launch: (context = {}) => spawnTimelinePanel({ context })
    };

    queuePanelRegistration(() => entryConfig);
    window.spawnTimelinePanel = spawnTimelinePanel;

    // Default behavior: show the Timeline immediately on load.
    window.addEventListener('xavi-workspace-ready', () => {
        const attempt = () => {
            try {
                const el = spawnTimelinePanel();
                if (!el) return;

                const track = () => {
                    const tb = window.__panelTaskbar;
                    if (tb && typeof tb.trackPanelInstance === 'function') {
                        tb.trackPanelInstance(entryConfig.id, el, entryConfig);
                        return true;
                    }
                    return false;
                };

                if (track()) return;
                window.addEventListener('panel-taskbar-ready', () => track(), { once: true });
            } catch (err) {
                console.warn('[TimelinePanel] Failed to auto-open Timeline panel:', err);
            }
        };

        if (window.XaviColumnPanels && typeof window.XaviColumnPanels.openPanel === 'function') {
            attempt();
            return;
        }

        window.addEventListener('xavi-column-panels-ready', () => attempt(), { once: true });
    }, { once: true });

    function spawnTimelinePanel(options = {}) {
        const context = options.context || {};

        const existing = findExistingPanel(context);
        if (existing) {
            existing.hidden = false;
            existing.style.display = 'block';
            existing.bringToFront?.();
            existing.focusPanel?.();
            return existing;
        }

        // Prefer the column panel scaffold when available.
        if (window.XaviColumnPanels && typeof window.XaviColumnPanels.openPanel === 'function') {
            return window.XaviColumnPanels.openPanel({
                workspace: context.workspace || null,
                id: entryConfig.id,
                title: 'Timeline',
                colStart: 1,
                colSpan: 2,
                // This module registers its own taskbar entry; avoid duplicates.
                registerInTaskbar: false,
                buildContent: () => {
                    const el = document.createElement('xavi-social-stream');
                    el.setAttribute('stream', 'pds');
                    el.style.height = '100%';
                    return el;
                }
            });
        }

        // Fallback: old floating panel.
        const workspace = getWorkspace(context);
        const host = getFloatingHost(context, workspace);
        if (!host) {
            console.warn('[TimelinePanel] Unable to resolve host element.');
            return null;
        }

        const panel = document.createElement('xavi-timeline-panel');
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
                const columnMatch = root.querySelector('xavi-column-panel[panel-id="social-timeline"]');
                if (columnMatch) return columnMatch;
                const legacy = root.querySelector('xavi-timeline-panel');
                if (legacy) return legacy;
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
                console.warn('[TimelinePanel] Failed to register panel entry:', err);
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
})();
