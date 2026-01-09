/**
 * SharedStateManager - Single source of truth for all tabs
 * All tabs read from this, any tab can write to it
 */
class SharedStateManager {
    constructor() {
        this.stateKey = 'pgmusic.sharedState';
        this.channel = null;
        this.listeners = new Map();
        this.localState = this.loadState();
        this.initChannel();
        this.initStorageListener();
    }

    initChannel() {
        try {
            this.channel = new BroadcastChannel('pgmusic_shared_state');
            this.channel.addEventListener('message', (e) => this.handleChannelMessage(e));
        } catch (err) {
            console.warn('BroadcastChannel not available:', err);
        }
    }

    initStorageListener() {
        window.addEventListener('storage', (e) => {
            if (e.key === this.stateKey && e.newValue) {
                const prevState = this.localState;
                this.localState = JSON.parse(e.newValue);
                this.notifyListeners('storage', this.localState, prevState);
            }
        });
    }

    handleChannelMessage(event) {
        const data = event?.data;
        if (!data || data.action !== 'state_update') return;
        
        const prevState = this.localState;
        this.localState = { ...this.localState, ...data.state };
        this.notifyListeners('channel', this.localState, prevState);
    }

    loadState() {
        try {
            const stored = localStorage.getItem(this.stateKey);
            return stored ? JSON.parse(stored) : this.getDefaultState();
        } catch (err) {
            console.warn('Failed to load shared state:', err);
            return this.getDefaultState();
        }
    }

    getDefaultState() {
        return {
            currentVideoId: null,
            currentTime: 0,
            duration: 0,
            isPlaying: false,
            volume: 50,
            trackTitle: 'No track playing',
            trackArtist: 'Unknown Artist',
            playlistData: [],
            
            // Centralized queue system - single source of truth for all tabs
            playlistQueue: [],          // Full playlist array [{vid, title, artist, ...}]
            currentQueueIndex: -1,      // Current position in queue
            navigationHistory: [],      // History of played tracks for back/forward
            shuffleHistory: [],         // Shuffle-specific history
            shuffleEnabled: false,      // Shuffle mode state
            backHistoryIndex: -1,       // Position in shuffle history
            
            // Workspace management - track all open tabs/windows
            workspaces: [],             // Array of {id, tabId, windowName, hasAudio, timestamp}
            audioWorkspaceId: null,     // ID of workspace that has audio
            
            timestamp: Date.now()
        };
    }

    /**
     * Get current state (read-only copy)
     */
    getState() {
        return { ...this.localState };
    }

    /**
     * Get specific state property
     */
    get(key) {
        return this.localState[key];
    }

    /**
     * Update state (partial update)
     * This is the ONLY way tabs should modify state
     */
    setState(updates, source = 'unknown') {
        const timestamp = Date.now();
        const prevState = this.localState;
        const newState = {
            ...this.localState,
            ...updates,
            timestamp
        };

        // Persist to localStorage (triggers storage event in other tabs)
        try {
            localStorage.setItem(this.stateKey, JSON.stringify(newState));
            this.localState = newState;
        } catch (err) {
            console.warn('Failed to persist state:', err);
        }

        // Broadcast to other tabs via BroadcastChannel (faster than storage event)
        if (this.channel) {
            try {
                this.channel.postMessage({
                    action: 'state_update',
                    state: newState,
                    source,
                    timestamp
                });
            } catch (err) {
                console.warn('Failed to broadcast state:', err);
            }
        }

        // Notify local listeners
        this.notifyListeners('local', newState, prevState);
    }

    /**
     * Subscribe to state changes
     * @param {string} key - Optional specific key to watch
     * @param {Function} callback - Called with (newValue, oldValue, fullState)
     * @returns {Function} unsubscribe function
     */
    subscribe(callback, key = null) {
        const id = `${Date.now()}_${Math.random()}`;
        this.listeners.set(id, { callback, key });

        return () => {
            this.listeners.delete(id);
        };
    }

    notifyListeners(source, newState, prevState = null) {
        this.listeners.forEach(({ callback, key }) => {
            if (key) {
                const oldValue = prevState ? prevState[key] : undefined;
                const newValue = newState[key];
                if (oldValue !== newValue) {
                    callback(newValue, oldValue, newState);
                }
            } else {
                callback(newState, prevState, source);
            }
        });
    }

    /**
     * Batch update multiple properties atomically
     */
    batchUpdate(updates, source = 'batch') {
        this.setState(updates, source);
    }

    /**
     * Reset to default state
     */
    reset() {
        this.setState(this.getDefaultState(), 'reset');
    }

