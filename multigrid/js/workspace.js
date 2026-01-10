class XaviMultiGridWorkspace extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.modules = new Map();
        this.loadedModules = new Set();
        this.moduleRegistry = new Map();
        this.floatingLayer = null;
        this.boundModuleRegister = (event) => this.onModuleRegister(event);
        this.workspaceReadyEvent = null;
        this._tabPanelGuardObserver = null;
    }

    shouldInstallTabPanelGuard() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            const flag = String(params.get('debugTabPanel') || params.get('tabPanelGuard') || '').trim().toLowerCase();
            if (flag === '1' || flag === 'true' || flag === 'yes' || flag === 'on') {
                return true;
            }
        } catch (e) {
            // ignore
        }

        try {
            const stored = String(window.localStorage?.getItem?.('xavi.debug.tabPanelGuard') || '').trim().toLowerCase();
            return stored === '1' || stored === 'true' || stored === 'yes' || stored === 'on';
        } catch (e) {
            return false;
        }
    }

    installTabPanelGuard() {
        if (!this.contentArea || typeof MutationObserver === 'undefined') {
            return;
        }
        if (!this.shouldInstallTabPanelGuard()) {
            return;
        }
        if (this._tabPanelGuardObserver) {
            return;
        }

        const report = (panelEl) => {
            try {
                const stack = new Error('[xavi_social] Unexpected .tab-panel detected').stack;
                console.error('[Workspace] Unexpected .tab-panel detected (should never render):', panelEl, stack);
            } catch (e) {
                console.error('[Workspace] Unexpected .tab-panel detected (should never render):', panelEl);
            }

            // Optional hard-guard: remove it immediately so it can’t regress the UX.
            try {
                panelEl?.remove?.();
            } catch (e) {
                // ignore
            }
        };

        // Initial scan.
        try {
            const existing = this.contentArea.querySelectorAll('.tab-panel');
            existing.forEach((el) => report(el));
        } catch (e) {
            // ignore
        }

        this._tabPanelGuardObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                const nodes = mutation.addedNodes || [];
                for (const node of nodes) {
                    if (!node || node.nodeType !== 1) continue;
                    const el = node;
                    try {
                        if (el.classList?.contains?.('tab-panel')) {
                            report(el);
                        }
                        const nested = el.querySelectorAll?.('.tab-panel');
                        if (nested && nested.length) {
                            nested.forEach((p) => report(p));
                        }
                    } catch (e) {
                        // ignore
                    }
                }
            }
        });

        try {
            this._tabPanelGuardObserver.observe(this.contentArea, { childList: true, subtree: true });
            console.warn('[Workspace] Tab-panel guard enabled (debug): will log/remove any .tab-panel injections.');
        } catch (e) {
            // ignore
        }
    }

    async loadModules() {
        try {
            // Use module configs provided by PHP backend
            const moduleConfigs = new Map();
            
            if (window.XAVI_MODULE_CONFIGS) {
                for (const [moduleName, config] of Object.entries(window.XAVI_MODULE_CONFIGS)) {
                    moduleConfigs.set(moduleName, config);
                }
            } else {
                console.error('[Workspace] No module configurations found. XAVI_MODULE_CONFIGS not defined.');
                return;
            }

            console.log('[Workspace] Found modules:', Array.from(moduleConfigs.keys()));

            // Sort modules by dependencies (topological sort)
            const sorted = this.resolveDependencies(moduleConfigs);
            
            console.log('[Workspace] Load order:', sorted);
            
            // Load modules in dependency order
            for (const moduleName of sorted) {
                try {
                    await this.loadModule(moduleName, moduleConfigs.get(moduleName));
                } catch (err) {
                    console.error(`[Workspace] Module '${moduleName}' failed to load:`, err);
                    // Continue loading other modules
                }
            }

            console.log('[Workspace] All modules loaded:', Array.from(this.loadedModules));
        } catch (err) {
            console.error('[Workspace] Module loading failed:', err);
        }
    }

    resolveDependencies(moduleConfigs) {
        const sorted = [];
        const visited = new Set();
        const visiting = new Set();

        const visit = (name) => {
            if (visited.has(name)) return;
            if (visiting.has(name)) {
                throw new Error(`Circular dependency detected: ${name}`);
            }

            visiting.add(name);
            const config = moduleConfigs.get(name);
            if (config && config.dependencies) {
                for (const dep of config.dependencies) {
                    if (moduleConfigs.has(dep)) {
                        visit(dep);
                    }
                }
            }
            visiting.delete(name);
            visited.add(name);
            sorted.push(name);
        };

        for (const name of moduleConfigs.keys()) {
            visit(name);
        }

        return sorted;
    }

    async loadModule(name, config) {
        if (this.loadedModules.has(name)) {
            return;
        }

        console.log(`[Workspace] Loading module: ${name}`);
        this.moduleRegistry.set(name, config);

        try {
            // Load all scripts for this module
            for (const scriptFile of config.scripts || []) {
                await this.loadScript(`${config.path}/${scriptFile}`);
            }

            this.loadedModules.add(name);
            console.log(`[Workspace] Module loaded: ${name}`);
        } catch (err) {
            console.error(`[Workspace] Failed to load module '${name}':`, err);
            // Don't rethrow - allow other modules to continue loading
        }
    }

    loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            try {
                const v = (typeof window !== 'undefined' && window.XAVI_ASSET_VERSION) ? String(window.XAVI_ASSET_VERSION) : '';
                if (v && typeof src === 'string' && !src.includes('v=')) {
                    script.src = src + (src.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(v);
                } else {
                    script.src = src;
                }
            } catch (e) {
                script.src = src;
            }
            script.onload = () => resolve();
            script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
            document.head.appendChild(script);
        });
    }

    connectedCallback() {
        if (!this.hasAttribute('role')) {
            this.setAttribute('role', 'region');
        }
        if (!this.hasAttribute('aria-label')) {
            this.setAttribute('aria-label', 'Xavi Multi Grid Workspace');
        }
        this.dataset.workspace = 'xavi-multi-grid';

        const basePath = this.getAttribute('data-base-path');
        if (basePath) {
            this.dataset.basePath = basePath;
        }
        
        // Move all light DOM children into shadow DOM
        this.render();
        
        // Store references to key elements
        this.contentArea = this.shadowRoot.getElementById('content-area');
        this.bgLayer = this.shadowRoot.querySelector('.xavi-bg-layer');
        this.gridElement = this.shadowRoot.getElementById('workspace-grid');
        this.floatingLayer = this.shadowRoot.getElementById('floating-panel-layer');

        // Debug-only runtime guard: catch any legacy .tab-panel injections.
        this.installTabPanelGuard();
        
        // Grid configuration
        this.cellSize = 30;
        this.gridGap = 0;
        this.maxGridColumns = 200;
        this.maxGridRows = 200;
        
        // Calculate initial grid metrics
        this.calculateGridMetrics();
        
        // Observe size changes
        this.resizeObserver = new ResizeObserver(() => {
            this.calculateGridMetrics();
        });
        this.resizeObserver.observe(this);
        
        this.addEventListener('register-workspace-module', this.boundModuleRegister);
        
        // Calculate grid first, then load modules
        requestAnimationFrame(() => {
            this.calculateGridMetrics();
            this.loadModulesAndInit();
        });
    }

    loadModulesAndInit() {
        // Load modules first, then dispatch workspace ready
        this.loadModules()
            .then(() => {
                console.log('[Workspace] Module loading complete. Loaded:', Array.from(this.loadedModules));
            })
            .catch(err => {
                console.error('[Workspace] Module loading had errors:', err);
            })
            .finally(() => {
                // Always dispatch workspace ready, even if some modules failed
                this.workspaceReadyEvent = new CustomEvent('xavi-workspace-ready', {
                    bubbles: true,
                    composed: true,
                    detail: { workspace: this }
                });
                this.dispatchEvent(this.workspaceReadyEvent);
                console.log('[Workspace] Ready event dispatched');
            });
    }

    render() {
        const style = document.createElement('style');
        style.textContent = `
            :host {
                display: block;
                position: relative;
                width: 100%;
                height: 100%;
                background-color: black;
                overflow: hidden;
                box-sizing: border-box;
                --xavi-col-w: 350px;
                border-top: 2px solid rgba(255, 255, 255, 0.9);
            }

            .xavi-multi-grid {
                position: relative;
                width: 100%;
                height: 100%;
                display: flex;
                flex-direction: column;
            }

            .grid-content-area {
                position: absolute;
                top: 8px;
                left: 8px;
                right: 8px;
                bottom: var(--xavi-taskbar-h, 108px);
                display: grid;
                grid-template-columns: repeat(var(--tab-grid-columns), var(--tab-cell-size));
                grid-template-rows: repeat(var(--tab-grid-rows), var(--tab-cell-size));
                grid-auto-flow: dense;
                gap: var(--tab-grid-gap);
                z-index: 100;
                overflow: hidden;
                background-color: transparent;
                pointer-events: none;
            }

            .xavi-bg-layer {
                position: absolute;
                inset: 0;
                width: 100%;
                height: 100%;
                z-index: 0;
                pointer-events: auto;
            }

            #workspace-grid {
                position: absolute;
                inset: 0;
                width: 100%;
                height: 100%;
                z-index: 10;
                pointer-events: none;
                background-color: transparent;
                /* Column guides (no legacy 30px grid): vertical lines every 350px. */
                background-image: repeating-linear-gradient(
                    to right,
                    transparent 0,
                    transparent calc(var(--xavi-col-w) - 1px),
                    rgba(255, 255, 255, 0.22) calc(var(--xavi-col-w) - 1px),
                    rgba(255, 255, 255, 0.22) var(--xavi-col-w)
                );
                background-size: auto;
                background-position: 0 0;
                background-repeat: repeat;
            }

            .floating-panel-layer {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: var(--xavi-taskbar-h, 108px);
                pointer-events: none;
                z-index: 2000;
                overflow: hidden;
            }

            .floating-panel-layer > * {
                position: absolute;
                pointer-events: auto;
            }

            ::slotted(music-player) {
                display: none !important;
                position: relative;
                z-index: 1150;
            }

            .grid-content-area {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: var(--xavi-taskbar-h, 108px);
            }

            ::slotted(panel-taskbar) {
                position: absolute;
                bottom: 0;
                left: 0;
                right: 0;
                width: 100%;
                height: var(--xavi-taskbar-h, 108px);
                display: block;
                z-index: var(--z-taskbar-base, 10000);
                overflow: visible;
            }

            .grid-content-area ::slotted(.tab-panel),
            .tab-panel,
            .grid-content-area .tab-panel {
                pointer-events: auto;
                position: relative;
                z-index: 10;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                box-sizing: border-box;
                background: rgba(12, 12, 12, 0.96);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 10px;
                backdrop-filter: blur(10px);
            }

            .panel-handle {
                height: 22px;
                flex: 0 0 22px;
                cursor: move;
                background: rgba(255, 255, 255, 0.06);
                border-bottom: 1px solid rgba(255, 255, 255, 0.10);
            }

            .panel-body {
                flex: 1 1 auto;
                min-height: 0;
                overflow: auto;
            }

            /* Floating overlays are attached into #floating-panel-layer by their modules. */
        `;

        const container = document.createElement('div');
        container.className = 'xavi-multi-grid';
        
        const contentArea = document.createElement('div');
        contentArea.className = 'grid-content-area';
        contentArea.id = 'content-area';

        const bgLayer = document.createElement('div');
        bgLayer.className = 'xavi-bg-layer';

        const grid = document.createElement('div');
        grid.id = 'workspace-grid';
        bgLayer.appendChild(grid);
        contentArea.appendChild(bgLayer);
        container.appendChild(contentArea);

        const floatingLayer = document.createElement('div');
        floatingLayer.id = 'floating-panel-layer';
        floatingLayer.className = 'floating-panel-layer';
        container.appendChild(floatingLayer);

        const slot = document.createElement('slot');
        container.appendChild(slot);

        this.shadowRoot.appendChild(style);
        this.shadowRoot.appendChild(container);
    }

    disconnectedCallback() {
        this.removeEventListener('register-workspace-module', this.boundModuleRegister);
        if (this._tabPanelGuardObserver) {
            try {
                this._tabPanelGuardObserver.disconnect();
            } catch (e) {
                // ignore
            }
            this._tabPanelGuardObserver = null;
        }
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
        this.modules.clear();
    }

    calculateGridMetrics() {
        if (!this.contentArea) return;

        const rect = this.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            console.warn('[Workspace] Zero dimensions, deferring grid calculation');
            return;
        }

        // Content area positioning: top: 8px, bottom: 108px (for taskbar)
        const topOffset = 8;
        const bottomOffset = 108;
        const effectiveWidth = rect.width - 16; // 8px on each side
        const effectiveHeight = rect.height - topOffset - bottomOffset;

        const gap = this.gridGap;
        const step = this.cellSize + gap;

        if (step <= 0) return;

        // Calculate grid dimensions
        const columns = Math.floor((effectiveWidth + gap) / step);
        const rows = Math.floor((effectiveHeight + gap) / step);

        this.gridColumns = Math.max(1, Math.min(columns, this.maxGridColumns));
        this.gridRows = Math.max(1, Math.min(rows, this.maxGridRows));

        const totalHeight = this.gridRows * this.cellSize + gap * Math.max(0, this.gridRows - 1);

        console.log('[Workspace] Grid calculated:', {
            width: effectiveWidth,
            height: effectiveHeight,
            columns: this.gridColumns,
            rows: this.gridRows,
            cellSize: this.cellSize,
            gap: gap,
            totalHeight: totalHeight
        });

        // Apply CSS custom properties
        this.contentArea.style.setProperty('--tab-cell-size', `${this.cellSize}px`);
        this.contentArea.style.setProperty('--tab-grid-gap', `${gap}px`);
        this.contentArea.style.setProperty('--tab-grid-step', `${step}px`);
        this.contentArea.style.setProperty('--tab-grid-columns', String(this.gridColumns));
        this.contentArea.style.setProperty('--tab-grid-rows', String(this.gridRows));
        this.contentArea.style.setProperty('--grid-total-height', `${effectiveHeight}px`);
        this.contentArea.style.setProperty('--xavi-bg-height', `${effectiveHeight}px`);
        
        this.contentArea.style.gridTemplateColumns = `repeat(${this.gridColumns}, ${this.cellSize}px)`;
        this.contentArea.style.gridTemplateRows = `repeat(${this.gridRows}, ${this.cellSize}px)`;
        this.contentArea.style.backgroundSize = `${step}px ${step}px`;

        this.syncBackgroundDimensions(effectiveWidth, effectiveHeight);

        if (typeof document !== 'undefined' && document.documentElement) {
            const clampedContentWidth = Math.max(0, Math.floor(effectiveWidth));
            document.documentElement.style.setProperty('--xavi-content-width', `${clampedContentWidth}px`);
            // Also set the actual grid width with offsets for taskbar alignment
            const gridActualWidth = Math.max(0, Math.floor(rect.width - 16));
            document.documentElement.style.setProperty('--xavi-grid-actual-width', `${gridActualWidth}px`);
        }

        // Notify modules that grid has been updated
        this.dispatchEvent(new CustomEvent('grid-metrics-updated', {
            bubbles: true,
            composed: true,
            detail: {
                columns: this.gridColumns,
                rows: this.gridRows,
                cellSize: this.cellSize,
                gap: gap,
                totalHeight: totalHeight
            }
        }));
    }

    onModuleRegister(event) {
        const detail = event.detail || {};
        if (!detail.name || !detail.module) {
            return;
        }
        this.modules.set(detail.name, detail.module);
        if (typeof detail.module.setWorkspace === 'function') {
            detail.module.setWorkspace(this);
        }
        event.stopPropagation();
    }

    registerModule(name, module) {
        if (!name || !module) {
            return;
        }
        this.modules.set(name, module);
        if (typeof module.setWorkspace === 'function') {
            module.setWorkspace(this);
        }
    }

    unregisterModule(name) {
        this.modules.delete(name);
    }

    getModule(name) {
        return this.modules.get(name);
    }

    // Provide access to grid elements for modules
    getContentArea() {
        return this.contentArea;
    }

    getGridDimensions() {
        if (!this.contentArea) {
            return null;
        }
        const rect = this.contentArea.getBoundingClientRect();
        return {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            right: rect.right,
            bottom: rect.bottom
        };
    }

    getBackgroundLayer() {
        return this.bgLayer;
    }

    getGridElement() {
        return this.gridElement;
    }

    getFloatingLayer() {
        if (this.floatingLayer && this.shadowRoot?.contains(this.floatingLayer)) {
            return this.floatingLayer;
        }
        if (this.shadowRoot) {
            this.floatingLayer = this.shadowRoot.getElementById('floating-panel-layer');
        }
        return this.floatingLayer || null;
    }

    attachFloatingPanel(element) {
        if (!element) {
            return null;
        }
        const host = this.getFloatingLayer() || this.contentArea || this;
        if (!host || typeof host.appendChild !== 'function') {
            return null;
        }
        host.appendChild(element);
        return element;
    }

    syncBackgroundDimensions(width, height) {
        if (!Number.isFinite(width) || !Number.isFinite(height)) {
            return;
        }
        const clampedWidth = Math.max(0, Math.floor(width));
        const clampedHeight = Math.max(0, Math.floor(height));

        const applySize = (el) => {
            if (!el) return;
            el.style.width = `${clampedWidth}px`;
            el.style.height = `${clampedHeight}px`;
            el.style.minWidth = `${clampedWidth}px`;
            el.style.minHeight = `${clampedHeight}px`;
        };

        applySize(this.contentArea);
        applySize(this.bgLayer);
        applySize(this.gridElement);
    }
}

customElements.define('xavi-multi-grid', XaviMultiGridWorkspace);
