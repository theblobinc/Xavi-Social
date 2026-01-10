(function registerTimelinePanel() {
    if (typeof window === 'undefined') {
        return;
    }

    const CSS_ID = 'xavi-social-vite-css';
    const JS_ID = 'xavi-social-vite-js';

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

            // Ensure the app mounts inside this panel before loading the bundle.
            const mountRoot = this.shadowRoot.getElementById('xavi-social-root');
            if (mountRoot) {
                window.__xaviSocialMountRoot = mountRoot;
            }

            // Force embed mode: timeline-only UI.
            window.XAVI_SOCIAL_EMBED_MODE = 'timeline';

            this.ensureViteAssets();
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

                    #xavi-social-root {
                        min-height: 100%;
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
                        <div id="xavi-social-root"></div>
                    </div>
                </div>
            `;

            const closeBtn = this.shadowRoot.querySelector('button[aria-label="Close"]');
            if (closeBtn) {
                closeBtn.addEventListener('click', (event) => this.handleCloseClick(event));
            }
        }

        ensureViteAssets() {
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

            if (!document.getElementById(JS_ID)) {
                const script = document.createElement('script');
                script.id = JS_ID;
                script.src = '/packages/xavi_social/dist/app.js' + v;
                script.defer = true;
                document.head.appendChild(script);
            }
        }

        initializeGridObject() {
            if (this.gridObject || typeof GridObject === 'undefined') {
                return;
            }

            // Ensure absolute geometry is present before GridObject captures it.
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

            // Hide (don't remove) so the Vite bundle doesn't need to be re-executed.
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

    // Default behavior: show the Timeline immediately on load, but only as a panel.
    window.addEventListener('xavi-workspace-ready', () => {
        try {
            spawnTimelinePanel();
        } catch (err) {
            console.warn('[TimelinePanel] Failed to auto-open Timeline panel:', err);
        }
    }, { once: true });

    function spawnTimelinePanel(options = {}) {
        const context = options.context || {};
        const existing = findExistingPanel(context);
        if (existing) {
            existing.hidden = false;
            existing.style.display = 'block';
            existing.bringToFront?.();
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
                buildContent: () => {
                    // Force embed mode: timeline-only UI.
                    window.XAVI_SOCIAL_EMBED_MODE = 'timeline';

                    const mount = document.createElement('div');
                    mount.id = 'xavi-social-root';
                    mount.style.minHeight = '100%';
                    window.__xaviSocialMountRoot = mount;
                    ensureViteAssets();
                    return mount;
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

    function ensureViteAssets() {
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

        if (!document.getElementById(JS_ID)) {
            const script = document.createElement('script');
            script.id = JS_ID;
            script.src = '/packages/xavi_social/dist/app.js' + v;
            script.defer = true;
            document.head.appendChild(script);
        }
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
