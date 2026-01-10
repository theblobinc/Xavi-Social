(function playlistOverlayModule() {
    'use strict';
    
    try {
        initializeOverlay();
    } catch (err) {
        console.error('[PlaylistOverlay] Overlay positioning failed:', err);
    }

    function initializeOverlay() {
    const OVERLAY_ID = 'playlist-viewer-overlay';
    const TOGGLE_ID = 'playlist-toggle-tab';
    const FLOATING_STYLE_ID = 'playlist-overlay-floating-styles';
    const ATTACH_EVENT = 'playlist-overlay-attached';
    const MAX_ATTACH_ATTEMPTS = 40;

    const FLOATING_LAYER_STYLES = `
#floating-panel-layer .playlist-overlay {
    position: absolute;
    top: var(--playlist-overlay-top, 0px);
    left: var(--playlist-overlay-left, 0px);
    right: auto;
    bottom: var(--playlist-overlay-bottom, 0px);
    max-height: calc(100% - var(--playlist-overlay-top, 0px) - var(--playlist-overlay-bottom, 0px));
    --playlist-overlay-margin: 0px;
    --playlist-default-width: 33.33vw;
    width: min(var(--playlist-overlay-width, var(--playlist-default-width)), calc(100% - var(--playlist-overlay-margin, 0px) - 16px));
    min-width: min(360px, calc(100% - var(--playlist-overlay-margin, 0px) - 16px));
    max-width: calc(100% - var(--playlist-overlay-margin, 0px) - 16px);
    background: rgba(12, 12, 12, 0.98);
    border-right: 2px solid rgba(255, 255, 255, 0.2);
    z-index: var(--z-playlist-overlay, 2500);
    box-shadow: 4px 0 20px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    will-change: transform, top, height;
    overflow: visible;
    pointer-events: auto;
    transform: translateX(0);
    transition: transform 0.35s ease;
}

#floating-panel-layer .playlist-overlay.open {
    transform: translateX(0);
}

#floating-panel-layer .playlist-overlay:not(.open) {
    transform: translateX(-100%);
}

#floating-panel-layer .playlist-overlay.resizing {
    cursor: ew-resize;
    user-select: none;
}

#floating-panel-layer .playlist-overlay .playlist-overlay-content {
    flex: 1;
    min-height: 0;
    overflow: visible;
    display: flex;
    flex-direction: column;
    padding: 12px;
    transition: opacity 0.2s ease;
}

#floating-panel-layer .playlist-overlay .playlist-overlay-content playlist-viewer {
    flex: 1;
    min-height: 0;
}

#floating-panel-layer .playlist-overlay .playlist-resize-handle {
    position: absolute;
    top: 0;
    right: -6px;
    width: 12px;
    height: 100%;
    cursor: ew-resize;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
    transition: opacity 0.2s ease;
}

#floating-panel-layer .playlist-overlay .playlist-resize-handle::before {
    content: '';
    display: block;
    width: 2px;
    height: 32px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.3);
    box-shadow: 0 0 6px rgba(0, 0, 0, 0.4);
}

#floating-panel-layer .playlist-overlay .playlist-toggle-tab {
    position: absolute;
    right: -40px;
    top: 50%;
    transform: translateY(-50%);
    width: 40px;
    height: 100px;
    background: rgba(12, 12, 12, 0.98);
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-left: none;
    border-radius: 0 8px 8px 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.7);
    font-size: 1.4rem;
    transition: background 0.3s ease, color 0.3s ease;
    z-index: 10;
    pointer-events: auto;
}

#floating-panel-layer .playlist-overlay .playlist-toggle-tab:hover {
    background: rgba(74, 158, 255, 0.3);
    color: #fff;
}

#floating-panel-layer .playlist-overlay .playlist-toggle-tab .arrow {
    display: inline-block;
    transition: transform 0.3s ease;
}

#floating-panel-layer .playlist-overlay:not(.open) .playlist-overlay-content,
#floating-panel-layer .playlist-overlay:not(.open) .playlist-resize-handle {
    opacity: 0;
    pointer-events: none;
}

#floating-panel-layer .playlist-overlay.open .playlist-overlay-content,
#floating-panel-layer .playlist-overlay.open .playlist-resize-handle {
    opacity: 1;
}

@media (max-width: 900px) {
    #floating-panel-layer .playlist-overlay {
        --playlist-overlay-margin: 28px;
        --playlist-default-width: calc(100% - 28px);
        max-width: calc(100% - var(--playlist-overlay-margin, 28px));
    }
}

@media (max-width: 640px) {
    #floating-panel-layer .playlist-overlay {
        --playlist-overlay-margin: 16px;
        width: calc(100% - var(--playlist-overlay-margin, 16px));
        min-width: calc(100% - var(--playlist-overlay-margin, 16px));
        max-width: calc(100% - var(--playlist-overlay-margin, 16px));
    }

    /* On mobile, the external toggle tab can land off-screen when the overlay is near full width.
       Use the taskbar corner toggle instead. */
    #floating-panel-layer .playlist-overlay .playlist-toggle-tab {
        display: none;
    }
}

@media (max-width: 480px) {
    #floating-panel-layer .playlist-overlay {
        --playlist-overlay-margin: 12px;
        width: calc(100% - var(--playlist-overlay-margin, 12px));
        border-right-width: 1px;
    }

    #floating-panel-layer .playlist-overlay .playlist-toggle-tab {
        width: 32px;
        height: 80px;
        font-size: 1.1rem;
    }
}
`;

    function getWorkspace() {
        return document.querySelector('xavi-multi-grid');
    }

    function ensureStyles(workspace) {
        if (!workspace || !workspace.shadowRoot) {
            return;
        }
        if (workspace.shadowRoot.getElementById(FLOATING_STYLE_ID)) {
            return;
        }
        const style = document.createElement('style');
        style.id = FLOATING_STYLE_ID;
        style.textContent = FLOATING_LAYER_STYLES;
        workspace.shadowRoot.appendChild(style);
    }

    function normalizeToggle(overlay) {
        if (!overlay) {
            return null;
        }
        let toggle = overlay.querySelector(`#${TOGGLE_ID}`) || overlay.querySelector('.playlist-toggle-tab');
        if (!toggle) {
            toggle = document.getElementById(TOGGLE_ID);
        }
        if (toggle && toggle.parentElement !== overlay) {
            overlay.appendChild(toggle);
        }
        return toggle || null;
    }

    function dispatchOverlayReady(detail) {
        if (!detail || !detail.overlay) {
            return;
        }
        window.__playlistOverlayRefs = detail;
        window.dispatchEvent(new CustomEvent(ATTACH_EVENT, { detail }));
    }

    function attachOverlayToFloatingLayer() {
        const workspace = getWorkspace();
        if (!workspace) {
            return false;
        }

        let overlay = workspace.shadowRoot?.getElementById(OVERLAY_ID) || document.getElementById(OVERLAY_ID);
        if (!overlay) {
            return false;
        }

        ensureStyles(workspace);

        const floatingLayer = typeof workspace.getFloatingLayer === 'function'
            ? workspace.getFloatingLayer()
            : workspace.shadowRoot?.getElementById('floating-panel-layer');

        if (!floatingLayer) {
            return false;
        }

        if (overlay.parentElement !== floatingLayer) {
            if (typeof workspace.attachFloatingPanel === 'function') {
                workspace.attachFloatingPanel(overlay);
            } else {
                floatingLayer.appendChild(overlay);
            }
        }

        overlay.dataset.floatingLayer = 'true';
        const toggleTab = normalizeToggle(overlay);
        const detail = { overlay, toggleTab };
        dispatchOverlayReady(detail);
        return true;
    }

    function scheduleAttach(attempt = 0) {
        if (attachOverlayToFloatingLayer()) {
            return;
        }
        if (attempt >= MAX_ATTACH_ATTEMPTS) {
            return;
        }
        requestAnimationFrame(() => scheduleAttach(attempt + 1));
    }

    function init() {
        const start = () => scheduleAttach();
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', start, { once: true });
        } else {
            start();
        }
        window.addEventListener('xavi-workspace-ready', () => scheduleAttach());
    }

    init();
    }
})();
