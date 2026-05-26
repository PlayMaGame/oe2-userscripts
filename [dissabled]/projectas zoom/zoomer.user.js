// ==UserScript==
// @name         OE2 Advanced Zoom Control
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  Full zoom control for Outer Empires
// @match        *://game.dev.outerempires.net/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    //////////////////////////////////////////////////////
    // CONFIG
    //////////////////////////////////////////////////////

	const zoomLevels = [

		0.15,   // Extreme experimental
		0.3171, // Tactical maximum
		0.75,   // Comfortable far overview
		1.6968, // Beautiful screenshot mode
		4.0     // Strong zoom-in

	];

    let currentViewport = null;

    //////////////////////////////////////////////////////
    // FIND VIEWPORT
    //////////////////////////////////////////////////////

    function searchObjects(obj, depth = 0) {

        if (!obj || depth > 3) return;

        try {

            if (
                obj.viewport &&
                typeof obj.viewport.setZoom === 'function'
            ) {

                currentViewport = obj.viewport;

                console.log('FOUND VIEWPORT');

                unlockZoom(currentViewport);

                return;
            }

            for (const k in obj) {

                if (
                    typeof obj[k] === 'object' &&
                    obj[k] !== null
                ) {
                    searchObjects(obj[k], depth + 1);
                }
            }

        } catch (e) {}
    }

    //////////////////////////////////////////////////////
    // UNLOCK LIMITS
    //////////////////////////////////////////////////////

    function unlockZoom(vp) {

        try {

            if (vp.__zoomUnlocked) return;

            vp.__zoomUnlocked = true;

            const originalClampZoom = vp.clampZoom;

            vp.clampZoom = function(opts) {

                opts.minScale = 0.001;
                opts.maxScale = 10;

                console.log('Zoom limits unlocked');

                return originalClampZoom.call(this, opts);
            };

        } catch (e) {
            console.error(e);
        }
    }

    //////////////////////////////////////////////////////
    // APPLY ZOOM
    //////////////////////////////////////////////////////

    function applyZoom(level) {

        if (!currentViewport) {
            console.log('Viewport not found yet');
            return;
        }

        try {

            currentViewport.setZoom(level, true);

            console.log('Applied zoom:', level);

            updateCurrent();

        } catch (e) {

            console.error(e);
        }
    }

    //////////////////////////////////////////////////////
    // UI
    //////////////////////////////////////////////////////

    const panel = document.createElement('div');

    panel.style.position = 'fixed';
    panel.style.top = '120px';
    panel.style.right = '20px';
    panel.style.zIndex = '999999';
    panel.style.background = 'rgba(0,0,0,0.85)';
    panel.style.padding = '10px';
    panel.style.border = '1px solid gray';
    panel.style.borderRadius = '8px';
    panel.style.color = 'white';
    panel.style.fontFamily = 'Arial';
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    panel.style.gap = '5px';

    const title = document.createElement('div');
    title.innerText = 'OE2 Zoom';
    title.style.fontWeight = 'bold';

    panel.appendChild(title);

    const current = document.createElement('div');
    current.innerText = 'Current: ?';

    panel.appendChild(current);

    function updateCurrent() {

        if (
            currentViewport &&
            currentViewport.scale
        ) {

            current.innerText =
                'Current: ' +
                currentViewport.scale.x.toFixed(4);
        }
    }

    zoomLevels.forEach((z, i) => {

        const btn = document.createElement('button');

        btn.innerText = `Zoom ${i + 1} (${z})`;

        btn.onclick = () => applyZoom(z);

        panel.appendChild(btn);
    });

    document.body.appendChild(panel);

    //////////////////////////////////////////////////////
    // HOTKEYS
    //////////////////////////////////////////////////////

    document.addEventListener('keydown', (e) => {

        if (!e.altKey) return;

        const n = parseInt(e.key);

        if (
            n >= 1 &&
            n <= 5
        ) {

            applyZoom(
                zoomLevels[n - 1]
            );
        }
    });

    //////////////////////////////////////////////////////
    // SEARCH LOOP
    //////////////////////////////////////////////////////

    setInterval(() => {

        if (!currentViewport) {

            for (const k in window) {

                try {
                    searchObjects(window[k]);
                } catch (e) {}
            }

        } else {

            updateCurrent();
        }

    }, 2000);

})();