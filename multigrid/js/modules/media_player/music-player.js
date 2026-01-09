// application/single_pages/xavi/js/music-player.js

const AUDIO_WORKSPACE_STALE_MS = 15000;

const MUSIC_PLAYER_TEMPLATE = (() => {
    if (typeof document === 'undefined') {
        return null;
    }
    const template = document.createElement('template');
    template.innerHTML = `
        <style>
            :host {
                display: block;
                background: rgba(12, 12, 12, 0.94);
                color: #fff;
                border-radius: 12px;
                border: 1px solid rgba(255, 255, 255, 0.14);
                box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
                margin-bottom: 12px;
                font-size: 0.875rem;
            }

            :host([dock-mode="docked"]) {
                margin: 0;
                border: none;
                box-shadow: none;
                background: transparent;
            }

            :host([dock-mode="mini"]) {
                width: 100%;
                border-radius: 10px;
                box-shadow: none;
            }

            .player-header {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 12px 14px;
                flex-wrap: wrap;
            }

            :host([dock-mode="docked"]) .player-header {
                padding: 6px 8px;
                gap: 4px;
            }

            :host([dock-mode="mini"]) .player-header {
                flex-direction: column;
                align-items: stretch;
                gap: 8px;
            }

            .marquee-container {
                flex: 1;
                min-width: 180px;
                overflow: hidden;
                white-space: nowrap;
            }

            :host([dock-mode="docked"]) .marquee-container {
                min-width: 120px;
                font-size: 0.78rem;
            }

            .marquee-content {
                display: inline-block;
            }

            @keyframes scrolling {
                0% { transform: translateX(0); }
                100% { transform: translateX(-50%); }
            }

            .track-info a {
                color: rgba(255, 255, 255, 0.85);
                text-decoration: none;
                transition: color 0.2s;
                font-size: 0.875rem;
            }

            .track-info a:hover {
                color: rgba(255, 255, 255, 1);
                text-decoration: underline;
            }

            .playback-controls {
                display: flex;
                align-items: center;
                gap: 6px;
            }

            .control-button {
                min-width: 34px;
                height: 34px;
                padding: 0 10px;
                font-size: 0.875rem;
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 7px;
                color: #fff;
                cursor: pointer;
                transition: all 0.2s ease;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                user-select: none;
            }

            .control-button:hover {
                background: rgba(255, 255, 255, 0.16);
                border-color: rgba(255, 255, 255, 0.3);
            }

            .control-button:active {
                transform: scale(0.95);
            }

            #play-pause-button {
                min-width: 34px;
                background: rgba(66, 133, 244, 0.15);
                border-color: rgba(66, 133, 244, 0.4);
            }

            #play-pause-button:hover {
                background: rgba(66, 133, 244, 0.25);
                border-color: rgba(66, 133, 244, 0.6);
            }

            .volume-control {
                display: flex;
                align-items: center;
                gap: 6px;
            }

            .shuffle-control {
                display: flex;
                align-items: center;
                gap: 4px;
                cursor: pointer;
                user-select: none;
                padding: 0 6px;
            }

            .shuffle-control input[type="checkbox"] {
                width: 16px;
                height: 16px;
                cursor: pointer;
                accent-color: rgba(66, 133, 244, 0.8);
            }

            .shuffle-control label {
                color: rgba(255, 255, 255, 0.8);
                cursor: pointer;
                font-size: 0.8rem;
                white-space: nowrap;
            }

            .shuffle-control input[type="checkbox"]:checked + label,
            .shuffle-control.active label {
                color: #4a9eff;
                font-weight: 600;
                text-shadow: 0 0 6px rgba(74, 158, 255, 0.4);
            }

            :host([dock-mode="docked"]) .shuffle-control label,
            :host([dock-mode="mini"]) .shuffle-control label {
                display: none;
            }

            @media (max-width: 768px) {
                .player-header {
                    padding: 10px 12px;
                    gap: 6px;
                }

                .marquee-container {
                    min-width: 140px;
                    order: -1;
                    flex-basis: 100%;
                }

                .control-button {
                    min-width: 32px;
                    height: 32px;
                    font-size: 0.85rem;
                }

                .shuffle-control label {
                    display: none;
                }
            }
        </style>
        <div class="player-header">
            <div class="marquee-container" id="marquee-container">
                <div class="marquee-content track-info">
                    <span id="channel-and-track">No track loaded</span>
                </div>
            </div>
            <div class="playback-controls">
                <button id="prev-button" class="control-button" aria-label="Previous track" title="Previous track">⏮</button>
                <button id="play-pause-button" class="control-button" aria-label="Play/Pause" title="Play/Pause">▶</button>
                <button id="next-button" class="control-button" aria-label="Next track" title="Next track">⏭</button>
            </div>
            <div class="volume-control">
                <xavi-volume-control id="volume-control" storage-key="myVolume" source="music-player" label="Volume"></xavi-volume-control>
            </div>
            <div class="shuffle-control">
                <input type="checkbox" id="random-checkbox" />
                <label for="random-checkbox">🔀 Shuffle</label>
            </div>
            <button id="dock-toggle-button" class="control-button" aria-label="Dock to taskbar" title="Dock to taskbar">⬇</button>
        </div>
    `;
    return template;
})();

class MusicPlayer extends HTMLElement {
    constructor() {
        super();
        this._pendingStateKeys = new Map();
        this._tabScopeId = null;
        this._workspaceStorageScope = null;
        this._userInteractionArmed = false;
        this._lastInteractionActivityUpdate = 0;
        this._lastAudioPointerClearTs = 0;
        this._lastWorkspaceCleanupTs = 0;
        this._lastIntegrityAutoResumeTs = 0;
        this.enforceAudioState();
        this.restoreDockMode();
        this.initializeCrossTabSync();
        this.startPlaybackIntegrityWatcher();
    }

    initializeHeartbeatIntegration(retryCount = 0) {
        if (typeof window === 'undefined') {
            return;
        }

        if (this._heartbeatUnsubscribe) {
            return;
        }

        const heartbeat = window.taskbarHeartbeat;
        if (!heartbeat || typeof heartbeat.subscribe !== 'function') {
            const cappedRetry = Math.min(retryCount + 1, 10);
            if (this._heartbeatRetryHandle) {
                clearTimeout(this._heartbeatRetryHandle);
            }
            this._heartbeatRetryHandle = setTimeout(() => this.initializeHeartbeatIntegration(cappedRetry), 250 * cappedRetry);
            return;
        }

        if (this._heartbeatRetryHandle) {
            clearTimeout(this._heartbeatRetryHandle);
            this._heartbeatRetryHandle = null;
        }

        this._heartbeatUnsubscribe = heartbeat.subscribe((state, prevState, source) => {
            if (!state) {
                return;
            }

            this._maybeHandleHeartbeatCommand(state);

            if (this._lastHeartbeatPublishTs && state.timestamp === this._lastHeartbeatPublishTs) {
                return;
            }
            this.handleHeartbeatUpdate(state, prevState || {}, source);
        });

        // Publish our current snapshot if we are the active audio workspace
        this.publishHeartbeatState({}, { includeQueue: true, reason: 'heartbeat-init' });
    }

    flushPendingHeartbeatState() {
        if (!this._pendingHeartbeatState) {
            return;
        }
        const pending = this._pendingHeartbeatState;
        this._pendingHeartbeatState = null;
        this.handleHeartbeatUpdate(pending.state, pending.prevState, 'pending-flush');
    }

    handleHeartbeatUpdate(state, prevState = null, source = 'heartbeat') {
        if (!state) {
            return;
        }

        if (this._isApplyingHeartbeatState) {
            return;
        }

        const heartbeatAudioWorkspace = state.audioWorkspaceId;
        const workspaceId = window.__panelTaskbar?.workspaceId;
        if (workspaceId && heartbeatAudioWorkspace && workspaceId === heartbeatAudioWorkspace) {
            // We are the audio workspace reflected in heartbeat, no need to ingest
            return;
        }
        
        // Prevent heartbeat sync from re-loading video during initial restoration on reload
        // This avoids the double-load where restoration loads video, then heartbeat re-loads it
        const now = Date.now();
        const timeSinceRestore = now - this._lastRestorationTimestamp;
        if (this._restored && timeSinceRestore < 3000 && this.isPrimaryWorkspace()) {
            console.log('[MusicPlayer] Skipping heartbeat sync during restoration window');
            return;
        }

        if (!this.player || !this._playerReady) {
            this._pendingHeartbeatState = { state, prevState };
            return;
        }

        if (this.ownsPlayback()) {
            return;
        }

        this._isApplyingHeartbeatState = true;
        try {
            this.syncFromSharedState(state, prevState);
        } finally {
            this._isApplyingHeartbeatState = false;
        }
    }

    _maybeHandleHeartbeatCommand(state) {
        if (!state || !this.isPrimaryWorkspace()) {
            return;
        }
        const command = state.remoteCommand;
        if (!command) {
            return;
        }
        const commandTimestamp = Number.isFinite(state.remoteCommandTimestamp)
            ? state.remoteCommandTimestamp
            : state.timestamp;
        if (!commandTimestamp || commandTimestamp === this._lastRemoteCommandTimestamp) {
            return;
        }
        this._lastRemoteCommandTimestamp = commandTimestamp;
        console.log('[MusicPlayer] Executing heartbeat remote command:', command);
        this.handleRemoteCommand(command, state.remoteCommandPayload || {});
    }

    publishHeartbeatState(partial = {}, options = {}) {
        const heartbeat = window.taskbarHeartbeat;
        if (!heartbeat || typeof heartbeat.setState !== 'function') {
            return;
        }

        if (this._isApplyingHeartbeatState && !options.force) {
            return;
        }

        const shouldPublish = options.force || this.ownsPlayback();
        if (!shouldPublish) {
            return;
        }

        const trackMeta = this.getCurrentTrackMeta() || {};
        const detail = this.buildDockDetail({
            isPlaying: typeof partial.isPlaying === 'boolean' ? partial.isPlaying : undefined,
            currentTime: typeof partial.currentTime === 'number' ? partial.currentTime : undefined,
            duration: typeof partial.duration === 'number' ? partial.duration : undefined
        });
        const queueIndex = typeof partial.currentQueueIndex === 'number'
            ? partial.currentQueueIndex
            : this.getCurrentTrackIndex();

        const updates = {};
        const assign = (key, value) => {
            if (value !== undefined) {
                updates[key] = value;
            }
        };

        assign('currentVideoId', partial.videoId ?? detail.videoId ?? null);
        assign('currentTime', typeof partial.currentTime === 'number' ? partial.currentTime : detail.currentTime);
        assign('duration', typeof partial.duration === 'number' ? partial.duration : detail.duration);
        assign('isPlaying', typeof partial.isPlaying === 'boolean' ? partial.isPlaying : detail.isPlaying);
        assign('trackTitle', partial.trackTitle ?? trackMeta.title ?? detail.title ?? null);
        assign('trackArtist', partial.trackArtist ?? trackMeta.channelTitle ?? detail.artist ?? null);
        assign('trackThumbnail', partial.trackThumbnail ?? trackMeta.thumbnail ?? trackMeta.thumbnailUrl ?? null);
        assign('channelId', partial.channelId ?? trackMeta.channelId ?? null);
        assign('currentQueueIndex', queueIndex);
        assign('shuffleEnabled', typeof partial.shuffleEnabled === 'boolean' ? partial.shuffleEnabled : this.shuffleEnabled);
        if (options.includeQueue) {
            assign('playlistQueue', partial.playlistQueue ?? (this.playlistData || []));
        }

        const workspaceId = window.__panelTaskbar?.workspaceId || null;
        const sharedAudioWorkspaceId = window.sharedStateManager?.get?.('audioWorkspaceId') || null;
        const resolvedAudioWorkspaceId = sharedAudioWorkspaceId || workspaceId || null;
        assign('audioWorkspaceId', resolvedAudioWorkspaceId);
        assign('primaryWorkspaceId', resolvedAudioWorkspaceId);

        if (!Object.keys(updates).length) {
            return;
        }

        heartbeat.setState(updates, options.reason || 'music-player');
        const latestState = typeof heartbeat.getState === 'function' ? heartbeat.getState() : null;
        if (latestState && typeof latestState.timestamp === 'number') {
            this._lastHeartbeatPublishTs = latestState.timestamp;
        } else {
            this._lastHeartbeatPublishTs = Date.now();
        }
        
        // Mirror important updates to sharedStateManager for consistency
        if (window.sharedStateManager && this.ownsPlayback()) {
            const sharedUpdates = {};
            if (updates.currentVideoId !== undefined) sharedUpdates.currentVideoId = updates.currentVideoId;
            if (updates.currentTime !== undefined) sharedUpdates.currentTime = updates.currentTime;
            if (updates.duration !== undefined) sharedUpdates.duration = updates.duration;
            if (updates.isPlaying !== undefined) sharedUpdates.isPlaying = updates.isPlaying;
            if (Object.keys(sharedUpdates).length > 0) {
                window.sharedStateManager.setState(sharedUpdates, options.reason || 'heartbeat-sync');
            }
        }
    }

    set playlistData(data) {
        this._playlistData = data;
        this._playlistReady = true;
        
        // Sync playlist to shared state manager - only the primary workspace should broadcast
        const canSyncQueue = this.ownsPlayback();
        if (canSyncQueue && window.sharedStateManager && data && data.length > 0) {
            const currentQueue = window.sharedStateManager.get('playlistQueue') || [];
            
            // Only update if queue is different (avoid infinite loops)
            const queueChanged = currentQueue.length !== data.length || 
                currentQueue.some((t, i) => t.vid !== data[i]?.vid);
            
            if (queueChanged) {
                window.sharedStateManager.setQueue(data, 'playlist-loaded');
                console.log('[MusicPlayer] Synced playlist to shared queue:', data.length, 'tracks');
            }
        }
        
        this._maybeRestoreLastState();

        const queueIndex = Array.isArray(data) && data.length
            ? data.findIndex((item) => item?.vid === this._currentVideoId)
            : -1;
        this.publishHeartbeatState({
            playlistQueue: data,
            currentQueueIndex: queueIndex,
            shuffleEnabled: this.shuffleEnabled
        }, {
            includeQueue: true,
            reason: 'playlist-loaded'
        });
    }
    get playlistData() {
        // Always read from shared state if available, fall back to local
        if (window.sharedStateManager) {
            const sharedQueue = window.sharedStateManager.get('playlistQueue');
            if (sharedQueue && sharedQueue.length > 0) {
                return sharedQueue;
            }
        }
        return this._playlistData;
    }

