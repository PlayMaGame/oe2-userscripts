// ==UserScript==
// @name         Outer Empires 2 ETA Overlay
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  Level ETA tracker based on XP bar growth
// @match        https://game.dev.outerempires.net/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'oe2_eta_tracker';

    // Slower update = smoother averages
    const UPDATE_INTERVAL = 15000;

    // Keep 30 minutes of history
    const HISTORY_WINDOW_MS = 30 * 60 * 1000;

    let overlay;

    // -------------------------------------------------
    // Create HUD
    // -------------------------------------------------
    function createOverlay() {

        if (document.getElementById('oe2_eta_overlay')) {
            overlay = document.getElementById('oe2_eta_overlay');
            return;
        }

        overlay = document.createElement('div');
        overlay.id = 'oe2_eta_overlay';

        Object.assign(overlay.style, {
            position: 'absolute',
            left: '550px',
            top: '37px',
            zIndex: '125',

            fontFamily: 'inherit',
            fontSize: '12px',
            color: 'white',

            textShadow: '0 0 4px black',

            background: 'rgba(0,0,0,0.20)',
            border: '1px solid rgba(255,255,255,0.08)',
            padding: '4px 8px',
            borderRadius: '4px',

            whiteSpace: 'nowrap',
            pointerEvents: 'none'
        });

        overlay.innerHTML = 'Tracking XP...';

        document.body.appendChild(overlay);
    }

    // -------------------------------------------------
    // Get XP progress %
    // -------------------------------------------------
    function getProgressPercent() {

        const el = document.getElementById(
            'ui_level_military_detail_total'
        );

        if (!el) return null;

        const width = el.style.width;

        const match = width.match(/([\d.]+)%/);

        if (!match) return null;

        return parseFloat(match[1]);
    }

    // -------------------------------------------------
    // Storage helpers
    // -------------------------------------------------
    function loadData() {

        return JSON.parse(
            localStorage.getItem(STORAGE_KEY) || '{}'
        );
    }

    function saveData(data) {

        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(data)
        );
    }

    // -------------------------------------------------
    // ETA formatting
    // -------------------------------------------------
    function formatETA(ms) {

        if (!isFinite(ms) || ms <= 0) {
            return 'Calculating...';
        }

        const totalSeconds = Math.floor(ms / 1000);

        const hours =
            Math.floor(totalSeconds / 3600);

        const mins =
            Math.floor((totalSeconds % 3600) / 60);

        if (hours <= 0) {
            return `${mins}m`;
        }

        return `${hours}h ${mins}m`;
    }

    // -------------------------------------------------
    // Main update
    // -------------------------------------------------
    function updateTracker() {

        createOverlay();

        const currentPercent =
            getProgressPercent();

        if (currentPercent == null) {

            overlay.innerHTML = `
                <span style="color:#ff6b6b;">
                    XP bar not found
                </span>
            `;

            return;
        }

        const now = Date.now();

        let data = loadData();

        // ---------------------------------------------
        // Initialize history
        // ---------------------------------------------
        if (!data.history) {
            data.history = [];
        }

        // Add current sample
        data.history.push({
            percent: currentPercent,
            time: now
        });

        // Keep only recent samples
        data.history = data.history.filter(
            sample => now - sample.time <= HISTORY_WINDOW_MS
        );

        // Need at least 2 samples
        if (data.history.length < 2) {

            saveData(data);

            overlay.innerHTML = `
                <span style="color:#82b1ff;">
                    Gathering data...
                </span>
            `;

            return;
        }

        const oldest = data.history[0];
        const newest = data.history[data.history.length - 1];

        // ---------------------------------------------
        // Calculate gained %
        // ---------------------------------------------
        let gainedPercent =
            newest.percent - oldest.percent;

        // Detect level up rollover
        if (gainedPercent < 0) {

            gainedPercent =
                (100 - oldest.percent)
                + newest.percent;
        }

        const elapsedHours =
            (newest.time - oldest.time)
            / 3600000;

        let percentPerHour = 0;

        if (elapsedHours > 0) {

            percentPerHour =
                gainedPercent / elapsedHours;
        }

        const remainingPercent =
            100 - currentPercent;

        let eta = Infinity;

        if (percentPerHour > 0) {

            eta =
                (remainingPercent / percentPerHour)
                * 3600000;
        }

        // Save updated history
        saveData(data);

        // ---------------------------------------------
        // Color helpers
        // ---------------------------------------------
        let speedColor = '#69f0ae';

        if (percentPerHour < 1) {
            speedColor = '#ff5252';
        }
        else if (percentPerHour < 3) {
            speedColor = '#ffd54f';
        }

        // ---------------------------------------------
        // Display
        // ---------------------------------------------
        overlay.innerHTML = `
            LVL ETA

            <span style="color:#555;">
                &nbsp;|&nbsp;
            </span>

            <span style="
                color:${speedColor};
                font-weight:bold;
            ">
                ${percentPerHour.toFixed(3)}%/h
            </span>

            <span style="color:#555;">
                &nbsp;|&nbsp;
            </span>

            <span style="
                color:#ffd54f;
                font-weight:bold;
            ">
                ${formatETA(eta)}
            </span>

            <span style="color:#555;">
                &nbsp;|&nbsp;
            </span>

            <span style="
                color:#82b1ff;
                font-weight:bold;
            ">
                ${currentPercent.toFixed(2)}%
            </span>
        `;
    }

    // -------------------------------------------------
    // Reset helper
    // -------------------------------------------------
    window.resetXPTracker = () => {

        localStorage.removeItem(STORAGE_KEY);

        console.log('ETA tracker reset.');
    };

    // -------------------------------------------------
    // Start
    // -------------------------------------------------
    updateTracker();

    setInterval(updateTracker, UPDATE_INTERVAL);

})();