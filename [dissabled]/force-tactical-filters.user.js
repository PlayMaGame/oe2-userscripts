// ==UserScript==
// @name         Force Tactical Filters ON
// @namespace    http://tampermonkey.net/
// @version      2.11
// @description  Keeps specific Tactical filters always enabled
// @match        https://game.dev.outerempires.net/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const TARGET_LABELS = [
        'Tactical Grid',
        'Projected Routing',
        'Show All',
        'Scanner Range Ring',
        'Ship Labels',
    ];

    const TOGGLE_SELECTOR = '.ui_icon_toggle, .ui_icon_toggle_off';

    const STORAGE_KEY = 'forceTacticalFiltersEnabled';

    let enabled = localStorage.getItem(STORAGE_KEY) !== 'false';

    let isProcessing = false;

    let wasInInstance = false;

    let isTacticalView = false;

    let savedZoom = null;

    const EXIT_ZOOM = 5.75;

    window.addEventListener('viewChanged', (e) => {
        isTacticalView = e.detail === 'tactical';
    });

    // --------------------------------------------------
    // Zoom helpers via PIXI viewport
    // --------------------------------------------------
    function getViewport() {
        const app = window.space_view_pixi_app;
        if (!app || !app.stage) return null;
        return app.stage.children.find(c => c.constructor.name === 'ScaleBar')?.viewport;
    }

    function getCurrentZoom() {
        const vp = getViewport();
        if (!vp || typeof vp.getZoom !== 'function') return null;
        return vp.getZoom();
    }

    function setZoom(value) {
        const vp = getViewport();
        if (!vp || typeof vp.setZoom !== 'function') return false;
        vp.setZoom(value);
        return true;
    }

    function zoomToTacticalView() {
        try {
            if (!setZoom(0.2)) return false;
            return true;
        } catch (e) {
            return false;
        }
    }

    function restoreZoom() {
        if (savedZoom !== null) {
            setZoom(savedZoom);
            savedZoom = null;
        } else {
            setZoom(EXIT_ZOOM);
        }
    }

    // --------------------------------------------------
    // Poll for PIXI viewport then zoom to tactical view
    // --------------------------------------------------
    function waitForTacticalUIThenSwitch() {
        const MAX_WAIT = 15000;
        const INTERVAL = 300;
        let elapsed = 0;

        const poll = setInterval(() => {
            elapsed += INTERVAL;

            if (zoomToTacticalView()) {
                clearInterval(poll);
                console.log('[ForceFilters] Tactical view activated after', elapsed, 'ms');
            } else if (elapsed >= MAX_WAIT) {
                clearInterval(poll);
                console.warn('[ForceFilters] Timed out waiting for PIXI viewport');
            }
        }, INTERVAL);
    }

    // --------------------------------------------------
    // Find toggle belonging to a label row
    // --------------------------------------------------
    function findRowToggle(label) {
        let node = label.parentElement;
        let depth = 0;

        while (node && depth < 6) {
            const labelsInside = node.querySelectorAll('.TacticalFilters_ItemLabel');

            if (labelsInside.length > 1) {
                return null;
            }

            const toggles = node.querySelectorAll(TOGGLE_SELECTOR);

            if (toggles.length === 1) {
                return toggles[0];
            }

            if (toggles.length > 1) {
                return null;
            }

            node = node.parentElement;
            depth++;
        }

        return null;
    }

    // --------------------------------------------------
    // Is toggle currently ON?
    // --------------------------------------------------
    function isToggleOn(toggle) {
        return !toggle.classList.contains('ui_icon_toggle_off');
    }

    // --------------------------------------------------
    // Set target filters ON/OFF
    // --------------------------------------------------
    function setTargetFilters(stateOn) {
        const labels = document.querySelectorAll('.TacticalFilters_ItemLabel');

        labels.forEach(label => {
            const text = label.textContent.trim();

            if (!TARGET_LABELS.includes(text)) return;

            const toggle = findRowToggle(label);

            if (!toggle) return;

            const currentlyOn = isToggleOn(toggle);

            if (stateOn && !currentlyOn) {
                toggle.click();
            }

            if (!stateOn && currentlyOn) {
                toggle.click();
            }
        });
    }

    // --------------------------------------------------
    // Turn off Body Labels on instance entry
    // --------------------------------------------------
    function turnOffBodyLabels() {
        const labels = document.querySelectorAll('.TacticalFilters_ItemLabel');

        labels.forEach(label => {
            if (label.textContent.trim() !== 'Body Labels') return;

            const toggle = findRowToggle(label);
            if (!toggle) return;

            if (isToggleOn(toggle)) {
                toggle.click();
            }
        });
    }

    // --------------------------------------------------
    // Click "Reset All"
    // --------------------------------------------------
    function clickResetAll() {
        const buttons = document.querySelectorAll(
            '.TacticalFilters_ResetRow button'
        );

        for (const btn of buttons) {
            if (btn.textContent.trim() === 'Reset All') {
                btn.click();
                return true;
            }
        }
        return false;
    }

    function forceOn() {

        const inInstance =
            !!document.querySelector('#ui-exit-instance');

        // JUST ENTERED INSTANCE
        if (!wasInInstance && inInstance) {
            savedZoom = getCurrentZoom();
            console.log('[ForceFilters] Saved zoom:', savedZoom);
            turnOffBodyLabels();
            waitForTacticalUIThenSwitch();
        }

        // JUST LEFT INSTANCE
        if (wasInInstance && !inInstance) {
            setTimeout(() => restoreZoom(), 300);

            if (!enabled) {
                setTimeout(() => clickResetAll(), 300);
            }
        }

        wasInInstance = inInstance;

        const shouldForce = enabled || inInstance;
        if (!shouldForce) return;
        if (isProcessing) return;

        isProcessing = true;

        try {
            const labels = document.querySelectorAll('.TacticalFilters_ItemLabel');
            if (!labels.length) {
                isProcessing = false;
                return;
            }
            setTargetFilters(true);
        } catch (e) {
            console.error('[ForceFilters] Error:', e);
        }

        isProcessing = false;
    }

    // --------------------------------------------------
    // UI BUTTON
    // --------------------------------------------------
    function injectToggleButton() {
        const header = document.querySelector('#TacticalFilters_Header');
        if (!header) return;
        if (document.querySelector('#ForceFiltersToggleBtn')) return;

        const btn = document.createElement('span');
        btn.id = 'ForceFiltersToggleBtn';
        btn.textContent = ' [T]';
        btn.style.cursor = 'pointer';
        btn.style.fontWeight = 'bold';
        btn.style.marginLeft = '6px';
        btn.style.userSelect = 'none';

        function refreshButton() {
            btn.style.color = enabled ? '#00ff66' : '#ff5555';
            btn.title = enabled
                ? 'Force Tactical Filters: ON'
                : 'Force Tactical Filters: OFF';
        }

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            enabled = !enabled;
            localStorage.setItem(STORAGE_KEY, enabled);
            refreshButton();

            if (enabled) {
                setTimeout(() => setTargetFilters(true), 100);
            } else {
                setTimeout(() => clickResetAll(), 100);
            }
        });

        refreshButton();
        header.appendChild(btn);
    }

    // --------------------------------------------------
    // Debounced observer
    // --------------------------------------------------
    let debounceTimer = null;

    function scheduleCheck() {
        injectToggleButton();

        if (debounceTimer) clearTimeout(debounceTimer);

        debounceTimer = setTimeout(() => {
            forceOn();
            setTimeout(forceOn, 250);
            setTimeout(forceOn, 750);
            setTimeout(forceOn, 1500);
        }, 100);
    }

    // --------------------------------------------------
    // Startup
    // --------------------------------------------------
    setTimeout(() => {
        injectToggleButton();
        if (enabled) forceOn();
    }, 1500);

    setInterval(() => {
        injectToggleButton();
        if (enabled) forceOn();
    }, 3000);

    const observer = new MutationObserver(scheduleCheck);
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

})();
