// ==UserScript==
// @name         AFK Warning (Instance)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Flash, beep, and warn when AFK for 15s inside an instance
// @match        https://game.dev.outerempires.net/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const AFK_TIMEOUT = 15000;
    const BEEP_INTERVAL = 2000;
    const CHECK_INTERVAL = 1000;

    let lastActivity = Date.now();
    let isAfk = false;
    let audioCtx = null;
    let warnInterval = null;
    let flashInterval = null;

    const overlay = document.createElement('div');
    overlay.textContent = '⚠ AFK ⚠';
    Object.assign(overlay.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        background: 'rgba(255, 0, 0, 0.35)',
        color: '#fff',
        fontSize: '120px',
        fontWeight: 'bold',
        display: 'none',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: '9999999',
        pointerEvents: 'none',
        textShadow: '0 0 50px red, 0 0 100px red',
        fontFamily: 'Arial, sans-serif',
    });
    document.body.appendChild(overlay);

    function initAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    function beep() {
        initAudio();
        for (let i = 0; i < 3; i++) {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'square';
            osc.frequency.value = 950 + (i * 120);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            const start = audioCtx.currentTime + (i * 0.25);
            gain.gain.setValueAtTime(0.08, start);
            osc.start(start);
            osc.stop(start + 0.15);
        }
    }

    function startWarning() {
        if (isAfk) return;
        isAfk = true;
        console.warn('[AFK] Player went AFK!');
        overlay.style.display = 'flex';
        beep();
        warnInterval = setInterval(beep, BEEP_INTERVAL);
        flashInterval = setInterval(() => {
            overlay.style.background = overlay.style.background === 'rgba(255, 0, 0, 0.35)'
                ? 'rgba(255, 0, 0, 0.6)'
                : 'rgba(255, 0, 0, 0.35)';
        }, 500);
        try { window.focus(); } catch (e) {}
    }

    function stopWarning() {
        isAfk = false;
        overlay.style.display = 'none';
        overlay.style.background = 'rgba(255, 0, 0, 0.35)';
        if (warnInterval) { clearInterval(warnInterval); warnInterval = null; }
        if (flashInterval) { clearInterval(flashInterval); flashInterval = null; }
    }

    function isInInstance() {
        return !!document.querySelector('#ui-exit-instance');
    }

    function hasActiveTargets() {
        const sensorList = document.querySelector('#SystemExplorer_SensorContacts_Expanded');
        return sensorList && (sensorList.querySelector('.ui_icon_target') !== null || sensorList.querySelector('.ui_icon_untarget') !== null);
    }

    function isRecentlyAttacking() {
        const container = document.getElementById('ui_chat_output_SysLogs::Combat');
        if (!container) return false;
        const msgs = container.querySelectorAll('.ui_chat_log_message');
        for (const msg of msgs) {
            if (/You deal \d+ points of/.test(msg.textContent)) {
                return true;
            }
        }
        return false;
    }

    function recordActivity() {
        lastActivity = Date.now();
        if (isAfk) stopWarning();
    }

    function checkAfk() {
        if (!isInInstance()) {
            if (isAfk) stopWarning();
            return;
        }

        if (isRecentlyAttacking() || hasActiveTargets()) {
            recordActivity();
            return;
        }

        if (Date.now() - lastActivity >= AFK_TIMEOUT && !isAfk) {
            startWarning();
        }
    }

    ['mousemove', 'mousedown', 'click', 'keydown', 'keyup', 'wheel', 'touchstart', 'touchmove', 'scroll'].forEach(evt => {
        document.addEventListener(evt, recordActivity, { passive: true });
    });

    const combatObserver = new MutationObserver(() => {
        if (isInInstance() && isRecentlyAttacking()) {
            recordActivity();
        }
    });

    function init() {
        const container = document.getElementById('ui_chat_output_SysLogs::Combat');
        if (container) {
            combatObserver.observe(container, { childList: true, subtree: true });
        }
        document.addEventListener('click', initAudio, { once: true });
        document.addEventListener('keydown', initAudio, { once: true });
    }

    setInterval(checkAfk, CHECK_INTERVAL);
    setTimeout(init, 3000);
})();
