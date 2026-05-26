// ==UserScript==
// @name         HUD Layer Killer
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Hide HUD elements (DOM z-index, PixiJS ScaleBar, PixiJS named containers). F1 toggle. Auto-hide on tab switch.
// @match        https://game.dev.outerempires.net/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const Z_INDEX_LIMIT = 201;
    const PERMA_HIDE_NAMES = ['controls'];
    const PERMA_HIDE_DOM_SELECTORS = [];
    const REHIDE_DOM_SELECTORS = ['#ui-ship-hud', '.TacticalFilters_ItemLabel', '#oe2-vital-overlay', '#oe2-vital-reopen', '.vtg'];
    const JUMP_LANE_LABEL = 'Jump Lanes';
    const TOGGLE_SELECTOR = '.ui_icon_toggle, .ui_icon_toggle_off';
    let savedJumpLaneState = false;

    let enabled = false;
    const modified = [];
    const pixiHidden = [];

    function getPixiApp() {
        return window.space_view_pixi_app || globalThis.__PIXI_APP__ || null;
    }

    function findPixiTargets(app) {
        if (!app || !app.stage) return { toggle: [], perma: [] };
        const toggle = [];
        const perma = [];
        for (const child of app.stage.children) {
            const name = child.constructor && child.constructor.name;
            if (name === 'ScaleBar') toggle.push(child);
            if (child.name && PERMA_HIDE_NAMES.includes(child.name)) perma.push(child);
        }
        return { toggle, perma };
    }

    function isInInstance() {
        return !!document.querySelector('#ui-exit-instance');
    }

    function hidePixiToggle() {
        pixiHidden.length = 0;
        const app = getPixiApp();
        if (!app) return;
        const { toggle } = findPixiTargets(app);
        for (const obj of toggle) {
            if (obj.visible) {
                pixiHidden.push(obj);
                obj.visible = false;
            }
        }
    }

    function restorePixiToggle() {
        for (const obj of pixiHidden) {
            obj.visible = true;
        }
        pixiHidden.length = 0;
    }

    function enforcePermaHidden() {
        const app = getPixiApp();
        if (!app) return;
        const { perma } = findPixiTargets(app);
        for (const obj of perma) {
            if (obj.visible) obj.visible = false;
        }
    }

    function isToggleOn(toggle) {
        return !toggle.classList.contains('ui_icon_toggle_off');
    }

    function findJumpLaneToggle() {
        const labels = document.querySelectorAll('.TacticalFilters_ItemLabel');
        for (const label of labels) {
            if (label.textContent.trim() !== JUMP_LANE_LABEL) continue;
            let node = label.parentElement;
            let depth = 0;
            while (node && depth < 6) {
                const toggles = node.querySelectorAll(TOGGLE_SELECTOR);
                if (toggles.length === 1) return toggles[0];
                node = node.parentElement;
                depth++;
            }
        }
        return null;
    }

    function enforcePermaDomHidden() {
        for (const sel of PERMA_HIDE_DOM_SELECTORS) {
            for (const el of document.querySelectorAll(sel)) {
                if (el.style.display !== 'none') {
                    el.style.setProperty('display', 'none', 'important');
                }
            }
        }
    }

    function enforceRehideDom() {
        if (!enabled) return;
        for (const sel of REHIDE_DOM_SELECTORS) {
            for (const el of document.querySelectorAll(sel)) {
                el.style.setProperty('display', 'none', 'important');
            }
        }
    }

    function hideLayers() {
        modified.length = 0;
        document.querySelectorAll('*').forEach(el => {
            const style = getComputedStyle(el);
            const z = parseInt(style.zIndex);
            if (!isNaN(z) && z >= Z_INDEX_LIMIT && style.display !== 'none') {
                modified.push({ el, oldDisplay: el.style.display });
                el.style.setProperty('display', 'none', 'important');
            }
        });
        const extras = document.querySelectorAll('#ui_playversion_display, #ui-ship-hud, .TacticalFilters_ItemLabel, #oe2-vital-overlay, #oe2-vital-reopen, .vtg');
        for (const el of extras) {
            if (el.style.display !== 'none') {
                modified.push({ el, oldDisplay: el.style.display });
                el.style.setProperty('display', 'none', 'important');
            }
        }
        hidePixiToggle();
        enforcePermaHidden();
        enforcePermaDomHidden();
        enforceRehideDom();
        const jlToggle = findJumpLaneToggle();
        if (jlToggle) {
            savedJumpLaneState = isToggleOn(jlToggle);
            if (savedJumpLaneState) jlToggle.click();
        }
    }

    function restoreLayers() {
        modified.forEach(item => {
            item.el.style.display = item.oldDisplay;
        });
        restorePixiToggle();
        if (savedJumpLaneState) {
            const jlToggle = findJumpLaneToggle();
            if (jlToggle && !isToggleOn(jlToggle)) jlToggle.click();
            savedJumpLaneState = false;
        }
        // permaHidden targets are NOT restored — they stay hidden
    }

    function hide() {
        if (enabled) return;
        enabled = true;
        hideLayers();
    }

    function show() {
        if (!enabled) return;
        enabled = false;
        restoreLayers();
    }

    // Re-enforce hidden targets every 2s (Lit re-renders can re-create DOM nodes)
    setInterval(() => {
        enforcePermaHidden();
        enforcePermaDomHidden();
        enforceRehideDom();
    }, 2000);

    // F1 toggle
    document.addEventListener('keydown', (e) => {
        if (e.key === 'F1') {
            e.preventDefault();
            if (enabled) show();
            else hide();
        }
    });

    console.log(`
========================================
HUD Layer Killer v3

F1 = Toggle
Permanently hides PixiJS containers named
in PERMA_HIDE_NAMES (default: controls)
Also hides ScaleBar, #ui_playversion_display,
#ui-ship-hud, .TacticalFilters_ItemLabel,
and DOM z-index >= ${Z_INDEX_LIMIT}
========================================
`);
})();
