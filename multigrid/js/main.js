// ---- BEGIN multi-tab playback lock ----
// Initialize z-index manager CSS variables
if (window.ZIndexManager) {
    window.ZIndexManager.injectCSSVariables();
    console.log('Z-Index Manager initialized with CSS variables');
}

// Initialize shared state manager (new multi-focal architecture)
if (typeof window !== 'undefined' && !window.sharedStateManager) {
    // Will be loaded by shared-state-manager.js
    console.log('SharedStateManager will initialize from shared-state-manager.js');
}

// Storage + BroadcastChannel can throw in some browsers/private modes.
let myTabId = null;
try {
    myTabId = sessionStorage.getItem('myTabId');
    if (!myTabId) {
        myTabId = `${Date.now()}-${Math.random()}`;
        sessionStorage.setItem('myTabId', myTabId);
    }
} catch (e) {
    myTabId = `${Date.now()}-${Math.random()}`;
}

let musicChannel = null;
try {
    if (typeof BroadcastChannel !== 'undefined') {
        musicChannel = new BroadcastChannel('music_player_control');
    }
} catch (e) {
    musicChannel = null;
}

window.musicChannel = musicChannel;
window.myTabId = myTabId;

try {
    const initialOwner = localStorage.getItem('musicPlayerCurrentOwner');
    if (initialOwner) {
        window.currentPlayerTabId = initialOwner;
    }
} catch (e) {
    // ignore
}

// Legacy helpers kept for compatibility but deprecated
// All tabs are now equal - no ownership concept
window.claimMusicPlaybackOwnership = () => {
    console.warn('[Deprecated] claimMusicPlaybackOwnership - no longer needed in multi-focal architecture');
};
window.releaseMusicPlaybackOwnership = () => {
    console.warn('[Deprecated] releaseMusicPlaybackOwnership - no longer needed in multi-focal architecture');
};
// ---- END multi-tab playback lock ----

// Playlist overlay module now handles all playlist viewer initialization
console.log('[Main] Playlist initialization delegated to playlist_overlay module');

// Initialize workspace
document.addEventListener('DOMContentLoaded', () => {
    console.log('[Main] Initializing Xavi Multi Grid workspace');
    
    // Find the grid container that has the proper height constraints
    const container = document.getElementById('xavi-grid-container');
    
    if (!container) {
        console.error('[Main] #xavi-grid-container not found - cannot mount workspace');
        return;
    }
    
    // Create and mount the workspace custom element
    const workspace = document.createElement('xavi-multi-grid');
    workspace.id = 'xavi-workspace';
    
    // Create taskbar element to be slotted into workspace
    const taskbar = document.createElement('panel-taskbar');
    workspace.appendChild(taskbar);

    // Measure taskbar height -> CSS var (eliminates hardcoded 108px layout coupling)
    const setTaskbarVar = () => {
        try {
            const rect = taskbar.getBoundingClientRect();
            const h = Math.max(0, Math.ceil(rect.height || 0));
            if (h) {
                document.documentElement.style.setProperty('--xavi-taskbar-h', h + 'px');
            }
        } catch (e) {
            // ignore
        }
    };
    requestAnimationFrame(setTaskbarVar);
    window.addEventListener('resize', () => requestAnimationFrame(setTaskbarVar));
    if (typeof ResizeObserver !== 'undefined') {
        try {
            const ro = new ResizeObserver(() => setTaskbarVar());
            ro.observe(taskbar);
        } catch (e) {
            // ignore
        }
    }
    
    // Move any existing content from container into workspace
    while (container.firstChild) {
        workspace.appendChild(container.firstChild);
    }
    
    // Mount workspace in the container
    container.appendChild(workspace);
    
    console.log('[Main] Workspace element created and mounted in #xavi-grid-container');
});
