// ==UserScript==
// @name         OE2 Follower Mail
// @namespace    https://outerempires.net
// @version      4.0.0
// @description  Twitch followers auto-sent as real in-game mail via game API.
// @match        https://game.dev.outerempires.net/game*
// @grant        GM_getResourceText
// @grant        GM_getResourceURL
// @run-at       document-end
// @resource     oe2Config oe2_config.json
// ==/UserScript==

(function () {
    'use strict';

    // ─── Config & API ──────────────────────────────────────────────────────
    var _cfg;
    try { _cfg = JSON.parse(GM_getResourceText('oe2Config')); }
    catch (e) {
        try { _cfg = JSON.parse(atob(GM_getResourceURL('oe2Config').split(',')[1])); }
        catch (e2) { _cfg = {}; }
    }

    var API_BASE = 'https://oe2-api-dev.azure-api.net';
    var BROADCASTER_NAME = _cfg.broadcaster_name || 'WekizZ Boodz';

    // Decode character ID from the game's JWT token
    var CHAR_ID = _cfg.char_id || '';
    try {
        var tok = localStorage.getItem('userToken');
        if (tok) { var p = JSON.parse(atob(tok.split('.')[1])); if (p.sub) CHAR_ID = p.sub; }
    } catch (e) {}

    var TWITCH_CLIENT_ID = _cfg.twitch_client_id || localStorage.getItem('_oe2_client_id') || '';
    var REDIRECT_URI     = 'https://game.dev.outerempires.net/game';
    var STORAGE_TOKEN       = '_oe2_tt';
    var STORAGE_BROADCASTER = '_oe2_bid';
    var STORAGE_KNOWN_IDS   = '_oe2_kfids';
    var POLL_MS             = 15000;

    // ─── Handle OAuth Redirect ─────────────────────────────────────────────
    (function () {
        var h = window.location.hash;
        if (!h || h.indexOf('access_token=') === -1) return;
        var p = new URLSearchParams(h.slice(1));
        var t = p.get('access_token');
        if (!t) return;
        var ei = parseInt(p.get('expires_in') || '14400', 10);
        localStorage.setItem(STORAGE_TOKEN, JSON.stringify({
            token: t,
            expiresAt: Date.now() + ei * 1000,
        }));
        history.replaceState(null, '', window.location.pathname + window.location.search);
        if (window.opener) window.close();
    })();
    if (window.location.hash && window.location.hash.indexOf('access_token=') !== -1) return;

    // ─── Token Helpers ─────────────────────────────────────────────────────
    function getToken() {
        try {
            var d = JSON.parse(localStorage.getItem(STORAGE_TOKEN) || 'null');
            if (d && d.token && d.expiresAt > Date.now()) return d.token;
        } catch (e) {}
        return null;
    }
    function clearToken() { localStorage.removeItem(STORAGE_TOKEN); }
    function getBroadcasterId() { return localStorage.getItem(STORAGE_BROADCASTER) || ''; }
    function setBroadcasterId(id) { localStorage.setItem(STORAGE_BROADCASTER, id); }

    var knownIdsCache = null;
    function getKnownIds() {
        if (knownIdsCache) return knownIdsCache;
        try { knownIdsCache = new Set(JSON.parse(localStorage.getItem(STORAGE_KNOWN_IDS) || '[]')); }
        catch (e) { knownIdsCache = new Set(); }
        return knownIdsCache;
    }
    function addKnownIds(ids) {
        var s = getKnownIds();
        ids.forEach(function (id) { s.add(id); });
        localStorage.setItem(STORAGE_KNOWN_IDS, JSON.stringify(Array.from(s)));
    }

    // ─── Twitch API ────────────────────────────────────────────────────────
    function twitchApi(path, token) {
        return fetch('https://api.twitch.tv/helix' + path, {
            headers: {
                'Client-ID': TWITCH_CLIENT_ID,
                'Authorization': 'Bearer ' + token,
            },
        }).then(function (r) {
            if (r.status === 401) { clearToken(); return null; }
            if (!r.ok) return null;
            return r.json();
        });
    }
    function validateToken(token) {
        return fetch('https://id.twitch.tv/oauth2/validate', {
            headers: { 'Authorization': 'Bearer ' + token },
        }).then(function (r) {
            if (!r.ok) { clearToken(); return null; }
            return r.json();
        });
    }

    // ─── User Info ────────────────────────────────────────────────────────
    var userInfoCache = {};

    function fetchUserInfo(userId) {
        if (userInfoCache[userId]) return Promise.resolve(userInfoCache[userId]);
        var token = getToken();
        if (!token) return Promise.resolve(null);
        return twitchApi('/users?id=' + userId, token).then(function (data) {
            if (data && data.data && data.data[0]) {
                userInfoCache[userId] = data.data[0];
                return data.data[0];
            }
            return null;
        });
    }

    var channelCache = {};

    function fetchChannelInfo(userId) {
        if (channelCache[userId]) return Promise.resolve(channelCache[userId]);
        var token = getToken();
        if (!token) return Promise.resolve(null);
        return twitchApi('/channels?broadcaster_id=' + userId, token).then(function (data) {
            if (data && data.data && data.data[0]) {
                channelCache[userId] = data.data[0];
                return data.data[0];
            }
            return null;
        });
    }

    function formatType(t) {
        if (t === 'partner') return 'Partner';
        if (t === 'affiliate') return 'Affiliate';
        return 'Standard';
    }

    function buildMailBody(followerName, userInfo, channelInfo, followerLogin) {
        if (!userInfo) return followerName + ' just followed you on Twitch!';
        var login = followerLogin || (userInfo && userInfo.login) || null;
        var lines = [followerName + ' just followed you on Twitch!', ''];
        if (login) lines.push('  Link: https://www.twitch.tv/' + login);
        if (typeof userInfo.view_count === 'number') lines.push('  Views: ' + userInfo.view_count.toLocaleString());
        if (channelInfo && channelInfo.game_name) lines.push('  Last game: ' + channelInfo.game_name);
        if (userInfo.broadcaster_type) lines.push('  Type: ' + formatType(userInfo.broadcaster_type));
        if (userInfo.description && userInfo.description.trim()) lines.push('  Bio: ' + userInfo.description.trim());
        return lines.join('\n');
    }

    // ─── Send Mail ─────────────────────────────────────────────────────────
    var _sendAttempts = {};

    function getApiToken() {
        return localStorage.getItem('userToken') || '';
    }

    function sendFollowerMail(followerName, userId, followerLogin) {
        var key = followerName + (userId || '');
        _sendAttempts[key] = (_sendAttempts[key] || 0) + 1;
        if (_sendAttempts[key] > 20) return;

        var p;
        if (userId) {
            p = Promise.all([
                fetchUserInfo(userId),
                fetchChannelInfo(userId)
            ]).then(function (results) {
                return buildMailBody(followerName, results[0], results[1], followerLogin);
            }, function () {
                return buildMailBody(followerName, null, null, followerLogin);
            });
        } else {
            p = Promise.resolve(buildMailBody(followerName, null, null, followerLogin));
        }
        p.then(function (body) { sendViaApi(body); });
    }

    function sendViaApi(body) {
        var token = getApiToken();
        if (!token) { console.warn('OE2FM: no API token'); return; }
        if (!CHAR_ID) { console.warn('OE2FM: no character ID'); return; }
        fetch(API_BASE + '/v1/mail', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                characterId: CHAR_ID,
                recipientList: CHAR_ID,
                subject: 'A new twitch follower!',
                body: body
            }),
        }).then(function (r) {
            if (r.ok) {
                console.log('OE2FM: mail sent');
            } else {
                console.warn('OE2FM: API POST /mail returned ' + r.status);
                r.text().then(function (t) { console.warn('OE2FM: response', t.slice(0, 300)); });
            }
        }).catch(function (err) {
            console.warn('OE2FM: API POST /mail error', err);
        });
    }

    // ─── Follower Polling ──────────────────────────────────────────────────
    function checkForFollowers(token, broadcasterId) {
        if (bootstrapping) return;
        twitchApi('/channels/followers?broadcaster_id=' + broadcasterId + '&moderator_id=' + broadcasterId + '&first=100', token)
            .then(function (data) {
                if (!data || !data.data) return;
                var newIds = [];
                var newFollowers = [];
                data.data.forEach(function (f) {
                    if (!getKnownIds().has(f.user_id)) {
                        newIds.push(f.user_id);
                        newFollowers.push(f);
                    }
                });
                if (newIds.length === 0) return;
                addKnownIds(newIds);
                newFollowers.forEach(function (f) {
                    sendFollowerMail(f.user_name || f.username, f.user_id, f.user_login);
                });
            });
    }

    // ─── Bootstrap ─────────────────────────────────────────────────────────
    var bootstrapping = false;
    var _pollingStarted = false;

    function bootstrap(token) {
        if (bootstrapping) return Promise.resolve();
        bootstrapping = true;
        var bid = getBroadcasterId();
        var p;
        if (bid) {
            p = twitchApi('/channels/followers?broadcaster_id=' + bid + '&moderator_id=' + bid + '&first=100', token);
        } else {
            p = validateToken(token).then(function (info) {
                if (!info) return null;
                setBroadcasterId(info.user_id);
                return twitchApi('/channels/followers?first=100&broadcaster_id=' + info.user_id + '&moderator_id=' + info.user_id, token);
            });
        }
        return p.then(function (data) {
            if (data && data.data) addKnownIds(data.data.map(function (f) { return f.user_id; }));
        }).then(function () { bootstrapping = false; }, function () { bootstrapping = false; });
    }

    // ─── Settings Panel ────────────────────────────────────────────────────
    var twitchPanel = null;

    function createTwitchPanel() {
        if (twitchPanel) return;
        twitchPanel = document.createElement('div');
        twitchPanel.id = 'oe2-twitch-panel';
        twitchPanel.style.cssText = 'position:fixed;z-index:999999;background:rgba(8,14,24,.95);border:1px solid #1a3a5c;border-radius:4px;padding:10px 12px;display:none;pointer-events:auto;';

        var title = document.createElement('div');
        title.textContent = 'Twitch Followers';
        title.style.cssText = 'font-size:11px;font-weight:700;color:#7ecfff;margin-bottom:6px;letter-spacing:.5px;';
        twitchPanel.appendChild(title);

        var statusLine = document.createElement('div');
        statusLine.id = 'oe2-twitch-status';
        statusLine.style.cssText = 'font-size:10px;color:#8899aa;margin-bottom:6px;';
        statusLine.textContent = 'Waiting for game API...';
        twitchPanel.appendChild(statusLine);

        var btnStyle = 'display:block;width:100%;margin-top:4px;background:rgba(30,60,90,.5);border:1px solid #3a6ea8;color:#7ecfff;font-size:11px;font-weight:600;padding:4px 10px;cursor:pointer;border-radius:3px;text-align:left;';
        var inputStyle = 'display:none;width:100%;margin-top:4px;padding:4px 6px;background:rgba(8,14,24,.95);border:1px solid #3a6ea8;color:#7ecfff;font-size:11px;border-radius:3px;outline:none;box-sizing:border-box;';

        var setupInput = document.createElement('input');
        setupInput.type = 'text';
        setupInput.placeholder = 'Paste Twitch Client ID...';
        setupInput.style.cssText = inputStyle;
        twitchPanel.appendChild(setupInput);

        var connectBtn = document.createElement('button');
        connectBtn.className = 'oe2-twitch-connect-btn';
        connectBtn.textContent = 'Connect Twitch';
        connectBtn.style.cssText = btnStyle;
        connectBtn.addEventListener('click', function () {
            var cid = TWITCH_CLIENT_ID || localStorage.getItem('_oe2_client_id');
            if (!cid) { setupInput.style.display = 'block'; setupInput.focus(); return; }
            if (getToken()) return;
            var url = 'https://id.twitch.tv/oauth2/authorize' +
                '?client_id=' + cid +
                '&redirect_uri=' + encodeURIComponent(REDIRECT_URI) +
                '&response_type=token' +
                '&scope=' + encodeURIComponent('moderator:read:followers');
            window.open(url, 'twitch-auth', 'width=600,height=700');
        });
        twitchPanel.appendChild(connectBtn);

        setupInput.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter') return;
            var val = setupInput.value.trim();
            if (!val) return;
            localStorage.setItem('_oe2_client_id', val);
            TWITCH_CLIENT_ID = val;
            setupInput.style.display = 'none';
            setupInput.value = '';
        });

        var testBtn = document.createElement('button');
        testBtn.textContent = '+Send Test Mail';
        testBtn.style.cssText = btnStyle;
        testBtn.addEventListener('click', function () {
            var token = getToken();
            if (token) {
                twitchApi('/users?login=PlayMaGame', token).then(function (data) {
                    if (data && data.data && data.data[0]) {
                        sendFollowerMail(data.data[0].display_name, data.data[0].id, data.data[0].login);
                    } else {
                        sendFollowerMail('PlayMaGame', null, 'PlayMaGame');
                    }
                });
            } else {
                sendFollowerMail('TestFollower');
            }
        });
        twitchPanel.appendChild(testBtn);

        document.body.appendChild(twitchPanel);
    }

    function updateStatus() {
        var el = document.getElementById('oe2-twitch-status');
        if (!el) return;
        var parts = [];
        if (getToken()) parts.push('Twitch \u2713');
        else parts.push('Twitch: not connected');
        if (getApiToken()) parts.push('API \u2713');
        else parts.push('API: no token');
        if (CHAR_ID) parts.push('CID: ' + CHAR_ID);
        el.textContent = parts.join(' | ');
    }

    function positionTwitchPanel() {
        var modal = document.querySelector('.modal.dynamic .modal-heading');
        var isVisible = modal && modal.offsetParent !== null && modal.textContent.indexOf('SETTINGS') !== -1;
        if (!isVisible) {
            if (twitchPanel) twitchPanel.style.display = 'none';
            return;
        }
        createTwitchPanel();
        updateStatus();
        var settingsModal = modal.closest('.modal.dynamic');
        var rect = settingsModal.getBoundingClientRect();
        var hpPanel = document.getElementById('oe2-cloud-panel');
        var topOffset = rect.top + 20;
        if (hpPanel && hpPanel.style.display !== 'none') topOffset = rect.top + hpPanel.offsetHeight + 24;
        twitchPanel.style.display = 'block';
        twitchPanel.style.left = (rect.left - twitchPanel.offsetWidth - 8) + 'px';
        twitchPanel.style.top = topOffset + 'px';
        if (parseInt(twitchPanel.style.left) < 4) {
            twitchPanel.style.left = (rect.right + 8) + 'px';
            twitchPanel.style.top = topOffset + 'px';
        }
        var connectBtn = twitchPanel.querySelector('.oe2-twitch-connect-btn');
        if (connectBtn) {
            var needSetup = !(TWITCH_CLIENT_ID || localStorage.getItem('_oe2_client_id'));
            if (getToken()) {
                connectBtn.textContent = 'Twitch \u2713';
                connectBtn.style.color = '#4caf50';
                connectBtn.style.borderColor = '#2e7d32';
            } else if (needSetup) {
                connectBtn.textContent = 'Click to set Client ID';
                connectBtn.style.color = '#ffb300';
                connectBtn.style.borderColor = '#ff8f00';
            } else {
                connectBtn.textContent = 'Connect Twitch';
                connectBtn.style.color = '#7ecfff';
                connectBtn.style.borderColor = '#3a6ea8';
            }
        }
    }

    function watchTwitchPanel() {
        createTwitchPanel();
        setInterval(positionTwitchPanel, 100);
    }

    // ─── Boot ──────────────────────────────────────────────────────────────
    setTimeout(function () {
        var token = getToken();
        if (token) bootstrap(token).then(startPolling);
    }, 2000);

    window.addEventListener('storage', function (e) {
        if (e.key === STORAGE_TOKEN) {
            var t = getToken();
            if (t && !_pollingStarted) bootstrap(t).then(startPolling);
        }
    });

    watchTwitchPanel();

    function startPolling() {
        if (_pollingStarted) return;
        _pollingStarted = true;
        setInterval(function () {
            var t = getToken();
            var bid = getBroadcasterId();
            if (t && bid) checkForFollowers(t, bid);
        }, POLL_MS);
    }

})();