    // ============================================================
    // Queue Management API
    // ============================================================

    /**
     * Set the entire playlist queue
     */
    setQueue(tracks, source = 'setQueue') {
        this.setState({ playlistQueue: tracks, timestamp: Date.now() }, source);
    }

    /**
     * Get current track from queue
     */
    getCurrentTrack() {
        const state = this.getState();
        const idx = state.currentQueueIndex;
        return idx >= 0 && idx < state.playlistQueue.length 
            ? state.playlistQueue[idx] 
            : null;
    }

    /**
     * Navigate to specific queue index
     */
    setCurrentIndex(index, source = 'navigate') {
        const queue = this.get('playlistQueue') || [];
        if (index >= 0 && index < queue.length) {
            const track = queue[index];
            this.setState({
                currentQueueIndex: index,
                currentVideoId: track?.vid || null,
                timestamp: Date.now()
            }, source);
        }
    }

    /**
     * Move to next track in queue
     */
    nextTrack(source = 'next') {
        const state = this.getState();
        const queue = state.playlistQueue || [];
        const nextIdx = (state.currentQueueIndex + 1) % queue.length;
        this.setCurrentIndex(nextIdx, source);
        return queue[nextIdx];
    }

    /**
     * Move to previous track in queue
     */
    previousTrack(source = 'previous') {
        const state = this.getState();
        const queue = state.playlistQueue || [];
        const prevIdx = (state.currentQueueIndex - 1 + queue.length) % queue.length;
        this.setCurrentIndex(prevIdx, source);
        return queue[prevIdx];
    }

    /**
     * Find and set current track by video ID
     */
    setCurrentTrackById(videoId, source = 'loadTrack') {
        const queue = this.get('playlistQueue') || [];
        const idx = queue.findIndex(t => t.vid === videoId);
        if (idx >= 0) {
            this.setCurrentIndex(idx, source);
            return queue[idx];
        }
        return null;
    }

    appendToNowPlaying(track, source = 'now-playing-append') {
        if (!track) {
            return;
        }

        const state = this.getState();
        const queue = Array.isArray(state.playlistQueue) ? [...state.playlistQueue] : [];
        const vid = track.vid || track.videoId || track.video_id || track.id || null;
        if (!vid) {
            return;
        }

        const exists = queue.some((item) => {
            if (!item) return false;
            const itemVid = item.vid || item.videoId || item.video_id || item.id || null;
            return itemVid === vid;
        });

        if (exists) {
            // Still bump timestamp so listeners know a user interacted with the queue
            this.setState({ timestamp: Date.now() }, source);
            return;
        }

        const normalizedTrack = {
            vid,
            title: track.title || track.trackTitle || 'Unknown Title',
            channelTitle: track.channelTitle || track.artist || track.author || track.channel || '',
            duration: track.duration || null,
            thumbnail: track.thumbnail || track.thumb || null,
            url: track.url || null,
            source: track.source || source
        };

        queue.push({ ...track, ...normalizedTrack });

        const hasCurrent = state.currentQueueIndex >= 0 && state.currentQueueIndex < queue.length;
        const nextIndex = hasCurrent ? state.currentQueueIndex : 0;

        this.setState({
            playlistQueue: queue,
            currentQueueIndex: nextIndex,
            timestamp: Date.now()
        }, source);
    }

    /**
     * Add track to navigation history
     */
    addToHistory(videoId, source = 'history') {
        const history = this.get('navigationHistory') || [];
        this.setState({
            navigationHistory: [...history, videoId],
            timestamp: Date.now()
        }, source);
    }

    /**
     * Update shuffle state
     */
    setShuffleMode(enabled, source = 'shuffle') {
        this.setState({ 
            shuffleEnabled: enabled,
            timestamp: Date.now()
        }, source);
    }

    // ============================================================
    // Workspace Management API
    // ============================================================

    /**
     * Register a workspace (tab/window)
     */
    addWorkspace(workspaceId, tabId, windowName = '', source = 'workspace') {
        const workspaces = this.get('workspaces') || [];
        
        // Check if already exists
        if (workspaces.some(w => w.id === workspaceId)) {
            console.log('[SharedState] Workspace already registered:', workspaceId);
            return;
        }
        
        const now = Date.now();
        const newWorkspace = {
            id: workspaceId,
            tabId: tabId,
            windowName: windowName || `Workspace ${workspaces.length + 1}`,
            timestamp: now,
            lastHeartbeat: now,
            lastActive: now  // Track when workspace was last interacted with
        };
        
        this.setState({
            workspaces: [...workspaces, newWorkspace],
            timestamp: now
        }, source);
        
        console.log('[SharedState] Registered workspace:', newWorkspace);
        return newWorkspace;
    }

