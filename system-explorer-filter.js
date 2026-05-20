// ==UserScript==
// @name         Outer Empires 2 - System Explorer Filter
// @namespace    outer-empires-2
// @version      1.9
// @description  Filter/recolor items in the System Explorer panel with an inline toggle button + Rob alert (flicker-free) + auto-toggle in/out of combat. Color/Alert lists override the filter.
// @match        https://game.dev.outerempires.net/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // List of object names to HIDE (case-insensitive, partial match).
    const FILTER_LIST = [
        'Rescue Shuttle','Freighter','Scavenger','Factory Ship','Utility Tug',
        'Hulkbreaker','Service Shuttle','Turret Eater','Hauler','Survey Shuttle',
        'Rock Chipper','Assault Frigate','Prime Mover','Support Ops Rig',
        'Heavy Mining Rig','Merchantman','Rock Hopper','Explorer',
        'Kinetic Racer','Salvage Rig','Command Cruiser','Hostile Environment Mining Rig',
        'Riot Frigate','Strategic Mover','Infiltrator','Destroyer','Fighter Bomber',
        'Corvette','Cruiser','Frigate','Clipper','Screen','Battleship','Depot Ship','Escort Carrier',
		'Heavy Shuttle','Interceptor','Scout','Sentry','Gravity Minelayer','Patrol','Hulkbreaker',
    ];

    // List of object names to RECOLOR (not hidden). Matches here override FILTER_LIST.
    const COLOR_LIST = [
        { match: 'Hulk ',         color: '#888'    },
        { match: 'OEDev Rob',     color: '#FF00FF' },
		{ match: '[NEC]',     color: '#008000' },
		{ match: '[ NEC ]',     color: '#0096FF' },
    ];

    // Alerts. `persistent: true` means the buzz repeats until the popup is clicked.
    // `interval` is the buzz repeat period in ms (default 2000).
    // Matches here override FILTER_LIST (so alerted items are never hidden).
    const ALERT_LIST = [
        { match: 'OEDev Rob', persistent: true,  interval: 1500 },
        { match: 'Hulk ',      persistent: false },
    ];

    let filterEnabled = true;
    let lastInstanceState = null; // null = unknown, true = in instance, false = out
    const BTN_ID = 'oe2-filter-toggle';
    const seenAlerts = new Set();
    // Track active persistent alerts: name -> { timer, note }
    const activePersistent = new Map();

    // ---------- Combat / Instance Detection ----------
    function isInInstance() {
        return !!document.getElementById('ui-exit-instance');
    }

    function checkInstanceStateAndAutoToggle() {
        const inInstance = isInInstance();
        if (inInstance === lastInstanceState) return false;

        const previousState = lastInstanceState;
        lastInstanceState = inInstance;

        if (previousState === null) return false;

        const desired = !inInstance;
        if (filterEnabled !== desired) {
            filterEnabled = desired;
            const btn = document.getElementById(BTN_ID);
            if (btn) styleButton(btn);
            return true;
        }
        return false;
    }

    // ---------- Toggle Button ----------
    function styleButton(btn) {
        const onColor = '#1e90ff';
        const offColor = '#888';
        Object.assign(btn.style, {
            cursor: 'pointer',
            userSelect: 'none',
            color: filterEnabled ? onColor : offColor,
            transition: 'color 0.15s, text-shadow 0.15s',
            textShadow: filterEnabled ? '0 0 4px rgba(30,144,255,0.6)' : 'none',
        });
        btn.title = 'Ship filter: ' + (filterEnabled ? 'ON' : 'OFF') +
                    (isInInstance() ? ' (in instance)' : '');

        if (!btn.dataset.hoverBound) {
            btn.dataset.hoverBound = '1';
            btn.addEventListener('mouseenter', () => {
                btn.style.textShadow = '0 0 6px rgba(255,255,255,0.7)';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.textShadow = filterEnabled
                    ? '0 0 4px rgba(30,144,255,0.6)'
                    : 'none';
            });
        }
    }

    function ensureButton() {
        const header = document.getElementById('SystemExplorer_Header');
        if (!header) return;
        if (document.getElementById(BTN_ID)) return;

        const walker = document.createTreeWalker(header, NodeFilter.SHOW_TEXT, null);
        let textNode = null;
        while (walker.nextNode()) {
            if (/\bSYSTEM\b/.test(walker.currentNode.nodeValue)) {
                textNode = walker.currentNode;
                break;
            }
        }
        if (!textNode) return;

        const match = textNode.nodeValue.match(/^([\s\S]*?)\bS(YSTEM\b[\s\S]*)$/);
        if (!match) return;

        const parent = textNode.parentNode;
        const beforeNode = document.createTextNode(match[1]);

        const toggleSpan = document.createElement('span');
        toggleSpan.id = BTN_ID;
        toggleSpan.textContent = 'S';
        styleButton(toggleSpan);
        toggleSpan.addEventListener('click', (e) => {
            e.stopPropagation();
            filterEnabled = !filterEnabled;
            styleButton(toggleSpan);
            applyFilter();
        });

        const afterNode = document.createTextNode(match[2]);

        parent.insertBefore(beforeNode, textNode);
        parent.insertBefore(toggleSpan, textNode);
        parent.insertBefore(afterNode, textNode);
        parent.removeChild(textNode);
    }

    // ---------- Asterisk Sound (Web Audio API) ----------
    let audioCtx = null;
    function getAudioCtx() {
        if (!audioCtx) {
            try {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            } catch (e) {
                console.warn('AudioContext unavailable', e);
            }
        }
        return audioCtx;
    }

    function playAsterisk() {
        const ctx = getAudioCtx();
        if (!ctx) return;
        if (ctx.state === 'suspended') ctx.resume();
        const now = ctx.currentTime;
        const tone = (freq, start, dur) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + start);
            gain.gain.setValueAtTime(0.0001, now + start);
            gain.gain.exponentialRampToValueAtTime(0.35, now + start + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + start);
            osc.stop(now + start + dur + 0.05);
        };
        tone(1320, 0.00, 0.18);
        tone(1760, 0.10, 0.25);
    }

    function playUrgentBuzz() {
        const ctx = getAudioCtx();
        if (!ctx) return;
        if (ctx.state === 'suspended') ctx.resume();
        const now = ctx.currentTime;
        const tone = (freq, start, dur, vol = 0.4) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(freq, now + start);
            gain.gain.setValueAtTime(0.0001, now + start);
            gain.gain.exponentialRampToValueAtTime(vol, now + start + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + start);
            osc.stop(now + start + dur + 0.05);
        };
        tone(880,  0.00, 0.15);
        tone(660,  0.18, 0.15);
        tone(880,  0.36, 0.20);
    }

    // ---------- Notification Popup ----------
    function showNotification(name, color, opts) {
        opts = opts || {};
        const c = color || '#FF00FF';
        const note = document.createElement('div');

        const title = document.createElement('div');
        title.textContent = '⚠ ' + name + ' detected!';
        note.appendChild(title);

        if (opts.persistent) {
            const sub = document.createElement('div');
            sub.textContent = 'Click to acknowledge & silence';
            Object.assign(sub.style, {
                fontSize: '11px',
                fontWeight: 'normal',
                marginTop: '4px',
                opacity: '0.8',
            });
            note.appendChild(sub);
        }

        Object.assign(note.style, {
            position: 'fixed',
            top: '175px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 999999,
            padding: '12px 18px',
            background: 'rgba(20,20,30,0.95)',
            color: c,
            border: '2px solid ' + c,
            borderRadius: '6px',
            fontFamily: 'sans-serif',
            fontSize: '14px',
            fontWeight: 'bold',
            boxShadow: '0 0 12px ' + c,
            cursor: 'pointer',
            transition: 'opacity 0.4s ease',
            opacity: '0',
            textAlign: 'center',
        });

        if (opts.persistent) {
            note.animate(
                [
                    { boxShadow: '0 0 8px '  + c },
                    { boxShadow: '0 0 22px ' + c },
                    { boxShadow: '0 0 8px '  + c },
                ],
                { duration: 1000, iterations: Infinity }
            );
        }

        note.addEventListener('click', () => {
            if (typeof opts.onDismiss === 'function') opts.onDismiss();
            note.style.opacity = '0';
            setTimeout(() => note.remove(), 400);
        });

        document.body.appendChild(note);
        requestAnimationFrame(() => { note.style.opacity = '1'; });

        if (!opts.persistent) {
            setTimeout(() => {
                note.style.opacity = '0';
                setTimeout(() => note.remove(), 400);
            }, 8000);
        }

        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            try { new Notification('System Explorer Alert', { body: name + ' detected!' }); } catch (e) {}
        }

        return note;
    }

    function fireAlert(name) {
        const lower = name.toLowerCase();
        const cm = colorMatch(lower);
        const am = alertMatch(lower);
        const color = cm ? cm.color : null;
        const persistent = !!(am && am.persistent);

        if (persistent) {
            if (activePersistent.has(name)) return;

            const interval = (am && am.interval) || 2000;

            playUrgentBuzz();

            const timer = setInterval(() => {
                playUrgentBuzz();
            }, interval);

            const note = showNotification(name, color, {
                persistent: true,
                onDismiss: () => {
                    clearInterval(timer);
                    activePersistent.delete(name);
                },
            });

            activePersistent.set(name, { timer, note });
        } else {
            showNotification(name, color, { persistent: false });
            playAsterisk();
        }
    }

    // ---------- Helpers ----------
    function getRawName(itemEl) {
        const nameEl = itemEl.querySelector('.SystemExplorer_ObjectName');
        return nameEl ? nameEl.textContent.trim() : '';
    }

	function shouldHide(txt) {
		return FILTER_LIST.some(n => {
			const lower = n.toLowerCase();
			if (!txt.includes(lower)) return false;
			// Find what comes after the matched ship type name
			const idx = txt.indexOf(lower);
			const after = txt.slice(idx + lower.length).trim();
			// Hide only if nothing follows (no personal name/tag)
			return after === '';
		});
	}

    function colorMatch(txt) {
        return COLOR_LIST.find(c => txt.includes(c.match.toLowerCase()));
    }

    function alertMatch(txt) {
        return ALERT_LIST.find(a => txt.includes(a.match.toLowerCase()));
    }

    // Apply visual state for a single item.
    // Color list and Alert list ALWAYS run regardless of filterEnabled.
    // A match in COLOR_LIST or ALERT_LIST overrides FILTER_LIST (item won't be hidden).
    function processItem(item, triggerAlerts) {
        if (!item || !item.querySelector) return;
        const nameEl = item.querySelector('.SystemExplorer_ObjectName');
        const rawName = nameEl ? nameEl.textContent.trim() : '';
        const txt = rawName.toLowerCase();

        const cm = colorMatch(txt);
        const am = alertMatch(txt);
        const protectedFromHide = !!(cm || am);

        // Hide ONLY if filter is on, item matches FILTER_LIST, AND it doesn't
        // also match a color or alert rule (those take precedence).
        if (filterEnabled && !protectedFromHide && shouldHide(txt)) {
            if (item.style.display !== 'none') item.style.display = 'none';
            item.dataset.oe2Filtered = 'true';
            return;
        } else if (item.dataset.oe2Filtered === 'true') {
            item.style.display = '';
            item.dataset.oe2Filtered = 'false';
        }

        if (!nameEl) return;

        // Apply / clear color (always — regardless of filterEnabled).
        if (cm) {
            if (nameEl.style.color !== cm.color) nameEl.style.color = cm.color;
            nameEl.dataset.oe2Colored = 'true';
        } else if (nameEl.dataset.oe2Colored === 'true') {
            nameEl.style.color = '';
            nameEl.dataset.oe2Colored = 'false';
        }

        // Alerts always fire (regardless of filterEnabled).
        if (triggerAlerts && am && !seenAlerts.has(rawName)) {
            seenAlerts.add(rawName);
            fireAlert(rawName);
        }
    }

    function applyFilter() {
        const items = document.querySelectorAll('.SystemExplorer_Item');
        const presentAlertKeys = new Set();

        items.forEach(item => {
            processItem(item, false);

            const rawName = getRawName(item);
            const txt = rawName.toLowerCase();
            const am = alertMatch(txt);
            // Alerts always run — even if the item *would* have been hidden,
            // because alert matches override the filter and unhide it.
            if (am) {
                presentAlertKeys.add(rawName);
                if (!seenAlerts.has(rawName)) {
                    seenAlerts.add(rawName);
                    fireAlert(rawName);
                }
            }
        });

        for (const key of Array.from(seenAlerts)) {
            if (!presentAlertKeys.has(key)) {
                seenAlerts.delete(key);
                const active = activePersistent.get(key);
                if (active) {
                    clearInterval(active.timer);
                    if (active.note && active.note.parentNode) {
                        active.note.style.opacity = '0';
                        setTimeout(() => active.note.remove(), 400);
                    }
                    activePersistent.delete(key);
                }
            }
        }
    }

    // ---------- Watch for dynamic re-renders ----------
    let debounceTimer = null;

    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            if (!m.addedNodes || m.addedNodes.length === 0) continue;
            for (const node of m.addedNodes) {
                if (node.nodeType !== 1) continue;
                if (node.classList && node.classList.contains('SystemExplorer_Item')) {
                    processItem(node, false);
                } else if (node.querySelectorAll) {
                    const inner = node.querySelectorAll('.SystemExplorer_Item');
                    if (inner.length) inner.forEach(it => processItem(it, false));
                }
            }
        }

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            ensureButton();
            checkInstanceStateAndAutoToggle();
            applyFilter();
        }, 100);
    });

    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        try { Notification.requestPermission(); } catch (e) {}
    }

    const primeAudio = () => {
        const ctx = getAudioCtx();
        if (ctx && ctx.state === 'suspended') ctx.resume();
        window.removeEventListener('click', primeAudio);
        window.removeEventListener('keydown', primeAudio);
    };
    window.addEventListener('click', primeAudio);
    window.addEventListener('keydown', primeAudio);

    const start = () => {
        if (!document.body) {
            setTimeout(start, 200);
            return;
        }
        observer.observe(document.body, { childList: true, subtree: true });

        const startInInstance = isInInstance();
        lastInstanceState = startInInstance;
        if (startInInstance) filterEnabled = false;

        ensureButton();
        applyFilter();

        setInterval(() => {
            if (checkInstanceStateAndAutoToggle()) {
                applyFilter();
            }
        }, 1000);
    };
    start();

})();