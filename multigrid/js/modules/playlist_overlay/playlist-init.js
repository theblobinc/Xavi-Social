(function playlistOverlayInit() {
    'use strict';
    
    try {
        initializeModule();
    } catch (err) {
        console.error('[PlaylistOverlay] Module initialization failed:', err);
    }

    function initializeModule() {
    const OVERLAY_ID = 'playlist-viewer-overlay';
    const API_BASE = (typeof window !== 'undefined' && window.XAVI_API_BASE) ? window.XAVI_API_BASE : '/pgmusic';

    let videoIds = [];
    let videoData = {};
    let nextPageToken = '';
    let reachedEnd = false;
    let playlistViewer = null;
    let musicPlayer = null;

    const safeLocalGet = (key) => {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    };
    const safeLocalRemove = (key) => {
        try { localStorage.removeItem(key); } catch (e) {}
    };
    const safeLocalClear = () => {
        try { localStorage.clear(); } catch (e) {}
    };

    function resolvePlaylistViewer() {
        if (playlistViewer && playlistViewer.isConnected) {
            return playlistViewer;
        }

        const overlay = window.__playlistOverlayRefs?.overlay || document.getElementById(OVERLAY_ID);
        if (overlay) {
            const viewer = overlay.querySelector('playlist-viewer');
            if (viewer) {
                playlistViewer = viewer;
                return viewer;
            }
        }

        const workspace = document.querySelector('xavi-multi-grid');
        if (workspace) {
            const roots = [workspace];
            if (workspace.shadowRoot) {
                roots.push(workspace.shadowRoot);
            }
            if (typeof workspace.getFloatingLayer === 'function') {
                const layer = workspace.getFloatingLayer();
                if (layer) {
                    roots.push(layer);
                }
            }

            for (const root of roots) {
                const viewer = root.querySelector('playlist-viewer');
                if (viewer) {
                    playlistViewer = viewer;
                    return viewer;
                }
            }
        }

        const viewer = document.querySelector('playlist-viewer');
        if (viewer) {
            playlistViewer = viewer;
        }
        return viewer || null;
    }

    function resolveMusicPlayer() {
        if (musicPlayer && musicPlayer.isConnected) {
            return musicPlayer;
        }

        const workspace = document.querySelector('xavi-multi-grid');
        if (workspace) {
            const roots = [workspace, document];
            if (workspace.shadowRoot) {
                roots.push(workspace.shadowRoot);
            }

            for (const root of roots) {
                const player = root.querySelector('music-player');
                if (player) {
                    musicPlayer = player;
                    return player;
                }
            }
        }

        const player = document.querySelector('music-player');
        if (player) {
            musicPlayer = player;
        }
        return player || null;
    }

    function waitForComponents(callback, timeoutMs = 12000) {
        const tryResolve = () => {
            const viewer = resolvePlaylistViewer();
            const player = resolveMusicPlayer();
            if (viewer && player) {
                callback(viewer, player);
                return true;
            }
            return false;
        };

        if (tryResolve()) {
            return;
        }

        let done = false;
        const onSignal = () => {
            if (done) return;
            if (tryResolve()) {
                done = true;
                cleanup();
            }
        };

        const cleanup = () => {
            window.removeEventListener('playlist-overlay-attached', onSignal);
            window.removeEventListener('xavi-workspace-ready', onSignal);
            document.removeEventListener('DOMContentLoaded', onSignal);
        };

        window.addEventListener('playlist-overlay-attached', onSignal);
        window.addEventListener('xavi-workspace-ready', onSignal);
        document.addEventListener('DOMContentLoaded', onSignal, { once: true });

        setTimeout(() => {
            if (done) return;
            cleanup();
            console.warn('[PlaylistOverlay] Components not found within timeout');
        }, timeoutMs);
    }

    function parseDuration(isoDuration) {
        if (!isoDuration) return 0;
        const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        if (!match) return 0;
        
        const hours = parseInt(match[1]) || 0;
        const minutes = parseInt(match[2]) || 0;
        const seconds = parseInt(match[3]) || 0;
        
        return hours * 3600 + minutes * 60 + seconds;
    }

    async function refreshServerCache(options = {}) {
        const truncateMissing = !!options.truncateMissing;
        const endpoint = `${API_BASE}/refreshCachedPlaylistFromYouTube`;

        const resp = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ truncateMissing })
        });
        const result = await resp.json().catch(() => ({}));
        if (!resp.ok || !result || result.success === false) {
            const msg = result?.error || `Server refresh failed (${resp.status})`;
            throw new Error(msg);
        }
        return result;
    }

    // Legacy names used elsewhere in the UI.
    async function fetchPlaylistPage() {
        await refreshServerCache({ truncateMissing: false });
        await loadFromDatabase();
        reachedEnd = true;
        nextPageToken = '';
    }

    async function loadMoreCache() {
        const viewer = resolvePlaylistViewer();
        const spinner = viewer?.shadowRoot?.getElementById('load-spinner');
        if (spinner) {
            spinner.style.display = 'inline-block';
        }
        try {
            await refreshServerCache({ truncateMissing: true });
            await loadFromDatabase();
        } catch (err) {
            console.error('[PlaylistOverlay] Error loading full cache:', err);
        } finally {
            if (spinner) {
                spinner.style.display = 'none';
            }
        }
    }

    function updateComponents() {
        const viewer = resolvePlaylistViewer();
        const player = resolveMusicPlayer();

        let videoObjects = videoIds.map((vid) => ({
            vid,
            video_id: vid,
            title: videoData[vid]?.title || vid,
            channelTitle: videoData[vid]?.channelTitle || 'Unknown Channel',
            channel_title: videoData[vid]?.channelTitle || 'Unknown Channel',
            channelId: videoData[vid]?.channelId || '',
            channel_id: videoData[vid]?.channelId || '',
            duration: videoData[vid]?.duration || 0,
            durationIso: videoData[vid]?.durationIso || '',
            thumbnailUrl: videoData[vid]?.thumbnailUrl || '',
            playlist_added_at: videoData[vid]?.playlistAddedAt || null,
            playlistAddedAt: videoData[vid]?.playlistAddedAt || null,
            playlist_position: videoData[vid]?.playlistPosition ?? null,
            playlistPosition: videoData[vid]?.playlistPosition ?? null,
            updated_at: videoData[vid]?.updated_at || null,
            created_at: videoData[vid]?.created_at || null
        }));

        if (viewer) {
            viewer.playlistData = videoObjects;
        }
        if (player) {
            player.playlistData = videoObjects;
        }
        
        window.songList = videoObjects;
    }

    async function syncToDatabase(options = {}) {
        const { truncateMissing = true } = options;
        const videoObjects = videoIds.map((vid) => ({
            video_id: vid,
            title: videoData[vid]?.title || '',
            channel_title: videoData[vid]?.channelTitle || '',
            channel_id: videoData[vid]?.channelId || '',
            duration: videoData[vid]?.duration || 0,
            duration_iso: videoData[vid]?.durationIso || '',
            thumbnail_url: videoData[vid]?.thumbnailUrl || '',
            embeddable: 1,
            privacy_status: 'public',
            playlist_position: videoData[vid]?.playlistPosition ?? null,
            playlist_added_at: videoData[vid]?.playlistAddedAt || null,
            updated_at: videoData[vid]?.updated_at || null
        })).filter(v => v.title !== '');

        try {
            const response = await fetch(`${API_BASE}/syncCachedPlaylist`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ videos: videoObjects, truncateMissing })
            });
            
            const result = await response.json();
            if (result.success) {
                console.log(`[PlaylistOverlay] DB sync: ${result.inserted} inserted, ${result.updated} updated`);
                return true;
            } else {
                console.error('[PlaylistOverlay] DB sync failed:', result.error);
                return false;
            }
        } catch (err) {
            console.error('[PlaylistOverlay] DB sync error:', err);
            return false;
        }
    }

    async function loadFromDatabase() {
        try {
            const response = await fetch(`${API_BASE}/getCachedPlaylist`);
            const result = await response.json();
            
            if (result.success && result.videos.length > 0) {
                console.log(`[PlaylistOverlay] Loaded ${result.count} videos from database`);

                reachedEnd = true;
                nextPageToken = '';
                
                const parseTimestamp = (value) => {
                    if (!value) return 0;
                    if (typeof value === 'number') return value;
                    const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
                    const parsed = Date.parse(normalized);
                    return Number.isNaN(parsed) ? 0 : parsed;
                };

                const orderedVideos = [...result.videos].sort((a, b) => {
                    const aTs = parseTimestamp(a.playlist_added_at || a.updated_at);
                    const bTs = parseTimestamp(b.playlist_added_at || b.updated_at);
                    if (aTs !== bTs) return bTs - aTs;
                    const aPos = typeof a.playlist_position === 'number' ? a.playlist_position : Number(a.playlist_position ?? Number.MAX_SAFE_INTEGER);
                    const bPos = typeof b.playlist_position === 'number' ? b.playlist_position : Number(b.playlist_position ?? Number.MAX_SAFE_INTEGER);
                    return aPos - bPos;
                });

                videoIds = orderedVideos.map(v => v.video_id);
                videoData = {};
                orderedVideos.forEach(v => {
                    videoData[v.video_id] = {
                        title: v.title,
                        channelTitle: v.channel_title,
                        channelId: v.channel_id,
                        duration: v.duration || 0,
                        durationIso: '',
                        thumbnailUrl: v.thumbnail_url || '',
                        playlistAddedAt: v.playlist_added_at || null,
                        playlistPosition: typeof v.playlist_position === 'number' ? v.playlist_position : (v.playlist_position !== null && v.playlist_position !== undefined ? Number(v.playlist_position) : null),
                        updated_at: v.updated_at || null,
                        created_at: v.created_at || null
                    };
                });
                
                updateComponents();
                return true;
            }
            return false;
        } catch (err) {
            console.error('[PlaylistOverlay] Failed to load from database:', err);
            return false;
        }
    }

    async function checkYouTubeForUpdates() {
        try {
            await refreshServerCache({ truncateMissing: false });
            await loadFromDatabase();
            return true;
        } catch (err) {
            console.error('[PlaylistOverlay] Failed to refresh from server:', err);
            return false;
        }
    }

    async function loadOrInitData() {
        let custom = safeLocalGet('userCustomPlaylist');
        if (custom && custom !== "[]") {
            try {
                let list = JSON.parse(custom);
                const viewer = resolvePlaylistViewer();
                const player = resolveMusicPlayer();
                if (viewer) viewer.playlistData = list;
                if (player) player.playlistData = list;
                
                loadFromDatabase();
                return;
            } catch (e) {
                console.warn('[PlaylistOverlay] Invalid userCustomPlaylist:', e);
            }
        }

        const dbLoaded = await loadFromDatabase();
        if (dbLoaded) {
            console.log('[PlaylistOverlay] Playlist loaded from server database');
            return;
        }

        console.log('[PlaylistOverlay] Database empty, checking YouTube...');
        await checkYouTubeForUpdates();
    }

    function initializePlaylistOverlay(viewer, player) {
        console.log('[PlaylistOverlay] Initializing with components:', viewer, player);

        playlistViewer = viewer;
        musicPlayer = player;

        const modalRoot = viewer.shadowRoot || viewer;
        const modal = modalRoot.getElementById?.('add-to-playlist-modal') || document.getElementById('add-to-playlist-modal');

        if (modal) {
            const newPlaylistSection = modal.querySelector('#new-playlist-section');
            const newPlaylistBtn = modal.querySelector('#modal-new-playlist-btn');
            if (newPlaylistBtn && newPlaylistSection) {
                newPlaylistBtn.addEventListener('click', () => {
                    newPlaylistSection.style.display = 'flex';
                });
            }

            modal.querySelectorAll('.modal-close-btn').forEach((btn) => {
                btn.addEventListener('click', () => {
                    viewer.closeAddToPlaylistModal();
                });
            });

            const addExistingBtn = modal.querySelector('#modal-add-to-existing-btn');
            if (addExistingBtn) {
                addExistingBtn.addEventListener('click', () => {
                    viewer.handleAddToExistingPlaylist();
                });
            }

            const createAndAddBtn = modal.querySelector('#modal-create-and-add-btn');
            if (createAndAddBtn) {
                createAndAddBtn.addEventListener('click', () => {
                    viewer.handleCreateAndAddPlaylist();
                });
            }
        }

        if (typeof player.setLinkedPlaylistViewer === 'function') {
            player.setLinkedPlaylistViewer(viewer);
        }

        window.playlistState = {
            reachedEnd: () => reachedEnd,
            refreshFromServer: checkYouTubeForUpdates,
            loadMoreCache: loadMoreCache,
            updateComponents: updateComponents
        };

        const handlePlaylistSelection = (event) => {
            const selectedVideoId = event?.detail?.videoId;
            if (!selectedVideoId) {
                return;
            }

            const isPrimary = typeof player.isPrimaryWorkspace === 'function'
                ? player.isPrimaryWorkspace()
                : true;

            if (isPrimary) {
                player.loadVideo(selectedVideoId, 0, true);
                return;
            }

            if (typeof player.handleRemoteCommand === 'function') {
                const dispatched = player.handleRemoteCommand('seek', {
                    videoId: selectedVideoId,
                    time: 0,
                    play: true,
                    source: 'playlist-select'
                });
                if (dispatched) {
                    return;
                }
            }

            player.loadVideo(selectedVideoId, 0, false);
            player.muteAudio();
        };

        viewer.addEventListener('select-video', (event) => {
            event.stopPropagation();
            event.stopImmediatePropagation();
            handlePlaylistSelection(event);
        });

        if (!window.__pgmusicGlobalSelectListenerAttached) {
            document.addEventListener('select-video', handlePlaylistSelection);
            window.__pgmusicGlobalSelectListenerAttached = true;
        }

        player.addEventListener('video-changed', (e) => {
            const videoId = e.detail?.videoId;
            if (!videoId || typeof viewer.highlightVideo !== 'function') {
                return;
            }

            const source = e.detail?.source;
            const shouldForceScroll = source !== 'progress-sync';
            try {
                viewer.highlightVideo(videoId, { forceScroll: shouldForceScroll });
            } catch (err) {
                console.warn('[PlaylistOverlay] Failed to sync playlist highlight:', err);
            }
        });

        viewer.addEventListener('clear-cache', async () => {
            console.log('[PlaylistOverlay] Clearing cache + localStorage...');
            safeLocalClear();
            videoIds = [];
            videoData = {};
            nextPageToken = '';
            reachedEnd = false;

            try {
                await fetch(`${API_BASE}/clearCachedPlaylist`, { method: 'POST' });
            } catch (err) {
                console.warn('[PlaylistOverlay] Failed to clear server cache:', err);
            }

            try {
                await refreshServerCache({ truncateMissing: true });
                await loadFromDatabase();
                console.log('[PlaylistOverlay] Reloaded playlist from server.');
            } catch (err) {
                console.error('[PlaylistOverlay] Error reloading after clear:', err);
            }
        });

        viewer.addEventListener('load-cache', () => {
            loadMoreCache();
        });

        const getWorkspaceStatus = () => {
            const shared = window.sharedStateManager;
            const workspaceId = window.__panelTaskbar?.workspaceId;
            if (!shared || !workspaceId) {
                return { isPrimary: false };
            }
            const audioWorkspaceId = shared.get('audioWorkspaceId');
            if (!audioWorkspaceId) {
                return { isPrimary: true };
            }
            return { isPrimary: workspaceId === audioWorkspaceId };
        };

        window.addEventListener('storage', (event) => {
            if (!event || !event.key) {
                return;
            }

            const { isPrimary } = getWorkspaceStatus();

            if (event.key === 'myCurrentVideoID' && event.newValue && event.newValue !== player._currentVideoId) {
                const newVideoId = event.newValue;
                const initialTime = 0;
                const shouldPlay = safeLocalGet('myIsPlaying') === '1' && isPrimary;

                player.loadVideo(newVideoId, initialTime, shouldPlay, {
                    persist: false,
                    source: 'storage-sync'
                });

                if (!isPrimary) {
                    player.muteAudio();
                }
            }

            if (event.key === 'myIsPlaying') {
                if (!isPrimary) {
                    player.muteAudio();
                    return;
                }
                const shouldPlay = event.newValue === '1';
                if (shouldPlay && !player.isPlaying) {
                    player.play(true);
                } else if (!shouldPlay && player.isPlaying) {
                    player.pause(true);
                }
            }
        });

        window.addEventListener('user-playlist-updated', () => {
            let custom = safeLocalGet('userCustomPlaylist');
            if (custom && custom !== "[]") {
                let list = [];
                try { list = JSON.parse(custom); } catch {}
                player.playlistData = list;
                if (viewer) {
                    viewer._userPlaylistData = list;
                    viewer.updatePlaylistView();
                }
            } else {
                if (viewer) {
                    viewer._userPlaylistData = [];
                    viewer.updatePlaylistView();
                }
            }
        });
        
        player.addEventListener('video-changed', async () => {
            const custom = safeLocalGet('userCustomPlaylist');
            if (!custom || custom === "[]") {
                console.log('[PlaylistOverlay] Video changed, checking for playlist updates...');
                if (window.playlistDB && typeof window.playlistDB.updateFromYouTube === 'function') {
                    const result = await window.playlistDB.updateFromYouTube();
                    if (result.success && result.newCount > 0) {
                        console.log(`[PlaylistOverlay] Auto-discovered ${result.newCount} new video(s)`);
                    }
                }
            }
        });
        
        setInterval(async () => {
            const custom = safeLocalGet('userCustomPlaylist');
            if (!custom || custom === "[]") {
                console.log('[PlaylistOverlay] Periodic check for playlist updates...');
                await loadFromDatabase();
            }
        }, 5 * 60 * 1000);

        window.playlistDB = {
            sync: syncToDatabase,
            load: loadFromDatabase,
            
            updateFromYouTube: async function() {
                try {
                    const before = await fetch(`${API_BASE}/getCachedPlaylist`).then(r => r.json()).catch(() => ({}));
                    const beforeCount = before?.count || (before?.videos?.length || 0);

                    const refreshed = await refreshServerCache({ truncateMissing: false });
                    await loadFromDatabase();

                    const after = await fetch(`${API_BASE}/getCachedPlaylist`).then(r => r.json()).catch(() => ({}));
                    const afterCount = after?.count || (after?.videos?.length || 0);
                    const newCount = Math.max(0, afterCount - beforeCount);

                    return { success: true, newCount, inserted: refreshed.inserted, updated: refreshed.updated };
                    
                } catch (err) {
                    console.error('[PlaylistOverlay] Error updating from YouTube:', err);
                    return { success: false, newCount: 0, error: err.message };
                }
            },

            clearAndReload: async function() {
                try {
                    await fetch(`${API_BASE}/clearCachedPlaylist`, { method: 'POST' });
                } catch (err) {
                    console.warn('[PlaylistOverlay] Failed to clear server cache, continuing with reload:', err);
                }

                try {
                    safeLocalRemove('userCustomPlaylist');
                } catch (err) {
                    console.warn('[PlaylistOverlay] Unable to clear local custom playlist cache:', err);
                }

                videoIds = [];
                videoData = {};
                nextPageToken = '';
                reachedEnd = false;

                try {
                    await loadMoreCache();
                    return true;
                } catch (err) {
                    console.error('[PlaylistOverlay] Clear and reload failed:', err);
                    return false;
                }
            }
        };

        loadOrInitData();
    }

    function start() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                waitForComponents(initializePlaylistOverlay);
            }, { once: true });
        } else {
            waitForComponents(initializePlaylistOverlay);
        }
    }

    start();
    }
})();
