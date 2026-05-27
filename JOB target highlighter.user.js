// ==UserScript==
// @name         OE2 - Stable Job Highlighter
// @namespace    https://game.dev.outerempires.net/
// @version      4.0
// @description  Stable ship target highlighting for OE2 jobs
// @match        https://game.dev.outerempires.net/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // --------------------------------------------------
    // CONFIG
    // --------------------------------------------------

    const shipColors = {
        'Heavy Shuttle': '#ef4444',
        'Interceptor': '#22c55e',
        'Fighter Bomber': '#f59e0b',
        'Scout': '#22c55e',
        'Sentry': '#ef4444',
        'Patrol': '#3b82f6',
    };

    function getTargetColor(ship, count) {
        if (ship === 'Sentry') {
            const n = parseInt(count, 10);
            return n >= 3 ? '#ef4444' : n === 2 ? '#eab308' : '#22c55e';
        }
        if (ship === 'Patrol') {
            const n = parseInt(count, 10);
            return n >= 4 ? '#ef4444' : n === 3 ? '#eab308' : '#3b82f6';
        }
        return shipColors[ship] || '#ffffff';
    }

    // --------------------------------------------------
    // PREP
    // --------------------------------------------------

    const shipTypes = Object.keys(shipColors)
        .sort((a, b) => b.length - a.length);

    const escaped = shipTypes.map(t =>
        t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    );

    // Matches:
    // 1 x Scout
    // 3x Patrol
    // 12 x Heavy Shuttle
    const regex = new RegExp(
        `(\\d+)\\s*x\\s*(${escaped.join('|')})`,
        'gi'
    );

    // --------------------------------------------------
    // PROCESS TEXT NODE
    // --------------------------------------------------

    function processTextNode(node) {

        // safety
        if (!node || !node.parentNode) {
            return;
        }

        // don't process inside highlights
        if (
            node.parentElement &&
            node.parentElement.classList.contains('oe2-target-highlight')
        ) {
            return;
        }

        const text = node.nodeValue;

        if (!text || !text.trim()) {
            return;
        }

        regex.lastIndex = 0;

        // no matches
        if (!regex.test(text)) {
            return;
        }

        regex.lastIndex = 0;

        const frag = document.createDocumentFragment();

        let lastIndex = 0;
        let match;

        while ((match = regex.exec(text)) !== null) {

            // preserve text before match
            if (match.index > lastIndex) {

                frag.appendChild(
                    document.createTextNode(
                        text.slice(lastIndex, match.index)
                    )
                );
            }

            const fullMatch = match[0];
            const count = match[1];
            const ship = match[2];

            const key =
                shipTypes.find(
                    t => t.toLowerCase() === ship.toLowerCase()
                ) || ship;

            const color = getTargetColor(key, count);

            // create highlight span
            const span = document.createElement('span');

            span.className = 'oe2-target-highlight';

            // preserve ORIGINAL spacing/text exactly
            span.textContent = fullMatch;

            // minimal styling to avoid layout issues
            span.style.color = color;
            span.style.fontWeight = 'bold';
            span.style.textShadow = `0 0 3px ${color}`;

            frag.appendChild(span);

            lastIndex = match.index + fullMatch.length;
        }

        // remaining text after last match
        if (lastIndex < text.length) {

            frag.appendChild(
                document.createTextNode(
                    text.slice(lastIndex)
                )
            );
        }

        // replace original text node
        node.parentNode.replaceChild(frag, node);
    }

    // --------------------------------------------------
    // PROCESS SINGLE JOB
    // --------------------------------------------------

    function processJobElement(el) {

        // already processed
        if (el.dataset.oe2Processed === '1') {
            return;
        }

        // wait until content exists
        if (!el.textContent || !el.textContent.trim()) {
            return;
        }

        const walker = document.createTreeWalker(
            el,
            NodeFilter.SHOW_TEXT,
            null
        );

        const textNodes = [];

        let node;

        while ((node = walker.nextNode())) {
            textNodes.push(node);
        }

        textNodes.forEach(processTextNode);

        // mark processed
        el.dataset.oe2Processed = '1';
    }

    // --------------------------------------------------
    // PROCESS ALL JOBS
    // --------------------------------------------------

    function processJobs() {

        const descriptions = document.querySelectorAll(
            '.JobItem_Detail .text_justified'
        );

        descriptions.forEach(processJobElement);
    }

    // --------------------------------------------------
    // DEBOUNCED REFRESH
    // --------------------------------------------------

    let refreshTimer = null;

    function scheduleRefresh() {

        clearTimeout(refreshTimer);

        // longer delay lets OE fully render jobs first
        refreshTimer = setTimeout(() => {

            // wait one more frame after render
            requestAnimationFrame(() => {
                processJobs();
            });

        }, 500);
    }

    // --------------------------------------------------
    // INITIAL RUN
    // --------------------------------------------------

    scheduleRefresh();

    // --------------------------------------------------
    // OBSERVER
    // --------------------------------------------------

    const observer = new MutationObserver((mutations) => {

        for (const mu of mutations) {

            // only care about added nodes
            if (!mu.addedNodes || mu.addedNodes.length === 0) {
                continue;
            }

            for (const node of mu.addedNodes) {

                // element nodes only
                if (node.nodeType !== 1) {
                    continue;
                }

                // ignore our own highlights
                if (
                    node.classList &&
                    node.classList.contains('oe2-target-highlight')
                ) {
                    continue;
                }

                // direct match
                if (
                    node.matches &&
                    node.matches('.JobItem_Detail .text_justified')
                ) {

                    scheduleRefresh();
                    return;
                }

                // nested match
                if (
                    node.querySelector &&
                    node.querySelector('.JobItem_Detail .text_justified')
                ) {

                    scheduleRefresh();
                    return;
                }
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });

})();