    connectedCallback() {
        // Create shadow DOM if not already created
        if (!this.shadowRoot) {
            if (!MUSIC_PLAYER_TEMPLATE) {
                console.error('[MusicPlayer] Shadow template not available');
                return;
            }
            this.attachShadow({ mode: 'open' });
            this.shadowRoot.appendChild(MUSIC_PLAYER_TEMPLATE.content.cloneNode(true));
        }

        if (!window.currentPlayerTabId) {
            const storedOwner = localStorage.getItem('musicPlayerCurrentOwner');
            if (storedOwner) {
                window.currentPlayerTabId = storedOwner;
            }
        }

        if (!this._taskbarReadyListenerAttached) {
            window.addEventListener('panel-taskbar-ready', this._taskbarReadyHandler);
            this._taskbarReadyListenerAttached = true;
        }

        this.initializeHeartbeatIntegration();

        // Player init: set _playerReady=true and maybe restore state
        const videoPlayer = this.getPanelPartner('video-player');
        console.log('[MusicPlayer] connectedCallback - found video-player:', !!videoPlayer);
        if (videoPlayer) {
            videoPlayer.addEventListener('player-initialized', (e) => {
                console.log('[MusicPlayer] player-initialized event received!', e.detail);
                this.player = e.detail.player;
                this._playerReady = true;
                this.initializeControls();
                this._maybeRestoreLastState();
                this.applyPendingLoad();
                this.enforceAudioState();
                this.flushPendingHeartbeatState();
            });
        }

        if (!this._onVideoSurfaceRestored) {
            this._onVideoSurfaceRestored = () => this.applyPendingLoad();
            document.addEventListener('video-surface-restored', this._onVideoSurfaceRestored);
        }

        // Subscribe to shared state changes from other tabs
        if (window.sharedStateManager && !this._sharedStateUnsubscribe) {
            this._sharedStateUnsubscribe = window.sharedStateManager.subscribe((newState, oldState, source) => {
                // Only react to changes from OTHER tabs, not our own
                if (source === 'local') return;
                
                // Sync shuffle state
                if (newState.shuffleEnabled !== oldState?.shuffleEnabled) {
                    this.shuffleEnabled = newState.shuffleEnabled;
                    const randomCheckbox = this.shadowRoot?.getElementById('random-checkbox');
                    if (randomCheckbox) {
                        randomCheckbox.checked = newState.shuffleEnabled;
                        this.updateShuffleIndicator(randomCheckbox.checked);
                    }
                    this.persistState('myShuffleEnabled', this.shuffleEnabled ? 'true' : 'false', { force: true });
                }

                if (Array.isArray(newState.shuffleHistory) && newState.shuffleHistory !== oldState?.shuffleHistory) {
                    this.shuffleHistory = newState.shuffleHistory.slice();
                    this.persistState('myShuffleHistory', JSON.stringify(this.shuffleHistory), { force: true });
                }

                if (typeof newState.backHistoryIndex === 'number' && newState.backHistoryIndex !== oldState?.backHistoryIndex) {
                    this.backHistoryIndex = newState.backHistoryIndex;
                    this.persistState('myBackHistoryIndex', String(this.backHistoryIndex), { force: true });
                }
                
                // Update local playlist if queue changed
                if (newState.playlistQueue && newState.playlistQueue !== oldState?.playlistQueue) {
                    this._playlistData = newState.playlistQueue;
                }
                
                // Handle remote commands from non-primary workspaces
                if (this.isPrimaryWorkspace() && newState.remoteCommand && 
                    newState.remoteCommandTimestamp !== this._lastRemoteCommandTimestamp) {
                    this._lastRemoteCommandTimestamp = newState.remoteCommandTimestamp;
                    console.log('[MusicPlayer] Executing remote command:', newState.remoteCommand);
                    this.handleRemoteCommand(newState.remoteCommand, newState.remoteCommandPayload);
                }
                
                // Sync playback state for non-primary workspaces
                if (!this.isPrimaryWorkspace()) {
                    this.syncFromSharedState(newState, oldState);
                }
                
                this.enforceAudioState(newState);

                if (window.DEBUG_MUSIC_PLAYER) {
                    console.log('[MusicPlayer] Received shared state update from', source);
                }
            });
        }

        // Listen for previous/next track events from video player
        this.addEventListener('previous-track', () => {
            this.markUserInteraction('previous-track-event');
            this.playPrevious();
        });
        this.addEventListener('next-track', () => {
            this.markUserInteraction('next-track-event');
            this.playNext();
        });

        const playPauseButton = this.shadowRoot.getElementById('play-pause-button');
        const prevButton = this.shadowRoot.getElementById('prev-button');
        const nextButton = this.shadowRoot.getElementById('next-button');
        const volumeControl = this.shadowRoot.getElementById('volume-control');
        const randomCheckbox = this.shadowRoot.getElementById('random-checkbox');
        const dockToggleButton = this.shadowRoot.getElementById('dock-toggle-button');

        playPauseButton.addEventListener('click', () => {
            this.markUserInteraction('toggle-play-pause');
            this.togglePlayPause();
        });
        prevButton.addEventListener('click', () => {
            this.markUserInteraction('previous-button');
            this.handleRemoteCommand('previous', { source: 'music-player-ui', timestamp: Date.now() });
        });
        nextButton.addEventListener('click', () => {
            this.markUserInteraction('next-button');
            this.handleRemoteCommand('next', { source: 'music-player-ui', timestamp: Date.now() });
        });
        
        // Dock toggle button
        if (dockToggleButton) {
            dockToggleButton.addEventListener('click', () => {
                this.markUserInteraction('dock-toggle');
                this.toggleDockMode();
            });
        }
        
        if (volumeControl) {
            volumeControl.addEventListener('xavi-volume-change', (e) => {
                const volume = e?.detail?.volume;
                if (volume === undefined || volume === null) return;
                this.markUserInteraction('volume-change');
                this.handleRemoteCommand('volume', { volume, source: 'music-player-ui', timestamp: Date.now() });
            });
        }
        randomCheckbox.addEventListener('change', () => {
            this.markUserInteraction('shuffle-toggle');
            // The checkbox is just a proxy for the unified shufflePlaylist logic so every
            // workspace (including passive ones) updates shared state consistently.
            const desiredState = randomCheckbox.checked;
            if (desiredState === this.shuffleEnabled) {
                return;
            }
            this.shufflePlaylist();
        });

        // Initialize from shared state
        if (volumeControl) {
            volumeControl.value = parseInt(this.getStoredString('myVolume') || '50', 10);
        }
        const sharedState = window.sharedStateManager;
        const sharedShuffle = typeof sharedState?.get === 'function' ? sharedState.get('shuffleEnabled') : undefined;
        let localShuffleStored = null;
        try {
            localShuffleStored = window.localStorage?.getItem('myShuffleEnabled');
        } catch (err) {
            localShuffleStored = null;
        }
        let initialShuffle = false;
        if (typeof sharedShuffle === 'boolean') {
            initialShuffle = sharedShuffle;
        } else if (localShuffleStored === 'true') {
            initialShuffle = true;
        }
        if (randomCheckbox) {
            randomCheckbox.checked = initialShuffle;
        }
        this.shuffleEnabled = initialShuffle;
        this.updateShuffleIndicator(this.shuffleEnabled);
        if (typeof sharedShuffle === 'boolean') {
            this.persistState('myShuffleEnabled', sharedShuffle ? 'true' : 'false', { force: true });
        } else if (localShuffleStored === null) {
            this.persistState('myShuffleEnabled', 'false', { force: true });
        }

        const sharedShuffleHistory = typeof sharedState?.get === 'function' ? sharedState.get('shuffleHistory') : null;
        if (Array.isArray(sharedShuffleHistory)) {
            this.shuffleHistory = sharedShuffleHistory.slice();
            this.persistState('myShuffleHistory', JSON.stringify(this.shuffleHistory), { force: true });
        } else {
            this.shuffleHistory = this.getStoredJson('myShuffleHistory', []);
        }

        const sharedBackIndex = typeof sharedState?.get === 'function' ? sharedState.get('backHistoryIndex') : undefined;
        if (typeof sharedBackIndex === 'number' && Number.isFinite(sharedBackIndex)) {
            this.backHistoryIndex = sharedBackIndex;
            this.persistState('myBackHistoryIndex', String(this.backHistoryIndex), { force: true });
        } else {
            const storedBack = parseInt(this.getStoredString('myBackHistoryIndex') || '-1', 10);
            this.backHistoryIndex = Number.isFinite(storedBack) ? storedBack : -1;
        }

        if (sharedState && typeof sharedShuffle !== 'boolean' && this.ownsPlayback()) {
            sharedState.setState({
                shuffleEnabled: this.shuffleEnabled,
                shuffleHistory: this.shuffleHistory,
                backHistoryIndex: this.backHistoryIndex,
                timestamp: Date.now()
            }, 'shuffle-init');
        }

        // Listen for state changes from VideoPlayer
        this.addEventListener('player-state-changed', (e) => this.onPlayerStateChange(e.detail));
        
        // Listen for player errors (login-walled, unavailable videos)
        this.addEventListener('player-error', (e) => this.onPlayerError(e.detail));
        
        // Initialize error tracking for unplayable videos
        this._failedVideoIds = new Set();
        this._loadTimeoutHandle = null;
        
        // Track last restoration to prevent duplicates on reload
        this._lastRestorationTimestamp = 0;

        // Ensure new tracks honor their requested start time
        this._pendingStartCorrection = null;
        this.pendingVideoMeta = null;
        if (!window.stateSync) {
            const relevantKeys = new Set([
                'myCurrentVideoID',
                'myCurrentTime',
                'myIsPlaying',
                'myLastPlayTimestamp',
                'myShuffleEnabled',
                'myShuffleHistory',
                'myBackHistoryIndex',
                'myVolume',
                'musicPlayerCurrentOwner'
            ]);
            this._onXaviStateApplied = (event) => {
                const keys = Array.isArray(event?.detail?.keys) ? event.detail.keys : [];
                if (keys.length) {
                    const pendingOnly = keys.every((key) => this._shouldSkipStateSyncKey(key));
                    if (pendingOnly) {
                        return;
                    }
                    const hasRelevant = keys.some((key) => relevantKeys.has(key));
                    if (!hasRelevant) {
                        return;
                    }
                    if (keys.includes('musicPlayerCurrentOwner')) {
                        if (this.ownsPlayback()) {
                            return;
                        }
                    } else if (this.ownsPlayback()) {
                        return;
                    }
                } else if (this.ownsPlayback()) {
                    return;
                }

                this._maybeRestoreLastState(true);
            };
            window.addEventListener('xavi-sync:state-applied', this._onXaviStateApplied);
        }

        this.enforceAudioState();
        this.restoreDockMode();
        this.initializeCrossTabSync();
        this.startPlaybackIntegrityWatcher();
    }

    disconnectedCallback() {
        if (this._heartbeatUnsubscribe) {
            this._heartbeatUnsubscribe();
            this._heartbeatUnsubscribe = null;
        }

        if (this._heartbeatRetryHandle) {
            clearTimeout(this._heartbeatRetryHandle);
            this._heartbeatRetryHandle = null;
        }

        if (this._onXaviStateApplied) {
            window.removeEventListener('xavi-sync:state-applied', this._onXaviStateApplied);
            this._onXaviStateApplied = null;
        }

        if (this.stateSyncUnsubscribe) {
            this.stateSyncUnsubscribe();
            this.stateSyncUnsubscribe = null;
        }

        if (this._sharedStateUnsubscribe) {
            this._sharedStateUnsubscribe();
            this._sharedStateUnsubscribe = null;
        }

        if (this.timeUpdateInterval) {
            clearInterval(this.timeUpdateInterval);
            this.timeUpdateInterval = null;
        }

        if (this._onVideoSurfaceRestored) {
            document.removeEventListener('video-surface-restored', this._onVideoSurfaceRestored);
            this._onVideoSurfaceRestored = null;
        }

        if (this._pendingLoadRetry) {
            clearTimeout(this._pendingLoadRetry);
            this._pendingLoadRetry = null;
        }

        if (this._restoreRetry) {
            clearTimeout(this._restoreRetry);
            this._restoreRetry = null;
        }

        if (this._taskbarReadyListenerAttached) {
            window.removeEventListener('panel-taskbar-ready', this._taskbarReadyHandler);
            this._taskbarReadyListenerAttached = false;
        }

        if (this._loadTimeoutHandle) {
            clearTimeout(this._loadTimeoutHandle);
            this._loadTimeoutHandle = null;
        }

        if (this._startCorrectionTimer) {
            clearTimeout(this._startCorrectionTimer);
            this._startCorrectionTimer = null;
        }
        this._pendingStartCorrection = null;

        this.teardownCrossTabSync();
        this.stopPlaybackIntegrityWatcher();
    }

    initializeCrossTabSync() {
        if (!this._musicChannelHandler) {
            this._musicChannelHandler = (event) => this.handleMusicChannelMessage(event);
        }
        if (!this._musicChannelBound) {
            this._attemptMusicChannelBinding();
        }
        if (!this._musicChannelBound && !this._musicChannelRetry) {
            this._musicChannelRetry = setInterval(() => {
                if (this._attemptMusicChannelBinding()) {
                    clearInterval(this._musicChannelRetry);
                    this._musicChannelRetry = null;
                }
            }, 400);
        }

        if (!this._storageSyncHandler) {
            this._storageSyncHandler = (event) => this.handleStorageEvent(event);
            window.addEventListener('storage', this._storageSyncHandler);
        }
    }

    _attemptMusicChannelBinding() {
        const channel = window.musicChannel;
        if (!channel || typeof channel.addEventListener !== 'function' || this._musicChannelBound || !this._musicChannelHandler) {
            return this._musicChannelBound;
        }
        channel.addEventListener('message', this._musicChannelHandler);
        this._musicChannelBound = true;
        return true;
    }

    teardownCrossTabSync() {
        if (this._musicChannelRetry) {
            clearInterval(this._musicChannelRetry);
            this._musicChannelRetry = null;
        }
        if (this._musicChannelBound && this._musicChannelHandler && window.musicChannel && typeof window.musicChannel.removeEventListener === 'function') {
            window.musicChannel.removeEventListener('message', this._musicChannelHandler);
        }
        this._musicChannelBound = false;

        if (this._storageSyncHandler) {
            window.removeEventListener('storage', this._storageSyncHandler);
            this._storageSyncHandler = null;
        }
    }

    handleMusicChannelMessage(event) {
        const data = event?.data;
        if (!data || !data.action) {
            return;
        }

        if (data.action === 'progress_update') {
            if (data.tabId && window.myTabId && data.tabId === window.myTabId) {
                return;
            }
            this.applyRemoteProgress(data);
            return;
        }

        if (data.action === 'remote_control') {
            if (data.targetTabId && window.myTabId && data.targetTabId !== window.myTabId) {
                return;
            }
            this.handleRemoteCommand(data.command, data.payload || {});
            return;
        }

        if (data.action === 'claim_audio') {
            if (data.tabId && data.tabId !== window.myTabId) {
                // Another tab claimed audio - mute ourselves
                this.muteAudio();
            }
            return;
        }

        if (data.action === 'close_workspace') {
            // Another tab closed a workspace
            if (data.workspaceId && window.__panelTaskbar && window.__panelTaskbar.workspaceId === data.workspaceId) {
                // This is us - close the window
                console.log('[MusicPlayer] Workspace closed remotely, closing window');
                window.close();
            }
            return;
        }

        if (data.action === 'claim_ownership') {
            window.currentPlayerTabId = data.tabId || null;
            if (data.tabId === window.myTabId) {
                this._maybeRestoreLastState(true);
            } else if (data.tabId && data.tabId !== window.myTabId) {
                this.isPlaying = false;
                this.emitDockState({ isPlaying: false });
            }
            return;
        }

        if (data.action === 'force_pause') {
            if (data.tabId && window.myTabId && data.tabId === window.myTabId) {
                return;
            }
            this.pause(true);
            this.emitDockState({ isPlaying: false });
        }
    }

    handleRemoteCommand(command, payload = {}) {
        if (!command) {
            return false;
        }

        const normalizedCommand = typeof command === 'string' ? command.toLowerCase() : command;

        // Allow non-primary workspaces to send commands that primary will execute
        const isPrimary = this.isPrimaryWorkspace();
        
        if (isPrimary) {
            // Primary workspace executes commands
            switch (normalizedCommand) {
                case 'play':
                    this.play(true);
                    return true;
                case 'pause':
                    this.pause(true);
                    return true;
                case 'next':
                    this.playNext();
                    return true;
                case 'previous':
                    this.playPrevious();
                    return true;
                case 'seek':
                    return this.applySeekCommandPayload(payload);
                case 'volume':
                case 'setvolume':
                case 'set_volume':
                    return this.applyVolumeCommandPayload(payload);
                default:
                    return false;
            }
        } else {
            // Non-primary workspace sends command via shared state / heartbeat
            return this.dispatchRemoteCommandToPrimary(normalizedCommand, payload);
        }
    }

