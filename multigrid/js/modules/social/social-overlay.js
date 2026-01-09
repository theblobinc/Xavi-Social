(function registerSocialOverlay() {
    'use strict';

    if (typeof window === 'undefined') {
        return;
    }

    const PANEL_ID = 'social-overlay';
    const CSS_ID = 'xavi-social-overlay-styles';
    const APP_CSS_ID = 'xavi-social-app-css';
    const APP_JS_ID = 'xavi-social-app-js';

    const entryConfig = {
        id: PANEL_ID,
        label: 'Social',
        icon: '💬',
        category: 'Social',
        // Make it very prominent in menus.
        priority: 999,
        requiresAdmin: false,
        maxInstances: 1,
        launch: (context = {}) => spawnSocialOverlay(context),
        taskviewConfig: {
            // Ensure taskview focus/close works for this panel.
            focus: (ctx) => {
                try {
                    const el = findExistingOverlay();
                    if (el && typeof el.bringToFront === 'function') {
                        el.bringToFront();
                    }
                } catch (e) {
                    // ignore
                }
            },
            close: () => {
                const el = findExistingOverlay();
                if (el && typeof el.closePanel === 'function') {
                    el.closePanel();
                    return true;
                }
                if (el && el.parentNode) {
                    el.parentNode.removeChild(el);
                    return true;
                }
                return false;
            }
        }
    };

    queuePanelRegistration(() => entryConfig);

    // Auto-launch once when the workspace becomes ready.
    window.addEventListener('xavi-workspace-ready', (event) => {
        try {
            if (window.__xaviSocialOverlayAutoLaunched) {
                return;
            }
            window.__xaviSocialOverlayAutoLaunched = true;
            spawnSocialOverlay({ workspace: event?.detail?.workspace });
        } catch (e) {
            // ignore
        }
    });

    // Fallback: if something loads after the ready event, attempt once on DOMContentLoaded.
    document.addEventListener('DOMContentLoaded', () => {
        try {
            if (window.__xaviSocialOverlayAutoLaunched) {
                return;
            }
            const ws = document.querySelector('xavi-multi-grid');
            if (!ws) {
                return;
            }
            window.__xaviSocialOverlayAutoLaunched = true;
            spawnSocialOverlay({ workspace: ws });
        } catch (e) {
            // ignore
        }
    }, { once: true });

    if (!customElements.get('xavi-social-overlay')) {
        class XaviSocialOverlay extends HTMLElement {
            constructor() {
                super();
                this.boundBringToFront = () => this.bringToFront();
                this.boundClose = (event) => {
                    try {
                        if (event) {
                            event.preventDefault?.();
                            event.stopPropagation?.();
                        }
                    } catch (e) {
                        // ignore
                    }
                    this.closePanel();
                };
            }

            connectedCallback() {
                this.dataset.panelId = PANEL_ID;
                this.dataset.panelTitle = 'Social';
                this.dataset.section = 'Social';

                ensureOverlayStyles();
                this.render();
                ensureSocialAppAssetsLoaded();

                this.bringToFront();
                this.addEventListener('mousedown', this.boundBringToFront);
                this.addEventListener('panel-close-request', this.boundClose);
            }

            disconnectedCallback() {
                this.removeEventListener('mousedown', this.boundBringToFront);
                this.removeEventListener('panel-close-request', this.boundClose);
                try {
                    if (window.__xaviSocialMountRoot === this.querySelector('#xavi-social-root')) {
                        delete window.__xaviSocialMountRoot;
                    }
                } catch (e) {
                    // ignore
                }
            }

            render() {
                if (this.querySelector('#xavi-social-root')) {
                    return;
                }

                this.innerHTML = `
                    <button class="xavi-social-overlay__close" type="button" aria-label="Close social">×</button>
                    <div id="xavi-social-root"></div>
                `;

                const closeBtn = this.querySelector('.xavi-social-overlay__close');
                if (closeBtn) {
                    closeBtn.addEventListener('click', this.boundClose);
                }
            }

            focusPanel() {
                this.bringToFront();
                try {
                    const root = this.querySelector('#xavi-social-root');
                    const focusable = root?.querySelector?.('textarea, input, button, [tabindex]');
                    focusable?.focus?.();
                } catch (e) {
                    // ignore
                }
            }

            bringToFront() {
                if (this.style.display === 'none') {
                    this.style.display = 'block';
                }
                // Keep below taskbar (taskbar uses z-index ~10000) but above other panels.
                // Note: we attach this overlay to document.body so the Vite bundle can mount
                // using document.getElementById('xavi-social-root').
                this.style.zIndex = '9500';
                this.dispatchEvent(new CustomEvent('floating-panel-focus', {
                    bubbles: true,
                    composed: true,
                    detail: { panelId: PANEL_ID, panelElement: this }
                }));
            }

            closePanel() {
                try {
                    this.dispatchEvent(new CustomEvent('panel-closed', {
                        bubbles: true,
                        composed: true,
                        detail: { panelId: PANEL_ID }
                    }));
                } catch (e) {
                    // ignore
                }
                // Do NOT remove from DOM: the social app is a Vite ES module that only
                // evaluates once per document; keeping the instance allows reopen.
                this.style.display = 'none';
            }
        }

        customElements.define('xavi-social-overlay', XaviSocialOverlay);
    }

    function ensureOverlayStyles() {
        if (document.getElementById(CSS_ID)) {
            return;
        }

        const style = document.createElement('style');
        style.id = CSS_ID;
        style.textContent = `
            xavi-social-overlay {
                position: fixed;
                top: calc(var(--xavi-nav-h, 0px) + 8px);
                left: 8px;
                right: 8px;
                bottom: calc(var(--xavi-taskbar-h, 108px) + 8px);
                display: block;
                background: rgba(0, 0, 0, 0.96);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 10px;
                overflow: hidden;
                pointer-events: auto;
            }

            xavi-social-overlay #xavi-social-root {
                position: absolute;
                inset: 0;
                overflow: hidden;
                z-index: 1;
            }

            /* Keep the Vite social app contained within this overlay. */
            xavi-social-overlay #xavi-social-root .xv-shell {
                position: absolute !important;
                inset: 0 !important;
                width: 100% !important;
                height: 100% !important;
            }

            xavi-social-overlay .xavi-social-overlay__close {
                position: absolute;
                top: 10px;
                right: 12px;
                width: 34px;
                height: 34px;
                border-radius: 8px;
                border: 1px solid rgba(255, 255, 255, 0.22);
                background: rgba(0, 0, 0, 0.55);
                color: #fff;
                font-size: 22px;
                line-height: 30px;
                cursor: pointer;
                z-index: 10;
                pointer-events: auto;
            }

            xavi-social-overlay .xavi-social-overlay__close:hover {
                background: rgba(255, 255, 255, 0.08);
            }
        `;

        document.head.appendChild(style);
    }

    function computeNextFloatingZIndex(element) {
        // Taskbar is ~10000; stay below it.
        const ceiling = 9999;
        const floor = 9000;
        try {
            const layer = findFloatingLayer(element);
            if (!layer) {
                return floor;
            }
            let maxZ = 0;
            for (const child of Array.from(layer.children || [])) {
                if (!child || child === element) {
                    continue;
                }
                const z = readZIndex(child);
                if (Number.isFinite(z) && z > maxZ && z < ceiling) {
                    maxZ = z;
                }
            }
            return Math.min(ceiling, Math.max(floor, maxZ + 1));
        } catch (e) {
            return floor;
        }
    }

    function readZIndex(node) {
        try {
            const style = window.getComputedStyle(node);
            const raw = style && style.zIndex ? String(style.zIndex) : '';
            const num = Number.parseInt(raw, 10);
            return Number.isFinite(num) ? num : 0;
        } catch (e) {
            return 0;
        }
    }

    function findFloatingLayer(element) {
        const ws = document.querySelector('xavi-multi-grid');
        if (ws && typeof ws.getFloatingLayer === 'function') {
            const layer = ws.getFloatingLayer();
            if (layer) {
                return layer;
            }
        }
        // Fallback: try to locate within shadow roots.
        try {
            const root = ws && ws.shadowRoot ? ws.shadowRoot : document;
            return root.querySelector('#floating-panel-layer');
        } catch (e) {
            return null;
        }
    }

    function ensureSocialAppAssetsLoaded() {
        const version = (typeof window !== 'undefined' && window.XAVI_ASSET_VERSION) ? String(window.XAVI_ASSET_VERSION) : '';
        const v = version ? ('?v=' + encodeURIComponent(version)) : '';

        if (!document.getElementById(APP_CSS_ID)) {
            const link = document.createElement('link');
            link.id = APP_CSS_ID;
            link.rel = 'stylesheet';
            link.href = '/packages/xavi_social/dist/app.css' + v;
            document.head.appendChild(link);
        }

        if (!document.getElementById(APP_JS_ID)) {
            const script = document.createElement('script');
            script.id = APP_JS_ID;
            script.type = 'module';
            script.src = '/packages/xavi_social/dist/app.js' + v;
            document.head.appendChild(script);
        }
    }

    function findExistingOverlay() {
        const candidates = [];
        const ws = document.querySelector('xavi-multi-grid');
        if (ws) {
            if (ws.shadowRoot) {
                candidates.push(ws.shadowRoot);
            }
            if (typeof ws.getFloatingLayer === 'function') {
                const layer = ws.getFloatingLayer();
                if (layer) {
                    candidates.push(layer);
                }
            }
        }
        candidates.push(document);

        for (const root of candidates) {
            try {
                const el = root?.querySelector?.('xavi-social-overlay');
                if (el) {
                    return el;
                }
            } catch (e) {
                // ignore
            }
        }
        return null;
    }

    function spawnSocialOverlay(context = {}) {
        const existing = findExistingOverlay();
        if (existing) {
            if (existing.style.display === 'none') {
                existing.style.display = 'block';
            }
            if (typeof existing.bringToFront === 'function') {
                existing.bringToFront();
            }
            return existing;
        }

        // IMPORTANT: attach to document.body so the Vite bundle can mount by ID.
        // If we attach inside the xavi-multi-grid shadow DOM, document.getElementById()
        // cannot see the mount node and the app renders as blank.
        const host = document.body || document.documentElement;

        const el = document.createElement('xavi-social-overlay');
        el.setAttribute('panel-id', PANEL_ID);
        host.appendChild(el);

        if (typeof el.bringToFront === 'function') {
            el.bringToFront();
        }

        return el;
    }

    function queuePanelRegistration(factory) {
        const tryRegister = () => {
            if (typeof window.registerTaskbarPanel !== 'function') {
                return false;
            }
            try {
                window.registerTaskbarPanel(factory());
            } catch (err) {
                console.warn('[SocialOverlay] Failed to register panel:', err);
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

    window.spawnSocialOverlay = spawnSocialOverlay;
})();
