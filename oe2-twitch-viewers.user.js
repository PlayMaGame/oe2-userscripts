// ==UserScript==
// @name         OE2 Twitch Viewers
// @namespace    https://game.dev.outerempires.net/
// @version      2.2
// @description  Twitch viewer count in ui_character_detail, right-aligned
// @match        https://game.dev.outerempires.net/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    var CFG_KEY_CHANNEL   = 'oe2_ttv_channel';
    var CFG_KEY_CLIENT_ID = 'oe2_ttv_client_id';
    var SHARED_TOKEN_KEY  = '_oe2_tt';
    var POLL_INTERVAL     = 30000;

    var pollTimer = null;
    var viewerCount = null;
    var isLive = false;
    var viewerEl = null;
    var containerEl = null;

    function getSharedToken() {
        try {
            var d = JSON.parse(localStorage.getItem(SHARED_TOKEN_KEY) || 'null');
            if (d && d.token && d.expiresAt > Date.now()) return d.token;
        } catch (e) {}
        return null;
    }
    function getClientId() { return localStorage.getItem(CFG_KEY_CLIENT_ID) || ''; }
    function getChannel()  { return localStorage.getItem(CFG_KEY_CHANNEL) || ''; }

    var TWITCH_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="#9146ff" style="display:block;"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>';

    function injectViewerEl() {
        containerEl = document.getElementById('ui_character_detail');
        if (!containerEl) return false;
        containerEl.style.display = 'flex';
        containerEl.style.alignItems = 'center';
        viewerEl = document.createElement('span');
        viewerEl.id = 'oe2-ttv-count';
        viewerEl.style.cssText = 'margin-left:auto;display:flex;align-items:center;gap:3px;padding-right:3px;color:#fff;font-size:12px;font-weight:700;text-shadow:0 0 8px rgba(0,0,0,0.9),0 0 3px rgba(0,0,0,0.5);';
        containerEl.appendChild(viewerEl);
        return true;
    }

    function waitForContainer() {
        if (injectViewerEl()) return;
        var obs = new MutationObserver(function () {
            if (injectViewerEl()) obs.disconnect();
        });
        obs.observe(document.body, { childList: true, subtree: true });
    }

    function updateWidget() {
        if (!viewerEl && !injectViewerEl()) return;
        if (!isLive || viewerCount === null || viewerCount <= 2) {
            viewerEl.innerHTML = TWITCH_SVG;
            return;
        }
        var n = viewerCount;
        var s = n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K' : '' + n;
        viewerEl.innerHTML = '<span>' + s + '</span>' + TWITCH_SVG;
    }

    function poll() {
        var channel = getChannel();
        var token = getSharedToken();
        var cid = getClientId();

        if (!channel || !token || !cid) {
            viewerCount = null;
            isLive = false;
            updateWidget();
            schedulePoll();
            return;
        }

        fetch('https://api.twitch.tv/helix/streams?user_login=' + encodeURIComponent(channel), {
            headers: { 'Client-ID': cid, 'Authorization': 'Bearer ' + token }
        }).then(function (resp) {
            if (!resp.ok) { viewerCount = null; isLive = false; return; }
            return resp.json();
        }).then(function (data) {
            if (!data || !data.data) { viewerCount = null; isLive = false; return; }
            if (data.data.length > 0 && data.data[0].type === 'live') {
                viewerCount = data.data[0].viewer_count;
                isLive = true;
            } else {
                viewerCount = 0;
                isLive = false;
            }
        }).catch(function () {
            viewerCount = null;
            isLive = false;
        }).then(function () {
            updateWidget();
            schedulePoll();
        });
    }

    function schedulePoll() {
        if (pollTimer) clearTimeout(pollTimer);
        pollTimer = setTimeout(poll, POLL_INTERVAL);
    }

    if (!getChannel()) {
        var chatCfg = localStorage.getItem('oe2_ttv_channel_manual');
        if (chatCfg) localStorage.setItem(CFG_KEY_CHANNEL, chatCfg);
    }

    waitForContainer();
    poll();

})();
