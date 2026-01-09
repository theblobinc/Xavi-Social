(function registerPanelRegistry() {
    if (typeof window === 'undefined') {
        return;
    }

    if (window.XaviPanelRegistry) {
        return;
    }

    class PanelRegistry {
        constructor() {
            this.entries = new Map();
        }

        normalize(entry) {
            if (!entry || typeof entry !== 'object') {
                throw new Error('Panel entry must be an object.');
            }

            const id = String(entry.id || '').trim();
            if (!id) {
                throw new Error('Panel entry requires a stable id.');
            }

            const label = String(entry.label || '').trim();
            if (!label) {
                throw new Error('Panel entry requires a label.');
            }

            const normalized = {
                id,
                label,
                icon: entry.icon || '',
                category: entry.category || 'Panels',
                priority: Number.isFinite(entry.priority) ? entry.priority : 0,
                requiresAdmin: Boolean(entry.requiresAdmin),
                description: entry.description ? String(entry.description) : '',
                launch: typeof entry.launch === 'function' ? entry.launch : null,
                component: entry.component || null,
                attributes: entry.attributes || null,
                maxInstances: Number.isFinite(entry.maxInstances) && entry.maxInstances > 0 ? entry.maxInstances : 1,
                taskviewConfig: (entry.taskviewConfig && typeof entry.taskviewConfig === 'object')
                    ? entry.taskviewConfig
                    : ((entry.taskview && typeof entry.taskview === 'object') ? entry.taskview : null)
            };

            if (!normalized.launch && normalized.component) {
                normalized.launch = (context = {}) => {
                    const element = document.createElement(normalized.component);
                    if (normalized.attributes) {
                        Object.entries(normalized.attributes).forEach(([key, value]) => {
                            if (value === false || value === null || typeof value === 'undefined') {
                                return;
                            }
                            if (value === true) {
                                element.setAttribute(key, '');
                            } else {
                                element.setAttribute(key, String(value));
                            }
                        });
                    }
                    this.attachPanelElement(element, context);
                    return element;
                };
            }

            if (!normalized.launch) {
                throw new Error(`Panel entry "${id}" must provide a launch function or component.`);
            }

            return normalized;
        }

        attachPanelElement(element, context = {}) {
            if (!element) {
                return;
            }
            const workspace = context.workspace || document.querySelector('xavi-multi-grid');
            if (workspace && typeof workspace.attachFloatingPanel === 'function') {
                workspace.attachFloatingPanel(element);
                return;
            }
            const host = this.resolveHostElement(context, workspace);
            host.appendChild(element);
        }

        resolveHostElement(context = {}, workspace = null) {
            if (context.hostElement) {
                return context.hostElement;
            }
            const resolvedWorkspace = workspace || context.workspace || document.querySelector('xavi-multi-grid');
            if (resolvedWorkspace) {
                if (typeof resolvedWorkspace.getFloatingLayer === 'function') {
                    const layer = resolvedWorkspace.getFloatingLayer();
                    if (layer) {
                        return layer;
                    }
                }
                if (resolvedWorkspace.shadowRoot) {
                    return resolvedWorkspace.shadowRoot;
                }
                return resolvedWorkspace;
            }
            return document.body || document.documentElement;
        }

        register(entry) {
            const normalized = this.normalize(entry);
            this.entries.set(normalized.id, normalized);
            window.dispatchEvent(new CustomEvent('xavi-panel-entry-registered', {
                detail: { panel: normalized }
            }));
            return normalized;
        }

        unregister(id) {
            if (!id || !this.entries.has(id)) {
                return false;
            }
            const panel = this.entries.get(id);
            this.entries.delete(id);
            window.dispatchEvent(new CustomEvent('xavi-panel-entry-unregistered', {
                detail: { panel }
            }));
            return true;
        }

        list() {
            return Array.from(this.entries.values()).sort((a, b) => {
                if (a.priority !== b.priority) {
                    return b.priority - a.priority;
                }
                return a.label.localeCompare(b.label);
            });
        }
    }

    const registry = new PanelRegistry();
    window.XaviPanelRegistry = registry;
    window.registerTaskbarPanel = (entry) => registry.register(entry);
    window.unregisterTaskbarPanel = (id) => registry.unregister(id);

    window.dispatchEvent(new CustomEvent('xavi-panel-registry-ready', {
        detail: { registry }
    }));
})();
