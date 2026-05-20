// ==UserScript==
// @name         Exit Countdown Beep
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Slow beep when exit countdown reaches 5-1
// @author       You
// @match        https://game.dev.outerempires.net/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let audioCtx = null;

    function initAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    function beep(val) {
        initAudio();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.value = 440;
        const volMap = { 5: 0.01, 4: 0.015, 3: 0.02, 2: 0.025, 1: 0.03 };
        gain.gain.value = volMap[val] ?? 0.03;
        osc.start();
        osc.stop(audioCtx.currentTime + 0.15);
    }

    // Unlock audio on first user interaction
    document.addEventListener('click', initAudio, { once: true });
    document.addEventListener('keydown', initAudio, { once: true });

    function hasActiveTargets() {
        const sensorList = document.querySelector('#SystemExplorer_SensorContacts_Expanded');
        return sensorList && (sensorList.querySelector('.ui_icon_target') !== null || sensorList.querySelector('.ui_icon_untarget') !== null);
    }

    let lastVal = null;

    const observer = new MutationObserver(() => {
        const el = document.querySelector('.exit-instance-overlay-countdown');
        if (!el) return;
        const val = el.textContent.trim();
        if (/^[12345]$/.test(val) && val !== lastVal && hasActiveTargets()) {
            lastVal = val;
            console.log('[ExitBeep] countdown:', val);
            beep(val);
        } else if (!/^[12345]$/.test(val)) {
            lastVal = null;
        }
    });

    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
})();