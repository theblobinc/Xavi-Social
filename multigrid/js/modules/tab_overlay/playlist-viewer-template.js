(function ensurePlaylistViewerTemplate() {
    const TEMPLATE_ID = 'playlist-viewer-template';
    if (document.getElementById(TEMPLATE_ID)) {
        return;
    }

    const template = document.createElement('template');
    template.id = TEMPLATE_ID;
    template.innerHTML = `
    <style>
        :host {
            display: flex;
            flex-direction: column;
            background: rgba(12, 12, 12, 0.94);
            border: 1px solid rgba(255, 255, 255, 0.14);
            border-radius: 12px;
            box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
            height: 100%;
            min-height: 0;
            overflow: hidden;
            box-sizing: border-box;
            color: rgba(255, 255, 255, 0.85);
            font-size: 0.875rem;
        }

        #playlist-shell {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(72px, 15%);
            grid-template-rows: 1fr;
            align-items: stretch;
            flex: 1;
            min-height: 0;
            height: 100%;
            overflow: hidden;
        }

        #playlist-tabs {
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 12px 6px 12px 8px;
            background: rgba(255, 255, 255, 0.03);
            border-left: 1px solid rgba(255, 255, 255, 0.08);
            min-width: 80px;
            max-width: 220px;
            min-height: 0;
        }

        .playlist-tab-btn {
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 6px;
            min-height: 64px;
            padding: 8px 6px;
            border-radius: 9px;
            border: 1px solid rgba(255, 255, 255, 0.16);
            background: rgba(255, 255, 255, 0.05);
            color: rgba(255, 255, 255, 0.75);
            font-size: 0.75rem;
            cursor: pointer;
            transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, transform 0.2s ease;
        }

        .playlist-tab-btn .icon {
            font-size: 1.2rem;
            pointer-events: none;
        }

        .playlist-tab-btn .label {
            white-space: nowrap;
            letter-spacing: 0.02em;
            text-transform: uppercase;
        }

        .playlist-tab-btn:hover {
            background: rgba(74, 158, 255, 0.16);
            border-color: rgba(74, 158, 255, 0.5);
            color: rgba(255, 255, 255, 0.95);
            transform: translateY(-1px);
        }

        .playlist-tab-btn.active {
            border-color: rgba(74, 158, 255, 0.7);
            background: rgba(74, 158, 255, 0.24);
            color: rgba(255, 255, 255, 1);
            box-shadow: inset 0 0 0 1px rgba(74, 158, 255, 0.38);
        }

        .playlist-tab-btn.disabled {
            opacity: 0.45;
            cursor: not-allowed;
        }

        .playlist-tab-btn.shake {
            animation: wiggle 0.35s ease;
        }

        @keyframes wiggle {
            0%, 100% { transform: translateX(0); }
            20% { transform: translateX(-3px); }
            40% { transform: translateX(3px); }
            60% { transform: translateX(-2px); }
            80% { transform: translateX(2px); }
        }

        #playlist-main {
            flex: 1;
            display: flex;
            flex-direction: column;
            min-height: 0;
            height: 100%;
            padding: 12px 0 14px 12px;
            gap: 10px;
            overflow: hidden;
        }

        #playlist-scroll {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            overflow-x: hidden;
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding-right: 46px;
            scrollbar-gutter: stable both-edges;
        }

        #playlist-scroll::-webkit-scrollbar {
            width: 30px;
            background: transparent;
        }

        #playlist-scroll::-webkit-scrollbar-track {
            background: rgba(0, 0, 0, 0.22);
            border-left: 1px solid rgba(255, 255, 255, 0.03);
            border-radius: 10px;
            margin: 10px 8px;
        }

        #playlist-scroll::-webkit-scrollbar-thumb {
            background: linear-gradient(180deg, rgba(74,158,255,0.20), rgba(74,158,255,0.06));
            border-radius: 14px;
            border: 6px solid transparent;
            background-clip: padding-box;
            box-shadow: inset 0 2px 8px rgba(0,0,0,0.45);
        }

        #playlist-scroll::-webkit-scrollbar-thumb:hover {
            background: linear-gradient(180deg, rgba(74,158,255,0.34), rgba(74,158,255,0.12));
        }

        #playlist-scroll {
            scrollbar-width: thin;
            scrollbar-color: rgba(74,158,255,0.30) rgba(0,0,0,0.20);
        }

        .playlist-item {
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 8px 10px;
            border-radius: 8px;
            border: 1px solid transparent;
            background: rgba(255, 255, 255, 0.02);
            transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
            position: relative;
        }

        .playlist-item + .playlist-item {
            border-top: 1px solid rgba(255, 255, 255, 0.08);
            padding-top: 14px;
            margin-top: 6px;
        }

        .playlist-item:hover {
            background: rgba(255, 255, 255, 0.08);
            border-color: rgba(255, 255, 255, 0.14);
        }

        .playlist-item.playing {
            border-color: rgba(74, 158, 255, 0.6);
            background: rgba(74, 158, 255, 0.18);
            box-shadow: 0 0 16px rgba(74, 158, 255, 0.35);
        }

        .playlist-item-header {
            display: flex;
            align-items: center;
            gap: 12px;
            min-width: 0;
        }

        .track-number {
            font-variant-numeric: tabular-nums;
            font-weight: 600;
            min-width: 3.8ch;
            padding-right: 6px;
            margin-right: 2px;
            text-align: right;
            color: rgba(255, 255, 255, 0.6);
            flex-shrink: 0;
        }

        .track-info {
            flex: 1;
            min-width: 0;
            overflow: hidden;
            position: relative;
        }

        .track-info-static {
            display: block;
            white-space: nowrap;
            color: rgba(255, 255, 255, 0.88);
            font-weight: 500;
            transition: opacity 0.2s ease;
        }

        .track-info-marquee {
            display: none;
            width: 100%;
            overflow: hidden;
            position: relative;
        }

        .track-info-marquee-track {
            display: flex;
            align-items: center;
            gap: 0;
            white-space: nowrap;
            flex-shrink: 0;
            will-change: transform;
            transform: translate3d(0, 0, 0);
            --marquee-cycle: 50%;
            --marquee-duration: 16s;
        }

        .track-info-marquee-text {
            flex-shrink: 0;
            padding-right: 28px;
            color: rgba(255, 255, 255, 0.88);
            font-weight: 500;
        }

        .playlist-item.marquee-active .track-info-static {
            position: absolute;
            left: 0;
            top: 0;
            opacity: 0;
            pointer-events: none;
        }

        .playlist-item.marquee-active .track-info-marquee {
            display: block;
        }

        .playlist-item.marquee-active .track-info-marquee-track {
            animation: playlist-marquee var(--marquee-duration, 16s) linear infinite;
        }

        @keyframes playlist-marquee {
            0% { transform: translate3d(0, 0, 0); }
            100% { transform: translate3d(calc(-1 * var(--marquee-cycle, 50%)), 0, 0); }
        }

        .track-add-button {
            appearance: none;
            border: 1px solid rgba(255, 255, 255, 0.18);
            background: rgba(255, 255, 255, 0.05);
            color: rgba(255, 255, 255, 0.85);
            border-radius: 6px;
            width: 28px;
            height: 28px;
            font-size: 18px;
            line-height: 1;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
            flex-shrink: 0;
        }

        .track-add-button:hover {
            background: rgba(74, 158, 255, 0.25);
            border-color: rgba(74, 158, 255, 0.7);
            color: #fff;
            transform: translateY(-1px);
        }

        .track-add-button:active {
            transform: scale(0.95);
        }

        .playlist-meta-row {
            display: flex;
            align-items: center;
            gap: 10px;
            color: rgba(255, 255, 255, 0.6);
            font-size: 0.75rem;
        }

        .playlist-meta-row span {
            font-variant-numeric: tabular-nums;
        }

        .time-current,
        .time-total {
            min-width: 3.6ch;
        }

        .time-slider-wrap {
            flex: 1;
            display: flex;
            align-items: center;
        }

        .track-time-slider {
            width: 100%;
            appearance: none;
            height: 4px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.2);
            outline: none;
            cursor: pointer;
        }

        .track-time-slider::-webkit-slider-thumb {
            appearance: none;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.95);
            box-shadow: 0 0 6px rgba(0, 0, 0, 0.4);
        }

        .track-time-slider::-moz-range-thumb {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.95);
            border: none;
            box-shadow: 0 0 6px rgba(0, 0, 0, 0.4);
        }

        .playlist-item.playing .playlist-meta-row {
            color: rgba(255, 255, 255, 0.85);
        }

        #playlist-heading {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .icon-button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 36px;
            height: 36px;
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.18);
            background: rgba(255, 255, 255, 0.06);
            color: rgba(255, 255, 255, 0.85);
            cursor: pointer;
            transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, transform 0.2s ease;
        }

        .icon-button:hover {
            background: rgba(255, 255, 255, 0.14);
            border-color: rgba(74, 158, 255, 0.58);
            color: rgba(255, 255, 255, 1);
        }

        .icon-button.active {
            background: rgba(74, 158, 255, 0.22);
            border-color: rgba(74, 158, 255, 0.7);
            color: rgba(255, 255, 255, 1);
        }

        .icon-button .icon {
            font-size: 1.1rem;
            pointer-events: none;
        }

        .icon-button.now-playing-button {
            width: auto;
            padding: 0 12px;
            gap: 6px;
        }

        .icon-button.now-playing-button .countdown {
            font-size: 0.78rem;
            line-height: 1;
            color: rgba(255, 255, 255, 0.75);
            pointer-events: none;
        }

        .icon-button.now-playing-button .countdown[hidden] {
            display: none;
        }

        #now-playing-button.has-countdown {
            border-color: rgba(74, 158, 255, 0.7);
            background: rgba(74, 158, 255, 0.18);
        }

        .icon-button.flash {
            animation: flash-bg 180ms ease;
        }

        @keyframes flash-bg {
            0% { box-shadow: 0 0 0 0 rgba(74, 158, 255, 0.55); }
            100% { box-shadow: 0 0 0 12px rgba(74, 158, 255, 0); }
        }

        #search-overlay {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
            overflow: hidden;
            max-height: 0;
            opacity: 0;
            transform: translateY(-6px);
            transition: max-height 0.25s ease, opacity 0.2s ease, transform 0.25s ease;
        }

        #search-overlay.open {
            max-height: 72px;
            opacity: 1;
            transform: translateY(0);
            padding-bottom: 4px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }

        #search-input {
            flex: 1;
            padding: 8px 12px;
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 8px;
            color: #fff;
            font-size: 0.875rem;
        }

        #search-input::placeholder {
            color: rgba(255, 255, 255, 0.45);
        }

        #search-input:focus {
            outline: none;
            background: rgba(255, 255, 255, 0.12);
            border-color: rgba(66, 133, 244, 0.6);
        }

        .secondary-button {
            padding: 7px 12px;
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.18);
            background: rgba(255, 255, 255, 0.06);
            color: rgba(255, 255, 255, 0.82);
            font-size: 0.8rem;
            cursor: pointer;
            transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;
            white-space: nowrap;
        }

        .secondary-button:hover {
            background: rgba(255, 255, 255, 0.12);
            border-color: rgba(74, 158, 255, 0.5);
            color: rgba(255, 255, 255, 1);
        }

        #add-to-playlist-modal {
            display: none;
            position: absolute;
            z-index: 1050;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            width: 90%;
            max-width: 400px;
            background: rgba(25, 25, 25, 0.98);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(10px);
            color: #fff;
        }

        .modal-content {
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 15px;
        }

        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding-bottom: 10px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .modal-header h2 {
            margin: 0;
            font-size: 1.2rem;
        }

        .modal-close-btn {
            background: none;
            border: none;
            color: #fff;
            font-size: 1.5rem;
            cursor: pointer;
            opacity: 0.7;
            transition: opacity 0.2s ease;
        }

        .modal-close-btn:hover {
            opacity: 1;
        }

        .modal-body .form-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .modal-body label {
            font-size: 0.8rem;
            text-transform: uppercase;
            color: rgba(255, 255, 255, 0.6);
        }

        .modal-body select,
        .modal-body input {
            padding: 8px 10px;
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            background: rgba(255, 255, 255, 0.08);
            color: #fff;
            font-size: 0.9rem;
        }

        .modal-body select:focus,
        .modal-body input:focus {
            outline: none;
            border-color: rgba(74, 158, 255, 0.6);
            background: rgba(255, 255, 255, 0.12);
        }

        .modal-footer {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            padding-top: 10px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
        }

        .modal-btn {
            padding: 8px 14px;
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            background: rgba(255, 255, 255, 0.08);
            color: rgba(255, 255, 255, 0.85);
            cursor: pointer;
            transition: background 0.2s ease, border-color 0.2s ease;
        }

        .modal-btn:hover {
            background: rgba(255, 255, 255, 0.14);
            border-color: rgba(74, 158, 255, 0.6);
        }

        .modal-btn.primary {
            background: rgba(74, 158, 255, 0.2);
            border-color: rgba(74, 158, 255, 0.5);
            color: #fff;
        }

        .modal-btn.primary:hover {
            background: rgba(74, 158, 255, 0.35);
        }

        @media (max-width: 480px) {
            #add-to-playlist-modal {
                width: 94%;
            }

            .modal-content {
                padding: 16px;
            }

            .modal-footer {
                flex-direction: column;
                align-items: stretch;
            }

            .modal-btn {
                width: 100%;
            }
        }

        @media (max-width: 900px) {
            #playlist-shell {
                grid-template-columns: 1fr;
                grid-template-rows: auto auto;
            }

            #playlist-tabs {
                flex-direction: row;
                justify-content: flex-start;
                min-width: 0;
                max-width: none;
                padding: 10px;
                margin-left: 0;
                margin-top: 6px;
                border-left: none;
                border-top: 1px solid rgba(255, 255, 255, 0.08);
            }

            .playlist-tab-btn {
                flex: 1;
                min-height: 54px;
            }

            #playlist-main {
                padding: 10px 10px 12px 10px;
            }

            #playlist-heading {
                flex-wrap: wrap;
            }
        }

    </style>
    <div id="playlist-shell">
        <div id="playlist-main">
            <div id="playlist-heading">
                <button type="button" id="shuffle-button" class="icon-button" title="Shuffle playlist" aria-label="Shuffle playlist">
                    <span class="icon" aria-hidden="true">🔀</span>
                </button>
                <button type="button" id="chron-button" class="icon-button" title="Newest first" aria-label="Toggle playlist order">
                    <span class="icon" aria-hidden="true">▼</span>
                </button>
                <button type="button" id="search-toggle-button" class="icon-button" aria-controls="search-overlay" aria-expanded="false" title="Search playlist" aria-label="Search playlist">
                    <span class="icon" aria-hidden="true">🔍</span>
                </button>
                <button type="button" id="now-playing-button" class="icon-button now-playing-button" title="Scroll to now playing" aria-label="Scroll to now playing">
                    <span class="icon" aria-hidden="true">🎯</span>
                    <span class="countdown" aria-hidden="true" hidden></span>
                </button>
            </div>
            <div id="search-overlay" aria-hidden="true">
                <input type="text" id="search-input" placeholder="Search channel or track..." autocomplete="off" />
                <button type="button" id="search-clear-button" class="secondary-button" title="Clear search" aria-label="Clear search">Clear</button>
            </div>
            <div id="playlist-scroll" class="playlist-scroll"></div>
        </div>
        <nav id="playlist-tabs" aria-label="Playlist sources">
            <button type="button" id="playlist-mode-now-playing" class="playlist-tab-btn" data-mode="now-playing" aria-pressed="false" title="Now Playing queue">
                <span class="icon" aria-hidden="true">🎧</span>
                <span class="label">Now Playing</span>
            </button>
            <button type="button" id="playlist-mode-cached" class="playlist-tab-btn" data-mode="cached" aria-pressed="false" title="Feed playlist">
                <span class="icon" aria-hidden="true">🗂️</span>
                <span class="label">Feed</span>
            </button>
            <button type="button" id="playlist-mode-user" class="playlist-tab-btn" data-mode="user" aria-pressed="false" title="Your saved playlist">
                <span class="icon" aria-hidden="true">⭐</span>
                <span class="label">My Mix</span>
            </button>
        </nav>
    </div>
    <div id="add-to-playlist-modal" role="dialog" aria-modal="true" aria-labelledby="add-to-playlist-title" style="display: none;">
        <div class="modal-content">
            <div class="modal-header">
                <h2 id="add-to-playlist-title">Add to Playlist</h2>
                <button type="button" class="modal-close-btn" aria-label="Close">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label for="modal-playlist-select">Select a playlist</label>
                    <select id="modal-playlist-select"></select>
                </div>
                <div class="form-group">
                    <button type="button" id="modal-add-to-existing-btn" class="modal-btn primary">Add to Selected</button>
                </div>
                <div id="new-playlist-section" style="display: none;">
                    <div class="form-group">
                        <label for="new-playlist-name">New Playlist Name</label>
                        <input type="text" id="new-playlist-name" placeholder="e.g., Chill Vibes" />
                    </div>
                    <div class="form-group">
                        <button type="button" id="modal-create-and-add-btn" class="modal-btn primary">Create &amp; Add</button>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button type="button" id="modal-new-playlist-btn" class="modal-btn">Create New Playlist</button>
                <button type="button" class="modal-close-btn modal-btn">Cancel</button>
            </div>
        </div>
    </div>`;

    const target = document.body || document.head || document.documentElement;
    target.appendChild(template);
})();
