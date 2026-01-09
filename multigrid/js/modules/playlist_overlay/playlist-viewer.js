// Example path: application/single_pages/pgmusic/js/playlist-viewer.js

function xaviApiUrl(path) {
    const apiBase = String(window.XAVI_API_BASE || '').replace(/\/$/, '');
    return apiBase + path;
}

class PlaylistViewer extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        const template = document.getElementById('playlist-viewer-template');
        this.shadowRoot.appendChild(template.content.cloneNode(true));
        this._playlistData = [];
        this._allPlaylistData = []; // Store full playlist for track numbers
        this._filteredPlaylistData = []; // Store currently displayed playlist
        this._cachedPlaylistData = []; // Store cached DB playlist
        this._userPlaylistData = []; // Store user's custom playlist
        this.playlistMode = localStorage.getItem('playlistViewerMode') || 'cached'; // 'cached', 'user', or 'now-playing'
        // 'desc' = newest-first (default, like YouTube), 'asc' = oldest-first
        this.playlistSortDir = localStorage.getItem('playlistSortDir') || 'desc';
        this.fuse = null;
        this.currentTime = 0;
        this.currentDuration = 0;
        this.currentVideoId = localStorage.getItem('myCurrentVideoID') || null;
        this._updatingSliderProgrammatically = false;
        this.isSearching = false;
        this.lastUpdateTime = 0;
        this.updateThrottle = 100; // Smooth progress/slider updates without excessive work
        this.currentSearchQuery = localStorage.getItem('playlistViewerSearchQuery') || '';
        this.lastSearchIds = new Set();
        const storedSearchOpen = localStorage.getItem('playlistViewerSearchOpen');
        const hasStoredQuery = this.currentSearchQuery && this.currentSearchQuery.trim().length > 0;
        this.searchOverlayOpen = storedSearchOpen === null ? hasStoredQuery : storedSearchOpen === 'true';
        this.handleTabClick = this.handleTabClick.bind(this);
        this.handleSearchToggle = this.handleSearchToggle.bind(this);
        this.handleSearchClear = this.handleSearchClear.bind(this);
        this.handleSearchInputKey = this.handleSearchInputKey.bind(this);
        this.handleChronClick = this.handleChronClick.bind(this);
        this.handleShuffleClick = this.handleShuffleClick.bind(this);
        this.onPlaylistScrollInput = this.onPlaylistScrollInput.bind(this);
        this.onPlaylistScroll = this.onPlaylistScroll.bind(this);
        this.onSearchInput = this.onSearchInput.bind(this);
        this.onShuffleChanged = this.onShuffleChanged.bind(this);
        this.onPlaylistTimeUpdate = this.onPlaylistTimeUpdate.bind(this);
        this.musicPlayerRef = null;
        this._lastKnownShuffleEnabled = false;
        this.userStatus = window.__pgmusicUserStatus || { checked: false, isLoggedIn: false, isAdmin: false };
        this.ensureUserStatus = this.ensureUserStatus.bind(this);
        this.scheduleMarqueeMeasure = this.scheduleMarqueeMeasure.bind(this);
        this.refreshMarqueeMeasurements = this.refreshMarqueeMeasurements.bind(this);
        this.applyResponsiveWidth = this.applyResponsiveWidth.bind(this);
        this._marqueeMeasureFrame = null;
        this._marqueeMeasureIdleCallback = null;
        this._measuredItems = new WeakSet();
        this._simpleBarInstance = null;
        this._simplebarCssInjected = false;
        this._simplebarThemeInjected = false;
        this._boundScrollEl = null;
        this._lastManualScrollTs = 0;
        this._autoScrollCooldownMs = 1500;
        this._isAutoScrolling = false;
        this._autoScrollReleaseTimer = null;
        this._isHoveringPlaylist = false;
        this._autoScrollResumeDelayMs = 60000;
        this._autoScrollResumeAt = null;
        this._autoScrollResumeTimer = null;
        this._autoScrollCountdownInterval = null;
        this._boundScrollHost = null;
        this.handlePlaylistPointerEnter = this.handlePlaylistPointerEnter.bind(this);
        this.handlePlaylistPointerLeave = this.handlePlaylistPointerLeave.bind(this);
        this.handleNowPlayingButtonClick = this.handleNowPlayingButtonClick.bind(this);
        this._lastNowPlayingSignature = '';

        this._renderToken = 0;
        this._estimatedItemHeight = null;

        this._userPlaylists = [];
        this._playlistMap = new Map();
        this._lastCustomPlaylistId = null;
        const storedSelection = localStorage.getItem('selectedPlaylistId');
        this._selectedPlaylistId = storedSelection || 'cached';
        if (this._selectedPlaylistId === 'null' || this._selectedPlaylistId === 'undefined') {
            this._selectedPlaylistId = 'cached';
        }
        if (this.playlistMode !== 'now-playing') {
            this.playlistMode = this._selectedPlaylistId === 'cached' ? 'cached' : 'user';
        }
    }

    set playlistData(data) {
        this._cachedPlaylistData = Array.isArray(data) ? data : [];
        console.log('[PlaylistViewer] Received cached dataset', this._cachedPlaylistData.length);

        // Realign selection so stale localStorage entries fall back to the feed
        const previousSelection = this._selectedPlaylistId;
        this.ensureValidSelection();
        const selectionChanged = previousSelection !== this._selectedPlaylistId;

        // If currently showing the feed (or we just auto-corrected back to it), refresh the view
        if (this.playlistMode === 'cached' || this._selectedPlaylistId === 'cached' || selectionChanged) {
            this._playlistData = this._cachedPlaylistData;
            this.updatePlaylistView();
        }
    }
    
    updatePlaylistView(options = {}) {
        this.ensureValidSelection();

        if (
            this.playlistMode === 'user' &&
            this._selectedPlaylistId !== 'cached' &&
            !this._playlistMap.has(this._selectedPlaylistId) &&
            this._userPlaylists.length > 0
        ) {
            const fallbackId = this._lastCustomPlaylistId && this._playlistMap.has(this._lastCustomPlaylistId)
                ? this._lastCustomPlaylistId
                : this._userPlaylists[0]?.id;
            this._selectedPlaylistId = fallbackId ? String(fallbackId) : 'cached';
            this.ensureValidSelection();
        }

        let activeData;
        if (this.playlistMode === 'now-playing') {
            let queue = [];
            try {
                const shared = window.sharedStateManager;
                if (shared && typeof shared.get === 'function') {
                    queue = shared.get('playlistQueue') || [];
                }
            } catch (err) {
                console.warn('[PlaylistViewer] Unable to read Now Playing queue from shared state:', err);
            }
            activeData = Array.isArray(queue) ? queue.slice() : [];
        } else if (this.playlistMode === 'cached' || this._selectedPlaylistId === 'cached') {
            this._selectedPlaylistId = 'cached';
            activeData = Array.isArray(this._cachedPlaylistData) ? this._cachedPlaylistData.slice() : [];
            this.playlistMode = 'cached';
        } else {
            const customData = this._playlistMap.get(this._selectedPlaylistId);
            activeData = Array.isArray(customData) ? customData.slice() : [];
            this.playlistMode = 'user';
            this._lastCustomPlaylistId = this._selectedPlaylistId;
        }

        localStorage.setItem('selectedPlaylistId', this._selectedPlaylistId);
        localStorage.setItem('playlistViewerMode', this.playlistMode);

        this._playlistData = activeData;
        this._allPlaylistData = activeData;
        if (this.playlistMode === 'now-playing') {
            this._lastNowPlayingSignature = this.computeNowPlayingSignature(activeData);
        } else {
            this._lastNowPlayingSignature = '';
        }
        console.log('[PlaylistViewer] updatePlaylistView: mode=', this.playlistMode, 'items=', this._playlistData.length, 'sortDir=', this.playlistSortDir);
        this.buildFuse();
        this.syncModeButtons();
        this.updateChronButtonVisual();

        const hasStoredQuery = typeof this.currentSearchQuery === 'string' && this.currentSearchQuery.trim().length > 0;
        if (hasStoredQuery && this.fuse) {
            this.performSearch(this.currentSearchQuery, { skipInputSync: true, triggeredByUpdate: true });
        } else {
            this.isSearching = false;
            this.render();

            // Optionally suppress highlighting/video scroll (used when toggling order)
            const shouldHighlight = options.highlight !== false;
            if (shouldHighlight) {
                const targetVideoId = this.currentVideoId || localStorage.getItem('myCurrentVideoID');
                if (targetVideoId && targetVideoId !== 'null') {
                    this.highlightVideo(targetVideoId);
                }
            }
        }
        this.updateSearchToggleState();
    }
    
    switchPlaylistMode(mode) {
        if (mode === 'now-playing') {
            this.playlistMode = 'now-playing';
            this.updatePlaylistView({ highlight: false });
            return;
        }

        if (mode === 'cached') {
            this._selectedPlaylistId = 'cached';
            this.playlistMode = 'cached';
            this.updatePlaylistView();
            return;
        }

        if (mode === 'user') {
            if (!this._userPlaylists.length) {
                return;
            }

            const preferredId = this._lastCustomPlaylistId && this._userPlaylists.some((p) => String(p.id) === String(this._lastCustomPlaylistId))
                ? this._lastCustomPlaylistId
                : this._userPlaylists[0]?.id;

            if (!preferredId) {
                return;
            }

            this.playlistMode = 'user';
            this._selectedPlaylistId = String(preferredId);
            this._lastCustomPlaylistId = this._selectedPlaylistId;

            if (this._playlistMap.has(this._selectedPlaylistId)) {
                this.updatePlaylistView();
            } else {
                this.fetchSongsForPlaylist(this._selectedPlaylistId);
            }
        }
    }
    
    onTabVisible() {
        // Called when tab becomes visible - re-render with current data
        this.updatePlaylistView();
    }

    buildFuse() {
        if (typeof Fuse !== 'undefined' && this._playlistData.length) {
            this.fuse = new Fuse(this._playlistData, {
                keys: ['title', 'channelTitle'],
                threshold: 0.3,
                includeScore: true,
            });
        }
    }

    getItemVideoId(item) {
        if (!item) return null;
        return item.vid || item.video_id || item.videoId || item.id || null;
    }

    computeNowPlayingSignature(queue) {
        if (!Array.isArray(queue) || queue.length === 0) {
            return '0';
        }
        const ids = queue.map((item) => this.getItemVideoId(item) || '').join('|');
        return `${queue.length}:${ids}`;
    }

    syncModeButtons() {
        if (!this.shadowRoot) return;
        const buttons = this.shadowRoot.querySelectorAll('[data-mode]');
        buttons.forEach((button) => {
            const mode = button.getAttribute('data-mode');
            const isActive = mode === this.playlistMode;
            button.removeAttribute('disabled');
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            if (mode === 'user') {
                const hasUserPlaylist = this._playlistMap.size > 0 || this._userPlaylists.length > 0;
                button.classList.toggle('disabled', !hasUserPlaylist);
                button.setAttribute('aria-disabled', hasUserPlaylist ? 'false' : 'true');
                button.setAttribute('title', hasUserPlaylist ? 'Your saved playlist' : 'No saved tracks yet');
            }
            if (mode !== 'user') {
                button.classList.remove('disabled');
                button.setAttribute('aria-disabled', 'false');
            }
        });
    }

    setSearchOverlay(open, { focus = false, skipPersistence = false } = {}) {
        this.searchOverlayOpen = Boolean(open);
        if (!skipPersistence) {
            localStorage.setItem('playlistViewerSearchOpen', this.searchOverlayOpen ? 'true' : 'false');
        }

        const overlay = this.shadowRoot?.getElementById('search-overlay');
        if (overlay) {
            overlay.classList.toggle('open', this.searchOverlayOpen);
            overlay.setAttribute('aria-hidden', this.searchOverlayOpen ? 'false' : 'true');
        }

        this.updateSearchToggleState();

        if (focus && this.searchOverlayOpen) {
            requestAnimationFrame(() => {
                this.shadowRoot?.getElementById('search-input')?.focus();
            });
        }
    }

    updateSearchToggleState() {
        const toggle = this.shadowRoot?.getElementById('search-toggle-button');
        if (!toggle) return;
        const hasQuery = Boolean(this.currentSearchQuery && this.currentSearchQuery.trim().length > 0);
        toggle.classList.toggle('active', this.searchOverlayOpen || hasQuery);
        toggle.setAttribute('aria-pressed', this.searchOverlayOpen ? 'true' : 'false');
        const tooltip = hasQuery ? 'Search active' : 'Search playlist';
        if (!this.searchOverlayOpen) {
            toggle.setAttribute('title', tooltip);
        } else {
            toggle.setAttribute('title', 'Hide search');
        }
    }

    updateChronButtonVisual() {
        const chronButton = this.shadowRoot?.getElementById('chron-button');
        if (!chronButton) return;
        const iconSpan = chronButton.querySelector('.icon');
        const newestFirst = this.playlistSortDir === 'desc';
        if (iconSpan) {
            iconSpan.textContent = newestFirst ? '▼' : '▲';
        } else {
            chronButton.textContent = newestFirst ? '▼' : '▲';
        }
        const title = newestFirst ? 'Newest first' : 'Oldest first';
        chronButton.setAttribute('title', title);
        chronButton.setAttribute('aria-label', `${title}. Click to switch order.`);
    }

    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    resolvePlaybackDirective(musicPlayer) {
        if (!musicPlayer) {
            return this.getSharedPlaybackFlag();
        }

        const ownsPlayback =
            (typeof musicPlayer.isPrimaryWorkspace === 'function' && musicPlayer.isPrimaryWorkspace()) ||
            (typeof musicPlayer.ownsPlayback === 'function' && musicPlayer.ownsPlayback());

        if (ownsPlayback) {
            if (typeof musicPlayer.isPlaying === 'boolean') {
                return musicPlayer.isPlaying;
            }
            return this.getSharedPlaybackFlag();
        }

        return this.getSharedPlaybackFlag();
    }

    getSharedPlaybackFlag() {
        try {
            if (window.sharedStateManager && typeof window.sharedStateManager.get === 'function') {
                const sharedFlag = window.sharedStateManager.get('isPlaying');
                if (typeof sharedFlag === 'boolean') {
                    return sharedFlag;
                }
            }
        } catch (err) {
            /* ignore shared state read issues */
        }

        const heartbeat = window.taskbarHeartbeat;
        if (heartbeat && typeof heartbeat.get === 'function') {
            const hbFlag = heartbeat.get('isPlaying');
            if (typeof hbFlag === 'boolean') {
                return hbFlag;
            }
        }

        return undefined;
    }

    canCurrentUserAddToPlaylist() {
        if (!this.userStatus) return false;
        return Boolean(this.userStatus.isLoggedIn || this.userStatus.isAdmin);
    }

    async ensureUserStatus() {
        if (this.userStatus && this.userStatus.checked) {
            return this.userStatus;
        }

        try {
            const response = await fetch(xaviApiUrl('/getUserStatus'));
            const data = await response.json();
            const success = data && Object.prototype.hasOwnProperty.call(data, 'success') ? Boolean(data.success) : true;
            this.userStatus = {
                checked: true,
                isLoggedIn: success && Boolean(data?.isLoggedIn),
                isAdmin: success && Boolean(data?.isAdmin)
            };
        } catch (err) {
            console.warn('[PlaylistViewer] Failed to retrieve user status:', err);
            this.userStatus = {
                checked: true,
                isLoggedIn: false,
                isAdmin: false
            };
        }

        window.__pgmusicUserStatus = this.userStatus;
        return this.userStatus;
    }

    /**
     * Ensure the slide-out overlay uses viewport-based sizing, not the parent grid,
     * and is responsive:
     * - Desktop (>= 1024px): 50% width
     * - Tablet/Mobile: 100% width
     */
    applyResponsiveWidth() {
        const shell = this.shadowRoot?.getElementById('playlist-shell');
        if (!shell) return;

        const widthValue = '100%';

        // Keep the shell sized by its container so the overlay can control placement.
        shell.style.position = 'relative';
        shell.style.top = 'auto';
        shell.style.right = 'auto';
        shell.style.bottom = 'auto';
        shell.style.left = 'auto';
        shell.style.height = '100%';
        shell.style.maxHeight = '100%';
        shell.style.width = widthValue;
        shell.style.maxWidth = widthValue;
        shell.style.overflow = 'hidden';
    }

    scheduleMarqueeMeasure() {
        if (this._marqueeMeasureIdleCallback !== null) {
            return;
        }
        if (typeof requestIdleCallback === 'function') {
            this._marqueeMeasureIdleCallback = requestIdleCallback((deadline) => {
                this._marqueeMeasureIdleCallback = null;
                this.refreshMarqueeMeasurements(deadline);
            }, { timeout: 300 });
        } else {
            setTimeout(() => {
                this.refreshMarqueeMeasurements(null);
            }, 100);
        }
    }

    refreshMarqueeMeasurements(deadline = null) {
        const playlistScroll = this.getScrollElement();
        const items = this.shadowRoot?.querySelectorAll('.playlist-item');
        if (!items || !items.length || !playlistScroll) {
            return;
        }
        const scrollTop = playlistScroll.scrollTop;
        const viewportHeight = playlistScroll.clientHeight;
        const bufferPx = viewportHeight;

        // Avoid scanning from the top of a huge list every time. Estimate a slice
        // of items around the viewport and only measure those.
        const itemsArr = Array.from(items);
        const estimatedItemHeight = this._estimatedItemHeight || itemsArr[0]?.offsetHeight || 56;
        if (!this._estimatedItemHeight && Number.isFinite(estimatedItemHeight) && estimatedItemHeight > 0) {
            this._estimatedItemHeight = estimatedItemHeight;
        }

        const startIndex = Math.max(0, Math.floor((scrollTop - bufferPx) / estimatedItemHeight));
        const endIndex = Math.min(itemsArr.length, Math.ceil((scrollTop + viewportHeight + bufferPx) / estimatedItemHeight));

        const maxMeasuredPerBatch = 8;
        const maxScannedPerBatch = 80;
        const maxMs = deadline && typeof deadline.timeRemaining === 'function'
            ? Math.max(4, Math.min(10, deadline.timeRemaining()))
            : 8;

        const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        let measured = 0;
        let scanned = 0;

        for (let i = startIndex; i < endIndex; i += 1) {
            const item = itemsArr[i];
            if (!item) continue;
            scanned += 1;

            // Hard bounds for worst-case lists.
            if (measured >= maxMeasuredPerBatch) break;
            if (scanned >= maxScannedPerBatch) break;

            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            if (now - t0 > maxMs) break;

            this.evaluateMarqueeForElement(item);
            measured += 1;
        }

        // If there are still items in-range to measure, continue later.
        if (startIndex < endIndex && (measured >= maxMeasuredPerBatch || scanned >= maxScannedPerBatch)) {
            this.scheduleMarqueeMeasure();
        }
    }

    /* --- Custom scrollbar implementation (JS-driven) --- */
    createCustomScrollbar() {
        const playlistScroll = this.shadowRoot?.getElementById('playlist-scroll');
        if (!playlistScroll) return;

        // Ensure container is positioned for absolute child
        playlistScroll.style.position = playlistScroll.style.position || 'relative';
        playlistScroll.style.paddingRight = playlistScroll.style.paddingRight || '46px';

        // Create track
        const track = document.createElement('div');
        track.className = 'pg-scroll-track';
        Object.assign(track.style, {
            position: 'absolute',
            top: '8px',
            right: '8px',
            width: '30px',
            bottom: '8px',
            borderRadius: '12px',
            background: 'rgba(0,0,0,0.12)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)'
        });

        // Create thumb
        const thumb = document.createElement('div');
        thumb.className = 'pg-scroll-thumb';
        Object.assign(thumb.style, {
            position: 'absolute',
            left: '4px',
            right: '4px',
            height: '40px',
            top: '0px',
            borderRadius: '10px',
            background: 'linear-gradient(180deg, rgba(74,158,255,0.28), rgba(74,158,255,0.10))',
            boxShadow: '0 2px 8px rgba(0,0,0,0.45)',
            cursor: 'pointer',
            touchAction: 'none'
        });

        track.appendChild(thumb);
        playlistScroll.appendChild(track);

        // Store refs
        this._customScroll = { track, thumb, container: playlistScroll };

        // Event handlers
        this._onCustomScrollHandler = () => this.updateCustomScrollbar();
        this._onThumbPointerDown = (e) => this._startThumbDrag(e);

        playlistScroll.addEventListener('scroll', this._onCustomScrollHandler);
        thumb.addEventListener('pointerdown', this._onThumbPointerDown);

        // Initial update
        this.updateCustomScrollbar();
    }

    updateCustomScrollbar() {
        const cs = this._customScroll;
        if (!cs) return;
        const { container, thumb, track } = cs;
        const scrollHeight = container.scrollHeight;
        const clientHeight = container.clientHeight;
        const trackHeight = Math.max(24, track.clientHeight);
        const thumbRatio = clientHeight / scrollHeight;
        const thumbHeight = Math.max(26, Math.floor(trackHeight * thumbRatio));
        const maxThumbTop = trackHeight - thumbHeight;
        const scrollRatio = container.scrollTop / Math.max(1, scrollHeight - clientHeight);
        const thumbTop = Math.round(maxThumbTop * scrollRatio);
        thumb.style.height = thumbHeight + 'px';
        thumb.style.top = thumbTop + 'px';
    }

    _startThumbDrag(e) {
        e.preventDefault();
        const cs = this._customScroll;
        if (!cs) return;
        const { container, track, thumb } = cs;
        const trackRect = track.getBoundingClientRect();
        const thumbRect = thumb.getBoundingClientRect();
        const startY = (e.clientY !== undefined) ? e.clientY : e.touches && e.touches[0] && e.touches[0].clientY;
        const startThumbTop = parseInt(thumb.style.top || '0', 10);

        const onMove = (moveEvent) => {
            const clientY = (moveEvent.clientY !== undefined) ? moveEvent.clientY : moveEvent.touches && moveEvent.touches[0] && moveEvent.touches[0].clientY;
            const dy = clientY - startY;
            const trackHeight = Math.max(24, track.clientHeight);
            const thumbHeight = parseInt(thumb.style.height || '40', 10);
            const maxThumbTop = trackHeight - thumbHeight;
            const newTop = Math.max(0, Math.min(maxThumbTop, startThumbTop + dy));
            const scrollRatio = newTop / Math.max(1, maxThumbTop);
            container.scrollTop = Math.round(scrollRatio * (container.scrollHeight - container.clientHeight));
        };

        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('touchend', onUp);
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onUp);
    }

    destroyCustomScrollbar() {
        const cs = this._customScroll;
        if (!cs) return;
        const { container, track, thumb } = cs;
        container.removeEventListener('scroll', this._onCustomScrollHandler);
        thumb.removeEventListener('pointerdown', this._onThumbPointerDown);
        if (track.parentNode === container) container.removeChild(track);
        this._customScroll = null;
    }

    getScrollHost() {
        return this.shadowRoot?.getElementById('playlist-scroll') || null;
    }

    getScrollElement() {
        if (this._simpleBarInstance && typeof this._simpleBarInstance.getScrollElement === 'function') {
            return this._simpleBarInstance.getScrollElement();
        }
        return this.getScrollHost();
    }

    getScrollContentElement() {
        if (this._simpleBarInstance && typeof this._simpleBarInstance.getContentElement === 'function') {
            return this._simpleBarInstance.getContentElement();
        }
        return this.getScrollHost();
    }

    bindScrollEvents() {
        const scrollEl = this.getScrollElement();
        if (!scrollEl) return;
        if (this._boundScrollEl === scrollEl) {
            return;
        }
        this.unbindScrollEvents();
        scrollEl.addEventListener('scroll', this.onPlaylistScroll, { passive: true });
        scrollEl.addEventListener('input', this.onPlaylistScrollInput);
        this._boundScrollEl = scrollEl;

        const scrollHost = this.getScrollHost();
        if (scrollHost) {
            scrollHost.removeEventListener('pointerenter', this.handlePlaylistPointerEnter);
            scrollHost.removeEventListener('pointerleave', this.handlePlaylistPointerLeave);
            scrollHost.removeEventListener('pointercancel', this.handlePlaylistPointerLeave);
            scrollHost.addEventListener('pointerenter', this.handlePlaylistPointerEnter);
            scrollHost.addEventListener('pointerleave', this.handlePlaylistPointerLeave);
            scrollHost.addEventListener('pointercancel', this.handlePlaylistPointerLeave);
            this._boundScrollHost = scrollHost;
        }
    }

    unbindScrollEvents() {
        if (!this._boundScrollEl) return;
        this._boundScrollEl.removeEventListener('scroll', this.onPlaylistScroll);
        this._boundScrollEl.removeEventListener('input', this.onPlaylistScrollInput);
        this._boundScrollEl = null;

        if (this._boundScrollHost) {
            this._boundScrollHost.removeEventListener('pointerenter', this.handlePlaylistPointerEnter);
            this._boundScrollHost.removeEventListener('pointerleave', this.handlePlaylistPointerLeave);
            this._boundScrollHost.removeEventListener('pointercancel', this.handlePlaylistPointerLeave);
            this._boundScrollHost = null;
        }
    }

    /* --- SimpleBar integration (preferred) --- */
    static loadSimpleBarScript() {
        if (window.SimpleBar) return Promise.resolve();
        if (PlaylistViewer._simpleBarScriptPromise) {
            return PlaylistViewer._simpleBarScriptPromise;
        }
        const jsSrc = 'https://cdn.jsdelivr.net/npm/simplebar@6.2.3/dist/simplebar.min.js';
        PlaylistViewer._simpleBarScriptPromise = new Promise((resolve, reject) => {
            const existing = document.querySelector('script[data-pgmusic-simplebar="1"]');
            if (existing) {
                existing.addEventListener('load', () => resolve());
                existing.addEventListener('error', () => reject(new Error('Failed to load SimpleBar script')));
                return;
            }
            const script = document.createElement('script');
            script.src = jsSrc;
            script.async = true;
            script.dataset.pgmusicSimplebar = '1';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load SimpleBar script'));
            document.head.appendChild(script);
        });
        return PlaylistViewer._simpleBarScriptPromise;
    }

    static loadSimpleBarCss() {
        if (PlaylistViewer._simpleBarCssPromise) {
            return PlaylistViewer._simpleBarCssPromise;
        }
        const cssHref = 'https://cdn.jsdelivr.net/npm/simplebar@6.2.3/dist/simplebar.min.css';
        PlaylistViewer._simpleBarCssPromise = fetch(cssHref)
            .then((resp) => (resp.ok ? resp.text() : ''))
            .catch(() => '');
        return PlaylistViewer._simpleBarCssPromise;
    }

    injectSimpleBarTheme() {
        if (this._simplebarThemeInjected) return;
        const style = document.createElement('style');
        style.textContent = `
            .simplebar-track.simplebar-vertical {
                width: 30px;
                right: 8px;
                border-radius: 14px;
                background: rgba(0, 0, 0, 0.25);
            }
            .simplebar-track.simplebar-vertical .simplebar-scrollbar::before {
                border-radius: 12px;
                background: linear-gradient(180deg, rgba(74, 158, 255, 0.35), rgba(74, 158, 255, 0.12));
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
            }
            .simplebar-track.simplebar-vertical .simplebar-scrollbar.simplebar-visible::before {
                opacity: 1;
            }
            .simplebar-track.simplebar-vertical .simplebar-scrollbar::before {
                opacity: 0.85;
            }
        `;
        this.shadowRoot.appendChild(style);
        this._simplebarThemeInjected = true;
    }

    async ensureSimpleBar() {
        const host = this.getScrollHost();
        if (!host) throw new Error('playlist-scroll host missing');
        if (this._simpleBarInstance) return this._simpleBarInstance;

        await PlaylistViewer.loadSimpleBarScript();
        const cssText = await PlaylistViewer.loadSimpleBarCss();
        if (cssText && !this._simplebarCssInjected) {
            const cssStyle = document.createElement('style');
            cssStyle.textContent = cssText;
            this.shadowRoot.appendChild(cssStyle);
            this._simplebarCssInjected = true;
        }
        this.injectSimpleBarTheme();

        this._simpleBarInstance = new SimpleBar(host, {
            autoHide: false,
            scrollbarMinSize: 48
        });
        return this._simpleBarInstance;
    }

    destroySimpleBar() {
        if (!this._simpleBarInstance) return;
        try {
            if (typeof this._simpleBarInstance.unMount === 'function') {
                this._simpleBarInstance.unMount();
            } else if (typeof this._simpleBarInstance.destroy === 'function') {
                this._simpleBarInstance.destroy();
            }
        } catch (err) {
            // ignore
        }
        this._simpleBarInstance = null;
    }

    evaluateMarqueeForElement(itemElement) {
        if (!itemElement) return;
        const infoWrapper = itemElement.querySelector('.track-info');
        const staticLabel = itemElement.querySelector('.track-info-static');
        if (!infoWrapper || !staticLabel) return;

        const availableWidth = infoWrapper.clientWidth;
        let labelWidth = Number(itemElement.dataset.labelWidth);
        if (!Number.isFinite(labelWidth) || labelWidth <= 0) {
            const wasActive = itemElement.classList.contains('marquee-active');
            if (wasActive) {
                itemElement.classList.remove('marquee-active');
            }
            labelWidth = staticLabel.scrollWidth;
            if (labelWidth > 0) {
                itemElement.dataset.labelWidth = String(labelWidth);
            }
            if (wasActive) {
                itemElement.classList.add('marquee-active');
            }
        }

        const marqueeTrack = itemElement.querySelector('.track-info-marquee-track');
        const needsMarquee = labelWidth > availableWidth + 4;
        itemElement.classList.toggle('marquee-active', needsMarquee);

        if (!marqueeTrack) {
            return;
        }

        if (needsMarquee) {
            const cycleSpan = marqueeTrack.querySelector('.track-info-marquee-text');
            let cycleWidth = cycleSpan ? cycleSpan.getBoundingClientRect().width : labelWidth;
            if (!Number.isFinite(cycleWidth) || cycleWidth <= 0) {
                cycleWidth = labelWidth;
            }
            cycleWidth = Math.max(1, cycleWidth);
            const pxPerSecond = 36;
            const minDuration = 12;
            const maxDuration = 28;
            const targetDuration = Math.max(minDuration, Math.min(maxDuration, cycleWidth / pxPerSecond));
            // Feed CSS vars so the marquee loops without jump seams.
            marqueeTrack.style.setProperty('--marquee-cycle', `${cycleWidth.toFixed(2)}px`);
            marqueeTrack.style.setProperty('--marquee-duration', `${targetDuration.toFixed(2)}s`);
        } else {
            marqueeTrack.style.removeProperty('--marquee-cycle');
            marqueeTrack.style.removeProperty('--marquee-duration');
        }
    }

    render(filteredData = this._playlistData) {
        this._filteredPlaylistData = filteredData; // Store current filtered playlist
        const contentRoot = this.getScrollContentElement();
        if (!contentRoot) {
            console.warn('[PlaylistViewer] Missing scroll content container during render');
            return;
        }
        const token = ++this._renderToken;
        contentRoot.innerHTML = '';
        // Build displayData. If searching, keep relevance order (filteredData passed in).
        // Otherwise, use getCurrentPlaylist() which returns items sorted deterministically by timestamp when available.
        let displayData;
        if (this.isSearching) {
            displayData = Array.isArray(filteredData) ? filteredData.slice() : [];
        } else {
            displayData = this.getCurrentPlaylist();
        }

        if (!displayData.length) {
            const placeholder = document.createElement('div');
            placeholder.className = 'empty-state';
            placeholder.innerHTML = this.isSearching
                ? '<strong>No matches</strong><span>Try different keywords or clear the search.</span>'
                : '<strong>No tracks yet</strong><span>Add media to see your playlist here.</span>';
            contentRoot.appendChild(placeholder);
            this.restoreScrollPosition();
            this.updateProgress();
            return;
        }

        const makeEntry = (item, displayIndex) => {
            const trackNumber = displayIndex >= 0 ? displayIndex + 1 : '?';
            const videoId = this.getItemVideoId(item);
            const entry = document.createElement('div');
            entry.className = 'playlist-item';
            entry.setAttribute('data-video-id', videoId);

            const header = document.createElement('div');
            header.className = 'playlist-item-header';

            const numberSpan = document.createElement('span');
            numberSpan.className = 'track-number';
            numberSpan.textContent = trackNumber;

            const infoWrapper = document.createElement('div');
            infoWrapper.className = 'track-info';
            const channelTitle = item.channelTitle || 'Unknown Channel';
            const title = item.title || videoId || 'Untitled Track';
            const baseLabel = `${channelTitle} — ${title}`;

            const staticLabel = document.createElement('span');
            staticLabel.className = 'track-info-static';
            staticLabel.textContent = baseLabel;
            infoWrapper.appendChild(staticLabel);

            const marquee = document.createElement('div');
            marquee.className = 'track-info-marquee';
            const marqueeTrack = document.createElement('div');
            marqueeTrack.className = 'track-info-marquee-track';
            const loopText = `${baseLabel}  |  `;
            for (let i = 0; i < 2; i += 1) {
                const loopSpan = document.createElement('span');
                loopSpan.className = 'track-info-marquee-text';
                loopSpan.textContent = loopText;
                marqueeTrack.appendChild(loopSpan);
            }
            marquee.appendChild(marqueeTrack);
            infoWrapper.appendChild(marquee);

            header.appendChild(numberSpan);
            header.appendChild(infoWrapper);

            if (this.canCurrentUserAddToPlaylist()) {
                const addButton = document.createElement('button');
                addButton.type = 'button';
                addButton.className = 'track-add-button';
                addButton.title = 'Add to a playlist';
                addButton.setAttribute('aria-label', 'Add to a playlist');
                addButton.textContent = '+';
                addButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.openAddToPlaylistModal(item);
                });
                header.appendChild(addButton);
            }

            const metaRow = document.createElement('div');
            metaRow.className = 'playlist-meta-row';

            const currentTime = document.createElement('span');
            currentTime.className = 'time-current';
            currentTime.setAttribute('data-current-time', '');
            currentTime.textContent = '0:00';

            const sliderWrap = document.createElement('div');
            sliderWrap.className = 'time-slider-wrap';
            const timeSlider = document.createElement('input');
            timeSlider.type = 'range';
            timeSlider.className = 'track-time-slider';
            timeSlider.min = '0';
            const durationSeconds = Math.max(0, item.duration || 0);
            this._updatingSliderProgrammatically = true;
            timeSlider.max = durationSeconds > 0 ? durationSeconds : 0;
            timeSlider.value = '0';
            timeSlider.dataset.duration = String(durationSeconds);
            this._updatingSliderProgrammatically = false;
            timeSlider.disabled = durationSeconds === 0;
            timeSlider.addEventListener('click', (e) => e.stopPropagation());
            
            // Show a tooltip with the hover time on this slider
            timeSlider.addEventListener('mousemove', (e) => {
                const rect = timeSlider.getBoundingClientRect();
                const width = rect.width || 1;
                const offsetX = e.clientX - rect.left;
                const ratio = Math.min(Math.max(offsetX / width, 0), 1);

                const duration = parseFloat(timeSlider.dataset.duration || '0') || 0;
                const hoverSeconds = duration * ratio;

                // Use the playlist viewer's formatTime helper
                if (typeof this.formatTime === 'function') {
                    timeSlider.title = this.formatTime(hoverSeconds);
                } else {
                    // Simple fallback MM:SS
                    const mins = Math.floor(hoverSeconds / 60);
                    const secs = Math.floor(hoverSeconds % 60);
                    timeSlider.title = `${mins}:${secs.toString().padStart(2, '0')}`;
                }
            });

            timeSlider.addEventListener('mouseleave', () => {
                // Clear tooltip when leaving
                timeSlider.removeAttribute('title');
            });
            
            sliderWrap.appendChild(timeSlider);

            const totalTime = document.createElement('span');
            totalTime.className = 'time-total';
            totalTime.setAttribute('data-total-time', '');
            totalTime.dataset.duration = String(durationSeconds);
            totalTime.textContent = durationSeconds > 0 ? this.formatTime(durationSeconds) : '--:--';

            metaRow.appendChild(currentTime);
            metaRow.appendChild(sliderWrap);
            metaRow.appendChild(totalTime);

            entry.appendChild(header);
            entry.appendChild(metaRow);

            entry.addEventListener('click', (e) => {
                if (e.target.classList.contains('track-time-slider')) return;
                this.dispatchEvent(
                    new CustomEvent('select-video', {
                        detail: { videoId },
                        bubbles: true,
                        composed: true
                    })
                );
                // Optimistically highlight the selection so users see immediate feedback
                this.highlightVideo(videoId);
                const scrollEl = this.getScrollElement();
                if (scrollEl) {
                    localStorage.setItem('playlistScrollPosition', scrollEl.scrollTop);
                }
            });

            return entry;
        };

        let index = 0;
        const renderBatch = (deadline) => {
            if (token !== this._renderToken) {
                return;
            }

            const frag = document.createDocumentFragment();
            const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const maxMs = deadline && typeof deadline.timeRemaining === 'function'
                ? Math.max(4, Math.min(12, deadline.timeRemaining()))
                : 10;

            while (index < displayData.length) {
                frag.appendChild(makeEntry(displayData[index], index));
                index += 1;

                const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                if (now - t0 > maxMs) {
                    break;
                }
            }

            contentRoot.appendChild(frag);

            if (index < displayData.length) {
                if (typeof requestIdleCallback === 'function') {
                    requestIdleCallback(renderBatch, { timeout: 300 });
                } else {
                    setTimeout(() => renderBatch(null), 0);
                }
                return;
            }

            // Reset marquee measurement cache and schedule a new measurement pass
            this._measuredItems = new WeakSet();
            this.scheduleMarqueeMeasure();

            if (this._simpleBarInstance && typeof this._simpleBarInstance.recalculate === 'function') {
                this._simpleBarInstance.recalculate();
            }

            this.restoreScrollPosition();
            this.updateProgress(); // Update progress display after rendering
        };

        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(renderBatch, { timeout: 300 });
        } else {
            setTimeout(() => renderBatch(null), 0);
        }
    }

    async fetchUserPlaylists() {
        try {
            const response = await fetch(xaviApiUrl('/getUserPlaylists'));
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const payload = await response.json();
            const playlists = Array.isArray(payload?.playlists) ? payload.playlists : [];
            this._userPlaylists = playlists.map((p) => ({
                    id: String(p.id),
                    name: p.name
                }));
            const validIds = new Set(this._userPlaylists.map((p) => p.id));
            Array.from(this._playlistMap.keys()).forEach((key) => {
                if (!validIds.has(key)) {
                    this._playlistMap.delete(key);
                }
            });
            console.log('[PlaylistViewer] Fetched user playlists:', this._userPlaylists);
        } catch (error) {
            console.error('Error fetching user playlists:', error);
            this._userPlaylists = [];
        } finally {
            this.ensureValidSelection();
        }
    }

    ensureValidSelection() {
        if (this.playlistMode === 'now-playing') {
            return;
        }
        const storedSelection = localStorage.getItem('selectedPlaylistId');
        if (!this._selectedPlaylistId && storedSelection) {
            this._selectedPlaylistId = storedSelection;
        }

        if (!this._selectedPlaylistId) {
            this._selectedPlaylistId = 'cached';
        }

        const customIds = new Set(this._userPlaylists.map((p) => String(p.id)));

        if (this._selectedPlaylistId !== 'cached' && !customIds.has(String(this._selectedPlaylistId))) {
            const fallbackId = this._lastCustomPlaylistId && customIds.has(String(this._lastCustomPlaylistId))
                ? String(this._lastCustomPlaylistId)
                : (customIds.size ? customIds.values().next().value : 'cached');
            this._selectedPlaylistId = fallbackId || 'cached';
        }

        if (this._selectedPlaylistId !== 'cached' && customIds.has(String(this._selectedPlaylistId))) {
            this.playlistMode = 'user';
            this._lastCustomPlaylistId = String(this._selectedPlaylistId);
        } else {
            this._selectedPlaylistId = 'cached';
            this.playlistMode = 'cached';
        }

        localStorage.setItem('selectedPlaylistId', this._selectedPlaylistId);
        localStorage.setItem('playlistViewerMode', this.playlistMode);
    }

    async fetchSongsForPlaylist(playlistId) {
        try {
            const response = await fetch(
                xaviApiUrl(`/getSongsForPlaylist?playlistId=${encodeURIComponent(playlistId)}`)
            );
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const payload = await response.json();
            const songs = Array.isArray(payload?.songs) ? payload.songs : [];
            const playlistKey = String(playlistId);
            this._playlistMap.set(playlistKey, songs);
            this._selectedPlaylistId = playlistKey;
            this._lastCustomPlaylistId = playlistKey;
            this._playlistData = this._playlistMap.get(playlistKey);
            this.updatePlaylistView({ highlight: false });
            console.log(`[PlaylistViewer] Fetched ${songs.length} songs for playlist ${playlistId}`);
        } catch (error) {
            console.error(`Error fetching songs for playlist ${playlistId}:`, error);
            if (this._lastCustomPlaylistId === String(playlistId)) {
                this._lastCustomPlaylistId = null;
            }
            this._playlistMap.delete(String(playlistId));
            this._playlistData = [];
            this.updatePlaylistView({ highlight: false });
        }
    }

    openAddToPlaylistModal(songData) {
        const modal = this.shadowRoot.getElementById('add-to-playlist-modal');
        if (!modal) return;

        // Store song data on the modal element
        modal.dataset.songData = JSON.stringify(songData);

        const playlistSelect = modal.querySelector('#modal-playlist-select');
        playlistSelect.innerHTML = ''; // Clear previous options

        // Populate with user's playlists
        if (this._userPlaylists.length > 0) {
            this._userPlaylists.forEach(playlist => {
                const option = document.createElement('option');
                option.value = playlist.id;
                option.textContent = playlist.name;
                playlistSelect.appendChild(option);
            });
        } else {
            const noPlaylistsOption = document.createElement('option');
            noPlaylistsOption.textContent = 'No playlists available';
            noPlaylistsOption.disabled = true;
            playlistSelect.appendChild(noPlaylistsOption);
        }

        modal.style.display = 'block';
    }

    closeAddToPlaylistModal() {
        const modal = this.shadowRoot.getElementById('add-to-playlist-modal');
        if (modal) {
            modal.style.display = 'none';
            modal.dataset.songData = ''; // Clear stored data
            modal.querySelector('#new-playlist-name').value = '';
            modal.querySelector('#new-playlist-section').style.display = 'none';
        }
    }

    async handleAddToExistingPlaylist() {
        const modal = this.shadowRoot.getElementById('add-to-playlist-modal');
        const playlistId = modal.querySelector('#modal-playlist-select').value;
        const songData = JSON.parse(modal.dataset.songData);

        if (!playlistId || !songData) {
            console.error('Missing playlist ID or song data');
            return;
        }

        try {
            const response = await fetch(xaviApiUrl('/addSongToPlaylist'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `playlistId=${encodeURIComponent(playlistId)}&videoId=${encodeURIComponent(this.getItemVideoId(songData))}`
            });

            if (!response.ok) throw new Error('Failed to add song');
            
            const result = await response.json();
            if (result && result.success) {
                console.log('Song added successfully');
                // If the user is currently viewing the playlist they added to, refresh it
                if (this._selectedPlaylistId == playlistId) {
                    await this.fetchSongsForPlaylist(playlistId);
                } else {
                    this._playlistMap.delete(String(playlistId));
                }
            } else {
                throw new Error(result.message || 'Server returned an error');
            }

        } catch (error) {
            console.error('Error adding song to playlist:', error);
            // Optionally show an error to the user
        } finally {
            this.closeAddToPlaylistModal();
        }
    }

    async handleCreateAndAddPlaylist() {
        const modal = this.shadowRoot.getElementById('add-to-playlist-modal');
        const newPlaylistName = modal.querySelector('#new-playlist-name').value.trim();
        const songData = JSON.parse(modal.dataset.songData);

        if (!newPlaylistName) {
            alert('Please enter a name for the new playlist.');
            return;
        }

        try {
            // 1. Create the new playlist
            const createResponse = await fetch(xaviApiUrl('/createPlaylist'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `name=${encodeURIComponent(newPlaylistName)}`
            });

            if (!createResponse.ok) throw new Error('Failed to create playlist');
            const createResult = await createResponse.json();
            if (!createResult.success || !createResult.playlist || !createResult.playlist.id) {
                throw new Error(createResult.message || 'Server failed to create playlist');
            }

            const newPlaylistId = String(createResult.playlist.id);
            console.log(`Playlist created with ID: ${newPlaylistId}`);

            // 2. Refresh the playlist list
            await this.fetchUserPlaylists();
            this.ensureValidSelection(); // Update selection state
            
            // 3. Add the song to the new playlist
            const addResponse = await fetch(xaviApiUrl('/addSongToPlaylist'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `playlistId=${encodeURIComponent(newPlaylistId)}&videoId=${encodeURIComponent(this.getItemVideoId(songData))}`
            });

            if (!addResponse.ok) throw new Error('Failed to add song to new playlist');
            const addResult = await addResponse.json();
            if (!addResult.success) {
                throw new Error(addResult.message || 'Server returned an error while adding song');
            }
            
            console.log('Song added to new playlist successfully');
            
            // 4. Switch to the new playlist
            this._selectedPlaylistId = newPlaylistId;
            this._lastCustomPlaylistId = newPlaylistId;
            this.playlistMode = 'user';
            localStorage.setItem('selectedPlaylistId', newPlaylistId);
            localStorage.setItem('playlistViewerMode', 'user');
            this.ensureValidSelection(); // ensure state stays aligned
            await this.fetchSongsForPlaylist(newPlaylistId);

        } catch (error) {
            console.error('Error in create-and-add process:', error);
        } finally {
            this.closeAddToPlaylistModal();
        }
    }

    computeOrderedPlaylist(sourceItems = []) {
        const source = Array.isArray(sourceItems) ? sourceItems.slice() : [];
        if (!source.length) return [];

        // Helper to parse various timestamp formats (ISO or 'YYYY-MM-DD HH:MM:SS')
        const parseTs = (val) => {
            if (!val) return 0;
            if (typeof val === 'number') return val;
            try {
                // Normalize space-separated datetime to ISO
                let s = String(val);
                if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
                    s = s.replace(' ', 'T') + 'Z';
                }
                const p = Date.parse(s);
                return Number.isNaN(p) ? 0 : p;
            } catch (e) {
                return 0;
            }
        };

        const withTs = [];
        const withoutTs = [];
        const normalizePos = (val) => {
            if (val === null || val === undefined) return null;
            if (typeof val === 'number') {
                return Number.isFinite(val) ? val : null;
            }
            if (typeof val === 'string') {
                const trimmed = val.trim();
                if (trimmed === '') return null;
                const num = Number(trimmed);
                return Number.isFinite(num) ? num : null;
            }
            return null;
        };

        source.forEach((item, idx) => {
            const tsValue = item.playlist_added_at || item.playlistAddedAt || item.updated_at || item.added_at || item.created_at || null;
            const parsed = parseTs(tsValue);
            const posValue = normalizePos(item.playlist_position ?? item.playlistPosition);
            if (parsed > 0) {
                withTs.push({ item, ts: parsed, idx, pos: posValue });
            } else {
                withoutTs.push({ item, idx, pos: posValue });
            }
        });

        if (withTs.length) {
            withTs.sort((a, b) => {
                if (a.ts !== b.ts) {
                    return this.playlistSortDir === 'desc' ? b.ts - a.ts : a.ts - b.ts;
                }
                if (a.pos !== null && b.pos !== null && a.pos !== b.pos) {
                    return this.playlistSortDir === 'desc' ? a.pos - b.pos : b.pos - a.pos;
                }
                const av = String(this.getItemVideoId(a.item) || '');
                const bv = String(this.getItemVideoId(b.item) || '');
                if (av === bv) return a.idx - b.idx;
                return this.playlistSortDir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv);
            });
            const ordered = withTs.map((x) => x.item);
            if (withoutTs.length) {
                const tail = withoutTs.slice().sort((a, b) => {
                    if (a.pos !== null && b.pos !== null && a.pos !== b.pos) {
                        return this.playlistSortDir === 'desc' ? a.pos - b.pos : b.pos - a.pos;
                    }
                    return a.idx - b.idx;
                });
                ordered.push(...tail.map((x) => x.item));
            }
            console.log('[PlaylistViewer] computeOrderedPlaylist: withTs=', withTs.length, 'withoutTs=', withoutTs.length, 'orderedCount=', ordered.length);
            return ordered;
        }

        const fallbackOrdered = withoutTs
            .slice()
            .sort((a, b) => {
                if (a.pos !== null && b.pos !== null && a.pos !== b.pos) {
                    return this.playlistSortDir === 'desc' ? a.pos - b.pos : b.pos - a.pos;
                }
                return this.playlistSortDir === 'desc' ? b.idx - a.idx : a.idx - b.idx;
            })
            .map((x) => x.item);
        console.log('[PlaylistViewer] computeOrderedPlaylist: fallback ordering, sortDir=', this.playlistSortDir, 'resultCount=', fallbackOrdered.length);
        return fallbackOrdered;
    }

    // Get the current displayed playlist (filtered or full)
    getCurrentPlaylist() {
        if (this.isSearching) {
            return Array.isArray(this._filteredPlaylistData) ? this._filteredPlaylistData.slice() : [];
        }
        return this.computeOrderedPlaylist(this._playlistData);
    }

    orderSearchResults(results) {
        if (!Array.isArray(results) || !results.length) return [];
        const seen = new Map();
        results.forEach((entry) => {
            const candidate = entry && entry.item ? entry.item : entry;
            const vid = this.getItemVideoId(candidate);
            if (vid && !seen.has(vid)) {
                seen.set(vid, candidate);
            }
        });

        const orderedPlaylist = this.computeOrderedPlaylist(this._playlistData);
        const filtered = orderedPlaylist.filter((item) => {
            const vid = this.getItemVideoId(item);
            return vid && seen.has(vid);
        });

        if (filtered.length) {
            return filtered;
        }

        return Array.from(seen.values());
    }
    
    performSearch(rawQuery, options = {}) {
        const query = typeof rawQuery === 'string' ? rawQuery : '';
        this.currentSearchQuery = query;
        localStorage.setItem('playlistViewerSearchQuery', query);

        const searchInput = this.shadowRoot.getElementById('search-input');
        if (!options.skipInputSync && searchInput && searchInput.value !== query) {
            searchInput.value = query;
        }

        const trimmed = query.trim();
        if (!trimmed) {
            this.isSearching = false;
            this.lastSearchIds.clear();
            this.render();
            if (!options.skipHighlight && this.currentVideoId) {
                this.highlightVideo(this.currentVideoId);
            }
            this.updateSearchToggleState();
            return;
        }

        if (!this.fuse) {
            this.isSearching = false;
            this.render();
            this.updateSearchToggleState();
            return;
        }

        if (!this.searchOverlayOpen) {
            this.setSearchOverlay(true, { focus: options.focus === true, skipPersistence: options.triggeredByUpdate && !options.forcePersist });
        }

        this.isSearching = true;
        const rawResults = this.fuse.search(trimmed, { limit: 200 });
        const ordered = this.orderSearchResults(rawResults);

        this.lastSearchIds.clear();
        ordered.forEach((item) => {
            const vid = this.getItemVideoId(item);
            if (vid) this.lastSearchIds.add(vid);
        });

        this.render(ordered);
        if (!options.skipHighlight && this.currentVideoId && this.lastSearchIds.has(this.currentVideoId)) {
            this.highlightVideo(this.currentVideoId);
        }
        this.updateSearchToggleState();
    }

    handleTabClick(event) {
        const button = event.target.closest('[data-mode]');
        if (!button) return;
        if (button.classList.contains('disabled') || button.getAttribute('aria-disabled') === 'true') {
            button.classList.add('shake');
            setTimeout(() => button.classList.remove('shake'), 400);
            return;
        }
        const mode = button.getAttribute('data-mode');
        if (!mode || mode === this.playlistMode) return;
        if (mode === 'user' && this._userPlaylists.length === 0) {
            button.classList.add('shake');
            setTimeout(() => button.classList.remove('shake'), 400);
            return;
        }
        this.switchPlaylistMode(mode);
    }

    handleSearchToggle() {
        const nextState = !this.searchOverlayOpen;
        this.setSearchOverlay(nextState, { focus: nextState });
    }

    handleSearchClear() {
        const input = this.shadowRoot?.getElementById('search-input');
        if (input) {
            input.value = '';
            input.focus();
        }
        this.performSearch('', {});
    }

    handleSearchInputKey(event) {
        if (event.key === 'Escape') {
            if (event.target.value) {
                event.preventDefault();
                event.target.value = '';
                this.performSearch('', {});
            } else {
                event.preventDefault();
                this.setSearchOverlay(false);
            }
        }
    }

    onPlaylistScrollInput(event) {
        if (!event.target.classList.contains('track-time-slider')) return;
        if (this._updatingSliderProgrammatically) {
            console.log('[PlaylistViewer] Ignoring programmatic slider update');
            return; // Ignore programmatic updates
        }

        const slider = event.target;
        const trackElement = slider.closest('.playlist-item');
        const videoId = trackElement?.getAttribute('data-video-id') || this.currentVideoId;
        const rawValue = parseFloat(slider.value);
        const durationValue = parseFloat(slider.dataset.duration || '0');
        if (!videoId || !Number.isFinite(rawValue)) {
            return;
        }

        this.beginAutoScrollSuppression('slider-scrub');

        const duration = Number.isFinite(durationValue) && durationValue > 0 ? durationValue : undefined;
        const musicPlayer = this.musicPlayerRef || document.querySelector('music-player');
        if (!musicPlayer || typeof musicPlayer.handleRemoteCommand !== 'function') {
            return;
        }

        if (typeof musicPlayer.markUserInteraction === 'function') {
            musicPlayer.markUserInteraction('playlist-slider');
        }

        // Update tooltip to match current slider position while scrubbing
        if (typeof this.formatTime === 'function') {
            slider.title = this.formatTime(rawValue);
        }
        
        const payload = {
            videoId,
            time: rawValue,
            duration,
            source: 'playlist-viewer',
            timestamp: Date.now()
        };

        const playbackDirective = this.resolvePlaybackDirective(musicPlayer);
        if (typeof playbackDirective === 'boolean') {
            payload.play = playbackDirective;
        }

        const dispatched = musicPlayer.handleRemoteCommand('seek', payload);

        if (!dispatched && musicPlayer.player && typeof musicPlayer.player.seekTo === 'function') {
            try {
                musicPlayer.player.seekTo(rawValue, true);
            } catch (err) {
                console.warn('[PlaylistViewer] Fallback seek failed:', err);
            }
        }

        if (videoId === this.currentVideoId) {
            this.currentTime = rawValue;
            if (duration) {
                this.currentDuration = duration;
            }
            this.updateProgress();
        }
    }

    onPlaylistScroll(event) {
        const playlistScroll = event.currentTarget;
        if (!playlistScroll) return;
        if (!this._isAutoScrolling) {
            this.beginAutoScrollSuppression('manual-scroll');
        }
        const threshold = 50;
        try {
            if (
                window.playlistState &&
                typeof window.playlistState.reachedEnd === 'function' &&
                !window.playlistState.reachedEnd() &&
                playlistScroll.scrollHeight - playlistScroll.scrollTop - playlistScroll.clientHeight < threshold
            ) {
                window.playlistState.fetchNextPage?.();
            }
        } catch (err) {
            console.warn('[PlaylistViewer] onPlaylistScroll fetch error:', err);
        }
        localStorage.setItem('playlistScrollPosition', playlistScroll.scrollTop);

        // As we scroll, re-measure which items need marquee enabled/disabled.
        this.scheduleMarqueeMeasure();
    }

    handlePlaylistPointerEnter(event) {
        if (event && event.pointerType && event.pointerType !== 'mouse') {
            return;
        }
        if (this._isHoveringPlaylist) {
            return;
        }
        this._isHoveringPlaylist = true;
        this.beginAutoScrollSuppression('hover-start');
    }

    handlePlaylistPointerLeave(event) {
        if (event && event.pointerType && event.pointerType !== 'mouse') {
            return;
        }
        if (!this._isHoveringPlaylist) {
            return;
        }
        this._isHoveringPlaylist = false;
        this.updateNowPlayingCountdownDisplay();
    }

    handleNowPlayingButtonClick() {
        this.handleAutoScrollResume({ source: 'button', forceScroll: true });
    }

    beginAutoScrollSuppression(reason = 'manual-scroll') {
        const now = Date.now();
        this._lastManualScrollTs = now;
        if (reason.startsWith('hover')) {
            this._isHoveringPlaylist = true;
        }
        this._autoScrollResumeAt = now + this._autoScrollResumeDelayMs;
        this.ensureAutoScrollResumeTimer();
    }

    ensureAutoScrollResumeTimer() {
        this.updateNowPlayingCountdownDisplay();
        if (!this._autoScrollResumeAt) {
            if (this._autoScrollResumeTimer) {
                clearTimeout(this._autoScrollResumeTimer);
                this._autoScrollResumeTimer = null;
            }
            if (this._autoScrollCountdownInterval) {
                clearInterval(this._autoScrollCountdownInterval);
                this._autoScrollCountdownInterval = null;
            }
            return;
        }
        if (this._autoScrollResumeTimer) {
            clearTimeout(this._autoScrollResumeTimer);
        }
        const delay = Math.max(0, this._autoScrollResumeAt - Date.now());
        this._autoScrollResumeTimer = setTimeout(() => {
            this._autoScrollResumeTimer = null;
            this.handleAutoScrollResume({ source: 'timer', forceScroll: true });
        }, delay);
        if (!this._autoScrollCountdownInterval) {
            this._autoScrollCountdownInterval = setInterval(() => {
                this.updateNowPlayingCountdownDisplay();
            }, 1000);
        }
    }

    updateNowPlayingCountdownDisplay(forceIdle = false) {
        const button = this.shadowRoot?.getElementById('now-playing-button');
        if (!button) {
            return;
        }
        const countdownEl = button.querySelector('.countdown');
        let secondsRemaining = 0;
        if (!forceIdle && this._autoScrollResumeAt) {
            secondsRemaining = Math.max(0, Math.ceil((this._autoScrollResumeAt - Date.now()) / 1000));
        }
        if (countdownEl) {
            if (secondsRemaining > 0) {
                countdownEl.hidden = false;
                countdownEl.textContent = `${secondsRemaining}s`;
            } else {
                countdownEl.hidden = true;
                countdownEl.textContent = '';
            }
        }
        const label = secondsRemaining > 0
            ? `Scroll to now playing. Auto-resume in ${secondsRemaining} seconds.`
            : 'Scroll to now playing';
        button.setAttribute('aria-label', label);
        button.setAttribute('title', label);
        button.classList.toggle('has-countdown', secondsRemaining > 0);
    }

    handleAutoScrollResume({ source = 'timer', forceScroll = true } = {}) {
        if (this._autoScrollResumeTimer) {
            clearTimeout(this._autoScrollResumeTimer);
            this._autoScrollResumeTimer = null;
        }
        if (this._autoScrollCountdownInterval) {
            clearInterval(this._autoScrollCountdownInterval);
            this._autoScrollCountdownInterval = null;
        }
        this._autoScrollResumeAt = null;
        this._lastManualScrollTs = 0;
        this.updateNowPlayingCountdownDisplay(true);
        if (this.currentVideoId && forceScroll) {
            this.highlightVideo(this.currentVideoId, { forceScroll: true });
        } else if (this.currentVideoId) {
            this.highlightVideo(this.currentVideoId);
        }
    }

    handleChronClick(event) {
        const btn = event.target.closest && event.target.closest('#chron-button');
        if (!btn) return;
        this.playlistSortDir = this.playlistSortDir === 'desc' ? 'asc' : 'desc';
        localStorage.setItem('playlistSortDir', this.playlistSortDir);
        this.updateChronButtonVisual();

        try {
            const flash = (el) => {
                if (!el) return;
                el.classList.add('flash');
                setTimeout(() => el.classList.remove('flash'), 180);
            };
            flash(this.shadowRoot?.getElementById('chron-button'));
        } catch (err) {
            console.warn('[PlaylistViewer] chron flash error:', err);
        }

        this.updatePlaylistView({ highlight: false });
        try {
            const scrollEl = this.shadowRoot?.getElementById('playlist-scroll');
            if (scrollEl) scrollEl.scrollTop = 0;
        } catch (err) {
            console.warn('[PlaylistViewer] chron scroll reset error:', err);
        }
    }

    handleShuffleClick() {
        const musicPlayer = this.musicPlayerRef || document.querySelector('music-player');
        if (musicPlayer && typeof musicPlayer.shufflePlaylist === 'function') {
            musicPlayer.shufflePlaylist();
        }
    }

    onSearchInput(event) {
        this.performSearch(event.target.value);
    }

    onShuffleChanged(e) {
        const enabled = !!e.detail?.shuffleEnabled;
        this.setShuffleButtonState(enabled);
    }

    getInitialShuffleState() {
        try {
            const shared = window.sharedStateManager;
            if (shared && typeof shared.get === 'function') {
                const sharedShuffle = shared.get('shuffleEnabled');
                if (typeof sharedShuffle === 'boolean') {
                    return sharedShuffle;
                }
                if (sharedShuffle === 'true') {
                    return true;
                }
            }
        } catch (err) {
            console.warn('[PlaylistViewer] Failed to read shared shuffle state:', err);
        }

        try {
            const stored = localStorage.getItem('myShuffleEnabled');
            if (stored === 'true' || stored === true) {
                return true;
            }
        } catch (err) {
            console.warn('[PlaylistViewer] Failed to read local shuffle state:', err);
        }

        return false;
    }

    setShuffleButtonState(enabled) {
        const normalized = !!enabled;
        this._lastKnownShuffleEnabled = normalized;
        const shuffleButton = this.shadowRoot?.getElementById('shuffle-button');
        if (!shuffleButton) {
            return;
        }
        shuffleButton.classList.toggle('active', normalized);
        shuffleButton.setAttribute('aria-pressed', normalized ? 'true' : 'false');
    }

    onPlaylistTimeUpdate(e) {
        const newVideoId = e.detail?.videoId || null;
        this.currentTime = e.detail?.currentTime || 0;
        this.currentDuration = e.detail?.duration || 0;

        if (newVideoId) {
            if (newVideoId !== this.currentVideoId) {
                this.highlightVideo(newVideoId);
            } else {
                this.updateProgress();
            }
            return;
        }

        this.currentVideoId = null;
        this.updateProgress();
    }

    async connectedCallback() {
        // Initial setup
        await Promise.all([
            this.ensureUserStatus(),
            this.fetchUserPlaylists()
        ]);
        this.ensureValidSelection();

        if (this._selectedPlaylistId && this._selectedPlaylistId !== 'cached') {
            this.fetchSongsForPlaylist(this._selectedPlaylistId);
        } else if (Array.isArray(this._cachedPlaylistData) && this._cachedPlaylistData.length) {
            this.updatePlaylistView();
        }
        const shuffleButton = this.shadowRoot.getElementById('shuffle-button');
        const searchToggleButton = this.shadowRoot.getElementById('search-toggle-button');
        const searchInput = this.shadowRoot.getElementById('search-input');
        const searchClearButton = this.shadowRoot.getElementById('search-clear-button');
        const chronButton = this.shadowRoot.getElementById('chron-button');
        const tabsContainer = this.shadowRoot.getElementById('playlist-tabs');
        const nowPlayingButton = this.shadowRoot.getElementById('now-playing-button');

        if (tabsContainer) {
            tabsContainer.removeEventListener('click', this.handleTabClick);
            tabsContainer.addEventListener('click', this.handleTabClick);
        }

        if (searchToggleButton) {
            searchToggleButton.removeEventListener('click', this.handleSearchToggle);
            searchToggleButton.addEventListener('click', this.handleSearchToggle);
        }

        if (searchClearButton) {
            searchClearButton.removeEventListener('click', this.handleSearchClear);
            searchClearButton.addEventListener('click', this.handleSearchClear);
        }

        if (searchInput) {
            searchInput.removeEventListener('keydown', this.handleSearchInputKey);
            searchInput.addEventListener('keydown', this.handleSearchInputKey);
            searchInput.removeEventListener('input', this.onSearchInput);
            searchInput.addEventListener('input', this.onSearchInput);
            if (this.currentSearchQuery && searchInput.value !== this.currentSearchQuery) {
                searchInput.value = this.currentSearchQuery;
            }
        }

        this.bindScrollEvents();
        this.restoreScrollPosition();

        this.syncModeButtons();
        this.updateChronButtonVisual();

        const initialSearchOpen = this.searchOverlayOpen || (this.currentSearchQuery && this.currentSearchQuery.trim().length > 0);
        this.setSearchOverlay(initialSearchOpen, { focus: false, skipPersistence: true });

        const musicPlayer = document.querySelector('music-player');
        this.musicPlayerRef = musicPlayer || null;

        const initialShuffle = this.getInitialShuffleState();
        this.setShuffleButtonState(initialShuffle);
        
        if (musicPlayer) {
            musicPlayer.removeEventListener('shuffle-changed', this.onShuffleChanged);
            musicPlayer.addEventListener('shuffle-changed', this.onShuffleChanged);
        }

        if (shuffleButton) {
            shuffleButton.removeEventListener('click', this.handleShuffleClick);
            shuffleButton.addEventListener('click', this.handleShuffleClick);
        }

        if (nowPlayingButton) {
            nowPlayingButton.removeEventListener('click', this.handleNowPlayingButtonClick);
            nowPlayingButton.addEventListener('click', this.handleNowPlayingButtonClick);
        }

        if (chronButton) {
            chronButton.removeEventListener('click', this.handleChronClick);
        }
        this.shadowRoot.removeEventListener('click', this.handleChronClick);
        this.shadowRoot.addEventListener('click', this.handleChronClick);

        document.removeEventListener('playlist-time-update', this.onPlaylistTimeUpdate);
        document.addEventListener('playlist-time-update', this.onPlaylistTimeUpdate);
        
        // Multi-focal: Subscribe to shared state changes
        if (window.sharedStateManager) {
            this.sharedStateUnsubscribe = window.sharedStateManager.subscribe((state) => {
                // Update current video from shared state
                const sharedVideoId = state.currentVideoId;
                const sharedTime = state.currentTime || 0;
                const sharedDuration = state.duration || 0;
                
                // Check if video changed
                const videoChanged = sharedVideoId && sharedVideoId !== this.currentVideoId;
                
                // Highlight the new video if it changed
                if (videoChanged) {
                    this.highlightVideo(sharedVideoId);
                }
                
                // Update time if changed significantly
                if (Math.abs(sharedTime - this.currentTime) > 0.1) {
                    this.currentTime = sharedTime;
                    this.currentDuration = sharedDuration;
                    this.updateProgress();
                }

                if (typeof state.shuffleEnabled === 'boolean' && state.shuffleEnabled !== this._lastKnownShuffleEnabled) {
                    this.setShuffleButtonState(state.shuffleEnabled);
                }

                if (Array.isArray(state.playlistQueue)) {
                    if (this.playlistMode === 'now-playing') {
                        const signature = this.computeNowPlayingSignature(state.playlistQueue);
                        if (signature !== this._lastNowPlayingSignature) {
                            this._lastNowPlayingSignature = signature;
                            this.updatePlaylistView({ highlight: false });
                        }
                    } else {
                        this._lastNowPlayingSignature = '';
                    }
                }
            });
        }

        // Apply initial viewport-based overlay sizing and hook resize listeners
        this.applyResponsiveWidth();
        window.addEventListener('resize', this.scheduleMarqueeMeasure);
        window.addEventListener('resize', this.applyResponsiveWidth);
        this.updateNowPlayingCountdownDisplay(true);
        // Prefer SimpleBar for consistent, themed scrollbars.
        this.ensureSimpleBar()
            .then(() => {
                this.bindScrollEvents();
                this.restoreScrollPosition();
            })
            .catch((err) => {
                console.warn('[PlaylistViewer] SimpleBar unavailable, using native scroll:', err);
                this.restoreScrollPosition();
            });
    }

    disconnectedCallback() {
        const tabsContainer = this.shadowRoot?.getElementById('playlist-tabs');
        tabsContainer?.removeEventListener('click', this.handleTabClick);

        const searchToggleButton = this.shadowRoot?.getElementById('search-toggle-button');
        searchToggleButton?.removeEventListener('click', this.handleSearchToggle);

        const searchClearButton = this.shadowRoot?.getElementById('search-clear-button');
        searchClearButton?.removeEventListener('click', this.handleSearchClear);

        const nowPlayingButton = this.shadowRoot?.getElementById('now-playing-button');
        nowPlayingButton?.removeEventListener('click', this.handleNowPlayingButtonClick);
        
        // Unsubscribe from shared state
        if (this.sharedStateUnsubscribe) {
            this.sharedStateUnsubscribe();
            this.sharedStateUnsubscribe = null;
        }

        const searchInput = this.shadowRoot?.getElementById('search-input');
        searchInput?.removeEventListener('keydown', this.handleSearchInputKey);
        searchInput?.removeEventListener('input', this.onSearchInput);

        this.unbindScrollEvents();

        const shuffleButton = this.shadowRoot?.getElementById('shuffle-button');
        shuffleButton?.removeEventListener('click', this.handleShuffleClick);

        this.shadowRoot?.removeEventListener('click', this.handleChronClick);

        if (this.musicPlayerRef) {
            this.musicPlayerRef.removeEventListener('shuffle-changed', this.onShuffleChanged);
            this.musicPlayerRef = null;
        }

        document.removeEventListener('playlist-time-update', this.onPlaylistTimeUpdate);
        window.removeEventListener('resize', this.scheduleMarqueeMeasure);
        window.removeEventListener('resize', this.applyResponsiveWidth);
        if (this._marqueeMeasureFrame !== null) {
            cancelAnimationFrame(this._marqueeMeasureFrame);
            this._marqueeMeasureFrame = null;
        }
        if (this._autoScrollReleaseTimer) {
            clearTimeout(this._autoScrollReleaseTimer);
            this._autoScrollReleaseTimer = null;
        }
        if (this._autoScrollResumeTimer) {
            clearTimeout(this._autoScrollResumeTimer);
            this._autoScrollResumeTimer = null;
        }
        if (this._autoScrollCountdownInterval) {
            clearInterval(this._autoScrollCountdownInterval);
            this._autoScrollCountdownInterval = null;
        }
        this._autoScrollResumeAt = null;
        // Destroy SimpleBar or custom scrollbar if present
        try { this.destroySimpleBar(); } catch (err) { /* ignore */ }
        try { this.destroyCustomScrollbar(); } catch (err) { /* ignore */ }
    }

    highlightVideo(videoId, options = {}) {
        const { forceScroll = false } = options;
        const playlistScroll = this.getScrollElement();
        const items = this.shadowRoot.querySelectorAll('.playlist-item');
        items.forEach((item) => {
            const isTarget = item.getAttribute('data-video-id') === videoId;
            item.classList.toggle('playing', isTarget);
            if (isTarget) {
                if (!this.isSearching && playlistScroll) {
                    const itemRect = item.getBoundingClientRect();
                    const scrollRect = playlistScroll.getBoundingClientRect();
                    const itemVisible = this.isItemMostlyVisible(itemRect, scrollRect);
                    if (this.shouldAutoScrollToItem(itemVisible, forceScroll)) {
                        this.scrollItemIntoComfortZone(playlistScroll, itemRect, scrollRect);
                    }
                }
            } else {
                this.resetTrackProgress(item);
            }
        });
        this.currentVideoId = videoId;
        this.updateProgress();
    }

    isUserScrollActive() {
        const now = Date.now();
        if (this._isHoveringPlaylist && this._autoScrollResumeAt && now < this._autoScrollResumeAt) {
            return true;
        }
        if (this._autoScrollResumeAt && now < this._autoScrollResumeAt) {
            return true;
        }
        if (!this._lastManualScrollTs) {
            return false;
        }
        return now - this._lastManualScrollTs < this._autoScrollCooldownMs;
    }

    isItemMostlyVisible(itemRect, scrollRect) {
        if (!itemRect || !scrollRect) {
            return true;
        }
        const margin = scrollRect.height * 0.2;
        const topVisible = itemRect.top >= (scrollRect.top - margin);
        const bottomVisible = itemRect.bottom <= (scrollRect.bottom + margin);
        return topVisible && bottomVisible;
    }

    shouldAutoScrollToItem(itemVisible, forceScroll = false) {
        if (forceScroll) {
            return true;
        }
        if (itemVisible) {
            return false;
        }
        if (this.isUserScrollActive()) {
            return false;
        }
        return true;
    }

    scrollItemIntoComfortZone(playlistScroll, itemRect, scrollRect) {
        if (!playlistScroll || !itemRect || !scrollRect) {
            return;
        }
        const offsetWithin = itemRect.top - scrollRect.top;
        const targetTop = playlistScroll.scrollTop + offsetWithin - scrollRect.height * 0.25;
        this.beginAutoScroll();
        playlistScroll.scrollTo({
            top: Math.max(0, targetTop),
            behavior: 'smooth'
        });
    }

    beginAutoScroll() {
        this._isAutoScrolling = true;
        if (this._autoScrollReleaseTimer) {
            clearTimeout(this._autoScrollReleaseTimer);
        }
        this._autoScrollReleaseTimer = setTimeout(() => {
            this._isAutoScrolling = false;
            this._autoScrollReleaseTimer = null;
        }, 450);
    }

    updateProgress() {
        // Throttle updates to reduce lag
        const now = Date.now();
        if (now - this.lastUpdateTime < this.updateThrottle) {
            return;
        }
        this.lastUpdateTime = now;

        const playingItem = this.shadowRoot.querySelector(`.playlist-item[data-video-id="${this.currentVideoId}"]`);
        if (!playingItem) {
            return;
        }

        const currentTimeEl = playingItem.querySelector('[data-current-time]');
        const totalTimeEl = playingItem.querySelector('[data-total-time]');
        const slider = playingItem.querySelector('.track-time-slider');

        if (currentTimeEl) {
            currentTimeEl.textContent = this.formatTime(this.currentTime);
        }

        const baseDuration = totalTimeEl ? parseInt(totalTimeEl.dataset.duration || '0', 10) || 0 : 0;
        const measuredDuration = Math.max(baseDuration, Math.floor(this.currentDuration || 0));

        if (totalTimeEl) {
            totalTimeEl.dataset.duration = String(measuredDuration);
            totalTimeEl.textContent = measuredDuration > 0 ? this.formatTime(measuredDuration) : '--:--';
        }

        if (slider) {
            const sliderBase = parseInt(slider.dataset.duration || '0', 10) || 0;
            const sliderMax = Math.max(sliderBase, measuredDuration);
            this._updatingSliderProgrammatically = true;
            slider.max = sliderMax > 0 ? sliderMax : 0;
            slider.disabled = slider.max === 0;
            slider.value = slider.max > 0 ? Math.min(slider.max, Math.floor(this.currentTime)) : 0;
            slider.dataset.duration = String(sliderMax);
            this._updatingSliderProgrammatically = false;
        }
    }

    resetTrackProgress(itemElement) {
        if (!itemElement) return;
        const currentTimeEl = itemElement.querySelector('[data-current-time]');
        if (currentTimeEl) {
            currentTimeEl.textContent = '0:00';
        }
        const totalTimeEl = itemElement.querySelector('[data-total-time]');
        const baseDuration = totalTimeEl ? parseInt(totalTimeEl.dataset.duration || '0', 10) || 0 : 0;
        if (totalTimeEl) {
            totalTimeEl.textContent = baseDuration > 0 ? this.formatTime(baseDuration) : '--:--';
        }
        const slider = itemElement.querySelector('.track-time-slider');
        if (slider) {
            this._updatingSliderProgrammatically = true;
            slider.value = '0';
            slider.max = baseDuration > 0 ? baseDuration : 0;
            slider.disabled = slider.max === 0;
            slider.dataset.duration = String(baseDuration);
            this._updatingSliderProgrammatically = false;
        }
    }

    hideSpinner() {
        const spinner = this.shadowRoot.getElementById('load-spinner');
        if (spinner) spinner.style.display = 'none';
    }

    restoreScrollPosition() {
        const scrollEl = this.getScrollElement();
        const scrollPosition = localStorage.getItem('playlistScrollPosition');
        if (scrollEl && scrollPosition !== null) {
            scrollEl.scrollTop = parseInt(scrollPosition, 10) || 0;
        }
    }
}

customElements.define('playlist-viewer', PlaylistViewer);

PlaylistViewer._simpleBarScriptPromise = null;
PlaylistViewer._simpleBarCssPromise = null;
