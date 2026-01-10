(function initColumnPanelsModule() {
    if (typeof window === 'undefined') return;
    if (window.XaviColumnPanels) return;

    const DEFAULT_COL_W = 350;

    function resolveWorkspace(explicitWorkspace = null) {
        if (explicitWorkspace && explicitWorkspace.nodeType === 1) {
            return explicitWorkspace;
        }
        return document.getElementById('xavi-workspace') || document.querySelector('xavi-multi-grid');
    }

    function getColumnWidth(explicitWorkspace = null) {
        const workspace = resolveWorkspace(explicitWorkspace);
        let w = workspace && workspace.style ? workspace.style.getPropertyValue('--xavi-col-w') : '';
        if (!w && workspace && typeof getComputedStyle === 'function') {
            try {
                w = getComputedStyle(workspace).getPropertyValue('--xavi-col-w') || '';
            } catch (e) {
                w = w || '';
            }
        }
        const parsed = parseInt(String(w || '').trim().replace('px', ''), 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_COL_W;
    }

    function getWorkspace(explicitWorkspace = null) {
        return resolveWorkspace(explicitWorkspace);
    }

    function getWorkspaceRect(explicitWorkspace = null) {
        const workspace = getWorkspace(explicitWorkspace);
        const host = workspace?.shadowRoot?.host || workspace;
        if (!host) return null;
        return host.getBoundingClientRect();
    }

    function ensureFloatingLayer(workspace) {
        const ws = getWorkspace(workspace);
        if (!ws || !ws.shadowRoot) return null;

        let layer = ws.shadowRoot.getElementById('floating-panel-layer');
        if (layer) return layer;

        try {
            layer = document.createElement('div');
            layer.id = 'floating-panel-layer';
            layer.className = 'floating-panel-layer';
            const host = ws.shadowRoot.querySelector('.xavi-multi-grid') || ws.shadowRoot;
            host.appendChild(layer);
            return layer;
        } catch (e) {
            return null;
        }
    }

    function getFloatingLayer(explicitWorkspace = null) {
        const workspace = getWorkspace(explicitWorkspace);
        return (
            (workspace && typeof workspace.getFloatingLayer === 'function' ? workspace.getFloatingLayer() : null)
            || ensureFloatingLayer(workspace)
            || null
        );
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(value, max));
    }

    function rangeIntersects(aStart, aEnd, bStart, bEnd) {
        return aStart <= bEnd && bStart <= aEnd;
    }

    class XaviColumnPanel extends HTMLElement {
        constructor() {
            super();
            this.attachShadow({ mode: 'open' });
            this.gridObject = null;
            this._rendered = false;
            this.boundBringToFront = () => this.bringToFront();
            this.boundDragEnd = (e) => this.onGridDragEnd(e);
            this.boundResizeEnd = (e) => this.onGridResizeEnd(e);
        }

        connectedCallback() {
            if (!this._rendered) {
                this.render();
                this._rendered = true;
            }

            this.addEventListener('pointerdown', this.boundBringToFront);
            this.addEventListener('grid-object-drag-end', this.boundDragEnd);
            this.addEventListener('grid-object-resize-end', this.boundResizeEnd);

            this.initializeGridObject();
            this.bringToFront();
        }

        disconnectedCallback() {
            this.removeEventListener('pointerdown', this.boundBringToFront);
            this.removeEventListener('grid-object-drag-end', this.boundDragEnd);
            this.removeEventListener('grid-object-resize-end', this.boundResizeEnd);
        }

        get panelId() {
            return this.getAttribute('panel-id') || '';
        }

        get colStart() {
            return Number(this.getAttribute('col-start') || 0) || 0;
        }

        set colStart(value) {
            this.setAttribute('col-start', String(Number(value) || 0));
        }

        get colSpan() {
            const span = Number(this.getAttribute('col-span') || 1) || 1;
            return span < 1 ? 1 : span;
        }

        set colSpan(value) {
            const span = Number(value) || 1;
            this.setAttribute('col-span', String(span < 1 ? 1 : span));
        }

        render() {
            const title = this.getAttribute('title') || 'Panel';

            this.shadowRoot.innerHTML = `
                <style>
                    :host {
                        position: absolute;
                        top: 0 !important;
                        bottom: 0 !important;
                        left: 0;
                        width: ${DEFAULT_COL_W}px;
                        height: auto !important;
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
                        height: 30px;
                        flex: 0 0 30px;
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        padding: 0 8px;
                        background: rgba(255, 255, 255, 0.06);
                        border-bottom: 1px solid rgba(255, 255, 255, 0.10);
                        cursor: move;
                        user-select: none;
                        gap: 8px;
                    }

                    .title {
                        font-size: 13px;
                        letter-spacing: 0.2px;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        flex: 1 1 auto;
                    }

                    .actions {
                        display: inline-flex;
                        gap: 6px;
                        flex: 0 0 auto;
                    }

                    button {
                        appearance: none;
                        border: 0;
                        background: rgba(255, 255, 255, 0.10);
                        color: rgba(255, 255, 255, 0.92);
                        min-width: 26px;
                        height: 22px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 14px;
                        line-height: 22px;
                        padding: 0 6px;
                    }

                    button:hover {
                        background: rgba(255, 255, 255, 0.18);
                    }

                    .body {
                        flex: 1 1 auto;
                        min-height: 0;
                        overflow: auto;
                    }

                    .body ::slotted(*) {
                        box-sizing: border-box;
                    }

                    /* Column panels are horizontal-only: no vertical resizing handles. */
                    .grid-object-resize-handle.resize-n,
                    .grid-object-resize-handle.resize-ne,
                    .grid-object-resize-handle.resize-nw,
                    .grid-object-resize-handle.resize-s,
                    .grid-object-resize-handle.resize-se,
                    .grid-object-resize-handle.resize-sw {
                        display: none !important;
                    }
                </style>

                <div class="panel" role="dialog" aria-label="${title}">
                    <div class="titlebar">
                        <div class="title">${title}</div>
                        <div class="actions">
                            <button type="button" data-action="left" title="Move left">←</button>
                            <button type="button" data-action="right" title="Move right">→</button>
                            <button type="button" data-action="shrink" title="1 column">−</button>
                            <button type="button" data-action="grow" title="Widen">+</button>
                            <button type="button" data-action="close" title="Close">×</button>
                        </div>
                    </div>
                    <div class="body"><slot></slot></div>
                </div>
            `;

            this.shadowRoot.querySelectorAll('button[data-action]').forEach((btn) => {
                btn.addEventListener('click', (e) => this.onActionClick(e));
            });
        }

        initializeGridObject() {
            if (this.gridObject || typeof GridObject === 'undefined') return;

            // Ensure initial column geometry.
            const colW = getColumnWidth();
            const left = this.colStart * colW;
            const width = this.colSpan * colW;
            this.style.left = `${left}px`;
            this.style.width = `${width}px`;

            // Dock vertically: always fill the floating layer (excludes the taskbar).
            const layerRect = (() => {
                try {
                    return getFloatingLayer()?.getBoundingClientRect?.() || null;
                } catch (e) {
                    return null;
                }
            })();
            const dockHeight = layerRect && Number.isFinite(layerRect.height) && layerRect.height > 0 ? Math.floor(layerRect.height) : 720;

            // GridObject will always call loadState() and can override our geometry.
            // Seed a versioned state key with the intended column geometry so legacy
            // saved positions (from older layouts) can't push panels off-screen.
            const saveStateKey = this.panelId ? `panel.column.v2.${this.panelId}` : null;
            if (saveStateKey && typeof window !== 'undefined' && window.localStorage) {
                try {
                    const ws = getWorkspaceRect();
                    const maxLeft = ws ? Math.max(0, Math.floor(ws.width - colW)) : null;
                    const maxWidth = ws ? Math.max(colW, Math.floor(ws.width)) : null;

                    const desired = {
                        left,
                        top: 0,
                        width,
                        height: dockHeight
                    };

                    const raw = window.localStorage.getItem(saveStateKey);
                    let state = null;
                    if (raw) {
                        try {
                            state = JSON.parse(raw);
                        } catch (e) {
                            state = null;
                        }
                    }

                    let next = state && typeof state === 'object' ? { ...state } : null;

                    const invalidNumber = (v) => !Number.isFinite(Number(v));
                    const invalidState = !next
                        || invalidNumber(next.left)
                        || invalidNumber(next.top)
                        || invalidNumber(next.width)
                        || invalidNumber(next.height);

                    if (invalidState) {
                        next = { ...desired };
                    } else {
                        next.left = Number(next.left);
                        next.top = Number(next.top);
                        next.width = Number(next.width) || desired.width;
                        next.height = Number(next.height) || desired.height;

                        // Repair obviously off-screen states from older layouts.
                        if (maxLeft !== null) {
                            next.left = clamp(next.left, 0, maxLeft);
                        }
                        if (maxWidth !== null) {
                            next.width = clamp(next.width, colW, maxWidth);
                        }
                        // If the repaired state would still land in column 0 when we
                        // intended another column, prefer the current desired column.
                        if (Math.abs(next.left - desired.left) > (colW * 2)) {
                            next.left = desired.left;
                        }
                    }

                    window.localStorage.setItem(saveStateKey, JSON.stringify(next));
                } catch (e) {
                    // ignore
                }
            }

            this.gridObject = new GridObject(this, {
                gridSize: colW,
                gridSnapEnabled: false,
                gridSnapXEnabled: true,
                gridSnapYEnabled: false,
                minWidth: colW,
                minHeight: dockHeight,
                defaultWidth: width,
                defaultHeight: dockHeight,
                saveStateKey,
                draggable: true,
                resizable: true,
                dragAxis: 'x',
                resizeAxis: 'x'
            });
        }

        bringToFront() {
            if (window.ZIndexManager) {
                this.style.zIndex = String(window.ZIndexManager.getNextGridPanel());
            }
        }

        onGridDragEnd(e) {
            const id = this.panelId;
            if (!id || !window.XaviColumnPanels) return;
            window.XaviColumnPanels._normalizeFromElement(id, this);
        }

        onGridResizeEnd(e) {
            const id = this.panelId;
            if (!id || !window.XaviColumnPanels) return;
            window.XaviColumnPanels._normalizeFromElement(id, this);
        }

        onActionClick(e) {
            e?.stopPropagation?.();
            const action = e?.currentTarget?.getAttribute('data-action') || '';
            const id = this.panelId;
            if (!id) return;

            if (action === 'close') {
                this.hidden = true;
                this.style.display = 'none';
                this.dispatchEvent(new CustomEvent('panel-closed', { bubbles: true, composed: true, detail: { panelId: id } }));
                return;
            }

            const colW = getColumnWidth();
            const rect = getWorkspaceRect();
            const colsMax = rect ? Math.max(1, Math.floor(rect.width / colW)) : 12;

            if (action === 'left') {
                window.XaviColumnPanels?.movePanel(id, -1);
                return;
            }
            if (action === 'right') {
                window.XaviColumnPanels?.movePanel(id, +1);
                return;
            }
            if (action === 'grow') {
                this.colSpan = clamp(this.colSpan + 1, 1, colsMax);
                window.XaviColumnPanels?._applyGeometry(id);
                return;
            }
            if (action === 'shrink') {
                this.colSpan = clamp(this.colSpan - 1, 1, colsMax);
                window.XaviColumnPanels?._applyGeometry(id);
                return;
            }
        }
    }

    if (!customElements.get('xavi-column-panel')) {
        customElements.define('xavi-column-panel', XaviColumnPanel);
    }

    const manager = {
        panels: new Map(),
        _settingsOpen: false,

        openPanel(options = {}) {
            const { id, title, buildContent = null } = options;
            if (!id) {
                console.warn('[column_panels] openPanel missing id');
                return null;
            }

            const layer = getFloatingLayer(options.workspace || null);
            if (!layer) {
                console.warn('[column_panels] Missing floating layer');
                return null;
            }

            const existing = this.panels.get(id) || null;
            if (existing && existing.element) {
                existing.element.hidden = false;
                existing.element.style.display = 'block';
                existing.element.bringToFront?.();
                return existing.element;
            }

            const colW = getColumnWidth(options.workspace || null);
            const rect = getWorkspaceRect(options.workspace || null);
            const colsMax = rect ? Math.max(1, Math.floor(rect.width / colW)) : 12;

            const defaultSpan = colsMax >= 5 ? 2 : 1;
            const requestedSpan = (options.colSpan === 0 || options.colSpan) ? Number(options.colSpan) : defaultSpan;
            const colSpan = clamp(requestedSpan || 1, 1, colsMax);

            const defaultStart = colsMax >= 5 ? 3 : 1;
            const requestedStart = (options.colStart === 0 || options.colStart) ? Number(options.colStart) : defaultStart;
            const colStart = clamp(requestedStart || 0, 0, Math.max(0, colsMax - colSpan));

            const el = document.createElement('xavi-column-panel');
            el.setAttribute('panel-id', id);
            el.setAttribute('title', title || id);
            el.setAttribute('col-start', String(colStart));
            el.setAttribute('col-span', String(colSpan));

            if (typeof buildContent === 'function') {
                try {
                    const content = buildContent();
                    if (content instanceof Node) {
                        el.appendChild(content);
                    }
                } catch (e) {
                    console.error('[column_panels] buildContent failed', e);
                }
            }

            layer.appendChild(el);
            this.panels.set(id, {
                id,
                element: el,
                colStart,
                colSpan
            });

            // Normalize once connected.
            requestAnimationFrame(() => {
                this._normalizeFromElement(id, el);
            });

            return el;
        },

        toggleSettingsSlideout() {
            const id = 'workspace-settings';
            const colW = getColumnWidth();
            const layer = getFloatingLayer();
            if (!layer) return;

            const existing = this.panels.get(id)?.element || null;
            const ensurePanel = () => {
                if (existing) return existing;
                const panel = this.openPanel({
                    id,
                    title: 'Settings',
                    colStart: 0,
                    colSpan: 1,
                    buildContent: () => {
                        const wrap = document.createElement('div');
                        wrap.style.width = '100%';
                        wrap.style.height = '100%';
                        wrap.style.display = 'flex';
                        wrap.style.flexDirection = 'column';

                        const iframe = document.createElement('iframe');
                        iframe.title = 'Settings';
                        iframe.src = '/social?embed=settings&popup=1';
                        iframe.style.border = '0';
                        iframe.style.width = '100%';
                        iframe.style.height = '100%';
                        iframe.style.background = 'transparent';
                        iframe.loading = 'lazy';
                        wrap.appendChild(iframe);
                        return wrap;
                    }
                });

                // Slide-out behavior: keep it docked to column 0.
                panel.style.top = '0px';
                panel.style.height = '100%';
                panel.style.left = '0px';
                panel.style.width = `${colW}px`;
                panel.style.transition = 'transform 180ms ease';
                panel.style.transform = 'translateX(-100%)';
                panel.style.borderLeft = '0';
                panel.style.borderTopLeftRadius = '0';
                panel.style.borderBottomLeftRadius = '0';
                return panel;
            };

            const panel = ensurePanel();
            this._settingsOpen = !this._settingsOpen;
            panel.hidden = false;
            panel.style.display = 'block';
            panel.style.transform = this._settingsOpen ? 'translateX(0)' : 'translateX(-100%)';
            panel.bringToFront?.();
        },

        movePanel(id, deltaCols) {
            const entry = this.panels.get(id);
            if (!entry || !entry.element) return;
            const el = entry.element;
            el.colStart = (Number(el.colStart) || 0) + (Number(deltaCols) || 0);
            this._applyGeometry(id);
        },

        _applyGeometry(id) {
            const entry = this.panels.get(id);
            if (!entry || !entry.element) return;

            const el = entry.element;
            const colW = getColumnWidth();
            const rect = getWorkspaceRect();
            const colsMax = rect ? Math.max(1, Math.floor(rect.width / colW)) : 12;

            const span = clamp(Number(el.colSpan) || 1, 1, colsMax);
            const start = clamp(Number(el.colStart) || 0, 0, Math.max(0, colsMax - span));

            el.colSpan = span;
            el.colStart = start;

            el.style.left = `${start * colW}px`;
            el.style.width = `${span * colW}px`;
        },

        _normalizeFromElement(id, el) {
            if (!id || !el) return;

            const colW = getColumnWidth();
            const rect = getWorkspaceRect();
            const colsMax = rect ? Math.max(1, Math.floor(rect.width / colW)) : 12;

            // Read current geometry relative to workspace.
            const ws = rect;
            if (!ws) return;
            const r = el.getBoundingClientRect();
            const left = r.left - ws.left;
            const width = r.width;

            const prev = this.panels.get(id);
            const prevStart = prev && typeof prev.colStart === 'number' ? prev.colStart : Number(el.colStart) || 0;

            const nextSpan = clamp(Math.round(width / colW) || 1, 1, colsMax);
            const nextStart = clamp(Math.round(left / colW) || 0, 0, Math.max(0, colsMax - nextSpan));

            // If we overlap another panel, swap starts with the first hit.
            const nextEnd = nextStart + nextSpan - 1;
            for (const [otherId, other] of this.panels.entries()) {
                if (otherId === id) continue;
                const otherEl = other?.element;
                if (!otherEl || otherEl.hidden || otherEl.style.display === 'none') continue;
                const otherStart = Number(otherEl.colStart) || 0;
                const otherSpan = Number(otherEl.colSpan) || 1;
                const otherEnd = otherStart + otherSpan - 1;
                if (rangeIntersects(nextStart, nextEnd, otherStart, otherEnd)) {
                    otherEl.colStart = prevStart;
                    this._applyGeometry(otherId);
                    break;
                }
            }

            el.colStart = nextStart;
            el.colSpan = nextSpan;
            this.panels.set(id, { id, element: el, colStart: nextStart, colSpan: nextSpan });
            this._applyGeometry(id);
        }
    };

    window.XaviColumnPanels = manager;

    document.addEventListener('xavi-workspace-ready', (e) => {
        // Ensure the taskbar start menu picks up the column width.
        const workspace = getWorkspace(e?.detail?.workspace || null);
        if (workspace) {
            try {
                workspace.style.setProperty('--xavi-col-w', `${getColumnWidth()}px`);
            } catch {
                // ignore
            }
        }
        window.dispatchEvent(new CustomEvent('xavi-column-panels-ready', { detail: { manager } }));
    }, { once: true });
})();
