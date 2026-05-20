// ==UserScript==
// @name         OE2 Combat HP
// @namespace    https://game.dev.outerempires.net/
// @version      1.1
// @description  Live target HP panel + learns ship class total HP from kills
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
    let activeTargets = {};     // combatId -> { damageTaken, lastSeen, intelKey }
    let processedTexts = new Set();
    let currentTarget = null;   // combatId we're tracking for the panel

    // =============================================
    // INTEL PERSISTENCE
    // =============================================
    function saveIntel() {
        localStorage.setItem(INTEL_STORAGE_KEY, JSON.stringify(intel, null, 2));
    }

    // Cache resolved keys so we don't hammer the DOM
    const intelKeyCache = {};

    function resolveIntelKey(fullTarget) {
        if (intelKeyCache[fullTarget]) return intelKeyCache[fullTarget];

        // fullTarget: "Fighter Bomber (UDBQ6785-FBO)"
        const m = fullTarget.match(/^(.+?)\s*\(([A-Za-z0-9_-]+)\)$/);
        if (!m) {
            intelKeyCache[fullTarget] = fullTarget;
            return fullTarget;
        }

        const descId = m[2];

        // Search Sensor Contacts for this description ID
        const contacts = document.querySelector('#SystemExplorer_SensorContacts_Expanded');
        if (contacts) {
            for (const item of contacts.querySelectorAll('.SystemExplorer_Item')) {
                const descEl = item.querySelector('.SystemExplorer_Description');
                if (descEl && descEl.textContent.trim() === descId) {
                    const nameEl = item.querySelector('.SystemExplorer_ObjectName');
                    if (nameEl) {
                        const key = nameEl.textContent.trim();
                        intelKeyCache[fullTarget] = key;
                        return key;
                    }
                }
            }
        }

        // Fallback: just the base class name
        intelKeyCache[fullTarget] = m[1].trim();
        return intelKeyCache[fullTarget];
    }

    function clearIntelKeyCache() {
        for (const k of Object.keys(intelKeyCache)) {
            delete intelKeyCache[k];
        }
    }

    // =============================================
    // PARSER (from combat_log.js)
    // =============================================
    function parseMessage(text) {
        // Outgoing damage
        if (text.includes('You deal')) {
            const m = text.match(/You deal (\d+) points of (\w+) damage to (.+)\./);
            if (m) return { type: 'outgoing', target: m[3].trim(), amount: Number(m[1]), damageType: m[2] };
        }

        // Incoming damage
        if (text.includes('damage to you')) {
            const m = text.match(/(.+) deals (\d+) points of (\w+) damage to you/);
            if (m) return { type: 'incoming', source: m[1].trim(), amount: Number(m[2]), damageType: m[3] };
        }

        // Missile
        if (text.includes('Missile launch detected')) {
            const m = text.match(/(.+?) launches/i);
            return { type: 'missile', source: m ? m[1].trim() : 'unknown' };
        }

        // Shield absorb
        if (text.includes('Your shields absorb')) {
            const m = text.match(/Your shields absorb (\d+) points of (\w+) damage/);
            if (m) return { type: 'shield', amount: Number(m[1]), damageType: m[2] };
        }

        // Kill detection
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
            activeTargets[name] = {
                damageTaken: 0,
                lastSeen: Date.now(),
                intelKey: resolveIntelKey(name),
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

        if (entry.type === 'kill') {
            const target = activeTargets[entry.target];
            if (target && target.damageTaken > 0 && target.damageTaken <= MAX_REASONABLE_DMG) {
                const intelKey = target.intelKey;
                if (!intel[intelKey]) {
                    intel[intelKey] = { avgHP: target.damageTaken, samples: 1, minHP: target.damageTaken, maxHP: target.damageTaken };
                } else {
                    const d = intel[intelKey];
                    d.avgHP = d.avgHP * 0.85 + target.damageTaken * 0.15;
                    d.samples++;
                    d.minHP = Math.min(d.minHP, target.damageTaken);
                    d.maxHP = Math.max(d.maxHP, target.damageTaken);
                }
                saveIntel();
            }
            delete activeTargets[entry.target];
            if (currentTarget === entry.target) currentTarget = null;
        }
    }

    // =============================================
    // DOM OBSERVER
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

        // Header line: target name + ship class
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

        // HP Bar
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

        // HP text
        hpText = document.createElement('div');
        hpText.style.fontSize = '20px';
        hpText.style.fontWeight = '700';
        hpText.style.marginTop = '6px';
        hpText.style.color = '#d0e8ff';
        panel.appendChild(hpText);

        // Divider
        const div = document.createElement('div');
        div.style.borderTop = '1px solid #0f1e30';
        div.style.margin = '8px 0 6px';
        panel.appendChild(div);

        // Intel stats
        confidenceEl = document.createElement('div');
        confidenceEl.style.fontSize = '11px';
        confidenceEl.style.color = '#4a6a8a';
        confidenceEl.style.fontWeight = '500';
        panel.appendChild(confidenceEl);

        // Reset button
        const resetBtn = document.createElement('button');
        resetBtn.className = 'oe2-btn';
        resetBtn.textContent = 'Reset Intel';
        resetBtn.style.marginTop = '8px';
        resetBtn.addEventListener('click', () => {
            localStorage.removeItem(INTEL_STORAGE_KEY);
            intel = {};
            activeTargets = {};
            currentTarget = null;
            clearIntelKeyCache();
            panel.style.display = 'none';
        });
        panel.appendChild(resetBtn);

        document.body.appendChild(panel);
    }

    function updatePanel() {
        if (!panel) createPanel();
        cleanupTargets();

        if (!currentTarget || !activeTargets[currentTarget]) {
            panel.style.display = 'none';
            return;
        }

        const t = activeTargets[currentTarget];
        const intelKey = t.intelKey;
        const data = intel[intelKey];
        const hasIntel = !!data;

        panel.style.display = 'block';
        targetNameEl.textContent = intelKey;
        shipClassEl.textContent = '';

        if (!hasIntel) {
            hpText.textContent = `${Math.round(t.damageTaken)} DMG dealt`;
            hpText.style.color = '#d0e8ff';
            hpBarFill.style.width = '0%';
            confidenceEl.textContent = 'Learning this ship type. Kill one to estimate HP.';
            return;
        }

        const estimatedHP = Math.max(data.avgHP, t.damageTaken);
        const remaining = Math.max(0, estimatedHP - t.damageTaken);
        const pct = Math.max(0, Math.min(100, (remaining / estimatedHP) * 100));
        const confidence = Math.min(100, data.samples * 10);

        let barColor = 'linear-gradient(90deg, #26c6da, #4dd0e1)';
        let textColor = '#d0e8ff';
        if (pct <= 50) { barColor = 'linear-gradient(90deg, #f9a825, #ffb300)'; textColor = '#ffd54f'; }
        if (pct <= 25) { barColor = 'linear-gradient(90deg, #e53935, #ef5350)'; textColor = '#ef9a9a'; }

        hpText.textContent = `${Math.round(remaining).toLocaleString()} / ${Math.round(estimatedHP).toLocaleString()} HP`;
        hpText.style.color = textColor;
        hpBarFill.style.background = barColor;
        hpBarFill.style.width = pct.toFixed(1) + '%';
        confidenceEl.textContent = `Samples: ${data.samples} | ${confidence.toFixed(0)}% confidence | Range: ${Math.round(data.minHP).toLocaleString()}-${Math.round(data.maxHP).toLocaleString()} HP`;
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

        console.log('[OE2 HP] Script loaded. Watching combat log...');
        injectStyles();
        observeCombatLog(container);
        createPanel();
        setInterval(updatePanel, UI_REFRESH_MS);
        updatePanel();
    }

    // Wait for body
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
})();
