// ==UserScript==
// @name         OuterEmpires – Preview Overlay
// @namespace    http://tamperpermonkey.net/
// @version      1.0
// @description  Shows a floating mini-preview of your Outer Empires game tab on any other tab.
// @author       You
// @match        *://*/*
// @exclude      https://game.dev.outerempires.net/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'outerempires_preview_snapshot';
    const POLL_MS = 3000;        // how often to check for a new snapshot
    const PREVIEW_WIDTH = 280;
    const STALE_THRESHOLD = 30000; // hide if snapshot is older than 30s

    // --- Build the floating widget ---

    const wrapper = document.createElement('div');
    wrapper.id = 'oe-preview-wrapper';
    Object.assign(wrapper.style, {
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        width: PREVIEW_WIDTH + 'px',
        zIndex: '2147483647',
        fontFamily: 'system-ui, sans-serif',
        userSelect: 'none',
        transition: 'opacity 0.2s ease',
    });

    wrapper.innerHTML = `
        <div id="oe-preview-panel" style="
            background: #111;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 8px 32px rgba(0,0,0,0.55);
            border: 1.5px solid #333;
        ">
            <div id="oe-preview-header" style="
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 6px 10px;
                background: #1a1a2e;
                cursor: grab;
                gap: 8px;
            ">
                <div style="display:flex;align-items:center;gap:6px;">
                    <span style="width:8px;height:8px;border-radius:50%;background:#4ade80;display:inline-block;" id="oe-status-dot"></span>
                    <span style="color:#ccc;font-size:11px;font-weight:600;letter-spacing:0.5px;">OUTER EMPIRES</span>
                </div>
                <div style="display:flex;gap:6px;align-items:center;">
                    <span id="oe-age" style="color:#666;font-size:10px;"></span>
                    <button id="oe-minimize-btn" title="Minimize" style="
                        background:none;border:none;color:#888;cursor:pointer;
                        font-size:14px;line-height:1;padding:2px 4px;
                    ">—</button>
                    <button id="oe-close-btn" title="Hide" style="
                        background:none;border:none;color:#888;cursor:pointer;
                        font-size:14px;line-height:1;padding:2px 4px;
                    ">✕</button>
                </div>
            </div>
            <div id="oe-preview-body" style="position:relative;">
                <img id="oe-preview-img" style="
                    display:block;
                    width:100%;
                    height:auto;
                    image-rendering:auto;
                " src="" alt="Game preview" />
                <div id="oe-overlay-msg" style="
                    display:none;
                    position:absolute;inset:0;
                    background:rgba(0,0,0,0.75);
                    color:#aaa;font-size:12px;
                    align-items:center;justify-content:center;text-align:center;
                    padding:12px;
                ">No snapshot yet.<br>Open the game tab to start broadcasting.</div>
            </div>
            <div id="oe-preview-footer" style="
                padding:4px 10px;background:#111;
                color:#555;font-size:10px;text-align:right;
            ">Live preview · updates every 5s</div>
        </div>
        <div id="oe-minimized-tab" style="
            display:none;
            background:#1a1a2e;
            border-radius:8px 8px 0 0;
            border: 1.5px solid #333;
            border-bottom:none;
            padding:5px 12px;
            cursor:pointer;
            color:#ccc;font-size:11px;font-weight:600;letter-spacing:0.5px;
            box-shadow:0 -4px 12px rgba(0,0,0,0.4);
        ">▲ OUTER EMPIRES</div>
    `;

    document.body.appendChild(wrapper);

    const panel = document.getElementById('oe-preview-panel');
    const header = document.getElementById('oe-preview-header');
    const img = document.getElementById('oe-preview-img');
    const overlay = document.getElementById('oe-overlay-msg');
    const statusDot = document.getElementById('oe-status-dot');
    const ageLabel = document.getElementById('oe-age');
    const minimizedTab = document.getElementById('oe-minimized-tab');
    const minimizeBtn = document.getElementById('oe-minimize-btn');
    const closeBtn = document.getElementById('oe-close-btn');

    let minimized = false;
    let hidden = false;

    // --- Minimise / close ---
    minimizeBtn.addEventListener('click', () => {
        minimized = true;
        panel.style.display = 'none';
        minimizedTab.style.display = 'block';
    });
    minimizedTab.addEventListener('click', () => {
        minimized = false;
        panel.style.display = '';
        minimizedTab.style.display = 'none';
    });
    closeBtn.addEventListener('click', () => {
        wrapper.style.display = 'none';
        hidden = true;
    });

    // --- Drag to reposition ---
    let dragging = false, ox = 0, oy = 0;
    header.addEventListener('mousedown', e => {
        dragging = true;
        ox = e.clientX - wrapper.getBoundingClientRect().left;
        oy = e.clientY - wrapper.getBoundingClientRect().top;
        header.style.cursor = 'grabbing';
        e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
        if (!dragging) return;
        let x = e.clientX - ox;
        let y = e.clientY - oy;
        x = Math.max(0, Math.min(x, window.innerWidth - wrapper.offsetWidth));
        y = Math.max(0, Math.min(y, window.innerHeight - wrapper.offsetHeight));
        wrapper.style.left = x + 'px';
        wrapper.style.top = y + 'px';
        wrapper.style.right = 'auto';
        wrapper.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => {
        dragging = false;
        header.style.cursor = 'grab';
    });

    // --- Poll localStorage for snapshots ---
    function updatePreview() {
        if (hidden) return;
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                overlay.style.display = 'flex';
                statusDot.style.background = '#666';
                ageLabel.textContent = '';
                return;
            }
            const data = JSON.parse(raw);
            const age = Date.now() - data.timestamp;

            if (age > STALE_THRESHOLD) {
                overlay.style.display = 'flex';
                overlay.textContent = 'Game tab closed or idle.';
                statusDot.style.background = '#ef4444';
                ageLabel.textContent = Math.round(age / 1000) + 's ago';
                return;
            }

            overlay.style.display = 'none';
            if (img.src !== data.image) img.src = data.image;
            statusDot.style.background = '#4ade80';
            ageLabel.textContent = Math.round(age / 1000) + 's ago';
        } catch (e) {
            console.warn('[OuterEmpires Preview] Poll error:', e);
        }
    }

    // Listen for storage events (real-time cross-tab updates)
    window.addEventListener('storage', e => {
        if (e.key === STORAGE_KEY) updatePreview();
    });

    // Fallback polling
    updatePreview();
    setInterval(updatePreview, POLL_MS);

})();
