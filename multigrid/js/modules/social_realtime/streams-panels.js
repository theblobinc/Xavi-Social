(function registerSocialRealtimePanels() {
  'use strict';

  if (typeof window === 'undefined') return;

  function openPanel(id, title, stream, context = {}) {
    if (!window.XaviColumnPanels || typeof window.XaviColumnPanels.openPanel !== 'function') {
      console.warn('[SocialRealtime] Column panels not ready yet.');
      return null;
    }

    return window.XaviColumnPanels.openPanel({
      workspace: context.workspace || null,
      id,
      title,
      colStart: 0,
      colSpan: 1,
      registerInTaskbar: false,
      buildContent: () => {
        const el = document.createElement('xavi-social-stream');
        el.setAttribute('stream', stream);
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
        console.warn('[SocialRealtime] Failed to register panel:', err);
      }
      return true;
    };

    if (tryRegister()) return;
    window.addEventListener('xavi-panel-registry-ready', () => tryRegister(), { once: true });
  }

  const panels = [
    {
      id: 'social-jetstream',
      label: 'Jetstream',
      icon: '🛰️',
      title: 'Jetstream',
      stream: 'jetstream',
      priority: 17,
    },
    {
      id: 'social-firehose',
      label: 'Firehose',
      icon: '🔥',
      title: 'Firehose',
      stream: 'firehose',
      priority: 18,
    },
  ];

  panels.forEach((p) => {
    queuePanelRegistration(() => ({
      id: p.id,
      label: p.label,
      icon: p.icon,
      category: 'Social',
      priority: p.priority,
      requiresAdmin: false,
      maxInstances: 3,
      launch: (context = {}) => openPanel(p.id, p.title, p.stream, context),
    }));
  });
})();