    applyVolumeCommandPayload(payload = {}) {
        const raw = payload.volume ?? payload.value ?? payload.level;
        const numeric = Number.isFinite(raw) ? raw : parseFloat(raw);
        if (!Number.isFinite(numeric)) {
            return false;
        }

        const safeVolume = Math.max(0, Math.min(100, numeric));

        try {
            const volumeControl = this.shadowRoot?.getElementById('volume-control');
            if (volumeControl) {
                volumeControl.value = Math.round(safeVolume);
            }
        } catch (err) {
            /* ignore */
        }

        try {
            if (this.player && typeof this.player.setVolume === 'function') {
                this.player.setVolume(safeVolume);
            }
        } catch (err) {
            console.warn('[MusicPlayer] Failed to apply volume:', err);
        }

        if (this.ownsPlayback()) {
            this.persistState('myVolume', String(Math.round(safeVolume)));
            this.touchPlaybackTimestamp();
        }

        if (typeof document !== 'undefined') {
            document.dispatchEvent(new CustomEvent('volume-changed', {
                detail: { volume: safeVolume, source: payload.source || 'remote-volume' }
            }));
        }

        return true;
    }

    dispatchRemoteCommandToPrimary(command, payload = {}) {
        const timestamp = Date.now();
        let dispatched = false;

        if (window.sharedStateManager && typeof window.sharedStateManager.setState === 'function') {
            window.sharedStateManager.setState({
                remoteCommand: command,
                remoteCommandPayload: payload,
                remoteCommandTimestamp: timestamp
            }, 'remote-command');
            dispatched = true;
        }

        const heartbeat = window.taskbarHeartbeat;
        if (heartbeat && typeof heartbeat.setState === 'function') {
            heartbeat.setState({
                remoteCommand: command,
                remoteCommandPayload: payload,
                remoteCommandTimestamp: timestamp
            }, 'remote-command');
            dispatched = true;
        }

        if (!dispatched) {
            dispatched = this.delegateCommand(command, payload);
        }

        return dispatched;
    }

    applySeekCommandPayload(payload = {}) {
        const rawTime = payload.time ?? payload.currentTime ?? payload.position ?? payload.seekTime;
        const hasNumericTime = Number.isFinite(rawTime) || Number.isFinite(parseFloat(rawTime));
        const targetVideoId = payload.videoId || this._currentVideoId;

        if (!targetVideoId || !hasNumericTime) {
            return false;
        }

        const numericTime = Number.isFinite(rawTime) ? rawTime : parseFloat(rawTime);
        const durationHint = Number.isFinite(payload.duration)
            ? payload.duration
            : Number.isFinite(parseFloat(payload.duration || NaN))
                ? parseFloat(payload.duration)
                : null;
        const seekDuration = Number.isFinite(durationHint) ? durationHint : this.getTrackDuration(targetVideoId);
        const safeTime = this.sanitizeTime(numericTime, seekDuration);

        if (targetVideoId !== this._currentVideoId) {
            const shouldPlay = typeof payload.play === 'boolean' ? payload.play : this.isPlaying;
            this.loadVideo(targetVideoId, safeTime, shouldPlay, { source: payload.source || 'remote-seek' });
        } else if (this.player && typeof this.player.seekTo === 'function') {
            try {
                this.player.seekTo(safeTime, true);
            } catch (err) {
                console.warn('[MusicPlayer] Failed to apply seek command:', err);
            }
        }

        if (this.ownsPlayback()) {
            this.persistState('myCurrentTime', safeTime.toString());
        }

        this.handleRemoteSeekPreview(safeTime, seekDuration, {
            skipBroadcast: false,
            timestamp: payload.timestamp,
            playbackTimestamp: payload.playbackTimestamp,
            videoIdOverride: targetVideoId
        });

        return true;
    }

    handleStorageEvent(event) {
        if (!event || event.storageArea !== window.localStorage || !event.key) {
            return;
        }

        if (event.key === 'musicAudioOwner') {
            if (event.newValue && event.newValue !== window.myTabId) {
                this.muteAudio('storage-owner-changed');
            } else if (event.newValue === window.myTabId) {
                if (this.player && typeof this.player.unMute === 'function') {
                    this.player.unMute();
                }
                this.updateWindowMuteState(false, 'storage-owner');
            }
            return;
        }

        if (this.ownsPlayback && this.ownsPlayback()) {
            return;
        }

        let globalVideoId = null;
        try {
            globalVideoId = localStorage.getItem('myCurrentVideoID') || null;
        } catch (error) {
            globalVideoId = null;
        }

        if (event.key === 'myCurrentVideoID') {
            const videoId = event.newValue;
            if (!videoId) {
                return;
            }

            if (typeof this.previewRemoteSelection === 'function') {
                this.previewRemoteSelection(videoId, 0, { skipBroadcast: true });
            }

            if (typeof this.emitDockState === 'function') {
                this.emitDockState({ currentTime: 0 });
            }

            this._currentVideoId = videoId;
            return;
        }

        if (event.key === 'myCurrentTime') {
            const numericTime = parseFloat(event.newValue || '0');
            if (!Number.isFinite(numericTime)) {
                return;
            }

            if (!globalVideoId || globalVideoId !== this._currentVideoId) {
                return;
            }

            if (typeof this.handleRemoteSeekPreview === 'function') {
                this.handleRemoteSeekPreview(numericTime, null, { skipBroadcast: true });
            }

            if (typeof this.emitDockState === 'function') {
                this.emitDockState({ currentTime: numericTime });
            }
            return;
        }

        if (event.key === 'myIsPlaying') {
            if (!globalVideoId || globalVideoId !== this._currentVideoId) {
                return;
            }

            const shouldPlay = event.newValue === '1';
            if (shouldPlay) {
                this.play && this.play();
            } else {
                this.pause && this.pause();
            }
            return;
        }

        if (event.key === 'musicPlayerCurrentOwner') {
            window.currentPlayerTabId = event.newValue;
            this.enforceAudioState();
            if (event.newValue === window.myTabId) {
                this._maybeRestoreLastState(true);
            } else if (event.newValue && event.newValue !== window.myTabId) {
                this.isPlaying = false;
                this.emitDockState({ isPlaying: false });
            }
        }
    }


    buildDockDetail(overrides = {}) {
        const meta = this.getCurrentTrackMeta() || {};
        const durationSource = overrides.duration ?? this.duration ?? meta.duration ?? this.getTrackDuration(meta.vid || this._currentVideoId);
        
        // Priority: override > player current time > last persisted > localStorage > 0
        let timeSource;
        if (overrides.currentTime !== undefined) {
            timeSource = overrides.currentTime;
        } else if (this.player && typeof this.player.getCurrentTime === 'function') {
            const playerTime = this.player.getCurrentTime();
            timeSource = Number.isFinite(playerTime) ? playerTime : this._lastPersistedTime;
        } else {
            // Inactive tab: use last persisted or read from localStorage
            timeSource = this._lastPersistedTime;
            if (!Number.isFinite(timeSource) || timeSource === null) {
                const stored = parseFloat(this.getStoredString('myCurrentTime') || '0');
                timeSource = Number.isFinite(stored) ? stored : 0;
            }
        }
        
        return {
            videoId: meta.vid || this._currentVideoId,
            title: meta.title || 'Unknown Track',
            channelTitle: meta.channelTitle || 'Unknown Artist',
            artist: meta.channelTitle || 'Unknown Artist',
            isPlaying: typeof overrides.isPlaying === 'boolean' ? overrides.isPlaying : this.isPlaying,
            currentTime: Number.isFinite(timeSource) ? timeSource : 0,
            duration: Number.isFinite(durationSource) ? durationSource : 0
        };
    }

    emitDockState(overrides = {}) {
        if (typeof document === 'undefined') {
            return;
        }
        const detail = this.buildDockDetail(overrides);
        this._lastDockDetail = detail;
        document.dispatchEvent(new CustomEvent('music-track-changed', { detail }));
        document.dispatchEvent(new CustomEvent('music-playback-state', { detail }));
        document.dispatchEvent(new CustomEvent('music-time-update', { detail }));
    }
    // ---- RESTORE LOGIC ----
    _maybeRestoreLastState(force = false) {
        if (!this._playlistReady || !this._playerReady) {
            return;
        }

        if (this._restored && !force) {
            return;
        }

        if (!window.__panelTaskbar?.workspaceId) {
            if (this._restoreRetry) {
                clearTimeout(this._restoreRetry);
            }
            this._restoreRetry = setTimeout(() => this._maybeRestoreLastState(force), 300);
            return;
        }

        if (!window.sharedStateManager) {
            if (this._restoreRetry) {
                clearTimeout(this._restoreRetry);
            }
            this._restoreRetry = setTimeout(() => this._maybeRestoreLastState(force), 300);
            return;
        }

        const restored = this._restoreFromStorage(force);

        if (restored) {
            this._restored = true;
            return;
        }

        const workspaceId = window.__panelTaskbar?.workspaceId || null;
        const audioWorkspaceId = window.sharedStateManager?.get?.('audioWorkspaceId') || null;
        const isAudioWorkspace = workspaceId && audioWorkspaceId && workspaceId === audioWorkspaceId;

        if (!this._restored && !force && this._playlistData.length && isAudioWorkspace) {
            this.loadVideo(this._playlistData[0].vid, 0, false);
            this._restored = true;
        }
    }
    // ---- END RESTORE LOGIC ----

    _restoreFromStorage(force = false) {
        const storedVid = this.getStoredString('myCurrentVideoID');
        if (!storedVid) {
            return false;
        }

        const playlistHasVid = this._playlistData.some((v) => v.vid === storedVid);
        if (!playlistHasVid) {
            return false;
        }

        const storedTime = parseFloat(this.getStoredString('myCurrentTime') || '0');
        const storedPlaying = this.getStoredString('myIsPlaying') === '1';
        const lastPlayTs = parseInt(this.getStoredString('myLastPlayTimestamp') || '0', 10);
        const now = Date.now();
        const timeSinceLastPlay = now - lastPlayTs;

        if (!force && timeSinceLastPlay > 600000) {
            return false;
        }
        
        // Prevent duplicate restoration within 2 seconds (reload double-load fix)
        const timeSinceLastRestore = now - this._lastRestorationTimestamp;
        if (timeSinceLastRestore < 2000 && !force) {
            console.log('[MusicPlayer] Skipping duplicate restoration (within 2s)');
            return false;
        }

        // Check if this workspace should have audio
        const workspaceId = window.__panelTaskbar?.workspaceId;
        const audioWorkspaceId = window.sharedStateManager?.get('audioWorkspaceId');
        const shouldHaveAudio = workspaceId && audioWorkspaceId === workspaceId;
        
        // Only restore/play if this is the audio workspace
        // Non-audio workspaces should NOT load video on restore to avoid disrupting playback
        if (!shouldHaveAudio) {
            console.log('[MusicPlayer] Not audio workspace, skipping restore to avoid disruption');
            return false;
        }
        
        // This is the audio workspace - restore normally
        let shouldPlay = storedPlaying;

        const currentTime = typeof this.player?.getCurrentTime === 'function' ? this.player.getCurrentTime() : 0;
        const sameVideo = this._currentVideoId === storedVid;
        const timeTolerance = force ? 5 : 2;
        const nearStoredTime = Math.abs((currentTime || 0) - storedTime) <= timeTolerance;
        
        // Check player state to avoid restarting already-playing video
        const playerState = typeof this.player?.getPlayerState === 'function' ? this.player.getPlayerState() : null;
        const isCurrentlyPlaying = playerState === YT.PlayerState.PLAYING || playerState === YT.PlayerState.BUFFERING;

        // If same video, near the same time, and play state matches, skip restoration
        if (sameVideo && nearStoredTime && this.isPlaying === shouldPlay) {
            console.log('[MusicPlayer] Already at correct state, skipping restoration');
            return false;
        }
        
        // If video is already playing at approximately the right position, don't restart it
        if (sameVideo && nearStoredTime && isCurrentlyPlaying && shouldPlay) {
            console.log('[MusicPlayer] Video already playing at correct position, skipping restoration');
            this._lastRestorationTimestamp = now;
            return true; // Return true to mark as "restored" and prevent fallback loads
        }

        this._lastRestorationTimestamp = now;
        this.loadVideo(storedVid, storedTime, shouldPlay, { persist: false, source: 'restore' });
        return true;
    }

