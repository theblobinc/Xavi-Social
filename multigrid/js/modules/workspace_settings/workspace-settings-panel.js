(function registerWorkspaceSettingsPanel() {
  'use strict';

  if (typeof window === 'undefined') return;

  const PANEL_ID = 'workspace-settings';

  const STORAGE_KEYS = {
    tab: 'xavi.workspaceSettings.activeTab',
    streamMode: 'xavi.workspaceSettings.streamMode',
    jetstreamUrl: 'xavi.workspaceSettings.jetstreamUrl',
    firehoseUrl: 'xavi.workspaceSettings.firehoseUrl',
    debugTabPanelGuard: 'xavi.debug.tabPanelGuard',
    theme: 'xavi.theme',
    socialProfileSettingsInSettings: 'xaviSocial.profileSettingsInSettings'
  };

  function dispatchWorkspaceSettingsChanged(detail = {}) {
    try {
      window.dispatchEvent(new CustomEvent('xavi:workspace-settings-change', { detail }));
    } catch (e) {
      // ignore
    }
  }

  function removeKeysByPrefixes(prefixes) {
    try {
      const ls = window.localStorage;
      if (!ls || typeof ls.length !== 'number') return 0;
      const toRemove = [];
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (!k) continue;
        if (prefixes.some((p) => k.startsWith(p))) {
          toRemove.push(k);
        }
      }
      toRemove.forEach((k) => {
        try {
          ls.removeItem(k);
        } catch (e) {
          // ignore
        }
      });
      return toRemove.length;
    } catch (e) {
      return 0;
    }
  }

  function safeGet(key, fallback = '') {
    try {
      const v = window.localStorage?.getItem?.(key);
      return v == null ? fallback : String(v);
    } catch (e) {
      return fallback;
    }
  }

  function safeSet(key, value) {
    try {
      window.localStorage?.setItem?.(key, String(value));
    } catch (e) {
      // ignore
    }
  }

  function getColumnWidth() {
    const workspace = document.getElementById('xavi-workspace') || document.querySelector('xavi-multi-grid');
    let raw = '';
    try {
      raw = workspace?.style?.getPropertyValue?.('--xavi-col-w') || '';
    } catch (e) {
      raw = '';
    }
    if (!raw) {
      try {
        raw = (typeof getComputedStyle === 'function' && workspace)
          ? (getComputedStyle(workspace).getPropertyValue('--xavi-col-w') || '')
          : '';
      } catch (e) {
        raw = '';
      }
    }
    const parsed = parseInt(String(raw || '').trim().replace('px', ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 350;
  }

  function getWorkspaceRect(workspace = null) {
    const ws = workspace || document.getElementById('xavi-workspace') || document.querySelector('xavi-multi-grid');
    const host = ws?.shadowRoot?.host || ws;
    try {
      return host?.getBoundingClientRect?.() || null;
    } catch (e) {
      return null;
    }
  }

  function suggestSpan(workspace = null) {
    const colW = getColumnWidth();
    const rect = getWorkspaceRect(workspace);
    const cols = rect ? Math.max(1, Math.floor(rect.width / colW)) : 3;
    return cols >= 5 ? 2 : 1;
  }

  function suggestStart(span, workspace = null) {
    const colW = getColumnWidth();
    const rect = getWorkspaceRect(workspace);
    const cols = rect ? Math.max(1, Math.floor(rect.width / colW)) : 3;
    if (cols >= 5 && span >= 2) return 0;
    return 0;
  }

  function createTabs() {
    return [
      { id: 'streams', label: 'Streams' },
      { id: 'multigrid', label: 'Multi‑Grid' },
      { id: 'about', label: 'About' }
    ];
  }

  function createSettingsContent() {
    const wrapper = document.createElement('div');
    wrapper.className = 'xavi-workspace-settings';

    wrapper.innerHTML = `
      <style>
        .xavi-workspace-settings{
          height: 100%;
          display:flex;
          flex-direction:column;
          min-height:0;
          font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;
          color: rgba(255,255,255,0.92);
        }
        .xws-top{
          display:flex;
          align-items:center;
          justify-content:space-between;
          padding: 10px 12px;
          border-bottom:1px solid rgba(255,255,255,0.10);
          background: rgba(255,255,255,0.04);
          gap: 10px;
        }
        .xws-title{font-weight:600; font-size: 14px;}
        .xws-tabs{display:flex; gap:8px; flex-wrap:wrap;}
        .xws-tab{
          border:1px solid rgba(255,255,255,0.14);
          background: rgba(0,0,0,0.18);
          color: rgba(255,255,255,0.92);
          border-radius: 999px;
          padding: 6px 10px;
          cursor:pointer;
          font-size: 12px;
        }
        .xws-tab[aria-selected="true"]{background: rgba(255,255,255,0.14);}
        .xws-body{flex:1 1 auto; min-height:0; overflow:auto; padding: 12px;}
        .xws-section{max-width: 920px;}
        .xws-card{
          border:1px solid rgba(255,255,255,0.12);
          background: rgba(0,0,0,0.18);
          border-radius: 10px;
          padding: 12px;
          margin-bottom: 12px;
        }
        .xws-row{display:flex; gap:10px; align-items:center; flex-wrap:wrap;}
        label{font-size: 12px; color: rgba(255,255,255,0.80);}
        input[type="text"]{
          width: min(720px, 100%);
          height: 32px;
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.18);
          background: rgba(0,0,0,0.20);
          color: rgba(255,255,255,0.92);
          padding: 0 10px;
          outline: none;
        }
        .xws-hint{font-size: 12px; color: rgba(255,255,255,0.65); line-height:1.35;}
        .xws-actions{display:flex; gap:8px; align-items:center;}
        .xws-btn{
          height: 32px;
          padding: 0 10px;
          border-radius: 8px;
          border: 0;
          background: rgba(255,255,255,0.12);
          color: rgba(255,255,255,0.92);
          cursor: pointer;
        }
        .xws-btn:hover{background: rgba(255,255,255,0.18);}
        .xws-status{margin-top:10px; font-size: 12px; color: rgba(255,255,255,0.75);}
      </style>

      <div class="xws-top">
        <div class="xws-title">Settings</div>
        <div class="xws-tabs" role="tablist" aria-label="Settings tabs"></div>
      </div>
      <div class="xws-body" id="xws-body"></div>
    `;

    const tabsEl = wrapper.querySelector('.xws-tabs');
    const bodyEl = wrapper.querySelector('#xws-body');

    const tabs = createTabs();

    function renderTab(tabId) {
      safeSet(STORAGE_KEYS.tab, tabId);
      tabsEl.querySelectorAll('button[data-tab]').forEach((b) => {
        b.setAttribute('aria-selected', b.getAttribute('data-tab') === tabId ? 'true' : 'false');
      });

      bodyEl.innerHTML = '';
      const section = document.createElement('div');
      section.className = 'xws-section';

      const status = document.createElement('div');
      status.className = 'xws-status';
      const setStatus = (msg) => {
        status.textContent = msg ? String(msg) : '';
      };

      if (tabId === 'streams') {
        const mode = (safeGet(STORAGE_KEYS.streamMode, 'jetstream') || 'jetstream').toLowerCase();
        const jetstreamUrl = safeGet(STORAGE_KEYS.jetstreamUrl, '');
        const firehoseUrl = safeGet(STORAGE_KEYS.firehoseUrl, '');

        section.innerHTML = `
          <div class="xws-card">
            <div style="font-weight:600; margin-bottom:6px;">Stream Mode</div>
            <div class="xws-hint">Choose which stream backend the app should use. This only stores a preference for now; modules can read it from localStorage.</div>
            <div class="xws-row" style="margin-top:10px;">
              <label><input type="radio" name="streamMode" value="jetstream" ${mode === 'jetstream' ? 'checked' : ''}/> Jetstream</label>
              <label><input type="radio" name="streamMode" value="firehose" ${mode === 'firehose' ? 'checked' : ''}/> Firehose</label>
            </div>
          </div>

          <div class="xws-card">
            <div style="font-weight:600; margin-bottom:6px;">Jetstream</div>
            <div class="xws-hint">Optional URL override (leave blank to use defaults).</div>
            <div class="xws-row" style="margin-top:10px;">
              <input type="text" id="jetstreamUrl" placeholder="wss://… or https://…" value="${escapeHtml(jetstreamUrl)}" />
              <div class="xws-actions">
                <button class="xws-btn" type="button" data-action="save-jetstream">Save</button>
              </div>
            </div>
          </div>

          <div class="xws-card">
            <div style="font-weight:600; margin-bottom:6px;">Firehose</div>
            <div class="xws-hint">Optional URL override (leave blank to use defaults).</div>
            <div class="xws-row" style="margin-top:10px;">
              <input type="text" id="firehoseUrl" placeholder="wss://…" value="${escapeHtml(firehoseUrl)}" />
              <div class="xws-actions">
                <button class="xws-btn" type="button" data-action="save-firehose">Save</button>
              </div>
            </div>
          </div>
        `;

        section.addEventListener('change', (e) => {
          const t = e.target;
          if (t && t.name === 'streamMode') {
            safeSet(STORAGE_KEYS.streamMode, t.value);
            dispatchWorkspaceSettingsChanged({ key: STORAGE_KEYS.streamMode, value: t.value });
          }
        });

        section.addEventListener('click', (e) => {
          const btn = e.target?.closest?.('button[data-action]');
          if (!btn) return;
          const action = btn.getAttribute('data-action');
          if (action === 'save-jetstream') {
            const v = section.querySelector('#jetstreamUrl')?.value || '';
            safeSet(STORAGE_KEYS.jetstreamUrl, v);
            dispatchWorkspaceSettingsChanged({ key: STORAGE_KEYS.jetstreamUrl, value: v });
          }
          if (action === 'save-firehose') {
            const v = section.querySelector('#firehoseUrl')?.value || '';
            safeSet(STORAGE_KEYS.firehoseUrl, v);
            dispatchWorkspaceSettingsChanged({ key: STORAGE_KEYS.firehoseUrl, value: v });
          }
        });
      } else if (tabId === 'multigrid') {
        const theme = (safeGet(STORAGE_KEYS.theme, 'system') || 'system').toLowerCase();
        const themeSystem = theme !== 'dark' && theme !== 'light' ? 'system' : theme;
        const guardEnabled = safeGet(STORAGE_KEYS.debugTabPanelGuard, '0');
        const profileInSettings = safeGet(STORAGE_KEYS.socialProfileSettingsInSettings, '0');
        section.innerHTML = `
          <div class="xws-card">
            <div style="font-weight:600; margin-bottom:6px;">Multi‑Grid</div>
            <div class="xws-hint">Practical workspace utilities and debug toggles.</div>

            <div style="font-weight:600; margin-top:12px; margin-bottom:6px;">Theme</div>
            <div class="xws-hint">Controls the Social SPA theme and any listeners watching <code>xavi.theme</code>.</div>
            <div class="xws-row" style="margin-top:10px;">
              <label><input type="radio" name="xaviTheme" value="system" ${themeSystem === 'system' ? 'checked' : ''}/> System</label>
              <label><input type="radio" name="xaviTheme" value="dark" ${themeSystem === 'dark' ? 'checked' : ''}/> Dark</label>
              <label><input type="radio" name="xaviTheme" value="light" ${themeSystem === 'light' ? 'checked' : ''}/> Light</label>
            </div>

            <div style="font-weight:600; margin-top:12px; margin-bottom:6px;">Social</div>
            <div class="xws-row" style="margin-top:10px;">
              <label>
                <input type="checkbox" id="profileSettingsInSettings" ${['1','true','yes','on'].includes(String(profileInSettings).toLowerCase()) ? 'checked' : ''} />
                Profile settings live in Settings panel
              </label>
            </div>
            <div class="xws-hint" style="margin-top:8px;">Stored at <code>${STORAGE_KEYS.socialProfileSettingsInSettings}</code> (legacy toggle from the old overlay).</div>

            <div class="xws-row" style="margin-top:10px;">
              <label>
                <input type="checkbox" id="debugTabPanelGuard" ${['1','true','yes','on'].includes(String(guardEnabled).toLowerCase()) ? 'checked' : ''} />
                Enable debug tab‑panel guard
              </label>
            </div>
            <div class="xws-hint" style="margin-top:8px;">When enabled, the workspace will log/remove any legacy <code>.tab-panel</code> injections. Reload recommended.</div>
          </div>

          <div class="xws-card">
            <div style="font-weight:600; margin-bottom:6px;">Layout Reset</div>
            <div class="xws-hint">If a panel disappears (saved off-screen), clear saved column panel positions.</div>
            <div class="xws-row" style="margin-top:10px;">
              <button class="xws-btn" type="button" data-action="reset-column-panels">Reset column panel layout</button>
            </div>
            <div class="xws-hint" style="margin-top:8px;">This clears localStorage keys with prefix <code>panel.column.v2.</code>. Reload after reset.</div>
          </div>
        `;

        section.addEventListener('change', (e) => {
          const t = e.target;
          if (t && t.name === 'xaviTheme') {
            const raw = String(t.value || '').toLowerCase();
            const next = raw === 'dark' || raw === 'light' ? raw : 'system';
            safeSet(STORAGE_KEYS.theme, next);
            try {
              window.dispatchEvent(new CustomEvent('xavi:theme-change', { detail: { theme: next } }));
            } catch (err) {
              // ignore
            }
            setStatus('Saved theme.');
            return;
          }
          if (t && t.id === 'profileSettingsInSettings') {
            safeSet(STORAGE_KEYS.socialProfileSettingsInSettings, t.checked ? '1' : '0');
            setStatus('Saved.');
            return;
          }
          if (t && t.id === 'debugTabPanelGuard') {
            safeSet(STORAGE_KEYS.debugTabPanelGuard, t.checked ? '1' : '0');
            setStatus('Saved. Reload to apply.');
          }
        });

        section.addEventListener('click', (e) => {
          const btn = e.target?.closest?.('button[data-action]');
          if (!btn) return;
          const action = btn.getAttribute('data-action');
          if (action === 'reset-column-panels') {
            const cleared = removeKeysByPrefixes(['panel.column.v2.']);
            setStatus(`Reset complete: removed ${cleared} saved panel entr${cleared === 1 ? 'y' : 'ies'}. Reload recommended.`);
          }
        });
      } else {
        section.innerHTML = `
          <div class="xws-card">
            <div style="font-weight:600; margin-bottom:6px;">About</div>
            <div class="xws-hint">Workspace Settings module. Stored prefs:
              <div style="margin-top:6px;">- ${STORAGE_KEYS.streamMode}</div>
              <div>- ${STORAGE_KEYS.jetstreamUrl}</div>
              <div>- ${STORAGE_KEYS.firehoseUrl}</div>
              <div>- ${STORAGE_KEYS.theme}</div>
              <div>- ${STORAGE_KEYS.socialProfileSettingsInSettings}</div>
            </div>
          </div>
        `;
      }

      bodyEl.appendChild(section);
      bodyEl.appendChild(status);
    }

    tabs.forEach((t) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'xws-tab';
      btn.textContent = t.label;
      btn.setAttribute('data-tab', t.id);
      btn.setAttribute('role', 'tab');
      btn.addEventListener('click', () => renderTab(t.id));
      tabsEl.appendChild(btn);
    });

    const initial = safeGet(STORAGE_KEYS.tab, 'streams') || 'streams';
    renderTab(tabs.some((t) => t.id === initial) ? initial : 'streams');

    return wrapper;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function findExistingPanel(context = {}) {
    const workspace = context.workspace || document.getElementById('xavi-workspace') || document.querySelector('xavi-multi-grid');
    const roots = [];
    if (workspace) {
      if (workspace.shadowRoot) roots.push(workspace.shadowRoot);
      if (typeof workspace.getFloatingLayer === 'function') {
        const layer = workspace.getFloatingLayer();
        if (layer) roots.push(layer);
      }
      roots.push(workspace);
    }
    roots.push(document);

    for (const root of roots) {
      if (!root || typeof root.querySelector !== 'function') continue;
      const colMatch = root.querySelector(`xavi-column-panel[panel-id="${PANEL_ID}"]`);
      if (colMatch) return colMatch;
    }
    return null;
  }

  function spawnWorkspaceSettingsPanel(options = {}) {
    const context = options.context || {};

    const existing = findExistingPanel(context);
    if (existing) {
      existing.hidden = false;
      existing.style.display = 'block';
      existing.bringToFront?.();
      return existing;
    }

    if (window.XaviColumnPanels && typeof window.XaviColumnPanels.openPanel === 'function') {
      const span = suggestSpan(context.workspace || null);
      const start = suggestStart(span, context.workspace || null);
      return window.XaviColumnPanels.openPanel({
        workspace: context.workspace || null,
        id: PANEL_ID,
        title: 'Settings',
        colStart: start,
        colSpan: span,
        buildContent: () => createSettingsContent()
      });
    }

    console.warn('[WorkspaceSettings] Column panels not ready yet.');
    return null;
  }

  function buildPanelEntry() {
    return {
      id: PANEL_ID,
      label: 'Settings',
      icon: '⚙️',
      category: 'System',
      priority: 100,
      requiresAdmin: false,
      maxInstances: 1,
      launch: (context = {}) => spawnWorkspaceSettingsPanel({ context })
    };
  }

  function registerNow() {
    try {
      if (typeof window.registerTaskbarPanel === 'function') {
        window.registerTaskbarPanel(buildPanelEntry());
        return true;
      }
      if (window.XaviPanelRegistry && typeof window.XaviPanelRegistry.register === 'function') {
        window.XaviPanelRegistry.register(buildPanelEntry());
        return true;
      }
    } catch (e) {
      console.warn('[WorkspaceSettings] Failed to register panel:', e);
    }
    return false;
  }

  if (!registerNow()) {
    window.addEventListener('xavi-panel-registry-ready', () => {
      registerNow();
    }, { once: true });
  }

  window.spawnWorkspaceSettingsPanel = spawnWorkspaceSettingsPanel;
})();