    /**
     * Remove a workspace
     */
    removeWorkspace(workspaceId, source = 'workspace') {
        const workspaces = this.get('workspaces') || [];
        const filtered = workspaces.filter(w => w.id !== workspaceId);
        
        if (filtered.length === workspaces.length) {
            console.warn('[SharedState] Workspace not found:', workspaceId);
            return;
        }
        
        const updates = { workspaces: filtered, timestamp: Date.now() };
        
        // If this was the audio workspace, clear audio ownership
        if (this.get('audioWorkspaceId') === workspaceId) {
            updates.audioWorkspaceId = null;
            localStorage.removeItem('musicAudioOwner');
            localStorage.removeItem('musicPlayerCurrentOwner');
        }
        
        this.setState(updates, source);
        console.log('[SharedState] Removed workspace:', workspaceId);
    }

    /**
     * Set which workspace has audio output
     */
    setAudioWorkspace(workspaceId, source = 'workspace') {
        const workspaces = this.get('workspaces') || [];
        const workspace = workspaces.find(w => w.id === workspaceId);
        
        if (!workspace) {
            console.warn('[SharedState] Cannot set audio for unknown workspace:', workspaceId);
            return;
        }
        
        this.setState({
            audioWorkspaceId: workspaceId,
            timestamp: Date.now()
        }, source);
        
        // Also update musicAudioOwner for compatibility
        localStorage.setItem('musicAudioOwner', workspace.tabId);
        localStorage.setItem('musicAudioOwnerTimestamp', Date.now().toString());
        localStorage.setItem('musicPlayerCurrentOwner', workspace.tabId);
        
        console.log('[SharedState] Set audio workspace:', workspaceId);
    }

    /**
     * Get all workspaces
     */
    getWorkspaces() {
        return this.get('workspaces') || [];
    }

    /**
     * Get current audio workspace
     */
    getAudioWorkspace() {
        const audioId = this.get('audioWorkspaceId');
        const workspaces = this.getWorkspaces();
        return workspaces.find(w => w.id === audioId) || null;
    }

    /**
     * Update workspace heartbeat (for alive detection)
     */
    updateWorkspaceHeartbeat(workspaceId, source = 'heartbeat') {
        const workspaces = this.get('workspaces') || [];
        const now = Date.now();
        const updated = workspaces.map(w => 
            w.id === workspaceId 
                ? { ...w, lastHeartbeat: now }
                : w
        );
        
        this.setState({ workspaces: updated, timestamp: now }, source);
    }

    /**
     * Update workspace activity (when user interacts)
     */
    updateWorkspaceActivity(workspaceId, source = 'activity') {
        const workspaces = this.get('workspaces') || [];
        const now = Date.now();
        const updated = workspaces.map(w => 
            w.id === workspaceId 
                ? { ...w, lastActive: now, lastHeartbeat: now }
                : w
        );
        
        this.setState({ workspaces: updated, timestamp: now }, source);
    }

    /**
     * Get most recently active workspace
     */
    getMostActiveWorkspace() {
        const workspaces = this.getWorkspaces();
        if (!workspaces.length) return null;
        
        return workspaces.reduce((most, current) => {
            const mostActive = most.lastActive || most.timestamp || 0;
            const currentActive = current.lastActive || current.timestamp || 0;
            return currentActive > mostActive ? current : most;
        });
    }

    /**
     * Clean up dead workspaces (no heartbeat for 10 seconds)
     */
    cleanupDeadWorkspaces(source = 'cleanup') {
        const workspaces = this.get('workspaces') || [];
        const now = Date.now();
        const alive = workspaces.filter(w => {
            const lastSeen = w.lastHeartbeat || w.timestamp;
            return (now - lastSeen) < 10000; // 10 second timeout
        });
        
        if (alive.length !== workspaces.length) {
            console.log('[SharedState] Cleaned up', workspaces.length - alive.length, 'dead workspaces');
            this.setState({ workspaces: alive, timestamp: Date.now() }, source);
        }
    }

    destroy() {
        if (this.channel) {
            this.channel.close();
            this.channel = null;
        }
        this.listeners.clear();
    }
}

// Global singleton instance
if (typeof window !== 'undefined') {
    if (!window.sharedStateManager) {
        window.sharedStateManager = new SharedStateManager();
    }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SharedStateManager;
}