    loadVideo(videoId, startTime = 0, play = false, options = {}) {
        console.log('[MusicPlayer] loadVideo called:', { videoId, startTime, play, options, hasPlayer: !!this.player, playerReady: this._playerReady });
        
        const { persist = true, source = 'local' } = options || {};
        const numericStartTime = Number.isFinite(startTime) ? startTime : parseFloat(startTime) || 0;
        let effectivePlay = !!play;
        const allowPersist = persist !== false && this.isPrimaryWorkspace();

        if (effectivePlay && !this.isPrimaryWorkspace()) {
            console.log('[MusicPlayer] Workspace is not primary - forcing silent load. Use the taskbar speaker to enable audio.');
            effectivePlay = false;
        }

        // Multi-focal architecture: Auto-claim audio if not set and playing
        if (effectivePlay) {
            this.autoClaimAudioIfNeeded();
        }

        // Mark that we're changing videos to prevent heartbeat from persisting wrong time
        const isChangingVideo = this._currentVideoId && this._currentVideoId !== videoId;
        if (isChangingVideo || effectivePlay) {
            this._changingVideo = true;
        }

        this._currentVideoId = videoId;
        this.updateTrackInfo();
        // Reset play state until the player actually reports PLAYING
        if (this.isPlaying) {
            this.isPlaying = false;
            this.updatePlayPauseButton();
            this.emitDockState({ isPlaying: false });
        }
        const trackMeta = this.getCurrentTrackMeta();
        const trackDuration = Number.isFinite(trackMeta?.duration) && trackMeta.duration > 0 ? trackMeta.duration : null;
        if (trackDuration !== null) {
            this.duration = trackDuration;
        }

        const fallbackDuration = trackDuration ?? this.duration ?? this.getTrackDuration(videoId);
        const safeStartTime = this.sanitizeTime(numericStartTime, fallbackDuration);
        this.pendingVideoMeta = { videoId, startTime: safeStartTime, play: effectivePlay };

        if (effectivePlay) {
            this.setStartCorrectionTarget(videoId, safeStartTime);
        } else {
            this.clearStartCorrection();
        }

        let surfaceReady = true;
        if (effectivePlay) {
            surfaceReady = this.ensurePlaybackSurface();
        }

        if (effectivePlay && !surfaceReady) {
            this.pendingLoad = { videoId, startTime: safeStartTime, play: true, persist: allowPersist };
            this._schedulePendingLoadRetry();
            this.isPlaying = false;
            this.updatePlayPauseButton();
            if (allowPersist) {
                this.persistState('myCurrentVideoID', videoId);
                this.persistState('myCurrentTime', safeStartTime.toString());
                this.persistState('myIsPlaying', '0');
            }
            this._lastPersistedTime = safeStartTime;
            this.broadcastPlaylistProgress(safeStartTime, trackDuration);
            this.publishHeartbeatState({
                videoId,
                currentTime: safeStartTime,
                duration: Number.isFinite(trackDuration) && trackDuration > 0 ? trackDuration : undefined,
                isPlaying: false
            }, { reason: 'track-load' });
            this.dispatchEvent(new CustomEvent('video-changed', {
                detail: {
                    videoId,
                    startTime: safeStartTime,
                    play: false,
                    title: trackMeta?.title || null,
                    channelTitle: trackMeta?.channelTitle || null,
                    channelId: trackMeta?.channelId || null,
                    duration: trackMeta?.duration || null,
                    source
                }
            }));
            return;
        }

        const requestedPlay = effectivePlay && surfaceReady;
        const applied = this.applyLoadToPlayer(videoId, safeStartTime, requestedPlay);
        if (typeof window !== 'undefined') {
            window.__xaviApplyLoad = {
                videoId,
                startTime: safeStartTime,
                requestedPlay,
                applied,
                timestamp: Date.now()
            };
        }
        if (!applied) {
            this.pendingLoad = { videoId, startTime: safeStartTime, play: requestedPlay, persist: allowPersist };
            this._schedulePendingLoadRetry();
        } else {
            this.pendingLoad = null;
            if (requestedPlay) {
                this.queueStartCorrectionCheck();
            }
        }

        if (allowPersist) {
            this.persistState('myCurrentVideoID', videoId);
            this.persistState('myCurrentTime', safeStartTime.toString());
            this.persistState('myIsPlaying', '0');
            if (applied && effectivePlay) {
                this.touchPlaybackTimestamp();
            }
        }

        if (typeof window !== 'undefined') {
            window.__xaviLastLoad = {
                videoId,
                startTime: safeStartTime,
                requestedPlay,
                surfaceReady,
                applied,
                effectivePlay,
                timestamp: Date.now()
            };
        }

        this._lastPersistedTime = safeStartTime;
        this.broadcastPlaylistProgress(safeStartTime, trackDuration);
        this.publishHeartbeatState({
            videoId,
            currentTime: safeStartTime,
            duration: Number.isFinite(trackDuration) && trackDuration > 0 ? trackDuration : undefined,
            isPlaying: this.isPlaying
        }, { reason: 'track-load' });
        
        // Sync to shared state - update current track in queue
        if (window.sharedStateManager && allowPersist) {
            const queue = window.sharedStateManager.get('playlistQueue') || [];
            const queueIdx = queue.findIndex(t => t.vid === videoId);
            if (queueIdx >= 0) {
                window.sharedStateManager.setState({
                    currentQueueIndex: queueIdx,
                    currentVideoId: videoId,
                    currentTime: safeStartTime,
                    duration: trackDuration || this.duration,
                    isPlaying: this.isPlaying,
                    trackTitle: trackMeta?.title || 'Unknown Track',
                    trackArtist: trackMeta?.channelTitle || 'Unknown Artist',
                    timestamp: Date.now()
                }, 'loadVideo');
            }
        }
        
        this.dispatchEvent(new CustomEvent('video-changed', {
            detail: {
                videoId,
                startTime: safeStartTime,
                play: applied && effectivePlay,
                title: trackMeta?.title || null,
                channelTitle: trackMeta?.channelTitle || null,
                channelId: trackMeta?.channelId || null,
                duration: trackMeta?.duration || null,
                source
            }
        }));

        this.emitDockState({
            currentTime: safeStartTime,
            duration: trackMeta?.duration ?? this.duration,
            isPlaying: this.isPlaying
        });
    }

    applyLoadToPlayer(videoId, startTime = 0, play = false) {
        console.log('[MusicPlayer] applyLoadToPlayer:', { videoId, startTime, play, hasPlayer: !!this.player, playerReady: this._playerReady });
        
        if (!this.player || !this._playerReady || typeof this.player.loadVideoById !== 'function') {
            console.warn('[MusicPlayer] Player not ready! player:', !!this.player, 'ready:', this._playerReady, 'hasMethod:', !!this.player?.loadVideoById);
            return false;
        }

        const duration = typeof this.player.getDuration === 'function' ? this.player.getDuration() : 0;
        const safeTime = this.sanitizeTime(startTime, duration);
        const meta = { videoId, time: safeTime, play: !!play };

        if (!this.shouldApplyLoad(meta)) {
            this._lastLoadMeta = { ...meta, ts: Date.now() };
            return true;
        }

        console.log('[MusicPlayer] Loading video into YouTube player:', { videoId: meta.videoId, time: meta.time, play: meta.play });
        
        try {
            if (meta.play) {
                this.player.loadVideoById({ videoId: meta.videoId, startSeconds: meta.time });
                console.log('[MusicPlayer] Called loadVideoById with play=true');
            } else if (typeof this.player.cueVideoById === 'function') {
                this.player.cueVideoById({ videoId: meta.videoId, startSeconds: meta.time });
            } else {
                this.player.loadVideoById({ videoId: meta.videoId, startSeconds: meta.time });
                if (typeof this.player.pauseVideo === 'function') {
                    this.player.pauseVideo();
                }
            }
        } catch (error) {
            try {
                if (meta.play) {
                    this.player.loadVideoById(meta.videoId, meta.time);
                } else if (typeof this.player.cueVideoById === 'function') {
                    this.player.cueVideoById(meta.videoId, meta.time);
                } else {
                    this.player.loadVideoById(meta.videoId, meta.time);
                    if (typeof this.player.pauseVideo === 'function') {
                        this.player.pauseVideo();
                    }
                }
            } catch (secondaryError) {
                return false;
            }
        }

        if (meta.play && typeof this.player.playVideo === 'function') {
            console.log('[MusicPlayer] Attempting to play video after load');
            const attemptPlay = () => {
                try {
                    console.log('[MusicPlayer] Calling playVideo()');
                    const maybePromise = this.player.playVideo();
                    if (maybePromise && typeof maybePromise.then === 'function') {
                        maybePromise.then(() => {
                            console.log('[MusicPlayer] playVideo() succeeded');
                        }).catch((err) => {
                            console.warn('[MusicPlayer] playVideo() rejected:', err);
                            // Retry once after brief delay if promise rejected
                            setTimeout(() => {
                                if (this.isPlaying && typeof this.player.playVideo === 'function') {
                                    this.player.playVideo().catch(() => {});
                                }
                            }, 300);
                        });
                    }
                } catch (error) {
                    /* ignore autoplay restrictions */
                }
            };
            
            attemptPlay();
            
            // Also retry after YouTube player processes the load
            setTimeout(() => {
                if (this.isPlaying && this.player && typeof this.player.getPlayerState === 'function') {
                    const state = this.player.getPlayerState();
                    // If not playing or buffering, try again
                    if (state !== YT.PlayerState.PLAYING && state !== YT.PlayerState.BUFFERING) {
                        attemptPlay();
                    }
                }
            }, 500);

            const partner = this.getPanelPartner('video-player');
            const ytIframe = partner?.shadowRoot?.querySelector('iframe');
            if (ytIframe && typeof ytIframe.focus === 'function') {
                ytIframe.focus();
            }
        }

        this._lastLoadMeta = { ...meta, ts: Date.now() };
        
        // Set timeout watchdog to detect unplayable videos (login-walled, unavailable)
        // If video doesn't reach PLAYING or BUFFERING state within 8s, assume it's blocked
        if (meta.play) {
            if (this._loadTimeoutHandle) {
                clearTimeout(this._loadTimeoutHandle);
            }
            this._loadTimeoutHandle = setTimeout(() => {
                if (this.player && typeof this.player.getPlayerState === 'function') {
                    const state = this.player.getPlayerState();
                    // UNSTARTED(-1) or VIDEO_CUED(5) without transition = blocked video
                    if (state === YT.PlayerState.UNSTARTED || state === YT.PlayerState.CUED) {
                        console.warn('[MusicPlayer] Video stuck in unplayable state, skipping:', meta.videoId);
                        this.onPlayerError({ errorCode: 'timeout', videoId: meta.videoId });
                    }
                }
                this._loadTimeoutHandle = null;
            }, 8000);
        }
        
        return true;
    }

    _schedulePendingLoadRetry(delay = 350) {
        if (this._pendingLoadRetry) {
            return;
        }
        if (!this._pendingLoadRetryCount) {
            this._pendingLoadRetryCount = 0;
        }
        this._pendingLoadRetryCount++;
        if (this._pendingLoadRetryCount > 3) {
            console.warn('[MusicPlayer] Pending load retry limit reached, clearing');
            this.pendingLoad = null;
            this._pendingLoadRetryCount = 0;
            return;
        }
        this._pendingLoadRetry = setTimeout(() => {
            this._pendingLoadRetry = null;
            this.applyPendingLoad();
        }, Math.max(150, delay));
    }

    applyPendingLoad() {
        if (!this.pendingLoad) {
            return;
        }

        const { videoId, startTime, play, persist = true } = this.pendingLoad;
        const wantsPlay = !!play;
        if (wantsPlay && !this.ensurePlaybackSurface()) {
            this._schedulePendingLoadRetry(400);
            return;
        }

        const trackDuration = this.getTrackDuration(videoId);
        const safeStart = this.sanitizeTime(startTime, trackDuration);
        if (wantsPlay) {
            this.setStartCorrectionTarget(videoId, safeStart);
            this._changingVideo = true;
        }
        this.pendingVideoMeta = { videoId, startTime: safeStart, play: wantsPlay };

        if (this.applyLoadToPlayer(videoId, safeStart, wantsPlay)) {
            if (this._pendingLoadRetry) {
                clearTimeout(this._pendingLoadRetry);
                this._pendingLoadRetry = null;
            }
            this._pendingLoadRetryCount = 0;
            this._lastLoadMeta = { videoId, time: safeStart, play: wantsPlay, ts: Date.now() };
            if (persist) {
                this.persistState('myCurrentVideoID', videoId);
                this.persistState('myCurrentTime', safeStart.toString());
                this.persistState('myIsPlaying', '0');
                if (wantsPlay) {
                    this.touchPlaybackTimestamp();
                }
            }
            this._lastPersistedTime = safeStart;
            const trackMeta = this.getCurrentTrackMeta();
            const resolvedDuration = Number.isFinite(trackMeta?.duration) && trackMeta.duration > 0 ? trackMeta.duration : null;
            this.broadcastPlaylistProgress(safeStart, resolvedDuration ?? trackDuration);
            if (wantsPlay) {
                this.queueStartCorrectionCheck();
            }
            this.pendingLoad = null;
        } else {
            this.pendingLoad = { videoId, startTime: safeStart, play: wantsPlay, persist };
            this._schedulePendingLoadRetry(500);
        }
    }

    setStartCorrectionTarget(videoId, time = 0) {
        if (!videoId) {
            this.clearStartCorrection();
            return;
        }
        const numericTime = Number.isFinite(time) ? time : parseFloat(time) || 0;
        this._pendingStartCorrection = {
            videoId,
            time: numericTime,
            attempts: 0,
            createdAt: Date.now()
        };
    }

    queueStartCorrectionCheck(delay = 120) {
        if (!this._pendingStartCorrection) {
            return;
        }
        if (this._startCorrectionTimer) {
            clearTimeout(this._startCorrectionTimer);
        }
        this._startCorrectionTimer = setTimeout(() => {
            this._startCorrectionTimer = null;
            this.enforceStartCorrection();
        }, Math.max(60, delay));
    }

    enforceStartCorrection() {
        const pending = this._pendingStartCorrection;
        if (!pending || pending.videoId !== this._currentVideoId) {
            this.clearStartCorrection();
            return true;
        }

        if (!this.player || typeof this.player.getCurrentTime !== 'function') {
            this.queueStartCorrectionCheck(200);
            return false;
        }

        const current = this.player.getCurrentTime();
        if (!Number.isFinite(current)) {
            this.queueStartCorrectionCheck(200);
            return false;
        }

        // Calculate acceptable drift based on time since request
        const timeSinceRequest = (Date.now() - pending.createdAt) / 1000;
        
        let isPlaying = false;
        if (typeof this.player.getPlayerState === 'function' && typeof YT !== 'undefined') {
             const state = this.player.getPlayerState();
             isPlaying = (state === YT.PlayerState.PLAYING);
        }
        
        // If playing, allow forward drift up to elapsed time + 1.5s buffer
        // If not playing, stick to tight tolerance
        let maxAllowedTime = pending.time + 0.35;
        if (isPlaying) {
             maxAllowedTime = pending.time + Math.max(0.35, timeSinceRequest + 1.5);
        }
        
        // If we requested start at 0, we are very lenient about forward progress
        // because "starting at 0" just means "play from start", and if it's at 10s, it played.
        if (pending.time === 0) {
            maxAllowedTime = Math.max(maxAllowedTime, 300); // Allow up to 5 minutes of play if we asked for 0
        }
        
        const minAllowedTime = pending.time - 0.5;

        if (current >= minAllowedTime && current <= maxAllowedTime) {
            this.clearStartCorrection();
            return true;
        }

        if (typeof this.player.seekTo === 'function') {
            try {
                this.player.seekTo(pending.time, true);
            } catch (error) {
                console.warn('[MusicPlayer] Failed to enforce start correction:', error);
            }
        }

        pending.attempts = (pending.attempts || 0) + 1;
        if (pending.attempts >= 5) {
            console.warn('[MusicPlayer] Unable to align track start after multiple attempts');
            this.clearStartCorrection();
        } else {
            this.queueStartCorrectionCheck(200);
        }

        return false;
    }

    clearStartCorrection() {
        this._pendingStartCorrection = null;
        if (this._startCorrectionTimer) {
            clearTimeout(this._startCorrectionTimer);
            this._startCorrectionTimer = null;
        }
    }

    ensurePlaybackSurface() {
        const videoPlayer = this.getPanelPartner('video-player');
        if (!videoPlayer) {
            return true;
        }

        if (!videoPlayer.isDocked) {
            return true;
        }

        // Allow playback in docked mode - don't force expansion
        if (videoPlayer.allowDockedPlayback) {
            return true;
        }

        // Keep player docked, allow playback from dock
        return true;
    }

    // ---- NEW LOGIC START ----
    play(force = false) {
        // Owner-only playback: non-owner workspaces must never start/continue playback locally.
        if (!this.ownsPlayback()) {
            this.muteAudio('non-owner-play-request');
            try {
                if (this.player && typeof this.player.pauseVideo === 'function') {
                    this.player.pauseVideo();
                }
            } catch (err) {
                /* ignore */
            }
            return this.handleRemoteCommand('play', {
                source: 'non-owner-play',
                timestamp: Date.now()
            });
        }

        // Multi-focal architecture: Auto-claim audio if not set when starting playback.
        this.autoClaimAudioIfNeeded();

        this._lastUserPauseTs = 0;

        const storedVid = this.getStoredString('myCurrentVideoID');
        const storedTime = parseFloat(this.getStoredString('myCurrentTime') || '0');
        const storedPlaying = this.getStoredString('myIsPlaying') === '1';
        const lastPlayTs = parseInt(this.getStoredString('myLastPlayTimestamp') || '0', 10);
        const now = Date.now();
        const timeSinceLastPlay = now - lastPlayTs;
        const playlistHasVid = this._playlistData.some((v) => v.vid === storedVid);
        const currentPlayerTime = typeof this.player?.getCurrentTime === 'function' ? this.player.getCurrentTime() : 0;
        const sameVideo = storedVid && this._currentVideoId === storedVid;
        const nearStoredTime = sameVideo && Number.isFinite(currentPlayerTime)
            ? Math.abs(currentPlayerTime - storedTime) <= (force ? 1.5 : 1)
            : false;
        const playerState = typeof this.player?.getPlayerState === 'function' ? this.player.getPlayerState() : null;
        const activelyPlaying = this.isPlayerActivelyPlaying(playerState);
        const needsReload = !storedVid || !sameVideo || !nearStoredTime;

        if (force && !needsReload) {
            if (!activelyPlaying && this.player && typeof this.player.playVideo === 'function') {
                try {
                    const maybePromise = this.player.playVideo();
                    if (maybePromise?.catch) {
                        maybePromise.catch(() => {});
                    }
                } catch (err) {
                    /* ignore autoplay restrictions */
                }
            }
            if (!this.isPlaying) {
                this.isPlaying = true;
                this.updatePlayPauseButton();
            }
            this.persistState('myIsPlaying', '1');
            this.touchPlaybackTimestamp();
            this.publishHeartbeatState({ isPlaying: true }, { reason: 'forced-play-resume' });
            return true;
        }

        if (
            !activelyPlaying ||
            !this.isPlaying ||
            needsReload ||
            force
        ) {
            if (storedVid && playlistHasVid && timeSinceLastPlay <= 600000) {
                this.loadVideo(storedVid, storedTime, true);
                return true;
            } else if (this._playlistData.length && this.isPrimaryWorkspace()) {
                this.loadVideo(this._playlistData[0].vid, 0, true);
                return true;
            }
        } else if (this.player && typeof this.player.playVideo === 'function') {
            try {
                const maybePromise = this.player.playVideo();
                if (maybePromise && typeof maybePromise.then === 'function') {
                    maybePromise.catch(() => {});
                }
            } catch (error) {
                /* ignore gesture restrictions */
            }
            this.isPlaying = true;
            this.updatePlayPauseButton();
            this.persistState('myIsPlaying', '1');
            this.touchPlaybackTimestamp();
            this.publishHeartbeatState({ isPlaying: true }, { reason: 'manual-play' });
            return true;
        } else if (storedVid) {
            this.pendingLoad = { videoId: storedVid, startTime: storedTime, play: true, persist: true };
            this._schedulePendingLoadRetry(400);
        }

        return false;
    }

