// ==UserScript==
// @name         OE2 SCAN — Ship Component Analysis Network
// @namespace    https://game.dev.outerempires.net/
// @version      2.0
// @description  Real-time target ship component & shield tracking via WebSocket (ShipPartsUpdate)
// @match        https://game.dev.outerempires.net/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    var POS_KEY = 'oe2_scan_pos';
    var SLOTS = { Weapons: { label: 'WPN' }, Turrets: { label: 'TRT' }, Engines: { label: 'ENG' }, Core: { label: 'CORE' }, Shields: { label: 'SHD' }, Ammo: { label: 'AMMO' } };

    var API_BASE = localStorage.getItem('_oe2_api_base') || '';
    var API_AUTH = localStorage.getItem('_oe2_api_auth') || '';
    var API_CHAR_ID = localStorage.getItem('_oe2_api_char_id') || '';

    var overlayEl = null;
    var reopenBtn = null;
    var isDragging = false;
    var dragOffX = 0, dragOffY = 0;
    var isExpanded = false;
    var isVisible = false;
    var isUserHidden = false;

    var ships = {};
    var playerShipId = null;
    var targetId = null;

    console.log('[SCAN] v2.0 loaded' + (API_CHAR_ID ? ' (cached char ' + API_CHAR_ID + ')' : ' (awaiting char)'));

    (function () {
        var origFetch = window.fetch;
        window.fetch = function (input, init) {
            var r = origFetch.apply(this, arguments);
            r.then(function (resp) {
                try {
                    var url = typeof input === 'string' ? input : input ? input.url : '';
                    if (!url || url.indexOf('twitch') !== -1) return;
                    if (url.indexOf('oe2') === -1 && url.indexOf('outerempires') === -1) return;
                    if (!API_BASE) { var m = url.match(/^(https:\/\/[^/]+)/); if (m) { API_BASE = m[1]; localStorage.setItem('_oe2_api_base', API_BASE); } }
                    var cm = url.match(/characterId=(\d+)/);
                    if (cm) { API_CHAR_ID = cm[1]; localStorage.setItem('_oe2_api_char_id', API_CHAR_ID); }
                    var headers = init ? init.headers : (input ? input.headers : {});
                    if (typeof headers === 'object' && !Array.isArray(headers)) {
                        var auth = headers.Authorization || headers.authorization || '';
                        if (auth && !API_AUTH) { API_AUTH = auth; localStorage.setItem('_oe2_api_auth', API_AUTH); }
                    }
                } catch (e) {}
            });
            return r;
        };
        var _open = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url) {
            this._scanUrl = url;
            return _open.apply(this, arguments);
        };
        var _setH = XMLHttpRequest.prototype.setRequestHeader;
        XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
            var u = this._scanUrl || '';
            if (u.indexOf('oe2') !== -1 || u.indexOf('outerempires') !== -1) {
                if (u.indexOf('twitch') === -1 && k.toLowerCase() === 'authorization' && !API_AUTH) {
                    API_AUTH = v; localStorage.setItem('_oe2_api_auth', API_AUTH);
                }
                if (!API_BASE) { var m = u.match(/^(https:\/\/[^/]+)/); if (m) { API_BASE = m[1]; localStorage.setItem('_oe2_api_base', API_BASE); } }
                var cm = u.match(/characterId=(\d+)/);
                if (cm) { API_CHAR_ID = cm[1]; localStorage.setItem('_oe2_api_char_id', API_CHAR_ID); }
            }
            return _setH.apply(this, arguments);
        };
    })();

    (function () {
        var _origAdd = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function (type, listener, options) {
            if (type === 'message' && this instanceof WebSocket) {
                var self = this;
                var wrapped = function (e) {
                    if (typeof e.data === 'string') tryProcess(e.data);
                    if (typeof listener === 'function') return listener.apply(self, arguments);
                    else if (listener && typeof listener.handleEvent === 'function') return listener.handleEvent(e);
                };
                return _origAdd.call(this, type, wrapped, options);
            }
            return _origAdd.apply(this, arguments);
        };
        if (window.WebSocket) {
            var NativeWebSocket = window.WebSocket;
            window.WebSocket = function (url, protocols) {
                var ws = new NativeWebSocket(url, protocols);
                ws.addEventListener('message', function (e) {
                    if (typeof e.data === 'string') tryProcess(e.data);
                });
                return ws;
            };
            window.WebSocket.prototype = NativeWebSocket.prototype;
            window.WebSocket.CONNECTING = NativeWebSocket.CONNECTING;
            window.WebSocket.OPEN = NativeWebSocket.OPEN;
            window.WebSocket.CLOSING = NativeWebSocket.CLOSING;
            window.WebSocket.CLOSED = NativeWebSocket.CLOSED;
        }
        function tryProcess(text) {
            try { var p = JSON.parse(text); } catch (e) { return; }
            var msgs = Array.isArray(p) ? p : [p];
            for (var i = 0; i < msgs.length; i++) {
                var m = msgs[i];
                if (m.message_type === 'GameUpdate' && m.message) {
                    handleGameUpdate(m.message);
                }
            }
        }
    })();

    function handleGameUpdate(msg) {
        var action = msg.action;
        var payload = msg.payload;
        if (!action || !payload) return;
        if (action === 'Update') {
            updateShips(payload);
            resolveTarget();
            renderTarget();
        } else if (action === 'CombinedUpdate' && Array.isArray(payload)) {
            handleCombinedUpdate(payload);
        } else if (action === 'ShipPartsUpdate' && Array.isArray(payload)) {
            handleOrphanParts(payload);
        }
    }

    function handleCombinedUpdate(actions) {
        var lastSid = null;
        for (var i = 0; i < actions.length; i++) {
            var a = actions[i];
            if (a.action === 'Update' && Array.isArray(a.payload)) {
                for (var j = 0; j < a.payload.length; j++) {
                    var sd = a.payload[j];
                    var sid = sd.ship_id;
                    if (sid !== undefined) {
                        if (!ships[sid]) ships[sid] = {};
                        for (var k in sd) { if (sd.hasOwnProperty(k)) ships[sid][k] = sd[k]; }
                        ships[sid]._lastSeen = Date.now();
                        lastSid = sid;
                        if (sd.char_id !== undefined && sd.char_id !== null) {
                            var cid = '' + sd.char_id;
                            if (!API_CHAR_ID) {
                                API_CHAR_ID = cid;
                                localStorage.setItem('_oe2_api_char_id', API_CHAR_ID);
                            }
                            if (cid === API_CHAR_ID) {
                                playerShipId = sid;
                            }
                        }
                    }
                }
            } else if (a.action === 'ShipPartsUpdate' && Array.isArray(a.payload)) {
                var sid = lastSid !== null ? lastSid : (targetId !== null ? targetId : null);
                if (sid !== null) {
                    if (!ships[sid]) ships[sid] = {};
                    if (!ships[sid]._comps) ships[sid]._comps = {};
                    applyComps(ships[sid]._comps, a.payload);
                }
            }
        }
        resolveTarget();
        renderTarget();
    }

    function updateShips(arr) {
        for (var i = 0; i < arr.length; i++) {
            var sd = arr[i];
            var sid = sd.ship_id;
            if (sid !== undefined) {
                if (!ships[sid]) ships[sid] = {};
                for (var k in sd) { if (sd.hasOwnProperty(k)) ships[sid][k] = sd[k]; }
                ships[sid]._lastSeen = Date.now();
                if (sd.char_id !== undefined && sd.char_id !== null) {
                    var cid = '' + sd.char_id;
                    if (!API_CHAR_ID) {
                        API_CHAR_ID = cid;
                        localStorage.setItem('_oe2_api_char_id', API_CHAR_ID);
                    }
                    if (cid === API_CHAR_ID) {
                        playerShipId = sid;
                    }
                }
            }
        }
    }

    function handleOrphanParts(parts) {
        if (targetId !== null && ships[targetId]) {
            if (!ships[targetId]._comps) ships[targetId]._comps = {};
            var prev = Object.keys(ships[targetId]._comps).length;
            applyComps(ships[targetId]._comps, parts);
            if (Object.keys(ships[targetId]._comps).length !== prev) renderTarget();
        }
    }

    function applyComps(dest, parts) {
        for (var i = 0; i < parts.length; i++) {
            var c = parts[i];
            var id = c.id !== undefined && c.id !== null ? '' + c.id : null;
            if (!id) continue;
            if (!dest[id]) {
                dest[id] = JSON.parse(JSON.stringify(c));
            } else {
                var oldHP = dest[id].healthPercentage;
                for (var k in c) { if (c.hasOwnProperty(k)) dest[id][k] = c[k]; }
                if (oldHP !== undefined && dest[id].healthPercentage !== undefined && dest[id].healthPercentage < oldHP) {
                    dest[id]._damageFlash = Date.now();
                }
            }
        }
    }

    function resolveTarget() {
        if (playerShipId !== null && ships[playerShipId]) {
            var t = ships[playerShipId].targeting;
            if (t !== undefined && t !== null) {
                if (targetId !== t) {
                    targetId = t;
                    if (t !== null && ships[t] && ships[t]._comps === undefined) ships[t]._comps = {};
                }
            } else {
                targetId = null;
            }
        } else {
            targetId = null;
        }
    }

    function getTargetShip() {
        if (targetId === null || targetId === undefined) return null;
        if (!ships[targetId]) return null;
        var sd = ships[targetId];
        return {
            shipName: sd.name || sd.ship_type || '',
            shipType: sd.ship_type || '',
            size: sd.size || '',
            state: sd.state || '',
            faction: sd.faction_tag || '',
            factionColour: sd.faction_colour || '',
            shield: sd.shield || null,
            weapons: sd.weapons || [],
            components: sd._comps || null,
            targeting: sd.targeting,
            targetedBy: sd.targeted_by || [],
            transponder: sd.transponder || '',
            power: sd.power || null
        };
    }

    function renderTarget() {
        if (!overlayEl) return;
        var tgt = getTargetShip();
        var body = overlayEl.querySelector('.vb');
        var nameEl = overlayEl.querySelector('.vln');

        if (!tgt) {
            body.innerHTML = '<div style="color:#888;font-size:12px;text-align:center">\u2014 no target \u2014</div>';
            if (nameEl) nameEl.textContent = '';
            return;
        }

        if (nameEl) nameEl.innerHTML = ' \u2014 ' + esc(tgt.shipName) +
            (tgt.faction ? ' <span style="color:' + (tgt.factionColour || '#888') + ';font-size:10px;font-weight:400">[' + esc(tgt.faction) + ']</span>' : '');

        var shieldHtml = '';
        if (tgt.shield && tgt.shield.max_hit_points > 0) {
            var sh = tgt.shield;
            var sPct = Math.round(sh.current_hit_points / sh.max_hit_points * 100);
            var shCol = sPct > 50 ? '#4dd0e1' : sPct > 25 ? '#ff9800' : '#ff6b6b';
            shieldHtml = '<div style="display:flex;align-items:center;gap:4px;padding:1px 0;font-size:11px;margin-bottom:2px">' +
                '<span style="color:#ff7ec8;width:22px;flex-shrink:0;font-weight:700">SHD</span>' +
                '<div style="flex:1;height:8px;background:rgba(0,0,0,0.4);border-radius:2px;overflow:hidden">' +
                '<div style="height:100%;width:' + sPct + '%;background:' + shCol + ';transition:width .3s;border-radius:2px"></div></div>' +
                '<span style="width:34px;text-align:right;font-weight:700;font-size:11px;color:' + shCol + '">' + sPct + '%</span></div>';
        } else if (tgt.shield) {
            shieldHtml = '<div style="display:flex;align-items:center;gap:4px;padding:1px 0;font-size:11px;margin-bottom:2px;color:#555">' +
                '<span style="color:#ff7ec8;width:22px;flex-shrink:0;font-weight:700">SHD</span>' +
                '<span style="font-size:10px">no shield</span></div>';
        }

        var compList = [];
        if (tgt.components) {
            var now = Date.now();
            for (var id in tgt.components) {
                var c = tgt.components[id];
                if (c._damageFlash && now - c._damageFlash > 1000) delete c._damageFlash;
                compList.push(c);
            }
        }

        var infoHtml = '';
        if (tgt.size || tgt.state) {
            infoHtml = '<div style="font-size:10px;color:#888;padding:0 0 2px 0">' +
                (tgt.size ? '<span style="color:#aaa">' + esc(tgt.size) + '</span>' : '') +
                (tgt.size && tgt.state ? ' &middot; ' : '') +
                (tgt.state ? '<span>' + esc(tgt.state) + '</span>' : '') +
                '</div>';
        }

        var powerHtml = '';
        if (tgt.power !== null && tgt.power !== undefined) {
            var pwr = tgt.power;
            var pwrPct = Math.round((pwr.current || 0) / (pwr.max || 1) * 100);
            var pwrCol = pwrPct > 50 ? '#4dd0e1' : pwrPct > 25 ? '#ff9800' : '#ff6b6b';
            powerHtml = '<div style="display:flex;align-items:center;gap:4px;padding:1px 0;font-size:11px;margin-bottom:2px">' +
                '<span style="color:#ff7ec8;width:22px;flex-shrink:0;font-weight:700">PWR</span>' +
                '<div style="flex:1;height:8px;background:rgba(0,0,0,0.4);border-radius:2px;overflow:hidden">' +
                '<div style="height:100%;width:' + pwrPct + '%;background:' + pwrCol + ';transition:width .3s;border-radius:2px"></div></div>' +
                '<span style="width:34px;text-align:right;font-weight:700;font-size:11px;color:' + pwrCol + '">' + pwrPct + '%</span></div>';
        }

        var wpnHtml = '';
        if (tgt.weapons && tgt.weapons.length > 0) {
            wpnHtml = '<div style="display:flex;align-items:center;gap:4px;padding:1px 0;font-size:11px;margin-bottom:2px;color:#e0e8f0">' +
                '<span style="color:#ff7ec8;width:22px;flex-shrink:0;font-weight:700">WPN</span>' +
                '<span style="font-size:10px">' + tgt.weapons.length + ' weapon' + (tgt.weapons.length > 1 ? 's' : '') + '</span></div>';
        }

        var gradeHtml = '';
        if (compList.length > 0) {
            var total = 0, count = 0;
            for (var i = 0; i < compList.length; i++) {
                var hp = compList[i].healthPercentage;
                if (hp !== null && hp !== undefined) { total += hp; count++; }
            }
            var avg = count > 0 ? total / count : null;
            var grd = maintenanceGrade(avg);
            gradeHtml = '<div style="display:flex;align-items:center;gap:4px;padding:0 0 2px 0">' +
                '<span style="font-size:16px;font-weight:700;color:' + grd.color + '">' + grd.grade + '</span>' +
                '<span style="font-size:10px;color:#888">(' + compList.length + ' components)</span></div>';
        }

        var vsEl = body.querySelector('.vs');
        if (!vsEl) {
            body.innerHTML = '<div class="vs"></div><div class="vlist"></div>';
            vsEl = body.querySelector('.vs');
        }
        vsEl.innerHTML = infoHtml + shieldHtml + powerHtml + wpnHtml + gradeHtml;

        var list = body.querySelector('.vlist');

        var wanted = [];
        for (var i = 0; i < compList.length; i++) {
            var c = compList[i];
            var hp = c.healthPercentage;
            var pct = hp !== null && hp !== undefined ? Math.round(hp) : null;
            if (isExpanded || pct === null || pct < 65) {
                var key = getSlot(c.name, c.blueprintType);
                var def = SLOTS[key] || SLOTS.Core;
                wanted.push({ comp: c, pct: pct, slotDef: def, idx: i });
            }
        }
        if (!isExpanded && wanted.length === 0) {
            var fallback = [];
            for (var i = 0; i < compList.length; i++) {
                var hp = compList[i].healthPercentage;
                var pct = hp !== null && hp !== undefined ? Math.round(hp) : null;
                if (pct !== null && pct < 85) {
                    var key = getSlot(compList[i].name, compList[i].blueprintType);
                    var def = SLOTS[key] || SLOTS.Core;
                    fallback.push({ comp: compList[i], pct: pct, slotDef: def, idx: i });
                }
            }
            fallback.sort(function (a, b) { return (a.pct !== null ? a.pct : 999) - (b.pct !== null ? b.pct : 999); });
            wanted = fallback.slice(0, 3);
        }
        wanted.sort(function (a, b) {
            var ha = a.pct !== null ? a.pct : 999;
            var hb = b.pct !== null ? b.pct : 999;
            return ha - hb;
        });

        var currById = {};
        list.querySelectorAll('.vr').forEach(function (el) { currById[el.getAttribute('data-id') || ''] = el; });
        var wantedIds = {};
        wanted.forEach(function (w) {
            var id = w.comp.Id !== undefined && w.comp.Id !== null ? '' + w.comp.Id : 'c_' + w.idx;
            w.id = id;
            wantedIds[id] = true;
        });
        var leaving = [];
        Object.keys(currById).forEach(function (id) { if (!wantedIds[id]) leaving.push(currById[id]); });
        if (leaving.length > 0) {
            leaving.forEach(function (el) { el.classList.add('vr-leave'); });
            setTimeout(function () { rebuildList(list, currById, wanted); }, 300);
        } else {
            rebuildList(list, currById, wanted);
        }
    }

    function rebuildList(list, currById, wanted) {
        var frag = document.createDocumentFragment();
        var animQueue = [];
        wanted.forEach(function (w) {
            var html = renderComp(w.comp, w.slotDef);
            var temp = document.createElement('div');
            temp.innerHTML = html;
            var el = temp.firstChild;
            el.setAttribute('data-id', w.id);
            if (!currById[w.id]) {
                el.classList.add('vr-enter');
                animQueue.push(el);
            }
            frag.appendChild(el);
        });
        list.innerHTML = '';
        list.appendChild(frag);
        animQueue.forEach(function (el) {
            requestAnimationFrame(function () {
                el.classList.add('vr-enter-active');
            });
        });
        if (animQueue.length > 0) {
            setTimeout(function () {
                animQueue.forEach(function (el) {
                    el.classList.remove('vr-enter');
                    el.classList.remove('vr-enter-active');
                });
            }, 400);
        }
    }

    function renderComp(c, slotDef) {
        var hp = c.healthPercentage;
        var pct = hp !== null && hp !== undefined ? Math.round(hp) : null;
        var col = healthColor(pct);
        var mr = null;
        var mrFields = ['lastRepairHealthPercentage', 'maxRepair', 'maxRepairPercentage'];
        for (var fi = 0; fi < mrFields.length; fi++) {
            var v = c[mrFields[fi]];
            if (v !== null && v !== undefined) { mr = Math.round(v); break; }
        }
        var bg = '';
        var cls = 'vr';
        if (pct === 0) {
            col = '#ff0000';
            cls = 'vr vr-zero';
        } else if (pct !== null && mr !== null && mr > pct) {
            bg = 'linear-gradient(to right,rgba(102,162,103,0.5) 0%,rgba(102,162,103,0.5) ' + pct + '%,rgba(234,237,137,0.5) ' + pct + '%,rgba(234,237,137,0.5) ' + mr + '%,rgba(166,69,68,0.5) ' + mr + '%,rgba(166,69,68,0.5) 100%)';
        } else if (pct !== null) {
            bg = 'linear-gradient(to right,rgba(102,162,103,0.5) 0%,rgba(102,162,103,0.5) ' + pct + '%,rgba(166,69,68,0.5) ' + pct + '%,rgba(166,69,68,0.5) 100%)';
        }
        if (c._damageFlash && Date.now() - c._damageFlash < 500) cls += ' vr-dmg-flash';
        return '<div class="' + cls + '" style="background:' + bg + '">' +
            '<span class="vt" style="color:' + col + '">' + slotDef.label + '</span>' +
            '<span class="vn" title="' + esc(c.name || '?') + ': ' + (pct !== null ? pct + '%' : '--') + (mr !== null ? ' repair:' + mr + '%' : '') + '">' + esc(c.name || '?') + '</span>' +
            '<span class="vp2" style="color:' + (pct !== null ? col : '#888') + '">' + (pct !== null ? pct + '%' : '--') + '</span>' +
            '</div>';
    }

    function healthColor(pct) {
        if (pct === null || pct === undefined) return '#888';
        if (pct > 80) return '#4dd0e1';
        if (pct > 60) return '#00eda2';
        if (pct > 40) return '#ff9800';
        if (pct > 20) return '#ffc107';
        return '#ff6b6b';
    }

    function maintenanceGrade(pct) {
        if (pct === null || pct === undefined) return { grade: '\u2014\u2014', color: '#3a6ea8' };
        if (pct >= 95) return { grade: 'A', color: '#00eda2' };
        if (pct >= 85) return { grade: 'B', color: '#8bc34a' };
        if (pct >= 70) return { grade: 'C', color: '#ffc107' };
        if (pct >= 50) return { grade: 'D', color: '#ff9800' };
        return { grade: 'F', color: '#ff6b6b' };
    }

    function getSlot(name, blue) {
        name = (name || '').toLowerCase(); blue = (blue || '').toLowerCase();
        if (blue === 'weapon' || blue === 'weapons' || name.match(/laser|missile|rail|cannon|launcher|turret|beam|blaster/)) return name.includes('turret') ? 'Turrets' : 'Weapons';
        if (blue === 'engine' || blue === 'engines' || name.match(/engine|drive|thruster|propul|warp/)) return 'Engines';
        if (blue === 'core' || name.match(/reactor|core|power|cpu|processor/)) return 'Core';
        if (blue === 'shield' || blue === 'shields' || name.match(/shield|deflector|armor|plat/)) return 'Shields';
        if (blue === 'ammo' || name.match(/ammo|charge|battery|cell/)) return 'Ammo';
        if (blue === 'turret' || name.includes('turret')) return 'Turrets';
        return 'Core';
    }

    function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    function createOverlay() {
        console.log('[SCAN] createOverlay() called');
        isUserHidden = false;
        if (overlayEl) { overlayEl.style.display = ''; isVisible = true; return; }
        if (reopenBtn) reopenBtn.style.display = 'none';
        overlayEl = document.createElement('div');
        overlayEl.id = 'oe2-scan-overlay';
        overlayEl.style.cssText = [
            'position:fixed',
            'z-index:280',
            'bottom:20px',
            'right:286px',
            'background:rgba(6,12,22,0.3)',
            'padding:4px 0',
            'font-family:Rajdhani,"Segoe UI",sans-serif',
            'color:#e0e8f0',
            'font-size:15px',
            'width:260px',
            'pointer-events:auto',
            'cursor:move',
            'user-select:none',
            'text-shadow:0 0 8px #000,0 1px 4px #000',
        ].join(';') + ';';
        var saved = localStorage.getItem(POS_KEY);
        if (saved) { try { var p = JSON.parse(saved); if (p.x >= 0 && p.y >= 0 && p.y < 10000) { overlayEl.style.left = p.x + 'px'; overlayEl.style.bottom = p.y + 'px'; overlayEl.style.top = ''; overlayEl.style.right = ''; } else { localStorage.removeItem(POS_KEY); } } catch (e) { localStorage.removeItem(POS_KEY); } }
        overlayEl.innerHTML =
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">' +
            '<span style="font-size:11px;font-weight:700;color:#ff7ec8;letter-spacing:.5px;">\u25C6 SCAN <span class="vln" style="color:#e0e8f0;letter-spacing:0;"></span></span>' +
            '<span class="vtg" style="color:#ff7ec8;cursor:pointer;font-size:13px;line-height:1;user-select:none;opacity:0.6;" title="Show all">\u2295</span>' +
            '</div>' +
            '<div class="vb"><div style="color:#888;font-size:12px;text-align:center">\u2014 no target \u2014</div></div>';
        document.body.appendChild(overlayEl);
        var vtg = overlayEl.querySelector('.vtg');
        vtg.addEventListener('click', function () {
            isExpanded = !isExpanded;
            vtg.textContent = isExpanded ? '\u2296' : '\u2295';
            vtg.title = isExpanded ? 'Show damaged only' : 'Show all';
            renderTarget();
        });
        isVisible = true;
        overlayEl.addEventListener('mousedown', function (e) {
            isDragging = true;
            var r = overlayEl.getBoundingClientRect();
            dragOffX = e.clientX - r.left; dragOffY = e.clientY - r.top;
            overlayEl.style.right = ''; overlayEl.style.top = ''; overlayEl.style.left = r.left + 'px';
            overlayEl.style.bottom = (window.innerHeight - e.clientY + dragOffY - r.height) + 'px';
        });
        injectStyles();
    }

    function hideOverlay(auto) { if (!overlayEl) return; overlayEl.style.display = 'none'; isVisible = false; if (!auto) createReopenBtn(); }

    function createReopenBtn() {
        if (reopenBtn) { reopenBtn.style.display = ''; return; }
        reopenBtn = document.createElement('div');
        reopenBtn.id = 'oe2-scan-reopen';
        reopenBtn.textContent = '\u25C6';
        reopenBtn.title = 'Open SCAN panel';
        Object.assign(reopenBtn.style, {
            position:'fixed',zIndex:'999997',bottom:'20px',right:'286px',
            width:'32px',height:'32px',borderRadius:'50%',
            background:'rgba(6,12,22,0.35)',border:'1px solid rgba(255,126,200,0.3)',
            color:'#ff7ec8',fontSize:'14px',cursor:'pointer',display:'flex',
            alignItems:'center',justifyContent:'center',
            boxShadow:'0 0 12px rgba(255,126,200,0.1)',transition:'all 0.2s',userSelect:'none'
        });
        reopenBtn.addEventListener('mouseenter', function () { reopenBtn.style.borderColor = '#ff7ec8'; reopenBtn.style.boxShadow = '0 0 16px rgba(255,126,200,0.2)'; });
        reopenBtn.addEventListener('mouseleave', function () { reopenBtn.style.borderColor = 'rgba(255,126,200,0.3)'; reopenBtn.style.boxShadow = '0 0 12px rgba(255,126,200,0.1)'; });
        reopenBtn.addEventListener('click', function () { createOverlay(); reopenBtn.style.display = 'none'; });
        document.body.appendChild(reopenBtn);
    }

    function injectStyles() {
        if (document.getElementById('scan-st')) return;
        var el = document.createElement('style');
        el.id = 'scan-st';
        el.textContent = "@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;600;700&display=swap');" +
            '.vtg:hover{opacity:1!important;color:#ff7ec8!important}' +
            '.vlist{overflow:hidden}' +
            '.vr{display:flex;align-items:center;gap:4px;padding:2px 0;transition:all 0.3s ease;overflow:hidden;min-width:0}' +
            '#oe2-scan-overlay .vr:hover{background:rgba(255,255,255,0.02)}' +
            '.vr-enter{opacity:0;transform:translateY(16px);max-height:0;padding-top:0;padding-bottom:0}' +
            '.vr-enter-active{opacity:1;transform:translateY(0);max-height:30px}' +
            '.vr-leave{opacity:0;transform:translateY(16px);max-height:0;padding-top:0;padding-bottom:0;margin:0}' +
            '.vt{width:22px;font-size:10px;font-weight:700;text-align:center;flex-shrink:0}' +
            '.vn{flex:1;font-size:13px;font-weight:600;color:#e0e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}' +
            '.vp2{width:30px;text-align:right;font-size:11px;font-weight:700;flex-shrink:0}' +
            '.vd{display:inline-block;width:6px;height:6px;border-radius:50%;margin:1px}' +
            '@keyframes vital-blink{0%,100%{opacity:1;background:rgba(255,0,0,0.4)}50%{opacity:0.2;background:rgba(255,0,0,0.1)}}' +
            '.vr-zero{animation:vital-blink .6s ease-in-out infinite!important}' +
            '@keyframes vital-dmg-flash{0%{box-shadow:inset 0 0 0 0 transparent}25%{box-shadow:inset 0 0 18px 4px rgba(255,140,0,0.55)}to{box-shadow:inset 0 0 0 0 transparent}}' +
            '.vr-dmg-flash{animation:vital-dmg-flash .5s ease-out forwards!important}';
        (document.head || document.documentElement).appendChild(el);
    }

    document.addEventListener('mousemove', function (e) {
        if (!isDragging || !overlayEl) return;
        overlayEl.style.left = (e.clientX - dragOffX) + 'px';
        overlayEl.style.bottom = (window.innerHeight - (e.clientY - dragOffY) - overlayEl.offsetHeight) + 'px';
    });
    document.addEventListener('mouseup', function () {
        if (isDragging && overlayEl) {
            isDragging = false;
            overlayEl.style.cursor = '';
            var r = overlayEl.getBoundingClientRect();
            localStorage.setItem(POS_KEY, JSON.stringify({ x: r.left, y: window.innerHeight - r.bottom }));
        }
    });
    document.addEventListener('keydown', function (e) { if (e.altKey && e.key === 's') { e.preventDefault(); if (isVisible && overlayEl && overlayEl.style.display !== 'none') { isUserHidden = true; hideOverlay(); } else { isUserHidden = false; createOverlay(); } } });

    function start() {
        createOverlay();
    }
    (function waitForBody() {
        if (document.body) { start(); }
        else { requestAnimationFrame(waitForBody); }
    })();
})();
