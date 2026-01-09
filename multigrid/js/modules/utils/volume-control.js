(function () {
    if (window.customElements && window.customElements.get('xavi-volume-control')) {
        return;
    }

    function clampInt(value, min, max) {
        const n = Number.parseInt(value, 10);
        if (Number.isNaN(n)) return min;
        return Math.min(max, Math.max(min, n));
    }

    class XaviVolumeControl extends HTMLElement {
        static get observedAttributes() {
            return ['value', 'storage-key', 'disabled', 'compact', 'source', 'label'];
        }

        constructor() {
            super();
            this._id = `xvc_${Math.random().toString(36).slice(2)}_${Date.now()}`;
            this._value = 50;
            this._open = false;
            this._suppressDispatch = false;
            this._connected = false;
            this._autoCloseTimer = null;
            this._dropdownAnchored = false;

            this.attachShadow({ mode: 'open' });

            this._onDocClick = (e) => {
                if (!this._open) return;
                const path = e.composedPath ? e.composedPath() : null;
                if (path && path.includes(this)) return;
                if (this.contains(e.target)) return;
                this.open = false;
            };

            this._onStorage = (e) => {
                const key = this.storageKey;
                if (!key) return;
                if (e && e.key === key && e.newValue != null) {
                    this._setValueInternal(clampInt(e.newValue, 0, 100), { emit: false });
                }
            };

            this._onGlobalVolumeChanged = (e) => {
                const detail = e?.detail || null;
                if (!detail) return;
                if (detail.senderId && detail.senderId === this._id) return;
                if (detail.volume == null) return;
                this._setValueInternal(clampInt(detail.volume, 0, 100), { emit: false });
            };

            this._onReposition = () => {
                if (!this._open) return;
                this._applyAnchoredDropdownLayout();
            };
        }

        get storageKey() {
            return this.getAttribute('storage-key') || 'myVolume';
        }

        get source() {
            return this.getAttribute('source') || 'volume-control';
        }

        get label() {
            return this.getAttribute('label') || 'Volume';
        }

        get value() {
            return this._value;
        }

        set value(v) {
            this._setValueInternal(clampInt(v, 0, 100), { emit: false });
            this.setAttribute('value', String(this._value));
        }

        get open() {
            return this._open;
        }

        set open(next) {
            const v = !!next;
            if (this._open === v) return;
            this._open = v;
            this._renderOpenState();

            if (this._open) {
                this._scheduleAutoClose();
                this._applyAnchoredDropdownLayout();
                window.addEventListener('resize', this._onReposition);
                window.addEventListener('scroll', this._onReposition, true);
            } else {
                this._clearAutoCloseTimer();
                window.removeEventListener('resize', this._onReposition);
                window.removeEventListener('scroll', this._onReposition, true);
            }
        }

        get autoCloseMs() {
            const raw = this.getAttribute('autoclose-ms');
            if (raw == null || raw === '') return 2800;
            const n = Number.parseInt(raw, 10);
            if (!Number.isFinite(n) || Number.isNaN(n)) return 2800;
            return Math.max(0, n);
        }

        _clearAutoCloseTimer() {
            if (this._autoCloseTimer) {
                clearTimeout(this._autoCloseTimer);
                this._autoCloseTimer = null;
            }
        }

        _scheduleAutoClose() {
            this._clearAutoCloseTimer();
            if (!this._open) return;
            const ms = this.autoCloseMs;
            if (ms <= 0) return;
            this._autoCloseTimer = setTimeout(() => {
                this._autoCloseTimer = null;
                this.open = false;
            }, ms);
        }

        connectedCallback() {
            if (this._connected) return;
            this._connected = true;

            this._render();

            // Initialize from storage if no explicit value provided.
            if (!this.hasAttribute('value')) {
                const stored = this._readStoredVolume();
                this._setValueInternal(stored, { emit: false });
            } else {
                this._setValueInternal(clampInt(this.getAttribute('value'), 0, 100), { emit: false });
            }

            document.addEventListener('click', this._onDocClick);
            window.addEventListener('storage', this._onStorage);
            document.addEventListener('volume-changed', this._onGlobalVolumeChanged);
        }

        disconnectedCallback() {
            this._connected = false;
            this._clearAutoCloseTimer();
            window.removeEventListener('resize', this._onReposition);
            window.removeEventListener('scroll', this._onReposition, true);
            document.removeEventListener('click', this._onDocClick);
            window.removeEventListener('storage', this._onStorage);
            document.removeEventListener('volume-changed', this._onGlobalVolumeChanged);
        }

        attributeChangedCallback(name, oldValue, newValue) {
            if (oldValue === newValue) return;
            if (name === 'value') {
                this._setValueInternal(clampInt(newValue, 0, 100), { emit: false });
                return;
            }
            if (name === 'disabled') {
                this._applyDisabled();
                return;
            }
            if (name === 'compact') {
                this._applyCompact();
                return;
            }
            if (name === 'label') {
                this._applyLabel();
                return;
            }
        }

        _readStoredVolume() {
            try {
                const raw = localStorage.getItem(this.storageKey);
                return clampInt(raw ?? '50', 0, 100);
            } catch (e) {
                return 50;
            }
        }

        _writeStoredVolume(v) {
            try {
                localStorage.setItem(this.storageKey, String(v));

                // Trigger same-tab sync for listeners that rely on the storage event.
                try {
                    window.dispatchEvent(new StorageEvent('storage', {
                        key: this.storageKey,
                        newValue: String(v),
                        url: window.location.href
                    }));
                } catch (e) {
                    // ignore
                }
            } catch (e) {
                // ignore
            }
        }

        _setValueInternal(v, { emit }) {
            const next = clampInt(v, 0, 100);
            if (this._value === next) {
                this._syncUI();
                return;
            }
            this._value = next;
            this._syncUI();

            if (!emit) return;
            if (this._suppressDispatch) return;

            this._writeStoredVolume(next);

            // Local composed event for parent components.
            this.dispatchEvent(new CustomEvent('xavi-volume-change', {
                bubbles: true,
                composed: true,
                detail: { volume: next, source: this.source, senderId: this._id }
            }));

            // Global event for cross-component sync.
            document.dispatchEvent(new CustomEvent('volume-changed', {
                detail: { volume: next, source: this.source, senderId: this._id }
            }));
        }

        _render() {
            const compact = this.hasAttribute('compact');
            const disabled = this.hasAttribute('disabled');

            this.shadowRoot.innerHTML = `
                <style>
                    :host {
                        display: inline-flex;
                        align-items: center;
                        position: relative;
                        user-select: none;
                        -webkit-user-select: none;
                        touch-action: manipulation;

                        /* Brushed metal knob + readable % (defaults; can be overridden from outside) */
                        --xvc-thumb-d: clamp(34px, 7.5vw, 42px);
                        --xvc-track-h: 18px;
                        --xvc-track-pad: 6px;

                        --xvc-metal-a: #f3f3f3;
                        --xvc-metal-b: #d8d8d8;
                        --xvc-metal-c: #bdbdbd;
                        --xvc-metal-d: #8e8e8e;
                        --xvc-metal-rim: rgba(0, 0, 0, 0.35);

                        --xvc-pct-size: clamp(12px, 2.8vw, 14px);
                    }

                    .btn {
                        background: transparent;
                        border: 1px solid rgba(255, 255, 255, 0.2);
                        color: rgba(255, 255, 255, 0.85);
                        border-radius: 6px;
                        padding: 8px 10px;
                        font-size: 14px;
                        line-height: 1;
                        cursor: pointer;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        min-width: 38px;
                        height: 34px;
                    }

                    :host([compact]) .btn {
                        padding: 6px 8px;
                        min-width: 34px;
                        height: 30px;
                        border-radius: 6px;
                    }

                    :host([compact]) {
                        --xvc-thumb-d: clamp(32px, 6.5vw, 38px);
                        --xvc-track-h: 16px;
                    }

                    .btn:hover {
                        background: rgba(255, 255, 255, 0.08);
                        border-color: rgba(255, 255, 255, 0.35);
                        color: rgba(255, 255, 255, 1);
                    }

                    .btn:active {
                        transform: translateY(1px);
                    }

                    :host([disabled]) .btn {
                        opacity: 0.55;
                        cursor: default;
                        pointer-events: none;
                    }

                    .dropdown {
                        position: absolute;
                        top: calc(100% + 8px);
                        left: 50%;
                        transform: translateX(-50%) translateY(-6px);
                        background: rgba(0, 0, 0, 0.92);
                        border: 1px solid rgba(255, 255, 255, 0.2);
                        border-radius: 8px;
                        padding: 0;
                        opacity: 0;
                        visibility: hidden;
                        pointer-events: none;
                        z-index: 99999;
                        width: 240px;
                        box-sizing: border-box;
                        transition: opacity 0.18s ease, transform 0.18s ease, visibility 0s linear 0.18s;
                    }

                    /* Anchored should override compact positioning (placed after compact rules below as well) */

                    :host([compact]) .dropdown {
                        width: 220px;
                        top: 50%;
                        left: auto;
                        right: 0;
                        transform: translateY(calc(-50% - 8px));
                    }

                    .dropdown.visible {
                        opacity: 1;
                        visibility: visible;
                        pointer-events: auto;
                        transform: translateX(-50%) translateY(0);
                        transition: opacity 0.18s ease, transform 0.18s ease, visibility 0s;
                    }

                    :host([compact]) .dropdown.visible {
                        transform: translateY(-50%);
                    }

                    /* Anchored should override compact positioning */
                    .dropdown.anchored,
                    :host([compact]) .dropdown.anchored {
                        position: fixed;
                        left: var(--anchor-left, 0px);
                        top: var(--anchor-top, 0px);
                        right: auto;
                        bottom: auto;

                        width: var(--anchor-width, 240px);
                        height: var(--anchor-height, 34px);
                        border-radius: var(--anchor-radius, 12px);

                        /* REAL “slides down over controls” animation */
                        transform: translateY(-110%);
                    }

                    .dropdown.anchored.visible,
                    :host([compact]) .dropdown.anchored.visible {
                        transform: translateY(0);
                    }

                    .row {
                        display: flex;
                        align-items: center;
                        gap: 10px;
                        height: 100%;
                        padding: 0;
                        box-sizing: border-box;
                    }

                    /* Give the slider breathing room inside the anchored bar */
                    .dropdown.anchored .row,
                    :host([compact]) .dropdown.anchored .row {
                        padding: 0 12px;
                    }

                    .pct {
                        position: absolute;
                        width: 1px;
                        height: 1px;
                        padding: 0;
                        margin: -1px;
                        overflow: hidden;
                        clip: rect(0, 0, 0, 0);
                        white-space: nowrap;
                        border: 0;
                    }

                    .sliderWrap {
                        --min: 0;
                        --max: 100;
                        --val: 50;

                        --input-h: min(var(--xvc-thumb-d, 32px), 100%);
                        --input-p: 6px;
                        --input-r: calc(.5 * var(--input-h));

                        --track-r: calc(var(--input-r) - var(--input-p));
                        --track-h: calc(2 * var(--track-r));

                        --thumb-d: var(--input-h);
                        --thumb-r: calc(.5 * var(--thumb-d));

                        --k: calc((var(--val) - var(--min)) / (var(--max) - var(--min)));
                        --pos: calc(var(--thumb-r) + var(--k) * (100% - var(--thumb-d)));

                        position: relative;
                        flex: 1;
                        min-width: 0;
                        height: 100%;
                        display: flex;
                        align-items: center;
                    }

                    .thumbPct {
                        position: absolute;
                        left: var(--pos);
                        top: 50%;
                        transform: translate(-50%, -50%);
                        font-size: 12px;
                        font-weight: 700;
                        letter-spacing: 0.2px;
                        color: rgba(0, 0, 0, 0.78);
                        text-shadow: 0 1px rgba(255, 255, 255, 0.25);
                        pointer-events: none;
                        user-select: none;
                        font-variant-numeric: tabular-nums;
                    }

                    /* Slider styling: closely based on the provided demo, recolored for dark theme */
                    input[type="range"],
                    input[type="range"]::-webkit-slider-runnable-track,
                    input[type="range"]::-webkit-slider-thumb {
                        -webkit-appearance: none;
                    }

                    input[type="range"] {
                        width: 100%;
                        display: block;
                        height: var(--input-h);
                        border-radius: var(--input-h);
                        cursor: pointer;
                        touch-action: pan-y;
                        background: linear-gradient(180deg, rgba(70, 70, 70, 0.55), rgba(18, 18, 18, 0.85));
                        box-shadow: 0 -1px rgba(0, 0, 0, 0.65), 0 1px rgba(255, 255, 255, 0.08);
                        filter: saturate(var(--hl, 0));
                        transition: filter .25s ease-out;
                    }

                    .dropdown:hover input[type="range"],
                    .dropdown:focus-within input[type="range"],
                    .dropdown.visible input[type="range"] {
                        --hl: 1;
                    }

                    input[type="range"]::-webkit-slider-runnable-track {
                        margin: calc(-1 * var(--input-p));
                        height: var(--track-h);
                        border-radius: var(--track-r);
                        background: transparent;
                    }

                    input[type="range"]::-webkit-slider-container {
                        -webkit-user-modify: read-write !important;
                        margin: var(--xvc-track-pad, var(--input-p));
                        height: var(--track-h);
                        border-radius: var(--track-r);
                        box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.75);
                        background:
                            linear-gradient(180deg, rgba(74, 158, 255, 1), rgba(22, 108, 214, 1))
                                0 / var(--pos) no-repeat,
                            linear-gradient(180deg, rgba(235, 235, 235, 0.14), rgba(140, 140, 140, 0.08));
                    }

                    input[type="range"]::-moz-range-track {
                        margin: var(--input-p);
                        height: var(--track-h);
                        border-radius: var(--track-r);
                        box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.75);
                        background: linear-gradient(180deg, rgba(235, 235, 235, 0.14), rgba(140, 140, 140, 0.08));
                    }

                    input[type="range"]::-moz-range-progress {
                        height: var(--track-h);
                        border-radius: var(--track-r);
                        box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.75);
                        background: linear-gradient(180deg, rgba(74, 158, 255, 1), rgba(22, 108, 214, 1));
                    }


                    /* ---------- Brushed metal knob + readable % ---------- */
                    input[type="range"]::-webkit-slider-container {
                        height: var(--xvc-track-h, var(--track-h));
                        border-radius: calc(var(--xvc-track-h, var(--track-h)) / 2);
                    }

                    input[type="range"]::-moz-range-track {
                        height: var(--xvc-track-h, var(--track-h));
                        border-radius: calc(var(--xvc-track-h, var(--track-h)) / 2);
                    }

                    input[type="range"]::-webkit-slider-thumb {
                        -webkit-appearance: none;
                        width: var(--thumb-d);
                        height: var(--thumb-d);
                        border-radius: 50%;

                        border: 1px solid rgba(255, 255, 255, 0.55);

                        background:
                            radial-gradient(circle at 30% 25%,
                                rgba(255, 255, 255, 0.90),
                                rgba(255, 255, 255, 0.22) 35%,
                                rgba(255, 255, 255, 0.0) 55%),
                            repeating-linear-gradient(90deg,
                                rgba(255, 255, 255, 0.18) 0px,
                                rgba(255, 255, 255, 0.18) 1px,
                                rgba(0, 0, 0, 0.06) 2px,
                                rgba(0, 0, 0, 0.06) 3px),
                            linear-gradient(180deg,
                                var(--xvc-metal-a, #f3f3f3),
                                var(--xvc-metal-b, #d8d8d8) 35%,
                                var(--xvc-metal-c, #bdbdbd) 70%,
                                var(--xvc-metal-d, #8e8e8e));

                        box-shadow:
                            0 10px 22px rgba(0, 0, 0, 0.55),
                            0 0 0 1px var(--xvc-metal-rim, rgba(0, 0, 0, 0.35)),
                            inset 0 1px 2px rgba(255, 255, 255, 0.55),
                            inset 0 -3px 6px rgba(0, 0, 0, 0.25);

                        cursor: pointer;
                        transition: transform 120ms ease, box-shadow 120ms ease;
                    }

                    input[type="range"]::-moz-range-thumb {
                        width: var(--thumb-d);
                        height: var(--thumb-d);
                        border-radius: 50%;
                        border: 1px solid rgba(255, 255, 255, 0.55);

                        background:
                            radial-gradient(circle at 30% 25%,
                                rgba(255, 255, 255, 0.90),
                                rgba(255, 255, 255, 0.22) 35%,
                                rgba(255, 255, 255, 0.0) 55%),
                            repeating-linear-gradient(90deg,
                                rgba(255, 255, 255, 0.18) 0px,
                                rgba(255, 255, 255, 0.18) 1px,
                                rgba(0, 0, 0, 0.06) 2px,
                                rgba(0, 0, 0, 0.06) 3px),
                            linear-gradient(180deg,
                                var(--xvc-metal-a, #f3f3f3),
                                var(--xvc-metal-b, #d8d8d8) 35%,
                                var(--xvc-metal-c, #bdbdbd) 70%,
                                var(--xvc-metal-d, #8e8e8e));

                        box-shadow:
                            0 10px 22px rgba(0, 0, 0, 0.55),
                            0 0 0 1px var(--xvc-metal-rim, rgba(0, 0, 0, 0.35)),
                            inset 0 1px 2px rgba(255, 255, 255, 0.55),
                            inset 0 -3px 6px rgba(0, 0, 0, 0.25);

                        cursor: pointer;
                        transition: transform 120ms ease, box-shadow 120ms ease;
                    }

                    input[type="range"]:hover::-webkit-slider-thumb,
                    input[type="range"]:hover::-moz-range-thumb {
                        transform: scale(1.03);
                    }

                    input[type="range"]:active::-webkit-slider-thumb,
                    input[type="range"]:active::-moz-range-thumb {
                        transform: scale(0.98);
                    }

                    input[type="range"]:focus-visible::-webkit-slider-thumb,
                    input[type="range"]:focus-visible::-moz-range-thumb {
                        box-shadow:
                            0 0 0 4px rgba(74, 158, 255, 0.30),
                            0 12px 24px rgba(0, 0, 0, 0.60),
                            0 0 0 1px var(--xvc-metal-rim, rgba(0, 0, 0, 0.35)),
                            inset 0 1px 2px rgba(255, 255, 255, 0.55),
                            inset 0 -3px 6px rgba(0, 0, 0, 0.25);
                    }

                    .thumbPct {
                        width: calc(var(--thumb-d) - 10px);
                        height: calc(var(--thumb-d) - 10px);
                        border-radius: 50%;
                        display: grid;
                        place-items: center;

                        font-size: var(--xvc-pct-size, 13px);
                        font-weight: 800;
                        letter-spacing: 0.2px;

                        color: rgba(255, 255, 255, 0.98);
                        text-shadow:
                            0 1px 0 rgba(0, 0, 0, 0.90),
                            0 -1px 0 rgba(0, 0, 0, 0.90),
                            1px 0 0 rgba(0, 0, 0, 0.90),
                            -1px 0 0 rgba(0, 0, 0, 0.90),
                            0 2px 8px rgba(0, 0, 0, 0.35);

                        background:
                            radial-gradient(circle at 35% 30%,
                                rgba(255, 255, 255, 0.80),
                                rgba(255, 255, 255, 0.35) 45%,
                                rgba(255, 255, 255, 0.12) 70%);
                        pointer-events: none;
                    }

                    input[type="range"]:focus {
                        outline: none;
                    }

                    input[type="range"]:disabled {
                        opacity: 0.6;
                        cursor: default;
                    }

                    /*
                     * Fixed-position probe: used to detect whether position: fixed
                     * is relative to the viewport or an ancestor containing block
                     * (e.g. taskbar uses backdrop-filter).
                     */
                    .fixedProbe {
                        position: fixed;
                        left: 0;
                        top: 0;
                        width: 1px;
                        height: 1px;
                        opacity: 0;
                        pointer-events: none;
                    }
                </style>

                <button class="btn" type="button" aria-label="${this._escapeAttr(this.label)}" title="${this._escapeAttr(this.label)}">
                    <span id="icon" aria-hidden="true">🔊</span>
                </button>

                <div id="fixedProbe" class="fixedProbe" aria-hidden="true"></div>

                <div id="dropdown" class="dropdown" role="dialog" aria-label="${this._escapeAttr(this.label)}">
                    <div class="row">
                        <div id="sliderWrap" class="sliderWrap">
                            <input id="slider" type="range" min="0" max="100" value="${this._value}" />
                            <span id="thumbPct" class="thumbPct" aria-hidden="true">${this._value}</span>
                        </div>
                        <span id="pct" class="pct" role="status" aria-live="polite">${this._value}%</span>
                    </div>
                </div>
            `;

            this._btn = this.shadowRoot.querySelector('button.btn');
            this._dropdown = this.shadowRoot.getElementById('dropdown');
            this._sliderWrap = this.shadowRoot.getElementById('sliderWrap');
            this._slider = this.shadowRoot.getElementById('slider');
            this._pct = this.shadowRoot.getElementById('pct');
            this._thumbPct = this.shadowRoot.getElementById('thumbPct');
            this._icon = this.shadowRoot.getElementById('icon');
            this._fixedProbe = this.shadowRoot.getElementById('fixedProbe');

            if (this._btn) {
                this._btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this.hasAttribute('disabled')) return;
                    this.open = !this.open;
                    if (this.open) {
                        this._scheduleAutoClose();
                    }
                });
            }

            if (this._dropdown) {
                const bump = () => this._scheduleAutoClose();
                this._dropdown.addEventListener('pointerdown', bump);
                this._dropdown.addEventListener('pointermove', bump);
                this._dropdown.addEventListener('wheel', bump, { passive: true });
                this._dropdown.addEventListener('keydown', bump);
            }

            if (this._slider) {
                this._slider.addEventListener('input', (e) => {
                    const next = clampInt(e.target.value, 0, 100);
                    this._setValueInternal(next, { emit: true });
                    this._scheduleAutoClose();
                });
            }

            this.addEventListener('keydown', (e) => {
                if (!this._open) return;
                if (e.key === 'Escape') {
                    e.stopPropagation();
                    this.open = false;
                }
            });

            this._applyDisabled();
            this._applyCompact();
            this._applyLabel();
            this._syncUI();
        }

        _applyAnchoredDropdownLayout() {
            if (!this._dropdown) return;
            if (!this._open) {
                this._dropdown.classList.remove('anchored');
                this._dropdownAnchored = false;
                this._dropdown.style.removeProperty('--anchor-left');
                this._dropdown.style.removeProperty('--anchor-top');
                this._dropdown.style.removeProperty('--anchor-width');
                this._dropdown.style.removeProperty('--anchor-height');
                this._dropdown.style.removeProperty('--anchor-radius');
                return;
            }

            // Optional override: <xavi-volume-control anchor="closest:.player-header"> or anchor="#header"
            const anchorAttr = (this.getAttribute('anchor') || '').trim();
            let anchor = null;

            if (anchorAttr.startsWith('closest:')) {
                anchor = this.closest(anchorAttr.slice('closest:'.length));
            } else if (anchorAttr) {
                const root = this.getRootNode();
                anchor = (root && root.querySelector) ? root.querySelector(anchorAttr) : null;
                if (!anchor) anchor = document.querySelector(anchorAttr);
            }

            // Auto-detect (covers dock bar + video header + music header)
            if (!anchor) {
                anchor =
                    this.closest('[data-volume-anchor]') ||
                    this.closest('.player-header') ||
                    this.closest('#header') ||
                    this.closest('#control-cluster') ||
                    this.closest('.dock-tab-controls');
            }

            if (!anchor) {
                this._dropdown.classList.remove('anchored');
                this._dropdownAnchored = false;
                return;
            }

            const rect = anchor.getBoundingClientRect();
            const cs = getComputedStyle(anchor);

            // If the current environment scopes `position: fixed` to an ancestor
            // (e.g. due to backdrop-filter/transform), compensate by subtracting
            // the fixed origin from viewport coordinates.
            let fixedBaseLeft = 0;
            let fixedBaseTop = 0;
            try {
                if (this._fixedProbe) {
                    const pr = this._fixedProbe.getBoundingClientRect();
                    if (Number.isFinite(pr.left)) fixedBaseLeft = pr.left;
                    if (Number.isFinite(pr.top)) fixedBaseTop = pr.top;
                }
            } catch (e) {
                // ignore
            }

            // Inset so we align to inner padding (stops the “off by padding” jank)
            const pl = parseFloat(cs.paddingLeft) || 0;
            const pr = parseFloat(cs.paddingRight) || 0;
            const pt = parseFloat(cs.paddingTop) || 0;
            const pb = parseFloat(cs.paddingBottom) || 0;

            const left = rect.left + pl - fixedBaseLeft;
            const top = rect.top + pt - fixedBaseTop;
            const width = Math.max(0, rect.width - pl - pr);
            const height = Math.max(0, rect.height - pt - pb);

            const radius = parseFloat(cs.borderTopLeftRadius) || 12;

            this._dropdown.classList.add('anchored');
            this._dropdownAnchored = true;
            this._dropdown.style.setProperty('--anchor-left', `${Math.round(left)}px`);
            this._dropdown.style.setProperty('--anchor-top', `${Math.round(top)}px`);
            this._dropdown.style.setProperty('--anchor-width', `${Math.round(width)}px`);
            this._dropdown.style.setProperty('--anchor-height', `${Math.round(height)}px`);
            this._dropdown.style.setProperty('--anchor-radius', `${Math.round(radius)}px`);
        }

        _renderOpenState() {
            if (!this._dropdown) return;
            this._dropdown.classList.toggle('visible', this._open);
            this._applyAnchoredDropdownLayout();
        }

        _applyDisabled() {
            if (!this._btn || !this._slider) return;
            const disabled = this.hasAttribute('disabled');
            this._btn.disabled = disabled;
            this._slider.disabled = disabled;
        }

        _applyCompact() {
            // purely CSS driven via :host([compact])
        }

        _applyLabel() {
            if (!this._btn || !this._dropdown) return;
            const label = this.label;
            this._btn.setAttribute('aria-label', label);
            this._btn.setAttribute('title', label);
            this._dropdown.setAttribute('aria-label', label);
        }

        _syncUI() {
            if (this._slider) this._slider.value = String(this._value);
            if (this._pct) this._pct.textContent = `${this._value}%`;
            if (this._thumbPct) this._thumbPct.textContent = String(this._value);
            if (this._icon) this._icon.textContent = this._value === 0 ? '🔇' : this._value < 35 ? '🔈' : this._value < 70 ? '🔉' : '🔊';

            // Keep CSS-driven fill in sync across storage/global updates.
            try {
                const target = this._sliderWrap || this._slider;
                if (target) {
                    target.style.setProperty('--min', String(this._slider?.min || '0'));
                    target.style.setProperty('--max', String(this._slider?.max || '100'));
                    target.style.setProperty('--val', String(this._value));
                }
            } catch (e) {
                // ignore
            }
        }

        _escapeAttr(s) {
            return String(s || '').replace(/"/g, '&quot;');
        }
    }

    window.customElements.define('xavi-volume-control', XaviVolumeControl);
})();
