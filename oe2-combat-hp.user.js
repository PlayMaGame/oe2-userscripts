// ==UserScript==
// @name         OE2 Combat HP
// @namespace    https://game.dev.outerempires.net/
// @version      2.0
// @description  Live target HP panel + intel (HP, missiles, torpedoes, gear, ranks) w/ API kill mail support
// @match        https://game.dev.outerempires.net/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // =============================================
    // CONFIG
    // =============================================
    const COMBAT_CONTAINER = 'ui_chat_output_SysLogs::Combat';
    const INTEL_STORAGE_KEY = 'oe2_hp_intel';
    const MAX_TARGET_AGE = 30000;
    const MAX_REASONABLE_DMG = 500000;
    const UI_REFRESH_MS = 250;

    // Cloud Sync — set your JSONBin.io master key below (optional, leave empty to disable)
    var CLOUD_API_KEY = ''; // localStorage.getItem('_oe2_cloud_key') || '';
    const ENABLE_AUTO_SYNC = false;

    // =============================================
    // STATE
    // =============================================
    let intel = JSON.parse(localStorage.getItem(INTEL_STORAGE_KEY) || '{}');
    let activeTargets = {};
    let processedTexts = new Set();
    let currentTarget = null;
    let parsedKillMails = new Set();
    let sensorNameMap = {};
    let autoSyncEnabled = ENABLE_AUTO_SYNC;
    let _syncTimer = null;
    let _syncKillCount = 0;
    let _lastLogKill = { shipType: '', hp: 0, time: 0 };

    // Migrate old intel format to v2
    migrateIntel();

    // =============================================
    // NAME PARSER
    // =============================================
    function parseTargetName(fullTarget) {
        let id = null;
        let name = fullTarget;

        const lastParen = name.match(/\s*\(([A-Za-z0-9_.:-]*[0-9_.:-][A-Za-z0-9_.:-]*)\)\s*$/);
        if (lastParen) {
            id = lastParen[1];
            name = name.slice(0, -lastParen[0].length).trim();
        }

        let metadata = null;
        let baseClass = name;
        const metaParen = name.match(/\s*\((.+)\)\s*$/);
        if (metaParen) {
            metadata = metaParen[1];
            baseClass = name.slice(0, -metaParen[0].length).trim();
        }

        return { baseClass, metadata, id };
    }

    function parseMetadata(metadata) {
        if (!metadata) return { rank: null, nickname: null };
        const firstSpace = metadata.indexOf(' ');
        if (firstSpace === -1) return { rank: metadata, nickname: null };
        return {
            rank: metadata.slice(0, firstSpace),
            nickname: metadata.slice(firstSpace + 1).trim() || null
        };
    }

    // =============================================
    // INTEL MIGRATION (v1 -> v2)
    // =============================================
    function migrateIntel() {
        let changed = false;
        for (const [key, data] of Object.entries(intel)) {
            const parsed = parseTargetName(key);

            if (data.ranks === undefined) { data.ranks = {}; changed = true; }
            if (data.missileLaunches === undefined) { data.missileLaunches = 0; data.torpedoLaunches = 0; data.totalEngagements = data.samples || 0; changed = true; }
            if (data.gear === undefined) { data.gear = { samples: 0, avgEvo: {} }; changed = true; }
            if (data.gearTiers === undefined && data.gear && data.gear.samples > 0) { data.gearTiers = {}; changed = true; }

            if (parsed.baseClass !== key) {
                if (!intel[parsed.baseClass]) {
                    intel[parsed.baseClass] = {
                        avgHP: data.avgHP || 0, samples: data.samples || 0,
                        minHP: data.minHP || 0, maxHP: data.maxHP || 0,
                        ranks: {},
                        missileLaunches: data.missileLaunches || 0,
                        torpedoLaunches: data.torpedoLaunches || 0,
                        totalEngagements: data.totalEngagements || data.samples || 0,
                        gear: data.gear || { samples: 0, avgEvo: {} }
                    };
                }
                if (parsed.metadata) {
                    const { rank, nickname } = parseMetadata(parsed.metadata);
                    if (rank) {
                        if (!intel[parsed.baseClass].ranks) intel[parsed.baseClass].ranks = {};
                        if (!intel[parsed.baseClass].ranks[rank]) {
                            intel[parsed.baseClass].ranks[rank] = { avgHP: 0, samples: 0, minHP: Infinity, maxHP: 0, nicknames: {} };
                        }
                        const r = intel[parsed.baseClass].ranks[rank];
                        r.avgHP = data.avgHP || 0;
                        r.samples = data.samples || 0;
                        r.minHP = data.minHP || 0;
                        r.maxHP = data.maxHP || 0;
                        if (nickname) {
                            r.nicknames[nickname] = { avgHP: data.avgHP || 0, samples: data.samples || 0, minHP: data.minHP || 0, maxHP: data.maxHP || 0 };
                        }
                    }
                }
                delete intel[key];
                changed = true;
            }
        }

        // Migrate v2 variants -> v3 ranks hierarchy
        for (const data of Object.values(intel)) {
            if (data.variants && Object.keys(data.variants).length > 0) {
                data.ranks = data.ranks || {};
                for (const [vKey, vData] of Object.entries(data.variants)) {
                    const { rank, nickname } = parseMetadata(vKey);
                    if (rank) {
                        if (!data.ranks[rank]) {
                            data.ranks[rank] = { avgHP: 0, samples: 0, minHP: Infinity, maxHP: 0, nicknames: {} };
                        }
                        const r = data.ranks[rank];
                        const total = r.samples + vData.samples;
                        if (total > 0) {
                            r.avgHP = (r.avgHP * r.samples + vData.avgHP * vData.samples) / total;
                            r.samples = total;
                            r.minHP = Math.min(r.minHP === Infinity ? vData.minHP : r.minHP, vData.minHP);
                            r.maxHP = Math.max(r.maxHP, vData.maxHP);
                        }
                        if (nickname) {
                            r.nicknames[nickname] = {
                                avgHP: vData.avgHP, samples: vData.samples,
                                minHP: vData.minHP, maxHP: vData.maxHP
                            };
                        }
                    }
                }
                delete data.variants;
                changed = true;
            }
        }
        if (changed) saveIntel();
    }

    // =============================================
    // INTEL PERSISTENCE
    // =============================================
    function saveIntel() {
        localStorage.setItem(INTEL_STORAGE_KEY, JSON.stringify(intel, null, 2));
        if (CLOUD_API_KEY && autoSyncEnabled && _syncKillCount >= 50) {
            _syncKillCount = 0;
            if (_syncTimer) clearTimeout(_syncTimer);
            _syncTimer = setTimeout(() => { _syncTimer = null; syncToCloud(true); }, 2000);
        }
    }

    // =============================================
    // CLOUD SYNC (JSONBin.io)
    // =============================================
    function mergeIntelData(base, overlay) {
        const result = { ...base };
        for (const [key, data] of Object.entries(overlay)) {
            const a = result[key], b = data;
            if (!a) { result[key] = JSON.parse(JSON.stringify(b)); continue; }
            const total = a.samples + b.samples;
            result[key] = {
                avgHP: total > 0 ? (a.avgHP * a.samples + b.avgHP * b.samples) / total : 0,
                samples: total,
                minHP: Math.min(a.minHP, b.minHP),
                maxHP: Math.max(a.maxHP, b.maxHP),
                missileLaunches: (a.missileLaunches || 0) + (b.missileLaunches || 0),
                torpedoLaunches: (a.torpedoLaunches || 0) + (b.torpedoLaunches || 0),
                totalEngagements: (a.totalEngagements || 0) + (b.totalEngagements || 0),
                ranks: mergeRanks(a.ranks || {}, b.ranks || {}),
                gear: mergeGear(a.gear || { samples: 0, avgEvo: {} }, b.gear || { samples: 0, avgEvo: {} })
            };
        }
        return result;
    }
    function mergeRanks(r1, r2) {
        const result = { ...r1 };
        for (const [rk, rd] of Object.entries(r2)) {
            if (!result[rk]) { result[rk] = JSON.parse(JSON.stringify(rd)); continue; }
            const a = result[rk], b = rd;
            const total = a.samples + b.samples;
            result[rk] = {
                avgHP: total > 0 ? (a.avgHP * a.samples + b.avgHP * b.samples) / total : 0,
                samples: total,
                minHP: Math.min(a.minHP, b.minHP),
                maxHP: Math.max(a.maxHP, b.maxHP),
                nicknames: mergeNicknames(a.nicknames || {}, b.nicknames || {})
            };
        }
        return result;
    }
    function mergeNicknames(n1, n2) {
        const result = { ...n1 };
        for (const [nm, nd] of Object.entries(n2)) {
            if (!result[nm]) { result[nm] = { ...nd }; continue; }
            const a = result[nm], b = nd;
            const total = a.samples + b.samples;
            result[nm] = {
                avgHP: total > 0 ? (a.avgHP * a.samples + b.avgHP * b.samples) / total : 0,
                samples: total,
                minHP: Math.min(a.minHP, b.minHP),
                maxHP: Math.max(a.maxHP, b.maxHP)
            };
        }
        return result;
    }
    function mergeGear(g1, g2) {
        const total = g1.samples + g2.samples;
        const avgEvo = {};
        for (const key of new Set([...Object.keys(g1.avgEvo || {}), ...Object.keys(g2.avgEvo || {})])) {
            const v1 = (g1.avgEvo || {})[key] || 0;
            const v2 = (g2.avgEvo || {})[key] || 0;
            avgEvo[key] = total > 0 ? (v1 * g1.samples + v2 * g2.samples) / total : 0;
        }
        return { samples: total, avgEvo };
    }

    function getBinId() {
        return localStorage.getItem('oe2_cloud_bin_id');
    }

    async function syncToCloud(silent) {
        if (!CLOUD_API_KEY) return;
        let binId = getBinId();
        if (!binId) {
            const resp = await fetch('https://api.jsonbin.io/v3/b', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Master-Key': CLOUD_API_KEY, 'X-Bin-Name': 'OE2 HP Intel' },
                body: JSON.stringify(intel)
            });
            if (!resp.ok) return;
            const data = await resp.json();
            localStorage.setItem('oe2_cloud_bin_id', data.metadata.id);
            binId = data.metadata.id;
        }
        const local = JSON.parse(localStorage.getItem(INTEL_STORAGE_KEY) || '{}');
        await fetch(`https://api.jsonbin.io/v3/b/${binId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Master-Key': CLOUD_API_KEY },
            body: JSON.stringify(local)
        });
    }

    async function syncFromCloud() {
        if (!CLOUD_API_KEY) return;
        const binId = getBinId();
        if (!binId) return;
        const resp = await fetch(`https://api.jsonbin.io/v3/b/${binId}/latest?meta=false`, {
            headers: { 'X-Master-Key': CLOUD_API_KEY }
        });
        if (!resp.ok) return;
        const cloud = await resp.json();
        const local = JSON.parse(localStorage.getItem(INTEL_STORAGE_KEY) || '{}');
        const merged = mergeIntelData(local, cloud);
        localStorage.setItem(INTEL_STORAGE_KEY, JSON.stringify(merged, null, 2));
        intel = merged;
    }

    function ensureBaseIntel(key) {
        if (!intel[key]) {
            intel[key] = {
                avgHP: 0, samples: 0, minHP: Infinity, maxHP: 0,
                ranks: {},
                missileLaunches: 0, torpedoLaunches: 0, totalEngagements: 0,
                gear: { samples: 0, avgEvo: {} }
            };
        }
    }

    // =============================================
    // API CREDENTIAL CAPTURE + KILL MAIL INTERCEPT
    // =============================================
    var API_BASE = localStorage.getItem('_oe2_api_base') || '';
    var API_AUTH = localStorage.getItem('_oe2_api_auth') || '';
    var API_CHAR_ID = localStorage.getItem('_oe2_api_char_id') || '';

    function saveApiCreds() {
        if (API_BASE) localStorage.setItem('_oe2_api_base', API_BASE);
        if (API_AUTH) localStorage.setItem('_oe2_api_auth', API_AUTH);
        if (API_CHAR_ID) localStorage.setItem('_oe2_api_char_id', API_CHAR_ID);
    }

    function apiReady() {
        return API_BASE && API_AUTH && API_CHAR_ID;
    }

    // Intercept fetch for credentials + kill mail responses
    (function () {
        var origFetch = window.fetch;
        window.fetch = function (input, init) {
            var r = origFetch.apply(this, arguments);
            r.then(function () {
                try {
                    var url = typeof input === 'string' ? input : input ? input.url : '';
                    if (!url || url.indexOf('twitch') !== -1 || url.indexOf('_oe2_') !== -1) return;
                    if (url.indexOf('oe2') === -1 && url.indexOf('outerempires') === -1) return;
                    var headers = init ? init.headers : (input ? input.headers : {});
                    if (typeof headers === 'object' && !Array.isArray(headers)) {
                        var auth = headers.Authorization || headers.authorization || '';
                        if (auth && !API_AUTH) { API_AUTH = auth; saveApiCreds(); }
                    }
                    if (!API_BASE) {
                        var m = url.match(/^(https:\/\/[^/]+)/);
                        if (m) { API_BASE = m[1]; saveApiCreds(); }
                    }
                    var cm = url.match(/characterId=(\d+)/);
                    if (cm) { API_CHAR_ID = cm[1]; saveApiCreds(); }

                    var isKillInfoDetail = url.indexOf('/killinfo/') !== -1 && url.indexOf('/character/') !== -1 && url.indexOf('characterId=') === -1;
                    if (isKillInfoDetail) {
                        r.clone().json().then(function (body) {
                            if (body && body.success && body.data) handleKillMailResponse(body.data);
                        }).catch(function () {});
                    }
                } catch (e) {}
            });
            return r;
        };
    })();

    (function () {
        var _open = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url) {
            this._oe2Url = url;
            return _open.apply(this, arguments);
        };
        var _setH = XMLHttpRequest.prototype.setRequestHeader;
        XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
            var u = this._oe2Url || '';
            if (u.indexOf('oe2') !== -1 || u.indexOf('outerempires') !== -1) {
                if (u.indexOf('twitch') === -1 && k.toLowerCase() === 'authorization') {
                    if (!API_AUTH) { API_AUTH = v; saveApiCreds(); }
                }
                if (!API_BASE) {
                    var m = u.match(/^(https:\/\/[^/]+)/);
                    if (m) { API_BASE = m[1]; saveApiCreds(); }
                }
                var cm = u.match(/characterId=(\d+)/);
                if (cm) { API_CHAR_ID = cm[1]; saveApiCreds(); }
            }
            return _setH.apply(this, arguments);
        };
        var _send = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function (body) {
            var url = this._oe2Url || '';
            if (url.indexOf('/killinfo/') !== -1 && url.indexOf('/character/') !== -1 && url.indexOf('characterId=') === -1) {
                var xhr = this;
                xhr.addEventListener('load', function () {
                    try {
                        var data = JSON.parse(xhr.responseText);
                        if (data && data.success && data.data) handleKillMailResponse(data.data);
                    } catch (e) {}
                });
            }
            return _send.apply(this, arguments);
        };
    })();

    async function fetchKillMailDetail(killMailId) {
        if (!apiReady()) return null;
        try {
            var url = API_BASE.replace(/\/+$/, '') + '/v1/character/' + API_CHAR_ID + '/killinfo/' + killMailId;
            var resp = await fetch(url, { headers: { 'Authorization': API_AUTH } });
            if (!resp.ok) return null;
            var body = await resp.json();
            return body && body.success ? body.data : null;
        } catch (e) { return null; }
    }

    async function fetchKillMailList(pageSize) {
        if (!apiReady()) return null;
        if (pageSize === undefined) pageSize = 3;
        try {
            var base = API_BASE.replace(/\/+$/, '');
            var url = base + '/v1/character/' + API_CHAR_ID + '/killinfo?pvp=false&pageSize=' + pageSize;
            var resp = await fetch(url, { headers: { 'Authorization': API_AUTH } });
            if (!resp.ok) return null;
            var body = await resp.json();
            return body;
        } catch (e) { return null; }
    }

    function getGearTierFromEvo(avgEvo) {
        if (avgEvo >= 2.5) return 3;
        if (avgEvo >= 1.5) return 2;
        if (avgEvo >= 0.5) return 1;
        return 0;
    }
    function ensureGearTierBucket(rankObj, tierKey) {
        if (!rankObj.gearTiers) rankObj.gearTiers = {};
        if (!rankObj.gearTiers[tierKey]) rankObj.gearTiers[tierKey] = { avgHP: 0, samples: 0, minHP: Infinity, maxHP: 0 };
    }
    function updateGearTierBucket(rankObj, tierKey, exactHP) {
        ensureGearTierBucket(rankObj, tierKey);
        var t = rankObj.gearTiers[tierKey];
        if (t.samples === 0) { t.avgHP = exactHP; t.minHP = exactHP; t.maxHP = exactHP; }
        else { t.avgHP = t.avgHP * 0.85 + exactHP * 0.15; t.minHP = Math.min(t.minHP, exactHP); t.maxHP = Math.max(t.maxHP, exactHP); }
        t.samples++;
    }
    function updateIntelFromHP(shipType, exactHP, metadataString, gearAvgEvo) {
        if (!shipType || exactHP <= 0 || exactHP > MAX_REASONABLE_DMG) return;
        ensureBaseIntel(shipType);
        var d = intel[shipType];
        if (d.samples === 0) {
            d.avgHP = exactHP; d.minHP = exactHP; d.maxHP = exactHP;
        } else {
            d.avgHP = d.avgHP * 0.85 + exactHP * 0.15;
            d.minHP = Math.min(d.minHP, exactHP);
            d.maxHP = Math.max(d.maxHP, exactHP);
        }
        d.samples++;
        d.totalEngagements++;

        var rank = null, nickname = null;
        if (metadataString) {
            var pm = parseMetadata(metadataString);
            rank = pm.rank;
            nickname = pm.nickname;
        }

        if (rank) {
            if (!d.ranks) d.ranks = {};
            if (!d.ranks[rank]) d.ranks[rank] = { avgHP: 0, samples: 0, minHP: Infinity, maxHP: 0, nicknames: {}, gearTiers: {} };
            var r = d.ranks[rank];
            if (r.samples === 0) { r.avgHP = exactHP; r.minHP = exactHP; r.maxHP = exactHP; }
            else { r.avgHP = r.avgHP * 0.85 + exactHP * 0.15; r.minHP = Math.min(r.minHP, exactHP); r.maxHP = Math.max(r.maxHP, exactHP); }
            r.samples++;
            if (gearAvgEvo !== undefined) {
                updateGearTierBucket(r, String(getGearTierFromEvo(gearAvgEvo)), exactHP);
            }
            if (nickname) {
                if (!r.nicknames[nickname]) r.nicknames[nickname] = { avgHP: 0, samples: 0, minHP: Infinity, maxHP: 0 };
                var n = r.nicknames[nickname];
                if (n.samples === 0) { n.avgHP = exactHP; n.minHP = exactHP; n.maxHP = exactHP; }
                else { n.avgHP = n.avgHP * 0.85 + exactHP * 0.15; n.minHP = Math.min(n.minHP, exactHP); n.maxHP = Math.max(n.maxHP, exactHP); }
                n.samples++;
            }
        } else if (gearAvgEvo !== undefined) {
            // No rank metadata — still create a default gear tier bucket on the ship itself
            if (!d.gearTiers) d.gearTiers = {};
            var tierKey = String(getGearTierFromEvo(gearAvgEvo));
            if (!d.gearTiers[tierKey]) d.gearTiers[tierKey] = { avgHP: 0, samples: 0, minHP: Infinity, maxHP: 0 };
            var t = d.gearTiers[tierKey];
            if (t.samples === 0) { t.avgHP = exactHP; t.minHP = exactHP; t.maxHP = exactHP; }
            else { t.avgHP = t.avgHP * 0.85 + exactHP * 0.15; t.minHP = Math.min(t.minHP, exactHP); t.maxHP = Math.max(t.maxHP, exactHP); }
            t.samples++;
        }
    }

    function getPartSection(part) {
        var icon = part.icon || '';
        if (icon.indexOf('w_') === 0 || part.isWeapon) return 'Weapons';
        if (icon.indexOf('e_') === 0) return 'Engines';
        if (icon.indexOf('s_') === 0) return 'Shields';
        if (icon.indexOf('c_') === 0) return 'Core';
        if (icon.indexOf('a_') === 0) return 'Ammo';
        return part.partTypeName || 'Other';
    }
    function updateGearFromParts(shipType, parts) {
        if (!shipType || !parts || parts.length === 0) return 0;
        ensureBaseIntel(shipType);
        var gear = intel[shipType].gear;
        if (!gear) gear = intel[shipType].gear = { samples: 0, avgEvo: {} };
        var evoBySection = {};
        for (var pi = 0; pi < parts.length; pi++) {
            var part = parts[pi];
            var evo = part.evolution || 0;
            var section = getPartSection(part);
            if (!evoBySection[section]) evoBySection[section] = [];
            evoBySection[section].push(evo);
        }
        gear.samples++;
        var overallSum = 0, overallCount = 0;
        for (var section in evoBySection) {
            var evos = evoBySection[section];
            var avgEvo = evos.reduce(function (a, b) { return a + b; }, 0) / evos.length;
            for (var ei = 0; ei < evos.length; ei++) { overallSum += evos[ei]; overallCount++; }
            if (gear.avgEvo[section] === undefined) gear.avgEvo[section] = avgEvo;
            else {
                var prev = gear.samples - 1;
                gear.avgEvo[section] = (gear.avgEvo[section] * prev + avgEvo) / gear.samples;
            }
        }
        return overallCount > 0 ? overallSum / overallCount : 0;
    }

    function handleKillMailResponse(record) {
        var victim = record.victim;
        if (!victim || !victim.characterName) return;
        if (/Hulk/i.test(victim.characterName)) return;

        var parsed = parseTargetName(victim.characterName);
        var shipType = victim.shipTypeName || parsed.baseClass;
        if (!shipType || shipType === victim.characterName) shipType = parsed.baseClass;
        if (!shipType) return;

        var totalHP = 0;
        if (record.attackers && record.attackers.length > 0) {
            for (var ai = 0; ai < record.attackers.length; ai++) {
                totalHP += record.attackers[ai].totalDamage || 0;
            }
        }
        if (totalHP <= 0) return;

        var gearAvgEvo = updateGearFromParts(shipType, victim.parts);
        var logRecent = (Date.now() - _lastLogKill.time) < 30000 && _lastLogKill.shipType === shipType && Math.abs(_lastLogKill.hp - totalHP) / totalHP < 0.15;
        if (!logRecent) {
            updateIntelFromHP(shipType, totalHP, parsed.metadata, gearAvgEvo);
        }
        saveIntel();
        _syncKillCount++;
    }

    // After a combat log kill, try to fetch the kill mail from API
    var _pendingKillTarget = null;
    var _lastProcessedKillId = 0;
    function onKillDetected(targetName) {
        if (!apiReady()) return;
        setTimeout(function () {
            fetchKillMailList(5).then(function (listBody) {
                if (!listBody || !listBody.success || !listBody.data) return;
                var data = listBody.data;
                var items = data.killMails || data.items || [];
                if (!items.length) return;
                var parsed = parseTargetName(targetName);
                for (var ii = 0; ii < items.length; ii++) {
                    var item = items[ii];
                    if (item.isDeath) continue;
                    if (item.killMailId <= _lastProcessedKillId) continue;
                    if (item.victimShipTypeName && item.victimShipTypeName === parsed.baseClass) {
                        if (item.killMailId) {
                            _lastProcessedKillId = item.killMailId;
                            fetchKillMailDetail(item.killMailId).then(function (detail) {
                                if (detail) handleKillMailResponse(detail);
                            });
                        }
                        break;
                    }
                }
            }).catch(function () {});
        }, 4000);
    }

    // =============================================
    // PARSER (combat log)
    // =============================================
    function parseMessage(text) {
        const launchMatch = text.match(/^(Missile|Torpedo)\s+launch\s+detected\s+from\s+(.+?)(?:\.\s*)?$/i);
        if (launchMatch) {
            return {
                type: launchMatch[1].toLowerCase() === 'torpedo' ? 'torpedo' : 'missile',
                target: launchMatch[2].trim()
            };
        }

        if (text.includes('You deal')) {
            const m = text.match(/You deal (\d+) points of (\w+) damage to (.+)\./);
            if (m) return { type: 'outgoing', target: m[3].trim(), amount: Number(m[1]), damageType: m[2] };
        }

        if (text.includes('damage to you')) {
            const m = text.match(/(.+) deals (\d+) points of (\w+) damage to you/);
            if (m) return { type: 'incoming', source: m[1].trim(), amount: Number(m[2]), damageType: m[3] };
        }

        if (text.includes('Your shields absorb')) {
            const m = text.match(/Your shields absorb (\d+) points of (\w+) damage/);
            if (m) return { type: 'shield', amount: Number(m[1]), damageType: m[2] };
        }

        const killPatterns = [
            /You destroy (.+?)\.?$/i,
            /You destroyed (.+?)\.?$/i,
            /You have destroyed (.+?)\.?$/i,
            /(.+?) has been destroyed\.?$/i,
            /Target (.+?) eliminated\.?$/i,
            /(.+?) eliminated\.?$/i
        ];
        for (const p of killPatterns) {
            const m = text.match(p);
            if (m) return { type: 'kill', target: m[1].trim(), raw: text };
        }

        return null;
    }

    // =============================================
    // LOG PROCESSING -> INTEL ENGINE
    // =============================================
    function getTarget(name) {
        if (!activeTargets[name]) {
            const parsed = parseTargetName(name);
            let baseClass = parsed.baseClass;
            let metadata = parsed.metadata;
            const id = parsed.id;

            if (id && sensorNameMap[id]) {
                const enriched = parseTargetName(sensorNameMap[id]);
                if (enriched.baseClass) baseClass = enriched.baseClass;
                if (enriched.metadata) metadata = enriched.metadata;
            }

            // If no ID on the name, find an existing sensor-tracked target with same baseClass
            if (!id) {
                for (const [k, v] of Object.entries(activeTargets)) {
                    if (v.baseClass === baseClass && v.id) {
                        activeTargets[name] = v;
                        return v;
                    }
                }
            }

            activeTargets[name] = {
                damageTaken: 0,
                lastSeen: Date.now(),
                baseClass,
                metadata,
                id,
                missileLaunches: 0,
                torpedoLaunches: 0,
            };
        }
        return activeTargets[name];
    }

    function isHulk(text) {
        return /Hulk/i.test(text);
    }

    function processLog(entry) {
        entry.timestamp = Date.now();

        if (entry.type === 'outgoing') {
            if (isHulk(entry.target)) return;
            const t = getTarget(entry.target);
            t.damageTaken += entry.amount || 0;
            t.lastSeen = entry.timestamp;
            currentTarget = entry.target;
        }

        if (entry.type === 'incoming') {
            if (isHulk(entry.source)) return;
            const t = getTarget(entry.source);
            t.lastSeen = entry.timestamp;
            currentTarget = entry.source;
        }

        if (entry.type === 'missile' || entry.type === 'torpedo') {
            if (isHulk(entry.target)) return;
            const t = getTarget(entry.target);
            if (entry.type === 'missile') t.missileLaunches++;
            else t.torpedoLaunches++;
            t.lastSeen = entry.timestamp;
        }

        if (entry.type === 'kill') {
            if (isHulk(entry.target)) { delete activeTargets[entry.target]; if (currentTarget === entry.target) currentTarget = null; return; }
            const target = activeTargets[entry.target];
            // Always record HP from combat log as baseline
            // API data (when available) supersedes via dedup in handleKillMailResponse
            if (target && target.damageTaken > 0 && target.damageTaken <= MAX_REASONABLE_DMG) {
                const key = target.baseClass;
                ensureBaseIntel(key);
                const d = intel[key];

                if (d.samples === 0) {
                    d.avgHP = target.damageTaken;
                    d.minHP = target.damageTaken;
                    d.maxHP = target.damageTaken;
                } else {
                    d.avgHP = d.avgHP * 0.85 + target.damageTaken * 0.15;
                    d.minHP = Math.min(d.minHP, target.damageTaken);
                    d.maxHP = Math.max(d.maxHP, target.damageTaken);
                }
                d.samples++;

                if (target.metadata) {
                    const { rank, nickname } = parseMetadata(target.metadata);
                    if (rank) {
                        if (!d.ranks) d.ranks = {};
                        if (!d.ranks[rank]) {
                            d.ranks[rank] = { avgHP: 0, samples: 0, minHP: Infinity, maxHP: 0, nicknames: {}, gearTiers: {} };
                        }
                        const r = d.ranks[rank];
                        if (r.samples === 0) {
                            r.avgHP = target.damageTaken;
                            r.minHP = target.damageTaken;
                            r.maxHP = target.damageTaken;
                        } else {
                            r.avgHP = r.avgHP * 0.85 + target.damageTaken * 0.15;
                            r.minHP = Math.min(r.minHP, target.damageTaken);
                            r.maxHP = Math.max(r.maxHP, target.damageTaken);
                        }
                        r.samples++;

                        if (nickname) {
                            if (!r.nicknames[nickname]) {
                                r.nicknames[nickname] = { avgHP: 0, samples: 0, minHP: Infinity, maxHP: 0 };
                            }
                            const n = r.nicknames[nickname];
                            if (n.samples === 0) {
                                n.avgHP = target.damageTaken;
                                n.minHP = target.damageTaken;
                                n.maxHP = target.damageTaken;
                            } else {
                                n.avgHP = n.avgHP * 0.85 + target.damageTaken * 0.15;
                                n.minHP = Math.min(n.minHP, target.damageTaken);
                                n.maxHP = Math.max(n.maxHP, target.damageTaken);
                            }
                            n.samples++;
                        }
                    }
                }
                _lastLogKill = { shipType: key, hp: target.damageTaken, time: Date.now() };

                d.missileLaunches += target.missileLaunches;
                d.torpedoLaunches += target.torpedoLaunches;
                d.totalEngagements++;

                saveIntel();
                _syncKillCount++;
                onKillDetected(entry.target);
            }
            delete activeTargets[entry.target];
            if (currentTarget === entry.target) currentTarget = null;
        }
    }

    // =============================================
    // DOM OBSERVER (Combat Log)
    // =============================================
    function processNode(node) {
        const text = node.innerText.trim();
        if (!text || processedTexts.has(text)) return;
        processedTexts.add(text);

        const parsed = parseMessage(text);
        if (parsed) processLog(parsed);
    }

    function observeCombatLog(container) {
        container.querySelectorAll('.ui_chat_log_message').forEach(processNode);

        const obs = new MutationObserver(muts => {
            for (const m of muts) {
                for (const node of m.addedNodes) {
                    if (node.nodeType === 1 && node.classList.contains('ui_chat_log_message')) {
                        processNode(node);
                    }
                }
            }
        });
        obs.observe(container, { childList: true, subtree: true });
    }

    // =============================================
    // KILL MAIL PARSER
    // =============================================
    function parseKillMail(victimEl) {
        if (parsedKillMails.has(victimEl)) return;
        parsedKillMails.add(victimEl);

        const nameEl = victimEl.querySelector('.KillMail_Record_CharName');
        if (!nameEl) return;
        const parsed = parseTargetName(nameEl.textContent.trim());
        const key = parsed.baseClass;
        if (!key) return;

        ensureBaseIntel(key);
        const gear = intel[key].gear;

        const sections = victimEl.querySelectorAll('.KillMail_Parts_SectionHeader');
        const evoLevels = {};

        for (const section of sections) {
            const sectionName = section.textContent.trim();
            const partsContainer = section.nextElementSibling;
            if (!partsContainer || !partsContainer.classList.contains('KillMail_Record_Parts')) continue;

            const partEls = partsContainer.querySelectorAll('.KillMail_Part');
            for (const partEl of partEls) {
                var evo = 0;
                var nameEl2 = partEl.querySelector('.KillMail_Part_Name');
                var evoText = partEl.textContent;
                if (nameEl2) {
                    evoText = nameEl2.textContent;
                    var rawText = partEl.textContent;
                    var idx = rawText.indexOf(evoText);
                    if (idx > 0) {
                        var before = rawText.substring(0, idx).trim();
                        var m2 = before.match(/([\d.]+)/);
                        if (m2) evo = parseFloat(m2[1]);
                    }
                } else {
                    var m3 = evoText.match(/(\d+)\s*\/\s*\d+|Evo\s*([\d.]+)|([\d.]+)\s*\+\s*$/i);
                    if (m3) evo = parseFloat(m3[1] || m3[2] || m3[3]) || 0;
                }
                if (!evoLevels[sectionName]) evoLevels[sectionName] = [];
                evoLevels[sectionName].push(evo);
            }
        }

        gear.samples++;
        for (const [section, evos] of Object.entries(evoLevels)) {
            const avgEvo = evos.reduce((a, b) => a + b, 0) / evos.length;
            if (gear.avgEvo[section] === undefined) {
                gear.avgEvo[section] = avgEvo;
            } else {
                const prev = gear.samples - 1;
                gear.avgEvo[section] = (gear.avgEvo[section] * prev + avgEvo) / gear.samples;
            }
        }

        saveIntel();
    }

    function observeKillMails() {
        const obs = new MutationObserver(muts => {
            for (const m of muts) {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    const victim = node.querySelector ? node.querySelector('.KillMail_Record_Victim') : null;
                    if (victim) parseKillMail(victim);
                    if (node.classList && node.classList.contains('KillMail_Record_Victim')) {
                        parseKillMail(node);
                    }
                }
            }
        });
        obs.observe(document.body, { childList: true, subtree: true });
    }

    // =============================================
    // CLEANUP STALE TARGETS
    // =============================================
    function cleanupTargets() {
        const now = Date.now();
        for (const [name, t] of Object.entries(activeTargets)) {
            if (now - t.lastSeen > MAX_TARGET_AGE) {
                delete activeTargets[name];
                if (currentTarget === name) currentTarget = null;
            }
        }
    }

    // =============================================
    // STYLE - OE2 match
    // =============================================
    function injectStyles() {
        const el = document.createElement('style');
        el.textContent = `
            @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;600;700&display=swap');
            .oe2-sensor-hp { font-family: 'Rajdhani', 'Segoe UI', sans-serif !important; letter-spacing: 0.3px; }
        `;
        document.head.appendChild(el);
    }

    // =============================================
    // UI - HP Bars in Sensor Contacts
    // =============================================
    function findActiveTarget(name, id) {
        if (id) {
            const cleanId = id.trim().replace(/^#/, '');
            for (const t of Object.values(activeTargets)) {
                if (t.id) {
                    const tClean = t.id.trim().replace(/^#/, '');
                    if (tClean === cleanId) return t;
                }
            }
        }
        if (name) {
            for (const [key, t] of Object.entries(activeTargets)) {
                if (key === name || key.startsWith(name) || name.startsWith(key) || key.includes(name) || name.includes(key)) return t;
            }
        }
        return null;
    }

    function hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }

    function updateSensorHP() {
        const container = document.getElementById('SystemExplorer_SensorContacts_Expanded');
        if (!container) return;

        for (const item of container.querySelectorAll('.SystemExplorer_Item')) {
            const nameEl = item.querySelector('.SystemExplorer_ObjectName');
            const descEl = item.querySelector('.SystemExplorer_Description') || item.querySelector('.SystemExplorer_Description_With_Icons');
            if (!nameEl || !descEl) continue;

            const name = nameEl.textContent.trim();
            const id = descEl.textContent.trim();
            if (/Hulk/i.test(name) || /Hulk/i.test(id)) {
                item.querySelector('.oe2-sensor-hp')?.remove();
                item.style.background = '';
                continue;
            }
            const target = findActiveTarget(name, id);
            const parsed = parseTargetName(name);
            const hpInfo = lookupHP(parsed.baseClass, parsed.metadata);
            const hasIntel = hpInfo && hpInfo.samples > 0;
            const showHP = target || hasIntel;

            let hpEl = item.querySelector('.oe2-sensor-hp');
            if (!showHP) {
                if (hpEl) hpEl.remove();
                item.style.background = '';
                continue;
            }

            let estimatedHP, damageTaken;
            if (target) {
                estimatedHP = (hpInfo && hpInfo.avgHP > 0) ? hpInfo.avgHP : (target.damageTaken || 1);
                damageTaken = target.damageTaken || 0;
            } else {
                estimatedHP = hpInfo.avgHP;
                damageTaken = 0;
            }

            const remaining = Math.max(0, estimatedHP - damageTaken);
            const pct = Math.max(0, Math.min(100, (remaining / estimatedHP) * 100));

            if (!hpEl) {
                hpEl = document.createElement('div');
                hpEl.className = 'oe2-sensor-hp';
                hpEl.style.cssText = 'padding:0 6px;font-size:10px;color:#7a9aba;font-weight:600;white-space:nowrap;';
                const actions = item.querySelector('.SystemExplorer_Actions');
                if (actions) item.insertBefore(hpEl, actions);
                else item.appendChild(hpEl);
            }

            try {
                const barColor = pct > 50 ? '#4dd0e1' : (pct > 25 ? '#ffb300' : '#ef5350');
                const bg = hexToRgba(barColor, 0.13);
                item.style.background = `linear-gradient(to right, ${bg} 0%, ${bg} ${pct.toFixed(0)}%, transparent ${pct.toFixed(0)}%, transparent 100%)`;
                hpEl.textContent = `${Math.round(remaining).toLocaleString()} / ${Math.round(estimatedHP).toLocaleString()}`;
            } catch (e) {}
        }
    }

    // =============================================
    // UI - Cloud Sync Panel (appears with Settings)
    // =============================================
    let cloudPanel = null;

    function createCloudPanel() {
        if (cloudPanel) return;
        cloudPanel = document.createElement('div');
        cloudPanel.id = 'oe2-cloud-panel';
        cloudPanel.style.cssText = 'position:fixed;z-index:999999;background:rgba(8,14,24,.95);border:1px solid #1a3a5c;border-radius:4px;padding:10px 12px;display:none;pointer-events:auto;';

        const title = document.createElement('div');
        title.textContent = 'OE2 HP Intel';
        title.style.cssText = 'font-size:11px;font-weight:700;color:#7ecfff;margin-bottom:6px;letter-spacing:.5px;';
        cloudPanel.appendChild(title);

        const btnStyle = 'display:block;width:100%;margin-top:4px;background:rgba(30,60,90,.5);border:1px solid #3a6ea8;color:#7ecfff;font-family:Rajdhani,sans-serif;font-size:11px;font-weight:600;padding:4px 10px;cursor:pointer;border-radius:3px;text-align:left;';

        const uploadBtn = document.createElement('button');
        uploadBtn.textContent = '☁ Upload Intel';
        uploadBtn.style.cssText = btnStyle;
        uploadBtn.addEventListener('click', () => syncToCloud(false));
        cloudPanel.appendChild(uploadBtn);

        const dloadBtn = document.createElement('button');
        dloadBtn.textContent = '☁ Download Intel';
        dloadBtn.style.cssText = btnStyle;
        dloadBtn.addEventListener('click', syncFromCloud);
        cloudPanel.appendChild(dloadBtn);

        const autoBtn = document.createElement('button');
        autoBtn.textContent = autoSyncEnabled ? '☁ Auto-Sync: ON' : '☁ Auto-Sync: OFF';
        autoBtn.style.cssText = btnStyle;
        autoBtn.addEventListener('click', () => {
            autoSyncEnabled = !autoSyncEnabled;
            autoBtn.textContent = autoSyncEnabled ? '☁ Auto-Sync: ON' : '☁ Auto-Sync: OFF';
            if (autoSyncEnabled) syncToCloud(true);
        });
        cloudPanel.appendChild(autoBtn);

        const resetBtn = document.createElement('button');
        resetBtn.textContent = '✕ Reset Intel';
        resetBtn.style.cssText = btnStyle + 'color:#ef9a9a;border-color:#5c1a1a;';
        resetBtn.addEventListener('click', () => {
            localStorage.removeItem(INTEL_STORAGE_KEY);
            localStorage.removeItem('oe2_cloud_bin_id');
            intel = {};
            activeTargets = {};
            currentTarget = null;
            parsedKillMails = new Set();
        });
        cloudPanel.appendChild(resetBtn);

        document.body.appendChild(cloudPanel);
    }

    function positionCloudPanel() {
        const modal = document.querySelector('.modal.dynamic .modal-heading');
        const isVisible = modal && modal.offsetParent !== null && modal.textContent.includes('SETTINGS');
        if (!isVisible) {
            if (cloudPanel) cloudPanel.style.display = 'none';
            return;
        }
        createCloudPanel();
        const settingsModal = modal.closest('.modal.dynamic');
        const rect = settingsModal.getBoundingClientRect();
        cloudPanel.style.display = 'block';
        cloudPanel.style.left = (rect.left - cloudPanel.offsetWidth - 8) + 'px';
        cloudPanel.style.top = (rect.top + 20) + 'px';
        if (parseInt(cloudPanel.style.left) < 4) {
            cloudPanel.style.left = (rect.right + 8) + 'px';
            cloudPanel.style.top = (rect.top + 20) + 'px';
        }
    }

    function watchCloudPanel() {
        createCloudPanel();
        setInterval(positionCloudPanel, 100);
    }

    function getGearTier(avgEvo) {
        if (avgEvo >= 2.5) return 'Milspec';
        if (avgEvo >= 1.5) return 'Enhanced';
        if (avgEvo >= 0.5) return 'Upgraded';
        return 'Standard';
    }

    function lookupHP(baseClass, metadata) {
        const data = intel[baseClass];
        if (!data) return null;

        if (metadata) {
            const { rank, nickname } = parseMetadata(metadata);
            if (nickname && data.ranks && data.ranks[rank] && data.ranks[rank].nicknames[nickname]) {
                const n = data.ranks[rank].nicknames[nickname];
                return { avgHP: n.avgHP, samples: n.samples, minHP: n.minHP, maxHP: n.maxHP, source: `${baseClass} > ${rank} > ${nickname}` };
            }
            if (rank && data.ranks && data.ranks[rank]) {
                const r = data.ranks[rank];
                var result = { avgHP: r.avgHP, samples: r.samples, minHP: r.minHP, maxHP: r.maxHP, source: `${baseClass} > ${rank}`, gearTiers: r.gearTiers || null };
                return result;
            }
        }

        return { avgHP: data.avgHP, samples: data.samples, minHP: data.minHP, maxHP: data.maxHP, source: baseClass, gearTiers: data.gearTiers || null };
    }

    // =============================================
    // SENSOR CONTACTS OBSERVER
    // =============================================
    function observeSensorContacts() {
        const container = document.getElementById('SystemExplorer_SensorContacts_Expanded');
        if (!container) { setTimeout(observeSensorContacts, 2000); return; }

        function updateMap() {
            const newMap = {};
            for (const item of container.querySelectorAll('.SystemExplorer_Item')) {
                const nameEl = item.querySelector('.SystemExplorer_ObjectName');
                const descEl = item.querySelector('.SystemExplorer_Description');
                if (!nameEl || !descEl) continue;
                const objectName = nameEl.textContent.trim();
                const id = descEl.textContent.trim();
                if (id && objectName) {
                    newMap[id] = objectName;
                    for (const t of Object.values(activeTargets)) {
                        if (t.id === id) {
                            const enriched = parseTargetName(objectName);
                            if (enriched.baseClass) t.baseClass = enriched.baseClass;
                            if (enriched.metadata) t.metadata = enriched.metadata;
                        }
                    }
                }
            }
            sensorNameMap = newMap;
        }

        updateMap();
        new MutationObserver(updateMap).observe(container, { childList: true, subtree: true });
    }

    // =============================================
    // START
    // =============================================
    function start() {
        // Purge any stale Hulk entries from activeTargets
        for (const key of Object.keys(activeTargets)) {
            if (/Hulk/i.test(key)) {
                delete activeTargets[key];
            }
        }

        const container = document.getElementById(COMBAT_CONTAINER);
        if (!container) {
            setTimeout(start, 2000);
            return;
        }

        console.log('[OE2 HP] Script loaded' + (apiReady() ? ' + API' : ''));
        injectStyles();
        watchCloudPanel();
        observeCombatLog(container);
        observeKillMails();
        observeSensorContacts();
        setInterval(updateSensorHP, UI_REFRESH_MS);
    }

    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
})();
