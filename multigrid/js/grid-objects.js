// grid-objects.js
// Shared functionality for draggable, resizable, grid-snappable panels

class GridObject {
    constructor(element, options = {}) {
        this.element = element;
        this.options = {
            gridSize: 30,
            gridSnapEnabled: true,
            minWidth: 360,
            minHeight: 200,
            defaultWidth: 600,
            defaultHeight: 400,
            saveStateKey: null,
            draggable: true,
            resizable: true,
            ...options
        };

        this.isDragging = false;
        this.isResizing = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.resizeStartX = 0;
        this.resizeStartY = 0;
        this.resizeStartWidth = 0;
        this.resizeStartHeight = 0;
        this.resizeStartLeft = 0;
        this.resizeStartTop = 0;
        this.resizeDirection = null;
        this.currentLeft = 0;
        this.currentTop = 0;
        this.currentWidth = this.options.defaultWidth;
        this.currentHeight = this.options.defaultHeight;
        this.resizeOverlay = null;

        this.boundDragHandler = (e) => this.handleDrag(e);
        this.boundStopDragHandler = (e) => this.stopDragging(e);
        this.boundResizeHandler = (e) => this.handleResize(e);
        this.boundStopResizeHandler = (e) => this.stopResizing(e);

        this.init();
    }

    init() {
        // Apply base styles
        this.applyBaseStyles();

        // Add resize handles if resizable
        if (this.options.resizable) {
            this.addResizeHandles();
        }

        // Setup drag handler if draggable
        if (this.options.draggable) {
            this.setupDragHandler();
        }

        // Setup focus handler to bring panel to front
        this.setupFocusHandler();

        // Load saved state
        this.loadState();

        // Apply initial position and size
        this.applyGeometry();
    }

    applyBaseStyles() {
        this.element.style.position = 'absolute';
        this.element.style.borderRadius = '0';
        this.element.style.boxSizing = 'border-box';

        // GridObject-managed panels should be positioned via left/top only.
        // If right/bottom anchoring is present (from previous layouts), it can
        // cause the panel to appear stuck in the bottom-right or snap back.
        this.element.style.removeProperty('right');
        this.element.style.removeProperty('bottom');
        
        // Initialize z-index using ZIndexManager
        if (window.ZIndexManager) {
            this.element.style.zIndex = String(window.ZIndexManager.getNextGridPanel());
        } else {
            // Fallback to old system if manager not loaded
            if (!GridObject._zIndexCounter) {
                GridObject._zIndexCounter = 1400;
            }
            GridObject._zIndexCounter += 1;
            this.element.style.zIndex = String(GridObject._zIndexCounter);
        }
    }

    addResizeHandles() {
        const handleContainer = document.createElement('div');
        handleContainer.className = 'grid-object-resize-handles';
        handleContainer.innerHTML = `
            <div class="grid-object-resize-handle resize-n" data-direction="n"></div>
            <div class="grid-object-resize-handle resize-ne" data-direction="ne"></div>
            <div class="grid-object-resize-handle resize-e" data-direction="e"></div>
            <div class="grid-object-resize-handle resize-se" data-direction="se"></div>
            <div class="grid-object-resize-handle resize-s" data-direction="s"></div>
            <div class="grid-object-resize-handle resize-sw" data-direction="sw"></div>
            <div class="grid-object-resize-handle resize-w" data-direction="w"></div>
            <div class="grid-object-resize-handle resize-nw" data-direction="nw"></div>
        `;

        // Append to element (or shadow root if available)
        const target = this.element.shadowRoot || this.element;
        
        // Add styles to the appropriate location
        this.injectResizeStyles(target);
        
        target.appendChild(handleContainer);

        // Attach event listeners
        const handles = target.querySelectorAll('.grid-object-resize-handle');
        handles.forEach(handle => {
            handle.addEventListener('mousedown', (e) => this.startResizing(e));
            handle.addEventListener('touchstart', (e) => this.startResizing(e), { passive: false });
        });

        document.addEventListener('mousemove', this.boundResizeHandler);
        document.addEventListener('mouseup', this.boundStopResizeHandler);
        document.addEventListener('touchmove', this.boundResizeHandler, { passive: false });
        document.addEventListener('touchend', this.boundStopResizeHandler);
    }

