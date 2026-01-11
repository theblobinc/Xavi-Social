(function registerSocialPdsPanel() {
  'use strict';

  if (typeof window === 'undefined') return;

  function openPdsPanel(context = {}) {
    if (!window.XaviColumnPanels || typeof window.XaviColumnPanels.openPanel !== 'function') {
      console.warn('[SocialPDS] Column panels not ready yet.');
      return null;
    }

    return window.XaviColumnPanels.openPanel({
      workspace: context.workspace || null,
      id: 'social-pds',
      title: 'PDS Feed',
      colStart: 0,
      colSpan: 1,
      registerInTaskbar: false,
      buildContent: () => {
        const el = document.createElement('xavi-social-stream');
        el.setAttribute('stream', 'pds');
        el.style.height = '100%';
        return el;
      },
    });
  }

  function queuePanelRegistration(factory) {
    const tryRegister = () => {
      if (typeof window.registerTaskbarPanel !== 'function') return false;
      try {
        window.registerTaskbarPanel(factory());
      } catch (err) {
        console.warn('[SocialPDS] Failed to register panel:', err);
      }
      return true;
    };

    if (tryRegister()) return;
    window.addEventListener('xavi-panel-registry-ready', () => tryRegister(), { once: true });
  }

  queuePanelRegistration(() => ({
    id: 'social-pds',
    label: 'PDS Feed',
    icon: '🧾',
    category: 'Social',
    priority: 16,
    requiresAdmin: false,
    maxInstances: 3,
    launch: (context = {}) => openPdsPanel(context),
  }));
})();