    updatePlayPauseButton() {
        const playPauseButton = this.shadowRoot.getElementById('play-pause-button');
        if (playPauseButton) {
            playPauseButton.textContent = this.isPlaying ? '⏸' : '▶';
        }
        this.emitDockState({ isPlaying: this.isPlaying });
    }

    togglePlayPause() {
        if (!this.player) return;
        let playerState = null;
        if (typeof YT !== 'undefined' && typeof YT.PlayerState !== 'undefined' && typeof this.player.getPlayerState === 'function') {
            playerState = this.player.getPlayerState();
        }
        const isPlayerPlaying = typeof YT !== 'undefined' && typeof YT.PlayerState !== 'undefined' && playerState === YT.PlayerState.PLAYING;
        const currentlyPlaying = isPlayerPlaying || this.isPlaying;
        const isPrimary = this.isPrimaryWorkspace();

        if (!isPrimary) {
            const command = currentlyPlaying ? 'pause' : 'play';
            this.handleRemoteCommand(command, {
                source: 'toggle-play-pause',
                timestamp: Date.now()
            });
            return;
        }

        // Multi-focal architecture: Auto-claim audio if not set when playing
        if (!currentlyPlaying) {
            this.autoClaimAudioIfNeeded();
        }

        if (currentlyPlaying) {
            this.pause();
        } else {
            // Always force restore and play when pressing Play
            this.play(true);
        }
    }
    // ---- NEW LOGIC END ----

    pause(force = false) {
        if (!this.player) {
            return;
        }

        const ownsPlayback = this.ownsPlayback();
        const shouldPause = force || this.isPlaying || (typeof YT !== 'undefined' && typeof YT.PlayerState !== 'undefined' && typeof this.player.getPlayerState === 'function' && this.player.getPlayerState() === YT.PlayerState.PLAYING);
        if (!shouldPause) {
            if (ownsPlayback) {
                this.persistState('myIsPlaying', '0');
                this.touchPlaybackTimestamp();
            }
            return;
        }

        if (!force) {
            this._lastUserPauseTs = Date.now();
        }

        try {
            if (typeof this.player.pauseVideo === 'function') {
                this.player.pauseVideo();
            }
        } catch (error) {
            /* ignore pause errors */
        }

        this.isPlaying = false;
        this.updatePlayPauseButton();
        if (ownsPlayback) {
            this.persistState('myIsPlaying', '0');
            this.touchPlaybackTimestamp();
        }
        if (typeof this.player.getCurrentTime === 'function') {
            const currentTime = this.player.getCurrentTime();
            const sanitizedTime = this.sanitizeTime(currentTime, this.duration || null);
            this._lastPersistedTime = sanitizedTime;
            if (ownsPlayback) {
                this.persistState('myCurrentTime', sanitizedTime.toString());
                this.broadcastPlaylistProgress(sanitizedTime);
                this.publishHeartbeatState({
                    isPlaying: false,
                    currentTime: sanitizedTime
                }, { reason: 'manual-pause' });
            }
        }

        this.suppressAutoResume(750);
    }

    shufflePlaylist() {
        // Toggle shuffle mode - sync to shared state
        const sharedState = window.sharedStateManager;
        const newShuffleState = !this.shuffleEnabled;
        this.shuffleEnabled = newShuffleState;
        
        const randomCheckbox = this.shadowRoot.getElementById('random-checkbox');
        if (randomCheckbox) {
            randomCheckbox.checked = this.shuffleEnabled;
        }
        
        if (sharedState) {
            const updates = { shuffleEnabled: newShuffleState, timestamp: Date.now() };
            
            if (newShuffleState && !this.shuffleHistory.length && this._currentVideoId) {
                updates.shuffleHistory = [this._currentVideoId];
            } else if (!newShuffleState) {
                updates.shuffleHistory = [];
                updates.backHistoryIndex = -1;
            }
            
            sharedState.setState(updates, 'shuffle-toggle');
        } else {
            // Fallback to legacy persistence
            this.persistState('myShuffleEnabled', this.shuffleEnabled.toString());
            
            if (this.shuffleEnabled && !this.shuffleHistory.length && this._currentVideoId) {
                this.shuffleHistory = [this._currentVideoId];
            } else if (!this.shuffleEnabled) {
                this.shuffleHistory = [];
                this.backHistoryIndex = -1;
            }
            
            this.persistState('myShuffleHistory', JSON.stringify(this.shuffleHistory));
            this.persistState('myBackHistoryIndex', this.backHistoryIndex.toString());
        }
        this.touchPlaybackTimestamp();
        this.publishHeartbeatState({ shuffleEnabled: this.shuffleEnabled }, { reason: 'shuffle-toggle' });
        
        // Dispatch event so playlist-viewer can update button state
        this.dispatchEvent(new CustomEvent('shuffle-changed', { 
            detail: { shuffleEnabled: this.shuffleEnabled } 
        }));
        
        return this.shuffleEnabled;
    }

    initializeControls() {
        if (this.player && typeof this.player.setVolume === 'function') {
            this.player.setVolume(parseInt(this.getStoredString('myVolume') || '50', 10));
            this.dispatchEvent(new CustomEvent('player-ready'));

            if (!this.timeUpdateInterval) {
                this.timeUpdateInterval = setInterval(() => this.updateTimeSlider(), 500);
            }
            this.setupUserInteractionHandlers();
            this.applyPendingLoad();
        } else {
            console.warn('[MusicPlayer] Player not ready or setVolume not available');
        }
    }

    setupUserInteractionHandlers() {
        const resumePlayback = () => {
            const now = Date.now();
            if (this._autoResumeSuppressedUntil && now < this._autoResumeSuppressedUntil) {
                return;
            }

            const storedPlaying = this.getStoredString('myIsPlaying') === '1';
            const lastPlayTs = parseInt(this.getStoredString('myLastPlayTimestamp') || '0', 10);
            const timeSinceLastPlay = now - lastPlayTs;

            if (storedPlaying && timeSinceLastPlay <= 600000 && !this.isPlaying) {
                this._autoResumeSuppressedUntil = 0;
                this.markUserInteraction('resume-playback');
                this.play(true);
            }
        };

        document.addEventListener('click', resumePlayback);
        document.addEventListener('keydown', resumePlayback);
        document.addEventListener('touchstart', resumePlayback);
    }

    suppressAutoResume(durationMs = 1000) {
        const numeric = Number(durationMs);
        if (!Number.isFinite(numeric) || numeric <= 0) {
            this._autoResumeSuppressedUntil = 0;
            return;
        }
        this._autoResumeSuppressedUntil = Date.now() + numeric;
    }

    onPlayerStateChange(event) {
        if (event.data === YT.PlayerState.PLAYING) {
            // Clear timeout watchdog - video is playing successfully
            if (this._loadTimeoutHandle) {
                clearTimeout(this._loadTimeoutHandle);
                this._loadTimeoutHandle = null;
            }
            // Clear video change flag - new video is now playing
            this._changingVideo = false;
            this.pendingVideoMeta = null;
            
            this.enforceStartCorrection();
            
            this.isPlaying = true;
            this.updatePlayPauseButton();
            const duration = this.player.getDuration();
            if (duration > 0 && this.duration !== duration) {
                this.duration = duration;
                const timeSlider = this.shadowRoot.getElementById('time-slider');
                if (timeSlider) {
                    timeSlider.max = Math.floor(this.duration);
                }
            }
            this.persistState('myIsPlaying', '1');
            this.touchPlaybackTimestamp();
            this.publishHeartbeatState({ isPlaying: true }, { reason: 'playback-start' });
        } else if (event.data === YT.PlayerState.BUFFERING) {
            // Also clear timeout on buffering - video is loading
            if (this._loadTimeoutHandle) {
                clearTimeout(this._loadTimeoutHandle);
                this._loadTimeoutHandle = null;
            }
            this.enforceStartCorrection();
        } else if (event.data === YT.PlayerState.PAUSED) {
            this.isPlaying = false;
            this.pendingVideoMeta = null;
            this.updatePlayPauseButton();
            this.persistState('myIsPlaying', '0');
            this.touchPlaybackTimestamp();
            this.publishHeartbeatState({ isPlaying: false }, { reason: 'playback-pause' });
        } else if (event.data === YT.PlayerState.ENDED) {
            // Clear load guard so the next track isn't blocked as "redundant"
            this._lastLoadMeta = null;
            this.clearStartCorrection();
            this.pendingVideoMeta = null;
            this.playNext();
        }
    }

    onPlayerError(detail) {
        // YouTube error handler - skip unplayable videos immediately
        console.warn('[MusicPlayer] Player error detected, skipping track:', detail);
        this.clearStartCorrection();
        this.pendingVideoMeta = null;
        this._changingVideo = false;
        
        // Clear any pending timeout
        if (this._loadTimeoutHandle) {
            clearTimeout(this._loadTimeoutHandle);
            this._loadTimeoutHandle = null;
        }
        
        // Mark current video as failed
        if (this._currentVideoId) {
            this._failedVideoIds.add(this._currentVideoId);
            // Clear failed IDs after 5 minutes to allow retry later
            setTimeout(() => this._failedVideoIds.delete(this._currentVideoId), 300000);
        }
        
        // Clear retry counters and skip to next
        this._pendingLoadRetryCount = 0;
        this._lastLoadMeta = null;
        this.playNext();
    }

    playNext() {
        // Multi-focal architecture: Any tab can skip to next
        // Auto-claim audio if not set
        this.autoClaimAudioIfNeeded();
        
        // Use shared queue as source of truth
        const sharedState = window.sharedStateManager;
        if (!sharedState) {
            console.warn('[MusicPlayer] SharedStateManager not available');
            return;
        }

        const playlistQueue = sharedState.get('playlistQueue') || [];
        if (!playlistQueue.length) {
            console.warn('[MusicPlayer] Queue is empty');
            return;
        }

        const playlistViewer = this.getPanelPartner('playlist-viewer');
        const currentPlaylist = playlistViewer?.getCurrentPlaylist() || playlistQueue;
        let nextVid;
        const shuffleRaw = sharedState.get('shuffleEnabled');
        const shuffleEnabled = shuffleRaw === true || shuffleRaw === 'true';
        
        if (shuffleEnabled) {
            const shuffleHistory = sharedState.get('shuffleHistory') || [];
            // Filter out failed videos from selection pool
            const unplayed = currentPlaylist.filter((v) => 
                !shuffleHistory.includes(v.vid) && !this._failedVideoIds.has(v.vid)
            );
            
            if (unplayed.length) {
                nextVid = unplayed[Math.floor(Math.random() * unplayed.length)].vid;
            } else {
                // All videos played or failed - try random from non-failed only
                const nonFailed = currentPlaylist.filter((v) => !this._failedVideoIds.has(v.vid));
                if (nonFailed.length) {
                    nextVid = nonFailed[Math.floor(Math.random() * nonFailed.length)].vid;
                } else {
                    // All videos failed - pick any
                    nextVid = currentPlaylist[Math.floor(Math.random() * currentPlaylist.length)].vid;
                }
            }

            const newHistory = [...shuffleHistory];
            if (newHistory[newHistory.length - 1] !== this._currentVideoId) {
                newHistory.push(this._currentVideoId);
            }
            newHistory.push(nextVid);
            
            sharedState.setState({
                shuffleHistory: newHistory,
                backHistoryIndex: -1,
                timestamp: Date.now()
            }, 'playNext');
        } else {
            // Sequential mode - skip failed videos
            let nextIdx = this.getSequentialQueueIndex(sharedState, playlistQueue, 1);
            let attempts = 0;
            const maxAttempts = playlistQueue.length;
            
            // Try to find next non-failed video
            while (nextIdx !== -1 && attempts < maxAttempts) {
                const candidate = playlistQueue[nextIdx];
                if (candidate && !this._failedVideoIds.has(candidate.vid)) {
                    break;
                }
                // This video failed, try next one
                nextIdx = (nextIdx + 1) % playlistQueue.length;
                attempts++;
            }
            
            if (nextIdx === -1 || !playlistQueue[nextIdx]) {
                console.warn('[MusicPlayer] Unable to resolve next sequential track');
                return;
            }
            nextVid = playlistQueue[nextIdx].vid;
            sharedState.setCurrentIndex(nextIdx, 'playNext');
        }
        
        this.loadVideo(nextVid, 0, true);
    }

    playPrevious() {
        // Multi-focal architecture: Any tab can go to previous
        // Auto-claim audio if not set
        this.autoClaimAudioIfNeeded();
        
        // Use shared queue as source of truth
        const sharedState = window.sharedStateManager;
        if (!sharedState) {
            console.warn('[MusicPlayer] SharedStateManager not available');
            return;
        }

        const playlistQueue = sharedState.get('playlistQueue') || [];
        if (!playlistQueue.length) {
            console.warn('[MusicPlayer] Queue is empty');
            return;
        }

        // Get the current playlist (filtered if searching, otherwise full queue)
        const playlistViewer = this.getPanelPartner('playlist-viewer');
        const currentPlaylist = playlistViewer?.getCurrentPlaylist() || playlistQueue;
        
        let prevVid;
        const shuffleRaw = sharedState.get('shuffleEnabled');
        const shuffleEnabled = shuffleRaw === true || shuffleRaw === 'true';
        let shuffleHistory = sharedState.get('shuffleHistory') || [];
        let backHistoryIndex = sharedState.get('backHistoryIndex') ?? -1;
        
        if (shuffleEnabled) {
            if (backHistoryIndex < 0) {
                if (
                    !shuffleHistory.length ||
                    shuffleHistory[shuffleHistory.length - 1] !== this._currentVideoId
                ) {
                    shuffleHistory = [...shuffleHistory, this._currentVideoId];
                }
                backHistoryIndex = shuffleHistory.length - 1;
            } else if (backHistoryIndex > 0) {
                backHistoryIndex--;
            }
            prevVid = shuffleHistory[backHistoryIndex];
            if (!currentPlaylist.some(v => v.vid === prevVid)) {
                prevVid = currentPlaylist[0].vid;
            }
            
            sharedState.setState({
                shuffleHistory,
                backHistoryIndex,
                timestamp: Date.now()
            }, 'playPrevious');
        } else {
            const prevIdx = this.getSequentialQueueIndex(sharedState, playlistQueue, -1);
            if (prevIdx === -1 || !playlistQueue[prevIdx]) {
                console.warn('[MusicPlayer] Unable to resolve previous sequential track');
                return;
            }
            prevVid = playlistQueue[prevIdx].vid;
            sharedState.setCurrentIndex(prevIdx, 'playPrevious');
        }
        
        this.loadVideo(prevVid, 0, true);
    }

