function resolveVideoPlayerElement() {
    return document.querySelector('video-player')
        || document.querySelector('xavi-multi-grid')?.shadowRoot?.querySelector('video-player')
        || document.getElementById('floating-panel-layer')?.querySelector('video-player')
        || window.__videoPlayerElement
        || null;
}

class Taskbar extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        this.MAX_PANELS = 4;
        this.stateKey = 'pgmusic.panelLayout';

        this.maxGridColumns = 64;
        this.maxGridRows = 64;
        this.gridColumns = this.maxGridColumns;
        this.gridRows = this.maxGridRows;
        this.cellDimension = 30;
        // Panels-only mode: overlays are disabled.
        this.panelSelections = [];
        this.overlaysEnabled = false;
        this.panelLayouts = [];
        this.componentInstances = {};
        this.cachedRegistryEntries = [];
        this.registryDirty = false;
        this.layoutMode = 'grid';
        // Legacy tab-panel (grid mode) UI is deprecated. Panels should be floating/column-based.
        // Keep the taskbar itself, but never render #content-area > div.tab-panel.
        this.disableTabPanels = true;
        this._videoProbeScheduled = false;
        this.containerMode = 'full';
        this.containerWrapper = null;
        this.panelElements = [];
        this.activePanelIndex = 0; // Track which panel is currently visible
        this.activeInteraction = null;
        this.boundPointerMove = (event) => this.onPointerMove(event);
        this.boundPointerUp = (event) => this.onPointerUp(event);
        this.boundResize = () => this.requestGridMetricsUpdate();
        this.usingWindowResize = false;
        // Default panel dimensions will be calculated dynamically based on visible grid columns
        this.cellSize = this.cellDimension;
        this.gridGap = 0;
        this.dropIndicator = null;
        this.resizeObserver = null;
        this.gridMetricsScheduled = false;
        this.gridMetricsRetryHandle = null;
        this._updatingGridMetrics = false;
        this.userIsAdmin = false;
        this.userStatusChecked = false;
        this.tabSystem = null;
        this.minBackgroundHeight = 480;
        this.defaultBackgroundHeight = this.minBackgroundHeight;
        this.backgroundHeight = this.minBackgroundHeight;
        this.taskViewEntries = new Map();
        this.taskViewElementMap = new WeakMap();
        this.activeTaskviewId = null;
        this.boundFloatingPanelFocus = (event) => this.handleFloatingPanelFocus(event);
        this.boundFloatingPanelClosed = (event) => this.handleFloatingPanelClosed(event);
        this.boundBusTaskviewState = (event) => this.handleBusTaskviewState(event);
        this.busTaskviewInstanceId = 'taskview-bus-routes';
        this._busTaskviewListenerAttached = false;

        this.availableTabs = {};

        this.specialComponents = {
            'video-player': {
                element: null,
                homeParent: null,
                homeNextSibling: null,
                panelPlayer: null,
                panelContainer: null,
                originalMode: null
            }
        };

        this.dockRegistry = new Map();
        this.dockPreferencesKey = 'pgmusic.dockModes';
        this.dockMiniLayer = null;
        this.defaultDockModes = ['docked', 'mini', 'expanded'];
        this._dockReadyNotified = false;

        this.workspaceStorageListener = null;
        this.boundBeforeUnload = null;
        this.screenDetails = null;
        this.nextScreenIndex = 0;
        this.workspaceLaunchCount = 0;
        this.lastSharedStateTimestamp = 0;

        this.workspace = null;
        this.boundWorkspaceReady = (event) => this.onWorkspaceReady(event);
        this.boundRegistryUpdate = () => this.handleRegistryUpdate();

        this.menuDefinition = null;
        this._menuLoadPromise = null;
        this._startMenuSearchQuery = '';
        this._openStartMenuSubmenus = new Set();

        this._taskbarClockInterval = null;

        this._layoutPanelTaskviewInstanceIds = new Set();
    }

    syncLayoutPanelsToTaskviewEntries() {
        if (!this.taskViewEntries) {
            this.taskViewEntries = new Map();
        }

        const desired = new Set();

        // Represent the "layout panels" (panelSelections) as taskview entries so the taskbar has a single unified strip.
        this.panelSelections?.forEach((tabId) => {
            if (!tabId) {
                return;
            }

            const instanceId = `layout-panel:${tabId}`;
            desired.add(instanceId);

            const findIndex = () => this.panelSelections?.findIndex((id) => id === tabId) ?? -1;
            const resolveElement = () => {
                const index = findIndex();
                if (index < 0) return null;
                return this.panelElements?.[index] || null;
            };

            const toggleMinimize = () => {
                const index = findIndex();
                if (index < 0) return;
                const layout = this.panelLayouts?.[index] || null;
                if (layout?.minimized) {
                    this.restorePanel(index);
                } else {
                    this.minimizePanel(index);
                }
            };

            const closePanel = () => {
                const index = findIndex();
                if (index < 0) return;
                this.removePanel(index);
            };

            const focusPanel = () => {
                const index = findIndex();
                if (index < 0) return;
                const layout = this.panelLayouts?.[index] || null;
                if (layout?.minimized) {
                    this.restorePanel(index);
                }
                const el = resolveElement();
                if (el && typeof el.scrollIntoView === 'function') {
                    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            };

            this.registerTaskviewEntry(
                tabId,
                this.availableTabs?.[tabId] || null,
                resolveElement(),
                {
                    instanceId,
                    setActive: false,
                    taskviewConfig: {
                        controls: ['minimize', 'close'],
                        focus: focusPanel,
                        minimize: toggleMinimize,
                        close: closePanel
                    }
                }
            );
        });

        // Remove stale layout-panel:* entries.
        if (this._layoutPanelTaskviewInstanceIds?.size) {
            Array.from(this._layoutPanelTaskviewInstanceIds).forEach((instanceId) => {
                if (!desired.has(instanceId)) {
                    this.unregisterTaskviewEntry(instanceId);
                }
            });
        }

        this._layoutPanelTaskviewInstanceIds = desired;
    }

    async loadTemplate() {
        try {
            const workspace = this.closest('xavi-multi-grid');

            // Prefer the module's configured path so we don't depend on external single_pages.
            let templatePath = '';
            try {
                const cfg = (window.XAVI_MODULE_CONFIGS && window.XAVI_MODULE_CONFIGS.taskbar) ? window.XAVI_MODULE_CONFIGS.taskbar : null;
                if (cfg && typeof cfg.path === 'string' && cfg.path) {
                    templatePath = `${cfg.path}/taskbar-template.html`;
                }
            } catch (e) {
                // ignore
            }

            if (!templatePath) {
                const basePath = workspace?.dataset?.basePath || '/packages/xavi_social/multigrid';
                templatePath = `${basePath}/js/modules/taskbar/taskbar-template.html`;
            }
            console.log('[TASKBAR] Loading template from:', templatePath);
            
            const response = await fetch(templatePath);
            if (!response.ok) {
                throw new Error(`Failed to load taskbar template: ${response.status} ${response.statusText}`);
            }
            
            const html = await response.text();
            console.log('[TASKBAR] Template fetched, size:', html.length, 'bytes');
            
            const template = document.createElement('template');
            template.innerHTML = html;
            this.shadowRoot.appendChild(template.content.cloneNode(true));
            
            console.log('[TASKBAR] Template loaded successfully, Shadow DOM has', this.shadowRoot.childNodes.length, 'top-level nodes');
        } catch (error) {
            console.error('[TASKBAR] Failed to load template:', error);
            // Fallback: create minimal structure
            this.shadowRoot.innerHTML = `
                <style>:host { display: block; position: absolute; bottom: 0; left: 0; right: 0; height: 108px; }</style>
                <div class="taskbar" style="background: rgba(255,0,0,0.5); height: 100px; display: flex; padding: 12px; color: white; align-items: center;">
                    <div>⚠️ Taskbar template failed to load - check console</div>
                </div>
            `;
        }
    }

    connectedCallback() {
        this.registerWithWorkspace();
        document.addEventListener('xavi-workspace-ready', this.boundWorkspaceReady);
        window.addEventListener('xavi-panel-entry-registered', this.boundRegistryUpdate);
        window.addEventListener('xavi-panel-entry-unregistered', this.boundRegistryUpdate);
        window.addEventListener('xavi-panel-registry-ready', this.boundRegistryUpdate);
        window.addEventListener('floating-panel-focus', this.boundFloatingPanelFocus);
        window.addEventListener('panel-closed', this.boundFloatingPanelClosed);
        window.addEventListener('bus-routes-taskview-state', this.boundBusTaskviewState);
        console.log('[TASKBAR INIT] connectedCallback started at', Date.now());
        
        // Load template from external file and initialize after it's loaded
        this.loadTemplate().then(() => {
            // Wait for workspace to be ready before caching grid controls
            const workspace = this.closest('xavi-multi-grid');
            if (workspace && workspace.contentArea) {
                // Workspace already rendered
                this.initAfterWorkspace();
            } else {
                // Wait for workspace ready event
                this.addEventListener('taskbar-init-ready', () => this.initAfterWorkspace(), { once: true });
            }
        });
    }

    initAfterWorkspace() {
        this.cacheControls();
        this.startTaskbarClock();
        this.initDockingLayer();
        this.initWorkspaceManager();
        this.captureSpecialComponents();
        this.captureContainerWrapper();
        this.setupEventListeners();
        this.checkUserStatus().then(() => {
            this.restoreState();
            this.applyContainerMode();
            this.boundPointerMove = (event) => this.onPointerMove(event);
            this.boundOverlayGeometry = () => this.scheduleOverlayGeometryUpdate();
            this.render();
            this.autoRegisterDockables();
            this.notifyDockReady();
        });
    }

    async checkUserStatus() {
        if (this.userStatusChecked) return;
        const apiBase = String(window.XAVI_API_BASE || '').replace(/\/$/, '');
        try {
            const response = await fetch(apiBase + '/getUserStatus');
            const result = await response.json();
            if (result.success) {
                this.userIsAdmin = result.isAdmin || false;
                this.userIsLoggedIn = result.isLoggedIn || false;
                this.userStatusChecked = true;
                
                // Refresh start menu to show admin-only panels
                this.registryDirty = true;
                this.renderStartMenuItems();
                
                // Load user state from database if logged in
                if (this.userIsLoggedIn) {
                    await this.loadUserStateFromDB();
                }
            }
        } catch (err) {
            console.warn('Failed to check user status:', err);
            this.userIsAdmin = false;
            this.userIsLoggedIn = false;
            this.userStatusChecked = true;
        }
    }

    async saveUserStateToDB() {
        if (!this.userIsLoggedIn) return;
        const apiBase = String(window.XAVI_API_BASE || '').replace(/\/$/, '');
        
        try {
            // Gather all state from localStorage
            const state = {
                myVolume: localStorage.getItem('myVolume'),
                panelLayout: localStorage.getItem(this.stateKey),
                // Add other state keys as needed
            };
            
            const response = await fetch(apiBase + '/saveUserState', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: 'state=' + encodeURIComponent(JSON.stringify(state))
            });
            
            const result = await response.json();
            if (!result.success) {
                console.warn('Failed to save user state:', result.error);
            }
        } catch (err) {
            console.warn('Error saving user state to database:', err);
        }
    }

    async loadUserStateFromDB() {
        if (!this.userIsLoggedIn) return;
        const apiBase = String(window.XAVI_API_BASE || '').replace(/\/$/, '');
        
        try {
            const response = await fetch(apiBase + '/getUserState');
            const result = await response.json();
            
            if (result.success && result.state) {
                // Merge database state with localStorage (database takes precedence)
                if (result.state.myVolume) {
                    localStorage.setItem('myVolume', result.state.myVolume);
                }
                if (result.state.panelLayout) {
                    localStorage.setItem(this.stateKey, result.state.panelLayout);
                }
                // Add other state keys as needed
            }
        } catch (err) {
            console.warn('Error loading user state from database:', err);
        }
    }

    debouncedSaveToDBState() {
        // Debounce database saves to avoid excessive requests
        clearTimeout(this._dbSaveTimeout);
        this._dbSaveTimeout = setTimeout(() => {
            this.saveUserStateToDB();
        }, 1000); // Wait 1 second after last change
    }

    disconnectedCallback() {
        this.removeGlobalPointerListeners();
        this.releaseResizeObserver();
        this.hideDropIndicator();
        this.cleanupWorkspaceManager();
        if (this._taskbarClockInterval) {
            clearInterval(this._taskbarClockInterval);
            this._taskbarClockInterval = null;
        }
        document.removeEventListener('xavi-workspace-ready', this.boundWorkspaceReady);
        window.removeEventListener('xavi-panel-entry-registered', this.boundRegistryUpdate);
        window.removeEventListener('xavi-panel-entry-unregistered', this.boundRegistryUpdate);
        window.removeEventListener('xavi-panel-registry-ready', this.boundRegistryUpdate);
        window.removeEventListener('floating-panel-focus', this.boundFloatingPanelFocus);
        window.removeEventListener('panel-closed', this.boundFloatingPanelClosed);
        window.removeEventListener('bus-routes-taskview-state', this.boundBusTaskviewState);
        if (this.workspace?.unregisterModule) {
            this.workspace.unregisterModule('taskbar');
        }
        this.workspace = null;
    }

    registerWithWorkspace() {
        const workspace = this.closest('xavi-multi-grid');
        if (workspace && typeof workspace.registerModule === 'function') {
            workspace.registerModule('taskbar', this);
            this.workspace = workspace;
            return;
        }

        if (workspace) {
            this.workspace = workspace;
            workspace.dispatchEvent(new CustomEvent('register-workspace-module', {
                bubbles: true,
                composed: true,
                detail: { name: 'taskbar', module: this }
            }));
            return;
        }

        this.dispatchEvent(new CustomEvent('register-workspace-module', {
            bubbles: true,
            composed: true,
            detail: { name: 'taskbar', module: this }
        }));
    }

    onWorkspaceReady(event) {
        if (this.workspace) {
            // Trigger taskbar init if not already done
            this.dispatchEvent(new CustomEvent('taskbar-init-ready'));
            return;
        }
        const workspace = event.detail?.workspace;
        if (!workspace) {
            return;
        }
        if (workspace.contains(this) && typeof workspace.registerModule === 'function') {
            workspace.registerModule('taskbar', this);
            this.workspace = workspace;
            // Trigger taskbar init now that workspace is ready
            this.dispatchEvent(new CustomEvent('taskbar-init-ready'));
        }
    }

    setWorkspace(workspace) {
        this.workspace = workspace;
    }

    cacheControls() {
        this.panelButtonsContainer = this.shadowRoot.getElementById('panel-buttons');
        this.panelTabStrip = this.shadowRoot.getElementById('panel-tab-strip');
        this.taskviewGrid = this.shadowRoot.getElementById('taskview-grid');
        this.taskviewPopover = this.shadowRoot.getElementById('taskview-popover');
        this._taskviewPopoverOpenFor = null;
        this.taskbarClock = this.shadowRoot.getElementById('taskbar-clock');
        this.startMenuBtn = this.shadowRoot.getElementById('start-menu-btn');
        this.taskbarSettingsBtn = this.shadowRoot.getElementById('taskbar-settings-btn');
        this.startMenu = this.shadowRoot.getElementById('start-menu');
        this.startMenuSettingsBtn = this.shadowRoot.getElementById('start-menu-settings-btn');
        this.startMenuCloseBtn = this.shadowRoot.getElementById('start-menu-close-btn');
        this.startMenuSearch = this.shadowRoot.getElementById('start-menu-search');
        this.startMenuItems = this.shadowRoot.getElementById('start-menu-sections')
            || this.shadowRoot.getElementById('start-menu-items');
        this.calendarMenu = this.shadowRoot.getElementById('calendar-menu');
        this.busToggleBtn = this.shadowRoot.getElementById('bus-toggle-btn');
        this.videoDockContainer = this.shadowRoot.getElementById('video-dock-container');
        
        // Get grid elements from workspace shadow DOM
        if (this.workspace) {
            this.contentArea = this.workspace.getContentArea();
            this.tabSystem = this.contentArea?.parentElement; // .xavi-multi-grid
        }
        
        // Position menus above taskbar and set background height
        this.updateMenuPositions();
        
        // Music dock controls
        this.musicDockButton = this.shadowRoot.getElementById('music-dock-button');
        this.musicDockMenu = this.shadowRoot.getElementById('music-dock-menu');
        this.dockPlayIndicator = this.shadowRoot.getElementById('dock-play-indicator');
        this.videoDockTrackTitle = this.shadowRoot.getElementById('dock-track-title');
        this.dockTrackArtist = this.shadowRoot.getElementById('dock-track-artist');
        this.dockMenuTrackTitle = this.shadowRoot.getElementById('dock-menu-track-title');
        this.dockMenuTrackArtist = this.shadowRoot.getElementById('dock-menu-track-artist');
        this.dockTrackTime = this.shadowRoot.getElementById('dock-track-time');
        this.dockPlayPauseBtn = this.shadowRoot.getElementById('dock-play-pause-btn');
        this.dockPrevBtn = this.shadowRoot.getElementById('dock-prev-btn');
        this.dockNextBtn = this.shadowRoot.getElementById('dock-next-btn');
        this.dockVolumeControl = this.shadowRoot.getElementById('dock-volume-control');
        this.dockExpandBtn = this.shadowRoot.getElementById('dock-expand-btn');
        
        // Video dock controls
        this.videoPlayerDock = this.shadowRoot.getElementById('video-player-dock');
        this.videoDockTimeDisplay = this.shadowRoot.getElementById('video-dock-time-display');
        this.videoDockPrevButton = this.shadowRoot.getElementById('video-dock-prev-button');
        this.videoDockPlayPauseButton = this.shadowRoot.getElementById('video-dock-play-pause-button');
        this.videoDockNextButton = this.shadowRoot.getElementById('video-dock-next-button');
        this.videoDockVolumeControl = this.shadowRoot.getElementById('video-dock-volume-control');
        this.videoDockModeMenuButton = this.shadowRoot.getElementById('video-dock-mode-menu-button');
        this.videoDockCloseButton = this.shadowRoot.getElementById('video-dock-close-button');
        this.videoDockModeMenu = this.shadowRoot.getElementById('video-dock-mode-menu');
        this.videoDockMenuMini = this.shadowRoot.getElementById('video-dock-menu-mini');
        this.videoDockMenuExpanded = this.shadowRoot.getElementById('video-dock-menu-expanded');
        this.videoDockMenuGridLayer = this.shadowRoot.getElementById('video-dock-menu-grid-layer');
        this.videoDockTabText = this.shadowRoot.getElementById('video-dock-tab-text');
        this.videoDockTabTextDuplicate = this.shadowRoot.getElementById('video-dock-tab-text-duplicate');

        this.isMusicDocked = false;
        this.isVideoDocked = false;

        this.renderTaskviewGrid();
    }

    startTaskbarClock() {
        if (!this.taskbarClock) {
            return;
        }

        const update = () => {
            if (!this.taskbarClock) return;
            const now = new Date();
            const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const date = now.toLocaleDateString([], { month: 'short', day: 'numeric' });
            this.taskbarClock.textContent = `${date} ${time}`;
        };

        update();
        if (this._taskbarClockInterval) {
            clearInterval(this._taskbarClockInterval);
        }
        // Update periodically; no need to update every second.
        this._taskbarClockInterval = setInterval(update, 10000);
    }

    captureSpecialComponents() {
        const video = resolveVideoPlayerElement();
        if (video) {
            this.specialComponents['video-player'] = {
                element: video,
                homeParent: video.parentElement,
                homeNextSibling: video.nextSibling
            };
        } else {
            this.specialComponents['video-player'] = {
                element: null,
                homeParent: null,
                homeNextSibling: null
            };
            if (!this._videoProbeScheduled) {
                this._videoProbeScheduled = true;
                window.addEventListener('DOMContentLoaded', () => this.captureSpecialComponents(), { once: true });
            }
        }
    }

    initDockingLayer() {
        if (this.dockMiniLayer && this.dockMiniLayer.isConnected) {
            return;
        }
        let layer = document.getElementById('dock-mini-layer');
        if (!layer) {
            layer = document.createElement('div');
            layer.id = 'dock-mini-layer';
            layer.className = 'dock-mini-layer';
            document.body.appendChild(layer);
        }
        this.dockMiniLayer = layer;
        this.ensureDockStripVisibility();
    }

    initWorkspaceManager() {
        if (!window.sharedStateManager) {
            console.warn('[Taskbar] SharedStateManager not available, workspace manager disabled');
            return;
        }

        // Initialize BroadcastChannel for cross-tab communication
        if (!this.musicChannel) {
            try {
                this.musicChannel = new BroadcastChannel('music_player_control');
            } catch (err) {
                console.warn('[Taskbar] BroadcastChannel not available:', err);
            }
        }

        // Generate unique workspace ID
        this.workspaceId = `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.workspaceTabId = window.myTabId || `tab_${Date.now()}`;
        window.__bootWorkspaceId = this.workspaceId;
        try {
            sessionStorage.setItem('pgmusic.workspaceId', this.workspaceId);
        } catch (err) {
            /* sessionStorage might be unavailable (privacy mode) */
        }
        
        // Check if other workspaces exist
        const existingWorkspaces = window.sharedStateManager.get('workspaces') || [];
        const isFirstWorkspace = existingWorkspaces.length === 0;
        
        // Register this workspace
        window.sharedStateManager.addWorkspace(
            this.workspaceId,
            this.workspaceTabId,
            document.title || 'Prince George Music'
        );
        
        // If this is the first workspace, claim audio by default
        if (isFirstWorkspace) {
            console.log('[Taskbar] First workspace detected, auto-claiming audio');
            window.sharedStateManager.setAudioWorkspace(this.workspaceId);
        } else {
            console.log('[Taskbar] Joining as workspace', existingWorkspaces.length + 1, '- staying muted, audio stays with existing workspace');
        }
        
        // Setup heartbeat to show we're alive
        this.workspaceHeartbeatInterval = setInterval(() => {
            if (window.sharedStateManager) {
                window.sharedStateManager.updateWorkspaceHeartbeat(this.workspaceId);
            }
        }, 5000); // Heartbeat every 5 seconds
        
        // Cleanup dead workspaces periodically
        this.workspaceCleanupInterval = setInterval(() => {
            if (window.sharedStateManager) {
                window.sharedStateManager.cleanupDeadWorkspaces();
            }
        }, 15000); // Cleanup every 15 seconds
        
        // Poll localStorage for workspace changes every 3 seconds
        this.workspaceSyncInterval = setInterval(() => {
            this.syncWorkspacesFromStorage();
        }, 3000); // Sync every 3 seconds
        
        // Subscribe to workspace changes
        if (window.sharedStateManager.subscribe) {
            this.workspaceSubscription = window.sharedStateManager.subscribe((newState, oldState, source) => {
                if (newState.workspaces !== oldState?.workspaces || 
                    newState.audioWorkspaceId !== oldState?.audioWorkspaceId ||
                    newState.isPlaying !== oldState?.isPlaying) {
                    this.renderWorkspaces();
                }
            });
        }
        
        // Track user activity
        this.setupActivityTracking();
        
        // Render initial workspaces
        this.renderWorkspaces();
        
        // Setup event listeners
        const workspaceAddBtn = this.shadowRoot.getElementById('workspace-add-btn');
        if (workspaceAddBtn) {
            workspaceAddBtn.addEventListener('click', () => this.addNewWorkspace());
        }
        const busToggleBtn = this.shadowRoot.getElementById('bus-toggle-btn');
        if (busToggleBtn) {
            busToggleBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                if (window.BusMenu && typeof window.BusMenu.togglePopup === 'function') {
                    window.BusMenu.togglePopup();
                } else {
                    console.warn('[Taskbar] BusMenu not ready yet');
                }
            });
        }
        
        // Cleanup on unload
        if (this.workspaceStorageListener) {
            window.removeEventListener('storage', this.workspaceStorageListener);
        }
        this.workspaceStorageListener = (event) => {
            if (event.key === window.sharedStateManager.stateKey) {
                this.syncWorkspacesFromStorage(true);
            }
        };
        window.addEventListener('storage', this.workspaceStorageListener);

        if (this.boundBeforeUnload) {
            window.removeEventListener('beforeunload', this.boundBeforeUnload);
        }
        this.boundBeforeUnload = () => {
            if (window.sharedStateManager) {
                window.sharedStateManager.removeWorkspace(this.workspaceId);
            }
            this.cleanupWorkspaceManager();
        };
        window.addEventListener('beforeunload', this.boundBeforeUnload);
        
        console.log('[Taskbar] Workspace manager initialized:', this.workspaceId);
    }

    cleanupWorkspaceManager() {
        if (this.workspaceHeartbeatInterval) {
            clearInterval(this.workspaceHeartbeatInterval);
            this.workspaceHeartbeatInterval = null;
        }
        if (this.workspaceCleanupInterval) {
            clearInterval(this.workspaceCleanupInterval);
            this.workspaceCleanupInterval = null;
        }
        if (this.workspaceSyncInterval) {
            clearInterval(this.workspaceSyncInterval);
            this.workspaceSyncInterval = null;
        }
        if (this.workspaceSubscription) {
            try {
                this.workspaceSubscription();
            } catch (err) {
                console.warn('[Taskbar] Failed to unsubscribe workspace listener:', err);
            }
            this.workspaceSubscription = null;
        }
        if (this.workspaceStorageListener) {
            window.removeEventListener('storage', this.workspaceStorageListener);
            this.workspaceStorageListener = null;
        }
        if (this.boundBeforeUnload) {
            window.removeEventListener('beforeunload', this.boundBeforeUnload);
            this.boundBeforeUnload = null;
        }
    }

    syncWorkspacesFromStorage(forceRender = false) {
        // Poll localStorage directly to catch changes from other windows
        // This is more reliable than BroadcastChannel for cross-window communication
        if (!window.sharedStateManager) return;
        
        try {
            const stateKey = window.sharedStateManager.stateKey || 'pgmusic.sharedState';
            const stateJson = localStorage.getItem(stateKey);
            if (!stateJson) return;
            
            const state = JSON.parse(stateJson);
            const timestamp = typeof state.timestamp === 'number' ? state.timestamp : Date.now();
            if (!forceRender && timestamp === this.lastSharedStateTimestamp) {
                return;
            }

            this.lastSharedStateTimestamp = timestamp;
            window.sharedStateManager.localState = state;
            this.renderWorkspaces();
            
        } catch (err) {
            console.warn('[Taskbar] Error syncing workspaces from storage:', err);
        }
    }

    setupActivityTracking() {
        // Track user interactions to update lastActive
        const activityEvents = ['mousedown', 'keydown', 'touchstart', 'scroll'];
        
        const updateActivity = () => {
            if (window.sharedStateManager && this.workspaceId) {
                window.sharedStateManager.updateWorkspaceActivity(this.workspaceId);
            }
        };
        
        activityEvents.forEach(event => {
            window.addEventListener(event, updateActivity, { passive: true });
        });
    }

    renderWorkspaces() {
        const container = this.shadowRoot.getElementById('workspace-items');
        if (!container || !window.sharedStateManager) return;
        
        const workspaces = window.sharedStateManager.getWorkspaces() || [];
        const audioWorkspaceId = window.sharedStateManager.get('audioWorkspaceId');
        const isPlaying = window.sharedStateManager.get('isPlaying');
        const now = Date.now();
        const heartbeatTimeout = 5000; // 5 seconds
        
        container.innerHTML = '';
        
        workspaces.forEach((workspace, index) => {
            const item = document.createElement('div');
            item.className = 'workspace-item';
            item.dataset.workspaceId = workspace.id;
            
            // Add current indicator
            if (workspace.id === this.workspaceId) {
                item.classList.add('current');
            }
            
            // Add audio indicator
            const hasAudio = workspace.id === audioWorkspaceId;
            if (hasAudio) {
                item.classList.add('has-audio');
            }
            
            // Add active indicator for workspaces responding to heartbeat
            const lastHeartbeat = workspace.lastHeartbeat || workspace.timestamp || 0;
            const isActive = (now - lastHeartbeat) < heartbeatTimeout;
            if (isActive) {
                item.classList.add('active');
            }
            
            // Workspace icon (number)
            const icon = document.createElement('span');
            icon.className = 'workspace-icon';
            icon.textContent = (index + 1).toString();
            item.appendChild(icon);
            
            // Audio control button (speaker icon) - BOTTOM RIGHT
            const audioBtn = document.createElement('button');
            audioBtn.className = 'workspace-audio-btn';
            audioBtn.title = hasAudio ? 'Audio active (click to mute)' : 'Click to activate audio';
            
            // Use emoji speaker icons
            if (hasAudio) {
                audioBtn.textContent = '🔊';
                audioBtn.classList.add('active');
            } else {
                audioBtn.textContent = '🔇';
            }
            
            audioBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setWorkspaceAudio(workspace.id);
            });
            item.appendChild(audioBtn);
            
            // Close button (not for current workspace) - TOP LEFT
            if (workspace.id !== this.workspaceId) {
                const closeBtn = document.createElement('button');
                closeBtn.className = 'workspace-close-btn';
                closeBtn.title = 'Close workspace';
                closeBtn.textContent = '×';
                closeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.closeWorkspace(workspace.id);
                });
                item.appendChild(closeBtn);
            }
            
            // Click workspace to focus (informational only)
            item.addEventListener('click', () => {
                if (workspace.id === this.workspaceId) {
                    console.log('[Taskbar] Already in this workspace');
                } else {
                    console.log('[Taskbar] Workspace', index + 1, '- cannot switch between windows');
                }
            });
            
            container.appendChild(item);
        });
    }

    addNewWorkspace() {
        const windowName = `_blank`;

        // Always spawn the next workspace on the same origin so it can access the
        // shared localStorage/BroadcastChannel state. Hard-coding a domain here
        // breaks registration whenever pgmusic runs on dev mirrors or alternate
        // hostnames (the new window ends up on a different origin and never
        // shares workspace state back to this taskbar).
        let targetUrl = window.location.href;
        try {
            const currentUrl = new URL(window.location.href);
            currentUrl.hash = '';
            targetUrl = currentUrl.toString();
        } catch (err) {
            const origin = window.location.origin || '';
            const path = window.location.pathname || '/pgmusic';
            const search = window.location.search || '';
            targetUrl = `${origin}${path}${search}` || '/pgmusic';
        }

        // Open directly to the target URL without window features so browsers treat it as a 
        // normal window request rather than a popup (no third parameter = no feature restrictions)
        const newWindow = window.open(targetUrl, windowName);

        if (!newWindow) {
            console.error('[Taskbar] Failed to open new workspace - popup blocked?');
            alert('Failed to open new workspace. Please allow popups for this site.');
            return;
        }

        // Try to position/resize the window after a short delay to let it fully spawn
        setTimeout(() => {
            this.positionWorkspaceWindow(newWindow);
        }, 100);

        console.log('[Taskbar] Opened new workspace window');
    }

    async positionWorkspaceWindow(workspaceWindow) {
        if (!workspaceWindow) return;
        if (workspaceWindow.closed) return;

        try {
            const placement = await this.getPreferredScreenPlacement();
            if (!workspaceWindow || workspaceWindow.closed) {
                return;
            }
            if (!placement) {
                workspaceWindow.focus();
                return;
            }

            const { left, top, width, height } = placement;
            if (typeof workspaceWindow.moveTo === 'function') {
                workspaceWindow.moveTo(left, top);
            }
            if (typeof workspaceWindow.resizeTo === 'function') {
                workspaceWindow.resizeTo(width, height);
            }
            workspaceWindow.focus();
        } catch (err) {
            console.warn('[Taskbar] Unable to reposition workspace window:', err);
            workspaceWindow.focus();
        }
    }

    async getPreferredScreenPlacement() {
        const details = await this.getScreenDetailsSafe();
        if (details) {
            const targetScreen = this.pickScreenForWorkspace(details);
            if (targetScreen) {
                return targetScreen;
            }
        }
        return this.getFallbackPlacement();
    }

    async getScreenDetailsSafe() {
        if (typeof window.getScreenDetails !== 'function') {
            return null;
        }

        if (this.screenDetails) {
            return this.screenDetails;
        }

        try {
            this.screenDetails = await window.getScreenDetails();
            const resetOffsets = () => {
                this.nextScreenIndex = 0;
            };
            this.screenDetails.addEventListener('currentscreenchange', resetOffsets);
            this.screenDetails.addEventListener('screenschange', resetOffsets);
            return this.screenDetails;
        } catch (err) {
            console.warn('[Taskbar] Multi-screen window placement unavailable:', err);
            this.screenDetails = null;
            return null;
        }
    }

    pickScreenForWorkspace(details) {
        if (!details) return null;
        const screens = Array.from(details.screens || []);
        if (!screens.length) {
            return null;
        }

        const current = details.currentScreen || screens[0];
        const alternateScreens = screens.filter((screen) => screen !== current);
        let target = current;

        if (alternateScreens.length) {
            target = alternateScreens[this.nextScreenIndex % alternateScreens.length] || alternateScreens[0];
            this.nextScreenIndex = (this.nextScreenIndex + 1) % alternateScreens.length;
        }

        const availWidth = target.availWidth || target.width || 1400;
        const availHeight = target.availHeight || target.height || 900;
        const width = Math.min(availWidth, 1600);
        const height = Math.min(availHeight, 1000);
        const baseLeft = target.availLeft ?? target.left ?? 0;
        const baseTop = target.availTop ?? target.top ?? 0;
        const left = Math.round(baseLeft + Math.max(0, (availWidth - width) / 2));
        const top = Math.round(baseTop + Math.max(0, (availHeight - height) / 2));

        return { left, top, width, height };
    }

    getFallbackPlacement() {
        const baseLeft = window.screenX || window.screenLeft || 0;
        const baseTop = window.screenY || window.screenTop || 0;
        const width = Math.min(window.outerWidth || 1400, 1600);
        const height = Math.min(window.outerHeight || 900, 1000);
        const stagger = (this.workspaceLaunchCount % 5) * 48;
        this.workspaceLaunchCount += 1;

        return {
            left: Math.round(baseLeft + 60 + stagger),
            top: Math.round(baseTop + 60 + stagger),
            width,
            height
        };
    }

    setWorkspaceAudio(workspaceId) {
        if (!window.sharedStateManager) return;
        
        const workspace = window.sharedStateManager.getWorkspaces().find(w => w.id === workspaceId);
        if (!workspace) {
            console.warn('[Taskbar] Workspace not found:', workspaceId);
            return;
        }
        
        // Set this workspace as audio output
        window.sharedStateManager.setAudioWorkspace(workspaceId);
        
        // Also update musicAudioOwner for music-player compatibility
        localStorage.setItem('musicAudioOwner', workspace.tabId);
        localStorage.setItem('musicAudioOwnerTimestamp', Date.now().toString());
        
        // Broadcast to all tabs
        if (this.musicChannel) {
            this.musicChannel.postMessage({
                action: 'claim_audio',
                tabId: workspace.tabId,
                workspaceId: workspaceId,
                timestamp: Date.now()
            });
        }
        
        console.log('[Taskbar] Set audio workspace:', workspaceId);
    }

    closeWorkspace(workspaceId) {
        if (!window.sharedStateManager) return;
        
        // Remove from state
        window.sharedStateManager.removeWorkspace(workspaceId);
        
        // Broadcast close message
        if (this.musicChannel) {
            this.musicChannel.postMessage({
                action: 'close_workspace',
                workspaceId: workspaceId,
                timestamp: Date.now()
            });
        }
        
        console.log('[Taskbar] Closed workspace:', workspaceId);
    }

    autoRegisterDockables() {
        // Legacy players manage their own docking, so no auto-registration needed.
    }

    notifyDockReady() {
        if (this._dockReadyNotified) return;
        this._dockReadyNotified = true;
        window.__panelTaskbar = this;
        window.__panelTaskbarReady = true;
        window.registerDockableComponent = (id, element, options) => this.registerDockable(id, element, options);
        window.requestDockMode = (id, mode) => this.setDockModeById(id, mode);
        window.dispatchEvent(new CustomEvent('panel-taskbar-ready', { detail: { taskbar: this } }));
    }

    resolvePlaylistOverlayNodes() {
        let overlay = document.getElementById(SETTINGS_OVERLAY_ID) || document.getElementById(LEGACY_PLAYLIST_OVERLAY_ID);
        const workspace = this.workspace || document.querySelector('xavi-multi-grid');
        if (!overlay && workspace?.shadowRoot) {
            overlay = workspace.shadowRoot.getElementById(SETTINGS_OVERLAY_ID) || workspace.shadowRoot.getElementById(LEGACY_PLAYLIST_OVERLAY_ID);
        }

        let toggleTab = document.getElementById(SETTINGS_TOGGLE_ID) || document.getElementById(LEGACY_PLAYLIST_TOGGLE_ID);
        if ((!toggleTab || (overlay && !overlay.contains(toggleTab))) && overlay) {
            toggleTab = overlay.querySelector(`#${SETTINGS_TOGGLE_ID}, .settings-toggle-tab, #${LEGACY_PLAYLIST_TOGGLE_ID}, .playlist-toggle-tab`);
        }

        if (!overlay || !toggleTab) {
            const cached = window.__settingsOverlayRefs || window.__playlistOverlayRefs;
            if (!overlay && cached?.overlay) {
                overlay = cached.overlay;
            }
            if (!toggleTab && cached?.toggleTab) {
                toggleTab = cached.toggleTab;
            }
        }

        return { overlay: overlay || null, toggleTab: toggleTab || null };
    }

    handlePlaylistOverlayAttached(event) {
        if (!this.overlaysEnabled) {
            return;
        }
        const overlay = event?.detail?.overlay || null;
        const toggleTab = event?.detail?.toggleTab || overlay?.querySelector(`#${SETTINGS_TOGGLE_ID}, .settings-toggle-tab, #${LEGACY_PLAYLIST_TOGGLE_ID}, .playlist-toggle-tab`);
        if (!overlay) {
            return;
        }
        this.specialComponents['playlist-viewer'].overlay = overlay;
        if (toggleTab) {
            this.specialComponents['playlist-viewer'].toggleTab = toggleTab;
        }
        this.setupPlaylistOverlay();
    }

    focusPlaylistOverlay() {
        const overlay = this.specialComponents['playlist-viewer']?.overlay;
        if (!overlay) {
            return;
        }
        if (!this.specialComponents['playlist-viewer'].isOpen) {
            this.openPlaylistOverlay();
        }
        overlay.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        if (overlay.dataset.mode === 'settings') {
            const activeTab =
                overlay.querySelector('.xavi-settings__tab[aria-selected="true"]') ||
                overlay.querySelector('.xavi-settings__tab');
            if (activeTab && typeof activeTab.focus === 'function') {
                activeTab.focus();
                return;
            }
            const fallback = overlay.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
            if (fallback && typeof fallback.focus === 'function') {
                fallback.focus();
            }
            return;
        }

        const viewer = overlay.querySelector('playlist-viewer');
        if (viewer && typeof viewer.focus === 'function') {
            viewer.focus();
        }
    }

    registerPlaylistTaskviewEntry(setActive = true) {
        // Intentionally disabled: the Settings overlay should not show up in the unified
        // task strip / open applications area. It is controlled via the taskbar corner toggle.
        const state = this.specialComponents['playlist-viewer'];
        if (state) state.isMinimized = false;
        // Ensure any legacy entry is removed.
        this.unregisterPlaylistTaskviewEntry();
        void setActive;
    }

    unregisterPlaylistTaskviewEntry() {
        this.unregisterTaskviewEntry(this.playlistTaskviewInstanceId);
    }

    applyPlaylistOverlayWidthPreset(preset) {
        if (!this.overlaysEnabled) {
            return;
        }
        const overlay = this.specialComponents['playlist-viewer']?.overlay;
        if (!overlay) {
            return;
        }
        if (!this.specialComponents['playlist-viewer'].isOpen) {
            this.openPlaylistOverlay();
        }

        const containerEl = document.getElementById('xavi-grid-container');
        const containerRect = containerEl?.getBoundingClientRect();
        const bounds = this.getOverlayWidthBounds(containerRect);
        const containerWidth = containerRect?.width || containerEl?.clientWidth || window.innerWidth || bounds.max;
        const clampWidth = (value) => Math.min(Math.max(value, bounds.min), bounds.max);
        const thirdWidth = containerWidth / 3; // desktop presets divide available width into thirds
        let target = bounds.defaultWidth;
        if (preset === 'peek') {
            target = clampWidth(Math.round(thirdWidth));
        } else if (preset === 'medium') {
            target = clampWidth(Math.round(thirdWidth * 2));
        } else if (preset === 'wide') {
            target = clampWidth(Math.round(containerWidth));
        }
        this.overlayWidth = target;
        overlay.style.setProperty('--xavi-settings-overlay-width', `${Math.round(target)}px`);
        this.alignPlaylistToggle();
        this.persistOverlayWidth();
        this.updatePlaylistOverlayGeometry();
    }

    minimizePlaylistOverlay() {
        if (!this.overlaysEnabled) {
            return;
        }
        const state = this.specialComponents['playlist-viewer'];
        const overlay = state?.overlay;
        if (!overlay) {
            return;
        }
        const currentWidth = this.overlayWidth || overlay.getBoundingClientRect().width;
        if (Number.isFinite(currentWidth)) {
            state.lastWidthBeforeMinimize = currentWidth;
        }
        state.isMinimized = true;
        this.closePlaylistOverlay({ retainTaskview: true, persistState: false });
    }

    restorePlaylistOverlayFromMinimize() {
        if (!this.overlaysEnabled) {
            return;
        }
        const state = this.specialComponents['playlist-viewer'];
        if (!state) {
            return;
        }
        const targetWidth = state.lastWidthBeforeMinimize;
        this.openPlaylistOverlay();
        if (Number.isFinite(targetWidth)) {
            this.overlayWidth = targetWidth;
            const overlay = state.overlay;
            if (overlay) {
                overlay.style.setProperty('--xavi-settings-overlay-width', `${Math.round(targetWidth)}px`);
            }
            this.persistOverlayWidth();
        }
        state.isMinimized = false;
    }

    normalizeSettingsOverlay(overlay) {
        if (!overlay || overlay.dataset?.mode !== 'settings') {
            return;
        }

        // If the legacy tab-overlay module already injected a header/body, remove it.
        overlay.classList.remove('tab-overlay');

        const header = overlay.querySelector('.tab-overlay-header');
        if (header) {
            header.remove();
        }

        const body = overlay.querySelector('.tab-overlay-body');
        if (body) {
            const content = body.querySelector('.settings-overlay-content');
            const resizeHandle = overlay.querySelector('.settings-resize-handle');
            if (content && content.parentElement === body) {
                if (resizeHandle) {
                    overlay.insertBefore(content, resizeHandle);
                } else {
                    overlay.appendChild(content);
                }
            }
            body.remove();
        }
    }

    setupPlaylistOverlay() {
        if (!this.overlaysEnabled) {
            return;
        }
        const initialize = () => {
            let { overlay, toggleTab } = this.resolvePlaylistOverlayNodes();

            if (!overlay || !toggleTab) {
                console.warn('Settings overlay nodes missing from DOM. Creating fallback overlay.');
                const created = this.createPlaylistOverlayElements();
                overlay = created.overlay;
                toggleTab = created.toggleTab;
            }

            if (!overlay || !toggleTab) {
                console.error('Failed to initialize settings overlay elements.');
                return;
            }

            this.normalizeSettingsOverlay(overlay);

            this.specialComponents['playlist-viewer'].overlay = overlay;
            this.specialComponents['playlist-viewer'].toggleTab = toggleTab;
            this.bindPlaylistOverlayListeners();
            this.attachOverlayResizeHandle();
            this.applyOverlayWidth();

            if (!toggleTab.dataset.bound) {
                toggleTab.addEventListener('click', () => {
                    console.log('Settings toggle tab clicked');
                    this.togglePlaylistOverlay();
                });
                toggleTab.dataset.bound = 'true';
            }

            const safeGet = (key) => {
                try {
                    return localStorage.getItem(key);
                } catch (e) {
                    return null;
                }
            };

            const savedState = safeGet(SETTINGS_STORAGE.overlayState) || safeGet(LEGACY_STORAGE.overlayState);
            if (savedState === 'closed') {
                this.closePlaylistOverlay();
            } else {
                this.openPlaylistOverlay();
            }

            this.updatePlaylistOverlayUI();
            console.log('Settings overlay setup complete.');
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initialize, { once: true });
        } else {
            initialize();
        }
    }

    createPlaylistOverlayElements() {
        const overlay = document.createElement('div');
        overlay.id = SETTINGS_OVERLAY_ID;
        overlay.className = 'settings-overlay';

        // Repurposed: this slide-out overlay is Settings-only.
        overlay.dataset.mode = 'settings';

        const content = document.createElement('div');
        content.className = 'settings-overlay-content';

        // Settings UI (no playlist DOM / no #playlist-scroll / no #playlist-tabs)
        const settingsRoot = document.createElement('div');
        settingsRoot.className = 'xavi-settings';
        settingsRoot.innerHTML = `
            <div class="xavi-settings__header" role="tablist" aria-label="Settings">
                <button type="button" class="xavi-settings__tab" data-tab="appview" role="tab" aria-selected="false">AppView</button>
                <button type="button" class="xavi-settings__tab" data-tab="social" role="tab" aria-selected="false">Social</button>
                <button type="button" class="xavi-settings__tab" data-tab="concrete" role="tab" aria-selected="false">Concrete</button>
            </div>
            <div class="xavi-settings__body">
                <div class="xavi-settings__panel" data-panel="appview" role="tabpanel">
                    <div class="xavi-settings__section-title">AppView</div>
                    <div class="xavi-settings__hint">AppView settings will go here.</div>
                </div>
                <div class="xavi-settings__panel" data-panel="social" role="tabpanel">
                    <div class="xavi-settings__section-title">Social</div>
                    <div class="xavi-settings__row" role="group" aria-label="Theme">
                        <div class="xavi-settings__label">Theme</div>
                        <div class="xavi-settings__choices">
                            <label class="xavi-settings__choice">
                                <input type="radio" name="xavi-theme" value="system" class="xavi-settings__radio" />
                                <span>System</span>
                            </label>
                            <label class="xavi-settings__choice">
                                <input type="radio" name="xavi-theme" value="dark" class="xavi-settings__radio" />
                                <span>Dark</span>
                            </label>
                            <label class="xavi-settings__choice">
                                <input type="radio" name="xavi-theme" value="light" class="xavi-settings__radio" />
                                <span>Light</span>
                            </label>
                        </div>
                    </div>
                    <div class="xavi-settings__hint">Choose how the Social panel adapts to its host site.</div>
                    <label class="xavi-settings__row">
                        <input type="checkbox" class="xavi-settings__checkbox" data-setting="xaviSocial.profileSettingsInSettings" />
                        <span>Profile settings live in Settings panel</span>
                    </label>
                    <div class="xavi-settings__hint">(Toggle now; options can be added later.)</div>
                </div>
                <div class="xavi-settings__panel" data-panel="concrete" role="tabpanel">
                    <div class="xavi-settings__section-title">ConcreteCMS</div>
                    <div class="xavi-settings__hint">ConcreteCMS settings can be added here later.</div>
                </div>
            </div>
        `;
        content.appendChild(settingsRoot);

        // Persist/restore active tab + toggles.
        const storageKeyTab = 'xavi.settings.activeTab';
        const tabs = Array.from(settingsRoot.querySelectorAll('.xavi-settings__tab'));
        const panels = Array.from(settingsRoot.querySelectorAll('.xavi-settings__panel'));
        const selectTab = (tabId) => {
            const id = String(tabId || '').trim() || 'social';
            tabs.forEach((btn) => {
                const active = String(btn.dataset.tab || '') === id;
                btn.classList.toggle('is-active', active);
                btn.setAttribute('aria-selected', active ? 'true' : 'false');
            });
            panels.forEach((panel) => {
                const show = String(panel.dataset.panel || '') === id;
                panel.style.display = show ? 'block' : 'none';
            });
            try {
                localStorage.setItem(storageKeyTab, id);
            } catch (e) {
                // ignore
            }
        };

        settingsRoot.addEventListener('click', (e) => {
            const btn = e.target?.closest?.('.xavi-settings__tab');
            if (!btn) return;
            selectTab(btn.dataset.tab);
        });

        const checkboxEls = Array.from(settingsRoot.querySelectorAll('input.xavi-settings__checkbox[data-setting]'));
        checkboxEls.forEach((cb) => {
            const key = String(cb.dataset.setting || '').trim();
            if (!key) return;
            try {
                cb.checked = localStorage.getItem(key) === '1';
            } catch (e) {
                cb.checked = false;
            }
            cb.addEventListener('change', () => {
                try {
                    localStorage.setItem(key, cb.checked ? '1' : '0');
                } catch (e) {
                    // ignore
                }
            });
        });

        const themeRadios = Array.from(settingsRoot.querySelectorAll('input[name="xavi-theme"]'));
        const validThemes = ['system', 'dark', 'light'];
        const readThemePref = () => {
            try {
                const stored = (localStorage.getItem('xavi.theme') || '').toLowerCase();
                if (validThemes.includes(stored)) {
                    return stored;
                }
            } catch (e) {
                // ignore
            }
            return 'system';
        };
        const syncThemeRadios = (value) => {
            const target = validThemes.includes(value) ? value : 'system';
            themeRadios.forEach((radio) => {
                radio.checked = String(radio.value || '').toLowerCase() === target;
            });
        };
        syncThemeRadios(readThemePref());

        themeRadios.forEach((radio) => {
            radio.addEventListener('change', () => {
                const raw = (radio.value || '').toLowerCase();
                const next = validThemes.includes(raw) ? raw : 'system';
                try {
                    localStorage.setItem('xavi.theme', next);
                } catch (e) {
                    // ignore
                }
                syncThemeRadios(next);
                window.dispatchEvent(new CustomEvent('xavi:theme-change', { detail: { theme: next } }));
            });
        });

        let initial = 'social';
        try {
            initial = localStorage.getItem(storageKeyTab) || initial;
        } catch (e) {
            // ignore
        }
        selectTab(initial);
        overlay.appendChild(content);
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'settings-resize-handle';
        resizeHandle.setAttribute('aria-hidden', 'true');
        overlay.appendChild(resizeHandle);

        const toggleTab = document.createElement('button');
        toggleTab.id = SETTINGS_TOGGLE_ID;
        toggleTab.className = 'settings-toggle-tab';
        toggleTab.title = 'Toggle Settings';
        const arrow = document.createElement('span');
        arrow.className = 'arrow';
        arrow.textContent = '▶';
        toggleTab.appendChild(arrow);
        overlay.appendChild(toggleTab);

        const container = document.getElementById('xavi-grid-container');
        const workspace = this.workspace || document.querySelector('xavi-multi-grid');
        if (workspace?.attachFloatingPanel) {
            workspace.attachFloatingPanel(overlay);
            overlay.dataset.floatingLayer = 'true';
        } else if (container) {
            container.appendChild(overlay);
        } else {
            document.body.appendChild(overlay);
        }

        return { overlay, toggleTab };
    }

    bindPlaylistOverlayListeners() {
        if (this.overlayListenersBound) {
            return;
        }

        window.addEventListener('resize', this.boundOverlayGeometry);
        window.addEventListener('scroll', this.boundOverlayGeometry, true);
        this.overlayListenersBound = true;
    }

    unbindPlaylistOverlayListeners() {
        if (!this.overlayListenersBound) {
            return;
        }

        window.removeEventListener('resize', this.boundOverlayGeometry);
        window.removeEventListener('scroll', this.boundOverlayGeometry, true);
        this.overlayListenersBound = false;
        this.detachOverlayResizeHandle();
    }

    shouldRunOverlayGeometry() {
        const state = this.specialComponents['playlist-viewer'];
        if (!state || !state.overlay) {
            return false;
        }
        if (!state.isOpen || !state.overlay.classList.contains('open')) {
            return false;
        }
        if (!document.body.contains(state.overlay)) {
            return false;
        }
        return true;
    }

    cancelOverlayGeometryWork() {
        this.overlayGeometryScheduled = false;
        if (this.overlayGeometryDelayHandle) {
            clearTimeout(this.overlayGeometryDelayHandle);
            this.overlayGeometryDelayHandle = null;
        }
    }

    scheduleOverlayGeometryUpdate() {
        if (!this.overlaysEnabled) {
            return;
        }
        if (!this.shouldRunOverlayGeometry()) {
            return;
        }
        if (this.overlayGeometryScheduled || this.overlayGeometryDelayHandle) {
            return;
        }
        this.overlayGeometryScheduled = true;
        const run = () => {
            this.overlayGeometryScheduled = false;
            if (!this.shouldRunOverlayGeometry()) {
                return;
            }
            const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
                ? performance.now()
                : Date.now();
            const elapsed = now - this.overlayGeometryLastUpdate;
            if (elapsed < this.overlayGeometryMinInterval) {
                const wait = Math.max(16, this.overlayGeometryMinInterval - elapsed);
                this.overlayGeometryDelayHandle = setTimeout(() => {
                    this.overlayGeometryDelayHandle = null;
                    this.scheduleOverlayGeometryUpdate();
                }, wait);
                return;
            }
            this.overlayGeometryLastUpdate = now;
            this.updatePlaylistOverlayGeometry();
        };
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(run);
        } else {
            setTimeout(run, 16);
        }
    }

    updatePlaylistOverlayGeometry() {
        if (!this.overlaysEnabled) {
            return;
        }
        if (!this.shouldRunOverlayGeometry()) {
            return;
        }
        const overlay = this.specialComponents['playlist-viewer']?.overlay;
        if (!overlay) {
            return;
        }

        const container = document.getElementById('xavi-grid-container');
        if (!container) {
            return;
        }

        const containerRect = container.getBoundingClientRect();
        const taskbar = this.shadowRoot?.querySelector('.taskbar');
        const taskbarRect = taskbar?.getBoundingClientRect();
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

        // Playlist overlay is positioned at container top-left (0, 0 relative to container)
        // No need to set top/left as they're hardcoded to 0 in CSS
        
        // Height: from container top to taskbar top
        let bottomLimit = viewportHeight;
        if (taskbarRect) {
            const taskbarTop = Math.round(taskbarRect.top);
            const containerTop = Math.round(containerRect.top);
            if (taskbarTop > containerTop) {
                bottomLimit = taskbarTop;
            }
        }

        const containerTop = Math.round(containerRect.top);
        let overlayHeight = bottomLimit - containerTop;
        
        // Account for container padding (8px top) and gap (8px) = 16px, but reduce by 8px for better fit
        const containerPadding = 8;
        overlayHeight = Math.max(overlayHeight - containerPadding, 0);
        
        if (!Number.isFinite(overlayHeight) || overlayHeight <= 0) {
            console.warn('[overlayGeometry] invalid height', {
                overlayHeight,
                containerTop,
                bottomLimit,
                viewportHeight,
                containerRect: {
                    top: containerRect.top,
                    bottom: containerRect.bottom,
                    height: containerRect.height
                }
            });
            overlayHeight = Math.max(280, containerRect.height - containerPadding);
        }

        const roundedHeight = Math.round(overlayHeight);
        overlay.style.setProperty('--xavi-settings-overlay-height', `${roundedHeight}px`);
        
        // Only set background height if playlist overlay is actually open
        if (this.specialComponents?.['playlist-viewer']?.isOpen) {
            this.setBackgroundHeight(roundedHeight);
        }
        
        this.applyOverlayWidth(containerRect);

        // Toggle tab positioning is now handled by updatePlaylistTogglePosition
    }

    togglePlaylistOverlay() {
        console.warn('[Taskbar] Playlist overlay is disabled in xavi_social.');
    }

    openPlaylistOverlay() {
        console.warn('[Taskbar] Playlist overlay is disabled in xavi_social.');
        return;
        const state = this.specialComponents['playlist-viewer'];
        const overlay = state.overlay;
        if (!overlay) {
            console.error('Cannot open: overlay element is null');
            return;
        }

        if (state.isOpen) {
            return;
        }

        state.isOpen = true;
        state.isMinimized = false;
        try {
            localStorage.setItem(SETTINGS_STORAGE.overlayState, 'open');
        } catch (e) {
            // ignore
        }
        
        const arrow = state.toggleTab?.querySelector('.arrow');
        if (arrow) arrow.textContent = '◀';
        state.toggleTab?.classList.add('open');
        
        overlay.classList.add('open');
        this.cancelOverlayGeometryWork();
        this.overlayGeometryLastUpdate = 0;
        this.updatePlaylistOverlayGeometry();
        this.unregisterPlaylistTaskviewEntry();

        const playlistButtons = this.shadowRoot.querySelectorAll('.panel-tab-btn[data-panel-id="playlist-viewer"]');
        playlistButtons.forEach((btn) => btn.classList.add('active'));

        // Taskbar height changes when docked player appears, update grid metrics
        requestAnimationFrame(() => {
            this.requestGridMetricsUpdate(true);
            console.log('Overlay open. Computed left:', window.getComputedStyle(overlay).left);
        });
    }

    closePlaylistOverlay(options = {}) {
        console.warn('[Taskbar] Playlist overlay is disabled in xavi_social.');
        return;
        const { retainTaskview = false, persistState = true } = options;
        const state = this.specialComponents['playlist-viewer'];
        const overlay = state?.overlay;
        if (!overlay) {
            console.error('Cannot close: overlay element is null');
            return;
        }

        if (!state.isOpen) {
            this.unregisterPlaylistTaskviewEntry();
            state.isMinimized = retainTaskview ? true : false;
            return;
        }

        state.isOpen = false;
        state.isMinimized = retainTaskview;
        if (persistState) {
            try {
                localStorage.setItem(SETTINGS_STORAGE.overlayState, 'closed');
            } catch (e) {
                // ignore
            }
        }

        const arrow = state.toggleTab?.querySelector('.arrow');
        if (arrow) arrow.textContent = '▶';
        state.toggleTab?.classList.remove('open');

        overlay.classList.remove('open');
        this.cancelOverlayGeometryWork();
        this.updatePlaylistOverlayGeometry();

        // Never show playlist viewer in task strip; always remove any legacy entry.
        this.unregisterPlaylistTaskviewEntry();
        const playlistButtons = this.shadowRoot?.querySelectorAll?.('.panel-tab-btn[data-panel-id="playlist-viewer"]');
        playlistButtons?.forEach((btn) => btn.classList.remove('active'));

        requestAnimationFrame(() => {
            this.requestGridMetricsUpdate(true);
            console.log('Overlay closed. Computed left:', window.getComputedStyle(overlay).left);
        });
    }

    spawnPlaylistSettings() {
        if (!this.userIsAdmin) {
            console.warn('[Taskbar] Playlist Settings requires admin privileges');
            return null;
        }

        if (typeof window.spawnMediaSearchPanel !== 'function') {
            console.warn('[Taskbar] spawnMediaSearchPanel not available');
            return null;
        }

        const panel = window.spawnMediaSearchPanel('cached', {
            panelId: 'playlist-settings',
            context: { workspace: this.workspace }
        });

        if (panel) {
            console.log('[Taskbar] Playlist Settings panel spawned successfully');
        }

        return panel;
    }

    alignPlaylistToggle() {
        const { overlay, toggleTab, isOpen } = this.specialComponents['playlist-viewer'];
        if (!toggleTab) {
            return;
        }

        const container = document.getElementById('xavi-grid-container');
        const containerRect = container?.getBoundingClientRect();
        const containerLeft = containerRect ? Math.round(containerRect.left) : 0;

        if (!overlay) {
            toggleTab.style.setProperty('--playlist-toggle-left', `${containerLeft - 2}px`);
            return;
        }

        const overlayWidth = overlay.getBoundingClientRect().width;
        const leftClosed = containerLeft - 2;
        const leftOpen = containerLeft + Math.max(Math.round(overlayWidth) - 2, 40);
        const nextLeft = isOpen ? leftOpen : leftClosed;
        toggleTab.style.setProperty('--playlist-toggle-left', `${nextLeft}px`);
    }

    updatePlaylistOverlayUI(skipAlign = false) {
        const { overlay, toggleTab, isOpen } = this.specialComponents['playlist-viewer'];
        if (toggleTab) {
            const arrow = toggleTab.querySelector('.arrow');
            if (isOpen) {
                toggleTab.classList.add('open');
                if (arrow) arrow.textContent = '◀';
            } else {
                toggleTab.classList.remove('open');
                if (arrow) arrow.textContent = '▶';
            }
        }

        this.updatePlaylistOverlayGeometry();

        const playlistButtons = this.shadowRoot.querySelectorAll('.panel-tab-btn[data-panel-id="playlist-viewer"]');
        playlistButtons.forEach((btn) => {
            if (isOpen) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    adjustNeighborsForResize(state, candidate) {
        const edge = state.edge;
        const reference = state.startLayout;
        const neighbors = this.getAdjacentPanels(state.index, edge, reference);

        if (!neighbors.length) {
            return this.isValidLayout(candidate, state.index);
        }

        neighbors.forEach((neighborIndex) => {
            if (!state.affectedLayouts.has(neighborIndex)) {
                state.affectedLayouts.set(neighborIndex, this.cloneLayout(this.panelLayouts[neighborIndex]));
            }
        });

        const candidateBounds = this.getLayoutBounds(candidate);
        const startBounds = this.getLayoutBounds(reference);
        const neighborLayouts = new Map();

        const ensureMinSizeForNeighbors = () => {
            if (edge === 'right') {
                let maxRight = this.gridColumns;
                neighbors.forEach((neighborIndex) => {
                    const layout = this.panelLayouts[neighborIndex];
                    if (!layout) return;
                    const bounds = this.getLayoutBounds(layout);
                    maxRight = Math.min(maxRight, bounds.right - 1);
                });
                if (candidateBounds.right > maxRight) {
                    candidateBounds.right = maxRight;
                    candidate.width = Math.max(1, candidateBounds.right - candidateBounds.left);
                    candidate.x = candidateBounds.left + 1;
                }
            } else if (edge === 'left') {
                let minLeft = 0;
                neighbors.forEach((neighborIndex) => {
                    const layout = this.panelLayouts[neighborIndex];
                    if (!layout) return;
                    const bounds = this.getLayoutBounds(layout);
                    minLeft = Math.max(minLeft, bounds.left + 1);
                });
                if (candidateBounds.left < minLeft) {
                    candidateBounds.left = minLeft;
                    candidate.x = candidateBounds.left + 1;
                    candidate.width = Math.max(1, candidateBounds.right - candidateBounds.left);
                }
            } else if (edge === 'bottom') {
                let maxBottom = this.gridRows;
                neighbors.forEach((neighborIndex) => {
                    const layout = this.panelLayouts[neighborIndex];
                    if (!layout) return;
                    const bounds = this.getLayoutBounds(layout);
                    maxBottom = Math.min(maxBottom, bounds.bottom - 1);
                });
                if (candidateBounds.bottom > maxBottom) {
                    candidateBounds.bottom = maxBottom;
                    candidate.height = Math.max(1, candidateBounds.bottom - candidateBounds.top);
                    candidate.y = candidateBounds.top + 1;
                }
            } else if (edge === 'top') {
                let minTop = 0;
                neighbors.forEach((neighborIndex) => {
                    const layout = this.panelLayouts[neighborIndex];
                    if (!layout) return;
                    const bounds = this.getLayoutBounds(layout);
                    minTop = Math.max(minTop, bounds.top + 1);
                });
                if (candidateBounds.top < minTop) {
                    candidateBounds.top = minTop;
                    candidate.y = candidateBounds.top + 1;
                    candidate.height = Math.max(1, candidateBounds.bottom - candidateBounds.top);
                }
            }
        };

        ensureMinSizeForNeighbors();

        const selfOriginal = this.cloneLayout(reference);
        this.panelLayouts[state.index] = this.cloneLayout(candidate);

        const revert = () => {
            this.panelLayouts[state.index] = this.cloneLayout(selfOriginal);
            this.restoreAffectedLayouts(state);
        };

        for (const neighborIndex of neighbors) {
            const layout = this.cloneLayout(this.panelLayouts[neighborIndex]);
            if (!layout) {
                continue;
            }

            const bounds = this.getLayoutBounds(layout);

            switch (edge) {
                case 'right': {
                    const newLeft = candidateBounds.right;
                    const newWidth = bounds.right - newLeft;
                    if (newWidth < 1) {
                        revert();
                        return false;
                    }
                    layout.x = newLeft + 1;
                    layout.width = newWidth;
                    break;
                }
                case 'left': {
                    const newRight = candidateBounds.left;
                    const newWidth = newRight - bounds.left;
                    if (newWidth < 1) {
                        revert();
                        return false;
                    }
                    layout.width = newWidth;
                    break;
                }
                case 'bottom': {
                    const newTop = candidateBounds.bottom;
                    const newHeight = bounds.bottom - newTop;
                    if (newHeight < 1) {
                        revert();
                        return false;
                    }
                    layout.y = newTop + 1;
                    layout.height = newHeight;
                    break;
                }
                case 'top': {
                    const newBottom = candidateBounds.top;
                    const newHeight = newBottom - bounds.top;
                    if (newHeight < 1) {
                        revert();
                        return false;
                    }
                    layout.height = newHeight;
                    break;
                }
                default:
                    break;
            }

            this.panelLayouts[neighborIndex] = layout;
            neighborLayouts.set(neighborIndex, layout);
        }

        const candidateValid = this.isValidLayout(candidate, state.index);
        if (!candidateValid) {
            revert();
            return false;
        }

        for (const [neighborIndex, layout] of neighborLayouts.entries()) {
            if (!this.isValidLayout(layout, neighborIndex)) {
                revert();
                return false;
            }
        }

        this.applyPanelLayout(state.index, candidate);
        for (const [neighborIndex, layout] of neighborLayouts.entries()) {
            this.applyPanelLayout(neighborIndex, layout);
        }

        return true;
    }

    getAdjacentPanels(index, edge, referenceLayout) {
        const neighbors = [];
        const referenceBounds = this.getLayoutBounds(referenceLayout);

        for (let i = 0; i < this.panelLayouts.length; i += 1) {
            if (i === index) {
                continue;
            }
            const layout = this.panelLayouts[i];
            if (!layout) {
                continue;
            }

            const bounds = this.getLayoutBounds(layout);
            const verticalOverlap = this.rangesOverlap(bounds.top, bounds.bottom, referenceBounds.top, referenceBounds.bottom);
            const horizontalOverlap = this.rangesOverlap(bounds.left, bounds.right, referenceBounds.left, referenceBounds.right);

            switch (edge) {
                case 'right':
                    if (bounds.left === referenceBounds.right && verticalOverlap) {
                        neighbors.push(i);
                    }
                    break;
                case 'left':
                    if (bounds.right === referenceBounds.left && verticalOverlap) {
                        neighbors.push(i);
                    }
                    break;
                case 'bottom':
                    if (bounds.top === referenceBounds.bottom && horizontalOverlap) {
                        neighbors.push(i);
                    }
                    break;
                case 'top':
                    if (bounds.bottom === referenceBounds.top && horizontalOverlap) {
                        neighbors.push(i);
                    }
                    break;
                default:
                    break;
            }
        }

        return neighbors;
    }

    rangesOverlap(startA, endA, startB, endB) {
        return startA < endB && endA > startB;
    }

    captureContainerWrapper() {
        const musicContainer = document.getElementById('xavi-grid-container');
        if (!musicContainer) {
            return;
        }

        const wrapper = musicContainer.parentElement;
        if (!wrapper) {
            return;
        }

        this.containerWrapper = wrapper;

        if (!wrapper.classList.contains('my-4')) {
            wrapper.classList.add('my-4');
        }
    }

    setupEventListeners() {
        if (this.taskbarClock) {
            this.taskbarClock.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleCalendarMenu();
            });
        }

        // Prevent calendar from closing when clicking inside it.
        if (this.calendarMenu) {
            this.calendarMenu.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }

        if (this.startMenuBtn) {
            this.startMenuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleStartMenu();
            });
        }

        if (this.taskbarSettingsBtn) {
            this.taskbarSettingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleStartMenuAction('launchPanel:workspace-settings');
            });
        }

        // Prevent start menu from closing when clicking inside it.
        if (this.startMenu) {
            this.startMenu.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }

        if (this.startMenuCloseBtn) {
            this.startMenuCloseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeStartMenu();
            });
        }

        if (this.startMenuSettingsBtn) {
            this.startMenuSettingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleStartMenuAction('launchPanel:workspace-settings');
            });
        }

        if (this.startMenuSearch) {
            this.startMenuSearch.addEventListener('input', () => {
                this._startMenuSearchQuery = String(this.startMenuSearch.value || '');
                if (this.startMenu?.classList.contains('open')) {
                    this.renderStartMenuItems();
                }
            });
            this.startMenuSearch.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    e.stopPropagation();
                    this.closeStartMenu();
                }
            });
        }
        
        // Close start menu when clicking outside
        document.addEventListener('click', (e) => {
            const path = typeof e.composedPath === 'function' ? e.composedPath() : null;
            const clickedCalendar = this.calendarMenu
                && (this.calendarMenu.contains(e.target) || (path && path.includes(this.calendarMenu)));
            const clickedClock = this.taskbarClock
                && (this.taskbarClock.contains(e.target) || (path && path.includes(this.taskbarClock)));
            if (this.calendarMenu && !clickedCalendar && !clickedClock) {
                this.closeCalendarMenu();
            }

            if (this.startMenu && 
                !this.startMenu.contains(e.target) && 
                !this.startMenuBtn?.contains(e.target)) {
                this.closeStartMenu();
            }

            if (this.taskviewPopover && this.taskviewPopover.classList.contains('open')) {
                this.closeTaskviewPopover();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.calendarMenu && this.calendarMenu.classList.contains('open')) {
                e.stopPropagation();
                this.closeCalendarMenu();
            }
            if (e.key === 'Escape' && this.taskviewPopover && this.taskviewPopover.classList.contains('open')) {
                e.stopPropagation();
                this.closeTaskviewPopover();
            }
        });

        // Setup music player dock controls
        if (this.dockPlayPauseBtn) {
            this.dockPlayPauseBtn.addEventListener('click', () => this.handleDockPlayPause());
        }
        if (this.dockPrevBtn) {
            this.dockPrevBtn.addEventListener('click', () => this.handleDockPrevious());
        }
        if (this.dockNextBtn) {
            this.dockNextBtn.addEventListener('click', () => this.handleDockNext());
        }
        if (this.musicDockButton) {
            this.musicDockButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleMusicDockMenu();
            });
            this.musicDockButton.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggleMusicDockMenu();
                }
            });
        }
        if (this.dockVolumeControl) {
            this.dockVolumeControl.addEventListener('xavi-volume-change', (e) => {
                const volume = e?.detail?.volume;
                if (volume === undefined || volume === null) return;
                this.handleDockVolumeChange(parseFloat(volume));
            });
        }
        if (this.dockExpandBtn) {
            this.dockExpandBtn.addEventListener('click', () => this.handleDockExpand());
        }

        // Close music dock menu when clicking outside.
        // NOTE: This module runs inside a shadow root; `e.target` is retargeted across
        // shadow boundaries, so containment checks can incorrectly treat inside-clicks
        // as outside-clicks. Use composedPath() instead.
        document.addEventListener('click', (e) => {
            if (!this.musicDockMenu || !this.musicDockButton) return;
            const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
            const clickedInside = path.includes(this.musicDockMenu) || path.includes(this.musicDockButton);
            if (!clickedInside) {
                this.closeMusicDockMenu();
            }
            // (Music dock volume dropdown is handled internally by <xavi-volume-control>)
        });

        // Setup video player dock controls
        if (this.videoDockPlayPauseButton) {
            this.videoDockPlayPauseButton.addEventListener('click', () => this.handleVideoDockPlayPause());
        }
        if (this.videoDockPrevButton) {
            this.videoDockPrevButton.addEventListener('click', () => this.handleVideoDockPrevious());
        }
        if (this.videoDockNextButton) {
            this.videoDockNextButton.addEventListener('click', () => this.handleVideoDockNext());
        }
        if (this.videoDockVolumeControl) {
            this.videoDockVolumeControl.addEventListener('xavi-volume-change', (e) => {
                const volume = e?.detail?.volume;
                if (volume === undefined || volume === null) return;
                this.handleVideoDockVolumeChange(parseFloat(volume));
            });
        }
        if (this.videoDockModeMenuButton) {
            this.videoDockModeMenuButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleVideoDockModeMenu();
            });
        }
        if (this.videoDockCloseButton) {
            this.videoDockCloseButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeVideoDockModeMenu();
                this.handleVideoDockClose();
            });
        }

        const bindVideoMenuItem = (button, mode) => {
            if (!button) return;
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeVideoDockModeMenu();
                this.handleVideoDockSetMode(mode);
            });
        };
        bindVideoMenuItem(this.videoDockMenuMini, 'mini');
        bindVideoMenuItem(this.videoDockMenuExpanded, 'expanded');
        bindVideoMenuItem(this.videoDockMenuGridLayer, 'grid-layer');
        // videoDockPlaylistButton removed

        // Close video dock menu when clicking outside (shadow retargeting safe via composedPath).
        document.addEventListener('click', (e) => {
            if (!this.videoDockModeMenu || !this.videoDockModeMenuButton) return;
            const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
            const clickedInside = path.includes(this.videoDockModeMenu) || path.includes(this.videoDockModeMenuButton);
            if (!clickedInside) {
                this.closeVideoDockModeMenu();
            }
        });

        // (Video dock volume dropdown is handled internally by <xavi-volume-control>)

        // Listen for music player events
        document.addEventListener('music-player-embedded', (e) => this.handleMusicPlayerEmbedded(e));
        document.addEventListener('music-player-restored', (e) => this.handleMusicPlayerRestored(e));
        document.addEventListener('music-track-changed', (e) => this.updateDockTrackInfo(e.detail));
        document.addEventListener('music-playback-state', (e) => this.updateDockPlayState(e.detail));
        document.addEventListener('music-time-update', (e) => this.updateDockTime(e.detail));

        // Listen for video player events
        document.addEventListener('video-player-docked', (e) => this.handleVideoPlayerDocked(e));
        document.addEventListener('video-player-undocked', (e) => this.handleVideoPlayerUndocked(e));
        document.addEventListener('video-track-changed', (e) => this.updateVideoDockTrackInfo(e.detail));
        document.addEventListener('video-playback-state', (e) => this.updateVideoDockPlayState(e.detail));
        document.addEventListener('video-time-update', (e) => {
            if (e.detail && e.detail.currentTime !== undefined && e.detail.duration !== undefined) {
                this.updateVideoDockTime(e.detail.currentTime, e.detail.duration);
            }
        });
        
        // Listen for volume changes from anywhere to keep all controls in sync
        document.addEventListener('volume-changed', (e) => {
            if (e.detail && e.detail.volume !== undefined) {
                const volume = parseFloat(e.detail.volume);
                
                // Sync music dock
                if (this.dockVolumeControl) {
                    this.dockVolumeControl.value = Math.round(volume);
                }
                
                // Sync video dock
                if (this.videoDockVolumeControl) {
                    this.videoDockVolumeControl.value = Math.round(volume);
                }
            }
        });

        // Initialize dock volume from storage
        const storedVolume = localStorage.getItem('myVolume') || '50';
        if (this.dockVolumeControl) {
            this.dockVolumeControl.value = parseFloat(storedVolume);
        }
        
        // Initialize video dock volume from storage (use shared myVolume)
        if (this.videoDockVolumeControl) {
            this.videoDockVolumeControl.value = parseFloat(storedVolume);
        }
        
        // Listen for storage changes to sync volume across all controls
        window.addEventListener('storage', (e) => {
            if (e.key === 'myVolume' && e.newValue) {
                const volume = parseFloat(e.newValue);
                
                // Sync music dock
                if (this.dockVolumeControl) {
                    this.dockVolumeControl.value = Math.round(volume);
                }
                
                // Sync video dock
                if (this.videoDockVolumeControl) {
                    this.videoDockVolumeControl.value = Math.round(volume);
                }
            }
        });

        // Ensure dock visibility matches the current component state even if
        // the player dispatched its events before the taskbar listeners
        // were registered.
        setTimeout(() => this.syncDockStatesFromComponents(), 0);

        if (!this._busTaskviewListenerAttached) {
            // In case BusMenu fired before listeners were ready, request a sync now
            this.requestBusTaskviewSync();
            this._busTaskviewListenerAttached = true;
        }
    }

    requestBusTaskviewSync() {
        if (window.BusMenu && typeof window.BusMenu.notifyTaskbarRoutesState === 'function') {
            try {
                window.BusMenu.notifyTaskbarRoutesState();
            } catch (err) {
                console.warn('[Taskbar] Failed to request bus taskview sync:', err);
            }
        }
    }

    handleBusTaskviewState(event) {
        const detail = event?.detail || {};
        this.updateBusToggleAppearance(Boolean(detail.active));
        if (!detail.active) {
            this.unregisterTaskviewEntry(this.busTaskviewInstanceId);
            return;
        }

        const label = detail.label || 'Transit Routes';
        const icon = detail.icon || '🚌';
        const detailTaskviewConfig = detail.taskviewConfig;
        const fallbackTaskviewConfig = {
            controls: ['close'],
            focus: () => {
                if (window.BusMenu && typeof window.BusMenu.showPopup === 'function') {
                    window.BusMenu.showPopup();
                } else {
                    document.getElementById('bus-menu-popup')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            },
            close: () => {
                if (window.BusMenu) {
                    if (typeof window.BusMenu.deactivateAllRoutes === 'function') {
                        window.BusMenu.deactivateAllRoutes();
                        return false;
                    }
                    if (typeof window.BusMenu.disableShowAllRoutes === 'function') {
                        window.BusMenu.disableShowAllRoutes();
                    }
                    if (typeof window.BusMenu.clearSelection === 'function') {
                        window.BusMenu.clearSelection();
                    }
                    if (typeof window.BusMenu.hidePopup === 'function') {
                        window.BusMenu.hidePopup();
                    }
                    return false;
                }
                return true;
            }
        };

        const entryInfo = {
            label,
            icon,
            taskviewConfig: detailTaskviewConfig && typeof detailTaskviewConfig === 'object'
                ? detailTaskviewConfig
                : fallbackTaskviewConfig
        };

        const popupEl = detail.panelElement
            || (window.BusMenu && typeof window.BusMenu.getPopupElement === 'function'
                ? window.BusMenu.getPopupElement()
                : null)
            || document.getElementById('bus-menu-popup');
        this.registerTaskviewEntry('bus-routes', entryInfo, popupEl, {
            instanceId: this.busTaskviewInstanceId,
            setActive: detail.setActive
        });
    }

    updateBusToggleAppearance(isOpen) {
        if (!this.busToggleBtn) {
            this.busToggleBtn = this.shadowRoot?.getElementById('bus-toggle-btn')
                || this.shadowRoot?.getElementById('start-menu-bus-item');
        }
        if (!this.busToggleBtn) {
            return;
        }
        this.busToggleBtn.classList.toggle('active', Boolean(isOpen));
        this.busToggleBtn.setAttribute('aria-pressed', String(Boolean(isOpen)));
    }

    restoreState() {
        let restored = false;
        try {
            const raw = localStorage.getItem(this.stateKey);
            if (raw) {
                const data = JSON.parse(raw);
                if (Array.isArray(data.panels)) {
                    const unique = new Set();
                    const panels = [];
                    data.panels.slice(0, this.MAX_PANELS).forEach((tabId) => {
                        if (!tabId) {
                            panels.push('');
                            return;
                        }
                        if (!this.availableTabs[tabId]) {
                            panels.push('');
                            return;
                        }
                        if (unique.has(tabId)) {
                            panels.push('');
                            return;
                        }
                        unique.add(tabId);
                        panels.push(tabId);
                    });

                    this.panelSelections = panels.slice(0, this.MAX_PANELS);
                    if (Array.isArray(data.layouts)) {
                        this.panelLayouts = data.layouts
                            .slice(0, this.panelSelections.length)
                            .map((layout) => this.sanitizeLayout(layout));
                    } else {
                        this.panelLayouts = [];
                    }

                    this.layoutMode = 'grid';
                    if (typeof data.containerMode === 'string') {
                        this.containerMode = data.containerMode === 'full' ? 'full' : 'contained';
                    }

                    restored = true;
                }
            }
        } catch (error) {
            console.warn('Failed to restore tab layout state:', error);
        }

        if (!restored) {
            this.panelSelections = [];
            this.panelLayouts = [];
            this.layoutMode = 'grid';
        }

        this.ensureDefaultPanelSelections();
    }

    ensureDefaultPanelSelections() {
        if (!Array.isArray(this.panelSelections)) {
            this.panelSelections = [];
        }

        if (this.panelSelections.length > this.MAX_PANELS) {
            this.panelSelections = this.panelSelections.slice(0, this.MAX_PANELS);
        }
    }

    saveState() {
        try {
            const payload = {
                panels: this.panelSelections,
                layoutMode: this.layoutMode,
                containerMode: this.containerMode,
                layouts: this.panelLayouts.map((layout) => this.cloneLayout(layout))
            };
            localStorage.setItem(this.stateKey, JSON.stringify(payload));
            
            // Save to database if user is logged in (debounced)
            if (this.userIsLoggedIn) {
                this.debouncedSaveToDBState();
            }
        } catch (error) {
            console.warn('Failed to persist tab layout state:', error);
        }
    }

    toggleStartMenu() {
        if (!this.startMenu || !this.startMenuBtn) return;
        const isOpen = this.startMenu.classList.contains('open');
        if (isOpen) {
            this.closeStartMenu();
        } else {
            this.openStartMenu();
        }
    }

    openStartMenu() {
        if (!this.startMenu || !this.startMenuBtn) return;
        this.startMenu.classList.add('open');
        this.startMenuBtn.classList.add('active');

        this.ensureMenuDefinitionLoaded().then(() => {
            this.renderStartMenuItems();
        });
        this.renderStartMenuItems();

        if (this.startMenuSearch) {
            try {
                this.startMenuSearch.focus();
                this.startMenuSearch.select();
            } catch (e) {}
        }
    }

    closeStartMenu() {
        if (!this.startMenu || !this.startMenuBtn) return;
        this.startMenu.classList.remove('open');
        this.startMenuBtn.classList.remove('active');
    }

    toggleCalendarMenu() {
        if (!this.calendarMenu || !this.taskbarClock) return;
        const isOpen = this.calendarMenu.classList.contains('open');
        if (isOpen) {
            this.closeCalendarMenu();
        } else {
            this.openCalendarMenu();
        }
    }

    openCalendarMenu() {
        if (!this.calendarMenu || !this.taskbarClock) return;

        const now = new Date();
        if (!this._calendarState || typeof this._calendarState !== 'object') {
            this._calendarState = { year: now.getFullYear(), month: now.getMonth() };
        }
        if (!Number.isInteger(this._calendarState.year) || !Number.isInteger(this._calendarState.month)) {
            this._calendarState = { year: now.getFullYear(), month: now.getMonth() };
        }

        this.renderCalendarMenu();
        this.calendarMenu.classList.add('open');
    }

    closeCalendarMenu() {
        if (!this.calendarMenu) return;
        this.calendarMenu.classList.remove('open');
    }

    shiftCalendarMonth(deltaMonths) {
        const state = this._calendarState || { year: new Date().getFullYear(), month: new Date().getMonth() };
        const base = new Date(state.year, state.month, 1);
        base.setMonth(base.getMonth() + deltaMonths);
        this._calendarState = { year: base.getFullYear(), month: base.getMonth() };
        this.renderCalendarMenu();
    }

    shiftCalendarYear(deltaYears) {
        const state = this._calendarState || { year: new Date().getFullYear(), month: new Date().getMonth() };
        const nextYear = state.year + deltaYears;
        this._calendarState = { year: nextYear, month: state.month };
        this.renderCalendarMenu();
    }

    renderCalendarMenu() {
        if (!this.calendarMenu) return;

        const state = this._calendarState || { year: new Date().getFullYear(), month: new Date().getMonth() };
        const year = state.year;
        const month = state.month;

        const monthStart = new Date(year, month, 1);
        const monthEnd = new Date(year, month + 1, 0);
        const daysInMonth = monthEnd.getDate();
        const startDay = monthStart.getDay(); // 0=Sun

        const today = new Date();
        const isTodayInMonth = today.getFullYear() === year && today.getMonth() === month;
        const monthLabel = monthStart.toLocaleDateString([], { month: 'long', year: 'numeric' });

        const header = document.createElement('div');
        header.className = 'calendar-header';

        const title = document.createElement('div');
        title.className = 'calendar-title';
        title.textContent = monthLabel;

        const nav = document.createElement('div');
        nav.className = 'calendar-nav';

        const mkBtn = (label, titleText, onClick) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = label;
            btn.title = titleText;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                onClick();
            });
            return btn;
        };

        nav.appendChild(mkBtn('«', 'Previous year', () => this.shiftCalendarYear(-1)));
        nav.appendChild(mkBtn('‹', 'Previous month', () => this.shiftCalendarMonth(-1)));
        nav.appendChild(mkBtn('›', 'Next month', () => this.shiftCalendarMonth(1)));
        nav.appendChild(mkBtn('»', 'Next year', () => this.shiftCalendarYear(1)));

        header.appendChild(title);
        header.appendChild(nav);

        const grid = document.createElement('div');
        grid.className = 'calendar-grid';

        const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        dows.forEach((d) => {
            const el = document.createElement('div');
            el.className = 'calendar-dow';
            el.textContent = d;
            grid.appendChild(el);
        });

        const totalCells = 42; // 6 weeks
        for (let i = 0; i < totalCells; i += 1) {
            const dayIndex = i - startDay + 1;
            const cell = document.createElement('div');
            cell.className = 'calendar-day';

            if (dayIndex < 1 || dayIndex > daysInMonth) {
                cell.classList.add('muted');
                cell.textContent = '';
            } else {
                cell.textContent = String(dayIndex);
                if (isTodayInMonth && today.getDate() === dayIndex) {
                    cell.classList.add('today');
                }
                cell.addEventListener('click', (e) => {
                    e.stopPropagation();
                    // For now: selecting a day just closes the calendar.
                    this.closeCalendarMenu();
                });
            }

            grid.appendChild(cell);
        }

        this.calendarMenu.innerHTML = '';
        this.calendarMenu.appendChild(header);
        this.calendarMenu.appendChild(grid);
    }

    getBasePath() {
        const workspace = this.closest('xavi-multi-grid');
        return workspace?.dataset?.basePath || window.XAVI_MULTIGRID_BASE || '/packages/xavi_social/multigrid';
    }

    getDefaultMenuDefinition() {
        return { startMenu: { sections: [] } };
    }

    getWorkspaceModuleConfigs() {
        const configs = [];

        const registry = this.workspace?.moduleRegistry;
        if (registry && typeof registry.forEach === 'function') {
            registry.forEach((config) => {
                if (config && typeof config === 'object') {
                    configs.push(config);
                }
            });
            return configs;
        }

        if (typeof window !== 'undefined' && window.XAVI_MODULE_CONFIGS && typeof window.XAVI_MODULE_CONFIGS === 'object') {
            Object.values(window.XAVI_MODULE_CONFIGS).forEach((config) => {
                if (config && typeof config === 'object') {
                    configs.push(config);
                }
            });
        }

        return configs;
    }

    getModuleStartMenuSections() {
        const sections = [];
        const configs = this.getWorkspaceModuleConfigs();
        configs.forEach((config) => {
            const tb = config?.taskbar;
            if (!tb || typeof tb !== 'object') {
                return;
            }
            const startMenu = tb.startMenu;

            if (startMenu && typeof startMenu === 'object') {
                if (Array.isArray(startMenu.sections)) {
                    startMenu.sections.forEach((s) => {
                        if (s && typeof s === 'object') sections.push(s);
                    });
                }
                if (startMenu.section && typeof startMenu.section === 'object') {
                    sections.push(startMenu.section);
                }
            }

            if (tb.startMenuSection && typeof tb.startMenuSection === 'object') {
                sections.push(tb.startMenuSection);
            }
        });
        return sections;
    }

    mergeStartMenuSections(staticSections, moduleSections) {
        const out = Array.isArray(staticSections) ? staticSections.map((s) => ({ ...s })) : [];
        const additions = Array.isArray(moduleSections) ? moduleSections : [];

        const normalizeId = (value) => String(value || '').trim();

        const itemKey = (item) => {
            if (!item || typeof item !== 'object') return '';
            const id = normalizeId(item.id);
            if (id) return `id:${id}`;
            const action = normalizeId(item.action);
            const label = normalizeId(item.label || item.labelWhenHidden || item.labelWhenVisible || item.labelWhenEnabled || item.labelWhenDisabled);
            return `a:${action}|l:${label}`;
        };

        const mergeItems = (baseItems, newItems) => {
            const base = Array.isArray(baseItems) ? baseItems : [];
            const incoming = Array.isArray(newItems) ? newItems : [];

            const index = new Map();
            base.forEach((it) => {
                const k = itemKey(it);
                if (k) index.set(k, it);
            });

            incoming.forEach((it) => {
                const k = itemKey(it);
                if (!k) {
                    base.push(it);
                    return;
                }
                const existing = index.get(k);
                if (!existing) {
                    base.push(it);
                    index.set(k, it);
                    return;
                }

                if (Array.isArray(existing.items) && Array.isArray(it.items)) {
                    mergeItems(existing.items, it.items);
                }
            });

            return base;
        };

        const byId = new Map();
        out.forEach((s) => {
            const id = normalizeId(s?.id);
            if (id) byId.set(id, s);
        });

        additions.forEach((s) => {
            if (!s || typeof s !== 'object') return;
            const id = normalizeId(s.id);
            if (id && byId.has(id)) {
                const target = byId.get(id);
                target.label = target.label || s.label;
                target.items = mergeItems(target.items, s.items);
            } else {
                out.push({ ...s });
                if (id) byId.set(id, out[out.length - 1]);
            }
        });

        return out;
    }

    ensureMenuDefinitionLoaded() {
        if (this._menuLoadPromise) return this._menuLoadPromise;
        this._menuLoadPromise = this.loadMenuDefinition().catch((err) => {
            console.warn('[Taskbar] Failed to load menu.yml; using defaults:', err);
            this.menuDefinition = this.getDefaultMenuDefinition();
        });
        return this._menuLoadPromise;
    }

    async loadMenuDefinition() {
        const basePath = this.getBasePath();
        const url = `${basePath}/js/modules/taskbar/menu.yml`;
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) {
            throw new Error(`menu.yml fetch failed: ${res.status}`);
        }
        const text = await res.text();
        const parsed = this.parseYamlLite(text);
        this.menuDefinition = parsed && typeof parsed === 'object' ? parsed : this.getDefaultMenuDefinition();
        return this.menuDefinition;
    }

    parseYamlLite(text) {
        const rawLines = String(text || '').replace(/\r\n/g, '\n').split('\n');
        const lines = [];
        for (const original of rawLines) {
            const noComment = original.replace(/\s+#.*$/, '');
            if (!noComment.trim()) continue;
            lines.push(noComment);
        }

        const root = {};
        const stack = [{ indent: -1, container: root }];

        const parseScalar = (raw) => {
            if (raw === null || raw === undefined) return null;
            const v = String(raw).trim();
            if (!v) return '';
            if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
                return v.slice(1, -1);
            }
            if (v === 'true') return true;
            if (v === 'false') return false;
            if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
            return v;
        };

        const nextNonEmptyLine = (index) => {
            for (let j = index + 1; j < lines.length; j += 1) {
                if (lines[j].trim()) return lines[j];
            }
            return null;
        };

        const current = () => stack[stack.length - 1].container;

        for (let i = 0; i < lines.length; i += 1) {
            const lineWithIndent = lines[i];
            const indent = lineWithIndent.match(/^\s*/)?.[0]?.length || 0;
            const line = lineWithIndent.trim();
            if (!line) continue;

            while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
                stack.pop();
            }

            const parent = current();

            if (line.startsWith('- ')) {
                if (!Array.isArray(parent)) {
                    // Malformed for our subset; ignore.
                    continue;
                }
                const itemText = line.slice(2).trim();
                if (!itemText) {
                    const obj = {};
                    parent.push(obj);
                    stack.push({ indent, container: obj });
                    continue;
                }
                const colonIdx = itemText.indexOf(':');
                if (colonIdx !== -1) {
                    const key = itemText.slice(0, colonIdx).trim();
                    const rest = itemText.slice(colonIdx + 1).trim();
                    const obj = {};
                    obj[key] = parseScalar(rest);
                    parent.push(obj);
                    stack.push({ indent, container: obj });
                } else {
                    parent.push(parseScalar(itemText));
                }
                continue;
            }

            const colonIdx = line.indexOf(':');
            if (colonIdx === -1) {
                continue;
            }

            const key = line.slice(0, colonIdx).trim();
            const rest = line.slice(colonIdx + 1).trim();
            if (rest === '') {
                const lookahead = nextNonEmptyLine(i);
                const childIndent = lookahead ? (lookahead.match(/^\s*/)?.[0]?.length || 0) : 0;
                const isChild = lookahead && childIndent > indent;
                const childIsList = isChild && lookahead.trim().startsWith('- ');
                const child = childIsList ? [] : {};
                if (parent && typeof parent === 'object') {
                    parent[key] = child;
                    stack.push({ indent, container: child });
                }
                continue;
            }

            if (parent && typeof parent === 'object') {
                parent[key] = (rest === '[]') ? [] : parseScalar(rest);
            }
        }

        return root;
    }

    updateMenuPositions() {
        const taskbar = this.shadowRoot?.querySelector('.taskbar');
        if (!taskbar) return;
        
        const taskbarRect = taskbar.getBoundingClientRect();
        const taskbarHeight = Math.round(taskbarRect.height);
        const bottomOffset = taskbarHeight + 6; // 6px gap above taskbar

        // For overlays that should align to the workspace surface.
        const workspaceHost = this.workspace?.shadowRoot?.host || this.workspace || null;
        const workspaceRect = workspaceHost?.getBoundingClientRect?.() || null;
        const taskbarTop = Number.isFinite(taskbarRect.top) ? Math.round(taskbarRect.top) : null;
        const startMenuBottom = (taskbarTop !== null)
            ? Math.max(0, Math.round(window.innerHeight - taskbarTop))
            : bottomOffset;
        
        // Update menus
        if (this.startMenu) {
            // Start menu should behave like a 1-column overlay over the workspace.
            this.startMenu.style.bottom = `${startMenuBottom}px`;
            if (workspaceRect) {
                this.startMenu.style.left = `${Math.round(workspaceRect.left)}px`;
                this.startMenu.style.top = `${Math.round(workspaceRect.top)}px`;
            } else {
                this.startMenu.style.top = '0px';
            }
        }
        if (this.calendarMenu) {
            this.calendarMenu.style.bottom = `${bottomOffset}px`;
        }
        if (this.musicDockMenu) {
            this.musicDockMenu.style.bottom = `${bottomOffset}px`;
        }
        
        // Update background height to reach top of taskbar
        this.updateBackgroundHeightToTaskbar();
    }

    updateBackgroundHeightToTaskbar() {
        // Don't update background height if playlist overlay is controlling it
        if (this.specialComponents?.['playlist-viewer']?.isOpen) {
            return;
        }
        
        const taskbar = this.shadowRoot?.querySelector('.taskbar');
        if (!taskbar) return;
        
        const taskbarRect = taskbar.getBoundingClientRect();
        const taskbarTop = Math.round(taskbarRect.top);
        
        // Calculate available height from top of viewport to top of taskbar
        const headerEl = document.querySelector('header');
        const headerBottom = headerEl ? Math.round(headerEl.getBoundingClientRect().bottom) : 0;
        const topOffset = Math.max(0, headerBottom);
        
        // Background height = taskbar top - header bottom
        const backgroundHeight = Math.max(this.minBackgroundHeight, taskbarTop - topOffset);
        this.setBackgroundHeight(backgroundHeight);
    }

    setBackgroundHeight(value) {
        const fallback = Number.isFinite(value) ? value : this.defaultBackgroundHeight;
        const applied = Math.max(this.minBackgroundHeight, Math.round(fallback));
        this.backgroundHeight = applied;
        if (this.workspace && typeof this.workspace.calculateGridMetrics === 'function') {
            try {
                this.workspace.calculateGridMetrics();
            } catch (err) {
                console.warn('[Taskbar] Failed to recalculate workspace grid metrics:', err);
            }
        }
        return applied;
    }

    ensureBackgroundHeight() {
        const current = Number.isFinite(this.backgroundHeight) ? this.backgroundHeight : this.defaultBackgroundHeight;
        return this.setBackgroundHeight(current);
    }

    renderStartMenuItems() {
        if (!this.startMenuItems) return;
        this.startMenuItems.innerHTML = '';

        const query = (this._startMenuSearchQuery || '').trim().toLowerCase();
        const matches = (value) => {
            if (!query) return true;
            return String(value || '').toLowerCase().includes(query);
        };

        const fragment = document.createDocumentFragment();
        let appendedAny = false;

        const def = this.menuDefinition && typeof this.menuDefinition === 'object'
            ? this.menuDefinition
            : this.getDefaultMenuDefinition();
        const staticSections = Array.isArray(def?.startMenu?.sections) ? def.startMenu.sections : [];

        const moduleSections = this.getModuleStartMenuSections();
        const mergedSections = this.mergeStartMenuSections(staticSections, moduleSections);

        const collectPanelIdsFromMenuTree = () => {
            const ids = new Set();
            const visit = (items) => {
                const list = Array.isArray(items) ? items : [];
                list.forEach((item) => {
                    const action = item?.action ? String(item.action) : '';
                    if (action && action.startsWith('launchPanel:')) {
                        const panelId = action.slice('launchPanel:'.length).trim();
                        if (panelId) ids.add(panelId);
                    }
                    if (Array.isArray(item?.items) && item.items.length) {
                        visit(item.items);
                    }
                });
            };
            mergedSections.forEach((section) => visit(section?.items));
            return ids;
        };

        const referencedPanelIds = collectPanelIdsFromMenuTree();

        const getItemLabelForSearch = (item) => {
            return item?.label
                || item?.labelWhenHidden
                || item?.labelWhenVisible
                || item?.labelWhenEnabled
                || item?.labelWhenDisabled
                || '';
        };

        const filterMenuTree = (items) => {
            const list = Array.isArray(items) ? items : [];
            const filtered = [];
            list.forEach((item) => {
                const label = getItemLabelForSearch(item);
                const action = item?.action ? String(item.action) : '';
                const hasChildren = Array.isArray(item?.items) && item.items.length > 0;

                if (hasChildren) {
                    const childFiltered = filterMenuTree(item.items);
                    const keep = matches(label) || matches(action) || matches(item?.id) || childFiltered.length > 0;
                    if (keep) {
                        filtered.push({ ...item, items: childFiltered });
                    }
                    return;
                }

                const keep = matches(label) || matches(action) || matches(item?.id);
                if (keep) {
                    filtered.push(item);
                }
            });
            return filtered;
        };

        const renderMenuTree = (items, keyPrefix, expandAll) => {
            const list = Array.isArray(items) ? items : [];
            list.forEach((item, index) => {
                const key = `${keyPrefix}/${item?.id ? String(item.id) : String(index)}`;
                const el = this.buildStartMenuNode(item, key, 0, expandAll);
                if (el) {
                    fragment.appendChild(el);
                    appendedAny = true;
                }
            });
        };

        const sectionFolders = [];
        mergedSections.forEach((section) => {
            const sectionLabel = section?.label ? String(section.label) : '';
            const items = Array.isArray(section?.items) ? section.items : [];
            let filtered = filterMenuTree(items);
            if (!filtered.length && !matches(sectionLabel)) return;
            // If the section label matches the query, show full section contents.
            if (query && matches(sectionLabel) && !filtered.length) {
                filtered = items;
            }

            // Render each section as a folder node instead of a heading.
            const sectionId = section?.id ? String(section.id) : (sectionLabel || 'section');
            const sectionFolder = {
                id: `section-${sectionId}`,
                label: sectionLabel || sectionId,
                icon: section?.icon ? String(section.icon) : '',
                items: filtered
            };
            sectionFolders.push({ sectionId, folder: sectionFolder });
        });

        // Merge panel registry entries into their app folder (category).
        const registryEntries = this.getPanelRegistryEntries();
        if (registryEntries.length) {
            const eligible = registryEntries
                .filter((e) => e && e.id && !referencedPanelIds.has(e.id))
                .filter((e) => matches(e.label) || matches(e.id) || matches(e.category) || matches(e.section));

            const byCategory = new Map();
            eligible.forEach((entry) => {
                const category = String(entry.category || 'Other').trim() || 'Other';
                if (!byCategory.has(category)) byCategory.set(category, []);
                byCategory.get(category).push({
                    id: entry.id,
                    label: entry.label,
                    icon: entry.icon || '',
                    action: `launchPanel:${entry.id}`
                });
            });

            byCategory.forEach((items, category) => {
                // sort within category for stable UX
                items.sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));

                const target = sectionFolders.find((s) => {
                    const label = String(s.folder?.label || '').trim().toLowerCase();
                    return label === String(category).trim().toLowerCase();
                });

                if (target && Array.isArray(target.folder.items)) {
                    target.folder.items = target.folder.items.concat(items);
                } else {
                    const catId = String(category).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'app';
                    sectionFolders.push({
                        sectionId: catId,
                        folder: {
                            id: `section-${catId}`,
                            label: category,
                            items
                        }
                    });
                }
            });
        }

        // Render final folders
        sectionFolders.forEach(({ sectionId, folder }) => {
            const keyPrefix = `section:${sectionId}`;
            const el = this.buildStartMenuNode(folder, keyPrefix, 0, Boolean(query));
            if (el) {
                fragment.appendChild(el);
                appendedAny = true;
            }
        });

        if (!appendedAny) {
            const placeholder = document.createElement('div');
            placeholder.className = 'start-menu-placeholder';
            placeholder.textContent = query ? 'No results' : 'No apps available';
            fragment.appendChild(placeholder);
        }

        this.startMenuItems.appendChild(fragment);
        this.updateStartMenuActionLabels();
    }

    buildStartMenuNode(item, key, depth = 0, expandAll = false) {
        const hasChildren = Array.isArray(item?.items) && item.items.length > 0;
        if (!hasChildren) {
            return this.buildStartMenuActionButton(item);
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'start-menu-submenu';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'start-menu-item start-menu-submenu-toggle';
        btn.dataset.xaviMenuKey = String(key);
        if (item?.id) {
            btn.dataset.xaviMenuItemId = String(item.id);
        }

        const icon = item?.icon ? String(item.icon) : '';
        if (icon) {
            const iconEl = document.createElement('span');
            iconEl.className = 'start-menu-icon';
            iconEl.textContent = icon;
            btn.appendChild(iconEl);
        }

        const labelEl = document.createElement('span');
        labelEl.className = 'start-menu-label';
        labelEl.textContent = item?.label ? String(item.label) : 'Menu';
        btn.appendChild(labelEl);

        const caret = document.createElement('span');
        caret.className = 'start-menu-submenu-caret';
        btn.appendChild(caret);

        const children = document.createElement('div');
        children.className = 'start-menu-submenu-items';
        children.dataset.xaviMenuChildrenFor = String(key);

        const isOpen = expandAll || this._openStartMenuSubmenus.has(key);
        children.classList.toggle('open', isOpen);
        btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        caret.textContent = isOpen ? '▾' : '▸';

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const next = !children.classList.contains('open');
            children.classList.toggle('open', next);
            btn.setAttribute('aria-expanded', next ? 'true' : 'false');
            caret.textContent = next ? '▾' : '▸';
            if (next) {
                this._openStartMenuSubmenus.add(key);
            } else {
                this._openStartMenuSubmenus.delete(key);
            }
        });

        const childItems = Array.isArray(item.items) ? item.items : [];
        childItems.forEach((child, index) => {
            const childKey = `${key}/${child?.id ? String(child.id) : String(index)}`;
            const node = this.buildStartMenuNode(child, childKey, depth + 1, expandAll);
            if (node) {
                children.appendChild(node);
            }
        });

        wrapper.appendChild(btn);
        wrapper.appendChild(children);
        return wrapper;
    }

    buildStartMenuActionButton(item) {
        const action = item?.action ? String(item.action) : '';
        if (!action) return null;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'start-menu-item';
        btn.dataset.xaviMenuAction = action;

        const icon = item?.icon ? String(item.icon) : '';
        if (icon) {
            const iconEl = document.createElement('span');
            iconEl.className = 'start-menu-icon';
            iconEl.textContent = icon;
            btn.appendChild(iconEl);
        }

        const labelEl = document.createElement('span');
        labelEl.className = 'start-menu-label';
        labelEl.textContent = item?.label ? String(item.label) : action;
        btn.appendChild(labelEl);

        if (item?.id) {
            btn.dataset.xaviMenuItemId = String(item.id);
        }
        if (item?.labelWhenHidden) btn.dataset.labelWhenHidden = String(item.labelWhenHidden);
        if (item?.labelWhenVisible) btn.dataset.labelWhenVisible = String(item.labelWhenVisible);
        if (item?.labelWhenEnabled) btn.dataset.labelWhenEnabled = String(item.labelWhenEnabled);
        if (item?.labelWhenDisabled) btn.dataset.labelWhenDisabled = String(item.labelWhenDisabled);

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleStartMenuAction(action);
        });

        return btn;
    }

    updateStartMenuActionLabels() {
        if (!this.startMenuItems) return;
    }

    handleStartMenuAction(action) {
        if (typeof action === 'string' && action.startsWith('launchPanel:')) {
            const panelId = action.slice('launchPanel:'.length).trim();
            if (panelId) {
                const entry = this.getPanelRegistryEntries().find((e) => e.id === panelId);
                if (entry) {
                    this.launchPanelEntry(entry);
                } else {
                    console.warn('[Taskbar] launchPanel: entry not found:', panelId);
                }
            }
            return;
        }

        switch (action) {
            case 'toggleBusPopup':
                if (window.BusMenu && typeof window.BusMenu.togglePopup === 'function') {
                    window.BusMenu.togglePopup();
                } else {
                    console.warn('[Taskbar] BusMenu not ready yet');
                }
                return;
            case 'toggleWorkspaceSettings':
                this.handleStartMenuAction('launchPanel:workspace-settings');
                return;
            default:
                console.warn('[Taskbar] Unknown start menu action:', action);
                return;
        }
    }

    createMenuIcon(icon) {
        const span = document.createElement('span');
        span.className = 'start-menu-icon';
        span.textContent = icon;
        return span;
    }

    getPanelRegistryEntries() {
        if (this.cachedRegistryEntries && !this.registryDirty) {
            return this.cachedRegistryEntries;
        }

        const dedup = new Map();
        const registry = window.XaviPanelRegistry;
        if (registry) {
            registry.list().forEach((entry) => {
                if (entry.requiresAdmin && !this.userIsAdmin) {
                    return;
                }
                if (entry.id === 'playlist-viewer' || entry.id === 'music-player' || entry.id === 'video-player' || entry.id === 'music-visualizer') {
                    return;
                }
                dedup.set(entry.id, entry);
            });
        }

        this.buildLegacyPanelEntries().forEach((entry) => {
            if (!dedup.has(entry.id)) {
                dedup.set(entry.id, entry);
            }
        });

        const entries = Array.from(dedup.values());
        this.cachedRegistryEntries = entries;
        this.registryDirty = false;
        return entries;
    }

    handleRegistryUpdate() {
        this.registryDirty = true;
        this.renderStartMenuItems();
    }

    buildLegacyPanelEntries() {
        const entries = [];
        Object.entries(this.availableTabs).forEach(([id, info]) => {
            if (id === 'playlist-viewer' || id === 'music-player' || id === 'video-player' || id === 'music-visualizer') {
                return;
            }
            if (info.requiresAdmin && !this.userIsAdmin) {
                return;
            }
            entries.push({
                id,
                label: info.label,
                category: 'Apps',
                priority: 5,
                requiresAdmin: info.requiresAdmin,
                maxInstances: 1,
                launch: () => this.launchLegacyPanel(id)
            });
        });
        return entries;
    }

    launchLegacyPanel(tabId) {
        if (tabId === 'playlist-viewer') {
            console.warn('[Taskbar] playlist-viewer is disabled in xavi_social.');
            return null;
        }
        this.addPanel(tabId);
        return null;
    }

    launchPanelEntry(entry) {
        if (!entry) {
            return;
        }

        try {
            const activeSet = this.panelInstanceMap?.get(entry.id);
            const maxInstances = Number.isFinite(entry.maxInstances) ? entry.maxInstances : 0;
            if (maxInstances > 0 && activeSet && activeSet.size >= maxInstances) {
                const existing = activeSet.values().next().value;
                if (existing && typeof existing.bringToFront === 'function') {
                    existing.bringToFront();
                }
                return;
            }

            const attachInstance = (instanceElement) => {
                if (instanceElement instanceof HTMLElement) {
                    this.trackPanelInstance(entry.id, instanceElement, entry);
                }
            };

            const result = entry.launch({ workspace: this.workspace });
            if (result instanceof HTMLElement) {
                attachInstance(result);
            } else if (result && typeof result.then === 'function') {
                result.then((el) => {
                    attachInstance(el);
                }).catch((err) => {
                    console.warn('[Taskbar] Async panel launch failed:', entry.id, err);
                });
            }
        } catch (err) {
            console.error('[Taskbar] Failed to launch panel entry:', entry.id, err);
        }
    }

    trackPanelInstance(entryId, element, entryInfo = null) {
        if (!entryId || !element) {
            return;
        }
        if (!this.panelInstanceMap) {
            this.panelInstanceMap = new Map();
        }
        if (!this.panelInstanceMap.has(entryId)) {
            this.panelInstanceMap.set(entryId, new Set());
        }
        this.panelInstanceMap.get(entryId).add(element);
        this.registerTaskviewEntry(entryId, entryInfo, element);

        const cleanup = () => {
            if (cleanup._done) {
                return;
            }
            cleanup._done = true;
            const set = this.panelInstanceMap?.get(entryId);
            if (!set) return;
            set.delete(element);
            if (!set.size) {
                this.panelInstanceMap.delete(entryId);
            }
            this.unregisterTaskviewEntryByElement(element);
        };

        element.addEventListener('panel-closed', cleanup, { once: true });

        if (typeof MutationObserver !== 'undefined') {
            const observer = new MutationObserver(() => {
                if (!element.isConnected) {
                    observer.disconnect();
                    cleanup();
                }
            });
            observer.observe(document.body || document.documentElement, {
                childList: true,
                subtree: true
            });
        }
    }

    registerTaskviewEntry(entryId, entryInfo, element, options = {}) {
        if (!element && !entryInfo) {
            return null;
        }

        if (!this.taskViewEntries) {
            this.taskViewEntries = new Map();
        }

        const instanceId = options.instanceId || `taskview-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const alreadyExists = this.taskViewEntries.has(instanceId);
        if (alreadyExists) {
            const previous = this.taskViewEntries.get(instanceId);
            if (previous?.element && previous.element !== element) {
                this.taskViewElementMap?.delete(previous.element);
            }
        }

        const normalized = this.normalizeTaskviewEntry(entryId, entryInfo, element, instanceId, options);
        this.taskViewEntries.set(instanceId, normalized);
        if (element) {
            this.taskViewElementMap.set(element, instanceId);
        }

        const shouldActivate = options.setActive === undefined ? !alreadyExists : Boolean(options.setActive);
        if (shouldActivate) {
            this.activeTaskviewId = instanceId;
        }
        this.renderTaskviewGrid();
        return instanceId;
    }

    unregisterTaskviewEntry(instanceId) {
        if (!instanceId || !this.taskViewEntries?.has(instanceId)) {
            return;
        }
        const entry = this.taskViewEntries.get(instanceId);
        this.taskViewEntries.delete(instanceId);
        if (entry?.element) {
            this.taskViewElementMap.delete(entry.element);
        }
        if (this.activeTaskviewId === instanceId) {
            const nextId = this.taskViewEntries?.keys()?.next()?.value || null;
            this.activeTaskviewId = nextId || null;
        }
        this.renderTaskviewGrid();
    }

    unregisterTaskviewEntryByElement(element) {
        if (!element || !this.taskViewElementMap) {
            return;
        }
        const instanceId = this.taskViewElementMap.get(element);
        if (instanceId) {
            this.unregisterTaskviewEntry(instanceId);
        }
    }

    normalizeTaskviewEntry(entryId, entryInfo, element, instanceId, options = {}) {
        const registryInfo = entryInfo || this.getRegistryEntryById(entryId) || this.availableTabs[entryId] || null;
        const label = this.resolveTaskviewLabel(registryInfo, element);
        const icon = this.resolveTaskviewIcon(registryInfo, label);
        const entryTaskConfig = (registryInfo && typeof registryInfo === 'object')
            ? (registryInfo.taskviewConfig || registryInfo.taskview || {})
            : {};
        const mergedConfig = {
            ...entryTaskConfig,
            ...(options.taskviewConfig || {})
        };
        const customFocus = typeof mergedConfig.focus === 'function' ? mergedConfig.focus : null;
        const customClose = typeof mergedConfig.close === 'function' ? mergedConfig.close : null;
        const customControls = Array.isArray(mergedConfig.controls) ? mergedConfig.controls.filter(Boolean) : null;
        return {
            id: instanceId,
            entryId,
            element,
            label,
            icon,
            section: element?.dataset?.section || null,
            taskviewConfig: mergedConfig,
            customFocus,
            customClose,
            customControls
        };
    }

    resolveTaskviewLabel(entryInfo, element) {
        if (entryInfo?.label) {
            return entryInfo.label;
        }
        if (element?.dataset?.panelTitle) {
            return element.dataset.panelTitle;
        }
        const attrTitle = element?.getAttribute?.('panel-title');
        if (attrTitle) {
            return attrTitle;
        }
        return 'Floating Panel';
    }

    resolveTaskviewIcon(entryInfo, label) {
        if (entryInfo?.icon) {
            return entryInfo.icon;
        }
        const emoji = this.extractLeadingEmoji(label);
        if (emoji) {
            return emoji;
        }
        return '🧩';
    }

    extractLeadingEmoji(label) {
        if (!label) {
            return '';
        }
        const firstChar = label.trim().charAt(0);
        if (!firstChar) {
            return '';
        }
        const code = firstChar.codePointAt(0);
        if (!code) {
            return '';
        }
        // Rough heuristic: treat non-alphanumeric leading char as icon candidate
        if (/^[A-Za-z0-9]$/.test(firstChar)) {
            return '';
        }
        return firstChar;
    }

    getRegistryEntryById(entryId) {
        if (!entryId) {
            return null;
        }
        const entries = this.getPanelRegistryEntries();
        return entries.find((entry) => entry.id === entryId) || null;
    }

    closeTaskviewPopover() {
        if (!this.taskviewPopover) {
            return;
        }
        this.taskviewPopover.classList.remove('open');
        this.taskviewPopover.style.left = '';
        this.taskviewPopover.style.top = '';
        this.taskviewPopover.style.visibility = '';
        this.taskviewPopover.innerHTML = '';
        this._taskviewPopoverOpenFor = null;
    }

    sendTaskviewEntryToBack(instanceId) {
        if (!instanceId) return;
        const entry = this.taskViewEntries?.get(instanceId);
        const element = entry?.element || null;
        if (!element) return;

        if (typeof element.sendToBack === 'function') {
            element.sendToBack();
            return;
        }
        if (window.ZIndexManager && typeof window.ZIndexManager.sendGridPanelToBack === 'function') {
            window.ZIndexManager.sendGridPanelToBack(element);
            return;
        }
        if (window.ZIndexManager && typeof window.ZIndexManager.get === 'function') {
            element.style.zIndex = String(window.ZIndexManager.get('GRID_PANELS_BASE'));
            return;
        }
        element.style.zIndex = '1400';
    }

    openTaskviewPopover(instanceId, anchorEl) {
        if (!this.taskviewPopover || !instanceId) {
            return;
        }

        if (this._taskviewPopoverOpenFor === instanceId && this.taskviewPopover.classList.contains('open')) {
            this.closeTaskviewPopover();
            return;
        }

        const entry = this.taskViewEntries?.get(instanceId);
        if (!entry) {
            this.closeTaskviewPopover();
            return;
        }

        const makeBtn = (icon, label, handler, opts = {}) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `popover-btn${opts.danger ? ' danger' : ''}`;
            btn.innerHTML = `<span class="popover-icon">${icon}</span><span>${label}</span>`;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                try {
                    handler();
                } finally {
                    this.closeTaskviewPopover();
                }
            });
            return btn;
        };

        this.taskviewPopover.innerHTML = '';

        const taskviewConfig = (entry.taskviewConfig && typeof entry.taskviewConfig === 'object') ? entry.taskviewConfig : {};
        const seen = new Set();

        const addAction = (key, icon, label, handler, opts = {}) => {
            if (!key || seen.has(key)) return;
            seen.add(key);
            this.taskviewPopover.appendChild(makeBtn(icon, label, handler, opts));
        };

        // Core actions (always available)
        addAction('foreground', '⬆', 'Foreground', () => this.focusTaskviewEntry(instanceId));
        addAction('background', '⬇', 'Background', () => this.sendTaskviewEntryToBack(instanceId));

        // Module-provided controls (legacy+current API)
        const controls = Array.isArray(taskviewConfig.controls) ? taskviewConfig.controls : [];
        controls.forEach((controlKey) => {
            switch (controlKey) {
                case 'snap-left':
                    addAction('snap-left', '⬅', 'Snap Left', () => this.snapTaskviewPanel(instanceId, 'left'));
                    break;
                case 'snap-center':
                    addAction('snap-center', '⬆', 'Snap Center', () => this.snapTaskviewPanel(instanceId, 'center'));
                    break;
                case 'snap-right':
                    addAction('snap-right', '➡', 'Snap Right', () => this.snapTaskviewPanel(instanceId, 'right'));
                    break;
                case 'minimize':
                    addAction('minimize', '−', 'Minimize', () => this.minimizeTaskviewPanel(instanceId));
                    break;
                case 'maximize':
                    // handled below (restore-aware)
                    break;
                case 'close':
                    addAction('close', '×', 'Close', () => this.closeTaskviewEntry(instanceId), { danger: true });
                    break;
                default:
                    break;
            }
        });

        // Restore/Maximize (restore-aware)
        const element = entry.element || null;
        const isMaximized = element?.dataset?.maximized === 'true';
        if (isMaximized && typeof element?.restorePanel === 'function') {
            addAction('restore', '❐', 'Restore', () => element.restorePanel());
        } else {
            const label = (entry.entryId === 'playlist-viewer') ? 'Maximize / Restore' : 'Maximize';
            addAction('maximize', '□', label, () => this.maximizeTaskviewPanel(instanceId));
        }

        // If module didn't include minimize/close in controls, still provide standard window actions.
        addAction('minimize', '−', 'Minimize', () => this.minimizeTaskviewPanel(instanceId));
        addAction('close', '×', 'Close', () => this.closeTaskviewEntry(instanceId), { danger: true });

        // Fully custom extra actions (functions, provided by modules at runtime)
        if (Array.isArray(taskviewConfig.actions)) {
            taskviewConfig.actions.forEach((action) => {
                if (!action || typeof action !== 'object') return;
                const id = typeof action.id === 'string' ? action.id : null;
                const label = typeof action.label === 'string' ? action.label : null;
                const icon = typeof action.icon === 'string' ? action.icon : '•';
                const onClick = action.onClick || action.handler;
                if (!id || !label || typeof onClick !== 'function') return;
                addAction(`custom:${id}`, icon, label, () => onClick({ instanceId, entry, element }), { danger: Boolean(action.danger) });
            });
        }

        // Stop propagation so global outside-click closers don't immediately close us.
        this.taskviewPopover.onclick = (e) => e.stopPropagation();

        const rect = anchorEl?.getBoundingClientRect?.() || null;
        const margin = 8;
        this.taskviewPopover.style.left = '0px';
        this.taskviewPopover.style.top = '0px';
        this.taskviewPopover.style.visibility = 'hidden';
        this.taskviewPopover.classList.add('open');

        const popRect = this.taskviewPopover.getBoundingClientRect();
        const vw = window.innerWidth || document.documentElement.clientWidth || 0;
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;

        let left = margin;
        let top = Math.max(margin, vh - popRect.height - margin);

        if (rect) {
            left = Math.min(Math.max(rect.left, margin), Math.max(margin, vw - popRect.width - margin));

            const aboveTop = rect.top - popRect.height - margin;
            const belowTop = rect.bottom + margin;
            top = aboveTop >= margin
                ? aboveTop
                : Math.min(belowTop, Math.max(margin, vh - popRect.height - margin));
        }

        this.taskviewPopover.style.left = `${Math.round(left)}px`;
        this.taskviewPopover.style.top = `${Math.round(top)}px`;
        this.taskviewPopover.style.visibility = 'visible';
        this._taskviewPopoverOpenFor = instanceId;
    }

    renderTaskviewGrid() {
        const grid = this.taskviewGrid;
        if (!grid) {
            return;
        }

        grid.innerHTML = '';
        const entries = this.taskViewEntries ? Array.from(this.taskViewEntries.values()) : [];
        if (!entries.length) {
            grid.classList.add('empty');
            return;
        }

        grid.classList.remove('empty');
        const fragment = document.createDocumentFragment();
        entries.forEach((entry) => {
            const tile = document.createElement('div');
            tile.className = 'taskview-tile';
            tile.dataset.taskviewId = entry.id;
            if (entry.id === this.activeTaskviewId) {
                tile.classList.add('active');
            }

            // Left side: Panel info (spans both rows)
            const info = document.createElement('div');
            info.className = 'taskview-tile-info';
            
            const header = document.createElement('div');
            header.className = 'taskview-tile-header';
            
            const iconSpan = document.createElement('span');
            iconSpan.className = 'taskview-icon';
            iconSpan.textContent = entry.icon || '🧩';

            const labelSpan = document.createElement('span');
            labelSpan.className = 'taskview-label';
            labelSpan.textContent = entry.label;

            header.appendChild(iconSpan);
            header.appendChild(labelSpan);
            info.appendChild(header);

            // Click on entry to open action popover
            info.tabIndex = 0;
            info.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openTaskviewPopover(entry.id, info);
            });
            info.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openTaskviewPopover(entry.id, info);
                }
            });

            tile.appendChild(info);
            fragment.appendChild(tile);
        });

        grid.appendChild(fragment);
    }

    createTaskviewButton(text, title, className) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `taskview-btn ${className}`;
        btn.textContent = text;
        btn.title = title;
        return btn;
    }

    buildTaskviewControl(controlKey, entry) {
        const instanceId = entry?.id || entry?.entryId || entry;
        const entryType = entry?.entryId || null;
        switch (controlKey) {
            case 'snap-left': {
                const btn = this.createTaskviewButton('⬅', 'Snap to left third', 'snap-left');
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.snapTaskviewPanel(instanceId, 'left');
                });
                return btn;
            }
            case 'snap-center': {
                const btn = this.createTaskviewButton('⬆', 'Snap to center third', 'snap-center');
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.snapTaskviewPanel(instanceId, 'center');
                });
                return btn;
            }
            case 'snap-right': {
                const btn = this.createTaskviewButton('➡', 'Snap to right third', 'snap-right');
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.snapTaskviewPanel(instanceId, 'right');
                });
                return btn;
            }
            case 'playlist-width-peek': {
                if (entryType !== 'playlist-viewer') {
                    return null;
                }
                return this.buildPlaylistWidthButton('S', 'Narrow playlist slideout', 'peek');
            }
            case 'playlist-width-medium': {
                if (entryType !== 'playlist-viewer') {
                    return null;
                }
                return this.buildPlaylistWidthButton('M', 'Medium playlist width', 'medium');
            }
            case 'playlist-width-wide': {
                if (entryType !== 'playlist-viewer') {
                    return null;
                }
                return this.buildPlaylistWidthButton('L', 'Maximize playlist width', 'wide');
            }
            case 'minimize': {
                const btn = this.createTaskviewButton('−', 'Minimize panel', 'minimize');
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.minimizeTaskviewPanel(instanceId);
                });
                return btn;
            }
            case 'maximize': {
                const btn = this.createTaskviewButton('□', 'Maximize panel', 'maximize');
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.maximizeTaskviewPanel(instanceId);
                });
                return btn;
            }
            case 'close': {
                const btn = this.createTaskviewButton('×', 'Close panel', 'close');
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.closeTaskviewEntry(instanceId);
                });
                return btn;
            }
            default:
                return null;
        }
    }

    buildPlaylistWidthButton(label, title, preset) {
        const btn = this.createTaskviewButton(label, title, `playlist-width-${preset}`);
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.applyPlaylistOverlayWidthPreset(preset);
        });
        return btn;
    }

    snapTaskviewPanel(instanceId, position) {
        if (!instanceId) return;
        const entry = this.taskViewEntries?.get(instanceId);
        if (!entry || !entry.element) return;

        if (typeof entry.element.snapToThird === 'function') {
            entry.element.snapToThird(position);
        }
    }

    minimizeTaskviewPanel(instanceId) {
        if (!instanceId) return;
        const entry = this.taskViewEntries?.get(instanceId);
        if (!entry) return;

        const taskviewConfig = (entry.taskviewConfig && typeof entry.taskviewConfig === 'object') ? entry.taskviewConfig : null;
        if (taskviewConfig && typeof taskviewConfig.minimize === 'function') {
            taskviewConfig.minimize({ instanceId, entry, element: entry.element || null });
            return;
        }
        if (entry.entryId === 'playlist-viewer') {
            this.minimizePlaylistOverlay();
            return;
        }
        if (!entry.element) return;

        if (typeof entry.element.minimizePanel === 'function') {
            entry.element.minimizePanel();
        } else {
            entry.element.style.display = 'none';
        }
    }

    maximizeTaskviewPanel(instanceId) {
        if (!instanceId) return;
        const entry = this.taskViewEntries?.get(instanceId);
        if (!entry) return;

        const taskviewConfig = (entry.taskviewConfig && typeof entry.taskviewConfig === 'object') ? entry.taskviewConfig : null;
        if (taskviewConfig && typeof taskviewConfig.maximize === 'function') {
            taskviewConfig.maximize({ instanceId, entry, element: entry.element || null });
            return;
        }

        if (entry.entryId === 'playlist-viewer') {
            const state = this.specialComponents['playlist-viewer'];
            if (state?.isMinimized) {
                this.restorePlaylistOverlayFromMinimize();
            } else {
                this.applyPlaylistOverlayWidthPreset('wide');
            }
            return;
        }

        if (!entry.element) return;

        if (typeof entry.element.maximizePanel === 'function') {
            entry.element.maximizePanel();
        }
    }

    setActiveTaskview(instanceId) {
        if (!this.taskViewEntries?.size) {
            this.activeTaskviewId = null;
            this.renderTaskviewGrid();
            return;
        }

        if (instanceId && this.taskViewEntries.has(instanceId)) {
            this.activeTaskviewId = instanceId;
        } else if (!this.taskViewEntries.has(this.activeTaskviewId)) {
            const nextId = this.taskViewEntries.keys().next().value;
            this.activeTaskviewId = nextId;
        }
        this.renderTaskviewGrid();
    }

    focusTaskviewEntry(instanceId) {
        if (!instanceId) {
            return;
        }
        const entry = this.taskViewEntries?.get(instanceId);
        if (!entry) {
            return;
        }

        if (entry.customFocus) {
            try {
                entry.customFocus();
            } catch (err) {
                console.warn('[Taskbar] Custom focus handler failed:', err);
            }
            this.setActiveTaskview(instanceId);
            return;
        }

        const element = entry.element;
        if (!element || !element.isConnected) {
            this.unregisterTaskviewEntry(instanceId);
            return;
        }

        if (typeof element.focusPanel === 'function') {
            element.focusPanel();
        } else if (typeof element.bringToFront === 'function') {
            element.bringToFront();
        } else {
            element.dispatchEvent(new CustomEvent('floating-panel-focus', {
                bubbles: true,
                composed: true,
                detail: { panelId: entry.entryId, panelElement: element }
            }));
        }

        if (typeof element.scrollIntoView === 'function') {
            element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        this.setActiveTaskview(instanceId);
    }

    closeTaskviewEntry(instanceId) {
        if (!instanceId) {
            return;
        }
        const entry = this.taskViewEntries?.get(instanceId);
        if (!entry) {
            return;
        }

        if (entry.customClose) {
            try {
                const result = entry.customClose(instanceId);
                if (result && typeof result.then === 'function') {
                    result
                        .then((shouldRemove) => {
                            if (shouldRemove !== false) {
                                this.unregisterTaskviewEntry(instanceId);
                            }
                        })
                        .catch((err) => console.warn('[Taskbar] Custom close handler promise failed:', err));
                } else if (result !== false) {
                    this.unregisterTaskviewEntry(instanceId);
                }
            } catch (err) {
                console.warn('[Taskbar] Custom close handler failed:', err);
                this.unregisterTaskviewEntry(instanceId);
            }
            return;
        }

        if (!entry.element) {
            this.unregisterTaskviewEntry(instanceId);
            return;
        }

        this.requestPanelClose(entry.element);
    }

    requestPanelClose(element) {
        if (!element) {
            return;
        }
        const closeEvent = new CustomEvent('panel-close-request', {
            bubbles: true,
            composed: true,
            cancelable: true
        });
        element.dispatchEvent(closeEvent);
        if (closeEvent.defaultPrevented) {
            return;
        }
        const closeButton = element.shadowRoot?.getElementById?.('close-button');
        if (closeButton) {
            closeButton.click();
            return;
        }
        element.remove();
    }

    handleFloatingPanelFocus(event) {
        const panel = event?.detail?.panelElement || event?.target;
        if (!(panel instanceof HTMLElement)) {
            return;
        }
        
        const instanceId = this.getTaskviewIdByElement(panel);
        
        if (instanceId) {
            this.setActiveTaskview(instanceId);
        }
    }

    handleFloatingPanelClosed(event) {
        const panel = event?.detail?.panelElement || event?.target;
        if (!(panel instanceof HTMLElement)) {
            return;
        }
        
        const instanceId = this.getTaskviewIdByElement(panel);
        if (instanceId) {
            console.log('[Taskbar] Unregistering closed panel from taskview:', instanceId);
            this.unregisterTaskviewEntry(instanceId);
        }
    }

    getTaskviewIdByElement(element) {
        if (!element || !this.taskViewElementMap) {
            return null;
        }
        return this.taskViewElementMap.get(element) || null;
    }

    showAddPanelModal() {
        if (this.panelSelections.length >= this.MAX_PANELS) {
            return;
        }

        // Build list of available options
        const usedTabs = new Set(this.panelSelections.filter(Boolean));
        const availableOptions = Object.entries(this.availableTabs)
            .filter(([id, info]) => {
                if (usedTabs.has(id)) return false;
                if (info.requiresAdmin && !this.userIsAdmin) return false;
                return true;
            })
            .map(([id, info]) => ({ id, label: info.label, requiresAdmin: info.requiresAdmin }));

        if (!availableOptions.length) {
            alert('No additional panels available to add.');
            return;
        }

        // Create modal backdrop
        const backdrop = document.createElement('div');
        backdrop.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.75);
            z-index: ${window.ZIndexManager ? window.ZIndexManager.get('SYSTEM_MODALS') : 10300};
            display: flex;
            align-items: center;
            justify-content: center;
            backdrop-filter: blur(4px);
        `;

        // Create modal dialog
        const modal = document.createElement('div');
        modal.style.cssText = `
            background: rgba(20, 20, 20, 0.98);
            border: 1px solid rgba(255, 255, 255, 0.25);
            border-radius: 12px;
            padding: 24px;
            max-width: 400px;
            width: 90%;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        `;

        // Modal title
        const title = document.createElement('h3');
        title.textContent = 'Add Panel';
        title.style.cssText = `
            margin: 0 0 16px 0;
            color: #fff;
            font-size: 1.25rem;
            font-weight: 600;
        `;
        modal.appendChild(title);

        // Panel list
        const listContainer = document.createElement('div');
        listContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-bottom: 16px;
        `;

        availableOptions.forEach(option => {
            const button = document.createElement('button');
            button.textContent = option.label;
            button.style.cssText = `
                padding: 12px 16px;
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 8px;
                color: #fff;
                font-size: 0.95rem;
                cursor: pointer;
                text-align: left;
                transition: all 0.2s ease;
            `;
            button.addEventListener('mouseenter', () => {
                button.style.background = 'rgba(74, 158, 255, 0.25)';
                button.style.borderColor = '#4a9eff';
            });
            button.addEventListener('mouseleave', () => {
                button.style.background = 'rgba(255, 255, 255, 0.08)';
                button.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            });
            button.addEventListener('click', () => {
                this.panelSelections.push(option.id);
                this.panelLayouts.push(null);
                this.render();
                document.body.removeChild(backdrop);
            });
            listContainer.appendChild(button);
        });

        modal.appendChild(listContainer);

        // Cancel button
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = `
            width: 100%;
            padding: 10px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 8px;
            color: rgba(255, 255, 255, 0.7);
            cursor: pointer;
            font-size: 0.9rem;
            transition: all 0.2s ease;
        `;
        cancelBtn.addEventListener('mouseenter', () => {
            cancelBtn.style.background = 'rgba(255, 255, 255, 0.1)';
        });
        cancelBtn.addEventListener('mouseleave', () => {
            cancelBtn.style.background = 'rgba(255, 255, 255, 0.05)';
        });
        cancelBtn.addEventListener('click', () => {
            document.body.removeChild(backdrop);
        });
        modal.appendChild(cancelBtn);

        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        // Close on backdrop click
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                document.body.removeChild(backdrop);
            }
        });

        // Close on Escape
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                document.body.removeChild(backdrop);
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }

    addPanel(tabId = null) {
        const handlePlaylistOverlay = () => {
            this.setupPlaylistOverlay();
            this.openPlaylistOverlay();
        };

        if (tabId === 'playlist-viewer') {
            handlePlaylistOverlay();
            return;
        }

        if (this.panelSelections.length >= this.MAX_PANELS) {
            console.warn('Maximum panel limit reached');
            return;
        }

        // If no tabId provided, find next available
        if (!tabId) {
            tabId = this.findNextAvailableTab(true);
        }

        if (tabId === 'playlist-viewer') {
            handlePlaylistOverlay();
            return;
        }

        this.panelSelections.push(tabId ?? '');
        this.panelLayouts.push(null);
        this.render();
        this.saveState();
    }

    render() {
        if (!this.contentArea) return;

        // Hard-disable legacy tab-panels.
        if (this.disableTabPanels) {
            const existingPanels = this.contentArea.querySelectorAll('.tab-panel');
            existingPanels.forEach((panel) => panel.remove());
            // Keep background layer if another module expects it, but do not create/append tab panels.
            this.panelElements = [];
            return;
        }

        this.normalizePrimaryPanel();
        this.syncLayoutsWithPanels();
        this.syncLayoutPanelsToTaskviewEntries();
        this.updateControlsState();

        const fragment = document.createDocumentFragment();
        const activeSpecial = new Set();
        this.panelElements = new Array(this.panelSelections.length);

        this.panelSelections.forEach((tabId, index) => {
            // Skip playlist-viewer as it's handled by the overlay
            if (tabId === 'playlist-viewer') {
                return;
            }

            const panel = document.createElement('div');
            panel.className = 'tab-panel';
            panel.setAttribute('data-panel-index', index.toString());

            const layout = this.ensurePanelLayout(index);

            const handle = document.createElement('div');
            handle.className = 'panel-handle';
            handle.title = index === 0 ? 'Primary panel drag handle' : `Panel ${index + 1} drag handle`;
            panel.appendChild(handle);

            const body = document.createElement('div');
            body.className = 'panel-body';

            if (tabId && this.availableTabs[tabId]) {
                const info = this.availableTabs[tabId];
                const component = this.getComponentForTab(tabId, info);
                if (component) {
                    if (tabId === 'video-player') {
                        activeSpecial.add('video-player');
                    }

                    if (info.component === 'media-search') {
                        component.setAttribute('inline-mode', 'true');
                        if (info.section) {
                            component.setAttribute('section', info.section);
                        }
                    }

                    body.appendChild(component);
                } else {
                    const placeholder = document.createElement('div');
                    placeholder.className = 'panel-placeholder';
                    placeholder.textContent = 'Module unavailable.';
                    body.appendChild(placeholder);
                }
            }

            panel.appendChild(body);
            this.appendResizeHandles(panel, index);
            fragment.appendChild(panel);

            this.panelElements[index] = panel;
            this.applyPanelLayout(index, layout);

            // Hide panel if minimized
            if (layout.minimized) {
                panel.style.display = 'none';
            }

            this.attachDragHandlers(panel, handle, index);
        });

        // Ensure the shared background layer stays in tab-system (not contentArea)
        const bgLayer = this.ensureBackgroundLayer();
        // No need to move it - it should already be in tab-system as first child

        // Remove any stale panels but leave the drop indicator in place
        const existingPanels = this.contentArea.querySelectorAll('.tab-panel');
        existingPanels.forEach((panel) => panel.remove());

        this.contentArea.appendChild(fragment);

        this.ensureDropIndicator();
        
        // Wait for CSS layout to complete before measuring grid
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this.requestGridMetricsUpdate(true);
            });
        });
        
        this.observeResizes();

        this.restoreInactiveSpecialComponents(activeSpecial);
        this.applyLayoutMode();
        this.notifyComponents();
        this.saveState();
    }

    ensureBackgroundLayer() {
        if (!this.contentArea) {
            return null;
        }

        let bgLayer = this.contentArea.querySelector('.xavi-bg-layer');
        if (!bgLayer) {
            bgLayer = document.createElement('div');
            bgLayer.className = 'xavi-bg-layer';
            // Insert as first child of content-area
            this.contentArea.insertBefore(bgLayer, this.contentArea.firstChild || null);
        }

        // Ensure required children exist even if another module created the layer first.
        let background = bgLayer.querySelector('#xavi-social-background');
        if (!background) {
            background = document.createElement('div');
            background.id = 'xavi-social-background';
            background.setAttribute('aria-hidden', 'true');
            bgLayer.insertBefore(background, bgLayer.firstChild || null);
        }

        let grid = bgLayer.querySelector('#workspace-grid');
        if (!grid) {
            grid = document.createElement('div');
            grid.id = 'workspace-grid';
            bgLayer.appendChild(grid);
        }

        this.applyBackgroundLayerStyles(bgLayer);
        return bgLayer;
    }

    applyBackgroundLayerStyles(bgLayer) {
        if (!bgLayer) {
            return;
        }

        const layerStyle = bgLayer.style;
        layerStyle.gridColumn = '1 / -1';
        layerStyle.gridRow = '1 / -1';
        layerStyle.position = 'relative';
        layerStyle.pointerEvents = 'auto';
        layerStyle.zIndex = '0';

        const background = bgLayer.querySelector('#xavi-social-background');
        if (background) {
            const bgStyle = background.style;
            bgStyle.position = 'absolute';
            bgStyle.inset = '0';
            bgStyle.pointerEvents = 'auto';
            bgStyle.zIndex = '0';
            bgStyle.width = '100%';
            bgStyle.height = '100%';
            bgStyle.background = 'transparent';
        }

        const grid = bgLayer.querySelector('#workspace-grid');
        if (grid) {
            const gridStyle = grid.style;
            gridStyle.position = 'absolute';
            gridStyle.inset = '0';
            gridStyle.pointerEvents = 'none';
            gridStyle.zIndex = '1';
            gridStyle.width = '100%';
            gridStyle.height = '100%';
            gridStyle.backgroundColor = 'rgba(0, 0, 0, 0)';
            gridStyle.backgroundImage = 'none';
            gridStyle.backgroundSize = 'auto';
            gridStyle.backgroundPosition = '0 0';
            gridStyle.backgroundRepeat = 'repeat';
        }
    }

    renderPanelSelectors() {
        const strip = this.panelTabStrip || this.panelButtonsContainer;
        if (!strip) {
            return;
        }

        const hasNonPlaylistTabs = this.panelSelections.some((tabId) => tabId && tabId !== 'playlist-viewer');
        if (!hasNonPlaylistTabs) {
            strip.innerHTML = '';
            strip.style.display = 'none';
            strip.setAttribute('aria-hidden', 'true');
            return;
        }

        strip.style.display = '';
        strip.removeAttribute('aria-hidden');
        strip.innerHTML = '';

        this.panelSelections.forEach((tabId, index) => {
            const button = document.createElement('button');
            button.className = 'panel-tab-btn';
            button.setAttribute('data-panel-index', index.toString());
            button.setAttribute('data-panel-id', tabId);

            const info = this.availableTabs[tabId];
            const label = info ? info.label : '—';
            
            const labelSpan = document.createElement('span');
            labelSpan.textContent = label;
            button.appendChild(labelSpan);

            // Special handling for the Settings overlay (tabId remains 'playlist-viewer')
            if (tabId === 'playlist-viewer') {
                // No panel buttons for Settings - it's an overlay
                if (this.specialComponents['playlist-viewer'].isOpen) {
                    button.classList.add('active');
                }
                button.addEventListener('click', () => {
                    console.log('Settings overlay button clicked in taskbar');
                    this.setupPlaylistOverlay();
                    this.togglePlaylistOverlay();
                });
            } else {
                const buttonGroup = document.createElement('span');
                buttonGroup.style.display = 'inline-flex';
                buttonGroup.style.gap = '4px';

                // Add minimize/maximize button
                const minimizeBtn = document.createElement('span');
                minimizeBtn.className = 'minimize-btn';
                const isMinimized = this.panelLayouts[index]?.minimized;
                minimizeBtn.textContent = isMinimized ? '□' : '_'; // □ for maximize, _ for minimize
                minimizeBtn.title = isMinimized ? 'Restore panel' : 'Minimize panel';
                minimizeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const layout = this.panelLayouts[index];
                    if (layout?.minimized) {
                        this.restorePanel(index);
                    } else {
                        this.minimizePanel(index);
                    }
                });
                buttonGroup.appendChild(minimizeBtn);

                // Add close button (X)
                const closeBtn = document.createElement('span');
                closeBtn.className = 'close-btn';
                closeBtn.textContent = '×';
                closeBtn.title = 'Close panel';
                closeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.removePanel(index);
                });
                buttonGroup.appendChild(closeBtn);

                button.appendChild(buttonGroup);

                // Main button click toggles minimize/restore
                button.addEventListener('click', () => {
                    const layout = this.panelLayouts[index];
                    if (layout?.minimized) {
                        this.restorePanel(index);
                    } else {
                        this.minimizePanel(index);
                    }
                });

                // Update button state if minimized
                if (this.panelLayouts[index]?.minimized) {
                    button.classList.add('minimized');
                }
            }

            strip.appendChild(button);
        });
    }

    removePanel(index) {
        if (index < 0 || index >= this.panelSelections.length) {
            return;
        }

        this.panelSelections.splice(index, 1);
        this.panelLayouts.splice(index, 1);
        this.render();
        this.saveState();
    }

    minimizePanel(index) {
        if (index < 0 || index >= this.panelSelections.length) {
            return;
        }

        const layout = this.panelLayouts[index];
        if (!layout) return;

        // Save current layout state before minimizing
        layout.minimized = true;
        layout.beforeMinimize = {
            x: layout.x,
            y: layout.y,
            width: layout.width,
            height: layout.height
        };

        // Hide the panel element
        if (this.panelElements[index]) {
            this.panelElements[index].style.display = 'none';
        }

        this.saveState();
        this.updateTaskbarButtonState(index, true);
    }

    restorePanel(index) {
        if (index < 0 || index >= this.panelSelections.length) {
            return;
        }

        const layout = this.panelLayouts[index];
        if (!layout || !layout.minimized) return;

        // Restore previous layout position
        if (layout.beforeMinimize) {
            layout.x = layout.beforeMinimize.x;
            layout.y = layout.beforeMinimize.y;
            layout.width = layout.beforeMinimize.width;
            layout.height = layout.beforeMinimize.height;
            delete layout.beforeMinimize;
        }
        layout.minimized = false;

        // Show the panel element
        if (this.panelElements[index]) {
            this.panelElements[index].style.display = '';
            this.panelElements[index].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        this.saveState();
        this.updateTaskbarButtonState(index, false);
    }

    updateTaskbarButtonState(index, isMinimized) {
        const container = this.panelTabStrip || this.panelButtonsContainer;
        const button = container?.querySelector(`[data-panel-index="${index}"]`);
        if (!button) return;

        if (isMinimized) {
            button.classList.add('minimized');
        } else {
            button.classList.remove('minimized');
        }

        // Update minimize button icon and title
        const minimizeBtn = button.querySelector('.minimize-btn');
        if (minimizeBtn) {
            minimizeBtn.textContent = isMinimized ? '□' : '_'; // □ for maximize, _ for minimize
            minimizeBtn.title = isMinimized ? 'Restore panel' : 'Minimize panel';
        }
    }

    minimizePanel(index) {
        if (index < 0 || index >= this.panelSelections.length) {
            return;
        }

        const layout = this.panelLayouts[index];
        if (!layout) return;

        // Save current layout state before minimizing
        layout.minimized = true;
        layout.beforeMinimize = {
            x: layout.x,
            y: layout.y,
            width: layout.width,
            height: layout.height
        };

        // Hide the panel element
        if (this.panelElements[index]) {
            this.panelElements[index].style.display = 'none';
        }

        this.saveState();
        this.updateTaskbarButtonState(index, true);
    }

    restorePanel(index) {
        if (index < 0 || index >= this.panelSelections.length) {
            return;
        }

        const layout = this.panelLayouts[index];
        if (!layout || !layout.minimized) return;

        // Restore previous layout position
        if (layout.beforeMinimize) {
            layout.x = layout.beforeMinimize.x;
            layout.y = layout.beforeMinimize.y;
            layout.width = layout.beforeMinimize.width;
            layout.height = layout.beforeMinimize.height;
            delete layout.beforeMinimize;
        }
        layout.minimized = false;

        // Show the panel element
        if (this.panelElements[index]) {
            this.panelElements[index].style.display = '';
            this.panelElements[index].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        this.saveState();
        this.updateTaskbarButtonState(index, false);
    }

    updateTaskbarButtonState(index, isMinimized) {
        const container = this.panelTabStrip || this.panelButtonsContainer;
        const button = container?.querySelector(`[data-panel-index="${index}"]`);
        if (!button) return;

        if (isMinimized) {
            button.classList.add('minimized');
        } else {
            button.classList.remove('minimized');
        }

        // Update minimize button icon and title
        const minimizeBtn = button.querySelector('.minimize-btn');
        if (minimizeBtn) {
            minimizeBtn.textContent = isMinimized ? '□' : '_'; // □ for maximize, _ for minimize
            minimizeBtn.title = isMinimized ? 'Restore panel' : 'Minimize panel';
        }
    }

    normalizePrimaryPanel() {
        if (!this.panelSelections.length) {
            this.panelSelections = ['playlist-viewer'];
            return;
        }

        if (!this.panelSelections[0]) {
            const replacement = this.findNextAvailableTab(false) || 'playlist-viewer';
            this.panelSelections[0] = replacement;
        }
    }

    syncLayoutsWithPanels() {
        const layouts = new Array(this.panelSelections.length).fill(null);
        for (let i = 0; i < layouts.length; i += 1) {
            const existing = this.panelLayouts[i];
            layouts[i] = existing ? this.cloneLayout(existing) : null;
        }
        this.panelLayouts = layouts;
    }

    trimTrailingEmptyPanels() {
        while (this.panelSelections.length > 1 && this.panelSelections[this.panelSelections.length - 1] === '') {
            this.panelSelections.pop();
            this.panelLayouts.pop();
        }
    }

    updateControlsState() {
        if (this.addPanelBtn) {
            this.addPanelBtn.disabled = this.panelSelections.length >= this.MAX_PANELS;
        }
    }

    getPanelOptions(panelIndex) {
        const options = [];
        if (panelIndex > 0) {
            options.push({ id: '', label: '— None —', disabled: false });
        }

        const currentValue = this.panelSelections[panelIndex] ?? '';
        const usedTabs = new Set(
            this.panelSelections
                .map((id, idx) => (idx === panelIndex ? null : id))
                .filter(Boolean)
        );

        Object.entries(this.availableTabs).forEach(([id, info]) => {
            // Skip admin-only tabs if user is not admin
            if (info.requiresAdmin && !this.userIsAdmin) {
                return;
            }

            const isCurrent = id === currentValue;
            if (!isCurrent && usedTabs.has(id)) {
                return;
            }

            options.push({
                id,
                label: info.label,
                disabled: false
            });
        });

        return options;
    }

    handlePanelSelect(panelIndex, tabId) {
        if (panelIndex === 0 && !tabId) {
            return;
        }

        if (tabId && !this.availableTabs[tabId]) {
            return;
        }

        if (this.panelSelections[panelIndex] === tabId) {
            return;
        }

        const previousValue = this.panelSelections[panelIndex];

        if (tabId) {
            this.panelSelections = this.panelSelections.map((id, idx) => {
                if (idx === panelIndex) {
                    return id;
                }
                if (id === tabId) {
                    return previousValue || '';
                }
                return id;
            });

            this.panelSelections[panelIndex] = tabId;
        } else if (panelIndex === 0) {
            const fallback = this.findNextAvailableTab(false) || 'playlist-viewer';
            this.panelSelections[panelIndex] = fallback;
        } else {
            this.panelSelections.splice(panelIndex, 1);
            this.panelLayouts.splice(panelIndex, 1);
        }

        this.trimTrailingEmptyPanels();
        this.render();
    }

    findNextAvailableTab(allowNone) {
        const preference = [
            'media-search-search',
            'media-search-myplaylist',
            'media-search-cached',
            'playlist-viewer',
            'video-player'
        ];
        const used = new Set(this.panelSelections.filter(Boolean));
        const candidate = preference.find(tab => {
            const tabInfo = this.availableTabs[tab];
            if (!tabInfo || used.has(tab)) return false;
            // Skip admin-only tabs if user is not admin
            if (tabInfo.requiresAdmin && !this.userIsAdmin) return false;
            return true;
        });
        if (candidate) {
            return candidate;
        }
        return allowNone ? '' : 'playlist-viewer';
    }

    attachDragHandlers(panel, handle, index) {
        handle.addEventListener('pointerdown', (event) => {
            if (event.button !== 0 && event.pointerType !== 'touch' && event.pointerType !== 'pen') {
                return;
            }
            if (this.activeInteraction) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            this.startPanelDrag(index, handle, event);
        });
    }

    appendResizeHandles(panel, index) {
        const edges = ['top', 'right', 'bottom', 'left'];
        edges.forEach((edge) => {
            const handle = document.createElement('div');
            handle.className = `resize-handle resize-${edge}`;
            panel.appendChild(handle);
            this.attachResizeHandler(handle, index, edge);
        });
    }

    attachResizeHandler(handle, index, edge) {
        handle.addEventListener('pointerdown', (event) => {
            if (event.button !== 0 && event.pointerType !== 'touch' && event.pointerType !== 'pen') {
                return;
            }
            if (this.activeInteraction) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            this.startPanelResize(index, handle, edge, event);
        });
    }

    restoreAffectedLayouts(state) {
        if (!state?.affectedLayouts) {
            return;
        }

        state.affectedLayouts.forEach((layout, idx) => {
            const snapshot = this.cloneLayout(layout);
            this.panelLayouts[idx] = this.cloneLayout(snapshot);
            const panel = this.panelElements[idx];
            if (panel) {
                this.applyPanelLayout(idx, snapshot);
                panel.classList.remove('layout-invalid');
            }
        });
    }

    startPanelDrag(index, element, event) {
        const panel = this.panelElements[index];
        const layout = this.ensurePanelLayout(index);
        const metrics = this.getCellMetrics();

        if (!panel || !layout || !metrics) {
            return;
        }

        const pointerCellX = (event.clientX - metrics.rect.left) / metrics.stepX;
        const pointerCellY = (event.clientY - metrics.rect.top) / metrics.stepY;

        const state = {
            type: 'drag',
            index,
            pointerId: event.pointerId,
            offsetX: pointerCellX - (layout.x - 1),
            offsetY: pointerCellY - (layout.y - 1),
            startLayout: this.cloneLayout(layout),
            currentLayout: this.cloneLayout(layout),
            captureElement: element,
            invalid: false
        };

        this.activeInteraction = state;
        panel.classList.add('dragging');
        panel.classList.remove('layout-invalid');
        this.addGlobalPointerListeners();

        if (element.setPointerCapture) {
            try {
                element.setPointerCapture(event.pointerId);
            } catch (captureError) {
                /* ignore pointer capture issues */
            }
        }
    }

    startPanelResize(index, element, edge, event) {
        const panel = this.panelElements[index];
        const layout = this.ensurePanelLayout(index);
        const metrics = this.getCellMetrics();

        if (!panel || !layout || !metrics) {
            return;
        }

        const state = {
            type: 'resize',
            edge,
            index,
            pointerId: event.pointerId,
            startLayout: this.cloneLayout(layout),
            currentLayout: this.cloneLayout(layout),
            startBounds: this.getLayoutBounds(layout),
            captureElement: element,
            invalid: false,
            affectedLayouts: new Map([[index, this.cloneLayout(layout)]])
        };

        this.activeInteraction = state;
        panel.classList.add('resizing');
        panel.classList.remove('layout-invalid');
        this.addGlobalPointerListeners();

        if (element.setPointerCapture) {
            try {
                element.setPointerCapture(event.pointerId);
            } catch (captureError) {
                /* ignore pointer capture issues */
            }
        }
    }

    onPointerMove(event) {
        const state = this.activeInteraction;
        if (!state || state.pointerId !== event.pointerId) {
            return;
        }

        event.preventDefault();

        if (state.type === 'drag') {
            this.updateDragState(event);
        } else if (state.type === 'resize') {
            this.updateResizeState(event);
        }
    }

    onPointerUp(event) {
        const state = this.activeInteraction;
        if (!state || state.pointerId !== event.pointerId) {
            return;
        }

        event.preventDefault();

        const panel = this.panelElements[state.index];
        if (panel) {
            panel.classList.remove('dragging', 'resizing', 'layout-invalid');
        }

        if (state.captureElement && state.captureElement.releasePointerCapture) {
            try {
                state.captureElement.releasePointerCapture(event.pointerId);
            } catch (releaseError) {
                /* ignore pointer release issues */
            }
        }

        if (state.type === 'resize') {
            if (state.invalid || !state.currentLayout) {
                this.restoreAffectedLayouts(state);
                this.panelLayouts[state.index] = this.cloneLayout(state.startLayout);
                this.applyPanelLayout(state.index, state.startLayout);
            } else {
                this.panelLayouts[state.index] = this.cloneLayout(state.currentLayout);
            }
        } else if (state.type === 'drag') {
            if (state.invalid || !state.currentLayout) {
                const resolved = this.resolveDragDrop(state);
                if (!resolved) {
                    this.panelLayouts[state.index] = this.cloneLayout(state.startLayout);
                    this.applyPanelLayout(state.index, state.startLayout);
                }
            } else {
                this.panelLayouts[state.index] = this.cloneLayout(state.currentLayout);
                this.applyPanelLayout(state.index, state.currentLayout);
            }
        }

        this.activeInteraction = null;
        this.removeGlobalPointerListeners();
        this.hideDropIndicator();

        this.saveState();
    }

    updateDragState(event) {
        const state = this.activeInteraction;
        if (!state || state.type !== 'drag') {
            return;
        }

        const metrics = this.getCellMetrics();
        if (!metrics) {
            return;
        }

        const pointerCellX = (event.clientX - metrics.rect.left) / metrics.stepX;
        const pointerCellY = (event.clientY - metrics.rect.top) / metrics.stepY;

        const baseLayout = state.startLayout;
        const width = this.clamp(baseLayout.width, 1, this.gridColumns);
        const height = this.clamp(baseLayout.height, 1, this.gridRows);
        const rawX = pointerCellX - state.offsetX;
        const rawY = pointerCellY - state.offsetY;

        let newX = Math.round(rawX) + 1;
        let newY = Math.round(rawY) + 1;

        const maxX = Math.max(1, this.gridColumns - width + 1);
        const maxY = Math.max(1, this.gridRows - height + 1);

        newX = this.clamp(newX, 1, maxX);
        newY = this.clamp(newY, 1, maxY);

        const candidate = {
            x: newX,
            y: newY,
            width,
            height
        };

        const invalid = !this.isValidLayout(candidate, state.index);
        this.applyPanelLayout(state.index, candidate);
        const panel = this.panelElements[state.index];
        if (panel) {
            panel.classList.toggle('layout-invalid', Boolean(invalid));
        }
        state.currentLayout = this.cloneLayout(candidate);
        state.invalid = invalid;
        this.updateDropIndicator(candidate, invalid);
    }

    updateResizeState(event) {
        const state = this.activeInteraction;
        if (!state || state.type !== 'resize') {
            return;
        }

        this.restoreAffectedLayouts(state);

        const metrics = this.getCellMetrics();
        if (!metrics) {
            return;
        }

    const pointerCellX = (event.clientX - metrics.rect.left) / metrics.stepX;
    const pointerCellY = (event.clientY - metrics.rect.top) / metrics.stepY;

        const candidate = this.cloneLayout(state.startLayout) || { x: 1, y: 1, width: 1, height: 1 };
        const bounds = state.startBounds || this.getLayoutBounds(state.startLayout);

        switch (state.edge) {
            case 'left': {
                let newLeft = Math.round(pointerCellX);
                newLeft = this.clamp(newLeft, 0, bounds.right - 1);
                const newWidth = bounds.right - newLeft;
                candidate.x = newLeft + 1;
                candidate.width = Math.max(1, newWidth);
                break;
            }
            case 'right': {
                let newRight = Math.round(pointerCellX);
                newRight = this.clamp(newRight, bounds.left + 1, this.gridColumns);
                const newWidth = newRight - bounds.left;
                candidate.x = bounds.left + 1;
                candidate.width = Math.max(1, newWidth);
                break;
            }
            case 'top': {
                let newTop = Math.round(pointerCellY);
                newTop = this.clamp(newTop, 0, bounds.bottom - 1);
                const newHeight = bounds.bottom - newTop;
                candidate.y = newTop + 1;
                candidate.height = Math.max(1, newHeight);
                break;
            }
            case 'bottom': {
                let newBottom = Math.round(pointerCellY);
                newBottom = this.clamp(newBottom, bounds.top + 1, this.gridRows);
                const newHeight = newBottom - bounds.top;
                candidate.y = bounds.top + 1;
                candidate.height = Math.max(1, newHeight);
                break;
            }
            default:
                break;
        }

    candidate.width = this.clamp(candidate.width, 1, this.gridColumns);
    candidate.height = this.clamp(candidate.height, 1, this.gridRows);

    const maxX = Math.max(1, this.gridColumns - candidate.width + 1);
    const maxY = Math.max(1, this.gridRows - candidate.height + 1);

    candidate.x = this.clamp(candidate.x, 1, maxX);
    candidate.y = this.clamp(candidate.y, 1, maxY);

        const success = this.adjustNeighborsForResize(state, candidate);
        const panel = this.panelElements[state.index];

        if (success) {
            const clone = this.cloneLayout(candidate);
            this.panelLayouts[state.index] = clone;
            this.applyPanelLayout(state.index, clone);
            if (panel) {
                panel.classList.remove('layout-invalid');
            }
            state.currentLayout = clone;
            state.invalid = false;
            this.updateDropIndicator(clone, false);
        } else {
            if (panel) {
                panel.classList.add('layout-invalid');
            }
            state.currentLayout = this.cloneLayout(candidate);
            state.invalid = true;
            this.updateDropIndicator(candidate, true);
        }
    }

    addGlobalPointerListeners() {
        window.addEventListener('pointermove', this.boundPointerMove);
        window.addEventListener('pointerup', this.boundPointerUp);
        window.addEventListener('pointercancel', this.boundPointerUp);
    }

    removeGlobalPointerListeners() {
        window.removeEventListener('pointermove', this.boundPointerMove);
        window.removeEventListener('pointerup', this.boundPointerUp);
        window.removeEventListener('pointercancel', this.boundPointerUp);
    }

    ensureDropIndicator() {
        if (!this.contentArea) {
            return;
        }

        if (!this.dropIndicator) {
            this.dropIndicator = document.createElement('div');
            this.dropIndicator.className = 'drop-indicator';
        }

        // Always move the drop indicator to the top of the stacking order
        this.contentArea.appendChild(this.dropIndicator);

        this.hideDropIndicator();
    }

    updateDropIndicator(layout, invalid) {
        if (!this.dropIndicator || !layout || !this.contentArea) {
            return;
        }

        const rect = this.getLayoutPixelRect(layout);
        if (!rect) {
            this.hideDropIndicator();
            return;
        }

        this.dropIndicator.style.display = 'block';
        this.dropIndicator.style.left = `${rect.left}px`;
        this.dropIndicator.style.top = `${rect.top}px`;
        this.dropIndicator.style.width = `${rect.width}px`;
        this.dropIndicator.style.height = `${rect.height}px`;
        this.dropIndicator.classList.toggle('invalid', Boolean(invalid));
    }

    hideDropIndicator() {
        if (this.dropIndicator) {
            this.dropIndicator.style.display = 'none';
        }
    }

    applyPanelLayout(index, layout) {
        const panel = this.panelElements[index];
        if (!panel || !layout) {
            return;
        }

        panel.style.gridColumn = `${layout.x} / span ${layout.width}`;
        panel.style.gridRow = `${layout.y} / span ${layout.height}`;
        panel.dataset.gridX = String(layout.x);
        panel.dataset.gridY = String(layout.y);
        panel.dataset.gridWidth = String(layout.width);
        panel.dataset.gridHeight = String(layout.height);
    }

    requestGridMetricsUpdate(force = false) {
        if (force) {
            this.gridMetricsScheduled = false;
            this.clearPendingGridMetricsRetry();
            
            // Even for forced updates, wait for layout to complete
            // Use double requestAnimationFrame to ensure layout is done
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    this.updateGridMetrics();
                });
            });
            return;
        }

        if (this.gridMetricsScheduled) {
            return;
        }

        this.gridMetricsScheduled = true;
        const run = () => {
            this.gridMetricsScheduled = false;
            this.updateGridMetrics();
            this.updateMenuPositions(); // Update menu positions on resize
        };

        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(run);
        } else {
            setTimeout(run, 16);
        }
    }

    clearPendingGridMetricsRetry() {
        if (this.gridMetricsRetryHandle) {
            clearTimeout(this.gridMetricsRetryHandle);
            this.gridMetricsRetryHandle = null;
        }
    }

    scheduleGridMetricsRetry(delay = 120) {
        if (this.gridMetricsRetryHandle) {
            return;
        }

        // Don't retry if fallback has already been applied
        if (this.gridMetricsFallbackApplied) {
            console.log('[gridMetrics] fallback active, skipping retry');
            return;
        }

        // Initialize retry counter if not exists
        if (typeof this.gridMetricsRetryCount !== 'number') {
            this.gridMetricsRetryCount = 0;
        }

        // Maximum 50 retries (~6 seconds at 120ms intervals)
        if (this.gridMetricsRetryCount >= 50) {
            console.error('[gridMetrics] max retries exceeded, forcing fallback initialization');
            this.gridMetricsRetryCount = 0;
            this.gridMetricsFallbackApplied = true;
            this.forceFallbackGridMetrics();
            return;
        }

        this.gridMetricsRetryCount++;
        const safeDelay = Math.max(50, delay);
        this.gridMetricsRetryHandle = setTimeout(() => {
            this.gridMetricsRetryHandle = null;
            this.requestGridMetricsUpdate();
        }, safeDelay);
    }

    forceFallbackGridMetrics() {
        // Fallback: calculate grid based on default assumptions when measurement fails
        console.warn('[gridMetrics] using fallback dimensions');
        
        const defaultWidth = 1800;
        const defaultHeight = 800;
        const gap = 8;
        const step = this.cellDimension + gap;
        
        const potentialColumns = Math.floor((defaultWidth + gap) / step);
        const targetColumns = this.clamp(potentialColumns, 1, this.maxGridColumns);
        
        const potentialRows = Math.floor((defaultHeight + gap) / step);
        const targetRows = this.clamp(potentialRows, 1, this.maxGridRows);
        
        // Apply the calculated values
        this.gridColumns = targetColumns;
        this.gridRows = targetRows;
        
        console.log('[gridMetrics] fallback applied:', {
            columns: this.gridColumns,
            rows: this.gridRows,
            cellDimension: this.cellDimension
        });
        
        // Don't trigger another render, just stop retrying
        // The ResizeObserver will trigger proper metrics when the element gets height
    }

    updateGridMetrics() {
        // Prevent re-entry during grid metrics update
        if (this._updatingGridMetrics) {
            return;
        }
        this._updatingGridMetrics = true;

        if (!this.contentArea) {
            console.warn('[gridMetrics] content area missing');
            this._updatingGridMetrics = false;
            this.scheduleGridMetricsRetry(250);
            return;
        }

        const rect = this.contentArea.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            // Check if parent container also has zero height
            const parent = this.contentArea.parentElement;
            if (parent) {
                const parentRect = parent.getBoundingClientRect();
                console.warn('[gridMetrics] zero content rect', {
                    contentArea: rect,
                    parent: parentRect
                });
                
                // If parent also has zero height, wait longer
                if (parentRect.height <= 0) {
                    this._updatingGridMetrics = false;
                    this.scheduleGridMetricsRetry(250);
                    return;
                }
            } else {
                console.warn('[gridMetrics] zero content rect', rect);
            }
            
            this._updatingGridMetrics = false;
            this.scheduleGridMetricsRetry();
            return;
        }

        // Successfully got valid dimensions - reset retry counter
        this.gridMetricsRetryCount = 0;
        this.gridMetricsFallbackApplied = false;

        const computed = window.getComputedStyle(this.contentArea);
        const gap = Number.parseFloat(computed.columnGap) || 0;
        const step = this.cellDimension + gap;
        if (step <= 0) {
            console.warn('[gridMetrics] invalid cell step', {
                cellDimension: this.cellDimension,
                gap,
                step
            });
            this._updatingGridMetrics = false;
            this.scheduleGridMetricsRetry();
            return;
        }

        this.clearPendingGridMetricsRetry();
        
        // Reset retry counter on successful measurement
        this.gridMetricsRetryCount = 0;
        
        // Get parent container to calculate actual available height
        const parent = this.contentArea.parentElement; // .tab-system
        const parentRect = parent ? parent.getBoundingClientRect() : rect;
        const host = this.getRootNode().host; // <panel-taskbar>
        const hostRect = host ? host.getBoundingClientRect() : parentRect;
        
        // ContentArea is positioned: top: 8px, bottom: 108px
        // So available height = parent height - top offset - bottom offset
        const topOffset = 8;
        const bottomOffset = 108;
        const effectiveWidth = rect.width;
        const effectiveHeight = parentRect.height - topOffset - bottomOffset;
        
        console.log('[gridMetrics] measuring:', {
            hostHeight: hostRect.height,
            parentHeight: parentRect.height,
            contentAreaHeight: rect.height,
            calculatedHeight: effectiveHeight,
            width: effectiveWidth,
            cellDimension: this.cellDimension,
            gap,
            step
        });
        
        // Calculate how many full cells fit within the available width and height
        const potentialColumns = Math.floor((effectiveWidth + gap) / step);
        const targetColumns = this.clamp(potentialColumns, 1, this.maxGridColumns);
        
        const potentialRows = Math.floor((effectiveHeight + gap) / step);
        const targetRows = this.clamp(potentialRows, 1, this.maxGridRows);

        let layoutsNeedAdjustment = false;
        
        if (targetColumns !== this.gridColumns) {
            this.gridColumns = targetColumns;
            layoutsNeedAdjustment = true;
        }
        
        if (targetRows !== this.gridRows) {
            this.gridRows = targetRows;
            layoutsNeedAdjustment = true;
        }

        if (layoutsNeedAdjustment) {
            const layoutsChanged = this.adjustLayoutsForGridChange();
            if (layoutsChanged) {
                this.panelLayouts.forEach((layout, idx) => {
                    if (layout) {
                        this.applyPanelLayout(idx, layout);
                    }
                });
                this.saveState();
            }
        }

        this.gridGap = gap;
        this.cellSize = this.cellDimension;

        const cellPx = `${this.cellSize}px`;
        const gapPx = `${gap}px`;
        const stepPx = `${this.cellSize + gap}px`;
        const totalHeight = this.gridRows * this.cellSize + gap * Math.max(0, this.gridRows - 1);
        const minBackground = Number.isFinite(this.backgroundHeight) ? this.backgroundHeight : totalHeight;
        const safeHeight = Math.max(totalHeight, minBackground);

        this.contentArea.style.setProperty('--tab-cell-size', cellPx);
        this.contentArea.style.setProperty('--tab-grid-gap', gapPx);
        this.contentArea.style.setProperty('--tab-grid-step', stepPx);
        this.contentArea.style.setProperty('--tab-grid-columns', String(this.gridColumns));
        this.contentArea.style.setProperty('--tab-grid-rows', String(this.gridRows));
        this.contentArea.style.setProperty('--grid-total-height', `${effectiveHeight}px`);
        this.contentArea.style.gridTemplateColumns = `repeat(${this.gridColumns}, ${cellPx})`;
        
        // Use fixed cell size for rows - don't stretch them
        // The grid is constrained by top/bottom positioning, so rows will naturally fit
        this.contentArea.style.gridTemplateRows = `repeat(${this.gridRows}, ${cellPx})`;
        
        this.contentArea.style.backgroundSize = `${this.cellSize + gap}px ${this.cellSize + gap}px`;
        
        // No need to set height - grid is positioned absolutely with top/bottom in CSS
        
        // Update background height to match calculated grid area
        const calculatedBackgroundHeight = totalHeight;
        if (calculatedBackgroundHeight > this.minBackgroundHeight) {
            this.setBackgroundHeight(calculatedBackgroundHeight);
        }

        this.panelLayouts.forEach((layout, idx) => {
            if (layout) {
                this.applyPanelLayout(idx, layout);
            }
        });

        // Clear re-entry flag
        this._updatingGridMetrics = false;
    }

    getDefaultPanelDimensions() {
        // Calculate default panel size as 33% of visible columns, ensuring it fits on screen
        const targetWidthPercent = 0.33;
        const calculatedWidth = Math.floor(this.gridColumns * targetWidthPercent);
        const width = this.clamp(calculatedWidth, 1, this.gridColumns);
        
        // Height: Calculate based on available grid rows that fit above taskbar
        // Use most of the available height but leave room for taskbar
        const calculatedHeight = Math.floor(this.gridRows * 0.85);
        const height = this.clamp(calculatedHeight, 1, this.gridRows);
        
        return { width, height };
    }

    adjustLayoutsForGridChange() {
        let mutated = false;

        for (let index = 0; index < this.panelLayouts.length; index += 1) {
            const original = this.panelLayouts[index];
            if (!original) {
                continue;
            }

            const adjusted = this.cloneLayout(original);
            adjusted.width = this.clamp(adjusted.width, 1, this.gridColumns);
            adjusted.height = this.clamp(adjusted.height, 1, this.gridRows);
            adjusted.x = this.clamp(adjusted.x, 1, this.gridColumns - adjusted.width + 1);
            adjusted.y = this.clamp(adjusted.y, 1, this.gridRows - adjusted.height + 1);

            const backup = this.cloneLayout(original);
            this.panelLayouts[index] = null;

            let candidate = adjusted;
            if (!this.isValidLayout(candidate, index)) {
                candidate = this.findAvailableRegion(candidate.width, candidate.height, index);
            }

            if (!candidate) {
                const defaults = this.getDefaultPanelDimensions();
                candidate = this.findAvailableRegion(
                    Math.min(defaults.width, this.gridColumns),
                    Math.min(defaults.height, this.gridRows),
                    index
                );
            }

            const finalLayout = this.cloneLayout(candidate);
            this.panelLayouts[index] = finalLayout;

            if (this.activeInteraction && this.activeInteraction.index === index) {
                this.activeInteraction.startLayout = this.cloneLayout(finalLayout);
                this.activeInteraction.currentLayout = this.cloneLayout(finalLayout);
            }

            if (!this.layoutsEqual(finalLayout, backup)) {
                mutated = true;
            }
        }

        return mutated;
    }

    layoutsEqual(a, b) {
        if (!a || !b) {
            return a === b;
        }

        return a.x === b.x
            && a.y === b.y
            && a.width === b.width
            && a.height === b.height;
    }

    getLayoutPixelRect(layout) {
        if (!layout) {
            return null;
        }

        const cell = this.cellSize;
        const gap = this.gridGap || 0;
        if (!Number.isFinite(cell) || cell <= 0) {
            return null;
        }

        const left = (layout.x - 1) * (cell + gap);
        const top = (layout.y - 1) * (cell + gap);
        const width = layout.width * cell + Math.max(0, layout.width - 1) * gap;
        const height = layout.height * cell + Math.max(0, layout.height - 1) * gap;

        return {
            left,
            top,
            width,
            height
        };
    }

    observeResizes() {
        if (!this.contentArea) {
            return;
        }

        this.releaseResizeObserver();

        if (typeof ResizeObserver !== 'undefined') {
            // Only observe the host element, not contentArea to avoid resize loops
            // when we update CSS properties on contentArea
            this.resizeObserver = new ResizeObserver(() => this.requestGridMetricsUpdate());
            this.resizeObserver.observe(this);
        } else if (!this.usingWindowResize) {
            window.addEventListener('resize', this.boundResize);
            this.usingWindowResize = true;
        }
    }

    releaseResizeObserver() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        if (this.usingWindowResize) {
            window.removeEventListener('resize', this.boundResize);
            this.usingWindowResize = false;
        }
    }

    getCellMetrics() {
        if (!this.contentArea) {
            return null;
        }

        const rect = this.contentArea.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            return null;
        }

        const gap = Number.isFinite(this.gridGap) ? this.gridGap : 0;
        const cell = Number.isFinite(this.cellSize) && this.cellSize > 0
            ? this.cellSize
            : this.cellDimension;
        const step = cell + gap;

        return {
            rect,
            cellSize: cell,
            gap,
            stepX: step,
            stepY: step
        };
    }

    ensurePanelLayout(index) {
        let layout = this.panelLayouts[index];
        if (layout) {
            layout = this.sanitizeLayout(layout);
        }

        if (!layout) {
            const defaults = this.getDefaultPanelDimensions();
            layout = this.findAvailableRegion(defaults.width, defaults.height, index);
        }

        if (!this.isValidLayout(layout, index)) {
            layout = this.findAvailableRegion(layout.width, layout.height, index);
        }

        this.panelLayouts[index] = this.cloneLayout(layout);
        return this.cloneLayout(layout);
    }

    sanitizeLayout(layout) {
        if (!layout || typeof layout !== 'object') {
            return null;
        }

        const values = ['x', 'y', 'width', 'height'].map((key) => Number(layout[key]));
        if (values.some((value) => !Number.isFinite(value))) {
            return null;
        }

        let [x, y, width, height] = values.map((value) => Math.trunc(value));

        width = this.clamp(width, 1, this.gridColumns);
        height = this.clamp(height, 1, this.gridRows);
        x = this.clamp(x, 1, this.gridColumns);
        y = this.clamp(y, 1, this.gridRows);

        if (x + width - 1 > this.gridColumns) {
            x = Math.max(1, this.gridColumns - width + 1);
        }

        if (y + height - 1 > this.gridRows) {
            y = Math.max(1, this.gridRows - height + 1);
        }

        return { x, y, width, height };
    }

    cloneLayout(layout) {
        if (!layout) {
            return null;
        }

        return {
            x: layout.x,
            y: layout.y,
            width: layout.width,
            height: layout.height
        };
    }

    isValidLayout(layout, index) {
        if (!layout) {
            return false;
        }

        const withinBounds = layout.x >= 1
            && layout.y >= 1
            && layout.x + layout.width - 1 <= this.gridColumns
            && layout.y + layout.height - 1 <= this.gridRows;

        if (!withinBounds) {
            return false;
        }

        return !this.isColliding(layout, index);
    }

    isColliding(candidate, index) {
        for (let i = 0; i < this.panelLayouts.length; i += 1) {
            if (i === index) {
                continue;
            }

            const layout = this.panelLayouts[i];
            if (!layout) {
                continue;
            }

            if (this.layoutsOverlap(candidate, layout)) {
                return true;
            }
        }

        return false;
    }

    getCollidingIndices(candidate, index) {
        const collisions = [];
        for (let i = 0; i < this.panelLayouts.length; i += 1) {
            if (i === index) {
                continue;
            }
            const layout = this.panelLayouts[i];
            if (!layout) {
                continue;
            }
            if (this.layoutsOverlap(candidate, layout)) {
                collisions.push(i);
            }
        }
        return collisions;
    }

    resolveDragDrop(state) {
        const candidate = state.currentLayout;
        if (!candidate) {
            return false;
        }

        const collisions = this.getCollidingIndices(candidate, state.index);
        if (!collisions.length && this.isValidLayout(candidate, state.index)) {
            this.panelLayouts[state.index] = this.cloneLayout(candidate);
            this.applyPanelLayout(state.index, candidate);
            state.currentLayout = this.cloneLayout(candidate);
            state.invalid = false;
            return true;
        }

        const backups = new Map();
        backups.set(state.index, this.cloneLayout(state.startLayout));
        collisions.forEach((idx) => {
            backups.set(idx, this.cloneLayout(this.panelLayouts[idx]));
        });

        this.panelLayouts[state.index] = this.cloneLayout(candidate);

        const relocated = [];

        for (const idx of collisions) {
            const original = backups.get(idx);
            this.panelLayouts[idx] = null;

            const attempts = [];
            const belowY = candidate.y + candidate.height;
            const aboveY = candidate.y - original.height;
            const rightX = candidate.x + candidate.width;
            const leftX = candidate.x - original.width;

            attempts.push({ x: original.x, y: belowY });
            attempts.push({ x: original.x, y: aboveY });
            attempts.push({ x: rightX, y: original.y });
            attempts.push({ x: leftX, y: original.y });

            let newLayout = null;

            for (const pos of attempts) {
                if (!pos) {
                    continue;
                }
                const minX = 1;
                const maxX = Math.max(minX, this.gridColumns - original.width + 1);
                const minY = 1;
                const maxY = Math.max(minY, this.gridRows - original.height + 1);

                const roundedX = Math.round(pos.x);
                const roundedY = Math.round(pos.y);

                if (roundedX < minX || roundedX > maxX || roundedY < minY || roundedY > maxY) {
                    continue;
                }

                const test = {
                    x: roundedX,
                    y: roundedY,
                    width: original.width,
                    height: original.height
                };

                if (!this.isValidLayout(test, idx)) {
                    continue;
                }

                newLayout = test;
                break;
            }

            if (!newLayout) {
                newLayout = this.findAvailableRegion(original.width, original.height, idx);
            }

            if (!newLayout || this.layoutsOverlap(newLayout, candidate)) {
                backups.forEach((layout, layoutIndex) => {
                    this.panelLayouts[layoutIndex] = this.cloneLayout(layout);
                    this.applyPanelLayout(layoutIndex, layout);
                });
                state.invalid = true;
                state.currentLayout = this.cloneLayout(state.startLayout);
                return false;
            }
            this.panelLayouts[idx] = this.cloneLayout(newLayout);
            relocated.push({ index: idx, layout: newLayout });
        }

        this.applyPanelLayout(state.index, candidate);
        relocated.forEach(({ index, layout }) => {
            this.applyPanelLayout(index, layout);
        });

        state.invalid = false;
        state.currentLayout = this.cloneLayout(candidate);
        return true;
    }

    layoutsOverlap(a, b) {
        const rectA = this.getLayoutBounds(a);
        const rectB = this.getLayoutBounds(b);

        return !(rectA.left >= rectB.right
            || rectA.right <= rectB.left
            || rectA.top >= rectB.bottom
            || rectA.bottom <= rectB.top);
    }

    getLayoutBounds(layout) {
        const left = layout.x - 1;
        const top = layout.y - 1;
        const right = left + layout.width;
        const bottom = top + layout.height;

        return { left, top, right, bottom };
    }

    findAvailableRegion(preferredWidth, preferredHeight, targetIndex) {
        const defaults = this.getDefaultPanelDimensions();
        const baseWidth = Number.isFinite(preferredWidth)
            ? preferredWidth
            : defaults.width;
        const baseHeight = Number.isFinite(preferredHeight)
            ? preferredHeight
            : defaults.height;

        const startWidth = this.clamp(Math.round(baseWidth), 1, this.gridColumns);
        const startHeight = this.clamp(Math.round(baseHeight), 1, this.gridRows);

        // First, try to find a spot at the preferred size by scanning rows
        for (let y = 1; y <= this.gridRows - startHeight + 1; y += 1) {
            for (let x = 1; x <= this.gridColumns - startWidth + 1; x += 1) {
                const candidate = { x, y, width: startWidth, height: startHeight };
                if (!this.isColliding(candidate, targetIndex)) {
                    return candidate;
                }
            }
        }

        // If preferred size doesn't fit, try shrinking width to fit remaining horizontal space in each row
        for (let y = 1; y <= this.gridRows - startHeight + 1; y += 1) {
            for (let x = 1; x <= this.gridColumns; x += 1) {
                const availableWidth = this.gridColumns - x + 1;
                if (availableWidth < 1) continue;
                
                // Try widths from available space down to 1, using preferred height
                for (let width = Math.min(startWidth, availableWidth); width >= 1; width -= 1) {
                    const candidate = { x, y, width, height: startHeight };
                    if (!this.isColliding(candidate, targetIndex)) {
                        return candidate;
                    }
                }
            }
        }

        // Fallback: shrink both dimensions progressively
        for (let height = startHeight; height >= 1; height -= 1) {
            for (let width = startWidth; width >= 1; width -= 1) {
                for (let y = 1; y <= this.gridRows - height + 1; y += 1) {
                    for (let x = 1; x <= this.gridColumns - width + 1; x += 1) {
                        const candidate = { x, y, width, height };
                        if (!this.isColliding(candidate, targetIndex)) {
                            return candidate;
                        }
                    }
                }
            }
        }

        return {
            x: 1,
            y: 1,
            width: this.clamp(startWidth, 1, this.gridColumns),
            height: this.clamp(startHeight, 1, this.gridRows)
        };
    }

    clamp(value, min, max) {
        if (Number.isNaN(value)) {
            return min;
        }
        return Math.min(Math.max(value, min), max);
    }

    ensureDockStripVisibility() {
        if (!this.videoDockContainer) return;
        const hasChips = this.videoDockContainer.querySelector('.dock-chip');
        this.videoDockContainer.classList.toggle('hidden', !hasChips);
    }

    registerDockable(id, element, options = {}) {
        if (!id || !element) return null;
        if (this.dockRegistry.has(id)) {
            return this.dockRegistry.get(id).api;
        }

        const meta = {
            id,
            element,
            label: options.label || id,
            icon: options.icon || '●',
            modes: Array.isArray(options.modes) && options.modes.length ? options.modes : this.defaultDockModes.slice(),
            defaultMode: options.defaultMode || 'expanded',
            homeParent: element.parentElement,
            homeNextSibling: element.nextSibling,
            homeSelector: options.homeSelector || null,
            manageDom: options.manageDom !== false,
            chipEl: null,
            chipBody: null,
            chipModeLabel: null,
            miniWrapper: null,
            miniBody: null,
            currentMode: null
        };

        this.dockRegistry.set(id, meta);

        const api = {
            setMode: (mode) => this.setDockMode(id, mode),
            getMode: () => meta.currentMode,
            cycleMode: () => this.setDockMode(id, this.getNextDockMode(meta))
        };
        meta.api = api;
        element.__dockApi = api;
        element.dispatchEvent(new CustomEvent('dock-api-ready', { detail: { api } }));

        this.ensureDockChip(meta);
        this.ensureDockStripVisibility();

        const savedMode = this.loadDockPreference(id) || meta.defaultMode;
        this.setDockMode(id, savedMode, { skipPersist: true });

        element.addEventListener('request-dock-mode', (evt) => {
            if (!evt.detail?.mode) return;
            evt.stopPropagation();
            this.setDockMode(id, evt.detail.mode);
        });

        return api;
    }

    setDockModeById(id, mode) {
        return this.setDockMode(id, mode);
    }

    getNextDockMode(meta) {
        const order = meta?.modes && meta.modes.length ? meta.modes : this.defaultDockModes;
        const currentIndex = order.indexOf(meta.currentMode);
        const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % order.length : 0;
        return order[nextIndex];
    }

    setDockMode(id, mode, { skipPersist = false } = {}) {
        const meta = this.dockRegistry.get(id);
        if (!meta || !meta.element) return false;
        const allowedMode = meta.modes.includes(mode) ? mode : meta.defaultMode;
        if (meta.currentMode === allowedMode) {
            if (!skipPersist) this.saveDockPreference(id, allowedMode);
            return true;
        }

        if (meta.manageDom) {
            if (meta.currentMode === 'docked' && meta.chipBody?.contains(meta.element)) {
                meta.chipBody.removeChild(meta.element);
            }

            if (meta.currentMode === 'mini' && meta.miniBody?.contains(meta.element)) {
                meta.miniBody.removeChild(meta.element);
            }
        }

        if (allowedMode === 'expanded') {
            this.restoreDockable(meta);
        } else if (allowedMode === 'docked') {
            if (meta.manageDom) {
                const chip = this.ensureDockChip(meta);
                if (chip && meta.chipBody) {
                    meta.chipBody.appendChild(meta.element);
                } else {
                    this.restoreDockable(meta);
                    meta.currentMode = 'expanded';
                    return false;
                }
            } else {
                this.restoreDockable(meta);
            }
        } else if (allowedMode === 'mini') {
            if (meta.manageDom) {
                const wrapper = this.ensureMiniWrapper(meta);
                if (wrapper && meta.miniBody) {
                    meta.miniBody.appendChild(meta.element);
                } else {
                    this.restoreDockable(meta);
                    meta.currentMode = 'expanded';
                    return false;
                }
            } else {
                this.restoreDockable(meta);
            }
        }

        meta.currentMode = allowedMode;
        meta.element.setAttribute('dock-mode', allowedMode);
        if (!skipPersist) this.saveDockPreference(id, allowedMode);
        this.updateChipState(meta);
        this.updateMiniWrapper(meta);
        meta.element.dispatchEvent(new CustomEvent('dock-mode-change', { detail: { mode: allowedMode } }));
        return true;
    }

    restoreDockable(meta) {
        let parent = meta.homeParent && meta.homeParent.isConnected ? meta.homeParent : null;
        if (!parent && meta.homeSelector) {
            parent = document.querySelector(meta.homeSelector);
        }
        if (!parent) {
            parent = document.getElementById('xavi-grid-container') || document.body;
        }

        if (meta.homeNextSibling && meta.homeNextSibling.parentNode === parent) {
            parent.insertBefore(meta.element, meta.homeNextSibling);
        } else {
            parent.appendChild(meta.element);
        }
    }

    ensureDockChip(meta) {
        if (!this.videoDockContainer) return null;
        if (meta.chipEl && meta.chipEl.isConnected) return meta.chipEl;

        const chip = document.createElement('div');
        chip.className = 'dock-chip';
        chip.dataset.component = meta.id;
        chip.innerHTML = `
            <div class="dock-chip-header">
                <span class="dock-chip-icon">${meta.icon}</span>
                <span class="dock-chip-label">${meta.label}</span>
                <span class="dock-chip-mode"></span>
                <div class="dock-chip-actions">
                    <button type="button" data-action="cycle" title="Cycle mode">⟳</button>
                    <button type="button" data-action="expand" title="Expand">⤢</button>
                </div>
            </div>
            <div class="dock-chip-body"></div>
        `;

        const header = chip.querySelector('.dock-chip-header');
        const modeLabel = chip.querySelector('.dock-chip-mode');
        const cycleBtn = chip.querySelector('[data-action="cycle"]');
        const expandBtn = chip.querySelector('[data-action="expand"]');
        const body = chip.querySelector('.dock-chip-body');

        header.addEventListener('click', (event) => {
            if (event.target.closest('button')) return;
            const preferred = meta.currentMode === 'docked' ? 'mini' : 'docked';
            if (!meta.modes.includes(preferred)) {
                this.setDockMode(meta.id, this.getNextDockMode(meta));
            } else {
                this.setDockMode(meta.id, preferred);
            }
        });

        if (cycleBtn) {
            cycleBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                this.setDockMode(meta.id, this.getNextDockMode(meta));
            });
        }

        if (expandBtn) {
            expandBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                this.setDockMode(meta.id, 'expanded');
            });
        }

        this.videoDockContainer.appendChild(chip);
        meta.chipEl = chip;
        meta.chipBody = body;
        meta.chipModeLabel = modeLabel;
        this.ensureDockStripVisibility();
        return chip;
    }

    ensureMiniWrapper(meta) {
        this.initDockingLayer();
        if (meta.miniWrapper && meta.miniWrapper.isConnected) {
            return meta.miniWrapper;
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'dock-mini-window';
        wrapper.dataset.component = meta.id;
        wrapper.innerHTML = `
            <div class="dock-mini-header">
                <span class="dock-mini-icon">${meta.icon}</span>
                <span class="dock-mini-label">${meta.label}</span>
                <button type="button" data-action="dock" title="Dock">⬇</button>
                <button type="button" data-action="expand" title="Expand">⤢</button>
            </div>
            <div class="dock-mini-body"></div>
        `;

        const dockBtn = wrapper.querySelector('[data-action="dock"]');
        const expandBtn = wrapper.querySelector('[data-action="expand"]');
        const body = wrapper.querySelector('.dock-mini-body');

        if (dockBtn) {
            dockBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                this.setDockMode(meta.id, 'docked');
            });
        }

        if (expandBtn) {
            expandBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                this.setDockMode(meta.id, 'expanded');
            });
        }

        this.dockMiniLayer?.appendChild(wrapper);
        meta.miniWrapper = wrapper;
        meta.miniBody = body;
        return wrapper;
    }

    updateChipState(meta) {
        if (!meta.chipEl) return;
        meta.chipEl.dataset.mode = meta.currentMode || '';
        if (meta.chipModeLabel) {
            meta.chipModeLabel.textContent = meta.currentMode || '';
        }
    }

    updateMiniWrapper(meta) {
        if (!meta.miniWrapper) return;
        meta.miniWrapper.style.display = meta.currentMode === 'mini' ? 'block' : 'none';
    }

    loadDockPreference(id) {
        try {
            const json = localStorage.getItem(this.dockPreferencesKey);
            if (!json) return null;
            const prefs = JSON.parse(json);
            return prefs?.[id] || null;
        } catch (err) {
            console.warn('Failed to parse dock preferences', err);
            return null;
        }
    }

    saveDockPreference(id, mode) {
        try {
            const prefs = JSON.parse(localStorage.getItem(this.dockPreferencesKey) || '{}');
            prefs[id] = mode;
            localStorage.setItem(this.dockPreferencesKey, JSON.stringify(prefs));
        } catch (err) {
            console.warn('Failed to persist dock preference', err);
        }
    }

    getComponentForTab(tabId, tabInfo) {
        if (tabId === 'video-player') {
            // The video player is controlled via the dock (Open/Close + Expand).
            // Do not provide a separate “video panel/popout” tab.
            return resolveVideoPlayerElement();
        }

        if (!this.componentInstances[tabId]) {
            this.componentInstances[tabId] = document.createElement(tabInfo.component);
        }

        return this.componentInstances[tabId];
    }

    restoreInactiveSpecialComponents(activeSet) {
        const special = this.specialComponents['video-player'];
        if (!special || !special.element) {
            return;
        }

        if (!activeSet.has('video-player')) {
            // Move iframe back to video player using stored references
            if (special.movedIframe && special.originalVideoContainer) {
                special.originalVideoContainer.appendChild(special.movedIframe);
                special.movedIframe.style.cssText = '';
                special.movedIframe = null;
                special.originalVideoContainer = null;
            }
            
            // Clear panel control flag
            if (special.element) {
                special.element._panelControlled = false;
            }
            
            // Clear update interval
            if (special.panelUpdateInterval) {
                clearInterval(special.panelUpdateInterval);
                special.panelUpdateInterval = null;
            }
            
            // Restore original video player mode
            if (special.originalMode && special.element) {
                const orig = special.originalMode;
                if (orig.isExpanded && typeof special.element.setExpandedMode === 'function') {
                    special.element.setExpandedMode(true);
                } else if (!orig.isDocked && typeof special.element.setMiniMode === 'function') {
                    special.element.setMiniMode(true);
                }
                special.originalMode = null;
            }
            
            const { homeParent, homeNextSibling, element } = special;
            if (homeParent) {
                if (homeParent.contains(element)) {
                    return;
                }
                if (homeNextSibling && homeNextSibling.parentNode === homeParent) {
                    homeParent.insertBefore(element, homeNextSibling);
                } else {
                    homeParent.appendChild(element);
                }
            }
        }
    }

    createVideoPanelContainer() {
        const container = document.createElement('div');
        container.className = 'video-panel-container';
        container.style.cssText = `
            display: flex;
            flex-direction: column;
            width: 100%;
            height: 100%;
            background: #000;
            overflow: hidden;
        `;
        
        // Video iframe container (will host the actual iframe from video-player)
        const videoWrapper = document.createElement('div');
        videoWrapper.className = 'video-panel-player';
        videoWrapper.id = 'video-panel-player-wrapper';
        videoWrapper.style.cssText = `
            flex: 1;
            position: relative;
            background: #000;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 0;
        `;
        
        // Controls bar
        const controls = document.createElement('div');
        controls.className = 'video-panel-controls';
        controls.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 12px 16px;
            background: rgba(12, 12, 12, 0.95);
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            flex-wrap: wrap;
        `;
        
        // Time display
        const timeDisplay = document.createElement('span');
        timeDisplay.className = 'video-panel-time';
        timeDisplay.textContent = '0:00 / 0:00';
        timeDisplay.style.cssText = `
            font-size: 0.85rem;
            color: rgba(255, 255, 255, 0.7);
            font-variant-numeric: tabular-nums;
            min-width: 90px;
        `;
        
        // Previous button
        const prevBtn = document.createElement('button');
        prevBtn.className = 'video-panel-btn';
        prevBtn.textContent = '⏮';
        prevBtn.title = 'Previous';
        this.styleControlButton(prevBtn);
        prevBtn.addEventListener('click', () => {
            const videoPlayer = resolveVideoPlayerElement();
            if (videoPlayer && typeof videoPlayer.playPrevious === 'function') {
                videoPlayer.playPrevious();
            }
        });
        
        // Play/pause button
        const playBtn = document.createElement('button');
        playBtn.className = 'video-panel-play-btn';
        playBtn.textContent = '▶';
        playBtn.title = 'Play/Pause';
        this.styleControlButton(playBtn);
        playBtn.addEventListener('click', () => {
            const videoPlayer = resolveVideoPlayerElement();
            if (videoPlayer?.player) {
                const state = videoPlayer.player.getPlayerState?.();
                if (typeof YT !== 'undefined' && state === YT.PlayerState.PLAYING) {
                    videoPlayer.player.pauseVideo();
                } else {
                    videoPlayer.player.playVideo();
                }
            }
        });
        
        // Next button
        const nextBtn = document.createElement('button');
        nextBtn.className = 'video-panel-btn';
        nextBtn.textContent = '⏭';
        nextBtn.title = 'Next';
        this.styleControlButton(nextBtn);
        nextBtn.addEventListener('click', () => {
            const videoPlayer = resolveVideoPlayerElement();
            if (videoPlayer && typeof videoPlayer.playNext === 'function') {
                videoPlayer.playNext();
            }
        });
        
        // Volume control
        const volumeWrapper = document.createElement('div');
        volumeWrapper.style.cssText = 'position: relative;';
        
        const volumeBtn = document.createElement('button');
        volumeBtn.className = 'video-panel-btn';
        volumeBtn.textContent = '🔊';
        volumeBtn.title = 'Volume';
        this.styleControlButton(volumeBtn);
        
        const volumeDropdown = document.createElement('div');
        volumeDropdown.style.cssText = `
            position: absolute;
            bottom: 100%;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(18, 18, 18, 0.98);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 8px;
            padding: 12px 8px;
            margin-bottom: 8px;
            display: none;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            min-width: 50px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
        `;
        
        const volumeSlider = document.createElement('input');
        volumeSlider.type = 'range';
        volumeSlider.min = '0';
        volumeSlider.max = '100';
        volumeSlider.value = localStorage.getItem('myVolume') || '75';
        volumeSlider.style.cssText = `
            writing-mode: vertical-lr;
            direction: rtl;
            width: 100px;
            cursor: pointer;
        `;
        
        const volumePercent = document.createElement('span');
        volumePercent.textContent = volumeSlider.value + '%';
        volumePercent.style.cssText = `
            font-size: 0.75rem;
            color: rgba(255, 255, 255, 0.7);
            min-width: 35px;
            text-align: center;
        `;
        
        volumeSlider.addEventListener('input', (e) => {
            const vol = e.target.value;
            volumePercent.textContent = vol + '%';
            const videoPlayer = resolveVideoPlayerElement();
            if (videoPlayer?.player) {
                videoPlayer.player.setVolume(vol);
                localStorage.setItem('myVolume', vol);
            }
        });
        
        volumeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = volumeDropdown.style.display === 'flex';
            volumeDropdown.style.display = isOpen ? 'none' : 'flex';
        });
        
        volumeDropdown.appendChild(volumeSlider);
        volumeDropdown.appendChild(volumePercent);
        volumeWrapper.appendChild(volumeBtn);
        volumeWrapper.appendChild(volumeDropdown);
        
        // Track info
        const trackInfo = document.createElement('div');
        trackInfo.className = 'video-panel-track-info';
        trackInfo.style.cssText = `
            flex: 1;
            min-width: 0;
            color: rgba(255, 255, 255, 0.9);
            font-size: 0.9rem;
            margin-left: 8px;
        `;
        const trackTitle = document.createElement('div');
        trackTitle.className = 'video-panel-title';
        trackTitle.textContent = 'No video loaded';
        trackTitle.style.cssText = `
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            font-weight: 500;
        `;
        const trackArtist = document.createElement('div');
        trackArtist.className = 'video-panel-artist';
        trackArtist.style.cssText = `
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            font-size: 0.8rem;
            color: rgba(255, 255, 255, 0.6);
            margin-top: 2px;
        `;
        trackInfo.appendChild(trackTitle);
        trackInfo.appendChild(trackArtist);
        
        controls.appendChild(timeDisplay);
        controls.appendChild(prevBtn);
        controls.appendChild(playBtn);
        controls.appendChild(nextBtn);
        controls.appendChild(volumeWrapper);
        controls.appendChild(trackInfo);
        
        container.appendChild(videoWrapper);
        container.appendChild(controls);
        
        // Move the actual video iframe into the panel
        this.moveVideoIframeToPanel(videoWrapper, trackTitle, trackArtist, playBtn, timeDisplay);
        
        return container;
    }

    styleControlButton(btn) {
        btn.style.cssText = `
            min-width: 36px;
            height: 36px;
            padding: 0 8px;
            border-radius: 8px;
            border: none;
            background: rgba(255, 255, 255, 0.08);
            color: #fff;
            cursor: pointer;
            font-size: 0.95rem;
            transition: background 0.15s ease;
        `;
        btn.addEventListener('mouseenter', () => {
            btn.style.background = 'rgba(255, 255, 255, 0.18)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background = 'rgba(255, 255, 255, 0.08)';
        });
    }

    moveVideoIframeToPanel(panelWrapper, titleEl, artistEl, playBtn, timeDisplay) {
        const videoPlayer = resolveVideoPlayerElement();
        if (!videoPlayer || !videoPlayer.shadowRoot) {
            console.warn('video-player or shadowRoot not found');
            return;
        }
        
        // Get special component reference once
        const special = this.specialComponents['video-player'];
        
        // Check if player has an iframe we can move immediately
        if (videoPlayer.player && videoPlayer.player.getIframe) {
            try {
                const iframe = videoPlayer.player.getIframe();
                if (iframe && iframe.parentElement) {
                    console.log('Found existing iframe, moving to panel');
                    const originalContainer = iframe.parentElement;
                    iframe.style.cssText = `
                        width: 100%;
                        height: 100%;
                        border: none;
                        display: block;
                    `;
                    panelWrapper.appendChild(iframe);
                    
                    // Store references for restoration
                    if (special) {
                        special.movedIframe = iframe;
                        special.originalVideoContainer = originalContainer;
                    }
                } else {
                    console.log('Player exists but no iframe yet - will show when video loads');
                }
            } catch (e) {
                console.log('Could not access iframe:', e.message);
            }
        } else {
            console.log('No player initialized yet - panel ready for video');
        }
        
        // Store panel wrapper so video-player can render into it later
        if (special) {
            special.panelVideoWrapper = panelWrapper;
        }
        
        // Update track info and controls
        let _lastPanelTitle = null;
        let _lastPanelArtist = null;
        let _lastPanelState = null;
        let _lastPanelTimeKey = null;

        const updatePanel = () => {
            if (videoPlayer.currentTrack) {
                const nextTitle = videoPlayer.currentTrack.title || 'Unknown';
                const nextArtist = videoPlayer.currentTrack.channelTitle || '';
                if (nextTitle !== _lastPanelTitle) {
                    titleEl.textContent = nextTitle;
                    _lastPanelTitle = nextTitle;
                }
                if (nextArtist !== _lastPanelArtist) {
                    artistEl.textContent = nextArtist;
                    _lastPanelArtist = nextArtist;
                }
            }
            
            // Update play button state
            if (videoPlayer.player) {
                const state = videoPlayer.player.getPlayerState?.();
                if (typeof YT !== 'undefined' && state === YT.PlayerState.PLAYING) {
                    if (_lastPanelState !== 'playing') {
                        playBtn.textContent = '⏸';
                        _lastPanelState = 'playing';
                    }
                } else {
                    if (_lastPanelState !== 'paused') {
                        playBtn.textContent = '▶';
                        _lastPanelState = 'paused';
                    }
                }
            }
            
            // Update time display
            if (videoPlayer.player && typeof videoPlayer.player.getCurrentTime === 'function') {
                try {
                    const current = videoPlayer.player.getCurrentTime() || 0;
                    const duration = videoPlayer.player.getDuration() || 0;
                    const timeKey = `${Math.floor(current)}:${Math.floor(duration)}`;
                    if (timeKey !== _lastPanelTimeKey) {
                        timeDisplay.textContent = `${this.formatTime(current)} / ${this.formatTime(duration)}`;
                        _lastPanelTimeKey = timeKey;
                    }
                } catch (e) {
                    // Ignore timing errors
                }
            }
        };
        
        updatePanel();
        
        // Update periodically while panel is open
        const updateInterval = setInterval(updatePanel, 1000);
        
        // Store cleanup function
        if (special) {
            special.panelUpdateInterval = updateInterval;
        }
        
        // Listen for events
        document.addEventListener('video-track-changed', updatePanel);
        document.addEventListener('video-playback-state', updatePanel);
    }

    formatTime(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    applyContainerMode() {
        if (!this.containerWrapper) {
            return;
        }

        const classList = this.containerWrapper.classList;
        classList.remove('container', 'container-fluid', 'px-0');

        if (this.containerMode === 'full') {
            classList.add('container-fluid', 'px-0');
        } else {
            classList.add('container');
        }

        classList.add('my-4');

        if (this.widthToggleBtn) {
            this.widthToggleBtn.textContent = this.containerMode === 'full'
                ? '⬌ Constrain Width'
                : '⬌ Full Width';
        }
    }

    applyLayoutMode() {
        if (!this.contentArea) return;

        this.layoutMode = 'grid';
        this.contentArea.classList.remove('layout-stack');
        this.updateControlsState();
    }

    notifyComponents() {
        // Keep this lightweight: only nudge special components that need a
        // post-render refresh.
        const selections = Array.isArray(this.panelSelections) ? this.panelSelections : [];
        selections.forEach((tabId) => {
            if (!tabId) return;
            const tabInfo = this.availableTabs?.[tabId] || null;
            if (!tabInfo) return;

            if (tabInfo.component === 'playlist-viewer') {
                const overlay = this.specialComponents?.['playlist-viewer']?.overlay || null;
                const component =
                    overlay?.querySelector?.('playlist-viewer') ||
                    document.querySelector('playlist-viewer');
                if (!component) return;

                setTimeout(() => {
                    try {
                        if (typeof component.updatePlaylistView === 'function') {
                            component.updatePlaylistView();
                        } else if (typeof component.render === 'function') {
                            component.render();
                        }
                    } catch (err) {
                        // Ignore component refresh errors.
                    }
                }, 100);
            }
        });
    }

    // Music player dock handlers
    handleDockPlayPause() {
        const musicPlayer = document.querySelector('music-player');
        if (!musicPlayer) {
            return;
        }

        if (typeof musicPlayer.handleRemoteCommand === 'function') {
            const isPlaying = !!this._musicDockIsPlaying;
            const command = isPlaying ? 'pause' : 'play';
            musicPlayer.handleRemoteCommand(command, {
                source: 'taskbar-dock',
                timestamp: Date.now()
            });
            return;
        }

        if (typeof musicPlayer.togglePlayPause === 'function') {
            musicPlayer.togglePlayPause();
        }
    }

    handleDockPrevious() {
        const musicPlayer = document.querySelector('music-player');
        if (!musicPlayer) {
            return;
        }

        if (typeof musicPlayer.handleRemoteCommand === 'function') {
            musicPlayer.handleRemoteCommand('previous', { source: 'taskbar-dock', timestamp: Date.now() });
            return;
        }

        if (typeof musicPlayer.playPrevious === 'function') {
            musicPlayer.playPrevious();
        }
    }

    handleDockNext() {
        const musicPlayer = document.querySelector('music-player');
        if (!musicPlayer) {
            return;
        }

        if (typeof musicPlayer.handleRemoteCommand === 'function') {
            musicPlayer.handleRemoteCommand('next', { source: 'taskbar-dock', timestamp: Date.now() });
            return;
        }

        if (typeof musicPlayer.playNext === 'function') {
            musicPlayer.playNext();
        }
    }

    handleDockVolumeChange(volumeInput) {
        const volume = volumeInput === '' || volumeInput === null || volumeInput === undefined
            ? 50
            : parseFloat(volumeInput);
        const musicPlayer = document.querySelector('music-player');

        // Prefer remote command so the primary audio workspace applies it
        if (musicPlayer && typeof musicPlayer.handleRemoteCommand === 'function') {
            musicPlayer.handleRemoteCommand('volume', { volume, source: 'taskbar-dock', timestamp: Date.now() });
        } else {
            const timestamp = Date.now();
            let dispatched = false;
            if (window.sharedStateManager && typeof window.sharedStateManager.setState === 'function') {
                window.sharedStateManager.setState({
                    remoteCommand: 'volume',
                    remoteCommandPayload: { volume, source: 'taskbar-dock', timestamp },
                    remoteCommandTimestamp: timestamp
                }, 'remote-command');
                dispatched = true;
            }
            const heartbeat = window.taskbarHeartbeat;
            if (heartbeat && typeof heartbeat.setState === 'function') {
                heartbeat.setState({
                    remoteCommand: 'volume',
                    remoteCommandPayload: { volume, source: 'taskbar-dock', timestamp },
                    remoteCommandTimestamp: timestamp
                }, 'remote-command');
                dispatched = true;
            }
            if (!dispatched && musicPlayer && musicPlayer.player && typeof musicPlayer.player.setVolume === 'function') {
                musicPlayer.player.setVolume(volume);
            }
        }

        // localStorage + global sync events are handled by <xavi-volume-control>

        // Save to database if user is logged in
        if (this.userIsLoggedIn) {
            this.debouncedSaveToDBState();
        }
        this.updateDockVolumeDisplay(volume);
    }

    updateDockVolumeDisplay(volume) {
        if (this.dockVolumeControl) {
            this.dockVolumeControl.value = Math.round(volume);
        }
    }

    handleDockExpand() {
        let handled = false;
        if (typeof window.spawnMusicPlayerPanel === 'function') {
            const panel = window.spawnMusicPlayerPanel();
            handled = !!panel;
        }

        if (!handled) {
            const musicPlayer = document.querySelector('music-player');
            if (musicPlayer && typeof musicPlayer.restoreFromEmbedded === 'function') {
                musicPlayer.restoreFromEmbedded();
                handled = true;
            }
        }

        if (!handled) {
            console.warn('[Taskbar] Unable to expand music dock – no player available.');
        }
        this.closeMusicDockMenu();
    }

    toggleMusicDockMenu() {
        if (!this.musicDockMenu) return;
        const isOpen = this.musicDockMenu.classList.contains('open');
        if (isOpen) {
            this.closeMusicDockMenu();
        } else {
            this.openMusicDockMenu();
        }
    }

    openMusicDockMenu() {
        if (!this.musicDockMenu || !this.musicDockButton) return;
        this.musicDockMenu.classList.add('open');
        this.musicDockButton.classList.add('active');
        this.musicDockButton.setAttribute('aria-expanded', 'true');
    }

    closeMusicDockMenu() {
        if (!this.musicDockMenu || !this.musicDockButton) return;
        this.musicDockMenu.classList.remove('open');
        this.musicDockButton.classList.remove('active');
        this.musicDockButton.setAttribute('aria-expanded', 'false');
    }

    // Music dock volume dropdown is owned by <xavi-volume-control>

    handleMusicPlayerEmbedded(e) {
        this.isMusicDocked = true;
        this.showVideoPlayerDock();
        // Update initial state
        const detail = e.detail || {};
        this.updateDockTrackInfo(detail);
        this.updateDockPlayState(detail);
    }

    handleMusicPlayerRestored() {
        this.isMusicDocked = false;
        if (!this.isVideoDocked) {
            this.hideVideoPlayerDock();
        }
    }

    updateDockTrackInfo(detail = {}) {
        const title = detail.title || 'Unknown Track';
        const artist = detail.channelTitle || detail.artist || 'Unknown Artist';
        
        // Update unified video dock display
        if (this.videoDockTrackTitle) {
            this.videoDockTrackTitle.textContent = title;
            this.videoDockTrackTitle.setAttribute('title', title);
        }
        
        if (this.dockTrackArtist) {
            this.dockTrackArtist.textContent = artist;
        }
        
        // Update menu display (if still exists)
        if (this.dockMenuTrackTitle) {
            this.dockMenuTrackTitle.textContent = title;
        }
        if (this.dockMenuTrackArtist) {
            this.dockMenuTrackArtist.textContent = artist;
        }
    }

    updateDockPlayState(detail = {}) {
        const isPlaying = !!detail.isPlaying;
        this._musicDockIsPlaying = isPlaying;
        const icon = isPlaying ? '⏸' : '▶';
        const title = isPlaying ? 'Pause' : 'Play';
        
        // Update unified dock play indicator
        if (this.dockPlayIndicator) {
            this.dockPlayIndicator.textContent = icon;
        }
        
        // Update video dock play/pause button
        if (this.videoDockPlayPauseButton) {
            this.videoDockPlayPauseButton.textContent = icon;
            this.videoDockPlayPauseButton.setAttribute('aria-label', title);
            this.videoDockPlayPauseButton.setAttribute('title', title);
        }
        
        // Update menu button (if still exists)
        if (this.dockPlayPauseBtn) {
            this.dockPlayPauseBtn.textContent = icon;
            this.dockPlayPauseBtn.title = title;
        }
    }

    updateDockTime(detail = {}) {
        if (!detail || (!Number.isFinite(detail.currentTime) && !Number.isFinite(detail.duration))) {
            return;
        }
        const currentTime = Number.isFinite(detail.currentTime) ? detail.currentTime : 0;
        const duration = Number.isFinite(detail.duration) ? detail.duration : 0;
        const timeText = `${this.formatTime(currentTime)} / ${this.formatTime(duration)}`;
        
        // Update both time displays
        if (this.dockTrackTime) {
            this.dockTrackTime.textContent = timeText;
        }
        if (this.videoDockTimeDisplay) {
            this.videoDockTimeDisplay.textContent = timeText;
        }
    }

    // Video dock handlers
    handleVideoDockPlayPause() {
        const videoPlayer = resolveVideoPlayerElement();
        if (videoPlayer && typeof videoPlayer.togglePlayPause === 'function') {
            videoPlayer.togglePlayPause();
        }
    }

    handleVideoDockPrevious() {
        const videoPlayer = resolveVideoPlayerElement();
        if (videoPlayer && typeof videoPlayer.playPrevious === 'function') {
            videoPlayer.playPrevious();
        }
    }

    handleVideoDockNext() {
        const videoPlayer = resolveVideoPlayerElement();
        if (videoPlayer && typeof videoPlayer.playNext === 'function') {
            videoPlayer.playNext();
        }
    }

    handleVideoDockVolumeChange(volumeInput) {
        const volume = volumeInput === '' || volumeInput === null || volumeInput === undefined
            ? 50
            : parseFloat(volumeInput);
        const videoPlayer = resolveVideoPlayerElement();
        
        // Update video player using its player.setVolume method (like music player)
        if (videoPlayer && videoPlayer.player && typeof videoPlayer.player.setVolume === 'function') {
            videoPlayer.player.setVolume(volume);
        }

        // NOTE: localStorage + global sync events are handled by <xavi-volume-control>.
        
        // Save to database if user is logged in
        if (this.userIsLoggedIn) {
            this.debouncedSaveToDBState();
        }
        
        this.updateVideoDockVolumeDisplay(volume);
    }

    handleVideoDockRestore() {
        const videoPlayer = resolveVideoPlayerElement();
        if (!videoPlayer) return;

        // Open/Close toggle:
        // - If currently docked: open to mini
        // - If currently open (mini/expanded): dock (close)
        const isDocked = !!(videoPlayer.isDocked || videoPlayer.isTaskbarDocked);
        if (isDocked && typeof videoPlayer.restoreFromDock === 'function') {
            videoPlayer.restoreFromDock('mini', { forceAuthority: true, forceOpenOwner: true });
            return;
        }
        if (!isDocked && typeof videoPlayer.setDockedMode === 'function') {
            videoPlayer.setDockedMode({ pausePlayback: false, allowPlayback: true });
        }
    }

    handleVideoDockExpand() {
        const videoPlayer = resolveVideoPlayerElement();
        if (!videoPlayer) return;

        const isDocked = !!(videoPlayer.isDocked || videoPlayer.isTaskbarDocked);
        if (isDocked && typeof videoPlayer.restoreFromDock === 'function') {
            // Expanding from dock opens expanded.
            videoPlayer.restoreFromDock('expanded', { forceAuthority: true, forceOpenOwner: true });
            return;
        }

        // If already open, toggle mini/expanded.
        if (!!videoPlayer.isExpanded) {
            if (typeof videoPlayer.setMiniMode === 'function') {
                videoPlayer.setMiniMode(true, true);
            } else if (typeof videoPlayer.restoreFromDock === 'function') {
                videoPlayer.restoreFromDock('mini', { forceAuthority: true, forceOpenOwner: true });
            }
            return;
        }
        if (typeof videoPlayer.setExpandedMode === 'function') {
            videoPlayer.setExpandedMode(true, true);
        } else if (typeof videoPlayer.restoreFromDock === 'function') {
            videoPlayer.restoreFromDock('expanded', { forceAuthority: true, forceOpenOwner: true });
        }
    }

    handleVideoDockAddToPlaylist() {
        const videoPlayer = resolveVideoPlayerElement();
        if (videoPlayer && typeof videoPlayer.handleAddToPlaylist === 'function') {
            videoPlayer.handleAddToPlaylist();
        }
    }

    // Video dock volume dropdown is owned by <xavi-volume-control>

    handleVideoPlayerDocked(e) {
        this.isVideoDocked = true;
        this.showVideoPlayerDock();

        // Update initial state
        const detail = e.detail || {};
        this.updateVideoDockTrackInfo(detail);
        this.updateVideoDockPlayState(detail);
    }

    handleVideoPlayerUndocked() {
        this.isVideoDocked = false;

        // Keep the dock visible while open so users can always close from the dock.
        this.showVideoPlayerDock();

        // Keep dock visible while open so users can always close from the dock.
    }

    toggleVideoDockModeMenu() {
        if (!this.videoDockModeMenu) return;
        const isOpen = this.videoDockModeMenu.classList.contains('open');
        if (isOpen) {
            this.closeVideoDockModeMenu();
        } else {
            this.videoDockModeMenu.classList.add('open');
        }
    }

    closeVideoDockModeMenu() {
        if (!this.videoDockModeMenu) return;
        this.videoDockModeMenu.classList.remove('open');
    }

    handleVideoDockClose() {
        const videoPlayer = resolveVideoPlayerElement();
        if (!videoPlayer) return;
        if (typeof videoPlayer.setDockedMode === 'function') {
            videoPlayer.setDockedMode({ pausePlayback: false, allowPlayback: true });
        }
    }

    handleVideoDockSetMode(mode) {
        const videoPlayer = resolveVideoPlayerElement();
        if (!videoPlayer) return;

        const isDocked = !!(videoPlayer.isDocked || videoPlayer.isTaskbarDocked);
        const force = { forceAuthority: true, forceOpenOwner: true };

        if (mode === 'mini') {
            if (typeof videoPlayer.restoreFromDock === 'function') {
                videoPlayer.restoreFromDock('mini', force);
            } else if (typeof videoPlayer.setMiniMode === 'function') {
                videoPlayer.setMiniMode(true, true);
            }
            return;
        }

        if (mode === 'expanded') {
            if (typeof videoPlayer.restoreFromDock === 'function') {
                videoPlayer.restoreFromDock('expanded', force);
            } else if (typeof videoPlayer.setExpandedMode === 'function') {
                videoPlayer.setExpandedMode(true, true);
            }
            return;
        }

        if (mode === 'grid-layer') {
            if (typeof videoPlayer.restoreFromDock === 'function') {
                videoPlayer.restoreFromDock(mode, force);
                return;
            }
            // Fallback if restoreFromDock doesn't support grid modes.
            if (!isDocked && typeof videoPlayer.setExpandedMode === 'function') {
                videoPlayer.setExpandedMode(true, true);
            }
        }
    }

    updateVideoDockTrackInfo(detail = {}) {
        const title = detail.title || 'No video';
        const channelTitle = detail.channelTitle || detail.artist || '';
        const displayText = channelTitle ? `♪ ${title} - ${channelTitle}` : `♪ ${title}`;
        
        // Update dock tab text
        if (this.videoDockTabText) {
            this.videoDockTabText.textContent = displayText;
        }
        if (this.videoDockTabTextDuplicate) {
            this.videoDockTabTextDuplicate.textContent = displayText;
        }
    }

    updateVideoDockPlayState(detail = {}) {
        const isPlaying = detail.isPlaying || false;
        const icon = isPlaying ? '⏸' : '▶';
        const title = isPlaying ? 'Pause' : 'Play';
        
        // Update play/pause button
        if (this.videoDockPlayPauseButton) {
            this.videoDockPlayPauseButton.textContent = icon;
            this.videoDockPlayPauseButton.title = title;
            this.videoDockPlayPauseButton.setAttribute('aria-label', title);
        }
    }

    updateVideoDockTime(currentTime, duration) {
        if (!this.videoDockTimeDisplay) return;
        
        const formatTime = (seconds) => {
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        };
        
        this.videoDockTimeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
    }

    updateVideoDockVolumeDisplay(volume) {
        if (this.videoDockVolumeControl) {
            this.videoDockVolumeControl.value = Math.round(volume);
        }
    }

    syncDockStatesFromComponents() {
        try {
            const musicPlayer = document.querySelector('music-player');
            if (musicPlayer) {
                const mode = (musicPlayer.getAttribute('dock-mode') || musicPlayer.dockMode || '').toLowerCase();
                if (mode === 'embedded') {
                    let detail = {};
                    if (typeof musicPlayer.buildDockDetail === 'function') {
                        try {
                            detail = musicPlayer.buildDockDetail() || {};
                        } catch (err) {
                            detail = musicPlayer._lastDockDetail || {};
                        }
                    } else if (musicPlayer._lastDockDetail) {
                        detail = musicPlayer._lastDockDetail;
                    }
                    this.handleMusicPlayerEmbedded({ detail });
            } else {
                this.handleMusicPlayerRestored();
            }
        }

        const videoPlayer = resolveVideoPlayerElement();
        if (videoPlayer) {
            const isDocked = !!(videoPlayer.isDocked || videoPlayer.isTaskbarDocked);
            if (isDocked) {
                const detail = this.buildVideoDockDetailFromPlayer(videoPlayer);
                this.handleVideoPlayerDocked({ detail });
                } else {
                    this.handleVideoPlayerUndocked();
                }
            }
        } catch (error) {
            console.warn('[Taskbar] Failed to sync dock states', error);
        }
    }

    buildVideoDockDetailFromPlayer(videoPlayer) {
        if (!videoPlayer) {
            return {};
        }

        const track = videoPlayer.currentTrack || {};
        const detail = {
            title: track.title || track.channelTitle || 'Video Player',
            channelTitle: track.channelTitle || '',
            artist: track.channelTitle || '',
            isPlaying: !!videoPlayer.isPlaying
        };

        try {
            if (videoPlayer.player && typeof videoPlayer.player.getCurrentTime === 'function') {
                const currentTime = videoPlayer.player.getCurrentTime();
                if (Number.isFinite(currentTime)) {
                    detail.currentTime = currentTime;
                }
            }
            if (videoPlayer.player && typeof videoPlayer.player.getDuration === 'function') {
                const duration = videoPlayer.player.getDuration();
                if (Number.isFinite(duration)) {
                    detail.duration = duration;
                }
            }
        } catch (err) {
            /* ignore timing lookup issues */
        }

        return detail;
    }

    showVideoPlayerDock() {
        if (this.videoPlayerDock) {
            this.videoPlayerDock.classList.add('visible');
        }
    }

    hideVideoPlayerDock() {
        if (this.videoPlayerDock) {
            this.videoPlayerDock.classList.remove('visible');
        }
    }

}

customElements.define('panel-taskbar', Taskbar);
