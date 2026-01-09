(() => {
    const STORAGE_KEY = 'pgmusic.musicVisualizerEnabled';
    const TOGGLE_EVENT = 'xavi-toggle-music-visualizer';

    function safeBoolFromStorage(key, defaultValue = false) {
        try {
            const raw = localStorage.getItem(key);
            if (raw === null) return defaultValue;
            return raw === 'true';
        } catch {
            return defaultValue;
        }
    }

    function setBoolInStorage(key, value) {
        try {
            localStorage.setItem(key, value ? 'true' : 'false');
        } catch {
            // ignore
        }
    }

    class MusicVisualizer {
        constructor() {
            this.workspace = null;
            this.bgLayer = null;
            this.container = null;
            this.canvas = null;
            this.ctx = null;
            this.raf = null;
            this.enabled = safeBoolFromStorage(STORAGE_KEY, false);
            this.isPlaying = false;
            this._unsubscribeShared = null;
            this._lastFrame = 0;

            this._onToggle = () => this.toggle();
            this._onWorkspaceReady = (event) => this.attachToWorkspace(event?.detail?.workspace);
        }

        init() {
            document.addEventListener('xavi-workspace-ready', this._onWorkspaceReady);
            window.addEventListener(TOGGLE_EVENT, this._onToggle);

            const existingWorkspace = document.querySelector('xavi-multi-grid');
            if (existingWorkspace) {
                this.attachToWorkspace(existingWorkspace);
            }
        }

        attachToWorkspace(workspace) {
            if (!workspace || this.workspace === workspace) return;
            this.workspace = workspace;
            this.bgLayer = workspace.shadowRoot?.querySelector('.xavi-bg-layer') || null;
            if (!this.bgLayer) return;

            this.ensureLayer();
            this.syncToggleLabel();
            this.setEnabled(this.enabled);
            this.bindSharedState();
        }

        ensureLayer() {
            let container = this.bgLayer.querySelector('#xavi-music-visualizer');
            if (!container) {
                container = document.createElement('div');
                container.id = 'xavi-music-visualizer';
                container.style.position = 'absolute';
                container.style.inset = '0';
                container.style.width = '100%';
                container.style.height = '100%';
                container.style.pointerEvents = 'none';
                container.style.opacity = '0';
                container.style.zIndex = '0';
                this.bgLayer.prepend(container);
            }

            let canvas = container.querySelector('canvas');
            if (!canvas) {
                canvas = document.createElement('canvas');
                canvas.width = 1;
                canvas.height = 1;
                canvas.style.width = '100%';
                canvas.style.height = '100%';
                canvas.style.display = 'block';
                container.appendChild(canvas);
            }

            this.container = container;
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.resize();

            if (!this._resizeObserver) {
                this._resizeObserver = new ResizeObserver(() => this.resize());
                this._resizeObserver.observe(this.bgLayer);
            }
        }

        resize() {
            if (!this.canvas || !this.bgLayer) return;
            const rect = this.bgLayer.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            const w = Math.max(1, Math.floor(rect.width * dpr));
            const h = Math.max(1, Math.floor(rect.height * dpr));
            if (this.canvas.width !== w || this.canvas.height !== h) {
                this.canvas.width = w;
                this.canvas.height = h;
            }
        }

        bindSharedState() {
            if (!window.sharedStateManager || this._unsubscribeShared) return;
            if (typeof window.sharedStateManager.subscribe !== 'function') return;

            this._unsubscribeShared = window.sharedStateManager.subscribe((newState) => {
                const playing = Boolean(newState?.isPlaying);
                this.isPlaying = playing;
                if (this.enabled) {
                    this.ensureRunning();
                }
            });
        }

        toggle() {
            this.setEnabled(!this.enabled);
        }

        setEnabled(enabled) {
            this.enabled = Boolean(enabled);
            setBoolInStorage(STORAGE_KEY, this.enabled);

            if (this.container) {
                this.container.style.opacity = this.enabled ? '1' : '0';
            }

            this.syncToggleLabel();

            if (this.enabled) {
                this.ensureRunning();
            } else {
                this.stop();
            }
        }

        syncToggleLabel() {
            try {
                const taskbar = this.workspace?.shadowRoot?.querySelector('panel-taskbar')
                    || document.querySelector('panel-taskbar');
                const label = taskbar?.shadowRoot?.getElementById('start-menu-visualizer-toggle-label');
                const btn = taskbar?.shadowRoot?.getElementById('start-menu-visualizer-toggle-item');
                if (label) {
                    label.textContent = this.enabled ? 'Disable Music Visualizer' : 'Enable Music Visualizer';
                }
                if (btn) {
                    btn.setAttribute('aria-pressed', this.enabled ? 'true' : 'false');
                }
            } catch {
                // ignore
            }
        }

        ensureRunning() {
            if (this.raf) return;
            const step = (t) => {
                this.raf = requestAnimationFrame(step);
                this.draw(t);
            };
            this.raf = requestAnimationFrame(step);
        }

        stop() {
            if (this.raf) {
                cancelAnimationFrame(this.raf);
                this.raf = null;
            }
            this.clear();
        }

        clear() {
            if (!this.ctx || !this.canvas) return;
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }

        draw(t) {
            if (!this.enabled || !this.ctx || !this.canvas) return;
            const ctx = this.ctx;
            const w = this.canvas.width;
            const h = this.canvas.height;

            // Simple, low-cost visualization driven by play state.
            // Uses the existing grid-line neutral tone; avoids introducing new UI theming.
            const baseAlpha = this.isPlaying ? 0.18 : 0.06;
            const time = (t || 0) / 1000;

            ctx.clearRect(0, 0, w, h);

            // Draw a few vertical wave bands.
            const bands = 6;
            for (let i = 0; i < bands; i++) {
                const phase = time * (this.isPlaying ? 1.8 : 0.6) + i * 0.9;
                const x = (w / bands) * (i + 0.5);
                const amp = (this.isPlaying ? 0.18 : 0.06) * h;
                const yMid = h * 0.5;
                const yOff = Math.sin(phase) * amp;
                const thickness = Math.max(1, Math.floor((w / 900) * 6));

                ctx.strokeStyle = `rgba(70, 70, 70, ${baseAlpha})`;
                ctx.lineWidth = thickness;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.quadraticCurveTo(x + Math.cos(phase) * (w * 0.02), yMid + yOff, x, h);
                ctx.stroke();
            }
        }
    }

    const visualizer = new MusicVisualizer();
    visualizer.init();

    // Expose for debugging.
    window.xaviMusicVisualizer = visualizer;
})();