    getSequentialQueueIndex(sharedState, playlistQueue, direction = 1) {
        if (!Array.isArray(playlistQueue) || !playlistQueue.length) {
            return -1;
        }

        const normalizedDirection = direction >= 0 ? 1 : -1;
        const queueLength = playlistQueue.length;
        const sharedIndexRaw = sharedState && typeof sharedState.get === 'function'
            ? sharedState.get('currentQueueIndex')
            : null;

        let baseIndex = null;
        if (typeof sharedIndexRaw === 'number' && Number.isFinite(sharedIndexRaw)) {
            baseIndex = sharedIndexRaw;
        } else if (typeof sharedIndexRaw === 'string') {
            const parsed = parseInt(sharedIndexRaw, 10);
            if (Number.isFinite(parsed)) {
                baseIndex = parsed;
            }
        }

        if (baseIndex === null || baseIndex < 0 || baseIndex >= queueLength) {
            if (this._currentVideoId) {
                const matchIdx = playlistQueue.findIndex((item) => item?.vid === this._currentVideoId);
                if (matchIdx >= 0) {
                    baseIndex = matchIdx;
                }
            }
        }

        if (baseIndex === null || baseIndex < 0 || baseIndex >= queueLength) {
            baseIndex = normalizedDirection > 0 ? -1 : 0;
        }

        return (baseIndex + normalizedDirection + queueLength) % queueLength;
    }

    updateTimeSlider() {
        if (!this.player || typeof this.player.getCurrentTime !== 'function') return;
        const ctime = this.player.getCurrentTime();
        if (ctime === undefined) return;

        const now = Date.now();

        // Don't run heartbeat if we haven't loaded a video yet
        if (!this._currentVideoId) {
            return;
        }

        if (this.isPlaying && this.duration === 0) {
            const duration = this.player.getDuration();
            if (duration > 0) {
                this.duration = duration;
            }
        }

        const ownsPlayback = this.ownsPlayback();
        const activeVideoId = this.getPlayerVideoId();
        // Allow null activeVideoId during buffering, but prevent persisting wrong video's time
        const isVideoAligned = !activeVideoId || activeVideoId === this._currentVideoId;

        if (!isVideoAligned) {
            console.warn('[MusicPlayer] Video misalignment detected:', { activeVideoId, currentVideoId: this._currentVideoId });
            return;
        }

        const lastPersisted = this._lastPersistedTime;
        const shouldPersistTime = lastPersisted === null || Math.abs(ctime - lastPersisted) >= 1;

        // Only persist if we're not in the middle of changing videos AND we own playback
        const shouldPersist = ownsPlayback && shouldPersistTime && !this._changingVideo;

        if (shouldPersist) {
            this.persistState('myCurrentTime', ctime.toString());
            this._lastPersistedTime = ctime;
            this.touchPlaybackTimestamp();
        }

        // Multi-focal: Update shared state for all tabs/workspaces to sync.
        // Throttle to avoid hammering localStorage/BroadcastChannel.
        if (ownsPlayback && window.sharedStateManager && !this._changingVideo) {
            const lastSharedAt = Number.isFinite(this._lastSharedTimePublishAt) ? this._lastSharedTimePublishAt : 0;
            if (now - lastSharedAt >= 500) {
                this._lastSharedTimePublishAt = now;
                window.sharedStateManager.setState({
                    currentTime: ctime,
                    duration: this.duration,
                    currentVideoId: this._currentVideoId,
                    isPlaying: this.isPlaying,
                    timestamp: now
                }, 'time-update');
            }
        }

        // Dispatch event for playlist viewer to update progress and time slider
        if (ownsPlayback) {
            this.broadcastPlaylistProgress(ctime);
        }
        this.emitDockState({ currentTime: ctime, duration: this.duration });

        // Check if playback is stalling
        if (ownsPlayback && this.isPlaying && this.duration > 0) {
            if (Math.abs(ctime - (this.lastPlaybackTime || 0)) < 0.2) {
                this.stallCounter++;
            } else {
                this.stallCounter = 0;
                this.lastPlaybackTime = ctime;
            }
            if (this.stallCounter >= 10) {
                console.warn("Playback stalled, skipping...");
                this.stallCounter = 0;
                this.playNext();
            }
        }
    }

    formatTime(sec) {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${s < 10 ? '0' + s : s}`;
    }

    updateTrackInfo() {
        const data = this._playlistData.find((v) => v.vid === this._currentVideoId) || {};
        const channelTitle = data.channelTitle || 'Unknown Channel';
        const title = data.title || this._currentVideoId || 'Unknown Track';
        const channelUrl = data.channelId ? `https://www.youtube.com/channel/${data.channelId}` : '#';
        const trackUrl = this._currentVideoId ? `https://www.youtube.com/watch?v=${this._currentVideoId}` : '#';

        this._currentTrackMeta = {
            vid: this._currentVideoId,
            title,
            channelTitle,
            channelId: data.channelId || null,
            duration: data.duration || null
        };

        // Create cleaner display with title and artist separated
        const html = `
            <a href="${trackUrl}" target="_blank" rel="noopener" title="${title}">${title}</a>
            <span style="color: rgba(255, 255, 255, 0.5); margin: 0 8px;">•</span>
            <a href="${channelUrl}" target="_blank" rel="noopener" title="${channelTitle}">${channelTitle}</a>
        `;
        
        const marqueeContainer = this.shadowRoot.getElementById('marquee-container');
        const marqueeContent = marqueeContainer?.querySelector('.marquee-content');
        const channelAndTrackEl = this.shadowRoot.getElementById('channel-and-track');
        
        if (channelAndTrackEl) {
            channelAndTrackEl.innerHTML = html;
        }

        // Reset and check if marquee is needed
        if (marqueeContent && marqueeContainer) {
            marqueeContent.style.animation = 'none';
            marqueeContent.offsetHeight; // force reflow
            
            // Check if content overflows
            setTimeout(() => {
                if (marqueeContent.scrollWidth > marqueeContainer.clientWidth) {
                    // Duplicate content for seamless loop
                    channelAndTrackEl.innerHTML = html + html;
                    marqueeContent.style.animation = 'scrolling 20s linear infinite';
                }
            }, 50);
        }

        this.emitDockState();
    }

    getCurrentTrackMeta() {
        return this._currentTrackMeta;
    }

    getCurrentTrackIndex() {
        const playlist = this.playlistData || [];
        if (!Array.isArray(playlist) || !playlist.length || !this._currentVideoId) {
            return -1;
        }
        return playlist.findIndex((item) => item?.vid === this._currentVideoId);
    }

    getTrackDuration(videoId) {
        if (!videoId) {
            return 0;
        }
        const data = this._playlistData.find((v) => v.vid === videoId);
        if (data && Number.isFinite(data.duration) && data.duration > 0) {
            return data.duration;
        }
        if (this._currentTrackMeta && this._currentTrackMeta.vid === videoId) {
            const metaDuration = this._currentTrackMeta.duration;
            if (Number.isFinite(metaDuration) && metaDuration > 0) {
                return metaDuration;
            }
        }
        return 0;
    }

    getPlayerVideoId() {
        if (!this.player || typeof this.player.getVideoData !== 'function') {
            return null;
        }
        try {
            const data = this.player.getVideoData();
            if (data && typeof data.video_id === 'string' && data.video_id.length) {
                return data.video_id;
            }
        } catch (error) {
            console.warn('[MusicPlayer] Failed to read player video id:', error);
        }
        return null;
    }

    broadcastPlaylistProgress(currentTime, durationOverride = null, options = {}) {
        const {
            allowBroadcast = true,
            videoId: videoIdOverride,
            timestamp: explicitTimestamp,
            playbackTimestamp: explicitPlaybackTimestamp
        } = options || {};
        const durationFromState = Number.isFinite(this.duration) && this.duration > 0 ? this.duration : null;
        const fallbackDuration = this.getTrackDuration(this._currentVideoId);
        const resolvedDuration =
            Number.isFinite(durationOverride) && durationOverride > 0
                ? durationOverride
                : (durationFromState ?? (Number.isFinite(fallbackDuration) && fallbackDuration > 0 ? fallbackDuration : 0));
        const videoId = videoIdOverride || this._currentVideoId;
        const timestamp = Number.isFinite(explicitTimestamp) ? explicitTimestamp : Date.now();
        let playbackTimestamp = Number.isFinite(explicitPlaybackTimestamp) ? explicitPlaybackTimestamp : 0;
        if (!playbackTimestamp) {
            const playbackTsRaw = this.getStoredString('myLastPlayTimestamp');
            const parsedPlaybackTs = parseInt(playbackTsRaw || '0', 10);
            if (Number.isFinite(parsedPlaybackTs) && parsedPlaybackTs > 0) {
                playbackTimestamp = parsedPlaybackTs;
            } else {
                playbackTimestamp = timestamp;
            }
        }
        document.dispatchEvent(new CustomEvent('playlist-time-update', {
            detail: {
                currentTime: Number.isFinite(currentTime) ? currentTime : 0,
                duration: Number.isFinite(resolvedDuration) ? resolvedDuration : 0,
                videoId,
                timestamp,
                playbackTimestamp
            }
        }));

        if (!allowBroadcast) {
            return;
        }

        if (!this.ownsPlayback()) {
            return;
        }

        const channel = window?.musicChannel;
        if (!channel || !window?.myTabId) {
            return;
        }

        try {
            channel.postMessage({
                action: 'progress_update',
                tabId: window.myTabId,
                videoId,
                currentTime: Number.isFinite(currentTime) ? currentTime : 0,
                duration: Number.isFinite(resolvedDuration) ? resolvedDuration : 0,
                isPlaying: !!this.isPlaying,
                trackTitle: this._currentTrackMeta?.title || null,
                channelTitle: this._currentTrackMeta?.channelTitle || null,
                timestamp,
                playbackTimestamp
            });
        } catch (error) {
            /* ignore broadcast errors */
        }

        this.publishHeartbeatState({
            videoId,
            currentTime: Number.isFinite(currentTime) ? currentTime : 0,
            duration: Number.isFinite(resolvedDuration) ? resolvedDuration : 0
        }, { reason: 'playback-progress' });
        
        // Also update shared state manager for cross-tab sync
        if (window.sharedStateManager && this.ownsPlayback()) {
            window.sharedStateManager.setState({
                currentVideoId: videoId,
                currentTime: Number.isFinite(currentTime) ? currentTime : 0,
                duration: Number.isFinite(resolvedDuration) ? resolvedDuration : 0,
                isPlaying: !!this.isPlaying
            }, 'progress-update');
        }
    }

    isPrimaryWorkspace() {
        const workspaceId = window.__panelTaskbar?.workspaceId || null;
        const sharedState = window.sharedStateManager;

        if (sharedState && workspaceId) {
            const audioWorkspaceId = sharedState.get('audioWorkspaceId');
            if (audioWorkspaceId) {
                if (audioWorkspaceId === workspaceId) {
                    return true;
                }

                const workspaces = sharedState.get('workspaces') || [];
                const audioWorkspaceEntry = workspaces.find((w) => w?.id === audioWorkspaceId);
                if (!audioWorkspaceEntry) {
                    console.warn('[MusicPlayer] Audio workspace pointer references missing workspace, treating audio as unclaimed');
                    this.maybeClearStaleAudioPointer('missing-audio-workspace');
                    return true;
                }

                if (this.isWorkspaceEntryStale(audioWorkspaceEntry)) {
                    console.warn('[MusicPlayer] Audio workspace heartbeat stale, treating audio as unclaimed');
                    this.requestWorkspaceCleanup('music-player-audio-heartbeat-stale');
                    this.maybeClearStaleAudioPointer('stale-audio-workspace');
                    return true;
                }

                return false;
            }
        }

        const heartbeatAudioWorkspace = window.taskbarHeartbeat?.get?.('audioWorkspaceId');
        if (workspaceId && heartbeatAudioWorkspace) {
            return workspaceId === heartbeatAudioWorkspace;
        }

        if (!sharedState || !workspaceId) {
            const storedOwner = localStorage.getItem('musicPlayerCurrentOwner');
            if (!storedOwner) {
                return true;
            }
            return storedOwner === window.myTabId;
        }

        return true;
    }

    enforceAudioState(state = null) {
        const sharedState = state || window.sharedStateManager?.getState();
        const workspaceId = window.__panelTaskbar?.workspaceId;

        // If shared workspace state isn't ready yet, fall back to local ownership rules
        // instead of hard-muting the entire page (which can leave the UI “stuck muted”).
        if (!workspaceId || !sharedState) {
            const shouldUnmute = this.isPrimaryWorkspace();
            if (shouldUnmute) {
                if (this.player && typeof this.player.unMute === 'function') {
                    this.player.unMute();
                }
                this._pendingMuteState = 'unmute';
                this.updateWindowMuteState(false, 'no-shared-state-primary');
            } else {
                if (this.player && typeof this.player.mute === 'function') {
                    this.player.mute();
                }
                this._pendingMuteState = 'mute';
                this.updateWindowMuteState(true, 'no-shared-state');
            }
            return;
        }

        const audioWorkspaceId = sharedState?.audioWorkspaceId;
        const shouldUnmute = !audioWorkspaceId || audioWorkspaceId === workspaceId;

        if (!this.player) {
            this._pendingMuteState = shouldUnmute ? 'unmute' : 'mute';
            this.updateWindowMuteState(!shouldUnmute, 'pending-player');
            return;
        }

        if (shouldUnmute) {
            if (typeof this.player.unMute === 'function') {
                this.player.unMute();
            }
            this._pendingMuteState = 'unmute';
            this.updateWindowMuteState(false, 'audio-workspace');
        } else {
            if (typeof this.player.mute === 'function') {
                this.player.mute();
            }
            // Safety: if this workspace is not the audio owner, ensure the player cannot keep playing.
            try {
                if (typeof this.player.pauseVideo === 'function') {
                    this.player.pauseVideo();
                }
            } catch (err) {
                /* ignore */
            }
            this._pendingMuteState = 'mute';
            this.updateWindowMuteState(true, 'not-audio-workspace');
        }
    }

