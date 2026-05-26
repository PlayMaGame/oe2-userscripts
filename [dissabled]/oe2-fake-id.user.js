// ==UserScript==
// @name         OE2 Fake Twitch ID
// @namespace    https://outerempires.net
// @version      1.3.0
// @description  Fake pilot info card for Twitch follower mails — shows live stream data.
// @match        https://game.dev.outerempires.net/game*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    var CLIENT_ID = localStorage.getItem('_oe2_client_id') || '';
    var STORAGE_TOKEN = '_oe2_tt';
    var STORAGE_BROADCASTER = '_oe2_bid';

    function getToken() {
        try {
            var d = JSON.parse(localStorage.getItem(STORAGE_TOKEN) || 'null');
            if (d && d.token && d.expiresAt > Date.now()) return d.token;
        } catch (e) {}
        return null;
    }

    function getBroadcasterId() {
        return localStorage.getItem(STORAGE_BROADCASTER) || '';
    }

    var cachedInfo = null;
    var cacheTime = 0;
    var CACHE_TTL = 60000;

    function fetchStreamInfo() {
        if (cachedInfo && Date.now() - cacheTime < CACHE_TTL) return Promise.resolve(cachedInfo);

        var token = getToken();
        var bid = getBroadcasterId();
        if (!token || !bid || !CLIENT_ID) return Promise.resolve(null);

        return Promise.all([
            fetch('https://api.twitch.tv/helix/channels?broadcaster_id=' + bid, {
                headers: { 'Client-ID': CLIENT_ID, 'Authorization': 'Bearer ' + token }
            }).then(function (r) { return r.ok ? r.json() : null; }),
            fetch('https://api.twitch.tv/helix/streams?user_id=' + bid, {
                headers: { 'Client-ID': CLIENT_ID, 'Authorization': 'Bearer ' + token }
            }).then(function (r) { return r.ok ? r.json() : null; }),
            fetch('https://api.twitch.tv/helix/channels/followers?broadcaster_id=' + bid + '&first=1', {
                headers: { 'Client-ID': CLIENT_ID, 'Authorization': 'Bearer ' + token }
            }).then(function (r) { return r.ok ? r.json() : null; })
        ]).then(function (results) {
            var ch = results[0] && results[0].data && results[0].data[0];
            var st = results[1] && results[1].data && results[1].data[0];
            var fw = results[2];
            cachedInfo = {
                gameName: ch ? ch.game_name : 'Unknown',
                title: ch ? ch.title : '',
                followers: fw && typeof fw.total === 'number' ? fw.total : null,
                viewerCount: st ? st.viewer_count : 'Offline',
                citizenId: 'TW1-7CH-' + bid.padStart(8, '0').slice(0, 4) + '-' + bid.padStart(8, '0').slice(4),
            };
            cacheTime = Date.now();
            return cachedInfo;
        });
    }

    document.addEventListener('click', function (e) {
        var span = e.target.closest('.MailFromName');
        if (!span || span.textContent !== 'Twitch') return;

        e.stopPropagation();
        e.preventDefault();

        fetchStreamInfo().then(function (info) {
            showFakeCard(e, info);
        });
    }, true);

    function showFakeCard(e, info) {
        var existing = document.querySelector('.oe2-fake-pilot-card');
        if (existing) existing.remove();

        var wrapper = document.createElement('div');
        wrapper.className = 'oe2-fake-pilot-card';
        wrapper.style.cssText = 'position:fixed;z-index:99999;';

        wrapper.innerHTML = buildCardHTML(info);
        document.body.appendChild(wrapper);

        var cardEl = wrapper.querySelector('.PilotCardWindow');
        var cx = Math.max(0, Math.round((window.innerWidth - cardEl.offsetWidth) / 2));
        var cy = Math.max(0, Math.round((window.innerHeight - cardEl.offsetHeight) / 2));
        cardEl.style.cssText = 'left:' + cx + 'px;top:' + cy + 'px;';

        wrapper.querySelector('.oe2-fake-close').addEventListener('click', function () { wrapper.remove(); });

        // Draggable
        var dragX = 0, dragY = 0;
        var titleBar = cardEl.querySelector('.PilotCardWindow_TitleBar');
        titleBar.addEventListener('mousedown', function (down) {
            if (down.target.classList.contains('PilotCardWindow_Close')) return;
            dragX = down.clientX - cardEl.offsetLeft;
            dragY = down.clientY - cardEl.offsetTop;
            function onMove(mv) {
                cardEl.style.left = Math.max(0, mv.clientX - dragX) + 'px';
                cardEl.style.top = Math.max(0, mv.clientY - dragY) + 'px';
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    function fmtFollowers(n) {
        if (n === null || n === undefined) return '-';
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return String(n);
    }

    function buildCardHTML(info) {
        var title  = info ? info.title : 'Loading...';
        var game   = info ? info.gameName : '...';
        var followers = info ? fmtFollowers(info.followers) : '...';
        var viewers   = info ? info.viewerCount : '...';
        var citizenId = info ? info.citizenId : 'TW1-7CH-0000-0000';
        var viewerStr = viewers === 'Offline' ? 'Offline' : viewers + ' viewers';

        return '<div class="PilotCardWindow" style="position:fixed;transform:none;">' +
            '<div class="PilotCardWindow_TitleBar">' +
                '<span class="PilotCardWindow_Title">PILOT INFORMATION</span>' +
                '<span class="PilotCardWindow_Close oe2-fake-close" style="cursor:pointer">\u2715</span>' +
            '</div>' +
            '<div class="PilotCardWindow_Body">' +
                '<div class="PilotCard_Content">' +
                    '<div class="PilotCard_Left">' +
                        '<div class="ProfileLeft_Info background_fade_pub" aria-expanded="false">' +
                            '<div class="ProfileTopLeft_LevelNameText ui_text_white">P<br>U<br>B</div>' +
                            '<div class="ProfileTopLeft_LevelTextLevel ui_text_yellow_light">67</div>' +
                        '</div>' +
                        '<div class="ProfileLeft_Info background_fade_pri" aria-expanded="false">' +
                            '<div class="ProfileTopLeft_LevelNameText ui_text_white">P<br>R<br>I</div>' +
                            '<div class="ProfileTopLeft_LevelTextLevel ui_text_blue_light">69</div>' +
                        '</div>' +
                        '<div class="ProfileLeft_Info background_fade_mil" aria-expanded="false">' +
                            '<div class="ProfileTopLeft_LevelNameText ui_text_white">M<br>I<br>L</div>' +
                            '<div class="ProfileTopLeft_LevelTextLevel ui_text_red_light">42</div>' +
                        '</div>' +
                        '<div class="PilotCard_Portrait">' +
                            '<img src="https://images.icon-icons.com/3041/PNG/512/twitch_logo_icon_189242.png" style="width:128px;height:128px;border-radius:4px;display:block;">' +
                        '</div>' +
                    '</div>' +
                    '<div class="PilotCard_Right">' +
                        '<div class="ProfileHeadlineRow">' +
                            '<div class="ProfileHeadline_Title ProfileHeadline_Title_PilotInfo ui_text_grey">Citizen ID:</div>' +
                            '<div class="ProfileHeadline_Text ProfileHeadline_Text_PilotInfo ui_text_white">' + citizenId + '</div>' +
                        '</div>' +
                        '<div class="ProfileHeadlineRow">' +
                            '<div class="ProfileHeadline_Title ProfileHeadline_Title_PilotInfo ui_text_grey">Name:</div>' +
                            '<div class="ProfileHeadline_Text ProfileHeadline_Text_PilotInfo ui_text_white">Twitch</div>' +
                        '</div>' +
                        '<div class="ProfileHeadlineRow">' +
                            '<div class="ProfileHeadline_Title ProfileHeadline_Title_PilotInfo ui_text_grey">Faction:</div>' +
                            '<div class="ProfileHeadline_Text ProfileHeadline_Text_PilotInfo ui_text_white">Amazon</div>' +
                        '</div>' +
                        '<div class="ProfileHeadlineRow">' +
                            '<div class="ProfileHeadline_Title ProfileHeadline_Title_PilotInfo ui_text_grey">Fctn. Tag:</div>' +
                            '<div class="ProfileHeadline_Text ProfileHeadline_Text_PilotInfo ui_text_white">TTV</div>' +
                        '</div>' +
                        '<div class="ProfileHeadlineRow">' +
                            '<div class="ProfileHeadline_Title ProfileHeadline_Title_PilotInfo ui_text_grey">Game:</div>' +
                            '<div class="ProfileHeadline_Text ProfileHeadline_Text_PilotInfo ui_text_white">' + game + '</div>' +
                        '</div>' +
                        '<div class="ProfileHeadlineRow">' +
                            '<div class="ProfileHeadline_Title ProfileHeadline_Title_PilotInfo ui_text_grey">Followers:</div>' +
                            '<div class="ProfileHeadline_Text ProfileHeadline_Text_PilotInfo ui_text_white">' + followers + '</div>' +
                        '</div>' +
                        '<div class="ProfileHeadlineRow">' +
                            '<div class="ProfileHeadline_Title ProfileHeadline_Title_PilotInfo ui_text_grey">Status:</div>' +
                            '<div class="ProfileHeadline_Text ProfileHeadline_Text_PilotInfo ui_text_white">' + viewerStr + '</div>' +
                        '</div>' +
                        '<div class="ProfileHeadlineRow" style="max-width:260px;">' +
                            '<div class="ProfileHeadline_Title ProfileHeadline_Title_PilotInfo ui_text_grey">Title:</div>' +
                            '<div class="ProfileHeadline_Text ProfileHeadline_Text_PilotInfo ui_text_white" style="word-break:break-word;">' + title + '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>';
    }

})();
