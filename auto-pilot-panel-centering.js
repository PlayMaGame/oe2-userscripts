// ==UserScript==
// @name         Outer Empires 2 - Auto-Pilot Panel Centering
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Center the map info panel at the top of the screen
// @match        https://game.dev.outerempires.net/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Function to center the map info panel
    function centerMapInfoPanel() {
        const mapInfoPanel = document.getElementById('map-info-panel');
        if (mapInfoPanel) {
            mapInfoPanel.style.position = 'fixed';
            mapInfoPanel.style.top = '20px';
            mapInfoPanel.style.left = '50%';
            mapInfoPanel.style.transform = 'translateX(-50%)';
            mapInfoPanel.style.zIndex = '1000';
        }
    }

    // Run the centering function when the page loads
    window.addEventListener('load', centerMapInfoPanel);

    // Optional: Re-center if the panel appears dynamically
    const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.addedNodes.length) {
                centerMapInfoPanel();
            }
        });
    });

    // Start observing the body for changes
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();