    injectResizeStyles(target) {
        // If target is a shadow root, inject styles there; otherwise use document head
        const isShadowRoot = target instanceof ShadowRoot;
        const styleContainer = isShadowRoot ? target : document.head;
        const styleId = 'grid-object-resize-styles';
        
        if (isShadowRoot || !document.getElementById(styleId)) {
            const style = document.createElement('style');
            if (!isShadowRoot) style.id = styleId;
            style.textContent = `
                .grid-object-resize-handles {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    pointer-events: none;
                    z-index: 10;
                }

                .grid-object-resize-handle {
                    position: absolute;
                    pointer-events: auto;
                    background: transparent;
                    z-index: 11;
                }

                .grid-object-resize-handle:hover {
                    background: rgba(74, 158, 255, 0.3);
                }

                .resize-n, .resize-s {
                    left: 10%;
                    right: 10%;
                    height: 8px;
                }

                .resize-n { top: 0; cursor: ns-resize; }
                .resize-s { bottom: 0; cursor: ns-resize; }

                .resize-e, .resize-w {
                    top: 10%;
                    bottom: 10%;
                    width: 8px;
                }

                .resize-e { right: 0; cursor: ew-resize; }
                .resize-w { left: 0; cursor: ew-resize; }

                .resize-ne, .resize-nw, .resize-se, .resize-sw {
                    width: 16px;
                    height: 16px;
                }

                .resize-ne { top: 0; right: 0; cursor: nesw-resize; }
                .resize-nw { top: 0; left: 0; cursor: nwse-resize; }
                .resize-se { bottom: 0; right: 0; cursor: nwse-resize; }
                .resize-sw { bottom: 0; left: 0; cursor: nesw-resize; }
            `;

            styleContainer.appendChild(style);
        }
    }

    setupDragHandler() {
        // Find header element to use as drag handle
        const dragHandle = this.findDragHandle();
        if (!dragHandle) return;

        dragHandle.style.cursor = 'move';
        dragHandle.addEventListener('mousedown', (e) => this.startDragging(e));
        dragHandle.addEventListener('touchstart', (e) => this.startDragging(e), { passive: false });

        document.addEventListener('mousemove', this.boundDragHandler);
        document.addEventListener('mouseup', this.boundStopDragHandler);
        document.addEventListener('touchmove', this.boundDragHandler, { passive: false });
        document.addEventListener('touchend', this.boundStopDragHandler);
    }

    setupFocusHandler() {
        // Bring panel to front on any interaction
        this.element.addEventListener('mousedown', () => this.bringToFront());
        this.element.addEventListener('touchstart', () => this.bringToFront());
    }

    bringToFront() {
        if (window.ZIndexManager) {
            window.ZIndexManager.bringGridPanelToFront(this.element);
        } else {
            // Fallback to old system
            if (!GridObject._zIndexCounter) {
                GridObject._zIndexCounter = 1400;
            }
            GridObject._zIndexCounter += 1;
            this.element.style.zIndex = String(GridObject._zIndexCounter);
        }
    }

    findDragHandle() {
        // Look for common header patterns
        const selectors = [
            '.modal-header',
            '.panel-header',
            'header',
            '.drag-handle',
            '.title-bar'
        ];

        for (const selector of selectors) {
            const target = this.element.shadowRoot || this.element;
            const handle = target.querySelector(selector);
            if (handle) return handle;
        }

        return null;
    }

    startDragging(e) {
        // Don't drag if clicking on interactive elements
        if (e.target.closest('button, input, select, textarea, a, .grid-object-resize-handle')) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        this.isDragging = true;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        const rect = this.element.getBoundingClientRect();
        this.dragStartX = clientX - rect.left;
        this.dragStartY = clientY - rect.top;

        this.element.style.cursor = 'grabbing';
    }

    handleDrag(e) {
        if (!this.isDragging) return;

        e.preventDefault();

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        const workspace = this.getWorkspaceRect();
        if (!workspace) return;

        let newLeft = clientX - workspace.left - this.dragStartX;
        let newTop = clientY - workspace.top - this.dragStartY;

        // Apply grid snap
        if (this.options.gridSnapEnabled) {
            newLeft = Math.round(newLeft / this.options.gridSize) * this.options.gridSize;
            newTop = Math.round(newTop / this.options.gridSize) * this.options.gridSize;
        }

        // Constrain to workspace bounds
        const maxLeft = workspace.width - this.currentWidth;
        const maxTop = workspace.height - this.currentHeight;

        newLeft = Math.max(0, Math.min(newLeft, maxLeft));
        newTop = Math.max(0, Math.min(newTop, maxTop));

        this.currentLeft = newLeft;
        this.currentTop = newTop;

        this.applyGeometry();
    }

