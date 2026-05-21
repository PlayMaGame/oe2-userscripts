// ==UserScript==
// @name         Outer Empires 2 Latency Display
// @namespace    http://tampermonkey.net/
// @version      0.5
// @description  Replace version with color-coded ping, FPS and memory usage
// @match        https://game.dev.outerempires.net/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // FPS tracking
    let currentFPS = 0;
    let frameCount = 0;
    let lastFPSTime = performance.now();

    function trackFPS() {
        frameCount++;
        const now = performance.now();
        const delta = now - lastFPSTime;
        if (delta >= 1000) {
            currentFPS = Math.round((frameCount * 1000) / delta);
            frameCount = 0;
            lastFPSTime = now;
        }
        requestAnimationFrame(trackFPS);
    }
    requestAnimationFrame(trackFPS);

    function getFPSColor(fps) {
        if (fps >= 60) return 'lime';
        if (fps >= 30) return 'yellow';
        return 'red';
    }

    function getLatencyColor(latency) {
        if (latency === 'Error') return 'red';
        if (latency < 50) return 'lime';
        if (latency < 100) return 'yellow';
        return 'red';
    }

    function getMemoryColor(usedMB) {
        if (usedMB < 1024) return 'lime';
        if (usedMB < 2048) return 'yellow';
        return 'red';
    }

    function getMemoryInfo() {
        if (!performance.memory) return null;
        const usedMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
        const limitMB = Math.round(performance.memory.jsHeapSizeLimit / 1048576);
        const pct = Math.round((usedMB / limitMB) * 100);
        return { usedMB, pct };
    }

    async function measureLatency() {
        const start = performance.now();
        try {
            await fetch('https://game.dev.outerempires.net', {
                method: 'HEAD',
                cache: 'no-store'
            });
            return Math.round(performance.now() - start);
        } catch (error) {
            return 'Error';
        }
    }

    async function updateDisplay() {
        const versionDisplay = document.getElementById('ui_playversion_display');
        if (!versionDisplay) return;

        versionDisplay.style.zIndex = '200';
        versionDisplay.style.whiteSpace = 'nowrap';
        versionDisplay.style.overflow = 'visible';
        versionDisplay.style.position = 'absolute';
		versionDisplay.style.top = '60px'; // <-- add this
        versionDisplay.style.left = '50%';
        versionDisplay.style.transform = 'translateX(-50%)';

        const latency = await measureLatency();
        const mem = getMemoryInfo();

        const sep = ` <span style="color:#555;">&nbsp;|&nbsp;</span> `;

        const pingHTML  = `Ping: <span style="color:${getLatencyColor(latency)};font-weight:bold;">${latency}ms</span>`;
        const fpsHTML   = `FPS: <span style="color:${getFPSColor(currentFPS)};font-weight:bold;">${currentFPS}</span>`;
        const memHTML   = mem
            ? `Ram: <span style="color:${getMemoryColor(mem.usedMB)};font-weight:bold;">${mem.usedMB}MB (${mem.pct}%)</span>`
            : '';

        versionDisplay.innerHTML = [pingHTML, fpsHTML, memHTML].filter(Boolean).join(sep);
    }

    updateDisplay();
    setInterval(updateDisplay, 1000); // Faster refresh so FPS feels live
})();