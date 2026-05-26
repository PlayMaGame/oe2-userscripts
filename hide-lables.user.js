// ==UserScript==
// @name         Force Space Labels OFF
// @namespace    http://tampermonkey.net/
// @version      6.0
// @description  Cycle Ship/Body labels with F2
// @match        https://game.dev.outerempires.net/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const TARGET_LABELS = [
        'Ship Labels',
        'Body Labels'
    ];

    const TOGGLE_SELECTOR =
        '.ui_icon_toggle, .ui_icon_toggle_off';

    const STORAGE_KEY = 'forceSpaceLabelsMode';

    /*
        MODES

        0:
        Ship OFF
        Body OFF

        1:
        Ship ON
        Body OFF

        2:
        Ship ON
        Body ON

    */

    let mode = 0;

    function logMode() {

        switch (mode) {

            case 0:
                console.log('[Labels] Mode 0: ALL OFF');
                break;

            case 1:
                console.log('[Labels] Mode 1: SHIP ONLY');
                break;

            case 2:
                console.log('[Labels] Mode 2: ALL ON');
                break;
        }
    }

    function shouldBeVisible(labelText) {

        switch (mode) {

            case 0:
                return false;

            case 1:
                return labelText === 'Ship Labels';

            case 2:
                return true;

            default:
                return false;
        }
    }

    function getLabelNodes() {

        return [...document.querySelectorAll('div')]
            .filter(el => {
                const text = el.textContent?.trim();
                return TARGET_LABELS.includes(text);
            });
    }

    function findRowToggle(label) {

        let node = label.parentElement;
        let depth = 0;

        while (node && depth < 6) {

            const toggles =
                node.querySelectorAll(TOGGLE_SELECTOR);

            if (toggles.length > 0) {
                return toggles[0];
            }

            node = node.parentElement;
            depth++;
        }

        return null;
    }

    function isToggleEnabled(toggle) {

        return (
            toggle.classList.contains('ui_icon_toggle') &&
            !toggle.classList.contains('ui_icon_toggle_off')
        );
    }

    function applyLabels() {

        const labels = getLabelNodes();

        labels.forEach(label => {

            const text =
                label.textContent?.trim();

            if (!text) return;

            const toggle =
                findRowToggle(label);

            if (!toggle) return;

            const current =
                isToggleEnabled(toggle);

            const target =
                shouldBeVisible(text);

            if (current !== target) {

                console.log(
                    `[Labels] ${target ? 'ON' : 'OFF'}: ${text}`
                );

                toggle.click();
            }
        });
    }

    function applyWithRetries() {

        applyLabels();
        setTimeout(applyLabels, 300);
        setTimeout(applyLabels, 1000);
    }

    // F2 cycles modes
    document.addEventListener('keydown', (e) => {

        if (e.key !== 'F2') return;

        e.preventDefault();
        e.stopPropagation();

        mode = (mode + 1) % 3;

        localStorage.setItem(
            STORAGE_KEY,
            mode
        );

        logMode();
        applyWithRetries();

    }, true);

    // Initial apply after UI loads
    window.addEventListener('load', () => {

        setTimeout(() => {

            mode = parseInt(
                localStorage.getItem(STORAGE_KEY) || '0',
                10
            );

            logMode();
            applyWithRetries();

        }, 1500);

    });

})();
