// ==UserScript==
// @name         Outer Empires 2 - Jobs navigation QoL
// @namespace    https://game.dev.outerempires.net/
// @version      0.9.12
// @description  Colors location/system/bounty/tender/survey references in job text for the left Jobs panel and the right Jobs (jobboard) panel. Same placeholder text -> same color across a job. Click a highlight to paste it into that panel's Search box; next click anywhere clears it.
// @match        https://game.dev.outerempires.net/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ---------- CONFIG ----------
    const FAVORITES = [
        'Rimgate UPC Outpost',
        'Cerviarix-Sigma'
    ];
    const AVOID = [
        // 'Some Bad System'
    ];

    const HUE_BUCKETS    = 12;
    const HUE_SATURATION = 70;
    const HUE_LIGHTNESS  = 65;
    // ---------------------------

    (function injectStyle() {
        const style = document.createElement('style');
        style.textContent = `
            .oe-loc           { padding:0 3px; border-radius:3px; font-weight:600; }
            .oe-loc.oe-click  { cursor:pointer; }
            .oe-loc.oe-click:hover { outline:1px solid rgba(255,255,255,0.6); }
            .oe-loc-system    { color:#000; background:#ba68c8; }
            .oe-loc-favorite  { color:#000; background:#f9a825; }
            .oe-loc-avoid     { color:#ffbdbd; text-decoration:line-through; }
            .oe-loc-bounty    { color:#000; background:#ff7043; }
            .oe-loc-here      { color:#000; background:#ffd54f; box-shadow:0 0 0 1px #fff inset; }
        `;
        (document.head || document.documentElement).appendChild(style);
	})(); 

    const LOC_RE    = /([A-Z][\w'-]*(?:\s+[A-Z0-9][\w'-]*)*)\s+\(([^)]+)\)/g;
    const BOUNTY_RE = /\b(?:Bounty|Mission|Target)\s+Location\s+#\d+/g;
    const SYSTEM_RE = /Go to system (.+?) to find target/g;
    const HERE_RE   = /Enter\s+((?:Bounty|Mission|Target)\s+Location\s+(#\d+))\s+to\s+find\s+target/g;

    const NAME_PATTERNS = [
        {
            re: /^\s*(.+?)\s+from\s+(.+?)\s+to\s+(.+?)\s*$/,
            extract(text, m) {
                const src = m[2], dst = m[3];
                const srcStart = text.indexOf(src, text.indexOf(' from ') + 1);
                if (srcStart < 0) return null;
                const srcEnd = srcStart + src.length;
                const toIdx  = text.indexOf(' to ', srcEnd);
                if (toIdx < 0) return null;
                const dstStart = toIdx + 4;
                return [
                    { start: srcStart, end: srcEnd,                text: src, role: 'target'   },
                    { start: dstStart, end: dstStart + dst.length, text: dst, role: 'delivery' }
                ];
            }
        },
        {
            re: /^\s*(.+?)\s+scan\s+to\s+(.+?)\s*$/,
            extract(text, m) {
                const tgt = m[1], dst = m[2];
                const tgtStart = text.indexOf(tgt);
                if (tgtStart < 0) return null;
                const tgtEnd   = tgtStart + tgt.length;
                const scanIdx  = text.indexOf(' scan to ', tgtEnd - 1);
                if (scanIdx < 0) return null;
                const dstStart = scanIdx + ' scan to '.length;
                return [
                    { start: tgtStart, end: tgtEnd,                text: tgt, role: 'target'   },
                    { start: dstStart, end: dstStart + dst.length, text: dst, role: 'delivery' }
                ];
            }
        }
    ];

    const NAME_QUICK_RE = /(\sfrom\s.+\sto\s|\sscan\sto\s)/;

    const SYSTEM_PREFIX = 'Go to system ';
    const HERE_PREFIX   = 'Enter ';
    const DEBUG = false; // flip to true when diagnosing

    // ---- Hash-based color --------------------------------------------------
    function hashStr(s) {
        let h = 5381;
        for (let i = 0; i < s.length; i++) {
            h = ((h << 5) + h) + s.charCodeAt(i);
            h |= 0;
        }
        return h >>> 0;
    }
    function colorForKey(key) {
        const k = (key || '').trim().toLowerCase();
        const hue = (hashStr(k) % HUE_BUCKETS) * (360 / HUE_BUCKETS);
        return `hsl(${hue}, ${HUE_SATURATION}%, ${HUE_LIGHTNESS}%)`;
    }

    // ---- Panels ------------------------------------------------------------
    const LEFT_HEX_SEL  = '#ui_jobs_hex';
    const RIGHT_HEX_SEL = '#ui_jobboard_hex';

    function getLeftHex()  { return document.querySelector(LEFT_HEX_SEL);  }
    function getRightHex() { return document.querySelector(RIGHT_HEX_SEL); }
    function isLeftJobsOpen()  { const h = getLeftHex();  return !!(h && h.classList.contains('active')); }
    function isRightJobsOpen() { const h = getRightHex(); return !!(h && h.classList.contains('active')); }
    function isAnyJobsOpen()   { return isLeftJobsOpen() || isRightJobsOpen(); }

    // Geometric detection (restored): the panel content isn't always a DOM
    // descendant of the hex button, so we use horizontal position instead.
    // We still guard that at least one side is open, and ignore elements with
    // no box (offscreen / display:none).
    function sideFromRect(rect) {
        if (!rect) return null;
        if (rect.width === 0 && rect.height === 0) return null;
        const midX = (rect.left + rect.right) / 2;
        const screenMid = window.innerWidth / 2;
        return midX < screenMid ? 'left' : 'right';
    }

    function elementSide(el) {
        if (!el || !el.getBoundingClientRect) return null;
        return sideFromRect(el.getBoundingClientRect());
    }

    function nodeSide(node) {
        const el = node.nodeType === 1 ? node : node.parentElement;
        return elementSide(el);
    }

    function isInsideActiveJobsPanel(node) {
        const side = nodeSide(node);
        if (side === 'left'  && isLeftJobsOpen())  return true;
        if (side === 'right' && isRightJobsOpen()) return true;
        return false;
    }

    function sideForElement(el) {
        const side = elementSide(el);
        if (side === 'left'  && isLeftJobsOpen())  return 'left';
        if (side === 'right' && isRightJobsOpen()) return 'right';
        return null;
    }

    function classify(full) {
        const lower = full.toLowerCase();
        if (AVOID.some(a => lower.includes(a.toLowerCase())))     return 'oe-loc-avoid';
        if (FAVORITES.some(f => lower.includes(f.toLowerCase()))) return 'oe-loc-favorite';
        return null;
    }

    function collectMatches(text) {
        const hits = [];
        let m;

        LOC_RE.lastIndex = 0;
        while ((m = LOC_RE.exec(text)) !== null) {
            const outer = m[1];
            const inner = m[2];
            const outerStart = m.index;
            const outerEnd   = outerStart + outer.length;

            const openIdx = text.indexOf('(', outerEnd);
            if (openIdx < 0) continue;
            const innerStart = openIdx + 1;
            const innerEnd   = innerStart + inner.length;

            hits.push({ start: outerStart, end: outerEnd, text: outer, key: outer, kind: 'loc-outer' });
            hits.push({ start: innerStart, end: innerEnd, text: inner, key: inner, kind: 'loc-inner' });
        }

        HERE_RE.lastIndex = 0;
        while ((m = HERE_RE.exec(text)) !== null) {
            const inner  = m[1];
            const number = m[2];
            const start  = m.index + HERE_PREFIX.length;
            hits.push({
                start,
                end: start + inner.length,
                text: inner,
                key: inner,
                payload: number,
                kind: 'here'
            });
        }

        BOUNTY_RE.lastIndex = 0;
        while ((m = BOUNTY_RE.exec(text)) !== null) {
            hits.push({ start: m.index, end: m.index + m[0].length, text: m[0], key: m[0], kind: 'bounty' });
        }

        SYSTEM_RE.lastIndex = 0;
        while ((m = SYSTEM_RE.exec(text)) !== null) {
            const name = m[1];
            const start = m.index + SYSTEM_PREFIX.length;
            hits.push({ start, end: start + name.length, text: name, key: name, kind: 'system' });
        }

        const kindRank = {
            here: 0,
            'loc-outer': 1, 'loc-inner': 1, system: 1,
            bounty: 2
        };
        hits.sort((a, b) => a.start - b.start || (kindRank[a.kind] ?? 9) - (kindRank[b.kind] ?? 9));

        const out = [];
        let lastEnd = -1;
        for (const h of hits) {
            if (h.start >= lastEnd) { out.push(h); lastEnd = h.end; }
        }
        return out;
    }

    function searchPayload(hit) {
        if (hit.payload) return hit.payload;
        return hit.text;
    }

    function parseJobName(text) {
        for (const pat of NAME_PATTERNS) {
            const m = pat.re.exec(text);
            if (!m) continue;
            const parts = pat.extract(text, m);
            if (parts && parts.length) return parts;
        }
        return null;
    }

    function buildSpan(text, specialCls, payload, key, clickable) {
        const span = document.createElement('span');
        let cls = 'oe-loc';
        if (specialCls) cls += ' ' + specialCls;
        if (clickable) cls += ' oe-click';
        span.className = cls;
        if (!specialCls) {
            span.style.color = colorForKey(key || text);
        }
        span.textContent = text;
        if (clickable) {
            span.title = `Click to search: ${payload}`;
            span.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                pasteToSearch(payload, span);
            });
        }
        return span;
    }

    // Safe wrapper: if the node was already detached (by React etc.) we bail.
    function safeReplace(oldNode, newNode) {
        try {
            if (!oldNode || !oldNode.parentNode) return false;
            oldNode.parentNode.replaceChild(newNode, oldNode);
            return true;
        } catch (e) {
            return false;
        }
    }

    function highlightJobNameNode(node) {
        if (!node.parentNode) return;
        const text = node.nodeValue;
        const parts = parseJobName(text);
        if (!parts) return;

        parts.sort((a, b) => a.start - b.start);

        const frag = document.createDocumentFragment();
        let cursor = 0;
        for (const p of parts) {
            if (p.start > cursor) {
                frag.appendChild(document.createTextNode(text.slice(cursor, p.start)));
            }
            const specialCls = classify(p.text);
            frag.appendChild(buildSpan(p.text, specialCls, p.text, p.text, true));
            cursor = p.end;
        }
        if (cursor < text.length) {
            frag.appendChild(document.createTextNode(text.slice(cursor)));
        }
        safeReplace(node, frag);
    }

    function highlightTextNode(node) {
        if (!node.parentNode) return;
        if (!isInsideActiveJobsPanel(node)) return;

        if (node.parentNode.closest && node.parentNode.closest('.JobItem_Detail_Name')) {
            highlightJobNameNode(node);
            return;
        }

        const text = node.nodeValue;
        const hits = collectMatches(text);
        if (hits.length === 0) return;

        const frag = document.createDocumentFragment();
        let lastIdx = 0;

        for (const h of hits) {
            if (h.start > lastIdx) {
                frag.appendChild(document.createTextNode(text.slice(lastIdx, h.start)));
            }

            let specialCls = null;
            let clickable = false;

            if (h.kind === 'bounty') {
                specialCls = 'oe-loc-bounty';
                clickable = false;
            } else if (h.kind === 'here') {
                specialCls = 'oe-loc-here';
                clickable = true;
            } else if (h.kind === 'system') {
                specialCls = classify(h.text);
                clickable = true;
            } else if (h.kind === 'loc-outer' || h.kind === 'loc-inner') {
                specialCls = classify(h.text);
                clickable = true;
            }

            const payload = searchPayload(h);
            const span = buildSpan(h.text, specialCls, payload, h.key || h.text, clickable);
            frag.appendChild(span);
            lastIdx = h.end;
        }
        if (lastIdx < text.length) {
            frag.appendChild(document.createTextNode(text.slice(lastIdx)));
        }
        safeReplace(node, frag);
    }

    // ---- Search box --------------------------------------------------------
    function pickVisibleSearchInput(side) {
        const inputs = document.querySelectorAll(
            'input.ColonyTextInputField[placeholder="Search"], input[placeholder="Search"].ColonyTextInputField'
        );
        for (const i of inputs) {
            if (i.offsetParent === null) continue;
            if (side && elementSide(i) !== side) continue;
            return i;
        }
        return null;
    }

    function findSearchInput(originEl) {
        // Derive click X from the highlight span's center.
        let clickX = window.innerWidth / 2;
        if (originEl && originEl.getBoundingClientRect) {
            const r = originEl.getBoundingClientRect();
            clickX = r.left + r.width / 2;
        }
        const vpMid = window.innerWidth / 2;
        const wantLeft = clickX < vpMid;

        const all = [...document.querySelectorAll('input[type="text"], input[type="search"]')];

        const candidates = all.filter(el => {
            if (el.offsetParent === null) return false;                 // hidden
            const r = el.getBoundingClientRect();
            if (r.width < 20 || r.height < 10) return false;            // not really visible
            const ph = (el.placeholder || '').toLowerCase();
            const cls = (el.className || '').toLowerCase();
            if (el.id === 'system-input') return false;                 // exclude system-jump
            return ph.includes('search') || ph.includes('filter') || cls.includes('search');
        });

        if (DEBUG) console.log('[OE-HL] clickX=', Math.round(clickX),
                               'candidates:', candidates.map(e => ({
            ph: e.placeholder, cls: e.className,
            x: Math.round(e.getBoundingClientRect().left)
        })));

        if (!candidates.length) return null;

        // Prefer one whose center is on the same side as the click.
        const sameSide = candidates.filter(el => {
            const r = el.getBoundingClientRect();
            const mid = r.left + r.width / 2;
            return wantLeft ? mid < vpMid : mid >= vpMid;
        });

        const pool = sameSide.length ? sameSide : candidates;

        // Pick the one closest horizontally to the click.
        pool.sort((a, b) => {
            const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
            return Math.abs((ra.left + ra.width / 2) - clickX) -
                Math.abs((rb.left + rb.width / 2) - clickX);
        });

        if (DEBUG) console.log('[OE-HL] picked:', pool[0]);
        return pool[0];
    }

    function nativeSetValue(input, value) {
        const proto = Object.getPrototypeOf(input);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value')
                   || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        if (desc && desc.set) desc.set.call(input, value);
        else input.value = value;
    }

    function fireKey(input, type, key) {
        const init = {
            key, code: key === 'Enter' ? 'Enter' : 'Key' + key.toUpperCase(),
            keyCode: key === 'Enter' ? 13 : key.charCodeAt(0),
            which:   key === 'Enter' ? 13 : key.charCodeAt(0),
            bubbles: true, cancelable: true
        };
        input.dispatchEvent(new KeyboardEvent(type, init));
    }

    function fireInputEvents(input) {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    let lastTargetedInput = null;

    function clearSearch() {
        const candidates = [];
        if (lastTargetedInput && document.contains(lastTargetedInput)) candidates.push(lastTargetedInput);
        if (isLeftJobsOpen()) { const i = pickVisibleSearchInput('left'); if (i) candidates.push(i); }
        if (isRightJobsOpen()) { const i = pickVisibleSearchInput('right'); if (i) candidates.push(i); }

        const seen = new Set();
        for (const input of candidates) {
            if (!input || seen.has(input)) continue;
            seen.add(input);
            if (input.value === '') continue;
            nativeSetValue(input, '');
            fireKey(input, 'keydown', 'Backspace');
            fireInputEvents(input);
            fireKey(input, 'keyup', 'Backspace');
        }
    }

    let pendingClearHandler = null;
    let armedAt = 0;

    function cancelPendingClear() {
        if (pendingClearHandler) {
            document.removeEventListener('click', pendingClearHandler, true);
            pendingClearHandler = null;
        }
    }

    function scheduleClearOnNextClick() {
        cancelPendingClear();
        armedAt = performance.now();
        pendingClearHandler = function (ev) {
            if (ev.button !== 0) return;
            if (performance.now() - armedAt < 50) return;
            if (ev.target && ev.target.closest && ev.target.closest('.oe-loc.oe-click')) {
                return;
            }
            cancelPendingClear();
            setTimeout(clearSearch, 0);
        };
        document.addEventListener('click', pendingClearHandler, true);
    }

    function pasteToSearch(text, originEl) {
        const input = findSearchInput(originEl);
        if (!input) {
            console.warn('[OE Highlighter] Search input not found.');
            return;
        }
        lastTargetedInput = input;

        input.focus();

        nativeSetValue(input, '');
        fireKey(input, 'keydown', 'Backspace');
        fireInputEvents(input);
        fireKey(input, 'keyup', 'Backspace');

        nativeSetValue(input, text);

        const lastChar = text.slice(-1) || 'a';
        fireKey(input, 'keydown', lastChar);
        fireInputEvents(input);
        fireKey(input, 'keyup', lastChar);

        fireKey(input, 'keydown', 'Enter');
        fireKey(input, 'keypress', 'Enter');
        fireKey(input, 'keyup',  'Enter');

        setTimeout(() => {
            if (input.value !== text) return;
            nativeSetValue(input, text + ' ');
            fireKey(input, 'keydown', ' ');
            fireInputEvents(input);
            fireKey(input, 'keyup', ' ');

            nativeSetValue(input, text);
            fireKey(input, 'keydown', 'Backspace');
            fireInputEvents(input);
            fireKey(input, 'keyup', 'Backspace');
        }, 0);

        scheduleClearOnNextClick();
    }

    // ---- Tree walking ------------------------------------------------------
    const SKIP_SELECTOR = 'button, [role="button"], [contenteditable], [contenteditable="true"], script, style, input, textarea, select, option, svg, canvas, .oe-loc';

    function walk(root) {
        if (!root) return;
        if (!isAnyJobsOpen()) return;

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(n) {
                if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
                const p = n.parentNode;
                if (!p || p.nodeType !== 1) return NodeFilter.FILTER_REJECT;
                if (p.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
                if (!isInsideActiveJobsPanel(n)) return NodeFilter.FILTER_REJECT;

                if (p.closest('.JobItem_Detail_Name')) {
                    return NAME_QUICK_RE.test(n.nodeValue)
                        ? NodeFilter.FILTER_ACCEPT
                        : NodeFilter.FILTER_REJECT;
                }

                if (n.nodeValue.length < 5) return NodeFilter.FILTER_REJECT;
                const v = n.nodeValue;
                if (!/\([^)]+\)/.test(v) &&
                    !/Location\s+#\d+/.test(v) &&
                    !/Go to system .+? to find target/.test(v)) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        const nodes = [];
        let cur;
        while ((cur = walker.nextNode())) nodes.push(cur);
        nodes.forEach(highlightTextNode);
    }

    function unwrapAllHighlights() {
        document.querySelectorAll('.oe-loc').forEach(span => {
            try {
                const txt = document.createTextNode(span.textContent);
                if (span.parentNode) span.parentNode.replaceChild(txt, span);
            } catch (e) { /* already gone */ }
        });
    }

    // ---- Activation lifecycle ---------------------------------------------
    let contentObserver = null;
    let active = false;

    // Debounced queue of pending nodes to re-walk.
    const pendingNodes = new Set();
    let rafId = 0;

    function flushPending() {
        rafId = 0;
        if (!active) { pendingNodes.clear(); return; }
        const nodes = Array.from(pendingNodes);
        pendingNodes.clear();
        for (const n of nodes) {
            try {
                if (!n || !n.isConnected) continue;
                if (n.nodeType === 1) walk(n);
                else if (n.nodeType === 3 && n.parentNode) highlightTextNode(n);
            } catch (e) { /* keep going */ }
        }
    }

    function schedule(node) {
        if (!node) return;
        pendingNodes.add(node);
        if (!rafId) rafId = requestAnimationFrame(flushPending);
    }

    function startContentObserver() {
        if (contentObserver) return;
        contentObserver = new MutationObserver(muts => {
            for (const m of muts) {
                if (m.type === 'characterData' && m.target && m.target.parentNode) {
                    schedule(m.target.parentNode);
                    continue;
                }
                m.addedNodes.forEach(n => schedule(n));
            }
        });
        contentObserver.observe(document.body, {
            childList: true, subtree: true, characterData: true
        });
    }

    function stopContentObserver() {
        if (contentObserver) {
            try { contentObserver.disconnect(); } catch (e) {}
            contentObserver = null;
        }
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
        pendingNodes.clear();
    }

    function activate() {
        if (active) return;
        if (!isAnyJobsOpen()) return;
        active = true;
        walk(document.body);
        startContentObserver();
    }

    function deactivate() {
        if (!active) return;
        active = false;
        stopContentObserver();
        cancelPendingClear();
        unwrapAllHighlights();
    }

    function refreshAll() {
        if (!active) return;
        stopContentObserver();
        unwrapAllHighlights();
        walk(document.body);
        startContentObserver();
    }

    function sync() {
        if (isAnyJobsOpen()) {
            if (!active) activate();
            else refreshAll();
        } else {
            deactivate();
        }
    }

    const stateObservers = [];
    function attachStateObserverTo(hex) {
        if (!hex) return false;
        const mo = new MutationObserver(sync);
        mo.observe(hex, { attributes: true, attributeFilter: ['class'] });
        stateObservers.push(mo);
        return true;
    }

    let seenLeft = false;
    let seenRight = false;

    function tryAttach() {
        const left = getLeftHex();
        const right = getRightHex();
        let changed = false;
        if (left && !seenLeft) { attachStateObserverTo(left); seenLeft = true; changed = true; }
        if (right && !seenRight) { attachStateObserverTo(right); seenRight = true; changed = true; }
        if (changed) sync();
        return seenLeft && seenRight;
    }

    if (!tryAttach()) {
        const bootObs = new MutationObserver(() => {
            if (tryAttach()) bootObs.disconnect();
        });
        bootObs.observe(document.body, { childList: true, subtree: true });
        // Safety: stop observing body after 60s even if only one panel exists.
        setTimeout(() => { try { bootObs.disconnect(); } catch (e) {} }, 60000);
    }
})();