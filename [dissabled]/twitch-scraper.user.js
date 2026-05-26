// ==UserScript==
// @name         Twitch Follower Sender
// @namespace    shared-followers
// @version      2.0
// @match        https://dashboard.twitch.tv/*
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {

    'use strict';

    console.log('[TWITCH] STARTED');

    const processedFollowers = new Set();

    function sendFollower(username) {

        if (!username) return;

        const payload = {
            username: username,
            time: new Date().toISOString(),
            stamp: Date.now()
        };

        console.log('[TWITCH] SENDING:', payload);

        GM_setValue(
            'latestFollower',
            JSON.stringify(payload)
        );
    }

    function scrapeFollowers() {

        const items = document.querySelectorAll(
            '.activity-base-list-item'
        );

        items.forEach(item => {

            try {

                const usernameElement =
                    item.querySelector(
                        '.activity-base-list-item__title button'
                    );

                const subtitle =
                    item.querySelector(
                        '.activity-base-list-item__subtitle'
                    );

                if (!usernameElement || !subtitle) {
                    return;
                }

                const subtitleText =
                    subtitle.textContent
                        .toLowerCase();

                if (!subtitleText.includes('followed')) {
                    return;
                }

                const username =
                    usernameElement.textContent
                        .trim();

                if (!username) {
                    return;
                }

                if (processedFollowers.has(username)) {
                    return;
                }

                processedFollowers.add(username);

                sendFollower(username);

            } catch (err) {

                console.error(
                    '[TWITCH] ERROR:',
                    err
                );

            }

        });

    }

    // initial scan
    setTimeout(scrapeFollowers, 3000);

    // keep checking
    setInterval(scrapeFollowers, 5000);

})();