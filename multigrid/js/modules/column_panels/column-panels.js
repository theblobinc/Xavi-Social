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

    function getColsMax(explicitWorkspace = null) {
        const colW = getColumnWidth(explicitWorkspace);
        const rect = getWorkspaceRect(explicitWorkspace);
        return rect ? Math.max(1, Math.floor(rect.width / colW)) : 12;
    }

    function getResponsiveDefaultSpan(colsMax) {
        // Responsive breakpoint based on 350px columns:
        // If the workspace can display 4+ columns, default to 2-column panels.
        // Otherwise, default to 1 to avoid unavoidable overlaps.
        return colsMax >= 4 ? 2 : 1;
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
            // Manual resize implies the user is overriding responsive spans.
            this.setAttribute('responsive', 'false');
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
                this.setAttribute('responsive', 'false');
                this.colSpan = clamp(this.colSpan + 1, 1, colsMax);
                window.XaviColumnPanels?._applyGeometry(id);
                return;
            }
            if (action === 'shrink') {
                this.setAttribute('responsive', 'false');
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
        _managerPanelId: 'column-panels-manager',
        _workspace: null,
        _resizeObserver: null,
        _resizeRaf: 0,

        _dispatchPanelsChanged() {
            try {
                window.dispatchEvent(new CustomEvent('xavi-column-panels-changed'));
            } catch {
                // ignore
            }
        },

        _scheduleLayout() {
            if (this._resizeRaf) return;
            this._resizeRaf = window.requestAnimationFrame(() => {
                this._resizeRaf = 0;
                this._applyResponsiveLayout();
            });
        },

        _bindWorkspace(workspace) {
            this._workspace = workspace || null;

            if (this._resizeObserver) {
                try { this._resizeObserver.disconnect(); } catch { /* ignore */ }
                this._resizeObserver = null;
            }

            const ws = workspace || null;
            const host = ws?.shadowRoot?.host || ws;
            if (typeof ResizeObserver === 'function' && host) {
                this._resizeObserver = new ResizeObserver(() => this._scheduleLayout());
                try { this._resizeObserver.observe(host); } catch { /* ignore */ }
            } else {
                window.addEventListener('resize', () => this._scheduleLayout());
            }
        },

        _getVisiblePanelsSnapshot(excludeId = null) {
            const out = [];
            for (const [id, entry] of this.panels.entries()) {
                if (excludeId && id === excludeId) continue;
                const el = entry?.element;
                if (!el || el.hidden || el.style.display === 'none') continue;

                // Prefer real on-screen geometry so placement works even if a panel's
                // saved GridObject state doesn't match its current col-span attribute.
                let start = Number(el.colStart) || 0;
                let span = Math.max(1, Number(el.colSpan) || 1);
                let end = start + span - 1;

                try {
                    const wsRef = this._workspace || entry?.openOptions?.workspace || null;
                    const colW = getColumnWidth(wsRef);
                    const ws = getWorkspaceRect(wsRef);
                    if (ws && Number.isFinite(ws.width) && ws.width > 0 && Number.isFinite(colW) && colW > 0) {
                        const colsMax = Math.max(1, Math.floor(ws.width / colW));
                        const r = el.getBoundingClientRect();
                        const leftRel = r.left - ws.left;
                        const rightRel = leftRel + r.width;

                        const measuredStart = clamp(Math.floor(leftRel / colW), 0, Math.max(0, colsMax - 1));
                        const measuredEnd = clamp(Math.ceil(rightRel / colW) - 1, measuredStart, Math.max(0, colsMax - 1));
                        const measuredSpan = Math.max(1, measuredEnd - measuredStart + 1);

                        start = measuredStart;
                        end = measuredEnd;
                        span = measuredSpan;

                        // Keep attributes/state in sync with the actual geometry.
                        if ((Number(el.colStart) || 0) !== measuredStart || (Number(el.colSpan) || 1) !== measuredSpan) {
                            el.colStart = measuredStart;
                            el.colSpan = measuredSpan;
                            const prev = this.panels.get(id);
                            if (prev) {
                                this.panels.set(id, { ...prev, colStart: measuredStart, colSpan: measuredSpan });
                            }
                        }
                    }
                } catch {
                    // ignore
                }

                out.push({ id, el, start, span, end });
            }
            return out;
        },

        _findFirstFitStart(occupied, span, colsMax) {
            const maxStart = Math.max(0, colsMax - span);
            for (let start = 0; start <= maxStart; start += 1) {
                const end = start + span - 1;
                let ok = true;
                for (let i = 0; i < occupied.length; i += 1) {
                    const o = occupied[i];
                    if (rangeIntersects(start, end, o.start, o.end)) {
                        ok = false;
                        break;
                    }
                }
                if (ok) return start;
            }
            return null;
        },

        _applyResponsiveLayout() {
            const workspace = this._workspace || null;
            const colW = getColumnWidth(workspace);
            const rect = getWorkspaceRect(workspace);
            if (!rect) return;

            const colsMax = Math.max(1, Math.floor(rect.width / colW));
            const defaultSpan = getResponsiveDefaultSpan(colsMax);

            // Reflow visible panels left-to-right to avoid overlap, and shrink spans
            // automatically when the workspace becomes too narrow.
            const visible = this._getVisiblePanelsSnapshot();
            const occupied = [];

            // Preserve insertion order (Map order) for stability.
            for (const [id, entry] of this.panels.entries()) {
                const el = entry?.element;
                if (!el || el.hidden || el.style.display === 'none') continue;

                const responsive = el.getAttribute('responsive') !== 'false';
                const currentSpan = clamp(Number(el.colSpan) || 1, 1, colsMax);
                // Responsive panels always track the current breakpoint (e.g. 2 columns when wide enough,
                // 1 column when narrow). Manual resizing disables responsiveness.
                let span = responsive ? clamp(defaultSpan, 1, colsMax) : currentSpan;

                let fitStart = this._findFirstFitStart(occupied, span, colsMax);
                if (fitStart === null && span > 1) {
                    // If a 2-col panel can't fit, fall back to 1-col placement.
                    span = 1;
                    fitStart = this._findFirstFitStart(occupied, span, colsMax);
                }

                const start = fitStart === null
                    ? clamp(Number(el.colStart) || 0, 0, Math.max(0, colsMax - span))
                    : fitStart;

                el.colSpan = span;
                el.colStart = start;
                occupied.push({ start, end: start + span - 1 });
                this.panels.set(id, { ...entry, colStart: start, colSpan: span });
                this._applyGeometry(id);
            }
        },

        reorderPanels(panelIds = []) {
            const order = Array.isArray(panelIds) ? panelIds.filter(Boolean) : [];
            if (!order.length) return;

            // Keep the manager panel pinned (if present), then apply user order to the rest.
            const next = new Map();
            if (this.panels.has(this._managerPanelId)) {
                next.set(this._managerPanelId, this.panels.get(this._managerPanelId));
            }

            for (const id of order) {
                if (id === this._managerPanelId) continue;
                const entry = this.panels.get(id);
                if (entry) next.set(id, entry);
            }

            for (const [id, entry] of this.panels.entries()) {
                if (next.has(id)) continue;
                next.set(id, entry);
            }

            this.panels = next;
            this._scheduleLayout();
            this._dispatchPanelsChanged();
        },

        openPanelsManager(options = {}) {
            const id = this._managerPanelId;
            const title = options.title || 'Panels';

            const buildContent = () => {
                const root = document.createElement('div');
                root.style.height = '100%';
                root.style.display = 'flex';
                root.style.flexDirection = 'column';
                root.style.padding = '10px';
                root.style.gap = '10px';

                const header = document.createElement('div');
                header.style.display = 'flex';
                header.style.alignItems = 'center';
                header.style.justifyContent = 'space-between';
                header.style.gap = '8px';

                const h = document.createElement('div');
                h.textContent = 'Workspace Panels';
                h.style.fontWeight = '600';
                h.style.fontSize = '13px';
                header.appendChild(h);

                const refreshBtn = document.createElement('button');
                refreshBtn.textContent = 'Refresh';
                refreshBtn.style.cursor = 'pointer';
                refreshBtn.style.border = '0';
                refreshBtn.style.borderRadius = '6px';
                refreshBtn.style.padding = '6px 10px';
                refreshBtn.style.background = 'rgba(255,255,255,0.10)';
                refreshBtn.style.color = 'rgba(255,255,255,0.92)';
                header.appendChild(refreshBtn);

                const list = document.createElement('div');
                list.style.display = 'flex';
                list.style.flexDirection = 'column';
                list.style.gap = '6px';
                list.style.overflow = 'auto';
                list.style.minHeight = '0';

                const render = () => {
                    list.innerHTML = '';

                    for (const [pid, entry] of this.panels.entries()) {
                        if (pid === id) continue;
                        const el = entry?.element || null;
                        if (!el) continue;

                        const row = document.createElement('div');
                        row.setAttribute('data-panel-id', pid);
                        row.style.display = 'flex';
                        row.style.alignItems = 'center';
                        row.style.justifyContent = 'space-between';
                        row.style.gap = '8px';
                        row.style.padding = '8px';
                        row.style.border = '1px solid rgba(255,255,255,0.10)';
                        row.style.borderRadius = '8px';
                        row.style.background = 'rgba(255,255,255,0.06)';

                        const left = document.createElement('div');
                        left.style.display = 'flex';
                        left.style.alignItems = 'center';
                        left.style.gap = '8px';
                        left.style.minWidth = '0';

                        const drag = document.createElement('span');
                        drag.textContent = '⋮⋮';
                        drag.title = 'Drag to reorder';
                        drag.style.cursor = 'grab';
                        drag.style.userSelect = 'none';
                        drag.style.opacity = '0.85';
                        drag.className = 'drag-handle';
                        left.appendChild(drag);

                        const label = document.createElement('div');
                        label.textContent = el.getAttribute('title') || pid;
                        label.style.whiteSpace = 'nowrap';
                        label.style.overflow = 'hidden';
                        label.style.textOverflow = 'ellipsis';
                        label.style.fontSize = '13px';
                        left.appendChild(label);

                        const right = document.createElement('div');
                        right.style.display = 'inline-flex';
                        right.style.gap = '6px';

                        const showHide = document.createElement('button');
                        const isHidden = el.hidden || el.style.display === 'none';
                        showHide.textContent = isHidden ? 'Show' : 'Hide';
                        showHide.style.cursor = 'pointer';
                        showHide.style.border = '0';
                        showHide.style.borderRadius = '6px';
                        showHide.style.padding = '6px 10px';
                        showHide.style.background = 'rgba(255,255,255,0.10)';
                        showHide.style.color = 'rgba(255,255,255,0.92)';
                        showHide.addEventListener('click', () => {
                            if (el.hidden || el.style.display === 'none') {
                                el.hidden = false;
                                el.style.display = 'block';
                                el.bringToFront?.();
                            } else {
                                el.hidden = true;
                                el.style.display = 'none';
                            }
                            this._scheduleLayout();
                            this._dispatchPanelsChanged();
                        });
                        right.appendChild(showHide);

                        const focus = document.createElement('button');
                        focus.textContent = 'Focus';
                        focus.style.cursor = 'pointer';
                        focus.style.border = '0';
                        focus.style.borderRadius = '6px';
                        focus.style.padding = '6px 10px';
                        focus.style.background = 'rgba(255,255,255,0.10)';
                        focus.style.color = 'rgba(255,255,255,0.92)';
                        focus.addEventListener('click', () => {
                            el.hidden = false;
                            el.style.display = 'block';
                            el.bringToFront?.();
                        });
                        right.appendChild(focus);

                        const close = document.createElement('button');
                        close.textContent = '×';
                        close.title = 'Close';
                        close.style.cursor = 'pointer';
                        close.style.border = '0';
                        close.style.borderRadius = '6px';
                        close.style.padding = '6px 10px';
                        close.style.background = 'rgba(255,255,255,0.12)';
                        close.style.color = 'rgba(255,255,255,0.92)';
                        close.addEventListener('click', () => {
                            el.hidden = true;
                            el.style.display = 'none';
                            this._scheduleLayout();
                            this._dispatchPanelsChanged();
                        });
                        right.appendChild(close);

                        row.appendChild(left);
                        row.appendChild(right);
                        list.appendChild(row);
                    }

                    // Initialize Sortable (MIT) if present.
                    if (window.Sortable && typeof window.Sortable.create === 'function') {
                        try {
                            window.Sortable.create(list, {
                                animation: 150,
                                handle: '.drag-handle',
                                ghostClass: 'sortable-ghost',
                                onEnd: () => {
                                    const ids = Array.from(list.querySelectorAll('[data-panel-id]'))
                                        .map((n) => n.getAttribute('data-panel-id'))
                                        .filter(Boolean);
                                    this.reorderPanels(ids);
                                }
                            });
                        } catch {
                            // ignore
                        }
                    }
                };

                refreshBtn.addEventListener('click', () => render());
                window.addEventListener('xavi-column-panels-changed', () => render());

                root.appendChild(header);
                root.appendChild(list);
                requestAnimationFrame(() => render());
                return root;
            };

            return this.openPanel({
                ...options,
                id,
                title,
                category: options.category || 'Workspace',
                priority: Number.isFinite(options.priority) ? options.priority : 30,
                icon: options.icon || '🧩',
                responsive: true,
                buildContent
            });
        },

        _registerTaskbarEntry(id, title, options = {}) {
            if (!id) return;
            if (options.registerInTaskbar === false) return;

            const taskbarId = `column-panel:${id}`;
            if (this._taskbarRegistered?.has(taskbarId)) return;
            if (!this._taskbarRegistered) this._taskbarRegistered = new Set();

            const icon = options.icon || '🪟';
            const category = options.category || 'Workspace';
            const priority = Number.isFinite(options.priority) ? options.priority : 50;

            const launch = (context = {}) => {
                const existing = this.panels.get(id)?.element || null;
                if (existing) {
                    existing.hidden = false;
                    existing.style.display = 'block';
                    existing.bringToFront?.();
                    return existing;
                }
                return this.openPanel({ ...options, id, title });
            };

            const register = () => {
                if (typeof window.registerTaskbarPanel !== 'function') return false;
                try {
                    window.registerTaskbarPanel({
                        id: taskbarId,
                        label: title || id,
                        icon,
                        category,
                        priority,
                        requiresAdmin: false,
                        maxInstances: 1,
                        launch
                    });
                    this._taskbarRegistered.add(taskbarId);
                    return true;
                } catch {
                    return false;
                }
            };

            if (register()) return;
            window.addEventListener('xavi-panel-registry-ready', () => register(), { once: true });
        },

        _registerPanelsManagerTaskbarEntry() {
            const id = this._managerPanelId;
            const taskbarId = `column-panel:${id}`;
            if (this._taskbarRegistered?.has(taskbarId)) return;
            if (!this._taskbarRegistered) this._taskbarRegistered = new Set();

            const register = () => {
                if (typeof window.registerTaskbarPanel !== 'function') return false;
                try {
                    window.registerTaskbarPanel({
                        id: taskbarId,
                        label: 'Panels',
                        icon: '🧩',
                        category: 'Workspace',
                        priority: 29,
                        requiresAdmin: false,
                        maxInstances: 1,
                        launch: () => this.openPanelsManager()
                    });
                    this._taskbarRegistered.add(taskbarId);
                    return true;
                } catch {
                    return false;
                }
            };

            if (register()) return;
            window.addEventListener('xavi-panel-registry-ready', () => register(), { once: true });
        },

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

            const workspace = options.workspace || null;
            const colsMax = getColsMax(workspace);
            const responsive = options.responsive !== false;

            const defaultSpan = responsive ? getResponsiveDefaultSpan(colsMax) : 1;
            const requestedSpan = (options.colSpan === 0 || options.colSpan) ? Number(options.colSpan) : defaultSpan;
            let colSpan = clamp(requestedSpan || 1, 1, colsMax);

            let colStart = null;
            const hasRequestedStart = (options.colStart === 0 || options.colStart);
            if (hasRequestedStart) {
                const requestedStart = Number(options.colStart) || 0;
                colStart = clamp(requestedStart, 0, Math.max(0, colsMax - colSpan));
            } else {
                const occupied = this._getVisiblePanelsSnapshot(id).map((p) => ({ start: p.start, end: p.end }));
                let fit = this._findFirstFitStart(occupied, colSpan, colsMax);
                if (fit === null && colSpan > 1) {
                    // If a 2-col panel can't fit, fall back to 1-col placement.
                    colSpan = 1;
                    fit = this._findFirstFitStart(occupied, colSpan, colsMax);
                }
                colStart = fit === null ? 0 : fit;
            }

            const el = document.createElement('xavi-column-panel');
            el.setAttribute('panel-id', id);
            el.setAttribute('title', title || id);
            el.setAttribute('col-start', String(colStart));
            el.setAttribute('col-span', String(colSpan));
            el.setAttribute('responsive', responsive ? 'true' : 'false');

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
                colSpan,
                openOptions: options
            });

            this._dispatchPanelsChanged();

            // Allow the taskbar to re-open/show this panel later.
            this._registerTaskbarEntry(id, title || id, options);

            el.addEventListener('panel-closed', () => {
                // Keep the entry so it can be re-opened; just reflow remaining panels.
                this._scheduleLayout();
                this._dispatchPanelsChanged();
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
                    responsive: false,
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
    manager._registerPanelsManagerTaskbarEntry();

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

        // Bind resize handling for responsive panel layout.
        manager._bindWorkspace(workspace);
        manager._scheduleLayout();

        window.dispatchEvent(new CustomEvent('xavi-column-panels-ready', { detail: { manager } }));
    }, { once: true });
})();
