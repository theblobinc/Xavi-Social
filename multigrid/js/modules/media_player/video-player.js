// application/single_pages/xavi/js/video-player.js
// Version: 2025-10-31-v5 - Dock tab with controls, window resize handling, expanded mode top-right anchored

const VIDEO_AUTHORITY_STALE_MS = 5 * 60 * 1000;

class VideoPlayer extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        this.shadowRoot.innerHTML = `
                <style>
                    :host {
                        position: fixed; /* Changed from absolute */
                        pointer-events: none;
                        display: none; /* Hidden by default */
                        z-index: var(--z-video-dock, 3300); /* VIDEO_DOCK layer */
                        /* Remove inset: 0 - let the player size itself */
                    }
                    
                    :host(.has-video) {
                        display: block; /* Show when video is loaded */
                    }

                    .video-lightbox {
                        position: fixed; /* Changed from absolute */
                        bottom: 24px;
                        right: 24px;
                        display: none; /* Hidden by default until video is loaded */
                        flex-direction: column;
                        width: var(--mini-width, 640px);
                        height: var(--mini-height, 400px);
                        background: rgba(12, 12, 12, 0.94);
                        border-radius: 16px;
                        border: 1px solid rgba(255, 255, 255, 0.14);
                        box-shadow: 0 24px 48px rgba(0, 0, 0, 0.45);
                        overflow: hidden;
                        color: #fff;
                        pointer-events: auto;
                        user-select: none;
                        transition: box-shadow 0.2s ease;
                    }

                    /* Default aspect ratio for the media area (can be overridden later if needed). */
                    .video-lightbox {
                        --video-aspect: 16 / 9;
                    }
                    
                    .video-lightbox.has-video {
                        display: flex; /* Show when video is loaded */
                    }

                    .video-lightbox.mini {
                        width: var(--mini-width, 640px);
                        height: var(--mini-height, 400px);
                    }

                    .video-lightbox.expanded {
                        width: 720px;
                        height: 480px;
                        top: 40px;
                        right: 24px;
                        bottom: auto;
                        left: auto;
                        transform: none;
                        border-radius: 18px;
                    }

                    .video-lightbox.grid-layer {
                        background: transparent;
                        border: none;
                        box-shadow: none;
                        border-radius: 0;
                    }

                    .video-lightbox.grid-layer #header {
                        display: none;
                    }

                    .video-lightbox.grid-layer .resize-handles {
                        display: none;
                    }

                    /* Grid layer is a sub-layer: visible, not interactive */
                    .video-lightbox.grid-layer {
                        pointer-events: none;
                    }

                    /* Small screens (~400px): shrink to fit viewport and preserve video aspect ratio. */
                    @media (max-width: 420px) {
                        .video-lightbox {
                            left: 6px;
                            right: 6px;
                            bottom: 8px;
                            border-radius: 12px;
                        }

                        .video-lightbox.mini,
                        .video-lightbox.expanded {
                            width: calc(100vw - 12px);
                        }

                        /* Let the container size itself based on aspect ratio (JS will clamp expanded height). */
                        .video-lightbox.mini {
                            height: auto;
                        }

                        #header {
                            gap: 8px;
                            padding: 8px 8px;
                        }

                        #control-cluster {
                            gap: 4px;
                        }

                        .control-button {
                            min-width: 26px;
                            height: 26px;
                            padding: 0 6px;
                            border-radius: 6px;
                            font-size: 12px;
                        }

                        .time-display {
                            font-size: 0.72rem;
                            padding: 0 4px;
                        }

                        #video-player {
                            width: 100%;
                            height: auto;
                            flex: 0 0 auto;
                            aspect-ratio: var(--video-aspect, 16 / 9);
                        }

                        #video-player ::slotted(*) {
                            width: 100%;
                            height: 100%;
                        }
                    }

                    #header {
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        gap: 12px;
                        padding: 12px 16px;
                        background: linear-gradient(180deg, rgba(28, 28, 28, 0.96), rgba(18, 18, 18, 0.92));
                        cursor: default;
                    }

                    /* Only show grab cursor in expanded mode */
                    .video-lightbox.expanded #header {
                        cursor: grab;
                    }

                    .video-lightbox.expanded #header.dragging {
                        cursor: grabbing;
                    }

                    #title {
                        display: inline-flex;
                        align-items: center;
                        gap: 8px;
                        color: rgba(255, 255, 255, 0.85);
                        font-size: 0.85rem;
                        letter-spacing: 0.03em;
                        text-transform: uppercase;
                    }

                    #control-cluster {
                        display: inline-flex;
                        align-items: center;
                        gap: 6px;
                        flex-wrap: wrap;
                    }

                    .control-button {
                        min-width: 32px;
                        height: 32px;
                        padding: 0 10px;
                        border-radius: 8px;
                        border: none;
                        background: rgba(255, 255, 255, 0.08);
                        color: rgba(255, 255, 255, 0.82);
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 13px;
                        cursor: pointer;
                        transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease;
                        white-space: nowrap;
                    }

                    .control-button:hover {
                        background: rgba(255, 255, 255, 0.2);
                        color: #fff;
                    }

                    .control-button:active {
                        transform: translateY(1px);
                    }

                    .control-button.danger:hover {
                        background: rgba(235, 87, 87, 0.25);
                        color: #ff7a7a;
                    }

                    .time-display {
                        font-size: 0.8rem;
                        color: rgba(255, 255, 255, 0.7);
                        font-variant-numeric: tabular-nums;
                        white-space: nowrap;
                        user-select: none;
                        padding: 0 8px;
                    }

                    .volume-control-wrapper {
                        position: relative;
                        display: inline-flex;
                    }

                    .volume-dropdown {
                        position: absolute;
                        top: calc(100% + 4px);
                        right: 0;
                        width: 180px;
                        background: rgba(18, 18, 18, 0.96);
                        border: 1px solid rgba(255, 255, 255, 0.24);
                        border-radius: 12px;
                        padding: 12px 16px;
                        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
                        opacity: 0;
                        pointer-events: none;
                        transform: translateY(-8px);
                        transition: opacity 0.2s ease, transform 0.2s ease;
                        z-index: 10;
                    }

                    .volume-dropdown.visible {
                        opacity: 1;
                        pointer-events: auto;
                        transform: translateY(0);
                    }

                    .volume-slider-container {
                        display: flex;
                        align-items: center;
                        gap: 10px;
                        min-width: 120px;
                        width: 150px;
                    }

                    .volume-slider {
                        flex: 1;
                        min-width: 80px;
                        -webkit-appearance: none;
                        appearance: none;
                        height: 4px;
                        background: rgba(255, 255, 255, 0.2);
                        border-radius: 2px;
                        outline: none;
                        cursor: pointer;
                    }

                    .volume-slider::-webkit-slider-thumb {
                        -webkit-appearance: none;
                        appearance: none;
                        width: 14px;
                        height: 14px;
                        background: rgba(255, 255, 255, 0.9);
                        border-radius: 50%;
                        cursor: pointer;
                        transition: background 0.15s ease;
                    }

                    .volume-slider::-webkit-slider-thumb:hover {
                        background: #fff;
                    }

                    .volume-slider::-moz-range-thumb {
                        width: 14px;
                        height: 14px;
                        background: rgba(255, 255, 255, 0.9);
                        border-radius: 50%;
                        border: none;
                        cursor: pointer;
                        transition: background 0.15s ease;
                    }

                    .volume-slider::-moz-range-thumb:hover {
                        background: #fff;
                    }

                    .volume-percentage {
                        font-size: 0.8rem;
                        color: rgba(255, 255, 255, 0.7);
                        font-variant-numeric: tabular-nums;
                        min-width: 35px;
                        text-align: right;
                    }

                    #dock-button {
                        display: none;
                    }

                    .video-lightbox.expanded #dock-button {
                        display: inline-flex;
                    }

                    /* Hide dedicated Dock button (mode button handles docking). */
                    .video-lightbox #dock-button {
                        display: none !important;
                    }

                    /* Mini mode is fixed-position/size: hide grid toggle + mode text button. */
                    .video-lightbox.mini #mode-button {
                        display: none;
                    }

                    .video-lightbox.expanded #expand-button {
                        display: none;
                    }

                    /* On most mobile devices, volume is handled by the OS. */
                    @media (pointer: coarse) {
                        #volume-control,
                        #dock-volume-control {
                            display: none !important;
                        }
                    }

                    #video-player {
                        position: relative;
                        width: 100%;
                        height: 100%;
                        flex: 1;
                        background: black;
                    }

                    #video-player ::slotted(*) {
                        width: 100%;
                        height: 100%;
                        display: block;
                    }

                    .video-lightbox.docked {
                        display: none !important;
                    }

                    #resize-handle {
                        position: absolute;
                        inset: auto 12px 12px auto;
                        width: 18px;
                        height: 18px;
                        border-radius: 4px;
                        background: linear-gradient(135deg, rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0.05));
                        cursor: se-resize;
                        opacity: 0;
                        transition: opacity 0.2s ease;
                        pointer-events: none;
                        display: none; /* Hide old handle */
                    }

                    /* New resize handles */
                    .resize-handles {
                        position: absolute;
                        inset: 0;
                        pointer-events: none;
                        opacity: 0;
                        transition: opacity 0.2s ease;
                    }

                    .video-lightbox.expanded .resize-handles {
                        opacity: 1;
                    }

                    .resize-handle {
                        position: absolute;
                        background: rgba(74, 158, 255, 0.6);
                        transition: background 0.15s ease;
                        pointer-events: auto;
                        touch-action: none;
                        z-index: 5;
                    }

                    .resize-handle:hover {
                        background: rgba(74, 158, 255, 0.9);
                    }

                    /* Edge handles */
                    .resize-n, .resize-s {
                        left: 20px;
                        right: 20px;
                        height: 6px;
                        cursor: ns-resize;
                    }

                    .resize-n {
                        top: 0;
                        border-radius: 0 0 3px 3px;
                    }

                    .resize-s {
                        bottom: 0;
                        border-radius: 3px 3px 0 0;
                    }

                    .resize-e, .resize-w {
                        top: 20px;
                        bottom: 20px;
                        width: 6px;
                        cursor: ew-resize;
                    }

                    .resize-e {
                        right: 0;
                        border-radius: 3px 0 0 3px;
                    }

                    .resize-w {
                        left: 0;
                        border-radius: 0 3px 3px 0;
                    }

                    /* Corner handles */
                    .resize-ne, .resize-nw, .resize-se, .resize-sw {
                        width: 12px;
                        height: 12px;
                    }

                    .resize-ne {
                        top: 0;
                        right: 0;
                        cursor: nesw-resize;
                        border-radius: 0 0 0 3px;
                    }

                    .resize-nw {
                        top: 0;
                        left: 0;
                        cursor: nwse-resize;
                        border-radius: 0 0 3px 0;
                    }

                    .resize-se {
                        bottom: 0;
                        right: 0;
                        cursor: nwse-resize;
                        border-radius: 3px 0 0 0;
                    }

                    .resize-sw {
                        bottom: 0;
                        left: 0;
                        cursor: nesw-resize;
                        border-radius: 0 3px 0 0;
                    }

                    /* Mini mode: hide all resize handles */
                    .video-lightbox.mini .resize-handles {
                        display: none;
                    }

                    .video-lightbox.mini #resize-handle {
                        display: none;
                    }

                    .reopen-chip {
                        position: absolute;
                        bottom: 24px;
                        right: 24px;
                        border-radius: 999px;
                        background: rgba(12, 12, 12, 0.9);
                        color: white;
                        border: 1px solid rgba(255, 255, 255, 0.2);
                        padding: 8px 16px;
                        font-size: 0.9rem;
                        cursor: pointer;
                        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
                        z-index: var(--z-music-expanded-player, 3100); /* MUSIC_EXPANDED_PLAYER layer */
                        transition: background 0.2s ease;
                    }

                    .reopen-chip:hover {
                        background: rgba(255, 255, 255, 0.12);
                    }

                    .dock-tab {
                        position: absolute;
                        bottom: 8px;
                        right: 8px;
                        left: auto;
                        display: flex;
                        flex-direction: column;
                        min-width: 320px;
                        max-width: 450px;
                        background: rgba(18, 18, 18, 0.94);
                        color: #fff;
                        border: 1px solid rgba(255, 255, 255, 0.24);
                        border-radius: 14px;
                        box-shadow: 0 12px 24px rgba(0, 0, 0, 0.45);
                        z-index: var(--z-music-expanded-player, 3100); /* MUSIC_EXPANDED_PLAYER layer */
                        pointer-events: auto;
                        overflow: hidden;
                    }

                    .dock-tab.hidden {
                        display: none !important;
                    }

                    .dock-tab-controls {
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        gap: 6px;
                        padding: 8px 12px;
                        background: linear-gradient(180deg, rgba(28, 28, 28, 0.96), rgba(22, 22, 22, 0.92));
                        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                    }

                    .dock-tab-header {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        padding: 10px 16px;
                        background: linear-gradient(180deg, rgba(22, 22, 22, 0.92), rgba(18, 18, 18, 0.92));
                        cursor: pointer;
                    }

                    .dock-tab-header:hover {
                        background: linear-gradient(180deg, rgba(32, 32, 32, 0.96), rgba(28, 28, 28, 0.92));
                    }

                    .dock-tab-title {
                        flex: 1;
                        overflow: hidden;
                        white-space: nowrap;
                        font-size: 0.9rem;
                        letter-spacing: 0.02em;
                        color: rgba(255, 255, 255, 0.85);
                        text-align: center;
                    }

                    .dock-tab-content {
                        display: inline-block;
                        animation: scroll-left 15s linear infinite;
                    }

                    .dock-tab-header:hover .dock-tab-content {
                        animation-play-state: paused;
                    }

                    @keyframes scroll-left {
                        0% { transform: translateX(0); }
                        100% { transform: translateX(-50%); }
                    }

                    .status-chip {
                        position: absolute;
                        left: 50%;
                        bottom: 16px;
                        transform: translateX(-50%) translateY(20px);
                        background: rgba(32, 32, 32, 0.92);
                        color: #fff;
                        padding: 6px 14px;
                        border-radius: 999px;
                        font-size: 0.82rem;
                        border: 1px solid rgba(255, 255, 255, 0.22);
                        box-shadow: 0 12px 24px rgba(0, 0, 0, 0.35);
                        opacity: 0;
                        pointer-events: none;
                        transition: opacity 0.2s ease, transform 0.2s ease;
                    }

                    .status-chip.visible {
                        opacity: 1;
                        transform: translateX(-50%) translateY(0);
                    }
                </style>

                <div class="video-lightbox" id="lightbox">
                    <div id="header">
                        <span id="title" aria-hidden="true"></span>
                        <div id="control-cluster">
                            <span id="time-display" class="time-display">0:00 / 0:00</span>
                            <button id="prev-button" class="control-button" aria-label="Previous track" title="Previous track">⏮</button>
                            <button id="play-pause-button" class="control-button" aria-label="Play/Pause" title="Play/Pause">▶</button>
                            <button id="next-button" class="control-button" aria-label="Next track" title="Next track">⏭</button>
                            <xavi-volume-control id="volume-control" storage-key="myVolume" source="video-player" label="Volume"></xavi-volume-control>
                            <button id="mode-button" class="control-button" aria-label="Switch to mini player" title="Switch to mini player">⤡</button>
                            <button id="dock-button" class="control-button" aria-label="Dock player" title="Dock player">Dock</button>
                            <button id="expand-button" class="control-button" aria-label="Expand player" title="Expand player">⤢</button>
                            <button id="fullscreen-button" class="control-button" aria-label="Toggle fullscreen" title="Toggle fullscreen">⛶</button>
                            <button id="close-button" class="control-button danger" aria-label="Close player" title="Close player">✕</button>
                        </div>
                    </div>
                    <div id="video-player"><slot name="yt-player-host"></slot></div>
                    <div class="resize-handles">
                        <div class="resize-handle resize-n" data-direction="n"></div>
                        <div class="resize-handle resize-ne" data-direction="ne"></div>
                        <div class="resize-handle resize-e" data-direction="e"></div>
                        <div class="resize-handle resize-se" data-direction="se"></div>
                        <div class="resize-handle resize-s" data-direction="s"></div>
                        <div class="resize-handle resize-sw" data-direction="sw"></div>
                        <div class="resize-handle resize-w" data-direction="w"></div>
                        <div class="resize-handle resize-nw" data-direction="nw"></div>
                    </div>
                </div>
                <div id="dock-tab" class="dock-tab hidden">
                    <div class="dock-tab-controls">
                        <span id="dock-time-display" class="time-display">0:00 / 0:00</span>
                        <button id="dock-prev-button" class="control-button" aria-label="Previous track" title="Previous track">⏮</button>
                        <button id="dock-play-pause-button" class="control-button" aria-label="Play/Pause" title="Play/Pause">▶</button>
                        <button id="dock-next-button" class="control-button" aria-label="Next track" title="Next track">⏭</button>
                        <xavi-volume-control id="dock-volume-control" storage-key="myVolume" source="video-player-dock" label="Volume" compact></xavi-volume-control>
                        <button id="dock-mode-button" class="control-button" aria-label="Restore player" title="Restore player">Open</button>
                        <button id="dock-expand-button" class="control-button" aria-label="Expand player" title="Expand player">⤢</button>
                    </div>
                    <div class="dock-tab-header" id="dock-tab-header">
                        <div class="dock-tab-title">
                            <span class="dock-tab-content">
                                <span id="dock-tab-text">Video Player</span>
                                <span id="dock-tab-text-duplicate" aria-hidden="true">Video Player</span>
                            </span>
                        </div>
                    </div>
                </div>
            `;

            // Wire critical control handlers immediately after template creation.
            // (Some runtime errors earlier in connectedCallback can prevent later bindings.)
            const expandButtonEarly = this.shadowRoot.getElementById('expand-button');
            if (expandButtonEarly) {
                expandButtonEarly.addEventListener('click', () => this.toggleExpand());
            }

            const modeButtonEarly = this.shadowRoot.getElementById('mode-button');
            if (modeButtonEarly) {
                modeButtonEarly.addEventListener('click', (e) => this.handleModeButtonClick(e));
                modeButtonEarly.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    this.handleModeButtonClick(e, { direction: -1 });
                });
            }

            const closeButtonEarly = this.shadowRoot.getElementById('close-button');
            if (closeButtonEarly) {
                closeButtonEarly.addEventListener('click', () => {
                    this.setDockedMode({ pausePlayback: false, allowPlayback: true });
                });
            }

            this.defaultZIndex = '9998';
            this.expandedZIndex = '1110';
            this.style.zIndex = this.defaultZIndex;

            this.isExpanded = false;
            this.isFullscreen = false;
            this.isDocked = false;
            this.isTaskbarDocked = false; // New: tracks if docked in taskbar
            this.gridMode = 'none'; // none | full | layer
            this.sizeMultiplier = 1;
            this.lastActiveMode = 'mini';
            this.currentTrack = null;
            this.timeUpdateInterval = null;

            this.isDragging = false;
            this.isResizing = false;
            this.resizeDirection = null;
            this.startX = 0;
            this.startY = 0;
            this.startWidth = 0;
            this.startHeight = 0;
            this.startLeft = 0;
            this.startTop = 0;
            this.gridSnapEnabled = false;
            this.gridSize = 30; // Snap to 30px grid to match panels
            this._contentAreaEl = null;
            this._floatingLayerEl = null;
            this._workspaceEl = null;

            this.player = null;
            this._expandedState = null;
            this._miniState = null;
            this.statusTimeout = null;
            this.allowDockedPlayback = false;

            this.storageSyncHandler = (e) => {
                if (e.key === this.getStateKey() && e.newValue) {
                    this.applyState(JSON.parse(e.newValue), true);
                }
                if (e.key === this.getAuthorityStateKey()) {
                    this.handleAuthorityStorageUpdate(e.newValue);
                }
            };

            this.syncListener = null;
            this.suppressModeSync = false;
            this.lastSyncedVideoState = null;
            this.syncSessionId = window.xaviSyncSessionId || null;
            this.localSessionId = this.ensureLocalSessionId();
            this.authorityToken = null;
            this.lastAuthoritySnapshot = null;
            this.boundAuthoritySyncHandler = (event) => this.handleAuthoritySync(event);
            this.pendingVideoLoad = null;
            this.isCurrentlyPlaying = false;
            this._restoreCallDepth = 0;
            this._tabScopeId = null;
            this._workspaceScopeKey = null;

            const initialAuthority = this.readAuthorityState();
            if (initialAuthority && this.belongsToCurrentSession(initialAuthority)) {
                this.authorityToken = initialAuthority.token || null;
                this.lastAuthoritySnapshot = { ...initialAuthority };
            }

            this.boundDragHandler = (e) => this.drag(e);
            this.boundStopDragHandler = () => this.stopDragging();
            this.boundResizeHandler = (e) => this.resize(e);
            this.boundStopResizeHandler = () => this.stopResizing();
            this.boundTouchDragHandler = (e) => this.drag(e);
            this.boundTouchStopDragHandler = () => this.stopDragging();
            this.boundTouchResizeHandler = (e) => this.resize(e);
            this.boundTouchStopResizeHandler = () => this.stopResizing();
            this.boundFullscreenHandler = () => this.handleFullscreenChange();
            this.boundWindowResizeHandler = () => this.handleWindowResize();
            this.boundPlaylistProgressHandler = (event) => this.handlePlaylistProgress(event?.detail || null);
            this.boundWorkspaceReadyHandler = () => this.scheduleFloatingLayerAttach();
            this.resizeOverlay = null;
        }

        getStateKey() {
            return `videoPlayerState.${this.getWorkspaceScopeKey()}`;
        }

        getWorkspaceScopeKey() {
            const workspaceId = window.__panelTaskbar?.workspaceId || window.__bootWorkspaceId || null;
            if (workspaceId) {
                const scope = `workspace-${workspaceId}`;
                if (this._workspaceScopeKey !== scope) {
                    this._workspaceScopeKey = scope;
                }
                return scope;
            }

            if (this._workspaceScopeKey && this._workspaceScopeKey.startsWith('workspace-')) {
                return this._workspaceScopeKey;
            }

            const tabScope = this.getTabScopeId();
            if (tabScope) {
                const scope = `tab-${tabScope}`;
                if (this._workspaceScopeKey !== scope) {
                    this._workspaceScopeKey = scope;
                }
                return scope;
            }

            this._workspaceScopeKey = 'ws-default';
            return this._workspaceScopeKey;
        }

        getLegacyStateKeys() {
            const keys = [];
            const tabScope = this.getTabScopeId();
            if (tabScope) {
                keys.push(`videoPlayerState.tab-${tabScope}`);
            }
            const rawWorkspaceId = window.__panelTaskbar?.workspaceId || window.__bootWorkspaceId || null;
            if (rawWorkspaceId) {
                keys.push(`videoPlayerState.${rawWorkspaceId}`);
            }
            return keys;
        }

        getTabScopeId() {
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

        saveState(sync = true) {
            const lightbox = this.shadowRoot.getElementById('lightbox');
            if (!lightbox) return;

            if (this.suppressModeSync) {
                sync = false;
            }

            if (this.isExpanded) {
                const workspaceRect = this.getWorkspaceRect();
                const rect = lightbox.getBoundingClientRect();
                const originLeft = workspaceRect?.left || 0;
                const originTop = workspaceRect?.top || 0;
                const topAbs = Number.parseFloat(lightbox.style.top);
                const leftAbs = Number.parseFloat(lightbox.style.left);
                const relTop = Number.isFinite(topAbs) ? (topAbs - originTop) : (rect.top - originTop);
                const relLeft = Number.isFinite(leftAbs) ? (leftAbs - originLeft) : (rect.left - originLeft);
                this._expandedState = {
                    ...(this._expandedState || {}),
                    top: `${Math.round(Number.isFinite(relTop) ? relTop : 0)}px`,
                    left: `${Math.round(Number.isFinite(relLeft) ? relLeft : 0)}px`,
                    right: '',
                    width: lightbox.style.width || `${rect.width}px`,
                    height: lightbox.style.height || `${rect.height}px`,
                    userAdjusted: !!this._expandedState?.userAdjusted
                };
            } else if (!this.isDocked) {
                const workspaceRect = this.getWorkspaceRect();
                const rect = lightbox.getBoundingClientRect();
                const resolvedLeft = lightbox.style.left ? parseFloat(lightbox.style.left) : rect.left - (workspaceRect?.left || 0);
                const resolvedTop = lightbox.style.top ? parseFloat(lightbox.style.top) : rect.top - (workspaceRect?.top || 0);
                this._miniState = {
                    left: Number.isFinite(resolvedLeft) ? resolvedLeft : 0,
                    top: Number.isFinite(resolvedTop) ? resolvedTop : 0,
                    width: lightbox.style.width || null,
                    height: lightbox.style.height || null
                };
            }

            const state = {
                mode: this.isDocked ? 'docked' : (this.isExpanded ? 'expanded' : 'mini'),
                surfaceMode: this.getSurfaceMode(),
                gridMode: this.gridMode,
                expandedState: this._expandedState,
                miniState: this._miniState,
                sizeMultiplier: this.sizeMultiplier,
                lastActiveMode: this.lastActiveMode,
                timestamp: Date.now()
            };
            localStorage.setItem(this.getStateKey(), JSON.stringify(state));
            if (sync) {
                window.dispatchEvent(new StorageEvent('storage', { key: this.getStateKey(), newValue: JSON.stringify(state) }));
            }
        }

        getAuthorityStateKey() {
            return 'videoPlayerAuthority';
        }

        getAuthorityToken() {
            if (this.authorityToken) {
                return this.authorityToken;
            }
            const snapshot = this.readAuthorityState();
            if (snapshot && this.belongsToCurrentSession(snapshot)) {
                this.authorityToken = snapshot.token || null;
                return this.authorityToken;
            }
            return null;
        }

        generateAuthorityToken() {
            if (typeof crypto !== 'undefined' && crypto.randomUUID) {
                return crypto.randomUUID();
            }
            return `vid-owner-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        }

        ensureLocalSessionId() {
            if (typeof window === 'undefined' || !window.sessionStorage) {
                return `video-session-${Date.now()}`;
            }
            try {
                let existing = sessionStorage.getItem('videoPlayerSessionId');
                if (!existing) {
                    existing = this.generateAuthorityToken();
                    sessionStorage.setItem('videoPlayerSessionId', existing);
                }
                return existing;
            } catch (error) {
                return `video-session-${Date.now()}`;
            }
        }

        getSessionId() {
            return this.syncSessionId || window.xaviSyncSessionId || this.localSessionId;
        }

        parseAuthorityPayload(raw) {
            if (!raw) return null;
            if (typeof raw === 'object') {
                return raw;
            }
            try {
                return JSON.parse(raw);
            } catch (error) {
                return null;
            }
        }

        readAuthorityState() {
            const key = this.getAuthorityStateKey();
            let raw = null;
            try {
                if (window.xaviSync && typeof window.xaviSync.get === 'function') {
                    raw = window.xaviSync.get(key);
                }
            } catch (error) {
                raw = null;
            }

            if (!raw && typeof window !== 'undefined' && window.localStorage) {
                try {
                    raw = localStorage.getItem(key);
                } catch (error) {
                    raw = null;
                }
            }

            const snapshot = this.parseAuthorityPayload(raw);
            if (snapshot && snapshot.timestamp && typeof snapshot.timestamp === 'string') {
                snapshot.timestamp = parseInt(snapshot.timestamp, 10) || 0;
            }
            return snapshot;
        }

        belongsToCurrentSession(snapshot) {
            if (!snapshot) return false;
            return snapshot.sessionId === this.getSessionId();
        }

        isAuthorityOwner(snapshot = null) {
            const currentSnapshot = snapshot || this.readAuthorityState();
            if (!currentSnapshot || !currentSnapshot.token) {
                return false;
            }
            return this.belongsToCurrentSession(currentSnapshot) && currentSnapshot.token === this.getAuthorityToken();
        }

        async persistAuthority(payload) {
            const key = this.getAuthorityStateKey();
            if (window.xaviSync && typeof window.xaviSync.set === 'function') {
                try {
                    await window.xaviSync.set(key, payload);
                    return;
                } catch (error) {
                    console.warn('video-player authority sync failed, falling back to localStorage:', error);
                }
            }

            if (typeof window === 'undefined' || !window.localStorage) {
                return;
            }

            try {
                if (!payload) {
                    localStorage.removeItem(key);
                } else {
                    localStorage.setItem(key, JSON.stringify(payload));
                }
            } catch (error) {
                // Ignore storage write failures (quota, private mode, etc.).
            }
        }

        assumeAuthority(mode = 'mini') {
            const now = Date.now();
            const sessionId = this.getSessionId();
            const existing = this.readAuthorityState();
            const owns = existing && this.belongsToCurrentSession(existing) && existing.token === this.authorityToken;

            if (owns) {
                const payload = {
                    token: this.authorityToken,
                    sessionId,
                    mode,
                    timestamp: now
                };
                this.lastAuthoritySnapshot = { ...payload };
                this.persistAuthority(payload).catch(() => {});
                return true;
            }

            if (existing && existing.token && !this.belongsToCurrentSession(existing)) {
                const age = now - (existing.timestamp || 0);
                if (age < VIDEO_AUTHORITY_STALE_MS) {
                    return false;
                }
            }

            this.authorityToken = this.generateAuthorityToken();
            const payload = {
                token: this.authorityToken,
                sessionId,
                mode,
                timestamp: now
            };
            this.lastAuthoritySnapshot = { ...payload };
            this.persistAuthority(payload).catch(() => {});
            return true;
        }

        releaseAuthority(force = false) {
            const sessionId = this.getSessionId();
            const existing = this.readAuthorityState();
            const owns = existing && existing.token && existing.sessionId === sessionId && existing.token === this.authorityToken;

            if (!force && !owns) {
                this.authorityToken = null;
                return false;
            }

            this.authorityToken = null;
            this.lastAuthoritySnapshot = null;
            this.persistAuthority(null).catch(() => {});
            return true;
        }

        handleAuthorityStorageUpdate(rawValue) {
            const snapshot = this.parseAuthorityPayload(rawValue);
            this.processAuthoritySnapshot(snapshot, 'storage');
        }

        handleAuthoritySync(event) {
            const detail = event?.detail;
            if (!detail || !Array.isArray(detail.keys)) {
                return;
            }
            if (!detail.keys.includes('videoPlayerAuthority')) {
                return;
            }
            const snapshot = this.readAuthorityState();
            this.processAuthoritySnapshot(snapshot, 'sync');
        }

        processAuthoritySnapshot(snapshot, source = 'unknown') {
            const previous = this.lastAuthoritySnapshot ? JSON.stringify(this.lastAuthoritySnapshot) : null;
            const current = snapshot ? JSON.stringify(snapshot) : null;
            if (previous === current) {
                return;
            }

            this.lastAuthoritySnapshot = snapshot ? { ...snapshot } : null;

            if (snapshot && this.belongsToCurrentSession(snapshot)) {
                this.authorityToken = snapshot.token || null;
                return;
            }

            this.authorityToken = null;

            if (!snapshot || !snapshot.token) {
                return;
            }

            if (!this.isDocked) {
                this.suppressModeSync = true;
                this.setDockedMode({ pausePlayback: true });
                this.suppressModeSync = false;
                if (source !== 'init') {
                    this.showStatus('Video player control moved to another window');
                }
                this.updatePlayingIndicator(false);
            }
        }

        ensureAuthority(mode) {
            const success = this.assumeAuthority(mode);
            if (!success) {
                this.showStatus('Video player is active in another window');
            }
            return success;
        }

        canAdoptUndockedState(mode, snapshot = null) {
            if (mode !== 'mini' && mode !== 'expanded') {
                return true;
            }
            const reference = snapshot || this.readAuthorityState();
            if (!reference || !reference.token) {
                return true;
            }
            return this.belongsToCurrentSession(reference) && reference.token === this.getAuthorityToken();
        }

        initializeAuthoritySync() {
            this.syncSessionId = window.xaviSyncSessionId || this.syncSessionId || this.localSessionId;
            const snapshot = this.readAuthorityState();
            this.processAuthoritySnapshot(snapshot, 'init');

            const currentMode = this.isDocked ? 'docked' : (this.isExpanded ? 'expanded' : 'mini');
            if (currentMode === 'mini' || currentMode === 'expanded') {
                const latestSnapshot = this.readAuthorityState();
                if (!latestSnapshot || this.belongsToCurrentSession(latestSnapshot)) {
                    this.assumeAuthority(currentMode);
                }
            }

            if (window.xaviSyncReady && typeof window.xaviSyncReady.then === 'function') {
                window.xaviSyncReady.then((sync) => {
                    if (sync && sync.sessionId) {
                        this.syncSessionId = sync.sessionId;
                    }
                    this.processAuthoritySnapshot(this.readAuthorityState(), 'sync-ready');

                    const modeAfterSync = this.isDocked ? 'docked' : (this.isExpanded ? 'expanded' : 'mini');
                    if (modeAfterSync === 'mini' || modeAfterSync === 'expanded') {
                        const refreshedSnapshot = this.readAuthorityState();
                        if (!refreshedSnapshot || this.belongsToCurrentSession(refreshedSnapshot)) {
                            this.assumeAuthority(modeAfterSync);
                        }
                    }
                }).catch(() => {
                    /* ignore sync readiness failures */
                });
            }
        }

        restoreState() {
            const stateKey = this.getStateKey();
            let stateJson = localStorage.getItem(stateKey);
            if (!stateJson) {
                const legacyKeys = this.getLegacyStateKeys();
                for (const legacyKey of legacyKeys) {
                    if (!legacyKey || legacyKey === stateKey) {
                        continue;
                    }
                    stateJson = localStorage.getItem(legacyKey);
                    if (stateJson) {
                        break;
                    }
                }
            }

            if (!stateJson) {
                this.setDockedMode(true);
                return;
            }
            const state = JSON.parse(stateJson);
            this.applyState(state, false);
        }

        applyState(state = {}, isFromStorage = false) {
            const lightbox = this.shadowRoot.getElementById('lightbox');
            if (!state || !lightbox) return;

            this._expandedState = state.expandedState || null;
            this._miniState = state.miniState || null;
            this.sizeMultiplier = state.sizeMultiplier || 1;
            this.lastActiveMode = state.lastActiveMode || 'mini';
            this.gridMode = state.gridMode || this.gridMode || 'none';

            const playbackActive = localStorage.getItem('myIsPlaying') === '1';
            let desiredSurface = state.surfaceMode || null;
            let desiredMode = state.mode;
            if (playbackActive && desiredMode === 'docked') {
                desiredMode = state.lastActiveMode === 'expanded' ? 'expanded' : 'mini';
                desiredSurface = desiredSurface || desiredMode;
            }

            const normalizedSurface = desiredSurface || desiredMode || 'docked';

            const authoritySnapshot = this.readAuthorityState();
            if (!this.canAdoptUndockedState(desiredMode, authoritySnapshot)) {
                if (!this.isDocked) {
                    this.suppressModeSync = true;
                    this.setDockedMode({ skipSave: true, pausePlayback: true });
                    this.suppressModeSync = false;
                }
                return;
            }

            // Back-compat: grid-full is deprecated; treat as grid-layer.
            if (normalizedSurface === 'grid-full' || normalizedSurface === 'grid-layer') {
                this.setGridMode('layer', true, true);
            } else if (desiredMode === 'expanded') {
                this.setExpandedMode(true, true);
            } else if (desiredMode === 'docked') {
                this.setDockedMode(true);
            } else if (desiredMode === 'mini') {
                this.setMiniMode(true, true);
            } else {
                // Default to docked if mode is unclear
                this.setDockedMode(true);
            }

            // Mini mode is always anchored above the taskbar (bottom-right).
            // Do not restore persisted mini left/top positioning.
            if (this.gridMode === 'none' && !this.isExpanded && !this.isDocked) {
                this.positionMiniPlayer(lightbox);
            }

            lightbox.style.display = 'block';
        }

    connectedCallback() {
        const lightbox = this.shadowRoot.getElementById('lightbox');
        lightbox.classList.remove('expanded', 'mini');
        lightbox.classList.add('mini');
        lightbox.style.display = 'block';
        window.addEventListener('xavi-workspace-ready', this.boundWorkspaceReadyHandler);
        window.__videoPlayerElement = this;
        this.restoreState();

        // After restoring state, attach to the correct layer.
        // Grid-layer must live in the background layer and must not be yanked back
        // into the floating layer (that causes disconnect/connect storms).
        if (this.gridMode === 'layer') {
            this.ensureAttachedToBackgroundLayer();
        } else {
            this.ensureAttachedToFloatingLayer();
            this.scheduleFloatingLayerAttach();
        }

        // The YouTube IFrame API can behave inconsistently when the player is created inside a shadow root.
        // We slot a light-DOM host element into the shadow UI and pass that element to YT.Player.
        this.ensureYouTubeHost();

        console.log('[VideoPlayer] connectedCallback - checking for YT.Player...', { hasYT: !!window.YT, hasPlayer: !!window.YT?.Player });
        if (window.YT && window.YT.Player) {
            this.initializePlayer();
        } else {
            console.log('[VideoPlayer] Waiting for YouTube iframe API...');
            const previousReady = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = () => {
                console.log('[VideoPlayer] YouTube iframe API ready callback fired!');
                if (typeof previousReady === 'function') {
                    previousReady();
                }
                this.initializePlayer();
            };
        }

    const header = this.shadowRoot.getElementById('header');
    const modeButton = this.shadowRoot.getElementById('mode-button');
    const dockButton = this.shadowRoot.getElementById('dock-button');
    const expandButton = this.shadowRoot.getElementById('expand-button');
    const fullscreenButton = this.shadowRoot.getElementById('fullscreen-button');
    const resizeHandle = this.shadowRoot.getElementById('resize-handle');
    const videoContainer = this.shadowRoot.getElementById('video-player');
    const dockTab = this.shadowRoot.getElementById('dock-tab');
    const dockTabHeader = this.shadowRoot.getElementById('dock-tab-header');
    const dockModeButton = this.shadowRoot.getElementById('dock-mode-button');
    const dockExpandButton = this.shadowRoot.getElementById('dock-expand-button');

        header.addEventListener('mousedown', (e) => this.startDragging(e));
        document.addEventListener('mousemove', this.boundDragHandler);
        document.addEventListener('mouseup', this.boundStopDragHandler);

        // Setup new resize handles
        const resizeHandles = this.shadowRoot.querySelectorAll('.resize-handle');
        resizeHandles.forEach(handle => {
            handle.addEventListener('mousedown', (e) => this.startResizing(e));
            handle.addEventListener('touchstart', (e) => this.startResizing(e), { passive: false });
        });
        
        document.addEventListener('mousemove', this.boundResizeHandler);
        document.addEventListener('mouseup', this.boundStopResizeHandler);

        header.addEventListener('touchstart', (e) => this.startDragging(e), { passive: false });
        document.addEventListener('touchmove', this.boundTouchDragHandler, { passive: false });
        document.addEventListener('touchend', this.boundTouchStopDragHandler);

        document.addEventListener('touchmove', this.boundTouchResizeHandler, { passive: false });
        document.addEventListener('touchend', this.boundTouchStopResizeHandler);
        
        // Grid snapping controls removed from UI; keep dragging/resizing freeform.
        this.gridSnapEnabled = false;

        if (modeButton) {
            modeButton.addEventListener('click', (e) => this.handleModeButtonClick(e));
            modeButton.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.handleModeButtonClick(e, { direction: -1 });
            });
        }
        if (dockButton) {
            dockButton.addEventListener('click', () => this.setDockedMode({ pausePlayback: false, allowPlayback: true }));
        }
        if (expandButton) expandButton.addEventListener('click', () => this.toggleExpand());
        if (fullscreenButton) fullscreenButton.addEventListener('click', () => this.toggleFullscreen());
        
        // Playback controls - mini/expanded mode
        const playPauseButton = this.shadowRoot.getElementById('play-pause-button');
        const prevButton = this.shadowRoot.getElementById('prev-button');
        const nextButton = this.shadowRoot.getElementById('next-button');
        if (playPauseButton) playPauseButton.addEventListener('click', () => this.togglePlayPause());
        if (prevButton) prevButton.addEventListener('click', () => this.previousTrack());
        if (nextButton) nextButton.addEventListener('click', () => this.nextTrack());
        
        // Volume controls - unified web component
        const volumeControl = this.shadowRoot.getElementById('volume-control');
        const dockVolumeControl = this.shadowRoot.getElementById('dock-volume-control');

        this._pendingVolume = parseInt(localStorage.getItem('myVolume') || '50', 10);
        this.boundExternalVolumeHandler = (e) => {
            const vol = e?.detail?.volume;
            if (vol === undefined || vol === null) return;
            const v = Math.max(0, Math.min(100, parseInt(vol, 10) || 0));
            this._pendingVolume = v;
            if (this.player && this.player.setVolume) {
                this.player.setVolume(v);
            }
        };

        if (volumeControl) {
            volumeControl.value = this._pendingVolume;
            volumeControl.addEventListener('xavi-volume-change', (e) => {
                const v = Math.max(0, Math.min(100, parseInt(e?.detail?.volume, 10) || 0));
                this._pendingVolume = v;
                if (this.player && this.player.setVolume) {
                    this.player.setVolume(v);
                }
            });
        }

        if (dockVolumeControl) {
            dockVolumeControl.value = this._pendingVolume;
            dockVolumeControl.addEventListener('xavi-volume-change', (e) => {
                const v = Math.max(0, Math.min(100, parseInt(e?.detail?.volume, 10) || 0));
                this._pendingVolume = v;
                if (this.player && this.player.setVolume) {
                    this.player.setVolume(v);
                }
            });
        }

        document.addEventListener('volume-changed', this.boundExternalVolumeHandler);
        
        // Dock tab controls
        if (dockTabHeader) dockTabHeader.addEventListener('click', (e) => {
            if (!e.target.closest('button')) this.restoreFromDock();
        });
        if (dockModeButton) dockModeButton.addEventListener('click', () => this.restoreFromDock('mini'));
        if (dockExpandButton) dockExpandButton.addEventListener('click', () => this.restoreFromDock('expanded'));
        // Playlist add buttons removed from video-player UI (still supports playlist progress updates).
        
        // Playback controls - dock mode
        const dockPlayPauseButton = this.shadowRoot.getElementById('dock-play-pause-button');
        const dockPrevButton = this.shadowRoot.getElementById('dock-prev-button');
        const dockNextButton = this.shadowRoot.getElementById('dock-next-button');
        if (dockPlayPauseButton) dockPlayPauseButton.addEventListener('click', () => this.togglePlayPause());
        if (dockPrevButton) dockPrevButton.addEventListener('click', () => this.previousTrack());
        if (dockNextButton) dockNextButton.addEventListener('click', () => this.nextTrack());
        
        // (Dock volume is handled by <xavi-volume-control> and shared events)

        if (videoContainer) {
            videoContainer.addEventListener('dblclick', () => {
                if (!this.isDocked) this.toggleExpand();
            });
        }
        if (header) {
            header.addEventListener('dblclick', () => {
                if (!this.isDocked) this.toggleExpand();
            });
        }

        window.addEventListener('storage', this.storageSyncHandler);
        document.addEventListener('fullscreenchange', this.boundFullscreenHandler);
        window.addEventListener('resize', this.boundWindowResizeHandler);
        window.addEventListener('xavi-sync:state-applied', this.boundAuthoritySyncHandler);
    document.addEventListener('playlist-time-update', this.boundPlaylistProgressHandler);

        const musicPlayer = document.querySelector('music-player');
        if (musicPlayer) {
            musicPlayer.addEventListener('video-changed', (e) => this.handleExternalVideoChange(e.detail));
            musicPlayer.addEventListener('player-ready', () => this.resumePlayback());
        }

        const miniWidth = this.getAttribute('mini-width');
        const miniHeight = this.getAttribute('mini-height');
        if (miniWidth) lightbox.style.setProperty('--mini-width', miniWidth);
        if (miniHeight) lightbox.style.setProperty('--mini-height', miniHeight);

        this.updateModeButtonState();
        this.updateExpandButtonState();
        this.initializeAuthoritySync();
    }

    disconnectedCallback() {
        document.removeEventListener('mousemove', this.boundDragHandler);
        document.removeEventListener('mouseup', this.boundStopDragHandler);
        document.removeEventListener('mousemove', this.boundResizeHandler);
        document.removeEventListener('mouseup', this.boundStopResizeHandler);
        document.removeEventListener('touchmove', this.boundTouchDragHandler);
        document.removeEventListener('touchend', this.boundTouchStopDragHandler);
        document.removeEventListener('touchmove', this.boundTouchResizeHandler);
        document.removeEventListener('touchend', this.boundTouchStopResizeHandler);
        window.removeEventListener('storage', this.storageSyncHandler);
        if (this.boundExternalVolumeHandler) {
            document.removeEventListener('volume-changed', this.boundExternalVolumeHandler);
        }
        document.removeEventListener('fullscreenchange', this.boundFullscreenHandler);
        window.removeEventListener('xavi-sync:state-applied', this.boundAuthoritySyncHandler);
        window.removeEventListener('xavi-workspace-ready', this.boundWorkspaceReadyHandler);
    document.removeEventListener('playlist-time-update', this.boundPlaylistProgressHandler);
        if (window.__videoPlayerElement === this) {
            window.__videoPlayerElement = null;
        }

        this.stopTimeTracking();
        if (this.player) this.player.destroy();
        this._ytPlayerCreated = false;
        if (this._ytHostElement && this.contains(this._ytHostElement)) {
            try {
                this._ytHostElement.remove();
            } catch (e) {
                /* ignore */
            }
        }
        this.releaseAuthority();
        this.updatePlayingIndicator(false);
    }

    ensureYouTubeHost() {
        if (this._ytHostElement && this._ytHostElement.isConnected) {
            return this._ytHostElement;
        }

        if (!this._ytHostElement) {
            const host = document.createElement('div');
            host.setAttribute('slot', 'yt-player-host');
            host.style.width = '100%';
            host.style.height = '100%';
            host.style.display = 'block';
            this._ytHostElement = host;
        }

        // Keep the host in the light DOM (not the shadow root) for better YouTube IFrame API behavior.
        if (!this.contains(this._ytHostElement)) {
            this.appendChild(this._ytHostElement);
        }

        return this._ytHostElement;
    }

    initializePlayer() {
        console.log('[VideoPlayer] initializePlayer called, YT available:', !!window.YT, 'YT.Player:', !!window.YT?.Player);
        if (this._ytPlayerCreated) {
            return;
        }

        const hostEl = this.ensureYouTubeHost();
        if (!hostEl) {
            console.warn('[VideoPlayer] Cannot initialize YouTube player: missing host element');
            return;
        }

        this.player = new YT.Player(hostEl, {
            height: '100%',
            width: '100%',
            videoId: '',
            playerVars: {
                autoplay: 0,
                controls: 0,
                modestbranding: 1,
                fs: 1,
                disablekb: 1,
                origin: window.location.origin,
                iv_load_policy: 3,
                rel: 0,
                enablejsapi: 1
            },
            events: {
                onReady: (event) => {
                    console.log('[VideoPlayer] YouTube player ready! Event:', event, 'Target:', event.target);
                    // The actual player with methods is on event.target, not this.player yet
                    const actualPlayer = event.target;
                    console.log('[VideoPlayer] Player methods check:', {
                        hasLoadVideoById: typeof actualPlayer.loadVideoById === 'function',
                        hasCueVideoById: typeof actualPlayer.cueVideoById === 'function',
                        hasPlayVideo: typeof actualPlayer.playVideo === 'function'
                    });
                    
                    // Update this.player reference to the actual working player
                    this.player = actualPlayer;
                    
                    console.log('[VideoPlayer] Dispatching player-initialized event with actual player');
                    this.dispatchEvent(new CustomEvent('player-initialized', { detail: { player: this.player } }));
                    
                    // Set saved volume
                    const savedVolume = parseInt(localStorage.getItem('myVolume') || '50', 10);
                    if (this.player && this.player.setVolume) {
                        this.player.setVolume(savedVolume);
                    }
                    this.resumePlayback();
                    this.startTimeTracking();
                    this.flushPendingVideoLoad();
                },
                onStateChange: (e) => {
                    const musicPlayer = document.querySelector('music-player');
                    if (musicPlayer) {
                        musicPlayer.dispatchEvent(new CustomEvent('player-state-changed', { detail: e }));
                    }
                    this.updateTimeDisplay();
                    this.handlePlaybackStateChange(e);
                },
                onError: (e) => {
                    // YouTube error codes:
                    // 2 = invalid parameter (bad video ID)
                    // 5 = HTML5 player error
                    // 100 = video not found / private
                    // 101/150 = video not available / login required / embed blocked
                    console.warn('[VideoPlayer] YouTube error:', e.data);
                    const musicPlayer = document.querySelector('music-player');
                    if (musicPlayer) {
                        musicPlayer.dispatchEvent(new CustomEvent('player-error', { detail: { errorCode: e.data } }));
                    }
                }
            }
        });

        this._ytPlayerCreated = true;
    }

    handleExternalVideoChange(detail = {}) {
        if (!detail || !detail.videoId) {
            return;
        }

        this.currentTrack = {
            videoId: detail.videoId,
            title: detail.title,
            channelTitle: detail.channelTitle,
            channelId: detail.channelId,
            duration: detail.duration
        };
        
        // Always dispatch track changed event for taskbar
        this.dispatchVideoTrackChanged();

        // Allow video to load and play while docked - don't force restore
        const applied = this.applyVideoChange(detail);
        if (!applied) {
            this.pendingVideoLoad = { ...detail };
        } else {
            this.pendingVideoLoad = null;
        }
    }

    applyVideoChange(detail = {}) {
        if (!detail.videoId || !this.player || typeof this.player.loadVideoById !== 'function') {
            return false;
        }

        const startTime = (typeof detail.startTime === 'number' && Number.isFinite(detail.startTime))
            ? detail.startTime
            : (parseFloat(detail.startTime) || 0);

        // Show the video player when loading a video
        this.classList.add('has-video'); // Add to host element
        const lightbox = this.shadowRoot.getElementById('lightbox');
        if (lightbox) {
            lightbox.classList.add('has-video'); // Also add to lightbox
        }

        try {
            if (detail.play) {
                this.player.loadVideoById(detail.videoId, startTime);
            } else if (typeof this.player.cueVideoById === 'function') {
                this.player.cueVideoById({ videoId: detail.videoId, startSeconds: startTime });
            } else {
                this.player.loadVideoById(detail.videoId, startTime);
                if (typeof this.player.pauseVideo === 'function') {
                    this.player.pauseVideo();
                }
            }
        } catch (error) {
            return false;
        }

        if (detail.play && typeof this.player.playVideo === 'function') {
            try {
                const maybePromise = this.player.playVideo();
                if (maybePromise && typeof maybePromise.then === 'function') {
                    maybePromise.catch(() => {});
                }
            } catch (error) {
                // Ignore autoplay restrictions.
            }
        } else if (!detail.play && typeof this.player.pauseVideo === 'function') {
            this.player.pauseVideo();
        }

        return true;
    }

    flushPendingVideoLoad() {
        if (!this.pendingVideoLoad) {
            return;
        }

        // Allow video to play while docked - don't force restore
        const snapshot = { ...this.pendingVideoLoad };

        if (this.applyVideoChange(snapshot)) {
            this.pendingVideoLoad = null;
        } else {
            this.pendingVideoLoad = snapshot;
        }
    }

    handlePlaybackStateChange(event) {
        const state = event?.data;
        const isPlaying = typeof YT !== 'undefined' && state === YT.PlayerState.PLAYING;
        this.isCurrentlyPlaying = isPlaying;
        this.updatePlayingIndicator(isPlaying);
        
        // Always dispatch playback state for taskbar
        this.dispatchVideoPlaybackState();
    }

    handlePlaylistProgress(detail) {
        if (!detail) {
            return;
        }

        if (detail.videoId) {
            if (!this.currentTrack) {
                this.currentTrack = { videoId: detail.videoId };
            } else if (this.currentTrack.videoId !== detail.videoId) {
                this.currentTrack = { ...this.currentTrack, videoId: detail.videoId };
            }
        }

        if (this.currentTrack && detail.duration && (!Number.isFinite(this.currentTrack.duration) || this.currentTrack.duration <= 0)) {
            this.currentTrack.duration = detail.duration;
        }

        const durationFromDetail = Number.isFinite(detail.duration) && detail.duration > 0
            ? detail.duration
            : (this.currentTrack && Number.isFinite(this.currentTrack.duration) && this.currentTrack.duration > 0
                ? this.currentTrack.duration
                : 0);

        const safeTime = Number.isFinite(detail.currentTime) && detail.currentTime >= 0 ? detail.currentTime : 0;
        const timeString = `${this.formatTime(safeTime)} / ${this.formatTime(durationFromDetail)}`;

        const timeDisplay = this.shadowRoot?.getElementById('time-display');
        const dockTimeDisplay = this.shadowRoot?.getElementById('dock-time-display');

        if (timeDisplay) {
            timeDisplay.textContent = timeString;
        }
        if (dockTimeDisplay) {
            dockTimeDisplay.textContent = timeString;
        }
    }

    updatePlayingIndicator(isPlaying) {
        const root = typeof this.getRootNode === 'function' ? this.getRootNode() : null;
        if (root && typeof root.querySelectorAll === 'function' && isPlaying) {
            root.querySelectorAll('.tab-panel.panel-playing').forEach((panel) => {
                if (panel !== this.closest('.tab-panel')) {
                    panel.classList.remove('panel-playing');
                }
            });
        }

        const panel = typeof this.closest === 'function' ? this.closest('.tab-panel') : null;
        if (!panel) {
            return;
        }

        if (isPlaying) {
            panel.classList.add('panel-playing');
        } else {
            panel.classList.remove('panel-playing');
        }
    }

    notifyDocked() {
        const musicPlayer = document.querySelector('music-player');
        if (musicPlayer && typeof musicPlayer.pause === 'function') {
            musicPlayer.pause(true);
            if (typeof musicPlayer.suppressAutoResume === 'function') {
                musicPlayer.suppressAutoResume(1500);
            }
        } else {
            const stateSync = window.stateSync;
            if (stateSync && typeof stateSync.set === 'function') {
                stateSync.set('myIsPlaying', '0');
            } else {
                try {
                    localStorage.setItem('myIsPlaying', '0');
                } catch (error) {
                    /* ignore */
                }
            }
        }

        if (window.musicChannel && typeof window.musicChannel.postMessage === 'function') {
            window.musicChannel.postMessage({
                action: 'force_pause',
                tabId: window.myTabId || null,
                reason: 'dock'
            });
        }

        if (typeof window.relinquishMusicPlaybackOwnership === 'function') {
            window.relinquishMusicPlaybackOwnership();
        }

        this.updatePlayingIndicator(false);
    }

    resumePlayback() {
        const storedVid = localStorage.getItem('myCurrentVideoID');
        const storedTime = parseFloat(localStorage.getItem('myCurrentTime') || '0');
        const storedPlaying = localStorage.getItem('myIsPlaying') === '1';
        const lastPlayTs = parseInt(localStorage.getItem('myLastPlayTimestamp') || '0', 10);
        const now = Date.now();
        const timeSinceLastPlay = now - lastPlayTs;

        if (!storedVid || timeSinceLastPlay > 600000) {
            return;
        }

        if (!this.player || typeof this.player.loadVideoById !== 'function') {
            this.pendingVideoLoad = {
                videoId: storedVid,
                startTime: storedTime,
                play: storedPlaying
            };
            return;
        }

        try {
            if (storedPlaying) {
                this.player.loadVideoById(storedVid, storedTime);
            } else if (typeof this.player.cueVideoById === 'function') {
                this.player.cueVideoById({ videoId: storedVid, startSeconds: storedTime });
            } else {
                this.player.loadVideoById(storedVid, storedTime);
                if (typeof this.player.pauseVideo === 'function') {
                    this.player.pauseVideo();
                }
            }

            if (storedPlaying && typeof this.player.playVideo === 'function') {
                const playPromise = this.player.playVideo();
                if (playPromise && typeof playPromise.then === 'function') {
                    playPromise.catch(() => {});
                }
            } else if (!storedPlaying && typeof this.player.pauseVideo === 'function') {
                this.player.pauseVideo();
            }
        } catch (error) {
            this.pendingVideoLoad = {
                videoId: storedVid,
                startTime: storedTime,
                play: storedPlaying
            };
        }
    }

    toggleExpand() {
        if (this.isDocked) {
            this.restoreFromDock('expanded');
            return;
        }

        // If we're in grid-layer mode, treat expand as returning to mini.
        if (this.gridMode === 'layer') {
            this.restoreFromDock('mini', { forceAuthority: true, forceOpenOwner: true });
            return;
        }

        // Route through restoreFromDock even when not docked.
        // This path handles open-owner checks and can force a stale authority reset,
        // preventing "Expand" from silently doing nothing due to old authority tokens.
        const desired = this.isExpanded ? 'mini' : 'expanded';
        this.restoreFromDock(desired, { forceAuthority: true, forceOpenOwner: true });
    }

    getCurrentMode() {
        return this.getSurfaceMode();
    }

    getSurfaceMode() {
        if (this.isDocked || this.isTaskbarDocked) {
            return 'docked';
        }
        if (this.gridMode === 'layer') {
            return 'grid-layer';
        }
        return this.isExpanded ? 'expanded' : 'mini';
    }

    getAdjacentMode(currentMode, direction = 1) {
        const modes = ['docked', 'mini', 'expanded'];
        const idx = Math.max(0, modes.indexOf(currentMode));
        const step = direction < 0 ? -1 : 1;
        const next = (idx + step + modes.length) % modes.length;
        return modes[next];
    }

    switchToMode(mode) {
        if (mode === 'docked') {
            this.setDockedMode({ pausePlayback: false, allowPlayback: true });
            return true;
        }

        if (mode === 'expanded') {
            this.restoreFromDock('expanded', { forceAuthority: true, forceOpenOwner: true });
            return true;
        }

        // mini
        this.restoreFromDock('mini', { forceAuthority: true, forceOpenOwner: true });
        return true;
    }

    handleModeButtonClick(event, options = {}) {
        // Primary UX:
        // - docked: open to mini
        // - mini: expand
        // - expanded: go back to mini
        if (this.isDocked || this.isTaskbarDocked) {
            this.restoreFromDock('mini', { forceAuthority: true, forceOpenOwner: true });
            return;
        }
        if (this.isExpanded) {
            this.restoreFromDock('mini', { forceAuthority: true, forceOpenOwner: true });
            return;
        }
        this.restoreFromDock('expanded', { forceAuthority: true, forceOpenOwner: true });
    }

    getTaskbarElement() {
        const panelTaskbar = document.querySelector('panel-taskbar');
        if (panelTaskbar?.shadowRoot) {
            const embedded = panelTaskbar.shadowRoot.querySelector('.taskbar');
            if (embedded) {
                return embedded;
            }
        }
        return document.querySelector('.taskbar');
    }

    getTaskbarClearance(fallback = 24) {
        const taskbarEl = this.getTaskbarElement();
        if (!taskbarEl) {
            return fallback;
        }
        const rect = taskbarEl.getBoundingClientRect?.();
        const height = Math.ceil(rect?.height || taskbarEl.offsetHeight || 0);
        if (!height) {
            return fallback;
        }
        const buffer = 24;
        return Math.max(fallback, height + buffer);
    }

    positionMiniPlayer(lightbox = this.shadowRoot?.getElementById('lightbox')) {
        if (!lightbox) {
            return;
        }
        const clearance = this.getTaskbarClearance(24);
        // Clear any previously persisted shorthand positioning.
        lightbox.style.inset = '';
        lightbox.style.left = '';
        lightbox.style.top = '';
        if (window.innerWidth <= 420) {
            lightbox.style.left = '6px';
            lightbox.style.right = '6px';
        } else {
            lightbox.style.right = '24px';
        }
        lightbox.style.bottom = `${clearance}px`;
    }

    positionDockTab(target = this.shadowRoot?.getElementById('dock-tab')) {
        if (!target || target.classList.contains('hidden')) {
            return;
        }
        const taskbarEl = this.getTaskbarElement();
        const taskbarRect = taskbarEl?.getBoundingClientRect?.();
        if (taskbarRect) {
            // Add taskbar height plus gap to position above it
            const taskbarHeight = taskbarRect.height || 50;
            const gapAboveTaskbar = 8;
            const viewportBottomGap = Math.max(0, window.innerHeight - taskbarRect.bottom);
            const horizontalGap = Math.max(0, window.innerWidth - taskbarRect.right);
            const bottomPosition = viewportBottomGap + taskbarHeight + gapAboveTaskbar;
            target.style.bottom = `${Math.round(bottomPosition)}px`;
            target.style.right = `${Math.round(horizontalGap)}px`;
            target.style.left = 'auto';
            return;
        }

        // Fallback positioning - position above where taskbar would be (66px = 50px taskbar + 16px margins)
        target.style.right = '8px';
        target.style.left = 'auto';
        target.style.bottom = '66px';
    }

    setMiniMode(skipSave = false, skipAuthority = false) {
        if (!skipAuthority && !this.ensureAuthority('mini')) {
            return false;
        }

        this.gridMode = 'none';

        // Leaving grid-layer mode: restore default host positioning.
        this.style.removeProperty('position');
        this.style.removeProperty('inset');

        this.allowDockedPlayback = false;
        const lightbox = this.shadowRoot.getElementById('lightbox');
        this.ensureAttachedToFloatingLayer();
        const dockTab = this.shadowRoot.getElementById('dock-tab');
        if (dockTab) dockTab.classList.add('hidden');
        lightbox.classList.remove('expanded', 'docked', 'grid-full', 'grid-layer');
        lightbox.classList.add('mini');
        // Mini mode always uses fixed size - remove any custom dimensions
        lightbox.style.width = '';
        lightbox.style.height = '';
        lightbox.style.inset = '';
        lightbox.style.transform = 'none';
        lightbox.style.display = 'block';
        lightbox.style.pointerEvents = 'auto';
        lightbox.style.cursor = '';

        // Mini mode is interactive.
        try {
            const iframe = this.player?.getIframe?.();
            if (iframe && iframe.style) iframe.style.pointerEvents = 'auto';
        } catch (error) {
            /* ignore iframe style errors */
        }
        this.style.zIndex = this.defaultZIndex;
        this.positionMiniPlayer(lightbox);
        this.isExpanded = false;
        this.isDocked = false;
        this.isTaskbarDocked = false;
        
        this.lastActiveMode = 'mini';
        this.updateModeButtonState();
        this.updateExpandButtonState();
        if (!skipSave) this.saveState();
        return true;
    }

    setExpandedMode(skipSave = false, skipAuthority = false) {
        if (!skipAuthority && !this.ensureAuthority('expanded')) {
            return false;
        }

        this.gridMode = 'none';

        // Leaving grid-layer mode: restore default host positioning.
        this.style.removeProperty('position');
        this.style.removeProperty('inset');

        this.allowDockedPlayback = false;
        const lightbox = this.shadowRoot.getElementById('lightbox');
        this.ensureAttachedToFloatingLayer();
        const workspaceRect = this.getWorkspaceRect();
        const originLeft = workspaceRect?.left || 0;
        const originTop = workspaceRect?.top || 0;
        const workspaceWidth = Math.max(0, workspaceRect?.width || window.innerWidth || 0);
        const workspaceHeight = Math.max(0, workspaceRect?.height || window.innerHeight || 0);
        const isNarrow = (workspaceWidth || window.innerWidth || 0) <= 420;
        const dockTab = this.shadowRoot.getElementById('dock-tab');
        if (dockTab) dockTab.classList.add('hidden');
        lightbox.classList.remove('mini', 'docked', 'grid-full', 'grid-layer');
        lightbox.classList.add('expanded');
        lightbox.style.display = 'block';
        lightbox.style.pointerEvents = 'auto';
        lightbox.style.cursor = '';

        // Expanded mode is interactive.
        try {
            const iframe = this.player?.getIframe?.();
            if (iframe && iframe.style) iframe.style.pointerEvents = 'auto';
        } catch (error) {
            /* ignore iframe style errors */
        }

        if (isNarrow) {
            const margin = 6;
            const availableWidth = Math.max(0, workspaceWidth - (margin * 2));
            const availableHeight = Math.max(0, workspaceHeight - (margin * 2));
            const aspect = 16 / 9;
            const headerEl = this.shadowRoot.getElementById('header');
            const headerHeight = Math.max(44, Math.ceil(headerEl?.getBoundingClientRect?.().height || headerEl?.offsetHeight || 56));

            // Mobile: use 100% of workspace width (minus margins) and keep 16:9.
            let targetWidth = Math.max(240, availableWidth || 0);
            let videoHeight = Math.round(targetWidth / aspect);
            let desiredHeight = headerHeight + videoHeight;
            if (availableHeight > 0 && desiredHeight > availableHeight) {
                const maxVideoHeight = Math.max(120, availableHeight - headerHeight);
                targetWidth = Math.max(240, Math.floor(maxVideoHeight * aspect));
                videoHeight = Math.round(targetWidth / aspect);
                desiredHeight = headerHeight + videoHeight;
            }

            const bottomMargin = margin;
            const desiredTop = Math.max(margin, (workspaceHeight - desiredHeight - bottomMargin));

            lightbox.style.left = `${originLeft + margin}px`;
            lightbox.style.top = `${originTop + desiredTop}px`;
            lightbox.style.right = 'auto';
            lightbox.style.bottom = 'auto';
            lightbox.style.width = `${targetWidth}px`;
            lightbox.style.height = `${Math.max(headerHeight + 120, desiredHeight)}px`;
            lightbox.style.transform = 'none';
        } else if (this._expandedState && this._expandedState.userAdjusted) {
            const savedTop = Number.parseFloat(this._expandedState.top);
            const savedLeft = Number.parseFloat(this._expandedState.left);
            const savedRight = Number.parseFloat(this._expandedState.right);
            const savedWidth = Number.parseFloat(this._expandedState.width) || 720;
            const savedHeight = Number.parseFloat(this._expandedState.height) || 480;

            const maxTop = Math.max(0, workspaceHeight - savedHeight);
            const maxLeft = Math.max(0, workspaceWidth - savedWidth);

            lightbox.style.width = `${Math.min(workspaceWidth || savedWidth, savedWidth)}px`;
            lightbox.style.height = `${Math.min(workspaceHeight || savedHeight, savedHeight)}px`;
            lightbox.style.transform = 'none';
            lightbox.style.bottom = 'auto';

            const resolvedTop = Number.isFinite(savedTop) ? Math.max(0, Math.min(savedTop, maxTop)) : Math.min(40, maxTop);
            lightbox.style.top = `${originTop + resolvedTop}px`;

            let resolvedLeft = null;
            if (Number.isFinite(savedLeft)) {
                resolvedLeft = Math.max(0, Math.min(savedLeft, maxLeft));
            } else if (Number.isFinite(savedRight)) {
                resolvedLeft = Math.max(0, Math.min((workspaceWidth - savedWidth) - Math.max(0, savedRight), maxLeft));
            } else {
                resolvedLeft = Math.max(0, Math.min((workspaceWidth - savedWidth) - 24, maxLeft));
            }

            lightbox.style.left = `${originLeft + resolvedLeft}px`;
            lightbox.style.right = 'auto';
        } else {
            // Default expanded size/position:
            // - Mobile handled above.
            // - Desktop: width ~= 1/3 workspace, bottom-right, 16:9.
            const aspect = 16 / 9;
            const headerEl = this.shadowRoot.getElementById('header');
            const headerHeight = Math.max(44, Math.ceil(headerEl?.getBoundingClientRect?.().height || headerEl?.offsetHeight || 56));

            const maxWidth = Math.max(260, (workspaceWidth || 0) - 48);
            const preferredWidth = Math.round((workspaceWidth || window.innerWidth || 1200) / 3);
            const resolvedWidth = Math.max(260, Math.min(maxWidth, preferredWidth));
            const videoHeight = Math.round(resolvedWidth / aspect);
            const resolvedHeight = Math.min(
                Math.max(headerHeight + 120, headerHeight + videoHeight),
                Math.max(headerHeight + 120, (workspaceHeight || window.innerHeight || 800) - 24)
            );

            const margin = 24;
            const maxLeft = Math.max(0, workspaceWidth - resolvedWidth);
            const maxTop = Math.max(0, workspaceHeight - resolvedHeight);
            const baseLeft = Math.max(0, Math.min(workspaceWidth - resolvedWidth - margin, maxLeft));
            const baseTop = Math.max(8, Math.min(workspaceHeight - resolvedHeight - margin, maxTop));

            lightbox.style.left = `${originLeft + baseLeft}px`;
            lightbox.style.top = `${originTop + baseTop}px`;
            lightbox.style.right = 'auto';
            lightbox.style.bottom = 'auto';
            lightbox.style.width = `${resolvedWidth}px`;
            lightbox.style.height = `${resolvedHeight}px`;
            lightbox.style.transform = 'none';

            this._expandedState = {
                ...(this._expandedState || {}),
                left: `${baseLeft}px`,
                top: `${baseTop}px`,
                right: '',
                width: `${resolvedWidth}px`,
                height: `${resolvedHeight}px`,
                userAdjusted: false
            };
        }

        // Final safety clamp: keep expanded player fully inside the workspace rect.
        try {
            const wsRectFinal = this.getWorkspaceRect();
            const lbRectFinal = lightbox.getBoundingClientRect();
            if (wsRectFinal && lbRectFinal) {
            let topPx = Number.parseFloat(lightbox.style.top);
            let leftPx = Number.parseFloat(lightbox.style.left);
            if (!Number.isFinite(topPx)) topPx = lbRectFinal.top;
            if (!Number.isFinite(leftPx)) leftPx = lbRectFinal.left;

                const overflowBottom = lbRectFinal.bottom - wsRectFinal.bottom;
                const overflowRight = lbRectFinal.right - wsRectFinal.right;
                const overflowTop = wsRectFinal.top - lbRectFinal.top;
                const overflowLeft = wsRectFinal.left - lbRectFinal.left;

                if (overflowBottom > 0) topPx -= overflowBottom;
                if (overflowRight > 0) leftPx -= overflowRight;
                if (overflowTop > 0) topPx += overflowTop;
                if (overflowLeft > 0) leftPx += overflowLeft;

                lightbox.style.top = `${Math.max(wsRectFinal.top, topPx)}px`;
                lightbox.style.left = `${Math.max(wsRectFinal.left, leftPx)}px`;
                lightbox.style.right = 'auto';
                lightbox.style.bottom = 'auto';
            }
        } catch (e) {
            // ignore clamp failures
        }

        this.style.zIndex = this.expandedZIndex;

            this.isExpanded = true;
            this.isDocked = false;
            this.isTaskbarDocked = false;
        this.lastActiveMode = 'expanded';
            this.updateModeButtonState();
        this.updateExpandButtonState();
        if (!skipSave) this.saveState();
        return true;
    }

    setExpandedDefaultFallback(lightbox, width, height) {
        const workspaceRect = this.getWorkspaceRect();
        const originLeft = workspaceRect?.left || 0;
        const originTop = workspaceRect?.top || 0;
        const workspaceWidth = Math.max(0, workspaceRect?.width || window.innerWidth || width);
        const workspaceHeight = Math.max(0, workspaceRect?.height || window.innerHeight || height);
        const marginRight = 24;
        const marginTop = 8;
        const maxTop = Math.max(0, workspaceHeight - height);
        const clampedTop = Math.max(marginTop, Math.min(40, maxTop));
        const clampedLeft = Math.max(0, workspaceWidth - width - marginRight);

        lightbox.style.top = `${originTop + clampedTop}px`;
        lightbox.style.right = 'auto';
        lightbox.style.left = `${originLeft + clampedLeft}px`;
        lightbox.style.bottom = 'auto';
        lightbox.style.width = `${width}px`;
        lightbox.style.height = `${height}px`;
        lightbox.style.transform = 'none';
    }

    startDragging(e) {
        if (this.isDocked || !this.isExpanded) return;
        
        // Don't start dragging if clicking on interactive elements
        const interactive = e.target?.closest?.('button, .control-button, xavi-volume-control, input, select, textarea, a, label, .resize-handle, .volume-control-wrapper');
        if (interactive) {
            this.isDragging = false;
            return;
        }
        
        const lightbox = this.shadowRoot.getElementById('lightbox');
        e.preventDefault();
        this.isDragging = true;
        const rect = lightbox.getBoundingClientRect();
        this.startX = (e.clientX || e.touches?.[0].clientX) - rect.left;
        this.startY = (e.clientY || e.touches?.[0].clientY) - rect.top;
        this.shadowRoot.getElementById('header').classList.add('dragging');
    }

    drag(e) {
        if (!this.isDragging) return;
        e.preventDefault();
        const lightbox = this.shadowRoot.getElementById('lightbox');
        const clientX = e.clientX || e.touches?.[0].clientX;
        const clientY = e.clientY || e.touches?.[0].clientY;
        const workspaceRect = this.getWorkspaceRect();
        const originLeft = workspaceRect?.left || 0;
        const originTop = workspaceRect?.top || 0;
        const workspaceWidth = Math.max(0, workspaceRect?.width || window.innerWidth || 0);
        const workspaceHeight = Math.max(0, workspaceRect?.height || window.innerHeight || 0);
        const minLeft = 0;
        const minTop = 0;
        const maxLeft = Math.max(minLeft, workspaceWidth - lightbox.offsetWidth);
        const maxTop = Math.max(minTop, workspaceHeight - lightbox.offsetHeight);
        let newLeft = (clientX - originLeft) - this.startX;
        let newTop = (clientY - originTop) - this.startY;

        newLeft = Math.max(minLeft, Math.min(newLeft, maxLeft));
        newTop = Math.max(minTop, Math.min(newTop, maxTop));

        lightbox.style.left = `${originLeft + newLeft}px`;
        lightbox.style.top = `${originTop + newTop}px`;
        lightbox.style.right = 'auto';
        lightbox.style.bottom = 'auto';
        lightbox.style.transform = 'none';

        if (this.isExpanded) {
            this._expandedState = {
                ...(this._expandedState || {}),
                left: `${newLeft}px`,
                top: `${newTop}px`,
                right: '',
                width: lightbox.style.width || `${lightbox.offsetWidth}px`,
                height: lightbox.style.height || `${lightbox.offsetHeight}px`,
                userAdjusted: true
            };
        } else {
            this._miniState = {
                ...(this._miniState || {}),
                left: newLeft,
                top: newTop,
                width: lightbox.style.width,
                height: lightbox.style.height
            };
        }
    }

    stopDragging() {
        if (this.isDragging) {
            this.saveState();
        }
        this.isDragging = false;
        this.shadowRoot.getElementById('header').classList.remove('dragging');
    }

    startResizing(e) {
        // Only allow resizing in expanded mode
        if (this.isDocked || !this.isExpanded) return;
        e.preventDefault();
        e.stopPropagation();
        
        this.isResizing = true;
        this.resizeDirection = e.target?.dataset?.direction || 'se';

        const lightbox = this.shadowRoot.getElementById('lightbox');
        if (!lightbox) return;
        const rect = lightbox.getBoundingClientRect();
        this.resizeWorkspaceRect = this.getWorkspaceRect();
        const originLeft = this.resizeWorkspaceRect?.left || 0;
        const originTop = this.resizeWorkspaceRect?.top || 0;

        this.startX = e.clientX || e.touches?.[0]?.clientX;
        this.startY = e.clientY || e.touches?.[0]?.clientY;
        this.startWidth = rect.width;
        this.startHeight = rect.height;
        this.startLeft = rect.left - originLeft;
        this.startTop = rect.top - originTop;
        this.startWorkspaceWidth = Math.max(0, this.resizeWorkspaceRect?.width || window.innerWidth || 0);
        this.startWorkspaceHeight = Math.max(0, this.resizeWorkspaceRect?.height || window.innerHeight || 0);

        this.createResizeOverlay(this.getCursorForDirection(this.resizeDirection));
        
        // Capture pointer on the handle
        if (e.target && e.target.setPointerCapture && e.pointerId != null) {
            e.target.setPointerCapture(e.pointerId);
        }
    }

    resize(e) {
        if (!this.isResizing) return;
        e.preventDefault();
        
        const lightbox = this.shadowRoot.getElementById('lightbox');
        if (!lightbox) return;
        
        const clientX = e.clientX || e.touches?.[0]?.clientX;
        const clientY = e.clientY || e.touches?.[0]?.clientY;
        
        const deltaX = clientX - this.startX;
        const deltaY = clientY - this.startY;
        
        let newWidth = this.startWidth;
        let newHeight = this.startHeight;
        let newLeft = this.startLeft;
        let newTop = this.startTop;
        
        const dir = this.resizeDirection;
        const workspaceRect = this.resizeWorkspaceRect || this.getWorkspaceRect();
        const originLeft = workspaceRect?.left || 0;
        const originTop = workspaceRect?.top || 0;
        const workspaceWidth = Math.max(0, this.startWorkspaceWidth || workspaceRect?.width || window.innerWidth || 0);
        const workspaceHeight = Math.max(0, this.startWorkspaceHeight || workspaceRect?.height || window.innerHeight || 0);
        
        // Calculate new dimensions based on direction
        if (dir.includes('e')) {
            newWidth = this.startWidth + deltaX;
        }
        if (dir.includes('w')) {
            newWidth = this.startWidth - deltaX;
            newLeft = this.startLeft + deltaX;
        }
        if (dir.includes('s')) {
            newHeight = this.startHeight + deltaY;
        }
        if (dir.includes('n')) {
            newHeight = this.startHeight - deltaY;
            newTop = this.startTop + deltaY;
        }
        
        // Apply constraints
        const minWidth = 300;
        const minHeight = 200;
        const maxWidth = Math.max(minWidth, workspaceWidth - 20);
        const maxHeight = Math.max(minHeight, workspaceHeight - 20);
        
        newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));
        newHeight = Math.max(minHeight, Math.min(newHeight, maxHeight));
        
        // Keep position within bounds when resizing from left/top
        if (dir.includes('w')) {
            const minLeft = 0;
            const maxLeft = Math.max(0, workspaceWidth - minWidth);
            newLeft = Math.max(minLeft, Math.min(newLeft, Math.max(minLeft, maxLeft)));
            // Adjust width if position was clamped
            newWidth = this.startLeft + this.startWidth - newLeft;
        }
        if (dir.includes('n')) {
            const minTop = 0;
            const maxTop = Math.max(0, workspaceHeight - minHeight);
            newTop = Math.max(minTop, Math.min(newTop, Math.max(minTop, maxTop)));
            // Adjust height if position was clamped
            newHeight = this.startTop + this.startHeight - newTop;
        }
        
        // Apply grid snapping if enabled
        if (this.gridSnapEnabled && this.gridSize > 0) {
            // Snap dimensions to grid
            newWidth = Math.round(newWidth / this.gridSize) * this.gridSize;
            newHeight = Math.round(newHeight / this.gridSize) * this.gridSize;
            // Snap position relative to grid origin
            newLeft = Math.round(newLeft / this.gridSize) * this.gridSize;
            newTop = Math.round(newTop / this.gridSize) * this.gridSize;
            const snapMaxLeft = Math.max(0, workspaceWidth - newWidth);
            const snapMaxTop = Math.max(0, workspaceHeight - newHeight);
            newLeft = Math.max(0, Math.min(newLeft, snapMaxLeft));
            newTop = Math.max(0, Math.min(newTop, snapMaxTop));
        }
        
        // Apply new dimensions
        lightbox.style.width = `${newWidth}px`;
        lightbox.style.height = `${newHeight}px`;
        lightbox.style.left = `${originLeft + newLeft}px`;
        lightbox.style.top = `${originTop + newTop}px`;
        lightbox.style.right = 'auto';
        lightbox.style.bottom = 'auto';
        lightbox.style.transform = 'none';
    }

    stopResizing() {
        this.removeResizeOverlay();
        if (this.isResizing) {
            this.saveState();
        }
        this.isResizing = false;
        this.resizeDirection = null;
        this.resizeWorkspaceRect = null;
        this.startWorkspaceWidth = null;
        this.startWorkspaceHeight = null;
    }

    getCursorForDirection(direction) {
        const dir = (direction || 'se').toLowerCase();
        if (dir === 'n' || dir === 's') return 'ns-resize';
        if (dir === 'e' || dir === 'w') return 'ew-resize';
        if (dir === 'ne' || dir === 'sw') return 'nesw-resize';
        if (dir === 'nw' || dir === 'se') return 'nwse-resize';
        if (dir.includes('n') && dir.includes('e')) return 'nesw-resize';
        if (dir.includes('n') && dir.includes('w')) return 'nwse-resize';
        if (dir.includes('s') && dir.includes('e')) return 'nwse-resize';
        if (dir.includes('s') && dir.includes('w')) return 'nesw-resize';
        return 'nwse-resize';
    }

    createResizeOverlay(cursor = 'nwse-resize') {
        if (!document.body) return;
        if (this.resizeOverlay) {
            this.resizeOverlay.style.cursor = cursor;
            return;
        }
        const overlay = document.createElement('div');
        overlay.className = 'video-player-resize-overlay';
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.zIndex = '10001';
        overlay.style.cursor = cursor;
        overlay.style.background = 'transparent';
        overlay.style.pointerEvents = 'all';
        overlay.style.touchAction = 'none';
        document.body.appendChild(overlay);
        this.resizeOverlay = overlay;
    }

    removeResizeOverlay() {
        if (!this.resizeOverlay) return;
        this.resizeOverlay.remove();
        this.resizeOverlay = null;
    }

    snapToGrid(value) {
        if (typeof value !== 'number' || !Number.isFinite(value) || this.gridSize <= 0) {
            return value;
        }
        return Math.round(value / this.gridSize) * this.gridSize;
    }

    getGridOrigin() {
        return {
            left: 0,
            top: 0
        };
    }

    getWorkspaceRect() {
        const floatingLayer = this.getFloatingLayerElement();
        if (floatingLayer) {
            return floatingLayer.getBoundingClientRect();
        }

        const contentArea = this.getContentAreaElement();
        if (contentArea) {
            return contentArea.getBoundingClientRect();
        }
        const width = window.innerWidth || 0;
        const height = window.innerHeight || 0;
        return {
            left: 0,
            top: 0,
            width,
            height,
            right: width,
            bottom: height
        };
    }

    getContentAreaElement() {
        if (this._contentAreaEl) {
            if (this._contentAreaEl.isConnected) {
                return this._contentAreaEl;
            }
            this._contentAreaEl = null;
        }

        const workspace = document.querySelector('xavi-multi-grid');
        if (workspace) {
            if (typeof workspace.getContentArea === 'function') {
                const area = workspace.getContentArea();
                if (area) {
                    this._contentAreaEl = area;
                    return area;
                }
            }
            if (workspace.shadowRoot) {
                const area = workspace.shadowRoot.getElementById('content-area');
                if (area) {
                    this._contentAreaEl = area;
                    return area;
                }
            }
        }

        const taskbar = document.querySelector('panel-taskbar');
        if (taskbar) {
            if (taskbar.workspace && typeof taskbar.workspace.getContentArea === 'function') {
                const area = taskbar.workspace.getContentArea();
                if (area) {
                    this._contentAreaEl = area;
                    return area;
                }
            }
            if (taskbar.shadowRoot) {
                const area = taskbar.shadowRoot.getElementById('content-area');
                if (area) {
                    this._contentAreaEl = area;
                    return area;
                }
            }
        }

        const fallback = document.getElementById('xavi-grid-container');
        if (fallback) {
            this._contentAreaEl = fallback;
            return fallback;
        }
        return null;
    }

    getWorkspaceElement() {
        if (this._workspaceEl && this._workspaceEl.isConnected) {
            return this._workspaceEl;
        }
        const workspace = document.querySelector('xavi-multi-grid');
        if (workspace) {
            this._workspaceEl = workspace;
            return workspace;
        }
        return null;
    }

    getFloatingLayerElement() {
        if (this._floatingLayerEl && this._floatingLayerEl.isConnected) {
            return this._floatingLayerEl;
        }

        const workspace = this.getWorkspaceElement();
        if (workspace) {
            if (typeof workspace.getFloatingLayer === 'function') {
                const layer = workspace.getFloatingLayer();
                if (layer) {
                    this._floatingLayerEl = layer;
                    return layer;
                }
            }
            if (workspace.shadowRoot) {
                const layer = workspace.shadowRoot.getElementById('floating-panel-layer');
                if (layer) {
                    this._floatingLayerEl = layer;
                    return layer;
                }
            }
        }

        const fallback = document.getElementById('floating-panel-layer');
        if (fallback) {
            this._floatingLayerEl = fallback;
            return fallback;
        }
        return null;
    }

    scheduleFloatingLayerAttach(attempt = 0) {
        if (this.gridMode === 'layer') {
            return;
        }
        if (this.ensureAttachedToFloatingLayer()) {
            return;
        }
        if (attempt >= 10) {
            return;
        }
        window.requestAnimationFrame(() => this.scheduleFloatingLayerAttach(attempt + 1));
    }

    ensureAttachedToFloatingLayer() {
        const layer = this.getFloatingLayerElement();
        if (!layer) {
            return false;
        }
        if (this.parentElement === layer) {
            return true;
        }

        const workspace = this.getWorkspaceElement();
        if (workspace && typeof workspace.attachFloatingPanel === 'function') {
            workspace.attachFloatingPanel(this);
        } else {
            layer.appendChild(this);
        }
        return true;
    }

    getBackgroundLayerElement() {
        if (this._bgLayerEl && this._bgLayerEl.isConnected) {
            return this._bgLayerEl;
        }

        const workspace = this.getWorkspaceElement();
        const bg = workspace?.shadowRoot?.querySelector?.('.xavi-bg-layer') || null;
        if (bg) {
            this._bgLayerEl = bg;
            return bg;
        }
        return null;
    }

    ensureAttachedToBackgroundLayer() {
        const bg = this.getBackgroundLayerElement();
        if (!bg) {
            return false;
        }
        if (this.parentElement === bg) {
            return true;
        }
        bg.appendChild(this);
        return true;
    }

    toggleFullscreen() {
        if (!this.player) return;
        const iframe = this.player.getIframe?.();
        if (!document.fullscreenElement) {
            if (iframe?.requestFullscreen) {
                iframe.requestFullscreen().catch(() => {});
            } else {
                this.shadowRoot.getElementById('video-player').requestFullscreen?.();
            }
        } else {
            document.exitFullscreen?.();
        }
    }

    handleFullscreenChange() {
        const fullscreenButton = this.shadowRoot.getElementById('fullscreen-button');
        this.isFullscreen = Boolean(document.fullscreenElement);
        if (this.isFullscreen) {
            fullscreenButton.textContent = '🡑';
            fullscreenButton.setAttribute('aria-label', 'Exit fullscreen');
            fullscreenButton.setAttribute('title', 'Exit fullscreen');
        } else {
            fullscreenButton.textContent = '⛶';
            fullscreenButton.setAttribute('aria-label', 'Toggle fullscreen');
            fullscreenButton.setAttribute('title', 'Toggle fullscreen');
        }
    }

    toggleMenu() {
        const menu = this.shadowRoot.getElementById('menu');
        const button = this.shadowRoot.getElementById('menu-button');
        if (!menu || !button) return;
        if (this.menuOpen) {
            this.closeMenu();
        } else {
            this.refreshMenuLabels();
            menu.hidden = false;
            this.menuOpen = true;
            button.setAttribute('aria-expanded', 'true');
        }
    }

    closeMenu() {
        if (!this.menuOpen) return;
        const menu = this.shadowRoot.getElementById('menu');
        const button = this.shadowRoot.getElementById('menu-button');
        if (menu) menu.hidden = true;
        if (button) button.setAttribute('aria-expanded', 'false');
        this.menuOpen = false;
    }

    refreshMenuLabels() {
        const menu = this.shadowRoot?.getElementById('menu');
        if (!menu) return;
        const toggleItem = menu.querySelector('[data-action="toggle-expand"]');
        if (!toggleItem) return;

        if (this.isDocked) {
            toggleItem.textContent = '⬆ Restore player';
        } else if (this.isExpanded) {
            toggleItem.textContent = '▢ Mini player';
        } else {
            toggleItem.textContent = '⤢ Expand player';
        }
    }

    handleMenuAction(action) {
        switch (action) {
            case 'toggle-expand':
                this.toggleExpand();
                break;
            default:
                break;
        }
    }

    resizeTo(width, height) {
        const lightbox = this.shadowRoot.getElementById('lightbox');
        if (!lightbox) return;
        const prevRect = lightbox.getBoundingClientRect();
        const maxWidth = Math.max(240, window.innerWidth - 40);
        const maxHeight = Math.max(200, window.innerHeight - 40);
        const newWidth = Math.max(220, Math.min(width, maxWidth));
        const newHeight = Math.max(160, Math.min(height, maxHeight));

        lightbox.style.width = `${newWidth}px`;
        lightbox.style.height = `${newHeight}px`;
        lightbox.style.transform = 'none';

        if (this.isExpanded) {
            const normalizePosition = (value, fallback = '') => (value && value !== 'auto' ? value : fallback);
            this._expandedState = {
                ...(this._expandedState || {}),
                width: `${newWidth}px`,
                height: `${newHeight}px`,
                left: normalizePosition(lightbox.style.left, this._expandedState?.left || ''),
                top: lightbox.style.top || this._expandedState?.top || '',
                right: normalizePosition(lightbox.style.right, this._expandedState?.right || '')
            };
        } else {
            this._miniState = {
                ...(this._miniState || {}),
                width: `${newWidth}px`,
                height: `${newHeight}px`,
                left: prevRect.left,
                top: prevRect.top
            };
        }

        if (prevRect.width > 0) {
            this.sizeMultiplier = (this.sizeMultiplier || 1) * (newWidth / prevRect.width);
        }
        this.saveState();
    }


    setDockedMode(skipSaveOrOptions = false, maybeOptions = null) {
        if (this.isDocked) return true;

        this.gridMode = 'none';

        // Leaving grid-layer mode: restore default host positioning.
        this.style.removeProperty('position');
        this.style.removeProperty('inset');

        let skipSave = false;
        let options = {};

        if (typeof skipSaveOrOptions === 'object' && skipSaveOrOptions !== null) {
            options = skipSaveOrOptions;
            skipSave = !!skipSaveOrOptions.skipSave;
        } else {
            skipSave = !!skipSaveOrOptions;
            if (typeof maybeOptions === 'object' && maybeOptions !== null) {
                options = maybeOptions;
            }
        }

        const shouldPausePlayback = options.pausePlayback === true;
        const allowDockPreference = options.allowPlayback;
        const allowDockPlayback = shouldPausePlayback
            ? false
            : (allowDockPreference === undefined ? true : !!allowDockPreference);
        this.allowDockedPlayback = allowDockPlayback;
        this.ensureAttachedToFloatingLayer();

        this.closeMenu();
        const lightbox = this.shadowRoot.getElementById('lightbox');
        if (lightbox) {
            const rect = lightbox.getBoundingClientRect();
            const workspaceRect = this.getWorkspaceRect();
            this._miniState = {
                ...(this._miniState || {}),
                left: lightbox.style.left
                    ? parseFloat(lightbox.style.left)
                    : rect.left - (workspaceRect?.left || 0),
                top: lightbox.style.top
                    ? parseFloat(lightbox.style.top)
                    : rect.top - (workspaceRect?.top || 0),
                width: lightbox.style.width || `${rect.width}px`,
                height: lightbox.style.height || `${rect.height}px`
            };
        }
        const previousMode = this.isExpanded ? 'expanded' : 'mini';
        this.isDocked = true;
        this.isTaskbarDocked = true; // Always use taskbar dock mode
        this.isExpanded = false;
        this.lastActiveMode = previousMode;
        this.style.zIndex = this.defaultZIndex;

        if (shouldPausePlayback && this.player && typeof this.player.pauseVideo === 'function') {
            try {
                this.player.pauseVideo();
            } catch (error) {
                /* ignore pause issues */
            }
        }

        this.releaseAuthority(true);

        if (lightbox) {
            lightbox.classList.add('docked');
            lightbox.classList.remove('mini', 'expanded', 'grid-full', 'grid-layer');
            // Force hide the lightbox completely when docked
            lightbox.style.setProperty('display', 'none', 'important');
            lightbox.style.visibility = 'hidden';
            lightbox.style.opacity = '0';
            lightbox.style.pointerEvents = 'none';
        }
        
        // Hide the floating dock-tab (taskbar will show controls)
        this.removeDockTab();
        
        this.updateModeButtonState();
        
        // Don't pause music when docking to taskbar - let both play simultaneously
        // The taskbar integration allows both players to coexist
        
        // Dispatch docked event for taskbar integration
        this.dispatchVideoPlayerDocked();
        
        if (!skipSave) {
            this.saveState();
        }
        return true;
    }

    createDockTab() {
        const dockTab = this.shadowRoot.getElementById('dock-tab');
        if (!dockTab) return;
        
        const dockTabTextEl = this.shadowRoot.getElementById('dock-tab-text');
        const dockTabTextDup = this.shadowRoot.getElementById('dock-tab-text-duplicate');
        
        const trackTitle = this.currentTrack?.title || this.currentTrack?.channelTitle || 'Video Player';
        const displayText = `♪ ${trackTitle}`;
        
        if (dockTabTextEl) dockTabTextEl.textContent = displayText + ' • ';
        if (dockTabTextDup) dockTabTextDup.textContent = displayText + ' • ';
        
        dockTab.classList.remove('hidden');
        this.positionDockTab(dockTab);
    }

    removeDockTab() {
        const dockTab = this.shadowRoot.getElementById('dock-tab');
        if (dockTab) dockTab.classList.add('hidden');
    }

    restoreFromDock(targetMode = this.lastActiveMode || 'mini', options = {}) {
        const {
            fromSync = false,
            forceOpenOwner = true,
            claimPlayback: claimPlaybackOption,
            forceAuthority: forceAuthorityOption,
            notifyPeers: notifyPeersOption
        } = options || {};

        const debug = !!window.XAVI_DEBUG_VIDEO_PLAYER;

        // Prevent repeated restore storms (e.g., duplicate event handlers / rapid re-entrancy)
        // while still allowing a later restore to a different target mode.
        const now = Date.now();
        if (this._restoreInProgress) {
            if (debug) console.log('restoreFromDock ignored: restore already in progress');
            return true;
        }
        // Allow quick re-opens after docking: if we're currently docked, a rapid restore
        // request should not be throttled.
        const isDockedNow = !!(this.isDocked || this.isTaskbarDocked);
        if (!isDockedNow && this._lastRestoreRequest && this._lastRestoreTargetMode === targetMode && (now - this._lastRestoreRequest) < 500) {
            if (debug) console.log('restoreFromDock throttled:', { targetMode });
            return true;
        }
        this._lastRestoreRequest = now;
        this._lastRestoreTargetMode = targetMode;
        this._restoreInProgress = true;

        if (debug) {
            console.log('restoreFromDock called:', {
                targetMode,
                isDocked: this.isDocked,
                isTaskbarDocked: this.isTaskbarDocked,
                forceAuthority: forceAuthorityOption,
                forceOpenOwner
            });
        }
        
        if (this._restoreCallDepth > 6) {
            console.warn('video-player restoreFromDock aborted due to excessive recursion');
            return false;
        }

        this._restoreCallDepth += 1;

        try {
            // grid-full is deprecated; treat as grid-layer.
            const normalizedTargetMode = targetMode === 'grid-full' ? 'grid-layer' : targetMode;
            const surfaceTarget = (normalizedTargetMode === 'grid-layer' || normalizedTargetMode === 'expanded')
                ? normalizedTargetMode
                : 'mini';

            const desiredAuthorityMode = surfaceTarget === 'mini' ? 'mini' : 'expanded';
            const claimPlayback = typeof claimPlaybackOption === 'boolean' ? claimPlaybackOption : !fromSync;
            const forceAuthority = typeof forceAuthorityOption === 'boolean'
                ? forceAuthorityOption
                : (forceOpenOwner !== false);
            const shouldEnsureOwner = forceOpenOwner !== false;
            const notifyPeers = typeof notifyPeersOption === 'boolean'
                ? notifyPeersOption
                : (!fromSync && shouldEnsureOwner);

            if (typeof window.ensureOpenOwnerHere === 'function') {
                const ensured = window.ensureOpenOwnerHere({
                    force: shouldEnsureOwner,
                    notify: notifyPeers,
                    refreshHeartbeat: true
                });
                if (debug) console.log('ensureOpenOwnerHere result:', ensured);
                if (!ensured && !fromSync) {
                    this.showStatus('Player is already open in another tab');
                    return false;
                }
            }

            let hasAuthority = this.ensureAuthority(desiredAuthorityMode);
            if (debug) console.log('initial hasAuthority:', hasAuthority);
            if (!hasAuthority && forceAuthority) {
                this.releaseAuthority(true);
                hasAuthority = this.ensureAuthority(desiredAuthorityMode);
                if (debug) console.log('hasAuthority after force:', hasAuthority);
            }

            if (!hasAuthority) {
                if (!fromSync) {
                    this.showStatus('Player surface is controlled elsewhere');
                }
                return false;
            }

            // Check if we're actually docked (either regular dock or taskbar dock)
            const isActuallyDocked = this.isDocked || this.isTaskbarDocked;

            // If we're not docked and we're already in the desired mode, be a no-op.
            // (Prevents repeated restoreFromDock() calls from spamming saves/claims.)
            const alreadyInDesiredMode = (() => {
                if (surfaceTarget === 'grid-layer') return this.gridMode === 'layer';
                if (surfaceTarget === 'expanded') return !!this.isExpanded;
                return !this.isExpanded;
            })();
            if (!isActuallyDocked && alreadyInDesiredMode) {
                this.updateModeButtonState();
                return true;
            }
            
            if (!isActuallyDocked) {
                if (debug) console.log('Not docked, adjusting mode only');
                if (surfaceTarget === 'grid-layer') this.setGridMode('layer', true, true);
                else if (surfaceTarget === 'expanded') this.setExpandedMode(true, true);
                else this.setMiniMode(true, true);
                this.updateModeButtonState();
                this.saveState();
                return true;
            }

            if (debug) console.log('Restoring from dock to:', surfaceTarget);
            this.isDocked = false;
            this.isTaskbarDocked = false; // Reset taskbar dock state
            this.removeDockTab();
            const lightbox = this.shadowRoot.getElementById('lightbox');
            if (lightbox) {
                // Restore visibility properties
                lightbox.style.removeProperty('display');
                lightbox.style.visibility = 'visible';
                lightbox.style.opacity = '1';
                lightbox.style.pointerEvents = 'auto';
                lightbox.classList.remove('docked');
            }
            if (surfaceTarget === 'grid-layer') this.setGridMode('layer', true, true);
            else if (surfaceTarget === 'expanded') this.setExpandedMode(true, true);
            else this.setMiniMode(true, true);
            this.updateModeButtonState();
            this.saveState();
            this.allowDockedPlayback = false;
            
            // Sync volume controls with shared storage
            this.syncVolumeControls();
            
            // Dispatch undocked event for taskbar integration
            this.dispatchVideoPlayerUndocked();
            
            this.dispatchEvent(new CustomEvent('video-surface-restored', {
                bubbles: true,
                composed: true,
                detail: { mode: surfaceTarget }
            }));

            return true;
        } finally {
            this._restoreCallDepth = Math.max(0, (this._restoreCallDepth || 1) - 1);
            this._restoreInProgress = false;
        }
    }

    syncVolumeControls() {
        const savedVolume = parseInt(localStorage.getItem('myVolume') || '50', 10);

        const volumeControl = this.shadowRoot.getElementById('volume-control');
        const dockVolumeControl = this.shadowRoot.getElementById('dock-volume-control');
        if (volumeControl) volumeControl.value = savedVolume;
        if (dockVolumeControl) dockVolumeControl.value = savedVolume;
        
        // Set player volume
        if (this.player && this.player.setVolume) {
            this.player.setVolume(savedVolume);
        }
    }

    togglePlayPause() {
        if (!this.player) return;
        const getState = typeof this.player.getPlayerState === 'function'
            ? this.player.getPlayerState()
            : null;
        const isPlaying = getState === 1 || getState === (window.YT?.PlayerState?.PLAYING);

        if (isPlaying && typeof this.player.pauseVideo === 'function') {
            this.player.pauseVideo();
            return;
        }
        if (typeof this.player.playVideo === 'function') {
            this.player.playVideo();
        }
    }

    updateVolumeIcon(button, volume) {
        if (!button) return;
        if (volume === 0) {
            button.textContent = '🔇';
        } else if (volume < 33) {
            button.textContent = '🔈';
        } else if (volume < 66) {
            button.textContent = '🔉';
        } else {
            button.textContent = '🔊';
        }
    }

    previousTrack() {
        const musicPlayer = document.querySelector('music-player');
        if (musicPlayer) {
            musicPlayer.dispatchEvent(new CustomEvent('previous-track'));
        }
    }

    nextTrack() {
        const musicPlayer = document.querySelector('music-player');
        if (musicPlayer) {
            musicPlayer.dispatchEvent(new CustomEvent('next-track'));
        }
    }
    
    // Alias methods for consistency with music player API
    playPrevious() {
        this.previousTrack();
    }
    
    playNext() {
        this.nextTrack();
    }

    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    updateTimeDisplay() {
        if (!this.player) return;
        try {
            const currentTime = this.player.getCurrentTime();
            const duration = this.player.getDuration();
            const timeString = `${this.formatTime(currentTime)} / ${this.formatTime(duration)}`;
            
            const timeDisplay = this.shadowRoot.getElementById('time-display');
            const dockTimeDisplay = this.shadowRoot.getElementById('dock-time-display');
            
            if (timeDisplay) timeDisplay.textContent = timeString;
            if (dockTimeDisplay) dockTimeDisplay.textContent = timeString;
            
            // Update play/pause button icons
            const state = this.player.getPlayerState();
            const playPauseButton = this.shadowRoot.getElementById('play-pause-button');
            const dockPlayPauseButton = this.shadowRoot.getElementById('dock-play-pause-button');
            const icon = state === 1 ? '⏸' : '▶';
            if (playPauseButton) playPauseButton.textContent = icon;
            if (dockPlayPauseButton) dockPlayPauseButton.textContent = icon;
            
            // Always dispatch time update for taskbar
            if (this.isDocked) {
                this.dispatchVideoTimeUpdate(currentTime, duration);
            }
        } catch (e) {
            // Player not ready yet
        }
    }

    startTimeTracking() {
        if (this.timeUpdateInterval) {
            clearInterval(this.timeUpdateInterval);
        }
        this.timeUpdateInterval = setInterval(() => this.updateTimeDisplay(), 1000);
    }

    stopTimeTracking() {
        if (this.timeUpdateInterval) {
            clearInterval(this.timeUpdateInterval);
            this.timeUpdateInterval = null;
        }
    }

    handleAddToPlaylist() {
        if (!this.currentTrack || !this.currentTrack.videoId) {
            this.showStatus('No track playing');
            return;
        }
        const list = JSON.parse(localStorage.getItem('userCustomPlaylist') || '[]');
        if (Array.isArray(list) && list.some((item) => item?.vid === this.currentTrack.videoId)) {
            this.showStatus('Already in your playlist');
            return;
        }

        const entry = {
            vid: this.currentTrack.videoId,
            title: this.currentTrack.title || this.currentTrack.videoId,
            channelTitle: this.currentTrack.channelTitle || 'Unknown Channel',
            channelId: this.currentTrack.channelId || ''
        };

        const updatedList = Array.isArray(list) ? [...list, entry] : [entry];
        localStorage.setItem('userCustomPlaylist', JSON.stringify(updatedList));
        window.dispatchEvent(new CustomEvent('user-playlist-updated'));
        this.showStatus('Added to your playlist');
    }

    showStatus(message) {
        const lightbox = this.shadowRoot.getElementById('lightbox');
        if (!lightbox) return;
        let chip = this.shadowRoot.getElementById('status-chip');
        if (!chip) {
            chip = document.createElement('div');
            chip.id = 'status-chip';
            chip.className = 'status-chip';
            lightbox.appendChild(chip);
        }
        chip.textContent = message;
        chip.classList.add('visible');
        if (this.statusTimeout) window.clearTimeout(this.statusTimeout);
        this.statusTimeout = window.setTimeout(() => {
            chip.classList.remove('visible');
        }, 1800);
    }

    handleWindowResize() {
        const lightbox = this.shadowRoot.getElementById('lightbox');
        const dockTab = this.shadowRoot.getElementById('dock-tab');
        
        if (!lightbox) return;
        const workspaceRect = this.getWorkspaceRect();
        const workspaceWidth = Math.max(0, workspaceRect?.width || window.innerWidth || 0);
        const workspaceHeight = Math.max(0, workspaceRect?.height || window.innerHeight || 0);

        if (this.gridMode === 'layer') {
            this.layoutGridSurface(lightbox);
        } else if (this.isExpanded) {
            // Keep expanded mode on screen while respecting user placement
            const rect = lightbox.getBoundingClientRect();
            const originLeft = workspaceRect?.left || 0;
            const originTop = workspaceRect?.top || 0;
            const maxTop = Math.max(0, workspaceHeight - rect.height);
            const parsedTopAbs = parseFloat(lightbox.style.top);
            const relTop = Number.isFinite(parsedTopAbs) ? (parsedTopAbs - originTop) : (rect.top - originTop);
            const clampedRelTop = Math.max(0, Math.min(Number.isFinite(relTop) ? relTop : 40, maxTop));
            lightbox.style.top = `${originTop + clampedRelTop}px`;

            const hasExplicitLeft = lightbox.style.left && lightbox.style.left !== '' && lightbox.style.left !== 'auto';
            const parsedLeftAbs = parseFloat(lightbox.style.left);
            const maxLeft = Math.max(0, workspaceWidth - rect.width);

            if (hasExplicitLeft && Number.isFinite(parsedLeftAbs)) {
                const relLeft = parsedLeftAbs - originLeft;
                const clampedRelLeft = Math.max(0, Math.min(relLeft, maxLeft));
                lightbox.style.left = `${originLeft + clampedRelLeft}px`;
                lightbox.style.right = 'auto';
            } else {
                const fallbackLeft = Math.max(0, workspaceWidth - rect.width - 24);
                lightbox.style.left = `${originLeft + fallbackLeft}px`;
                lightbox.style.right = 'auto';
            }
            
            // Update saved state
            const normalizedTop = `${Math.round(clampedRelTop)}px`;
            const normalizedLeftAbs = parseFloat(lightbox.style.left);
            const normalizedLeftRel = Number.isFinite(normalizedLeftAbs) ? Math.round(normalizedLeftAbs - originLeft) : 0;
            this._expandedState = {
                ...this._expandedState,
                top: normalizedTop,
                left: `${normalizedLeftRel}px`,
                right: lightbox.style.right || '',
                width: lightbox.style.width || `${rect.width}px`,
                height: lightbox.style.height || `${rect.height}px`,
                userAdjusted: true
            };
        } else if (!this.isDocked) {
            // Keep mini mode on the right edge at bottom with taskbar clearance
            this.positionMiniPlayer(lightbox);
        }

        // Reposition dock tab if needed
        if (dockTab && !dockTab.classList.contains('hidden')) {
            this.positionDockTab(dockTab);
        }

        this.saveState(false);
    }

    setGridMode(mode, skipSave = false, skipAuthority = false) {
        // Only supported grid mode: layer (background).
        const normalized = 'layer';

        if (!skipAuthority && !this.ensureAuthority('expanded')) {
            return false;
        }

        const lightbox = this.shadowRoot.getElementById('lightbox');
        if (!lightbox) {
            return false;
        }

        this.allowDockedPlayback = false;
        if (!this.ensureAttachedToBackgroundLayer()) {
            this.ensureAttachedToFloatingLayer();
        }

        const dockTab = this.shadowRoot.getElementById('dock-tab');
        if (dockTab) dockTab.classList.add('hidden');

        this.gridMode = normalized;
        this.isExpanded = false;
        this.isDocked = false;
        this.isTaskbarDocked = false;
        this.lastActiveMode = 'expanded';

        // Force background stacking: behind background and grid overlays.
        this.style.zIndex = '0';
        this.style.position = 'absolute';
        this.style.inset = '0';

        lightbox.classList.remove('mini', 'expanded', 'docked', 'grid-full', 'grid-layer');
        lightbox.classList.add('grid-layer');
        lightbox.style.display = 'block';
        lightbox.style.transform = 'none';
        lightbox.style.right = 'auto';
        lightbox.style.bottom = 'auto';
        // Keep the background layer non-interactive, but avoid cursor flicker by
        // catching pointer events on the lightbox while disabling them on the iframe.
        lightbox.style.pointerEvents = 'auto';
        lightbox.style.cursor = 'default';
        try {
            const iframe = this.player?.getIframe?.();
            if (iframe && iframe.style) iframe.style.pointerEvents = 'none';
        } catch (error) {
            /* ignore iframe style errors */
        }

        this.layoutGridSurface(lightbox);

        this.updateModeButtonState();
        this.updateExpandButtonState();

        if (!skipSave) {
            this.saveState();
        }
        return true;
    }

    layoutGridSurface(lightbox) {
        if (!lightbox) return;

        // Prefer the content area (excludes taskbar) so it centers in the usable grid.
        const contentArea = this.getContentAreaElement();
        const bgLayer = this.getBackgroundLayerElement?.();
        const rect = contentArea?.getBoundingClientRect?.() || bgLayer?.getBoundingClientRect?.() || this.getWorkspaceRect();
        if (!rect) return;

        const originLeft = rect.left || 0;
        const originTop = rect.top || 0;
        const wsW = Math.max(1, rect.width || 1);
        const wsH = Math.max(1, rect.height || 1);

        // YouTube is effectively 16:9; treat as the layout aspect.
        const aspect = 16 / 9;
        const wsAspect = wsW / wsH;

        let targetW;
        let targetH;
        if (wsAspect >= aspect) {
            // Workspace is wider than video: height constrains.
            targetH = wsH;
            targetW = Math.round(wsH * aspect);
        } else {
            // Workspace is taller/narrower: width constrains.
            targetW = wsW;
            targetH = Math.round(wsW / aspect);
        }

        const left = Math.round(originLeft + (wsW - targetW) / 2);
        const top = Math.round(originTop + (wsH - targetH) / 2);

        lightbox.style.left = `${left}px`;
        lightbox.style.top = `${top}px`;
        lightbox.style.width = `${targetW}px`;
        lightbox.style.height = `${targetH}px`;
        lightbox.style.right = 'auto';
        lightbox.style.bottom = 'auto';
        lightbox.style.transform = 'none';
    }

    updateModeButtonState() {
        const modeButton = this.shadowRoot?.getElementById('mode-button');
        if (!modeButton) return;

        if (this.isDocked || this.isTaskbarDocked) {
            modeButton.textContent = 'Open';
            modeButton.setAttribute('aria-label', 'Open player');
            modeButton.setAttribute('title', 'Open player');
            return;
        }

        if (this.isExpanded) {
            modeButton.textContent = '⤡';
            modeButton.setAttribute('aria-label', 'Switch to mini player');
            modeButton.setAttribute('title', 'Switch to mini player');
            return;
        }

        modeButton.textContent = 'Expand';
        modeButton.setAttribute('aria-label', 'Expand player');
        modeButton.setAttribute('title', 'Expand player');
    }

    updateExpandButtonState() {
        const expandButton = this.shadowRoot?.getElementById('expand-button');
        if (!expandButton) return;

        if (this.isDocked) {
            expandButton.disabled = true;
            expandButton.textContent = '⤢';
        } else {
            expandButton.disabled = false;
            expandButton.textContent = '⤢';
        }
    }

    // Public API for mode switching
    setMode(mode) {
        if (mode === 'mini' || mode === 'expanded' || mode === 'docked') {
            this.switchToMode(mode);
            return;
        }
        console.warn('Unknown mode:', mode);
    }

    // Event dispatching for taskbar integration
    dispatchVideoPlayerDocked() {
        const detail = {
            title: this.currentTrack?.title || 'No video',
            channelTitle: this.currentTrack?.channelTitle || this.currentTrack?.artist || 'Docked',
            artist: this.currentTrack?.channelTitle || this.currentTrack?.artist,
            isPlaying: this.isCurrentlyPlaying || false
        };
        
        document.dispatchEvent(new CustomEvent('video-player-docked', { detail }));
        this.dispatchVideoTrackChanged();
        this.dispatchVideoPlaybackState();
    }

    dispatchVideoPlayerUndocked() {
        document.dispatchEvent(new CustomEvent('video-player-undocked'));
    }

    dispatchVideoTrackChanged() {
        if (!this.currentTrack) return;
        
        const detail = {
            title: this.currentTrack.title || 'Unknown',
            channelTitle: this.currentTrack.channelTitle || this.currentTrack.artist || 'Unknown',
            artist: this.currentTrack.channelTitle || this.currentTrack.artist,
            videoId: this.currentTrack.videoId,
            duration: this.currentTrack.duration
        };
        
        document.dispatchEvent(new CustomEvent('video-track-changed', { detail }));
    }

    dispatchVideoPlaybackState() {
        const detail = {
            isPlaying: this.isCurrentlyPlaying || false
        };
        
        document.dispatchEvent(new CustomEvent('video-playback-state', { detail }));
    }

    dispatchVideoTimeUpdate(currentTime, duration) {
        const detail = {
            currentTime: currentTime || 0,
            duration: duration || 0
        };
        
        document.dispatchEvent(new CustomEvent('video-time-update', { detail }));
    }

    // GridObject Integration
    initializeGridObject() {
        if (this.gridObject) return;
        
        const workspace = document.querySelector('workspace-manager');
        if (!workspace || !workspace.GridObject) return;
        
        this.gridObject = new workspace.GridObject(this, {
            draggable: true,
            resizable: true,
            gridSnap: false,
            minWidth: 400,
            minHeight: 300,
            onStateChange: (state) => {
                // Sync any state changes from GridObject
                if (state.gridSnap !== undefined) {
                    this.isGridSnapped = state.gridSnap;
                }
            }
        });
    }

    toggleGridSnap() {
        if (this.gridObject) {
            this.gridObject.toggleGridSnap();
        }
    }
}

customElements.define('video-player', VideoPlayer);
