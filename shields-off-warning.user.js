// ==UserScript==
// @name         Shield OFF Warning (Instance Only)
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Warn when shields are OFF while inside an instance
// @match        https://game.dev.outerempires.net/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    let warningActive = false;
    let lastBeepTime = 0;

    // -----------------------------------
    // Warning Overlay
    // -----------------------------------
    const overlay = document.createElement('div');
    overlay.textContent = '⚠ SHIELDS ARE OFF ⚠';

    Object.assign(overlay.style, {
        position: 'fixed',
        top: '90%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        background: 'rgba(255,0,0,0.92)',
        color: '#fff',
        fontSize: '46px',
        fontWeight: 'bold',
        padding: '25px 50px',
        border: '4px solid white',
        borderRadius: '14px',
        zIndex: '999999',
        display: 'none',
        textAlign: 'center',
        boxShadow: '0 0 30px red',
        pointerEvents: 'none'
    });

    document.body.appendChild(overlay);

    // -----------------------------------
    // Triple Beep
    // -----------------------------------
    function beepThreeTimes() {

        const now = Date.now();

        // Prevent spam
        if (now - lastBeepTime < 5000) return;

        lastBeepTime = now;

        const ctx = new (window.AudioContext || window.webkitAudioContext)();

        for (let i = 0; i < 3; i++) {

            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'square';
            osc.frequency.value = 950;

            osc.connect(gain);
            gain.connect(ctx.destination);

            const start = ctx.currentTime + (i * 0.3);

            gain.gain.setValueAtTime(0.035, start);

            osc.start(start);
            osc.stop(start + 0.15);
        }
    }

    // -----------------------------------
    // Main Check
    // -----------------------------------
    function checkGameState() {

        // Shield HUD exists?
        const shieldElement = document.querySelector(
            '.hud-title-text.shield-text'
        );

        // Game/HUD still loading
        if (!shieldElement) {
            overlay.style.display = 'none';
            warningActive = false;
            return;
        }

        // INSIDE instance?
        const inInstance = !!document.querySelector('#ui-exit-instance');

        // Shields OFF?
        const shieldsOff = shieldElement.classList.contains('hud-toggle--off');

        // Active targets in sensor contacts?
        const sensorList = document.querySelector('#SystemExplorer_SensorContacts_Expanded');
        const hasTargets = sensorList && (sensorList.querySelector('.ui_icon_target') !== null || sensorList.querySelector('.ui_icon_untarget') !== null);

        // Show warning ONLY when:
        // - inside instance
        // - shields OFF
        // - targets still present in sensor contacts
        if (inInstance && shieldsOff && hasTargets) {

            if (!warningActive) {

                warningActive = true;

                overlay.style.display = 'block';

                beepThreeTimes();

                console.warn('[GM] Shields are OFF inside instance!');
            }

        } else {

            warningActive = false;

            overlay.style.display = 'none';
        }
    }

    // -----------------------------------
    // Observe DOM changes
    // -----------------------------------
    const observer = new MutationObserver(() => {
        checkGameState();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true
    });

    // Initial delayed check
    setTimeout(checkGameState, 3000);

})();