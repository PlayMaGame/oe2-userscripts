// ==UserScript==
// @name         OE2 VITAL — Vessel Integrity Tracking & Assessment Layer
// @namespace    https://game.dev.outerempires.net/
// @version      1.7
// @description  Real-time ship maintenance grade — A-F rating, component dot grid, and details
// @match        https://game.dev.outerempires.net/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    var POS_KEY = 'oe2_vital_pos';
    var SLOTS = { Weapons: { label: 'WPN' }, Turrets: { label: 'TRT' }, Engines: { label: 'ENG' }, Core: { label: 'CORE' }, Shields: { label: 'SHD' }, Ammo: { label: 'AMMO' } };

    var API_BASE = '';
    var API_AUTH = '';
    var API_CHAR_ID = '';
    var API_SHIP_ID = '';

    var overlayEl = null;
    var reopenBtn = null;
    var vtgBtn = null;
    var pollTimer = null;
    var isDragging = false;
    var dragOffX = 0, dragOffY = 0;
    var isExpanded = false;
    var isVisible = false;
    var lastShipData = null;
    var isUserHidden = false;
    // Intercept game's own API traffic to capture base URL + auth token + character ID
    (function () {
        var origFetch = window.fetch;
        window.fetch = function (input, init) {
            var r = origFetch.apply(this, arguments);
            r.then(function () {
                try {
                    var url = typeof input === 'string' ? input : input ? input.url : '';
                    if (!url || url.indexOf('twitch') !== -1) return;
                    if (url.indexOf('oe2') === -1 && url.indexOf('outerempires') === -1) return;
                    if (!API_BASE) { var m = url.match(/^(https:\/\/[^/]+)/); if (m) API_BASE = m[1]; }
                    var cm = url.match(/characterId=(\d+)/);
                    if (cm) API_CHAR_ID = cm[1];
                    var sm = url.match(/\/v1\/ship\/(\d+)\//);
                    if (sm) API_SHIP_ID = sm[1];
                    var headers = init ? init.headers : (input ? input.headers : {});
                    if (typeof headers === 'object' && !Array.isArray(headers)) {
                        var auth = headers.Authorization || headers.authorization || '';
                        if (auth && !API_AUTH) API_AUTH = auth;
                    }
                } catch (e) {}
            });
            return r;
        };
    })();
    (function () {
        var _open = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url) {
            this._vitalUrl = url;
            return _open.apply(this, arguments);
        };
        var _setH = XMLHttpRequest.prototype.setRequestHeader;
        XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
            var u = this._vitalUrl || '';
            if (u.indexOf('twitch') === -1 && (u.indexOf('oe2') !== -1 || u.indexOf('outerempires') !== -1)) {
                if (!API_BASE) { var m = u.match(/^(https:\/\/[^/]+)/); if (m) API_BASE = m[1]; }
                if (k.toLowerCase() === 'authorization' && !API_AUTH) API_AUTH = v;
                var cm = u.match(/characterId=(\d+)/);
                if (cm) API_CHAR_ID = cm[1];
                var sm = u.match(/\/v1\/ship\/(\d+)\//);
                if (sm) API_SHIP_ID = sm[1];
            }
            return _setH.apply(this, arguments);
        };
    })();

    function fetchShipConfig() {
        if (!API_BASE || !API_AUTH) return Promise.resolve(null);
        return fetch(API_BASE + '/v1/character/' + API_CHAR_ID + '/availableShips', {
            headers: { 'Authorization': API_AUTH }
        }).then(function (resp) {
            if (!resp.ok) return null;
            return resp.json().then(function (body) {
                if (!body || !body.success) return null;
                var ships = body.data;
                if (!Array.isArray(ships) || ships.length === 0) return null;
                // Pick the first ship (or the one matching our captured ship ID)
                var ship = ships[0];
                if (API_SHIP_ID) {
                    for (var i = 0; i < ships.length; i++) {
                        if (ships[i].id == API_SHIP_ID) { ship = ships[i]; break; }
                    }
                }
                // Compute overallIntegrity and isDamaged from components if missing
                if (ship && ship.components && ship.components.length > 0) {
                    if (!ship.summary) ship.summary = {};
                    var total = 0, count = 0, damaged = false;
                    for (var i = 0; i < ship.components.length; i++) {
                        var hp = ship.components[i].healthPercentage;
                        if (hp !== null && hp !== undefined) { total += hp; count++; }
                        if (hp !== null && hp !== undefined && hp < 90) damaged = true;
                    }
                    ship.summary.overallIntegrity = count > 0 ? total / count : null;
                    ship.summary.isDamaged = damaged;
                }
                return ship;
            }).catch(function () { return null; });
        }).catch(function () { return null; });
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

    function dotColor(pct) {
        if (pct === null || pct === undefined) return '#888';
        if (pct > 80) return '#4dd0e1';
        if (pct > 60) return '#00eda2';
        if (pct > 40) return '#ff9800';
        if (pct > 20) return '#ffc107';
        return '#ff6b6b';
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

    function positionVtg() {
        if (!vtgBtn || !overlayEl) return;
        var r = overlayEl.getBoundingClientRect();
        vtgBtn.style.right = (window.innerWidth - r.right - 20) + 'px';
        vtgBtn.style.bottom = (window.innerHeight - r.bottom - 2) + 'px';
    }

    function createOverlay() {
        isUserHidden = false;
        if (overlayEl) { overlayEl.style.display = ''; if (vtgBtn) vtgBtn.style.display = ''; positionVtg(); isVisible = true; schedulePoll(); return; }
        if (reopenBtn) reopenBtn.style.display = 'none';
        overlayEl = document.createElement('div');
        overlayEl.id = 'oe2-vital-overlay';
        overlayEl.style.cssText = [
            'position:fixed',
            'z-index:280',
            'bottom:20px',
            'right:16px',
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
        if (saved) { try { var p = JSON.parse(saved); overlayEl.style.left = p.x + 'px'; overlayEl.style.bottom = p.y + 'px'; overlayEl.style.right = ''; } catch (e) {} }
        overlayEl.innerHTML =
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">' +
            '<span style="font-size:11px;font-weight:700;color:#7ecfff;letter-spacing:.5px;">\u25C6 VITAL <span class="vln" style="color:#e0e8f0;letter-spacing:0;"></span></span>' +
            '</div>' +
            '<div class="vb"></div>';
        var hud = document.querySelector('#ui-component') || document.body;
        hud.appendChild(overlayEl);
        // Toggle button
        vtgBtn = document.createElement('span');
        vtgBtn.className = 'vtg';
        vtgBtn.textContent = '\u2295';
        vtgBtn.title = 'Show all';
        vtgBtn.style.cssText = 'position:fixed;z-index:9999;color:#546e7a;cursor:pointer;font-size:14px;padding:2px;user-select:none;';
        hud.appendChild(vtgBtn);
        positionVtg();
        vtgBtn.addEventListener('click', toggleExpand);
        isVisible = true;
        overlayEl.addEventListener('mousedown', function (e) {
            isDragging = true;
            var r = overlayEl.getBoundingClientRect();
            dragOffX = e.clientX - r.left; dragOffY = e.clientY - r.top;
            overlayEl.style.right = ''; overlayEl.style.left = r.left + 'px';
            overlayEl.style.bottom = (window.innerHeight - e.clientY + dragOffY - r.height) + 'px';
        });
        injectStyles();
    }

    function hideOverlay(auto) { if (!overlayEl) return; overlayEl.style.display = 'none'; if (vtgBtn) vtgBtn.style.display = 'none'; isVisible = false; if (pollTimer) clearTimeout(pollTimer); if (!auto) createReopenBtn(); }

    function createReopenBtn() {
        if (reopenBtn) { reopenBtn.style.display = ''; return; }
        reopenBtn = document.createElement('div');
        reopenBtn.id = 'oe2-vital-reopen';
        reopenBtn.textContent = '\u25C6';
        reopenBtn.title = 'Open VITAL panel';
        Object.assign(reopenBtn.style, {
            position:'fixed',zIndex:'999997',bottom:'16px',right:'16px',
            width:'32px',height:'32px',borderRadius:'50%',
            background:'rgba(6,12,22,0.35)',border:'1px solid rgba(0,229,255,0.3)',
            color:'#00e5ff',fontSize:'14px',cursor:'pointer',display:'flex',
            alignItems:'center',justifyContent:'center',
            boxShadow:'0 0 12px rgba(0,229,255,0.1)',transition:'all 0.2s',userSelect:'none'
        });
        reopenBtn.addEventListener('mouseenter', function () { reopenBtn.style.borderColor = '#4dd0e1'; reopenBtn.style.boxShadow = '0 0 16px rgba(0,229,255,0.2)'; });
        reopenBtn.addEventListener('mouseleave', function () { reopenBtn.style.borderColor = 'rgba(0,229,255,0.3)'; reopenBtn.style.boxShadow = '0 0 12px rgba(0,229,255,0.1)'; });
        reopenBtn.addEventListener('click', function () { createOverlay(); reopenBtn.style.display = 'none'; });
        document.body.appendChild(reopenBtn);
    }

    function toggleExpand() {
        isExpanded = !isExpanded;
        if (vtgBtn) {
            vtgBtn.textContent = isExpanded ? '\u2296' : '\u2295';
            vtgBtn.title = isExpanded ? 'Show damaged only' : 'Show all';
        }
        if (lastShipData) render(lastShipData);
    }

    function injectStyles() {
        if (document.getElementById('vital-st')) return;
        var el = document.createElement('style');
        el.id = 'vital-st';
        el.textContent = "@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;600;700&display=swap');" +
            '.vtg:hover{color:#4dd0e1!important}' +
            '.vlist{overflow:hidden}' +
            '.vr{display:flex;align-items:center;gap:4px;padding:2px 0;transition:all 0.3s ease;overflow:hidden;min-width:0}' +
            '#oe2-vital-overlay .vr:hover{background:rgba(255,255,255,0.02)}' +
            '.vr-enter{opacity:0;transform:translateY(16px);max-height:0;padding-top:0;padding-bottom:0}' +
            '.vr-enter-active{opacity:1;transform:translateY(0);max-height:30px}' +
            '.vr-leave{opacity:0;transform:translateY(16px);max-height:0;padding-top:0;padding-bottom:0;margin:0}' +
            '.vt{width:22px;font-size:10px;font-weight:700;text-align:center;flex-shrink:0}' +
            '.vn{flex:1;font-size:13px;font-weight:600;color:#e0e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}' +
            '.vp2{width:30px;text-align:right;font-size:11px;font-weight:700;flex-shrink:0}' +
            '.vd{display:inline-block;width:6px;height:6px;border-radius:50%;margin:1px}';
        document.head.appendChild(el);
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
        if (pct !== null && mr !== null && mr > pct) {
            bg = 'linear-gradient(to right,rgba(102,162,103,0.5) 0%,rgba(102,162,103,0.5) ' + pct + '%,rgba(234,237,137,0.5) ' + pct + '%,rgba(234,237,137,0.5) ' + mr + '%,rgba(166,69,68,0.5) ' + mr + '%,rgba(166,69,68,0.5) 100%)';
        } else if (pct !== null) {
            bg = 'linear-gradient(to right,rgba(102,162,103,0.5) 0%,rgba(102,162,103,0.5) ' + pct + '%,rgba(166,69,68,0.5) ' + pct + '%,rgba(166,69,68,0.5) 100%)';
        }
        return '<div class="vr" style="background:' + bg + '">' +
            '<span class="vt" style="color:' + col + '">' + slotDef.label + '</span>' +
            '<span class="vn" title="' + esc(c.name || '?') + ': ' + (pct !== null ? pct + '%' : '--') + (mr !== null ? ' repair:' + mr + '%' : '') + '">' + esc(c.name || '?') + '</span>' +
            '<span class="vp2" style="color:' + (pct !== null ? col : '#888') + '">' + (pct !== null ? pct + '%' : '--') + '</span>' +
            '</div>';
    }

    function render(ship) {
        if (!overlayEl) return;
        lastShipData = ship;
        var body = overlayEl.querySelector('.vb');
        if (!ship) { body.innerHTML = '<div style="color:#888;font-size:12px;">\u2014 waiting\u2014</div>'; return; }
        var sum = ship.summary || {};
        var comps = ship.components || [];
        var nameEl = overlayEl.querySelector('.vln');
        if (nameEl) nameEl.textContent = ' \u2014 ' + (sum.shipName || sum.shipType || '');
        // Setup list container on first render
        if (!body.querySelector('.vlist')) { body.innerHTML = '<div class="vlist"></div>'; }
        var list = body.querySelector('.vlist');
        // Build wanted items (if not expanded, only below 65% condition, worst first)
        var wanted = [];
        for (var i = 0; i < comps.length; i++) {
            var c = comps[i];
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
            for (var i = 0; i < comps.length; i++) {
                var c = comps[i];
                var hp = c.healthPercentage;
                var pct = hp !== null && hp !== undefined ? Math.round(hp) : null;
                if (pct !== null && pct < 85) {
                    var key = getSlot(c.name, c.blueprintType);
                    var def = SLOTS[key] || SLOTS.Core;
                    fallback.push({ comp: c, pct: pct, slotDef: def, idx: i });
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
        // Map current DOM items by ID
        var currById = {};
        list.querySelectorAll('.vr').forEach(function (el) { currById[el.getAttribute('data-id') || ''] = el; });
        // Determine wanted IDs
        var wantedIds = {};
        wanted.forEach(function (w) {
            var id = w.comp.Id !== undefined && w.comp.Id !== null ? '' + w.comp.Id : 'c_' + w.idx;
            w.id = id;
            wantedIds[id] = true;
        });
        // Find items leaving
        var leaving = [];
        Object.keys(currById).forEach(function (id) { if (!wantedIds[id]) leaving.push(currById[id]); });
        // Animate out leaving items, then rebuild the full list in sorted order
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
                positionVtg();
            }, 400);
        } else {
            positionVtg();
        }
    }

    function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    function poll() {
        if (!API_BASE || !API_AUTH) {
            statusMsg('\u2014 awaiting API \u2014');
            schedulePoll();
            return;
        }
        fetchShipConfig().then(function (data) {
            if (data !== null) { render(data); schedulePoll(); return; }
            statusMsg('\u26A0 Config failed');
            schedulePoll();
        });
    }

    function statusMsg(msg) {
        if (!overlayEl) return;
        var b = overlayEl.querySelector('.vb');
        if (b) b.innerHTML = '<div style="color:#888;font-size:12px;">' + msg + '</div>';
    }

    function isInInstance() {
        return !!document.querySelector('#ui-exit-instance');
    }
    function schedulePoll() {
        if (pollTimer) clearTimeout(pollTimer);
        if (!isVisible || !overlayEl || overlayEl.style.display === 'none') return;
        var interval = isInInstance() ? 2000 : 25000;
        pollTimer = setTimeout(poll, interval);
    }

    function start() {
        createOverlay();
        setTimeout(poll, 500);
    }

    document.addEventListener('mousemove', function (e) {
        if (!isDragging || !overlayEl) return;
        overlayEl.style.left = (e.clientX - dragOffX) + 'px';
        overlayEl.style.bottom = (window.innerHeight - (e.clientY - dragOffY) - overlayEl.offsetHeight) + 'px';
        positionVtg();
    });
    document.addEventListener('mouseup', function () { if (isDragging && overlayEl) { isDragging = false; overlayEl.style.cursor = ''; positionVtg(); var r = overlayEl.getBoundingClientRect(); localStorage.setItem(POS_KEY, JSON.stringify({ x: r.left, y: window.innerHeight - r.bottom })); } });
    document.addEventListener('keydown', function (e) { if (e.altKey && e.key === 'v') { e.preventDefault(); if (isVisible && overlayEl && overlayEl.style.display !== 'none') { isUserHidden = true; hideOverlay(); } else { isUserHidden = false; createOverlay(); } } });

    var started = false;
    function tryStart() { if (started) return; started = true; setTimeout(start, 2000); }
    if (document.readyState === 'complete' || document.readyState === 'interactive') tryStart(); else document.addEventListener('DOMContentLoaded', tryStart);
    window.addEventListener('load', tryStart);
    window.addEventListener('beforeunload', function () { if (pollTimer) clearTimeout(pollTimer); });
})();
