// ==UserScript==
// @name         OE2 Movie Auto-Pause
// @namespace    https://game.dev.outerempires.net/
// @version      5.0
// @description  Pause/resume media PC video via MQTT, shows video state on button
// @match        https://game.dev.outerempires.net/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    var MQTT_URL = 'wss://broker.emqx.io:8084/mqtt';
    var CID = 'oe2-' + Math.random().toString(36).slice(2, 10);
    var ws = null;
    var connected = false;
    var videoPaused = false;  // tracks media PC video state
    var pending = [];

    function connect() {
        ws = new WebSocket(MQTT_URL, 'mqtt');
        ws.binaryType = 'arraybuffer';

        ws.onopen = function () {
            // CONNECT packet
            var cid = strbin(CID);
            var rlen = 12 + cid.length;
            var buf = new ArrayBuffer(2 + rlen);
            var dv = new DataView(buf);
            dv.setUint8(0, 0x10);
            dv.setUint8(1, rlen);
            dv.setUint16(2, 4);
            writeStr(dv, 4, 'MQTT');
            dv.setUint8(8, 4);
            dv.setUint8(9, 2);
            dv.setUint16(10, 60);
            dv.setUint16(12, cid.length);
            writeBuf(dv, 14, cid);
            ws.send(buf);
        };

        ws.onmessage = function (evt) {
            var arr = new Uint8Array(evt.data);
            if (arr.length < 2) return;
            var type = arr[0] >> 4;

            if (type === 2) {  // CONNACK
                connected = true;
                console.log('[MoviePause] MQTT connected');
                subscribe('oe2/state');
                while (pending.length) doPub(pending.shift());
            }
            else if (type === 3) {  // PUBLISH (incoming)
                var pos = 2; // skip fixed header + remaining length (assumes <128)
                var tlen = (arr[pos] << 8) | arr[pos + 1]; pos += 2;
                var topic = '';
                for (var i = 0; i < tlen; i++) topic += String.fromCharCode(arr[pos + i]);
                pos += tlen;
                var payload = '';
                for (var i = pos; i < arr.length; i++) payload += String.fromCharCode(arr[i]);

                if (topic === 'oe2/state') {
                    videoPaused = (payload === 'paused');
                    updateBtn();
                    console.log('[MoviePause] media state:', payload);
                }
            }
        };

        ws.onclose = function () {
            connected = false;
            setTimeout(connect, 5000);
        };
    }

    function subscribe(topic) {
        var t = strbin(topic);
        var pktId = 1;
        var rlen = 2 + 2 + t.length + 1; // pktId + topic len + topic + QoS
        var buf = new ArrayBuffer(2 + rlen);
        var dv = new DataView(buf);
        dv.setUint8(0, 0x82); // SUBSCRIBE
        dv.setUint8(1, rlen);
        dv.setUint16(2, pktId);
        dv.setUint16(4, t.length);
        writeBuf(dv, 6, t);
        dv.setUint8(6 + t.length, 0); // QoS 0
        ws.send(buf);
    }

    function doPub(cmd) {
        var t = strbin('oe2/pause');
        var p = strbin(cmd);
        var rlen = 2 + t.length + p.length;
        var buf = new ArrayBuffer(2 + rlen);
        var dv = new DataView(buf);
        dv.setUint8(0, 0x30);
        dv.setUint8(1, rlen);
        dv.setUint16(2, t.length);
        writeBuf(dv, 4, t);
        writeBuf(dv, 4 + t.length, p);
        ws.send(buf);
    }

    function send(cmd) {
        if (connected) {
            doPub(cmd);
            console.log('[MoviePause] sent:', cmd);
        } else {
            pending.push(cmd);
        }
    }

    function updateBtn() {
        btn.textContent = videoPaused ? '▶' : '❚❚';
        btn.style.background = videoPaused ? '#27ae60' : '#e74c3c';
    }

    function strbin(s) { return new TextEncoder().encode(s); }
    function writeStr(dv, pos, s) { writeBuf(dv, pos, strbin(s)); }
    function writeBuf(dv, pos, u) { for (var i = 0; i < u.length; i++) dv.setUint8(pos + i, u[i]); }

    // Button — inline after the Twitch span
    var btn = document.createElement('div');
    btn.textContent = '?';
    btn.title = 'Media PC video state (click to toggle)';
    btn.style.cssText = 'display:inline-block !important;cursor:pointer !important;pointer-events:auto !important;padding:2px 8px;margin-left:10px;position:relative;top:-2px;font-size:14px;font-family:sans-serif;border-radius:3px;background:#888;color:#fff;user-select:none;z-index:99999;';
    btn.onclick = function () {
        var cmd = videoPaused ? 'resume' : 'pause';
        console.log('[MoviePause] click ->', cmd);
        send(cmd);
    };

    var autoBtn, autoEnabled = true;

    function placeBtn() {
        var tw = document.querySelector('span[style*="font-size: 16px"][style*="font-weight: 700"]');
        if (tw && tw.textContent.indexOf('Twitch') !== -1) {
            tw.parentNode.insertBefore(btn, tw.nextSibling);
            // Place auto toggle after state button
            if (!autoBtn) {
                autoBtn = document.createElement('div');
                autoBtn.textContent = 'AUTO';
                autoBtn.title = 'Toggle auto pause/resume';
                autoBtn.style.cssText = 'display:inline-block !important;cursor:pointer !important;pointer-events:auto !important;padding:2px 6px;margin-left:4px;position:relative;top:-2px;font-size:11px;font-family:sans-serif;border-radius:3px;background:#27ae60;color:#fff;user-select:none;z-index:99999;font-weight:700;';
                autoBtn.onclick = function () {
                    autoEnabled = !autoEnabled;
                    autoBtn.style.background = autoEnabled ? '#27ae60' : '#888';
                    autoBtn.textContent = autoEnabled ? 'AUTO' : 'MAN';
                    console.log('[MoviePause] auto:', autoEnabled);
                };
                btn.parentNode.insertBefore(autoBtn, btn.nextSibling);
            }
            return true;
        }
        return false;
    }
    if (!placeBtn()) {
        var wait = setInterval(function () {
            if (placeBtn()) clearInterval(wait);
        }, 1000);
    }

    connect();

    var inInstance = false;
    var pauseTimer = null;
    var resumedOnElim = false;

    setInterval(function () {
        var m = document.title.match(/#(\d+)/);
        if (!autoEnabled) return;

        var panel = document.getElementById('oe2-bounty-panel');
        var allDone = panel && panel.textContent.indexOf('ALL ELIMINATED') !== -1;

        // Entered instance — pause after 7s delay
        if (m && !inInstance) {
            inInstance = true;
            resumedOnElim = false;
            if (!allDone) {
                pauseTimer = setTimeout(function () { send('pause'); pauseTimer = null; }, 7000);
            }
        }

        // ALL ELIMINATED — resume after 3s delay
        if (allDone && inInstance && !resumedOnElim) {
            resumedOnElim = true;
            if (pauseTimer) { clearTimeout(pauseTimer); pauseTimer = null; }
            pauseTimer = setTimeout(function () { send('resume'); pauseTimer = null; }, 3000);
        }

        // New targets after elimination — start 7s timer
        if (!allDone && inInstance && resumedOnElim && !pauseTimer) {
            resumedOnElim = false;
            pauseTimer = setTimeout(function () { send('pause'); pauseTimer = null; }, 7000);
        }

        // Left instance — resume
        if (!m && inInstance) {
            inInstance = false;
            resumedOnElim = false;
            if (pauseTimer) { clearTimeout(pauseTimer); pauseTimer = null; }
            send('resume');
        }
    }, 1000);
})();
