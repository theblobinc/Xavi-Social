(function tabOverlayTabs() {
    'use strict';

    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return;
    }

    const OVERLAY_ID = 'playlist-viewer-overlay';
    const CSS_ID = 'xavi-tab-overlay-styles';
    const SOCIAL_APP_CSS_ID = 'xavi-social-app-css';
    const SOCIAL_APP_JS_ID = 'xavi-social-app-js';
    const BG_STYLE_ID = 'xavi-social-background-styles';

    const BG_HOST_ID = 'xavi-social-background';
    const BG_ROOT_ID = 'xavi-social-root';
    const BG_PLACEHOLDER_ID = 'xavi-bg-placeholder';

    // Background selector tabs (not all routes exist in the Vite app yet; placeholders are fine).
    const TAB_TIMELINE = 'timeline';
    const TAB_NOTIFICATIONS = 'notifications';
    const TAB_PROFILE = 'profile';
    const TAB_MEDIA = 'media';
    const TAB_SEARCH = 'search';
    const TAB_PLAYLIST = 'playlist';

    const SOCIAL_ALIASES = new Set(['social', 'feed', 'timeline']);

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

    function ensureWorkspaceBackgroundHost(ws) {
        const root = ws?.shadowRoot;
        if (!root) return null;

        let bgLayer = root.querySelector('.xavi-bg-layer');
        if (!bgLayer) {
            bgLayer = document.createElement('div');
            bgLayer.className = 'xavi-bg-layer';
            root.appendChild(bgLayer);
        }

        let host = bgLayer.querySelector('#' + BG_HOST_ID);
        if (!host) {
            host = document.createElement('div');
            host.id = BG_HOST_ID;
            host.setAttribute('aria-hidden', 'true');
            bgLayer.insertBefore(host, bgLayer.firstChild || null);
        }

        return host;
    }

    function getBackgroundHost() {
        const ws = getWorkspace();
        if (!ws) return null;

        const taskbar = getTaskbar();
        // IMPORTANT: the taskbar creates the background layer inside the workspace content area
        // (MultiGrid shadow DOM), not inside the taskbar shadow DOM.
        let bgLayer = null;

        try {
            // Ensure it exists (taskbar provides this helper).
            if (taskbar && typeof taskbar.ensureBackgroundLayer === 'function') {
                bgLayer = taskbar.ensureBackgroundLayer();
            }
        } catch (e) {
            // ignore
        }

        try {
            const direct = (
                bgLayer?.querySelector?.('#' + BG_HOST_ID)
                || taskbar?.contentArea?.querySelector?.('#' + BG_HOST_ID)
                || ws?.shadowRoot?.getElementById?.(BG_HOST_ID)
                || ws?.shadowRoot?.querySelector?.('#' + BG_HOST_ID)
                || ws?.querySelector?.('#' + BG_HOST_ID)
                || null
            );
            return direct || ensureWorkspaceBackgroundHost(ws);
        } catch (e) {
            return ensureWorkspaceBackgroundHost(ws);
        }
    }

    function ensureBackgroundStylesInjected() {
        const ws = getWorkspace();
        // Background host lives in the workspace shadow root/content area.
        const root = ws?.shadowRoot;
        if (!root) return;
        if (root.getElementById(BG_STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = BG_STYLE_ID;
        style.textContent = `
            #${BG_HOST_ID} {
                position: absolute;
                inset: 0;
                overflow: hidden;
            }

            #${BG_HOST_ID} #${BG_ROOT_ID} {
                position: absolute;
                inset: 0;
                overflow: hidden;
                pointer-events: auto;
            }

            /* Keep the Vite social app contained within the background */
            #${BG_HOST_ID} #${BG_ROOT_ID} .xv-shell {
                position: absolute !important;
                inset: 0 !important;
                width: 100% !important;
                height: 100% !important;
            }

            #${BG_HOST_ID} #${BG_PLACEHOLDER_ID} {
                position: absolute;
                inset: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                color: rgba(255, 255, 255, 0.75);
                font-weight: 600;
                letter-spacing: 0.02em;
                background: rgba(0, 0, 0, 0.0);
                pointer-events: none;
                user-select: none;
            }
        `;

        root.appendChild(style);
    }

    function ensureBackgroundNodes() {
        const host = getBackgroundHost();
        if (!host) return null;

        ensureBackgroundStylesInjected();

        let root = host.querySelector('#' + BG_ROOT_ID);
        if (!root) {
            root = document.createElement('div');
            root.id = BG_ROOT_ID;
            host.appendChild(root);
        }

        let placeholder = host.querySelector('#' + BG_PLACEHOLDER_ID);
        if (!placeholder) {
            placeholder = document.createElement('div');
            placeholder.id = BG_PLACEHOLDER_ID;
            placeholder.style.display = 'none';
            host.appendChild(placeholder);
        }

        return { host, root, placeholder };
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
                    align-items: center;
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

                #floating-panel-layer .playlist-overlay.tab-overlay .tab-overlay-search {
                    margin-left: auto;
                    width: min(260px, 40vw);
                    appearance: none;
                    border: 1px solid rgba(255, 255, 255, 0.14);
                    background: rgba(255, 255, 255, 0.04);
                    color: rgba(255, 255, 255, 0.92);
                    border-radius: 999px;
                    padding: 6px 10px;
                    font-size: 12px;
                    font-weight: 600;
                    outline: none;
                }

                #floating-panel-layer .playlist-overlay.tab-overlay .tab-overlay-search::placeholder {
                    color: rgba(255, 255, 255, 0.55);
                    font-weight: 600;
                }

                #floating-panel-layer .playlist-overlay.tab-overlay .tab-overlay-body {
                    flex: 1;
                    min-height: 0;
                    display: block;
                    position: relative;
                }

                /* Body stays as playlist viewer; background switching is handled separately. */
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
        header.setAttribute('aria-label', 'Background selector');

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

        const timelineTab = mkTab(TAB_TIMELINE, 'Timeline');
        const notificationsTab = mkTab(TAB_NOTIFICATIONS, 'Notifications');
        const profileTab = mkTab(TAB_PROFILE, 'Profile');
        const mediaTab = mkTab(TAB_MEDIA, 'Media');
        const searchTab = mkTab(TAB_SEARCH, 'Search');
        const playlistTab = mkTab(TAB_PLAYLIST, 'Playlist');

        header.appendChild(timelineTab);
        header.appendChild(notificationsTab);
        header.appendChild(profileTab);
        header.appendChild(mediaTab);
        header.appendChild(searchTab);
        header.appendChild(playlistTab);

        const searchInput = document.createElement('input');
        searchInput.className = 'tab-overlay-search';
        searchInput.type = 'search';
        searchInput.placeholder = 'Search…';
        searchInput.setAttribute('aria-label', 'Search background feed');
        searchInput.autocomplete = 'off';
        searchInput.spellcheck = false;
        header.appendChild(searchInput);

        const body = document.createElement('div');
        body.className = 'tab-overlay-body';

        // Keep the playlist viewer as the overlay body content.
        if (playlistContent) {
            body.appendChild(playlistContent);
        }

        // Insert header + body before the resize handle (keep the handle as a direct child of overlay)
        if (resizeHandle) {
            overlay.insertBefore(header, resizeHandle);
            overlay.insertBefore(body, resizeHandle);
        } else {
            overlay.insertBefore(header, overlay.firstChild);
            overlay.insertBefore(body, header.nextSibling);
        }

        overlay.dataset.tabbed = 'true';

        // Default background tab
        if (!overlay.dataset.activeTab) {
            overlay.dataset.activeTab = TAB_TIMELINE;
        }

        // Bind switching
        header.addEventListener('click', (e) => {
            const btn = e.target?.closest?.('.tab-overlay-tab');
            if (!btn) return;
            const tabId = String(btn.dataset.tab || '').trim();
            if (!tabId) return;
            selectTab(tabId, { openOverlay: tabId === TAB_PLAYLIST });
        });

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const q = String(searchInput.value || '').trim();
                window.__xaviSocialSearchQuery = q;
                selectTab(TAB_SEARCH, { openOverlay: false });
                return;
            }
            if (e.key === 'Escape') {
                searchInput.value = '';
                window.__xaviSocialSearchQuery = '';
                return;
            }
        });

        syncTabUI(overlay);
    }

    function syncTabUI(overlay) {
        if (!overlay) return;
        const active = String(overlay.dataset.activeTab || TAB_TIMELINE);
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

    function setBackgroundMode(mode) {
        const nodes = ensureBackgroundNodes();
        if (!nodes) return false;

        const { root, placeholder } = nodes;

        const normalized = String(mode || '').trim().toLowerCase();

        // Social views
        if ([TAB_TIMELINE, TAB_NOTIFICATIONS, TAB_PROFILE].includes(normalized) || SOCIAL_ALIASES.has(normalized)) {
            placeholder.style.display = 'none';
            root.style.display = 'block';

            // Make sure the app is mounted into the background root.
            window.__xaviSocialMountRoot = root;
            ensureSocialAssetsLoaded();

            // Switch route for the background app (hash-based).
            if (normalized === TAB_NOTIFICATIONS) {
                if (window.location.hash !== '#notifications') {
                    window.location.hash = '#notifications';
                }
            } else if (normalized === TAB_PROFILE) {
                // Let the app choose the default actor when actor is omitted.
                if (!window.location.hash.startsWith('#profile')) {
                    window.location.hash = '#profile/';
                }
            } else {
                if (!window.location.hash || window.location.hash === '#') {
                    window.location.hash = '#feed';
                } else if (!window.location.hash.startsWith('#feed')) {
                    window.location.hash = '#feed';
                }
            }

            return true;
        }

        if (normalized === TAB_MEDIA) {
            placeholder.style.display = 'none';
            root.style.display = 'block';

            window.__xaviSocialMountRoot = root;
            ensureSocialAssetsLoaded();

            if (!window.location.hash.startsWith('#media')) {
                window.location.hash = '#media';
            }
            return true;
        }

        if (normalized === TAB_SEARCH) {
            placeholder.style.display = 'none';
            root.style.display = 'block';

            window.__xaviSocialMountRoot = root;
            ensureSocialAssetsLoaded();

            const q = String(window.__xaviSocialSearchQuery || '').trim();
            const target = q ? `#search/${encodeURIComponent(q)}` : '#search';
            if (window.location.hash !== target) {
                window.location.hash = target;
            }
            return true;
        }

        return false;
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

        const raw = String(tabId || '').trim().toLowerCase();
        const desired = raw || TAB_TIMELINE;
        overlay.dataset.activeTab = desired;
        syncTabUI(overlay);

        if (desired !== TAB_PLAYLIST) {
            setBackgroundMode(desired);
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

        if (desired === TAB_PLAYLIST) {
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

        // Always ensure background exists and defaults to feed.
        // IMPORTANT: Taskbar/template may not be ready on the first tick; keep polling until we can
        // actually mount the social app into the background layer.
        const backgroundOk = setBackgroundMode(TAB_TIMELINE);

        const overlay = findOverlay();
        if (!overlay) {
            return false;
        }

        ensureOverlayTabbed(overlay);
        syncTabUI(overlay);

        return Boolean(backgroundOk);
    }

    // Public API used by other modules (eg. Social) to open/select a tab.
    window.selectTabOverlayTab = (tabId) => {
        const raw = String(tabId || '').trim().toLowerCase();
        const normalized = SOCIAL_ALIASES.has(raw) ? TAB_TIMELINE : raw;
        return selectTab(normalized, { openOverlay: false });
    };
    window.openTabOverlayTab = (tabId) => {
        const raw = String(tabId || '').trim().toLowerCase();
        const normalized = SOCIAL_ALIASES.has(raw) ? TAB_TIMELINE : raw;
        return selectTab(normalized, { openOverlay: true });
    };

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
                // Taskbar/template is fetched async; allow a few seconds.
                if (attempts > 600) {
                return;
            }
            requestAnimationFrame(tick);
        };
        tick();
    }, { once: true });
})();