    stopDragging(e) {
        if (!this.isDragging) return;

        this.isDragging = false;
        this.element.style.cursor = '';

        this.saveState();
    }

    startResizing(e) {
        e.preventDefault();
        e.stopPropagation();

        this.isResizing = true;
        this.resizeDirection = e.target.dataset.direction || 'se';

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        const rect = this.element.getBoundingClientRect();
        const workspace = this.getWorkspaceRect();
        const workspaceRect = workspace || { left: 0, top: 0 };

        this.resizeStartX = clientX;
        this.resizeStartY = clientY;
        this.resizeStartWidth = rect.width;
        this.resizeStartHeight = rect.height;
        this.resizeStartLeft = rect.left - workspaceRect.left;
        this.resizeStartTop = rect.top - workspaceRect.top;

        // Create resize overlay for smoother interaction
        this.createResizeOverlay(this.getCursorForDirection(this.resizeDirection));

        // Capture pointer on the handle
        if (e.target && e.target.setPointerCapture && e.pointerId != null) {
            e.target.setPointerCapture(e.pointerId);
        }
    }

    handleResize(e) {
        if (!this.isResizing) return;

        e.preventDefault();

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        const deltaX = clientX - this.resizeStartX;
        const deltaY = clientY - this.resizeStartY;

        let newWidth = this.resizeStartWidth;
        let newHeight = this.resizeStartHeight;
        let newLeft = this.resizeStartLeft;
        let newTop = this.resizeStartTop;

        const dir = this.resizeDirection;

        // Calculate new dimensions based on direction
        if (dir.includes('e')) newWidth = this.resizeStartWidth + deltaX;
        if (dir.includes('w')) {
            newWidth = this.resizeStartWidth - deltaX;
            newLeft = this.resizeStartLeft + deltaX;
        }
        if (dir.includes('s')) newHeight = this.resizeStartHeight + deltaY;
        if (dir.includes('n')) {
            newHeight = this.resizeStartHeight - deltaY;
            newTop = this.resizeStartTop + deltaY;
        }

        // Apply constraints
        const workspace = this.getWorkspaceRect();
        const maxWidth = workspace ? workspace.width - 20 : window.innerWidth - 20;
        const maxHeight = workspace ? workspace.height - 20 : window.innerHeight - 20;

        newWidth = Math.max(this.options.minWidth, Math.min(newWidth, maxWidth));
        newHeight = Math.max(this.options.minHeight, Math.min(newHeight, maxHeight));

        // Keep position within bounds when resizing from left/top
        if (dir.includes('w')) {
            const minLeft = 0;
            const maxLeft = workspace ? workspace.width - this.options.minWidth : window.innerWidth - this.options.minWidth;
            newLeft = Math.max(minLeft, Math.min(newLeft, maxLeft));
            // Adjust width if position was clamped
            newWidth = this.resizeStartLeft + this.resizeStartWidth - newLeft;
        }
        if (dir.includes('n')) {
            const minTop = 0;
            const maxTop = workspace ? workspace.height - this.options.minHeight : window.innerHeight - this.options.minHeight;
            newTop = Math.max(minTop, Math.min(newTop, maxTop));
            // Adjust height if position was clamped
            newHeight = this.resizeStartTop + this.resizeStartHeight - newTop;
        }

        // Apply grid snapping if enabled
        if (this.options.gridSnapEnabled && this.options.gridSize > 0) {
            const origin = this.getGridOrigin();
            // Snap dimensions to grid
            newWidth = Math.round(newWidth / this.options.gridSize) * this.options.gridSize;
            newHeight = Math.round(newHeight / this.options.gridSize) * this.options.gridSize;
            // Snap position relative to grid origin
            const relativeLeft = newLeft - origin.left;
            const relativeTop = newTop - origin.top;
            newLeft = origin.left + Math.round(relativeLeft / this.options.gridSize) * this.options.gridSize;
            newTop = origin.top + Math.round(relativeTop / this.options.gridSize) * this.options.gridSize;
        }

        this.currentWidth = newWidth;
        this.currentHeight = newHeight;
        this.currentLeft = newLeft;
        this.currentTop = newTop;

        this.applyGeometry();
    }

