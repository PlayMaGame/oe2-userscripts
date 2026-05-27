// ==UserScript==
// @name         OE2 Twitch Chat
// @namespace    https://game.dev.outerempires.net/
// @version      1.0
// @description  Embeds Twitch chat as a channel in the in-game Social Media group
// @match        https://game.dev.outerempires.net/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const GROUP = 'SocialMedia';
    const GROUP_LABEL = 'Social Media';
    const CHANNEL = 'Twitch';
    const OUTPUT_ID = `ui_chat_output_${GROUP}::${CHANNEL}`;
    const CHANNEL_LIST_ID = `ui_chat_channel_list_${GROUP}`;
    const GROUP_TOGGLE_ID = `ui_chat_group_${GROUP}`;

    const CFG_KEY = {
        channel:   'oe2_ttv_channel',
        client_id: 'oe2_ttv_client_id',
    };
    const SHARED_TOKEN_KEY = '_oe2_tt';
    const REDIRECT_URI     = 'https://game.dev.outerempires.net/game';
    const SOUND_KEY = 'oe2_ttv_sound';
    let ws = null;
    let reconnectTimer = null;
    let reconnectAttempts = 0;
    let settingsPanel = null;
    var cachedUsername = '';
    var twitchSound = localStorage.getItem(SOUND_KEY) !== '0';
    var unreadCount = 0;

    function $(sel, ctx) { return (ctx || document).querySelector(sel); }
    function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

    var _audioCtx = null;
    function playSwitchSound() {
        try {
            if (window.soundManager && typeof window.soundManager.play === 'function') {
                window.soundManager.play('click');
                return;
            }
            if (window.audioManager && typeof window.audioManager.play === 'function') {
                window.audioManager.play('click');
                return;
            }
        } catch (e) {}
        try {
            if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            var o = _audioCtx.createOscillator();
            var g = _audioCtx.createGain();
            o.connect(g);
            g.connect(_audioCtx.destination);
            o.frequency.value = 660;
            o.type = 'sine';
            g.gain.setValueAtTime(0.02, _audioCtx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + 0.08);
            o.start(_audioCtx.currentTime);
            o.stop(_audioCtx.currentTime + 0.08);
        } catch (e) {}
    }

    var USERNAME_COLORS = [
        '#FF0000','#0000FF','#00FF00','#B22222','#FF7F50',
        '#9ACD32','#FF4500','#2E8B57','#DAA520','#D2691E',
        '#5F9EA0','#1E90FF','#FF69B4','#8A2BE2','#00FF7F'
    ];

    function getUsernameColor(username) {
        var hash = 0;
        for (var i = 0; i < username.length; i++) {
            hash = username.charCodeAt(i) + ((hash << 5) - hash);
        }
        return USERNAME_COLORS[Math.abs(hash) % USERNAME_COLORS.length];
    }

    function esc(str) {
        var d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    // ─── Twitch Emotes (from IRC tags) ─────────────────────────────────

    function parseEmotes(emoteStr) {
        if (!emoteStr) return null;
        var result = [];
        var groups = emoteStr.split('/');
        for (var i = 0; i < groups.length; i++) {
            var parts = groups[i].split(':');
            if (parts.length !== 2) continue;
            var emoteId = parts[0];
            var ranges = parts[1].split(',');
            for (var j = 0; j < ranges.length; j++) {
                var range = ranges[j].split('-');
                if (range.length !== 2) continue;
                result.push({
                    id: emoteId,
                    start: parseInt(range[0], 10),
                    end: parseInt(range[1], 10) + 1
                });
            }
        }
        if (!result.length) return null;
        result.sort(function (a, b) { return a.start - b.start; });
        return result;
    }

    function buildMessageHtml(message, emoteData) {
        if (!emoteData || !emoteData.length) return esc(message);
        var html = '';
        var pos = 0;
        for (var i = 0; i < emoteData.length; i++) {
            var e = emoteData[i];
            if (e.start > pos) html += esc(message.slice(pos, e.start));
            var emoteText = message.slice(e.start, e.end);
            html += '<img src="https://static-cdn.jtvnw.net/emoticons/v2/' + e.id + '/default/dark/1.0" alt="' + esc(emoteText) + '" title="' + esc(emoteText) + '" class="oe2-ttv-emote">';
            pos = e.end;
        }
        if (pos < message.length) html += esc(message.slice(pos));
        return html;
    }

    function getSharedToken() {
        try {
            var d = JSON.parse(localStorage.getItem(SHARED_TOKEN_KEY) || 'null');
            if (d && d.token) return d.token;
        } catch (e) {}
        return null;
    }

    function resolveUsername(token) {
        if (cachedUsername) return Promise.resolve(cachedUsername);
        if (!token) return Promise.resolve('');
        return fetch('https://id.twitch.tv/oauth2/validate', {
            headers: { 'Authorization': 'Bearer ' + token },
        }).then(function (r) {
            if (!r.ok) return '';
            return r.json();
        }).then(function (info) {
            if (info) {
                cachedUsername = info.login || '';
                if (cachedUsername) {
                    localStorage.setItem('_oe2_ttv_user', cachedUsername);
                }
                console.log('[OE2 TTV] Token scopes:', info.scopes);
                if (info.scopes && info.scopes.indexOf('chat:read') === -1) {
                    console.warn('[OE2 TTV] Token missing chat:read scope!');
                }
            }
            return cachedUsername;
        }).catch(function (e) { console.warn('[OE2 TTV] Validate failed:', e); return ''; });
    }

    // ─── Inject sidebar group ──────────────────────────────────────────

    function injectSidebar() {
        var sidebar = $('#ui_chat_groups_channels');
        if (!sidebar) return false;
        if ($(`#${GROUP_TOGGLE_ID}`, sidebar)) return true;

        var group = document.createElement('div');
        group.className = 'ui_chat_group';
        group.id = 'oe2_' + GROUP;
        group.innerHTML =
            '<div class="ui_chat_group_header background_fade_grey">' +
                '<div class="title ui_text_white">' + GROUP_LABEL + '</div>' +
                '<div class="toggle ui_text_electric_green" id="' + GROUP_TOGGLE_ID + '">-</div>' +
            '</div>' +
            '<div class="ui_chat_channels" id="' + CHANNEL_LIST_ID + '">' +
                '<div class="ui_chat_channel" data-oe2-channel="' + CHANNEL + '">' +
                    '<div class="name ui_text_electric_green">' + CHANNEL + '</div>' +
                    '<div class="count ui_text_electric_green"></div>' +
                    '<div class="sound ui_icon_sound"></div>' +
                '</div>' +
            '</div>';

        var logsGroup = sidebar.querySelector('.ui_chat_group:last-child');
        if (logsGroup && logsGroup.querySelector('.title') && logsGroup.querySelector('.title').textContent.trim() === 'Logs') {
            sidebar.insertBefore(group, logsGroup);
        } else {
            sidebar.appendChild(group);
        }

        var ch = $(`[data-oe2-channel="${CHANNEL}"]`, group);
        if (ch) {
            ch.addEventListener('click', function (e) {
                e.stopPropagation();
                switchChannel();
            });

            var soundDiv = ch.querySelector('.sound');
            if (soundDiv) {
                soundDiv.className = 'sound ' + (twitchSound ? 'ui_icon_sound_off' : 'ui_icon_sound');
                soundDiv.addEventListener('click', function (e) {
                    e.stopPropagation();
                    twitchSound = !twitchSound;
                    this.className = 'sound ' + (twitchSound ? 'ui_icon_sound_off' : 'ui_icon_sound');
                    localStorage.setItem(SOUND_KEY, twitchSound ? '1' : '0');
                    if (twitchSound) playSwitchSound();
                });
            }

            var gearContainer = ch.querySelector('.name');
            if (gearContainer) {
                var gear = document.createElement('span');
                gear.textContent = ' \u2699';
                gear.style.cssText = 'cursor:pointer;font-size:10px;opacity:0.5;margin-left:4px;';
                gear.title = 'Twitch settings';
                gear.addEventListener('click', function (e) {
                    e.stopPropagation();
                    toggleSettings(e);
                });
                gearContainer.appendChild(gear);
            }
        }

        var toggle = $(`#${GROUP_TOGGLE_ID}`, group);
        if (toggle) {
            toggle.addEventListener('click', function (e) {
                e.stopPropagation();
                toggleGroup();
            });
        }

        return true;
    }

    // ─── Inject output container ───────────────────────────────────────

    function injectOutput() {
        var right = $('#ui_chat_right');
        if (!right) return false;
        if (document.getElementById(OUTPUT_ID)) return true;

        var output = document.createElement('div');
        output.id = OUTPUT_ID;
        output.className = 'ui_chat_output';
        output.style.cssText = 'overflow-y:auto;word-break:break-word;display:none;';
        output.innerHTML =
            '<div class="ui_chat_output_message">' +
                '<span class="ui_chat_output_message_content ui_text_lightgrey"><i>Not connected \u2014 click \u2699 to configure</i></span>' +
            '</div>';

        var anchor = $('#ui_chat_input_divider', right);
        if (anchor && anchor.parentNode) {
            right.insertBefore(output, anchor.parentNode);
        } else {
            right.appendChild(output);
        }

        return true;
    }

    function inject() {
        return injectSidebar() && injectOutput();
    }

    // ─── Channel switching ─────────────────────────────────────────────

    function setHeaderText(text) {
        var header = document.getElementById('ui_chat_group_header');
        if (!header) return;
        var nodes = header.childNodes;
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].nodeType === Node.TEXT_NODE) {
                nodes[i].textContent = text;
                return;
            }
        }
        header.textContent = text;
    }

    function switchChannel() {
        playSwitchSound();

        var sidebar = $('#ui_chat_groups_channels');
        if (sidebar) sidebar.classList.add('oe2-ttv-active');

        var ch = $(`[data-oe2-channel="${CHANNEL}"]`);
        if (ch) ch.classList.add('active');

        // Hide game outputs with inline style (don't touch Lit-managed active class)
        $$('.ui_chat_output, .ui_log_output').forEach(function (el) {
            if (el.id !== OUTPUT_ID) el.style.display = 'none';
        });

        var out = document.getElementById(OUTPUT_ID);
        if (out) {
            out.classList.add('active');
            out.style.display = '';
        }

        setHeaderText(CHANNEL);
        unreadCount = 0;
        updateUnreadBadge();
    }

    function updateUnreadBadge() {
        var el = document.querySelector('[data-oe2-channel="Twitch"] .count');
        if (!el) return;
        if (unreadCount > 0) {
            el.textContent = '' + unreadCount;
            el.style.cssText = 'background:#e53935;color:#fff;font-size:9px;font-weight:700;min-width:16px;height:16px;line-height:16px;border-radius:8px;text-align:center;padding:0 4px;margin-right:3px;';
        } else {
            el.textContent = '';
            el.style.cssText = '';
        }
    }

    // Listen for game channel clicks to deactivate Twitch
    function watchGameChannels() {
        document.addEventListener('click', function (e) {
            var ch = e.target.closest('.ui_chat_channel');
            if (ch && !ch.hasAttribute('data-oe2-channel')) {
                var sidebar = $('#ui_chat_groups_channels');
                if (sidebar) sidebar.classList.remove('oe2-ttv-active');
                // Clear inline display:none so Lit can show the game output
                $$('.ui_chat_output, .ui_log_output').forEach(function (el) {
                    if (el.id !== OUTPUT_ID) el.style.display = '';
                });
                var out = document.getElementById(OUTPUT_ID);
                if (out) {
                    out.classList.remove('active');
                    out.style.display = 'none';
                }
                var twCh = document.querySelector('[data-oe2-channel="Twitch"]');
                if (twCh) twCh.classList.remove('active');
            }
        }, true);
    }

    function toggleGroup() {
        var list = $(`#${CHANNEL_LIST_ID}`);
        var toggle = $(`#${GROUP_TOGGLE_ID}`);
        if (!list || !toggle) return;
        var hidden = list.style.display === 'none';
        list.style.display = hidden ? '' : 'none';
        toggle.textContent = hidden ? '-' : '+';
    }

    // ─── Twitch IRC ───────────────────────────────────────────────────────

    function getConfig() {
        return {
            channel:  localStorage.getItem(CFG_KEY.channel) || '',
            username: cachedUsername || localStorage.getItem('_oe2_ttv_user') || '',
            token:    getSharedToken(),
        };
    }

    function connectTwitch() {
        var cfg = getConfig();
        if (!cfg.channel || !cfg.username || !cfg.token) return;
        if (ws) return;

        ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');

        ws.onopen = function () {
            reconnectAttempts = 0;
            console.log('[OE2 TTV] WebSocket opened, sending IRC login...');
            ws.send('PASS oauth:' + cfg.token);
            ws.send('NICK ' + cfg.username.toLowerCase());
            ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
            ws.send('JOIN #' + cfg.channel.toLowerCase());
            setStatus('Connected to #' + cfg.channel, '#4dd0e1');
        };

        ws.onmessage = function (event) {
            var data = event.data;
            console.log('[OE2 TTV] RAW:', data.slice(0, 200));

            if (data.slice(0, 4) === 'PING') {
                ws.send('PONG :' + data.slice(data.indexOf(':') + 1));
                return;
            }

            var lines = data.split('\r\n');
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                if (!line) continue;

                var privMatch = line.match(/^@?(.*?) :(\w+)!\w+@\w+\.tmi\.twitch\.tv PRIVMSG #\w+ :(.+)$/s);
                if (privMatch) {
                    console.log('[OE2 TTV] CHAT:', privMatch[2], ':', privMatch[3]);
                    addMessage(privMatch[2], privMatch[3], privMatch[1]);
                    continue;
                }
            }
        };

        ws.onclose = function (e) {
            console.log('[OE2 TTV] Closed code=' + e.code + ' reason=' + e.reason);
            ws = null;
            var reason = (e.reason || '').toLowerCase();
            if (reason.indexOf('auth') !== -1 || reason.indexOf('login') !== -1) {
                setStatus('Authentication failed \u2014 click \u2699 to re-authorize', '#ef5350');
                reconnectAttempts = 0;
                return;
            }
            reconnectAttempts++;
            if (reconnectAttempts > 5) {
                setStatus('Connection failed after ' + reconnectAttempts + ' attempts \u2014 click \u2699 to retry', '#ef5350');
                reconnectAttempts = 0;
                return;
            }
            setStatus('Disconnected \u2014 reconnecting in 5s...', '#ffb300');
            if (!reconnectTimer) {
                reconnectTimer = setTimeout(function () {
                    reconnectTimer = null;
                    doConnect();
                }, 5000);
            }
        };

        ws.onerror = function () {
            console.log('[OE2 TTV] WebSocket error');
            if (ws) ws.close();
        };
    }

    function disconnectTwitch() {
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        if (ws) { ws.onclose = null; ws.close(); ws = null; }
        setStatus('Disconnected', '#ef5350');
    }

    function addMessage(user, message, tags) {
        var container = document.getElementById(OUTPUT_ID);
        if (!container) return;

        var msgs = container.querySelectorAll('.ui_chat_output_message');
        for (var i = 0; i < msgs.length; i++) {
            var txt = msgs[i].textContent;
            if (txt.indexOf('Not connected') !== -1 || txt.indexOf('Connected to') !== -1 || txt.indexOf('Disconnected') !== -1) {
                msgs[i].remove();
            }
        }

        var color = getUsernameColor(user);
        var emoteData = null;
        if (tags) {
            var parts = tags.split(';');
            for (var j = 0; j < parts.length; j++) {
                var kv = parts[j].split('=');
                if (kv[0] === 'color' && kv[1]) color = kv[1];
                if (kv[0] === 'emotes' && kv[1]) emoteData = parseEmotes(kv[1]);
            }
        }

        var msgDiv = document.createElement('div');
        msgDiv.className = 'ui_chat_output_message';
        msgDiv.innerHTML =
            '<span class="ui_chat_output_message_person ui_text_green">' +
                '<span class="CharacterTag" style="color:' + color + '">' + esc(user) + '</span>' +
                ' ' +
            '</span>' +
            '<span class="ui_chat_output_message_content ui_text_white">' + buildMessageHtml(message, emoteData) + '</span>';

        container.appendChild(msgDiv);
        container.scrollTop = container.scrollHeight;
        if (twitchSound) playSwitchSound();
        if (!document.querySelector('[data-oe2-channel="Twitch"].active')) {
            unreadCount++;
            updateUnreadBadge();
        }
    }

    function setStatus(text, color) {
        var container = document.getElementById(OUTPUT_ID);
        if (!container) return;

        var msgs = container.querySelectorAll('.ui_chat_output_message');
        for (var i = 0; i < msgs.length; i++) {
            var txt = msgs[i].textContent;
            if (txt.indexOf('Not connected') !== -1 || txt.indexOf('Connected to') !== -1 || txt.indexOf('Disconnected') !== -1) {
                if (!msgs[i].classList.contains('oe2-ttv-status')) msgs[i].remove();
            }
        }

        var existing = container.querySelector('.oe2-ttv-status');
        if (!existing) {
            existing = document.createElement('div');
            existing.className = 'ui_chat_output_message oe2-ttv-status';
            container.insertBefore(existing, container.firstChild);
        }
        existing.innerHTML =
            '<span class="ui_chat_output_message_content" style="color:' + (color || '#8899aa') + '">' +
                '<i>' + esc(text) + '</i>' +
            '</span>';
    }

    // ─── OAuth – get a token with chat:read scope ──────────────────────

    function getClientId() {
        return localStorage.getItem(CFG_KEY.client_id) || localStorage.getItem('_oe2_client_id') || '';
    }

    function authTwitch() {
        var inp = document.getElementById('oe2-ttv-inp-cid');
        var cid = inp ? inp.value.trim() : getClientId();
        if (!cid) { setStatus('Enter a Twitch Client ID first', '#ef5350'); return; }
        localStorage.setItem(CFG_KEY.client_id, cid);

        var url = 'https://id.twitch.tv/oauth2/authorize' +
            '?client_id=' + encodeURIComponent(cid) +
            '&redirect_uri=' + encodeURIComponent(REDIRECT_URI) +
            '&response_type=token' +
            '&scope=chat:read+chat:edit+moderator:read:followers';

        setStatus('Opening Twitch auth...', '#ffb300');
        console.log('[OE2 TTV] Auth URL (copy & open in new tab):');
        console.log(url);
        try {
            var w = window.open(url, 'twitch-auth', 'width=600,height=700');
            if (!w || w.closed) {
                setStatus('Popup blocked — copy URL from console (F12)', '#ef5350');
            }
        } catch (e) {
            console.warn('[OE2 TTV] window.open failed:', e);
            setStatus('Popup error — copy URL from console (F12)', '#ef5350');
        }
    }

    // ─── Settings Panel ────────────────────────────────────────────

    function toggleSettings(e) {
        if (settingsPanel && settingsPanel.style.display !== 'none') {
            settingsPanel.style.display = 'none';
            return;
        }
        createSettingsPanel(e);
    }

    function createSettingsPanel(e) {
        if (!settingsPanel) {
            settingsPanel = document.createElement('div');
            settingsPanel.id = 'oe2-ttv-settings';
            document.body.appendChild(settingsPanel);
        }

        var cfg = getConfig();
        var cid = getClientId();

        settingsPanel.style.cssText =
            'position:fixed;z-index:999999;background:rgba(8,14,24,.96);border:1px solid #1a3a5c;' +
            'border-radius:4px;padding:14px;width:300px;pointer-events:auto;font-family:inherit;';

        settingsPanel.style.left = Math.max(10, window.innerWidth - 340) + 'px';
        settingsPanel.style.top = '80px';

        settingsPanel.innerHTML =
            '<div style="font-size:11px;font-weight:700;color:#7ecfff;margin-bottom:10px;letter-spacing:.5px;">Twitch Chat Settings</div>' +

            '<div style="margin-bottom:8px;font-size:10px;color:#8899aa;">' +
                'Token: <span id="oe2-ttv-status-token" style="color:' + (getSharedToken() ? '#4caf50' : '#ef5350') + '">' + (getSharedToken() ? '\u2713 ok' : 'Missing') + '</span>' +
                ' &nbsp; User: <span id="oe2-ttv-status-user" style="color:#ffb300;">resolving...</span>' +
            '</div>' +

            '<div style="margin-bottom:6px;">' +
                '<label style="font-size:10px;color:#8899aa;display:block;margin-bottom:2px;">Channel to join</label>' +
                '<input id="oe2-ttv-inp-channel" value="' + esc(cfg.channel) + '" placeholder="yourchannel" ' +
                'style="width:100%;padding:4px 6px;background:rgba(8,14,24,.95);border:1px solid #3a6ea8;color:#7ecfff;font-size:11px;border-radius:3px;outline:none;box-sizing:border-box;">' +
            '</div>' +

            '<div style="margin-bottom:6px;">' +
                '<label style="font-size:10px;color:#8899aa;display:block;margin-bottom:2px;">Twitch Client ID</label>' +
                '<input id="oe2-ttv-inp-cid" type="password" value="' + esc(cid) + '" placeholder="from oe2_config.json" ' +
                'style="width:100%;padding:4px 6px;background:rgba(8,14,24,.95);border:1px solid #3a6ea8;color:#7ecfff;font-size:11px;border-radius:3px;outline:none;box-sizing:border-box;">' +
                '<div style="font-size:9px;color:#667788;margin-top:2px;">Auto-filled from OE2 Follower Mail if available</div>' +
            '</div>' +

            '<div style="display:flex;gap:6px;margin-top:8px;">' +
                '<button id="oe2-ttv-auth" ' +
                'style="flex:1;background:rgba(90,30,120,.5);border:1px solid #7b3fa0;color:#c77dff;font-size:10px;font-weight:600;padding:5px;cursor:pointer;border-radius:3px;text-align:center;">' +
                'Authorize Chat' +
            '</button>' +
            '<button id="oe2-ttv-save" ' +
                'style="flex:1;background:rgba(30,60,90,.5);border:1px solid #3a6ea8;color:#7ecfff;font-size:10px;font-weight:600;padding:5px;cursor:pointer;border-radius:3px;text-align:center;">' +
                'Save &amp; Connect' +
            '</button>' +
            '</div>';

        settingsPanel.style.display = 'block';

        // Resolve username on demand
        if (!cachedUsername) {
            var tk = getSharedToken();
            if (tk) {
                resolveUsername(tk).then(function () {
                    var el = document.getElementById('oe2-ttv-status-user');
                    if (el) {
                        el.textContent = cachedUsername || 'Failed';
                        el.style.color = cachedUsername ? '#4caf50' : '#ef5350';
                    }
                });
            }
        } else {
            var el = document.getElementById('oe2-ttv-status-user');
            if (el) {
                el.textContent = cachedUsername;
                el.style.color = '#4caf50';
            }
        }

        $('#oe2-ttv-auth', settingsPanel).addEventListener('click', function () {
            var inp = document.getElementById('oe2-ttv-inp-cid');
            if (inp && inp.value.trim()) localStorage.setItem(CFG_KEY.client_id, inp.value.trim());
            authTwitch();
        });

        $('#oe2-ttv-save', settingsPanel).addEventListener('click', function () {
            var inp = document.getElementById('oe2-ttv-inp-cid');
            if (inp && inp.value.trim()) localStorage.setItem(CFG_KEY.client_id, inp.value.trim());
            localStorage.setItem(CFG_KEY.channel, $('#oe2-ttv-inp-channel', settingsPanel).value.trim());
            settingsPanel.style.display = 'none';
            reconnectAttempts = 0;
            disconnectTwitch();
            doConnect();
        });
    }

    // ─── Send messages to Twitch ─────────────────────────────────────────

    function hookChatInput() {
        var input = document.getElementById('ui_chat_input');
        if (!input) { setTimeout(hookChatInput, 500); return; }

        input.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter' || e.shiftKey) return;

            // Only intercept when Twitch channel is active
            var active = document.querySelector('[data-oe2-channel="Twitch"].active');
            if (!active) return;

            e.preventDefault();
            e.stopPropagation();

            var text = input.value.trim();
            if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

            var cfg = getConfig();
            ws.send('PRIVMSG #' + cfg.channel.toLowerCase() + ' :' + text);

            // Show locally as "you"
            addMessage(cfg.username || 'you', text, 'color=#7ecfff');
            input.value = '';
        }, true);
    }

    // ─── Persistence against Lit re-renders ───────────────────────────────

    var wasConnected = false;

    function watchLit() {
        var sidebar = $('#ui_chat_groups_channels');
        if (!sidebar) return;

        var obs = new MutationObserver(function () {
            if (!$(`#${GROUP_TOGGLE_ID}`, sidebar)) {
                injectSidebar();
                updateUnreadBadge();
                if (wasConnected) doConnect();
            }
        });
        obs.observe(sidebar, { childList: true, subtree: true });

        var right = $('#ui_chat_right');
        if (right) {
            var obs2 = new MutationObserver(function () {
                if (!document.getElementById(OUTPUT_ID)) {
                    injectOutput();
                    var twCh = document.querySelector('[data-oe2-channel="Twitch"].active');
                    var gameCh = document.querySelector('.ui_chat_channel.active:not([data-oe2-channel])');
                    if (twCh && !gameCh) {
                        var out = document.getElementById(OUTPUT_ID);
                        if (out) {
                            out.classList.add('active');
                            out.style.display = '';
                        }
                    }
                }
            });
            obs2.observe(right, { childList: true, subtree: true });
        }
    }

    // ─── Auto-resolve username from token, then connect ─────────────────

    function doConnect() {
        var tk = getSharedToken();
        if (tk) {
            resolveUsername(tk).then(function () {
                connectTwitch();
            });
        } else {
            connectTwitch();
        }
    }

    // ─── Init ──────────────────────────────────────────────────────────────

    // Detect token changes from OAuth popup
    window.addEventListener('storage', function (e) {
        if (e.key === SHARED_TOKEN_KEY) {
            cachedUsername = '';
            disconnectTwitch();
            doConnect();
        }
    });

    function init() {
        if (!document.getElementById('oe2-ttv-style')) {
            var s = document.createElement('style');
            s.id = 'oe2-ttv-style';
            s.textContent = '#ui_chat_groups_channels.oe2-ttv-active .ui_chat_channel.active:not([data-oe2-channel]){opacity:.35}' +
                '.oe2-ttv-emote{vertical-align:middle;height:28px;width:auto;display:inline-block;}';
            document.head.appendChild(s);
        }
        if (!inject()) {
            setTimeout(init, 300);
            return;
        }
        watchLit();
        watchGameChannels();
        hookChatInput();
        doConnect();
        wasConnected = true;

        // Also catch OAuth redirect if we're the popup (follower mail might miss it)
        var h = window.location.hash;
        if (h && h.indexOf('access_token=') !== -1) {
            var p = new URLSearchParams(h.slice(1));
            var t = p.get('access_token');
            if (t) {
                // Check if it has chat:read scope
                fetch('https://id.twitch.tv/oauth2/validate', {
                    headers: { 'Authorization': 'Bearer ' + t },
                }).then(function (r) { return r.json(); }).then(function (info) {
                    if (info && info.scopes && info.scopes.indexOf('chat:read') !== -1) {
                        localStorage.setItem(SHARED_TOKEN_KEY, JSON.stringify({
                            token: t,
                            expiresAt: Date.now() + (parseInt(p.get('expires_in') || '14400', 10) * 1000),
                        }));
                    }
                });
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
