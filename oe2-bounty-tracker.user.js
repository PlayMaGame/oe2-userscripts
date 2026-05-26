// ==UserScript==
// @name         OE2 Bounty Target Tracker
// @namespace    https://game.dev.outerempires.net/
// @version      1.6
// @description  Live target list for active bounty, tracks eliminations from combat log
// @match        https://game.dev.outerempires.net/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';
    try {
        var _dbg = document.createElement('div');
        _dbg.textContent = 'BOUNTY RUNNING';
        _dbg.style.cssText = 'position:fixed;top:2px;right:2px;z-index:99999;background:#c00;color:#fff;font-size:11px;padding:1px 5px;font-family:monospace;';
        (document.body || document.documentElement || document).appendChild(_dbg);
    } catch(_e) {}
    console.log('[Bounty] script loaded');

    const COMBAT_LOG_ID = 'ui_chat_output_SysLogs::Combat';
    const STORAGE_PREFIX = 'oe2-bounty-';
    const STORAGE_VERSION = 2;

    let currentRef = null;
    let targets = [];
    let killCache = new Set();
    let panel = null;
    let parsedFromApi = false;
    var _interceptedAuth = '';
    var _interceptedCharId = '';
    var _jobsAuth = '';

    const INTERNAL_BASE = 'https://oe2-api-dev.azure-api.net';

    // ---- intercept game API traffic ----

    (function () {
        var _open = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url) {
            this._bonUrl = url;
            return _open.apply(this, arguments);
        };
        var _setH = XMLHttpRequest.prototype.setRequestHeader;
        XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
            var u = this._bonUrl || '';
            if (u.indexOf('oe2') !== -1 || u.indexOf('outerempires') !== -1) {
                if (k.toLowerCase() === 'authorization') {
                    if (!_interceptedAuth) _interceptedAuth = v;
                    if (u.indexOf('jobs/accepted') !== -1) _jobsAuth = v;
                }
                if (u.indexOf('jobs/accepted') !== -1) {
                    console.log('[Bounty] jobs XHR auth:', v.slice(0, 60));
                }
            }
            if (!_interceptedCharId && u.indexOf('characterId=') !== -1) {
                var cm = u.match(/characterId=(\d+)/);
                if (cm) _interceptedCharId = cm[1];
            }
            return _setH.apply(this, arguments);
        };
        // Intercept all XHR responses - look for job data
        var _send = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function (body) {
            var xhr = this;
            var url = xhr._bonUrl || '';
            var origReady = xhr.onreadystatechange;
            xhr.onreadystatechange = function () {
                if (xhr.readyState === 4 && xhr.status === 200 && url.indexOf('oe2') !== -1) {
                    try {
                        var text = xhr.responseText;
                        if (text && text.indexOf('"jobType"') !== -1) {
                            console.log('[Bounty] GOT JOB DATA from XHR:', url);
                            var data = JSON.parse(text);
                            processApiJobs(data);
                        }
                    } catch(e) {}
                }
                if (origReady) origReady.apply(xhr, arguments);
            };
            return _send.apply(this, arguments);
        };
    })();

    // ---- process API job data ----

    function processApiJobs(data) {
        if (!data) return;
        var jobs = null;
        if (data.data && data.data.jobs) jobs = data.data.jobs;
        else if (data.data && Array.isArray(data.data)) jobs = data.data;
        else if (Array.isArray(data)) jobs = data;
        else if (data.jobs) jobs = data.jobs;
        if (!jobs || jobs.length === 0) return;
        var ref = getRefFromTitle();
        if (!ref) return;
        console.log('[Bounty] at #' + ref, 'processing', jobs.length, 'jobs');
        console.log('[Bounty] === ALL JOBS FROM API ===');
        for (var ji = 0; ji < jobs.length; ji++) {
            console.log('[Bounty] ' + (ji + 1) + '.', JSON.stringify({ jobID: jobs[ji].jobID, jobName: jobs[ji].jobName, system: jobs[ji].systemName2, detail: (jobs[ji].detail || '').slice(0, 120), info1: jobs[ji].info1, info2: jobs[ji].info2, jobIssuedLocID: jobs[ji].jobIssuedLocID }));
        }
        // Collect combat jobs
        var combatJobs = [];
        for (var i = 0; i < jobs.length; i++) {
            var detail = jobs[i].detail || '';
            var ships = parseBountyTargetsFromApi(detail);
            if (ships && ships.length > 0) {
                combatJobs.push({
                    jobID: jobs[i].jobID,
                    jobName: jobs[i].jobName || ('Job #' + jobs[i].jobID),
                    system: jobs[i].systemName2 || '',
                    ships: ships
                });
            }
        }
        if (combatJobs.length === 0) { console.log('[Bounty] no combat jobs'); return; }
        window._bountyCombatJobs = combatJobs;
        // Select active job: use last selection from localStorage if still valid
        var selectedJobId = parseInt(localStorage.getItem(STORAGE_PREFIX + 'selectedJob_' + ref), 10) || 0;
        var activeJob = null;
        for (var ji = 0; ji < combatJobs.length; ji++) {
            if (combatJobs[ji].jobID === selectedJobId) {
                activeJob = combatJobs[ji];
                break;
            }
        }
        if (!activeJob) activeJob = combatJobs[0];
        localStorage.setItem(STORAGE_PREFIX + 'selectedJob_' + ref, String(activeJob.jobID));
        // Build fresh targets from selected job
        var freshTargets = activeJob.ships.map(function (n) { return { name: n, done: false }; });
        // Merge kill progress from cache (only if same jobID, otherwise discard stale cache)
        var cached = loadFullState(ref);
        if (cached && cached._jobId === activeJob.jobID && cached.targets) {
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
        parsedFromApi = true;
        saveFullState();
        render();
        // Re-scan combat log - clear killCache first since old kills had no targets to match
        killCache.clear();
        var logEl = document.getElementById(COMBAT_LOG_ID);
        console.log('[Bounty] re-scan combat log:', logEl ? 'found' : 'NOT FOUND');
        if (logEl) {
            var msgs = logEl.querySelectorAll('.ui_chat_log_message');
            console.log('[Bounty] combat log messages:', msgs.length);
            msgs.forEach(function (n) {
                var t = n.innerText.trim();
                if (t) handleKill(t);
            });
        }
    }

    // ---- direct API call ----

    function fetchAcceptedJobs() {
        var auth = _jobsAuth || _interceptedAuth;
        if (!auth || !_interceptedCharId) { console.log('[Bounty] waiting for auth/charId...'); return Promise.resolve(null); }
        console.log('[Bounty] fetching jobs...');
        return new Promise(function (resolve) {
            var url = INTERNAL_BASE + '/v1/jobs/accepted?characterId=' + _interceptedCharId;
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.setRequestHeader('Authorization', auth);
            xhr.onload = function () {
                console.log('[Bounty] jobs response', xhr.status);
                if (xhr.status === 200) {
                    try {
                        var body = JSON.parse(xhr.responseText);
                        if (body && body.success) resolve(body);
                        else resolve(null);
                    } catch(e) { resolve(null); }
                } else { resolve(null); }
            };
            xhr.onerror = function () { resolve(null); };
            xhr.send();
        });
    }

    function parseBountyTargetsFromApi(desc) {
        var targets = [];
        var regex = /(\d+)\s*x\s+(\w+)(?:\s+(?:ship|ships))?(?=[,.\s]|$)/gi;
        var m;
        while ((m = regex.exec(desc)) !== null) {
            var count = parseInt(m[1], 10);
            var name = m[2];
            for (var i = 0; i < count; i++) targets.push(name);
        }
        return targets.length > 0 ? targets : null;
    }

    function pollApi() {
        fetchAcceptedJobs().then(function (data) {
            if (data && data.data && data.data.jobs) {
                console.log('[Bounty] got', data.data.jobs.length, 'jobs from direct API call');
                processApiJobs(data);
            }
            scheduleApiPoll();
        });
    }

    function scheduleApiPoll() {
        setTimeout(pollApi, 10000);
    }

    // ---- helpers ----

    function getRefFromTitle() {
        var m = document.title.match(/#(\d+)/);
        return m ? m[1] : null;
    }

    function saveFullState() {
        if (!currentRef || targets.length === 0) return;
        var state = {
            _jobId: parseInt(localStorage.getItem(STORAGE_PREFIX + 'selectedJob_' + currentRef), 10) || 0,
            targets: targets.map(function (t) { return { name: t.name, done: t.done }; })
        };
        localStorage.setItem(STORAGE_PREFIX + currentRef, JSON.stringify(state));
    }

    function loadFullState(ref) {
        try {
            var raw = localStorage.getItem(STORAGE_PREFIX + ref);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch(e) { return null; }
    }

    // ---- kill processing ----

    function extractBaseClass(name) {
        return name.replace(/\s*\([^)]*\)\s*$/, '').trim().replace(/\s+ship(s)?$/i, '');
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
        }
    }

    // ---- combat log observer ----

    function watchCombatLog() {
        var el = document.getElementById(COMBAT_LOG_ID);
        if (!el) { setTimeout(watchCombatLog, 2000); return; }
        el.querySelectorAll('.ui_chat_log_message').forEach(function (n) {
            var t = n.innerText.trim();
            if (t) handleKill(t);
        });
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
            panel.innerHTML = '<div style="font-size:11px;font-weight:700;color:#7ecfff;margin-bottom:6px;letter-spacing:.5px;">Bounty #' + currentRef + '</div><div style="color:#888;font-size:12px;">Waiting for bounty data...</div>';
            return;
        }
        var allDone = targets.every(function (t) { return t.done; });
        var html = '<div style="font-size:11px;font-weight:700;color:#7ecfff;margin-bottom:6px;letter-spacing:.5px;">Bounty #' + currentRef + '</div>';
        // Job selector if multiple combat jobs available
        var combatJobs = window._bountyCombatJobs || [];
        if (combatJobs.length > 1) {
            html += '<div style="margin-bottom:6px;font-size:12px;">';
            html += '<select id="oe2-bounty-job-select" style="background:#1a1a2e;color:#c8d6e5;border:1px solid #333;font-size:12px;padding:2px 4px;width:100%;">';
            var selectedId = parseInt(localStorage.getItem(STORAGE_PREFIX + 'selectedJob_' + currentRef), 10) || 0;
            for (var ji = 0; ji < combatJobs.length; ji++) {
                var j = combatJobs[ji];
                var sel = j.jobID === selectedId ? ' selected' : '';
                html += '<option value="' + j.jobID + '"' + sel + '>' + j.jobName.slice(0, 50) + '</option>';
            }
            html += '</select>';
            html += '</div>';
        }
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
        // Bind job selector change
        var selEl = document.getElementById('oe2-bounty-job-select');
        if (selEl) {
            selEl.addEventListener('change', function () {
                var newId = parseInt(this.value, 10);
                localStorage.setItem(STORAGE_PREFIX + 'selectedJob_' + currentRef, String(newId));
                targets = [];
                killCache.clear();
                parsedFromApi = false;
                saveFullState();
                pollApi();
            });
        }
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
        watchCombatLog();
        setTimeout(pollApi, 3000);
        setInterval(function () {
            var ref = getRefFromTitle();
            if (ref && ref !== currentRef) {
                currentRef = ref;
                targets = [];
                killCache.clear();
                parsedFromApi = false;
                render();
                // Trigger immediate fetch when arriving at a bounty
                pollApi();
            } else if (!ref && currentRef) {
                // Left the bounty location - hide panel
                currentRef = null;
                targets = [];
                render();
            }
        }, 1000);
    }

    if (document.body) boot();
    else document.addEventListener('DOMContentLoaded', boot);
})();
