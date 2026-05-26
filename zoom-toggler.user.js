// ==UserScript==
// @name         Zoom Toggler
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Cycle zoom levels with F3
// @match        https://game.dev.outerempires.net/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const ZOOMS = [0.95, 0.75, 0.55];
    let idx = -1;

    document.addEventListener('keydown', (e) => {
        if (e.key === 'F3') {
            e.preventDefault();
            idx = (idx + 1) % ZOOMS.length;
            const zoom = ZOOMS[idx];
            const vp = space_view_pixi_app.stage.children.find(c => c.constructor.name === 'ScaleBar').viewport;
            vp.setZoom(zoom);
            console.log(`[Zoom Toggler] Set zoom to ${zoom}`);
        }
    });

    console.log(`
========================================
Zoom Toggler Loaded
F3 = Cycle zoom (0.55 -> 0.35 -> 0.15)
========================================
`);
})();