    stopResizing(e) {
        if (!this.isResizing) return;

        this.removeResizeOverlay();
        this.isResizing = false;
        this.resizeDirection = null;

        this.saveState();
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
        overlay.className = 'grid-object-resize-overlay';
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

    getGridOrigin() {
        const contentArea = this.getContentAreaElement();
        if (!contentArea) {
            return { left: 0, top: 0 };
        }
        const rect = contentArea.getBoundingClientRect();
        return { left: rect.left, top: rect.top };
    }

    applyGeometry() {
        this.element.style.left = `${this.currentLeft}px`;
        this.element.style.top = `${this.currentTop}px`;
        this.element.style.width = `${this.currentWidth}px`;
        this.element.style.height = `${this.currentHeight}px`;
    }

    getWorkspaceRect() {
        const workspace = document.querySelector('xavi-multi-grid');
        if (workspace && typeof workspace.getGridDimensions === 'function') {
            // Prefer the floating panel layer bounds, since GridObject-managed
            // panels are typically attached there and it excludes the taskbar.
            if (typeof workspace.getFloatingLayer === 'function') {
                const layer = workspace.getFloatingLayer();
                if (layer && typeof layer.getBoundingClientRect === 'function') {
                    const rect = layer.getBoundingClientRect();
                    return {
                        left: rect.left,
                        top: rect.top,
                        width: rect.width,
                        height: rect.height,
                        right: rect.right,
                        bottom: rect.bottom
                    };
                }
            }

            const dims = workspace.getGridDimensions();
            if (dims) return dims;
        }

        const contentArea = this.getContentAreaElement();
        if (contentArea) {
            return contentArea.getBoundingClientRect();
        }

        const fallback = document.getElementById('xavi-grid-container');
        if (fallback) {
            return fallback.getBoundingClientRect();
        }

        return {
            left: 0,
            top: 0,
            width: window.innerWidth || 0,
            height: window.innerHeight || 0
        };
    }

    getContentAreaElement() {
        const workspace = document.querySelector('xavi-multi-grid');
        if (workspace) {
            if (typeof workspace.getContentArea === 'function') {
                const area = workspace.getContentArea();
                if (area) {
                    return area;
                }
            }
            if (workspace.shadowRoot) {
                const shadowArea = workspace.shadowRoot.getElementById('content-area');
                if (shadowArea) {
                    return shadowArea;
                }
            }
        }

        const taskbar = document.querySelector('panel-taskbar');
        if (taskbar && taskbar.workspace) {
            if (typeof taskbar.workspace.getContentArea === 'function') {
                const area = taskbar.workspace.getContentArea();
                if (area) {
                    return area;
                }
            }
        }

        return document.getElementById('content-area') || null;
    }

    saveState() {
        if (!this.options.saveStateKey) return;

        const state = {
            left: this.currentLeft,
            top: this.currentTop,
            width: this.currentWidth,
            height: this.currentHeight
        };

        localStorage.setItem(this.options.saveStateKey, JSON.stringify(state));
    }

    loadState() {
        if (!this.options.saveStateKey) {
            // No save key, use smart spawn positioning
            this.applySmartSpawnPosition();
            return;
        }

        const savedState = localStorage.getItem(this.options.saveStateKey);
        if (!savedState) {
            // No saved state, use smart spawn positioning
            this.applySmartSpawnPosition();
            return;
        }

        try {
            const state = JSON.parse(savedState);
            this.currentLeft = state.left || 0;
            this.currentTop = state.top || 0;
            this.currentWidth = state.width || this.options.defaultWidth;
            this.currentHeight = state.height || this.options.defaultHeight;
        } catch (e) {
            console.warn('Failed to load grid object state:', e);
            this.applySmartSpawnPosition();
        }
    }

    applySmartSpawnPosition() {
        const workspace = this.getWorkspaceRect();
        if (!workspace) {
            this.currentLeft = 40;
            this.currentTop = 40;
            return;
        }

        const gridSize = this.options.gridSize;
        const padding = gridSize * 2;
        const thirdWidth = Math.floor(workspace.width / 3);
        
        // Get all existing grid panels
        const existingPanels = this.getExistingGridPanels();
        
        // Determine which third to spawn in (left, center, right)
        const thirds = ['left', 'center', 'right'];
        let selectedThird = null;
        
        // Try each third in order
        for (const third of thirds) {
            let thirdLeft = padding;
            if (third === 'center') {
                thirdLeft = thirdWidth + padding;
            } else if (third === 'right') {
                thirdLeft = thirdWidth * 2 + padding;
            }
            
            const thirdRight = thirdLeft + thirdWidth - (padding * 2);
            
            // Check if this third is free
            let thirdOccupied = false;
            for (const panel of existingPanels) {
                if (panel === this.element) continue;
                
                const panelLeft = parseFloat(panel.style.left) || 0;
                const panelRight = panelLeft + (panel.getBoundingClientRect().width || 0);
                
                // Check if panel is in this third
                if ((panelLeft >= thirdLeft && panelLeft < thirdRight) ||
                    (panelRight > thirdLeft && panelRight <= thirdRight) ||
                    (panelLeft <= thirdLeft && panelRight >= thirdRight)) {
                    thirdOccupied = true;
                    break;
                }
            }
            
            if (!thirdOccupied) {
                selectedThird = third;
                break;
            }
        }
        
        // If all thirds are occupied, cascade in the left third
        if (!selectedThird) {
            selectedThird = 'left';
        }
        
        // Calculate position within the selected third
        let targetLeft = padding;
        if (selectedThird === 'center') {
            targetLeft = thirdWidth + padding;
        } else if (selectedThird === 'right') {
            targetLeft = thirdWidth * 2 + padding;
        }
        
        const targetWidth = thirdWidth - (padding * 2);
        const targetHeight = workspace.height - (padding * 2);
        
        // Snap to grid
        this.currentLeft = Math.round(targetLeft / gridSize) * gridSize;
        this.currentTop = Math.round(padding / gridSize) * gridSize;
        this.currentWidth = Math.round(targetWidth / gridSize) * gridSize;
        this.currentHeight = Math.round(targetHeight / gridSize) * gridSize;
        
        // Ensure within bounds
        this.currentLeft = Math.max(0, Math.min(this.currentLeft, workspace.width - this.currentWidth));
        this.currentTop = Math.max(0, Math.min(this.currentTop, workspace.height - this.currentHeight));
    }

    getExistingGridPanels() {
        const panels = [];
        const workspace = document.querySelector('xavi-multi-grid');
        
        if (workspace) {
            // Look in floating layer
            if (typeof workspace.getFloatingLayer === 'function') {
                const layer = workspace.getFloatingLayer();
                if (layer) {
                    const elements = layer.querySelectorAll('[style*="position: absolute"]');
                    panels.push(...elements);
                }
            }
            
            // Look in shadow root
            if (workspace.shadowRoot) {
                const elements = workspace.shadowRoot.querySelectorAll('[style*="position: absolute"]');
                panels.push(...elements);
            }
        }
        
        // Look in document body
        const bodyPanels = document.querySelectorAll('media-search-panel, video-player-panel, [style*="position: absolute"]');
        panels.push(...bodyPanels);
        
        return panels;
    }

    toggleGridSnap() {
        this.options.gridSnapEnabled = !this.options.gridSnapEnabled;
        return this.options.gridSnapEnabled;
    }

    setGridSnap(enabled) {
        this.options.gridSnapEnabled = enabled;
    }

    destroy() {
        // Remove resize overlay if present
        this.removeResizeOverlay();
        
        // Remove event listeners
        document.removeEventListener('mousemove', this.boundDragHandler);
        document.removeEventListener('mouseup', this.boundStopDragHandler);
        document.removeEventListener('mousemove', this.boundResizeHandler);
        document.removeEventListener('mouseup', this.boundStopResizeHandler);
        document.removeEventListener('touchmove', this.boundDragHandler);
        document.removeEventListener('touchend', this.boundStopDragHandler);
        document.removeEventListener('touchmove', this.boundResizeHandler);
        document.removeEventListener('touchend', this.boundStopResizeHandler);
    }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.GridObject = GridObject;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GridObject;
}