    updateWindowMuteState(shouldMute, reason = 'unspecified') {
        if (typeof window === 'undefined') {
            return;
        }
        const targetState = !!shouldMute;
        if (this._windowMuted === targetState) {
            return;
        }
        this._windowMuted = targetState;

        if (typeof document !== 'undefined') {
            const root = document.documentElement || document.body;
            if (root && root.classList) {
                root.classList.toggle('workspace-muted', targetState);
            }

            if (targetState) {
                try {
                    const mediaNodes = document.querySelectorAll('audio, video');
                    mediaNodes.forEach((node) => {
                        try {
                            // Preserve previous volume so we can restore when unmuting.
                            if (typeof node.volume === 'number' && !node.dataset.xaviPrevVolume) {
                                node.dataset.xaviPrevVolume = String(node.volume);
                            }
                            node.muted = true;
                            if (typeof node.volume === 'number') {
                                node.volume = 0;
                            }
                        } catch (err) {
                            /* ignore media mute errors */
                        }
                    });
                } catch (err) {
                    /* ignore document query issues */
                }
            } else {
                // When leaving muted state, undo any force-muting applied above.
                try {
                    const mediaNodes = document.querySelectorAll('audio, video');
                    mediaNodes.forEach((node) => {
                        try {
                            node.muted = false;
                            if (typeof node.volume === 'number') {
                                const prev = node.dataset.xaviPrevVolume;
                                if (prev != null) {
                                    const restored = Number(prev);
                                    if (Number.isFinite(restored)) {
                                        node.volume = Math.max(0, Math.min(1, restored));
                                    }
                                    delete node.dataset.xaviPrevVolume;
                                } else if (node.volume === 0) {
                                    // If we forced volume to 0 earlier, restore to a sane default.
                                    node.volume = 1;
                                }
                            }
                        } catch (err) {
                            /* ignore media unmute errors */
                        }
                    });
                } catch (err) {
                    /* ignore document query issues */
                }
            }
        }

        try {
            window.dispatchEvent(new CustomEvent('workspace-audio-state', {
                detail: {
                    muted: targetState,
                    reason
                }
            }));
        } catch (err) {
            /* ignore dispatch errors */
        }
    }

    startPlaybackIntegrityWatcher() {
        if (this.playbackIntegrityInterval) {
            return;
        }
        this.playbackIntegrityInterval = setInterval(() => this.verifyPlaybackIntegrity(), 1000);
    }

    stopPlaybackIntegrityWatcher() {
        if (this.playbackIntegrityInterval) {
            clearInterval(this.playbackIntegrityInterval);
            this.playbackIntegrityInterval = null;
        }
    }

    updatePlaybackIntentHeartbeat(shouldBePlaying) {
        const workspaceId = window.__panelTaskbar?.workspaceId;
        if (!workspaceId) {
            return;
        }
        const payload = {
            workspaceId,
            isPrimary: this.isPrimaryWorkspace(),
            shouldBePlaying: !!shouldBePlaying,
            actualPlayerState: typeof this.player?.getPlayerState === 'function' ? this.player.getPlayerState() : null,
            videoId: this._currentVideoId,
            timestamp: Date.now()
        };
        try {
            localStorage.setItem('pgmusic.playbackIntent', JSON.stringify(payload));
        } catch (err) {
            console.warn('[MusicPlayer] Failed to persist playback intent heartbeat', err);
        }
    }

    isPlayerActivelyPlaying(playerState) {
        if (typeof YT === 'undefined' || !YT.PlayerState) {
            return this.isPlaying;
        }
        return playerState === YT.PlayerState.PLAYING || playerState === YT.PlayerState.BUFFERING;
    }

    verifyPlaybackIntegrity() {
        if (!this.player || !this._playerReady) {
            return;
        }

        const sharedState = window.sharedStateManager?.getState();
        const workspaceId = window.__panelTaskbar?.workspaceId;
        if (!sharedState || !workspaceId) {
            return;
        }

        const audioWorkspaceId = sharedState.audioWorkspaceId;
        const isPrimary = !audioWorkspaceId || audioWorkspaceId === workspaceId;
        const sharedStateWantsPlay = !!sharedState.isPlaying;
        const localPlayIntent = this.isPlaying || !!this.pendingVideoMeta?.play;
        const shouldBePlaying = isPrimary && (sharedStateWantsPlay || localPlayIntent);

        this.updatePlaybackIntentHeartbeat(shouldBePlaying);

        if (!shouldBePlaying || this._changingVideo) {
            return;
        }

        const playerState = typeof this.player.getPlayerState === 'function'
            ? this.player.getPlayerState()
            : null;
        if (this.isPlayerActivelyPlaying(playerState)) {
            return;
        }

        const recentUserPause = this._lastUserPauseTs && (Date.now() - this._lastUserPauseTs) < 2000;
        if (recentUserPause) {
            return;
        }

        const now = Date.now();
        if (this._lastIntegrityAutoResumeTs && (now - this._lastIntegrityAutoResumeTs) < 3000) {
            return;
        }
        this._lastIntegrityAutoResumeTs = now;

        const markPausedState = (reason) => {
            if (this.isPlaying) {
                this.isPlaying = false;
                this.updatePlayPauseButton();
            }
            this.persistState('myIsPlaying', '0');
            if (window.sharedStateManager) {
                window.sharedStateManager.setState({
                    isPlaying: false,
                    timestamp: Date.now()
                }, reason);
            }
            this.publishHeartbeatState({ isPlaying: false }, { reason });
        };

        console.log('[MusicPlayer] Primary workspace paused unexpectedly. Auto-resuming playback (no reload).');

        if (this.player && typeof this.player.playVideo === 'function') {
            try {
                const maybePromise = this.player.playVideo();

                if (maybePromise && typeof maybePromise.then === 'function') {
                    maybePromise.catch((err) => {
                        console.warn('[MusicPlayer] Auto-resume playVideo() was blocked by the browser, marking as paused:', err);
                        markPausedState('auto-resume-blocked');
                    });
                }

                if (!this.isPlaying) {
                    this.isPlaying = true;
                    this.updatePlayPauseButton();
                }

                this.persistState('myIsPlaying', '1');
                this.touchPlaybackTimestamp();

                if (window.sharedStateManager) {
                    window.sharedStateManager.setState({
                        isPlaying: true,
                        timestamp: Date.now()
                    }, 'auto-resume-success');
                }

                this.publishHeartbeatState({ isPlaying: true }, { reason: 'auto-resume-success' });
                return;
            } catch (err) {
                console.warn('[MusicPlayer] Auto-resume playVideo threw synchronously, marking as paused:', err);
                markPausedState('auto-resume-error');
                return;
            }
        }

        markPausedState('auto-resume-unavailable');
    }

    ownsPlayback() {
        return this.isPrimaryWorkspace();
    }

    claimAudioOutput() {
        // Last-interaction-wins: This tab gets audio, others mute
        const claimTimestamp = Date.now();
        const workspaceId = window.__panelTaskbar?.workspaceId;
        
        localStorage.setItem('musicAudioOwner', window.myTabId);
        localStorage.setItem('musicAudioOwnerTimestamp', claimTimestamp.toString());
        localStorage.setItem('musicPlayerCurrentOwner', window.myTabId);
        window.currentPlayerTabId = window.myTabId;
        
        // Update workspace as audio workspace
        if (workspaceId && window.sharedStateManager) {
            window.sharedStateManager.setAudioWorkspace(workspaceId);
            window.sharedStateManager.updateWorkspaceActivity(workspaceId);
        }
        
        // Unmute this tab
        if (this.player && typeof this.player.unMute === 'function') {
            this.player.unMute();
        }
        this._pendingMuteState = 'unmute';
        this.updateWindowMuteState(false, 'claim-audio');
        
        // Broadcast to other tabs to mute themselves
        if (window.musicChannel) {
            window.musicChannel.postMessage({
                action: 'claim_audio',
                tabId: window.myTabId,
                workspaceId: workspaceId,
                timestamp: claimTimestamp
            });
        }
    }

    muteAudio(reason = 'forced-mute') {
        // Another tab claimed audio - mute this one
        if (this.player && typeof this.player.mute === 'function') {
            this.player.mute();
        }
        this._pendingMuteState = 'mute';
        this.updateWindowMuteState(true, reason);
    }

    autoClaimAudioIfNeeded() {
        // NEVER auto-claim if another workspace already has audio
        // This prevents new tabs from disrupting existing playback
        if (!window.sharedStateManager) return false;

        const sharedState = window.sharedStateManager;
        const audioWorkspaceId = sharedState.get('audioWorkspaceId');
        const workspaceId = window.__panelTaskbar?.workspaceId;
        const workspaces = sharedState.get('workspaces') || [];
        const audioWorkspaceEntry = audioWorkspaceId
            ? workspaces.find((w) => w?.id === audioWorkspaceId)
            : null;
        const audioWorkspaceStale = audioWorkspaceEntry
            ? (audioWorkspaceId !== workspaceId && this.isWorkspaceEntryStale(audioWorkspaceEntry))
            : false;

        if (audioWorkspaceId && !audioWorkspaceEntry && workspaceId) {
            console.warn('[MusicPlayer] Audio workspace pointer references missing workspace, reclaiming for this workspace');
            this.maybeClearStaleAudioPointer('missing-audio-workspace');
            this.claimAudioOutput();
            return true;
        }

        if (audioWorkspaceId && audioWorkspaceEntry && audioWorkspaceStale && workspaceId) {
            console.warn('[MusicPlayer] Audio workspace heartbeat stale, reclaiming for this workspace');
            this.requestWorkspaceCleanup('music-player-stale-audio');
            this.maybeClearStaleAudioPointer('stale-audio-workspace');
            this.claimAudioOutput();
            return true;
        }

        // If no audio workspace set, claim it for this workspace
        if (!audioWorkspaceId && workspaceId) {
            console.log('[MusicPlayer] No audio workspace set, auto-claiming for this workspace');
            this.claimAudioOutput();
            return true;
        }

        // If this workspace already has audio, ensure unmuted
        if (audioWorkspaceId === workspaceId) {
            if (this.player && typeof this.player.unMute === 'function') {
                this.player.unMute();
            }
            this._pendingMuteState = 'unmute';
            this.updateWindowMuteState(false, 'already-audio-workspace');
            return true;
        }

        // Another workspace has audio - stay muted and do NOT claim
        console.log('[MusicPlayer] Another workspace has audio, staying muted');
        this.updateWindowMuteState(true, 'other-workspace-audio');
        return false;
    }

    isWorkspaceEntryStale(entry) {
        if (!entry) {
            return true;
        }
        const lastHeartbeat = Number(entry.lastHeartbeat || entry.timestamp || 0);
        if (!Number.isFinite(lastHeartbeat) || lastHeartbeat <= 0) {
            return true;
        }
        return (Date.now() - lastHeartbeat) > AUDIO_WORKSPACE_STALE_MS;
    }

    maybeClearStaleAudioPointer(reason = 'stale-audio-workspace') {
        const sharedState = window.sharedStateManager;
        if (!sharedState || typeof sharedState.setState !== 'function') {
            return;
        }
        const now = Date.now();
        if (this._lastAudioPointerClearTs && now - this._lastAudioPointerClearTs < 2000) {
            return;
        }
        this._lastAudioPointerClearTs = now;
        sharedState.setState({ audioWorkspaceId: null }, reason);
    }

    requestWorkspaceCleanup(reason = 'music-player-stale-audio') {
        const sharedState = window.sharedStateManager;
        if (!sharedState || typeof sharedState.cleanupDeadWorkspaces !== 'function') {
            return;
        }
        const now = Date.now();
        if (this._lastWorkspaceCleanupTs && now - this._lastWorkspaceCleanupTs < 2000) {
            return;
        }
        this._lastWorkspaceCleanupTs = now;
        sharedState.cleanupDeadWorkspaces(reason);
    }

    delegateCommand(command, payload = {}) {
        const channel = window?.musicChannel;
        const owner = window?.currentPlayerTabId;
        if (!channel || !owner || owner === window.myTabId) {
            return false;
        }
        try {
            channel.postMessage({
                action: 'remote_control',
                command,
                payload,
                senderTabId: window.myTabId,
                targetTabId: owner
            });
            return true;
        } catch (error) {
            return false;
        }
    }

    previewRemoteSelection(videoId, startTime = 0, options = {}) {
        if (!videoId) {
            return;
        }
        const {
            skipBroadcast = false,
            duration: durationOverride,
            timestamp,
            playbackTimestamp
        } = options || {};
        this._currentVideoId = videoId;
        this._lastExternalVideoId = videoId;
        this.updateTrackInfo();
        const resolvedDuration = Number.isFinite(durationOverride) && durationOverride > 0
            ? durationOverride
            : this.getTrackDuration(videoId);
        const duration = Number.isFinite(resolvedDuration) && resolvedDuration > 0 ? resolvedDuration : null;
        if (Number.isFinite(duration) && duration > 0) {
            this.duration = duration;
        }
        const safeTime = this.sanitizeTime(startTime, duration);
        this._lastPersistedTime = safeTime;
        this.handleRemoteSeekPreview(safeTime, duration, {
            skipBroadcast,
            timestamp,
            playbackTimestamp,
            videoIdOverride: videoId
        });
    }

    handleRemoteSeekPreview(timeValue, durationHint = null, options = {}) {
        const {
            skipBroadcast = false,
            timestamp,
            playbackTimestamp,
            videoIdOverride
        } = options || {};
        const duration = Number.isFinite(durationHint) && durationHint > 0
            ? durationHint
            : this.getTrackDuration(this._currentVideoId);
        const safeTime = this.sanitizeTime(timeValue, duration);
        const timeSlider = this.shadowRoot?.getElementById('time-slider');
        if (timeSlider) {
            timeSlider.value = String(safeTime);
            if (Number.isFinite(duration) && duration > 0) {
                timeSlider.max = String(Math.floor(duration));
            }
        }
        this._lastPersistedTime = safeTime;
        this.lastPlaybackTime = safeTime;
        this.broadcastPlaylistProgress(safeTime, duration, {
            allowBroadcast: !skipBroadcast,
            videoId: videoIdOverride || this._currentVideoId,
            timestamp,
            playbackTimestamp
        });
        this.emitDockState({ currentTime: safeTime, duration });
    }

    applyRemoteProgress(progress = {}) {
        if (!progress || this.ownsPlayback()) {
            return;
        }

        const progressTimestamp = Number.isFinite(progress.timestamp) ? progress.timestamp : Date.now();
        if (this._lastRemoteProgressTs && progressTimestamp < this._lastRemoteProgressTs) {
            return;
        }
        this._lastRemoteProgressTs = progressTimestamp;

        const rawTime = progress.currentTime;
        const numericTime = Number.isFinite(rawTime) ? rawTime : parseFloat(rawTime);
        if (!Number.isFinite(numericTime)) {
            return;
        }

        const durationOverride = Number.isFinite(progress.duration) && progress.duration >= 0
            ? progress.duration
            : null;
        const videoId = progress.videoId || this._currentVideoId;

        if (!videoId) {
            return;
        }

        const safeTime = this.sanitizeTime(numericTime, durationOverride);
        this._lastPersistedTime = safeTime;
        if (Number.isFinite(progress.playbackTimestamp)) {
            this._lastRemotePlaybackTs = progress.playbackTimestamp;
        }
        this._lastExternalVideoId = videoId;

        if (videoId !== this._currentVideoId) {
            this.previewRemoteSelection(videoId, safeTime, {
                skipBroadcast: true,
                duration: durationOverride,
                timestamp: progressTimestamp,
                playbackTimestamp: progress.playbackTimestamp
            });
            const trackMeta = this.getCurrentTrackMeta();
            this.dispatchEvent(new CustomEvent('video-changed', {
                detail: {
                    videoId,
                    startTime: safeTime,
                    play: false,
                    title: trackMeta?.title || null,
                    channelTitle: trackMeta?.channelTitle || null,
                    channelId: trackMeta?.channelId || null,
                    duration: trackMeta?.duration || null,
                    source: 'progress-sync',
                    timestamp: progressTimestamp
                }
            }));
        } else {
            this.handleRemoteSeekPreview(safeTime, durationOverride, {
                skipBroadcast: true,
                timestamp: progressTimestamp,
                playbackTimestamp: progress.playbackTimestamp,
                videoIdOverride: videoId
            });
        }

        if (typeof progress.isPlaying === 'boolean') {
            this.isPlaying = progress.isPlaying;
            this.updatePlayPauseButton();
        }

        this.emitDockState({
            currentTime: safeTime,
            duration: durationOverride,
            isPlaying: typeof progress.isPlaying === 'boolean' ? progress.isPlaying : undefined
        });
    }

