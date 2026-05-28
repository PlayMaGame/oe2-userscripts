// ==UserScript==
// @name         OE2 Movie Pause Receiver
// @namespace    https://localhost/
// @version      5.0
// @description  [MEDIA PC] Controls video via MQTT, reports state back in real-time
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    var s = document.createElement('script');
    s.src = 'https://unpkg.com/mqtt@5.10.3/dist/mqtt.min.js';
    s.onload = function () {
        var client = mqtt.connect('wss://broker.emqx.io:8084/mqtt', {
            clientId: 'oe2-rx-' + Math.random().toString(36).slice(2, 10),
        });
        var reported = {};

        function report(state) {
            if (reported.state === state) return;
            reported.state = state;
            client.publish('oe2/state', state);
            console.log('[MoviePause-Rx] state:', state);
        }

        function watchVideo(v) {
            if (v._oeWatched) return;
            v._oeWatched = true;
            v.addEventListener('play', function () { report('playing'); });
            v.addEventListener('pause', function () { report('paused'); });
        }

        function scanVideos() {
            var videos = document.querySelectorAll('video');
            for (var i = 0; i < videos.length; i++) {
                watchVideo(videos[i]);
                // Report current state on first scan
                if (!reported.initial) {
                    report(videos[i].paused ? 'paused' : 'playing');
                }
            }
            reported.initial = true;
        }

        client.on('connect', function () {
            client.subscribe('oe2/pause');
            // Initial scan after connection
            scanVideos();
            // Keep scanning for dynamically added videos
            setInterval(scanVideos, 2000);
        });

        client.on('message', function (topic, msg) {
            var cmd = msg.toString();
            var videos = document.querySelectorAll('video');
            if (videos.length === 0) return;
            for (var i = 0; i < videos.length; i++) {
                var v = videos[i];
                if (cmd === 'pause' && !v.paused) {
                    v.pause();
                } else if (cmd === 'resume' && v.paused) {
                    v.play()['catch'](function () {});
                }
            }
        });
    };
    document.head.appendChild(s);
})();
