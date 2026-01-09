/**
 * TaskbarHeartbeat - Central meta-media protocol for multi-focal UI
 * Broadcasts and syncs playback state, now-playing metadata, and workspace state
 * across all tabs/windows via localStorage + BroadcastChannel
 * 
 * This is the primary data conduit that taskbar, panels, and players use to:
 * - Share real-time playback position and track info
 * - Coordinate workspace audio ownership
 * - Enable remote control between workspaces
 * - Maintain loose time-sync for visual playback
 */
class TaskbarHeartbeat {
    constructor() {
        this.storageKey = 'pgmusic.heartbeat';
        this.channelName = 'pgmusic_heartbeat';
        this.channel = null;
        this.listeners = new Map();
        this.updateInterval = null;
        this._lastRawState = null;
        this.localState = this.loadState();
        
        this.boundStorageHandler = (e) => this.handleStorageChange(e);
        this.boundChannelHandler = (e) => this.handleChannelMessage(e);
        
        this.init();
    }

    init() {
        try {
            this.channel = new BroadcastChannel(this.channelName);
            this.channel.addEventListener('message', this.boundChannelHandler);
        } catch (err) {
            console.warn('[Heartbeat] BroadcastChannel not available:', err);
        }
        
        window.addEventListener('storage', this.boundStorageHandler);
        
        // Poll storage every 1000ms for updates
        this.updateInterval = setInterval(() => {
            const updated = this.loadState();
            if (updated) {
                this.notifyListeners('poll');
            }
        }, 1000);
        
        console.log('[Heartbeat] Protocol initialized');
    }

    destroy() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        
        if (this.channel) {
            this.channel.removeEventListener('message', this.boundChannelHandler);
            this.channel.close();
            this.channel = null;
        }
        
        window.removeEventListener('storage', this.boundStorageHandler);
        this.listeners.clear();
    }

    loadState() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (!stored) return this.getDefaultState();

            // Comparing the raw JSON string is much cheaper than deep-equality checks
            // on large playlist payloads, and it's sufficient for change detection.
            if (this._lastRawState === stored) {
                return false;
            }

            const parsed = JSON.parse(stored);
            this._lastRawState = stored;
            this.localState = parsed;
            return true;
        } catch (err) {
            console.warn('[Heartbeat] Failed to load state:', err);
            return false;
        }
    }

    getDefaultState() {
        return {
            // Playback state
            currentVideoId: null,
            currentTime: 0,
            duration: 0,
            isPlaying: false,
            
            // Track metadata
            trackTitle: 'No track playing',
            trackArtist: 'Unknown Artist',
            trackThumbnail: null,
            channelId: null,
            
            // Workspace state
            audioWorkspaceId: null,
            primaryWorkspaceId: null,
            activeWorkspaces: [],
            
            // Remote control
            remoteCommand: null,
            remoteCommandPayload: null,
            remoteCommandTimestamp: 0,
            
            // Playlist state
            playlistQueue: [],
            currentQueueIndex: -1,
            shuffleEnabled: false,
            
            timestamp: Date.now()
        };
    }

    getState() {
        return { ...this.localState };
    }

    get(key) {
        return this.localState[key];
    }

    setState(updates, source = 'unknown') {
        const timestamp = Date.now();
        const prevState = { ...this.localState };
        
        this.localState = {
            ...this.localState,
            ...updates,
            timestamp
        };
        
        // Persist to localStorage
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.localState));
        } catch (err) {
            console.warn('[Heartbeat] Failed to persist state:', err);
        }
        
        // Broadcast to other tabs
        if (this.channel) {
            try {
                this.channel.postMessage({
                    action: 'state_update',
                    updates,
                    state: this.localState,
                    source,
                    timestamp
                });
            } catch (err) {
                console.warn('[Heartbeat] Failed to broadcast update:', err);
            }
        }
        
        this.notifyListeners(source, prevState);
    }

    subscribe(callback) {
        if (typeof callback !== 'function') {
            throw new TypeError('TaskbarHeartbeat.subscribe requires a function callback');
        }

        const id = `${Date.now()}_${Math.random()}`;
        this.listeners.set(id, callback);

        try {
            callback({ ...this.localState }, null, 'initial');
        } catch (err) {
            console.warn('[Heartbeat] Listener error on initial subscribe:', err);
        }
        
        return () => {
            this.listeners.delete(id);
        };
    }

    notifyListeners(source, prevState = null) {
        this.listeners.forEach((callback) => {
            try {
                callback(this.localState, prevState, source);
            } catch (err) {
                console.warn('[Heartbeat] Listener error:', err);
            }
        });
    }

    handleStorageChange(event) {
        if (!event || event.key !== this.storageKey) return;
        
        const updated = this.loadState();
        if (updated) {
            this.notifyListeners('storage');
        }
    }

    handleChannelMessage(event) {
        const data = event?.data;
        if (!data || data.action !== 'state_update') return;
        
        const prevState = { ...this.localState };
        this.localState = data.state || this.localState;
        this.notifyListeners('channel', prevState);
    }

    // High-level API for common operations
    updatePlayback(currentTime, duration, isPlaying) {
        this.setState({
            currentTime,
            duration,
            isPlaying,
            timestamp: Date.now()
        }, 'playback-update');
    }

    updateTrack(videoId, title, artist, thumbnail = null, channelId = null) {
        this.setState({
            currentVideoId: videoId,
            trackTitle: title,
            trackArtist: artist,
            trackThumbnail: thumbnail,
            channelId: channelId,
            timestamp: Date.now()
        }, 'track-update');
    }

    sendCommand(command, payload = {}) {
        this.setState({
            remoteCommand: command,
            remoteCommandPayload: payload,
            remoteCommandTimestamp: Date.now()
        }, 'remote-command');
    }

    setAudioWorkspace(workspaceId) {
        this.setState({
            audioWorkspaceId: workspaceId,
            timestamp: Date.now()
        }, 'audio-workspace');
    }

    setPrimaryWorkspace(workspaceId) {
        this.setState({
            primaryWorkspaceId: workspaceId,
            timestamp: Date.now()
        }, 'primary-workspace');
    }

    updateWorkspaces(workspaces) {
        this.setState({
            activeWorkspaces: workspaces,
            timestamp: Date.now()
        }, 'workspaces-update');
    }
}

// Global singleton
if (typeof window !== 'undefined') {
    if (!window.taskbarHeartbeat) {
        window.taskbarHeartbeat = new TaskbarHeartbeat();
    }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TaskbarHeartbeat;
}
