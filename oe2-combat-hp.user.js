// ==UserScript==
// @name         OE2 Combat HP
// @namespace    https://game.dev.outerempires.net/
// @version      1.2
// @description  Live target HP panel + intel (HP, missiles, torpedoes, gear, ranks)
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

    // =============================================
    // STATE
    // =============================================
    let intel = JSON.parse(localStorage.getItem(INTEL_STORAGE_KEY) || '{}');
    let activeTargets = {};
    let processedTexts = new Set();
    let currentTarget = null;
    let parsedKillMails = new Set();
    let sensorNameMap = {};

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

    function processLog(entry) {
        entry.timestamp = Date.now();

        if (entry.type === 'outgoing') {
            const t = getTarget(entry.target);
            t.damageTaken += entry.amount || 0;
            t.lastSeen = entry.timestamp;
            currentTarget = entry.target;
        }

        if (entry.type === 'incoming') {
            const t = getTarget(entry.source);
            t.lastSeen = entry.timestamp;
            currentTarget = entry.source;
        }

        if (entry.type === 'missile' || entry.type === 'torpedo') {
            const t = getTarget(entry.target);
            if (entry.type === 'missile') t.missileLaunches++;
            else t.torpedoLaunches++;
            t.lastSeen = entry.timestamp;
        }

        if (entry.type === 'kill') {
            const target = activeTargets[entry.target];
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

                d.missileLaunches += target.missileLaunches;
                d.torpedoLaunches += target.torpedoLaunches;
                d.totalEngagements++;

                if (target.metadata) {
                    const { rank, nickname } = parseMetadata(target.metadata);
                    if (rank) {
                        if (!d.ranks) d.ranks = {};
                        if (!d.ranks[rank]) {
                            d.ranks[rank] = { avgHP: 0, samples: 0, minHP: Infinity, maxHP: 0, nicknames: {} };
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

                saveIntel();
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
                const evoEl = partEl.querySelector('.EvolutionNumber');
                const evo = evoEl ? parseInt(evoEl.textContent) : 0;
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

            #oe2-hp-panel {
                font-family: 'Rajdhani', 'Segoe UI', sans-serif !important;
                letter-spacing: 0.3px;
            }
            #oe2-hp-panel .oe2-btn {
                background: rgba(30, 60, 90, 0.5);
                border: 1px solid #3a6ea8;
                color: #7ecfff;
                font-family: 'Rajdhani', sans-serif;
                font-size: 11px;
                font-weight: 600;
                letter-spacing: 0.5px;
                padding: 4px 10px;
                cursor: pointer;
                border-radius: 3px;
                transition: background 0.15s;
            }
            #oe2-hp-panel .oe2-btn:hover {
                background: rgba(30, 60, 90, 0.8);
            }
        `;
        document.head.appendChild(el);
    }

    // =============================================
    // UI - HP Panel
    // =============================================
    let panel = null;
    let hpBarFill = null;
    let hpText = null;
    let targetNameEl = null;
    let shipClassEl = null;
    let confidenceEl = null;
    let intelExtraEl = null;

    function createPanel() {
        panel = document.createElement('div');
        panel.id = 'oe2-hp-panel';
        Object.assign(panel.style, {
            position: 'fixed', bottom: '350px', right: '100px',
            zIndex: '999999', background: 'rgba(8, 14, 24, 0.95)',
            color: '#b0d0e8', padding: '12px 14px',
            fontSize: '13px', border: '1px solid #1a3a5c',
            borderRadius: '4px', width: '260px', display: 'none',
            pointerEvents: 'auto', userSelect: 'none',
            boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
        });

        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'baseline';
        header.style.marginBottom = '8px';

        targetNameEl = document.createElement('div');
        targetNameEl.style.fontSize = '15px';
        targetNameEl.style.fontWeight = '700';
        targetNameEl.style.color = '#d0e8ff';
        header.appendChild(targetNameEl);

        shipClassEl = document.createElement('div');
        shipClassEl.style.fontSize = '11px';
        shipClassEl.style.color = '#5a7a9a';
        shipClassEl.style.fontWeight = '600';
        header.appendChild(shipClassEl);

        panel.appendChild(header);

        hpBarFill = document.createElement('div');
        const barOuter = document.createElement('div');
        Object.assign(barOuter.style, {
            width: '100%', height: '16px', background: '#0a1420',
            border: '1px solid #1a3a5c', borderRadius: '2px',
            overflow: 'hidden', position: 'relative',
        });
        Object.assign(hpBarFill.style, {
            width: '0%', height: '100%',
            background: 'linear-gradient(90deg, #26c6da, #4dd0e1)',
            transition: 'width 0.2s ease',
            borderRadius: '1px',
        });
        barOuter.appendChild(hpBarFill);
        panel.appendChild(barOuter);

        hpText = document.createElement('div');
        hpText.style.fontSize = '20px';
        hpText.style.fontWeight = '700';
        hpText.style.marginTop = '6px';
        hpText.style.color = '#d0e8ff';
        panel.appendChild(hpText);

        const div = document.createElement('div');
        div.style.borderTop = '1px solid #0f1e30';
        div.style.margin = '8px 0 6px';
        panel.appendChild(div);

        confidenceEl = document.createElement('div');
        confidenceEl.style.fontSize = '11px';
        confidenceEl.style.color = '#4a6a8a';
        confidenceEl.style.fontWeight = '500';
        panel.appendChild(confidenceEl);

        intelExtraEl = document.createElement('div');
        intelExtraEl.style.fontSize = '11px';
        intelExtraEl.style.color = '#4a6a8a';
        intelExtraEl.style.fontWeight = '500';
        intelExtraEl.style.marginTop = '2px';
        panel.appendChild(intelExtraEl);

        const resetBtn = document.createElement('button');
        resetBtn.className = 'oe2-btn';
        resetBtn.textContent = 'Reset Intel';
        resetBtn.style.marginTop = '8px';
        resetBtn.addEventListener('click', () => {
            localStorage.removeItem(INTEL_STORAGE_KEY);
            intel = {};
            activeTargets = {};
            currentTarget = null;
            parsedKillMails = new Set();
            panel.style.display = 'none';
        });
        panel.appendChild(resetBtn);

        document.body.appendChild(panel);
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
                return { avgHP: r.avgHP, samples: r.samples, minHP: r.minHP, maxHP: r.maxHP, source: `${baseClass} > ${rank}` };
            }
        }

        return { avgHP: data.avgHP, samples: data.samples, minHP: data.minHP, maxHP: data.maxHP, source: baseClass };
    }

    function updatePanel() {
        if (!panel) createPanel();
        cleanupTargets();

        if (!currentTarget || !activeTargets[currentTarget]) {
            panel.style.display = 'none';
            return;
        }

        const t = activeTargets[currentTarget];
        const key = t.baseClass;
        const data = intel[key];
        const hasIntel = data && data.samples > 0;

        panel.style.display = 'block';
        targetNameEl.textContent = key;

        const metaParts = [];
        if (t.metadata) metaParts.push(t.metadata);
        if (t.id) metaParts.push('#' + t.id);
        shipClassEl.textContent = metaParts.join(' | ');

        if (!hasIntel) {
            hpText.textContent = `${Math.round(t.damageTaken).toLocaleString()} DMG dealt`;
            hpText.style.color = '#d0e8ff';
            hpBarFill.style.width = '0%';
            confidenceEl.textContent = 'Learning this ship type. Kill one to estimate HP.';
            intelExtraEl.textContent = '';
            return;
        }

        const hpInfo = lookupHP(key, t.metadata);
        const estimatedHP = Math.max(hpInfo.avgHP, t.damageTaken);
        const remaining = Math.max(0, estimatedHP - t.damageTaken);
        const pct = Math.max(0, Math.min(100, (remaining / estimatedHP) * 100));
        const confidence = Math.min(100, hpInfo.samples * 10);

        const tolerance = hpInfo.avgHP * 0.1;
        const sampleWord = hpInfo.samples === 1 ? 'kill' : 'kills';
        let confText = `${hpInfo.source} | ${hpInfo.samples} ${sampleWord} | ${confidence.toFixed(0)}% | ${Math.round(hpInfo.avgHP).toLocaleString()} HP (±${Math.round(tolerance).toLocaleString()})`;
        if (hpInfo.samples > 1 && (hpInfo.maxHP - hpInfo.minHP) < tolerance * 2) {
            confText += ` [${Math.round(hpInfo.minHP).toLocaleString()}-${Math.round(hpInfo.maxHP).toLocaleString()}]`;
        }

        let barColor = 'linear-gradient(90deg, #26c6da, #4dd0e1)';
        let textColor = '#d0e8ff';
        if (pct <= 50) { barColor = 'linear-gradient(90deg, #f9a825, #ffb300)'; textColor = '#ffd54f'; }
        if (pct <= 25) { barColor = 'linear-gradient(90deg, #e53935, #ef5350)'; textColor = '#ef9a9a'; }

        hpText.textContent = `${Math.round(remaining).toLocaleString()} / ${Math.round(estimatedHP).toLocaleString()} HP`;
        hpText.style.color = textColor;
        hpBarFill.style.background = barColor;
        hpBarFill.style.width = pct.toFixed(1) + '%';
        confidenceEl.textContent = confText;

        const extra = [];
        if (data.totalEngagements > 0) {
            const mslPct = (data.missileLaunches / data.totalEngagements * 100);
            const torpPct = (data.torpedoLaunches / data.totalEngagements * 100);
            if (mslPct > 0) extra.push(`MSL ${mslPct.toFixed(0)}%`);
            if (torpPct > 0) extra.push(`Torp ${torpPct.toFixed(0)}%`);
        }

        if (data.gear && data.gear.samples > 0) {
            const evos = Object.values(data.gear.avgEvo);
            if (evos.length > 0) {
                const avg = evos.reduce((a, b) => a + b, 0) / evos.length;
                const tier = getGearTier(avg);
                extra.push(`Gear: ${tier} (${avg.toFixed(1)})`);
            }
        }

        intelExtraEl.textContent = extra.join(' | ');
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
        const container = document.getElementById(COMBAT_CONTAINER);
        if (!container) {
            setTimeout(start, 2000);
            return;
        }

        console.log('[OE2 HP] Script loaded. Watching combat log + kill mails...');
        injectStyles();
        observeCombatLog(container);
        observeKillMails();
        observeSensorContacts();
        createPanel();
        setInterval(updatePanel, UI_REFRESH_MS);
        updatePanel();
    }

    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
})();
