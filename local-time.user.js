// ==UserScript==
// @name         Location Panel Hider
// @namespace    http://tampermonkey.net/
// @version      2.2
// @description  Hide location panel and add custom overlay with local time
// @match        https://game.dev.outerempires.net/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const CUSTOM_ID = 'oe-location-custom';

    function makeCustom() {
        const div = document.createElement('div');
        div.id = CUSTOM_ID;
        div.style.cssText = 'display:flex;align-items:center;gap:22px;color:#fff;font-family:Arial,sans-serif;text-shadow:0 0 8px #000,0 0 16px #000,0 2px 4px #000;font-size:13px;pointer-events:none;user-select:none;margin:8px 0 0 35px;';

        const name = document.createElement('span');
        name.style.cssText = 'font-size:16px;font-weight:700;';
        name.textContent = 'Twitch.tv/WekizZ';

        const info = document.createElement('span');
        info.style.cssText = 'display:flex;align-items:center;gap:6px;opacity:.9;margin-left:300px;';

        const timeSpan = document.createElement('span');
        timeSpan.className = CUSTOM_ID + '-time';
        timeSpan.textContent = new Date().toLocaleTimeString('nb-NO', { timeZone: 'Europe/Oslo' });
        info.appendChild(timeSpan);

        div.appendChild(name);
        div.appendChild(info);
        return div;
    }

    function sync() {
        const panel = document.querySelector('#ui_location_details_top');
        if (panel) panel.style.setProperty('display', 'none', 'important');

        const container = document.querySelector('#ui_top_right');
        if (!container) return;

        let el = document.getElementById(CUSTOM_ID);
        if (!el) {
            el = makeCustom();
            const ref = document.querySelector('#ui_location_details_top');
            if (ref && ref.parentNode === container) {
                container.insertBefore(el, ref);
            } else {
                container.appendChild(el);
            }
        }
    }

    function tick() {
        const el = document.querySelector('.' + CUSTOM_ID + '-time');
        if (el) el.textContent = new Date().toLocaleTimeString('nb-NO', { timeZone: 'Europe/Oslo' });
    }

    function boot() {
        sync();
        setInterval(tick, 1000);
        new MutationObserver(sync).observe(document.documentElement, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
