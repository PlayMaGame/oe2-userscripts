// ==UserScript==
// @name         Game Follower Receiver
// @namespace    shared-followers
// @version      2.0
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {

    'use strict';

    console.log('[GAME] STARTED');

    let lastProcessedStamp = 0;

    function processFollower(data) {

        console.log(
            '[GAME] NEW FOLLOWER:',
            data.username
        );

        // =====================================
        // PUT YOUR GAME ACTION HERE
        // =====================================

        // Example:
        // spawnShip(data.username);
        // addCoins(100);
        // triggerAnimation();

    }

    function checkFollower() {

        try {

            const raw =
                GM_getValue(
                    'latestFollower',
                    null
                );

            if (!raw) {
                return;
            }

            const data = JSON.parse(raw);

            if (!data) {
                return;
            }

            if (!data.stamp) {
                return;
            }

            if (
                data.stamp === lastProcessedStamp
            ) {
                return;
            }

            lastProcessedStamp =
                data.stamp;

            processFollower(data);

        } catch (err) {

            console.error(
                '[GAME] CHECK ERROR:',
                err
            );

        }

    }

    setInterval(
        checkFollower,
        1000
    );

})();