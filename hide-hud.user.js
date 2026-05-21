// ==UserScript==
// @name         HUD Layer Killer
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Hide top UI layers progressively
// @match        https://game.dev.outerempires.net/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    /*
        CHANGE THIS NUMBER
        ------------------
        Higher number = more UI visible
        Lower number  = more UI hidden

        Try:
        500
        400
        300
        200
        100
        50
        10
    */

    const Z_INDEX_LIMIT = 201;

    let enabled = false;
    const modified = [];

    function hideLayers() {

        modified.length = 0;

        document.querySelectorAll('*').forEach(el => {

            const style = getComputedStyle(el);

            const z = parseInt(style.zIndex);

            if (
                !isNaN(z) &&
                z >= Z_INDEX_LIMIT &&
                style.display !== 'none'
            ) {

                modified.push({
                    el,
                    oldDisplay: el.style.display
                });

                el.style.setProperty(
                    'display',
                    'none',
                    'important'
                );
            }
        });

        console.log(
            `[HUD Killer]
             Hidden all layers with z-index >= ${Z_INDEX_LIMIT}`
        );
    }

    function restoreLayers() {

        modified.forEach(item => {
            item.el.style.display = item.oldDisplay;
        });

        console.log('[HUD Killer] UI restored');
    }

    function toggle() {

        enabled = !enabled;

        if (enabled) {
            hideLayers();
        } else {
            restoreLayers();
        }
    }

    document.addEventListener('keydown', (e) => {

        if (e.key === 'F1') {

            e.preventDefault();

            toggle();
        }
    });

    console.log(`
========================================
HUD Layer Killer Loaded

Current Z_INDEX_LIMIT:
${Z_INDEX_LIMIT}

F1 = Toggle UI
========================================
`);
})();