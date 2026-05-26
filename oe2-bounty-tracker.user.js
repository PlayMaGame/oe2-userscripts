// ==UserScript==
// @name         OE2 Bounty Target Tracker
// @namespace    https://game.dev.outerempires.net/
// @version      2.0
// @description  Live target list for active bounty, tracks eliminations from combat log
// @match        https://game.dev.outerempires.net/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    console.log('[Bounty] script loaded (DOM mode v2)');

    const COMBAT_LOG_ID = 'ui_chat_output_SysLogs::Combat';
    const STORAGE_PREFIX = 'oe2-bounty-';
    const STORAGE_VERSION = 4;

    let currentRef = null;
    let targets = [];
    let killCache = new Set();
    let panel = null;
    let scrapedJobs = {};

    // ---- DOM scraper ----

    function parseShipsFromText(text) {
        var ships = [];
        var regex = /(\d+)\s*x\s+(\w+)/gi;
        var m;
        while ((m = regex.exec(text)) !== null) {
            var count = parseInt(m[1], 10);
            var name = m[2];
            for (var i = 0; i < count; i++) ships.push(name);
        }
        return ships;
    }

    function scrapeJobsPanel() {
        var list = document.getElementById('JobListAccepted');
        if (!list) return false;

        var items = list.querySelectorAll('.JobItem[id^="availableJob_"]');
        if (items.length === 0) return false;

        var seenRefs = new Set();
        var count = 0;

        // Build fresh map from current DOM
        var fresh = {};
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var idMatch = item.id.match(/availableJob_(\d+)/);
            if (!idMatch) continue;
            var jobId = parseInt(idMatch[1], 10);

            // Find the "Bounty Ref:" label and get the next .JobItem_Short_Detail
            var refEls = item.querySelectorAll('.JobItem_Short_Detail');
            var ref = null;
            for (var ri = 0; ri < refEls.length; ri++) {
                var txt = refEls[ri].textContent.trim();
                var rm = txt.match(/#(\d+)/);
                if (rm) { ref = rm[1]; break; }
            }
            if (!ref) continue;

            var nameEl = item.querySelector('.JobItem_Detail_Name');
            var jobName = nameEl ? nameEl.textContent.trim() : '';

            var descEl = item.querySelector('.text_justified');
            var descText = descEl ? descEl.textContent.trim() : '';

            var system = '';
            var sysMatch = jobName.match(/\bin\s+(.+?)$/i);
            if (sysMatch) system = sysMatch[1].trim();

            var ships = parseShipsFromText(descText);
            if (ships.length > 0) {
                fresh[ref] = { jobID: jobId, jobName: jobName, system: system, ships: ships };
                seenRefs.add(ref);
                count++;
            }
        }

        if (count === 0) return false;

        // Merge fresh data into scrapedJobs, prune stale entries
        var pruned = [];
        var keys = Object.keys(scrapedJobs);
        for (var ki = 0; ki < keys.length; ki++) {
            var key = keys[ki];
            if (key === '_updatedAt') continue;
            if (!seenRefs.has(key)) { pruned.push(key); delete scrapedJobs[key]; }
        }
        for (var ref in fresh) scrapedJobs[ref] = fresh[ref];
        scrapedJobs._updatedAt = Date.now();
        saveJobs();
        console.log('[Bounty] scraped ' + count + ' jobs' + (pruned.length ? ', pruned: #' + pruned.join(', #') : ''));
        for (var ref in fresh) {
            console.log('[Bounty]   #' + ref + ' -> jobID ' + fresh[ref].jobID + ' [' + fresh[ref].ships.join(', ') + ']');
        }
        return true;
    }

    function saveJobs() {
        localStorage.setItem(STORAGE_PREFIX + 'jobs', JSON.stringify(scrapedJobs));
    }

    function loadJobs() {
        try {
            var raw = localStorage.getItem(STORAGE_PREFIX + 'jobs');
            if (raw) {
                var parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    scrapedJobs = parsed;
                    var n = Object.keys(scrapedJobs).filter(function(k) { return k !== '_updatedAt'; }).length;
                    console.log('[Bounty] loaded ' + n + ' jobs from cache');
                }
            }
        } catch(e) {}
    }

    // ---- combat log ----

    function extractBaseClass(name) {
        var n = name;
        while (true) {
            var prev = n;
            n = n.replace(/\s*\([^)]*\)\s*$/, '').trim();
            if (n === prev) break;
        }
        return n.replace(/\s+ship(s)?$/i, '').trim();
    }

    function parseKillTarget(text) {
        var patterns = [
            /You destroy (.+?)\.?$/i,
            /You destroyed (.+?)\.?$/i,
            /You have destroyed (.+?)\.?$/i,
            /(.+?) has been destroyed\.?$/i,
            /Target (.+?) eliminated\.?$/i,
            /(.+?) eliminated\.?$/i,
        ];
        for (var pi = 0; pi < patterns.length; pi++) {
            var m = text.match(patterns[pi]);
            if (m) return m[1].trim();
        }
        return null;
    }

    function handleKill(text) {
        if (killCache.has(text)) return;
        killCache.add(text);
        var raw = parseKillTarget(text);
        if (!raw) return;
        var killedClass = extractBaseClass(raw).toLowerCase();
        console.log('[Bounty] \u2717', killedClass, '(' + targets.length + ' targets)');
        for (var ti = 0; ti < targets.length; ti++) {
            if (!targets[ti].done && targets[ti].name.toLowerCase() === killedClass) {
                targets[ti].done = true;
                saveFullState();
                render();
                break;
            }
        }
    }

    function watchCombatLog() {
        var el = document.getElementById(COMBAT_LOG_ID);
        if (!el) { setTimeout(watchCombatLog, 2000); return; }
        // Only watch NEW messages — no initial re-scan of old ones
        new MutationObserver(function (muts) {
            for (var mi = 0; mi < muts.length; mi++) {
                for (var ni = 0; ni < muts[mi].addedNodes.length; ni++) {
                    var n = muts[mi].addedNodes[ni];
                    if (n.nodeType === 1 && n.classList.contains('ui_chat_log_message')) {
                        var t = n.innerText.trim();
                        if (t) handleKill(t);
                    }
                }
            }
        }).observe(el, { childList: true, subtree: true });
    }

    // ---- state persistence ----

    function saveFullState() {
        if (!currentRef || targets.length === 0) return;
        var state = {
            targets: targets.map(function (t) { return { name: t.name, done: t.done }; })
        };
        localStorage.setItem(STORAGE_PREFIX + 'state_' + currentRef, JSON.stringify(state));
    }

    function loadFullState(ref) {
        try {
            var raw = localStorage.getItem(STORAGE_PREFIX + 'state_' + ref);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch(e) { return null; }
    }

    // ---- helpers ----

    function getRefFromTitle() {
        var m = document.title.match(/#(\d+)/);
        return m ? m[1] : null;
    }

    // ---- panel ----

    function buildPanel() {
        if (panel) return;
        panel = document.createElement('div');
        panel.id = 'oe2-bounty-panel';
        panel.style.cssText = [
            'position: fixed', 'z-index: 199', 'top: 80px',
            'left: calc(50% - 500px)', 'transform: translateX(-50%)',
            'padding: 4px 0', 'font-family: Rajdhani, "Segoe UI", sans-serif',
            'color: #c8d6e5', 'font-size: 15px', 'min-width: 220px',
            'display: none',
        ].join(';') + ';';
        document.body.appendChild(panel);
    }

    function render() {
        buildPanel();
        if (!currentRef) { panel.style.display = 'none'; return; }
        panel.style.display = 'block';

        if (targets.length === 0) {
            var job = scrapedJobs[currentRef];
            if (!job) {
                panel.innerHTML = '<div style="font-size:11px;font-weight:700;color:#7ecfff;margin-bottom:6px;letter-spacing:.5px;">Bounty #' + currentRef + '</div><div style="color:#888;font-size:12px;">Open Jobs tab to sync</div>';
            } else {
                panel.innerHTML = '<div style="font-size:11px;font-weight:700;color:#7ecfff;margin-bottom:6px;letter-spacing:.5px;">Bounty #' + currentRef + '</div><div style="color:#888;font-size:12px;">Waiting for bounty data...</div>';
            }
            return;
        }

        var allDone = targets.every(function (t) { return t.done; });
        var html = '<div style="font-size:11px;font-weight:700;color:#7ecfff;margin-bottom:6px;letter-spacing:.5px;">Bounty #' + currentRef;
        if (scrapedJobs._updatedAt) {
            var d = new Date(scrapedJobs._updatedAt);
            var hh = d.getHours().toString().padStart(2, '0');
            var mm = d.getMinutes().toString().padStart(2, '0');
            var ss = d.getSeconds().toString().padStart(2, '0');
            html += ' <span style="font-weight:400;font-size:10px;color:#546e7a;">[' + hh + ':' + mm + ':' + ss + ']</span>';
        }
        html += '</div>';
        if (allDone) {
            html += '<div style="color:#4dd0e1;font-weight:700;font-size:14px;">\u2713 ALL ELIMINATED</div>';
        } else {
            for (var ti = 0; ti < targets.length; ti++) {
                var icon = targets[ti].done ? '<span style="color:#4dd0e1;">\u2713</span>' : '<span style="color:#ef5350;">\u25a1</span>';
                var sty = targets[ti].done ? 'text-decoration:line-through;color:#546e7a;' : '';
                html += '<div style="' + sty + 'padding:2px 0;">' + icon + ' ' + targets[ti].name + '</div>';
            }
        }
        panel.innerHTML = html;
    }

    function setActiveJob(ref, job) {
        if (!job || !job.ships || job.ships.length === 0) {
            console.log('[Bounty] no ships for #' + ref + ', clearing');
            targets = [];
            render();
            return;
        }
        console.log('[Bounty] active #' + ref + ' -> ' + job.jobName + ' [' + job.ships.join(', ') + ']');
        var freshTargets = job.ships.map(function (n) { return { name: n, done: false }; });
        var cached = loadFullState(ref);
        if (cached && cached.targets) {
            for (var fi = 0; fi < freshTargets.length; fi++) {
                for (var ci = 0; ci < cached.targets.length; ci++) {
                    if (freshTargets[fi].name === cached.targets[ci].name && cached.targets[ci].done) {
                        freshTargets[fi].done = true;
                        break;
                    }
                }
            }
        }
        currentRef = ref;
        targets = freshTargets;
        saveFullState();
        render();
    }

    // ---- DOM observer for jobs tab ----

    function watchJobsPanel() {
        var list = document.getElementById('JobListAccepted');
        if (!list) { setTimeout(watchJobsPanel, 2000); return; }
        console.log('[Bounty] Jobs tab detected, starting scraper');

        // Initial scrape
        if (scrapeJobsPanel()) {
            var ref = getRefFromTitle();
            if (ref && scrapedJobs[ref]) {
                setActiveJob(ref, scrapedJobs[ref]);
            }
        }

        // Observe for changes (new jobs, updated status)
        new MutationObserver(function () {
            if (scrapeJobsPanel()) {
                var ref = getRefFromTitle();
                if (ref && scrapedJobs[ref]) {
                    setActiveJob(ref, scrapedJobs[ref]);
                }
            }
        }).observe(list, { childList: true, subtree: true });

        // Periodic re-scrape while tab is visible
        setInterval(function () {
            if (document.getElementById('JobListAccepted') && document.getElementById('JobListAccepted').offsetParent !== null) {
                scrapeJobsPanel();
            }
        }, 2000);
    }

    // ---- boot ----

    function boot() {
        // Clear old format cache on upgrade
        if (localStorage.getItem(STORAGE_PREFIX + 'version') !== String(STORAGE_VERSION)) {
            var keys = Object.keys(localStorage);
            for (var ki = 0; ki < keys.length; ki++) {
                if (keys[ki].indexOf(STORAGE_PREFIX) === 0) localStorage.removeItem(keys[ki]);
            }
            localStorage.setItem(STORAGE_PREFIX + 'version', String(STORAGE_VERSION));
            console.log('[Bounty] cache cleared (version', STORAGE_VERSION + ')');
        }

        loadJobs();
        watchCombatLog();
        watchJobsPanel();

        // Check for instance change every second
        setInterval(function () {
            var ref = getRefFromTitle();
            if (ref && ref !== currentRef) {
                if (scrapedJobs[ref]) {
                    console.log('[Bounty] entered instance #' + ref + ' -> job found in cache');
                    setActiveJob(ref, scrapedJobs[ref]);
                    killCache.clear();
                } else {
                    console.log('[Bounty] entered instance #' + ref + ' -> NO cache entry (open Jobs tab)');
                    currentRef = ref;
                    targets = [];
                    render();
                }
            } else if (!ref && currentRef) {
                console.log('[Bounty] left instance #' + currentRef);
                currentRef = null;
                targets = [];
                render();
            }
        }, 1000);
    }

    if (document.body) boot();
    else document.addEventListener('DOMContentLoaded', boot);
})();
