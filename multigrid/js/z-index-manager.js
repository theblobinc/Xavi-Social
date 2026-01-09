// z-index-manager.js
// Centralized z-index management for the entire application

class ZIndexManager {
    constructor() {
        // Define z-index layers (ranges)
        this.layers = {
            // Layer 0: Base workspace elements (0-999)
            MAP_BACKGROUND: 0,
            WORKSPACE_GRID: 1,
            WORKSPACE_OVERLAY: 10,
            MAP_CONTROLS: 100,
            
            // Layer 1: Grid items and panels (1000-2499)
            GRID_ITEMS_BASE: 1000,
            GRID_PANELS_BASE: 1400,
            GRID_PANELS_MAX: 2499,
            
            // Layer 2: Playlist visualizer (2500-2999)
            PLAYLIST_OVERLAY: 2500,
            PLAYLIST_TAB: 2510,
            PLAYLIST_CONTROLS: 2520,
            
            // Layer 3: Music player popups (3000-3999)
            MUSIC_MINI_PLAYER: 3000,
            MUSIC_EXPANDED_PLAYER: 3100,
            MUSIC_CONTROLS: 3200,
            VIDEO_DOCK: 3300,
            
            // Layer 4: Taskbar and system UI (10000+)
            TASKBAR_BASE: 10000,
            TASKBAR_MENUS: 10100,
            TASKBAR_POPUPS: 10200,
            SYSTEM_MODALS: 10300,
            
            // Overlays and special elements
            RESIZE_OVERLAY: 10001,
            DEBUG_OVERLAY: 9999
        };

        // Counter for each dynamic layer
        this.counters = {
            gridPanels: this.layers.GRID_PANELS_BASE
        };
    }

    /**
     * Get a z-index value for a specific layer
     * @param {string} layerName - Name of the layer from this.layers
     * @returns {number} z-index value
     */
    get(layerName) {
        if (this.layers.hasOwnProperty(layerName)) {
            return this.layers[layerName];
        }
        console.warn(`ZIndexManager: Unknown layer "${layerName}"`);
        return 1;
    }

    /**
     * Get next z-index for grid panels (auto-incrementing)
     * @returns {number} z-index value
     */
    getNextGridPanel() {
        if (this.counters.gridPanels >= this.layers.GRID_PANELS_MAX) {
            // Reset if we hit max
            this.counters.gridPanels = this.layers.GRID_PANELS_BASE;
        }
        this.counters.gridPanels += 1;
        return this.counters.gridPanels;
    }

    /**
     * Bring a grid panel to the front
     * @param {HTMLElement} element - The panel element
     */
    bringGridPanelToFront(element) {
        if (!element) return;
        element.style.zIndex = String(this.getNextGridPanel());
    }

    /**
     * Send a grid panel behind other panels (but keep it visible)
     * @param {HTMLElement} element - The panel element
     */
    sendGridPanelToBack(element) {
        if (!element) return;
        // Use the base of the grid panel range so other panels (with higher z)
        // naturally remain above it.
        element.style.zIndex = String(this.layers.GRID_PANELS_BASE);
    }

    /**
     * Apply z-index to an element
     * @param {HTMLElement} element - The element to style
     * @param {string} layerName - Name of the layer
     */
    apply(element, layerName) {
        if (!element) return;
        const zIndex = this.get(layerName);
        element.style.zIndex = String(zIndex);
    }

    /**
     * Get z-index configuration from module.json
     * @param {object} moduleConfig - Module configuration object
     * @returns {number|null} z-index value or null
     */
    getModuleZIndex(moduleConfig) {
        if (moduleConfig && moduleConfig.zIndex) {
            if (typeof moduleConfig.zIndex === 'number') {
                return moduleConfig.zIndex;
            }
            // Support layer name references
            if (typeof moduleConfig.zIndex === 'string') {
                return this.get(moduleConfig.zIndex);
            }
        }
        return null;
    }

    /**
     * Reset all counters
     */
    reset() {
        this.counters.gridPanels = this.layers.GRID_PANELS_BASE;
    }

    /**
     * Get all layer definitions as a CSS custom properties object
     * @returns {object} CSS custom properties
     */
    toCSSVariables() {
        const vars = {};
        for (const [name, value] of Object.entries(this.layers)) {
            const cssName = `--z-${name.toLowerCase().replace(/_/g, '-')}`;
            vars[cssName] = value;
        }
        return vars;
    }

    /**
     * Inject CSS variables into document
     */
    injectCSSVariables() {
        const root = document.documentElement;
        for (const [name, value] of Object.entries(this.layers)) {
            const cssName = `--z-${name.toLowerCase().replace(/_/g, '-')}`;
            root.style.setProperty(cssName, String(value));
        }
    }
}

// Create singleton instance
const zIndexManager = new ZIndexManager();

// Export for use in modules
if (typeof window !== 'undefined') {
    window.ZIndexManager = zIndexManager;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = zIndexManager;
}
