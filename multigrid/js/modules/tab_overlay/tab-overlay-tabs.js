(function tabOverlayTabs() {
    'use strict';

    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return;
    }

    const OVERLAY_ID = 'playlist-viewer-overlay';
    const CSS_ID = 'xavi-tab-overlay-styles';
    const SOCIAL_APP_CSS_ID = 'xavi-social-app-css';
    const SOCIAL_APP_JS_ID = 'xavi-social-app-js';

    const TAB_PLAYLIST = 'playlist';
    const TAB_SOCIAL = 'social';

    function getWorkspace() {
        return document.querySelector('xavi-multi-grid');
    }

    function getTaskbar() {
        const ws = getWorkspace();
        try {
            return ws?.shadowRoot?.querySelector?.('panel-taskbar') || ws?.querySelector?.('panel-taskbar') || null;
        } catch (e) {
            return null;
        }
    }

    function getFloatingLayer(ws) {
        try {
            if (ws && typeof ws.getFloatingLayer === 'function') {
                return ws.getFloatingLayer();
            }
            return ws?.shadowRoot?.getElementById?.('floating-panel-layer') || null;
        } catch (e) {
            return null;
        }
    }

    function findOverlay() {
        const ws = getWorkspace();
        const roots = [];
        if (ws) {
            roots.push(ws);
            if (ws.shadowRoot) {
                roots.push(ws.shadowRoot);
            }
            const layer = getFloatingLayer(ws);
            if (layer) {
                roots.push(layer);
            }
        }
        roots.push(document);

        for (const root of roots) {
            try {
                const el = root?.getElementById?.(OVERLAY_ID) || root?.querySelector?.(`#${OVERLAY_ID}`);
                if (el) {
                    return el;
                }
            } catch (e) {
                // ignore
            }
        }
        return null;
    }

    function ensureStylesInjected(ws) {
        try {
            const root = ws?.shadowRoot;
            if (!root || root.getElementById(CSS_ID)) {
                return;
            }

            const style = document.createElement('style');
            style.id = CSS_ID;
            style.textContent = `
                #floating-panel-layer .playlist-overlay.tab-overlay {
                    display: flex;
                    flex-direction: column;
                }

                #floating-panel-layer .playlist-overlay.tab-overlay .tab-overlay-header {
                    display: flex;
                    gap: 6px;
                    padding: 10px 10px 0;
                    flex: 0 0 auto;
                }

                #floating-panel-layer .playlist-overlay.tab-overlay .tab-overlay-tab {
                    appearance: none;
                    border: 1px solid rgba(255, 255, 255, 0.14);
                    background: rgba(255, 255, 255, 0.04);
                    color: rgba(255, 255, 255, 0.75);
                    border-radius: 999px;
                    padding: 6px 10px;
                    font-size: 12px;
                    font-weight: 600;
                    cursor: pointer;
                    user-select: none;
                }

                #floating-panel-layer .playlist-overlay.tab-overlay .tab-overlay-tab.is-active {
                    border-color: rgba(74, 158, 255, 0.7);
                    background: rgba(74, 158, 255, 0.18);
                    color: rgba(255, 255, 255, 0.95);
                }

                #floating-panel-layer .playlist-overlay.tab-overlay .tab-overlay-body {
                    flex: 1;
                    min-height: 0;
                    display: block;
                    position: relative;
                }

                #floating-panel-layer .playlist-overlay.tab-overlay .tab-overlay-panel {
                    position: absolute;
                    inset: 0;
                    display: none;
                    min-height: 0;
                }

                #floating-panel-layer .playlist-overlay.tab-overlay[data-active-tab="${TAB_PLAYLIST}"] .tab-overlay-panel[data-tab="${TAB_PLAYLIST}"],
                #floating-panel-layer .playlist-overlay.tab-overlay[data-active-tab="${TAB_SOCIAL}"] .tab-overlay-panel[data-tab="${TAB_SOCIAL}"] {
                    display: block;
                }

                #floating-panel-layer .playlist-overlay.tab-overlay .tab-overlay-panel[data-tab="${TAB_SOCIAL}"] {
                    overflow: hidden;
                }

                #floating-panel-layer .playlist-overlay.tab-overlay .tab-overlay-panel[data-tab="${TAB_SOCIAL}"] #xavi-social-root {
                    position: absolute;
                    inset: 0;
                    overflow: hidden;
                }

                #floating-panel-layer .playlist-overlay.tab-overlay .tab-overlay-panel[data-tab="${TAB_SOCIAL}"] #xavi-social-root .xv-shell {
                    position: absolute !important;
                    inset: 0 !important;
                    width: 100% !important;
                    height: 100% !important;
                }
            `;

            root.appendChild(style);
        } catch (e) {
            // ignore
        }
    }

    function ensureOverlayTabbed(overlay) {
        if (!overlay || overlay.dataset.tabbed === 'true') {
            return;
        }

        overlay.classList.add('tab-overlay');

        const playlistContent = overlay.querySelector('.playlist-overlay-content');
        const resizeHandle = overlay.querySelector('.playlist-resize-handle');

        const header = document.createElement('div');
        header.className = 'tab-overlay-header';
        header.setAttribute('role', 'tablist');
        header.setAttribute('aria-label', 'Overlay tabs');

        const mkTab = (tabId, label) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'tab-overlay-tab';
            btn.dataset.tab = tabId;
            btn.setAttribute('role', 'tab');
            btn.setAttribute('aria-selected', 'false');
            btn.textContent = label;
            return btn;
        };

        const playlistTab = mkTab(TAB_PLAYLIST, 'Playlist');
        const socialTab = mkTab(TAB_SOCIAL, 'Social');

        header.appendChild(playlistTab);
        header.appendChild(socialTab);

        const body = document.createElement('div');
        body.className = 'tab-overlay-body';

        const playlistPanel = document.createElement('div');
        playlistPanel.className = 'tab-overlay-panel';
        playlistPanel.dataset.tab = TAB_PLAYLIST;

        const socialPanel = document.createElement('div');
        socialPanel.className = 'tab-overlay-panel';
        socialPanel.dataset.tab = TAB_SOCIAL;

        const socialRoot = document.createElement('div');
        socialRoot.id = 'xavi-social-root';
        socialPanel.appendChild(socialRoot);

        if (playlistContent) {
            playlistPanel.appendChild(playlistContent);
        }

        body.appendChild(playlistPanel);
        body.appendChild(socialPanel);

        // Insert header + body before the resize handle (keep the handle as a direct child of overlay)
        if (resizeHandle) {
            overlay.insertBefore(header, resizeHandle);
            overlay.insertBefore(body, resizeHandle);
        } else {
            overlay.insertBefore(header, overlay.firstChild);
            overlay.insertBefore(body, header.nextSibling);
        }

        overlay.dataset.tabbed = 'true';

        // Default tab
        if (!overlay.dataset.activeTab) {
            overlay.dataset.activeTab = TAB_PLAYLIST;
        }

        // Bind switching
        header.addEventListener('click', (e) => {
            const btn = e.target?.closest?.('.tab-overlay-tab');
            if (!btn) return;
            const tabId = String(btn.dataset.tab || '').trim();
            if (!tabId) return;
            selectTab(tabId, { openOverlay: true });
        });

        syncTabUI(overlay);
    }

    function syncTabUI(overlay) {
        if (!overlay) return;
        const active = String(overlay.dataset.activeTab || TAB_PLAYLIST);
        const buttons = overlay.querySelectorAll('.tab-overlay-tab');
        buttons.forEach((btn) => {
            const tabId = String(btn.dataset.tab || '');
            const isActive = tabId === active;
            btn.classList.toggle('is-active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
    }

    function ensureSocialAssetsLoaded() {
        const version = (typeof window !== 'undefined' && window.XAVI_ASSET_VERSION) ? String(window.XAVI_ASSET_VERSION) : '';
        const v = version ? ('?v=' + encodeURIComponent(version)) : '';

        if (!document.getElementById(SOCIAL_APP_CSS_ID)) {
            const link = document.createElement('link');
            link.id = SOCIAL_APP_CSS_ID;
            link.rel = 'stylesheet';
            link.href = '/packages/xavi_social/dist/app.css' + v;
            document.head.appendChild(link);
        }

        if (!document.getElementById(SOCIAL_APP_JS_ID)) {
            const script = document.createElement('script');
            script.id = SOCIAL_APP_JS_ID;
            script.type = 'module';
            script.src = '/packages/xavi_social/dist/app.js' + v;
            document.head.appendChild(script);
        }
    }

    function ensureSocialMountRoot(overlay) {
        const root = overlay?.querySelector?.('#xavi-social-root');
        if (!root) {
            return;
        }
        window.__xaviSocialMountRoot = root;
        ensureSocialAssetsLoaded();
    }

    function selectTab(tabId, options = {}) {
        const ws = getWorkspace();
        if (ws) {
            ensureStylesInjected(ws);
        }
        const overlay = findOverlay();
        if (!overlay) {
            return false;
        }

        ensureOverlayTabbed(overlay);

        const desired = String(tabId || '').trim() || TAB_PLAYLIST;
        overlay.dataset.activeTab = desired;
        syncTabUI(overlay);

        if (desired === TAB_SOCIAL) {
            ensureSocialMountRoot(overlay);
        }

        if (options.openOverlay) {
            const taskbar = getTaskbar();
            if (taskbar && typeof taskbar.openPlaylistOverlay === 'function') {
                try {
                    taskbar.openPlaylistOverlay();
                } catch (e) {
                    // ignore
                }
            }
        }

        return true;
    }

    function init() {
        const ws = getWorkspace();
        if (!ws) {
            return false;
        }

        ensureStylesInjected(ws);

        const overlay = findOverlay();
        if (!overlay) {
            return false;
        }

        ensureOverlayTabbed(overlay);
        syncTabUI(overlay);
        return true;
    }

    // Public API used by other modules (eg. Social) to open/select a tab.
    window.selectTabOverlayTab = (tabId) => selectTab(tabId, { openOverlay: false });
    window.openTabOverlayTab = (tabId) => selectTab(tabId, { openOverlay: true });

    // Wait for workspace to exist.
    window.addEventListener('xavi-workspace-ready', () => {
        init();
    });

    document.addEventListener('DOMContentLoaded', () => {
        // Poll briefly in case modules initialize before xavi-workspace-ready.
        let attempts = 0;
        const tick = () => {
            attempts += 1;
            if (init()) {
                return;
            }
            if (attempts > 60) {
                return;
            }
            requestAnimationFrame(tick);
        };
        tick();
    }, { once: true });
})();