    getSync() {
        if (!this.syncInstance) {
            this.syncInstance = window.userSync || window.xaviSync || null;
        }
        return this.syncInstance;
    }

    markUserInteraction(reason = 'unspecified') {
        this._userInteractionArmed = true;
        const now = Date.now();
        const workspaceId = window.__panelTaskbar?.workspaceId;
        if (
            workspaceId &&
            window.sharedStateManager &&
            typeof window.sharedStateManager.updateWorkspaceActivity === 'function'
        ) {
            const elapsed = now - (this._lastInteractionActivityUpdate || 0);
            if (elapsed > 750) {
                window.sharedStateManager.updateWorkspaceActivity(workspaceId, reason || 'user-interaction');
                this._lastInteractionActivityUpdate = now;
            }
        }
    }

    hasUserInteraction() {
        return this._userInteractionArmed === true;
    }

    shouldSuppressPassiveStateWrites() {
        if (this.ownsPlayback()) {
            return false;
        }
        return !this.hasUserInteraction();
    }

    persistState(key, value, options = {}) {
        const force = options?.force === true;
        if (!force && this.shouldSuppressPassiveStateWrites()) {
            return;
        }
        const remove = value === null || value === undefined;

        this._markPendingStateKey(key);

        const stateSync = window.stateSync;
        let handled = false;
        if (stateSync && typeof stateSync.set === 'function') {
            if (remove && typeof stateSync.remove === 'function') {
                stateSync.remove(key);
            } else {
                stateSync.set(key, remove ? null : value);
            }
            handled = true;
        }

        const sync = this.getSync();

        if (sync && sync.loggedIn && typeof sync.set === 'function') {
            sync.set(key, remove ? null : value);
            handled = true;
        }

        // Always mirror to localStorage so legacy readers (playlist viewer, dock) see updates
        try {
            if (remove) {
                localStorage.removeItem(key);
            } else if (typeof value === 'string') {
                localStorage.setItem(key, value);
            } else {
                localStorage.setItem(key, JSON.stringify(value));
            }
        } catch (error) {
            if (!handled) {
                console.warn('Failed to persist state to localStorage fallback', key, error);
            }
        }
    }

    getStoredValue(key) {
        const stateSync = window.stateSync;
        if (stateSync && typeof stateSync.get === 'function') {
            const value = stateSync.get(key);
            if (value !== undefined && value !== null) {
                return value;
            }
        }

        const sync = this.getSync();
        if (sync && typeof sync.get === 'function') {
            const value = sync.get(key);
            if (value !== undefined && value !== null) {
                return value;
            }
        }

        try {
            return localStorage.getItem(key);
        } catch (error) {
            return null;
        }
    }

    getStoredString(key) {
        const value = this.getStoredValue(key);
        if (value === null || value === undefined) {
            return null;
        }
        if (typeof value === 'string') {
            return value;
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
        return null;
    }

    getStoredNumber(key, fallback = 0) {
        const value = this.getStoredValue(key);
        if (value === null || value === undefined || value === '') {
            return fallback;
        }
        if (typeof value === 'number') {
            return Number.isFinite(value) ? value : fallback;
        }
        const parsed = parseFloat(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    getStoredJson(key, fallback = null) {
        const value = this.getStoredValue(key);
        if (value === null || value === undefined || value === '') {
            return fallback;
        }

        if (typeof value === 'object') {
            return value;
        }

        if (typeof value === 'string') {
            try {
                const parsed = JSON.parse(value);
                return parsed === null ? fallback : parsed;
            } catch (error) {
                console.warn('Failed to parse stored JSON', key, error);
            }
        }

        return fallback;
    }

    ensureTabScopeId() {
        if (this._tabScopeId) {
            return this._tabScopeId;
        }
        if (window.myTabId) {
            this._tabScopeId = window.myTabId;
            return this._tabScopeId;
        }
        try {
            let stored = sessionStorage.getItem('myTabId');
            if (!stored) {
                stored = `${Date.now()}-${Math.random()}`;
                sessionStorage.setItem('myTabId', stored);
            }
            window.myTabId = stored;
            this._tabScopeId = stored;
            return this._tabScopeId;
        } catch (err) {
            return null;
        }
    }

    getWorkspaceStorageScope() {
        if (this._workspaceStorageScope) {
            return this._workspaceStorageScope;
        }
        const workspaceId = window.__panelTaskbar?.workspaceId || window.__bootWorkspaceId;
        if (workspaceId) {
            this._workspaceStorageScope = `workspace-${workspaceId}`;
            return this._workspaceStorageScope;
        }
        const tabScope = this.ensureTabScopeId();
        if (tabScope) {
            this._workspaceStorageScope = `tab-${tabScope}`;
            return this._workspaceStorageScope;
        }
        this._workspaceStorageScope = 'ws-default';
        return this._workspaceStorageScope;
    }

    getDockModeKey() {
        return `musicPlayerDockMode.${this.getWorkspaceStorageScope()}`;
    }

    updateShuffleIndicator(isEnabled) {
        const shuffleControl = this.shadowRoot?.querySelector('.shuffle-control');
        if (shuffleControl) {
            shuffleControl.classList.toggle('active', !!isEnabled);
            shuffleControl.setAttribute('data-active', isEnabled ? 'true' : 'false');
        }
    }

    touchPlaybackTimestamp() {
        if (!this.ownsPlayback()) {
            return;
        }
        this.persistState('myLastPlayTimestamp', Date.now().toString());
    }

    sanitizeTime(timeValue, duration = null) {
        let numeric = Number.isFinite(timeValue) ? timeValue : parseFloat(timeValue);
        if (!Number.isFinite(numeric) || numeric < 0) {
            numeric = 0;
        }

        if (Number.isFinite(duration) && duration > 0) {
            const max = duration;
            if (numeric > max) {
                // Allow tiny buffer at tail to avoid endSeconds errors
                numeric = Math.max(0, max - 0.25);
            }
        }

        return numeric;
    }

    shouldApplyLoad(meta) {
        if (!meta) {
            return true;
        }

        const last = this._lastLoadMeta;
        if (!last) {
            return true;
        }

        if (meta.videoId !== last.videoId) {
            return true;
        }

        if (!!meta.play !== !!last.play) {
            return true;
        }

        const now = Date.now();
        const lastTs = last.ts || 0;
        const timeDelta = Math.abs((meta.time || 0) - (last.time || 0));

        // Always allow if enough time has passed to avoid suppressing legitimate hops
        if (now - lastTs > 600) {
            return true;
        }

        // If difference is minimal, skip redundant loads
        if (timeDelta < 0.25) {
            return false;
        }

        // Allow seeks beyond small jitter threshold
        return timeDelta >= 0.4;
    }

    getPanelPartner(tagName) {
        if (!tagName) {
            return null;
        }

        const ownPanel = this.closest('[data-panel-id]');
        if (!ownPanel) {
            return document.querySelector(tagName)
                || document.querySelector('xavi-multi-grid')?.shadowRoot?.querySelector(tagName)
                || window.__videoPlayerElement
                || null;
        }

        const panelId = ownPanel.getAttribute('data-panel-id');
        if (!panelId) {
            return document.querySelector(tagName)
                || document.querySelector('xavi-multi-grid')?.shadowRoot?.querySelector(tagName)
                || window.__videoPlayerElement
                || null;
        }

        return document.querySelector(`${tagName}[data-panel-id="${panelId}"]`)
            || document.querySelector(tagName)
            || document.querySelector('xavi-multi-grid')?.shadowRoot?.querySelector(tagName)
            || window.__videoPlayerElement
            || null;
    }

    _markPendingStateKey(key) {
        if (!key) {
            return;
        }
        if (!this._pendingStateKeys) {
            this._pendingStateKeys = new Map();
        }
        const timestamp = Date.now();
        this._pendingStateKeys.set(key, timestamp);
        setTimeout(() => {
            const current = this._pendingStateKeys.get(key);
            if (current && current === timestamp) {
                this._pendingStateKeys.delete(key);
            }
        }, 2000);
    }

    _shouldSkipStateSyncKey(key) {
        if (!key) {
            return false;
        }
        if (!this._pendingStateKeys) {
            this._pendingStateKeys = new Map();
        }
        const timestamp = this._pendingStateKeys.get(key);
        if (timestamp && Date.now() - timestamp < 1000) {
            this._pendingStateKeys.delete(key);
            return true;
        }
        if (timestamp) {
            this._pendingStateKeys.delete(key);
        }
        return false;
    }

    // Embedded dock mode methods
    restoreDockMode() {
        const storedMode = localStorage.getItem(this.getDockModeKey());
        const hasStoredMode = typeof storedMode === 'string' && storedMode.length > 0;
        if (!hasStoredMode || storedMode === 'embedded') {
            // Default to embedded so taskbar controls remain available on first load
            this.setEmbeddedMode({ skipSave: storedMode === 'embedded' });
        } else {
            this.setNormalMode({ skipSave: true });
        }
    }

    setEmbeddedMode({ skipSave = false } = {}) {
        if (this.dockMode === 'embedded') return;
        
        this.lastNormalMode = this.dockMode === 'embedded' ? this.lastNormalMode : this.dockMode;
        this.dockMode = 'embedded';
        
        // Hide the music player UI
        this.style.display = 'none';
        this.setAttribute('dock-mode', 'embedded');
        
        if (!skipSave) {
            localStorage.setItem(this.getDockModeKey(), 'embedded');
        }

        // Update dock toggle button
        const dockToggleButton = this.shadowRoot?.getElementById('dock-toggle-button');
        if (dockToggleButton) {
            dockToggleButton.textContent = '⬆';
            dockToggleButton.title = 'Undock from taskbar';
            dockToggleButton.setAttribute('aria-label', 'Undock from taskbar');
        }

        // Notify taskbar to show embedded controls
        document.dispatchEvent(new CustomEvent('music-player-embedded', {
            detail: {
                title: this._currentTrackMeta?.title,
                channelTitle: this._currentTrackMeta?.channelTitle,
                artist: this._currentTrackMeta?.channelTitle,
                isPlaying: this.isPlaying,
                videoId: this._currentVideoId
            }
        }));

        this.notifyDockStateChange();
    }

    setNormalMode({ skipSave = false } = {}) {
        if (this.dockMode === 'normal') return;
        
        this.dockMode = 'normal';
        
        // Show the music player UI
        this.style.display = '';
        this.setAttribute('dock-mode', 'normal');
        
        if (!skipSave) {
            localStorage.setItem(this.getDockModeKey(), 'normal');
        }

        // Update dock toggle button
        const dockToggleButton = this.shadowRoot?.getElementById('dock-toggle-button');
        if (dockToggleButton) {
            dockToggleButton.textContent = '⬇';
            dockToggleButton.title = 'Dock to taskbar';
            dockToggleButton.setAttribute('aria-label', 'Dock to taskbar');
        }

        // Notify taskbar to hide embedded controls
        document.dispatchEvent(new CustomEvent('music-player-restored', {
            detail: {}
        }));

        this.notifyDockStateChange();
    }

    restoreFromEmbedded() {
        this.setNormalMode();
    }

    toggleDockMode() {
        if (this.dockMode === 'embedded') {
            this.setNormalMode();
        } else {
            this.setEmbeddedMode();
        }
    }

    notifyDockStateChange() {
        this.emitDockState();
    }

    syncFromSharedState(newState, oldState) {
        if (!this.player || !this._playerReady) {
            return;
        }

        if (this.isPrimaryWorkspace()) {
            return;
        }

        // Secondary workspaces are passive observers/controllers only.
        // Never start or continue local playback in secondary tabs.
        this.muteAudio('secondary-sync');
        try {
            if (typeof this.player.pauseVideo === 'function') {
                this.player.pauseVideo();
            }
        } catch (err) {
            /* ignore */
        }

        const nextVideoId = newState.currentVideoId || null;
        const nextTime = Number.isFinite(newState.currentTime) ? newState.currentTime : null;
        const nextDuration = Number.isFinite(newState.duration) ? newState.duration : null;
        const prevTrackedTime = Number.isFinite(this.lastPlaybackTime) ? this.lastPlaybackTime : null;

        const videoChanged = nextVideoId && nextVideoId !== this._currentVideoId;
        const playStateChanged = typeof newState.isPlaying === 'boolean' && newState.isPlaying !== this.isPlaying;
        const timeChanged = nextTime !== null && (prevTrackedTime === null || Math.abs(nextTime - prevTrackedTime) > 5);

        // Load new video if changed (cue only, never autoplay)
        if (videoChanged) {
            if (window.DEBUG_MUSIC_PLAYER) {
                console.log('[MusicPlayer] Secondary workspace syncing to new video:', nextVideoId);
            }
            this.muteAudio('secondary-video-change');
            this._currentVideoId = nextVideoId;
            this.duration = nextDuration || 0;

            try {
                if (typeof this.player.cueVideoById === 'function') {
                    this.player.cueVideoById({
                        videoId: nextVideoId,
                        startSeconds: nextTime || 0
                    });
                } else if (typeof this.player.loadVideoById === 'function') {
                    this.player.loadVideoById({
                        videoId: nextVideoId,
                        startSeconds: nextTime || 0
                    });
                    if (typeof this.player.pauseVideo === 'function') {
                        this.player.pauseVideo();
                    }
                }
            } catch (err) {
                console.warn('[MusicPlayer] Failed to cue video in secondary:', err);
            }

            // Reflect shared state in UI, but keep local player paused.
            this.isPlaying = !!newState.isPlaying;
            
            this.updateTrackInfo();
            this.updatePlayPauseButton();
            this.handleRemoteSeekPreview(nextTime ?? 0, nextDuration, {
                skipBroadcast: true,
                videoIdOverride: nextVideoId
            });
            if (nextTime !== null) {
                this.lastPlaybackTime = nextTime;
            }
        }
        // Sync play/pause state
        else if (playStateChanged) {
            if (window.DEBUG_MUSIC_PLAYER) {
                console.log('[MusicPlayer] Secondary workspace syncing play state:', newState.isPlaying);
            }
            // UI-only: do not play locally.
            this.isPlaying = !!newState.isPlaying;
            try {
                if (typeof this.player.pauseVideo === 'function') {
                    this.player.pauseVideo();
                }
            } catch (err) {
                /* ignore */
            }
            this.updatePlayPauseButton();
        }
        // Loosely sync time only if significantly drifted (>5 seconds)
        else if (timeChanged) {
            if (window.DEBUG_MUSIC_PLAYER) {
                console.log('[MusicPlayer] Secondary workspace syncing time via shared state:', nextTime);
            }
            // UI-only: never seek the local player in secondary tabs.
            if (nextTime !== null) {
                this.handleRemoteSeekPreview(nextTime, nextDuration, {
                    skipBroadcast: true,
                    videoIdOverride: nextVideoId || this._currentVideoId
                });
                this.lastPlaybackTime = nextTime;
            }
        }

        // Always update UI with latest metadata
        if (newState.trackTitle || newState.trackArtist) {
            this._currentTrackMeta = {
                ...this._currentTrackMeta,
                title: newState.trackTitle || this._currentTrackMeta?.title,
                channelTitle: newState.trackArtist || this._currentTrackMeta?.channelTitle
            };
            
            const trackTitle = this.shadowRoot?.getElementById('track-title');
            const channelName = this.shadowRoot?.getElementById('channel-name');
            
            if (trackTitle && newState.trackTitle) {
                trackTitle.textContent = newState.trackTitle;
            }
            if (channelName && newState.trackArtist) {
                channelName.textContent = newState.trackArtist;
            }
        }
    }
}

customElements.define('music-player', MusicPlayer);
