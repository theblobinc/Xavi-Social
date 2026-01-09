(function registerMyPlaylistPanel() {
    if (typeof window === 'undefined') {
        return;
    }

    const entryConfig = {
        id: 'media-search-myplaylist',
        label: 'My Playlist',
        icon: '⭐',
        category: 'Music',
        priority: 42,
        requiresAdmin: false,
        maxInstances: 1,
        launch: (context = {}) => spawnMyPlaylistPanel(context)
    };

    queuePanelRegistration(() => entryConfig);

    window.spawnMyPlaylistPanel = spawnMyPlaylistPanel;

    function spawnMyPlaylistPanel(context = {}) {
        if (typeof window.spawnMediaSearchPanel !== 'function') {
            console.warn('[MyPlaylistPanel] media-search panel not ready');
            return null;
        }
        return window.spawnMediaSearchPanel('myplaylist', {
            panelId: entryConfig.id,
            context
        });
    }

    function queuePanelRegistration(factory) {
        const tryRegister = () => {
            if (typeof window.registerTaskbarPanel !== 'function') {
                return false;
            }
            try {
                window.registerTaskbarPanel(factory());
            } catch (err) {
                console.warn('[MyPlaylistPanel] Failed to register panel:', err);
            }
            return true;
        };

        if (tryRegister()) {
            return;
        }

        window.addEventListener('xavi-panel-registry-ready', () => {
            tryRegister();
        }, { once: true });
    }
})();
