// ==UserScript==
// @name         OuterEmpires – Tab Broadcaster
// @namespace    http://tamperpermonkey.net/
// @version      1.0
// @description  Captures this game tab periodically and stores a preview snapshot for other tabs to display.
// @author       You
// @match        https://game.dev.outerempires.net/*
// @grant        none
// @require      https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'outerempires_preview_snapshot';
    const INTERVAL_MS = 5000; // capture every 5 seconds
    const PREVIEW_WIDTH = 320;  // thumbnail width

    async function captureTab() {
        try {
            const canvas = await html2canvas(document.body, {
                scale: 0.3,            // downscale for performance
                useCORS: true,
                allowTaint: true,
                logging: false,
                width: window.innerWidth,
                height: window.innerHeight,
                windowWidth: window.innerWidth,
                windowHeight: window.innerHeight,
                x: window.scrollX,
                y: window.scrollY,
            });

            const dataURL = canvas.toDataURL('image/jpeg', 0.5);
            const payload = JSON.stringify({
                image: dataURL,
                timestamp: Date.now(),
                title: document.title || 'Outer Empires',
                url: location.href,
            });
            localStorage.setItem(STORAGE_KEY, payload);
        } catch (e) {
            console.warn('[OuterEmpires Broadcaster] Capture failed:', e);
        }
    }

    // Initial capture after a short delay to let the page settle
    setTimeout(captureTab, 2000);
    setInterval(captureTab, INTERVAL_MS);

    // Also capture on visibility change (tab re-focused)
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) captureTab();
    });

    console.log('[OuterEmpires Broadcaster] Running — capturing every', INTERVAL_MS / 1000, 's');
})();
