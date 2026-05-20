// ==UserScript==
// @name         OE2 Market Alerts
// @namespace    https://game.dev.outerempires.net/
// @version      3.0
// @description  Badge with custom-ship count + chime + click-to-open-market
// @match        https://game.dev.outerempires.net/*
// @match        https://outerempires.net/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// @connect      oe2-api-dev.azure-api.net
// ==/UserScript==

(function () {
  'use strict';

  const API_BASE    = 'https://oe2-api-dev.azure-api.net';
  const MIN_POLL_MS = 180000;   // 3 min
  const MAX_POLL_MS = 540000;   // 9 min
  const TOKEN_KEY   = 'oe2_api_token';
  const CHAR_KEY    = 'oe2_char_id';
  const DEBUG       = true;
  const log         = (...a) => DEBUG && console.log('[OE2]', ...a);

  let lastSiCount = -1;

  // ─── Auth capture ────────────────────────────────────────────────────────────
  const origFetch = unsafeWindow.fetch;
  unsafeWindow.fetch = function (...args) {
    const r = origFetch.apply(this, arguments);
    r.then(() => {
      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
        if (!url?.includes('oe2-api-dev.azure-api.net')) return;
        const h = args[1]?.headers || {};
        const auth = h.Authorization || h.authorization;
        if (auth) GM_setValue(TOKEN_KEY, auth);
        const m = url.match(/characterId=(\d+)/);
        if (m) GM_setValue(CHAR_KEY, m[1]);
      } catch {}
    });
    return r;
  };

  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, url) { this._u = url; return _open.apply(this, arguments); };
  const _setH = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    if (k.toLowerCase() === 'authorization' && this._u?.includes('oe2-api-dev.azure-api.net')) {
      GM_setValue(TOKEN_KEY, v);
      const m = this._u.match(/characterId=(\d+)/);
      if (m) GM_setValue(CHAR_KEY, m[1]);
    }
    return _setH.apply(this, arguments);
  };

  function tok() { return GM_getValue(TOKEN_KEY, ''); }
  function cid() { return GM_getValue(CHAR_KEY, ''); }

  // ─── Audio ───────────────────────────────────────────────────────────────────
  let audioCtx = null;
  function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }
  document.addEventListener('click', initAudio, { once: true });
  document.addEventListener('keydown', initAudio, { once: true });

  function chime() {
    try {
      initAudio();
      const now = audioCtx.currentTime;
      [523.25, 659.25, 783.99].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.25, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.3);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.3);
      });
    } catch {}
  }

  // ─── FAB with badge ──────────────────────────────────────────────────────────
  let fab = null;
  let badge = null;

  function ensureFab() {
    if (fab) return;
    fab = document.createElement('div');
    fab.id = 'oe2-fab';
    fab.textContent = '🛒';
    Object.assign(fab.style, {
      position: 'fixed', bottom: '90px', right: '16px', width: '48px', height: '48px',
      background: 'rgba(10,20,36,0.92)', border: '1px solid #3a6ea8', borderRadius: '50%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', zIndex: '999997', fontSize: '20px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.6)',
      transition: 'transform 0.15s',
    });
    fab.onmouseenter = () => { fab.style.transform = 'scale(1.08)'; };
    fab.onmouseleave = () => { fab.style.transform = 'scale(1)'; };
    fab.onclick = () => {
      const marketBtn = document.querySelector('[data-ui-tooltip="MAINMENU.MARKET"], .market-button, [href*="market"], [data-view="market"]');
      if (marketBtn) marketBtn.click();
      let tries = 0;
      const wait = setInterval(() => {
        const sel = document.querySelector('#MarketFilterOption_Input_Type');
        if (sel) {
          sel.value = 'Si';
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          // subtype: All
          const sub = document.querySelector('#MarketFilterOption_Input_Type_SubType');
          if (sub) { sub.value = ''; sub.dispatchEvent(new Event('change', { bubbles: true })); }
          // range: Whole Market
          const range = document.querySelector('#MarketFilterOption_Input_Range');
          if (range) { range.value = '200000'; range.dispatchEvent(new Event('change', { bubbles: true })); }
          // SpWorthy toggle OFF
          const sp = document.querySelector('#MarketFilterOption_Input_SpaceWorthy');
          if (sp && sp.classList.contains('ui_icon_toggle')) sp.click();
          // Licensed toggle OFF
          const lic = document.querySelector('#MarketFilterOption_Input_Licensed');
          if (lic && lic.classList.contains('ui_icon_toggle')) lic.click();
          clearInterval(wait);
          showToast('Custom Ships — All types, Whole Market');
        }
        if (++tries > 50) clearInterval(wait);
      }, 100);
    };

    badge = document.createElement('div');
    badge.id = 'oe2-badge';
    badge.textContent = '';
    Object.assign(badge.style, {
      position: 'absolute', top: '-4px', right: '-4px',
      minWidth: '20px', height: '20px',
      background: '#ff3b30', color: 'white', borderRadius: '10px',
      fontSize: '11px', fontWeight: 'bold', fontFamily: 'sans-serif',
      display: 'none', alignItems: 'center', justifyContent: 'center',
      padding: '0 5px', boxSizing: 'border-box',
      border: '2px solid rgba(10,20,36,0.92)',
    });

    fab.appendChild(badge);
    document.body.appendChild(fab);
  }

  function setBadge(n) {
    ensureFab();
    if (n > 0) {
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  // ─── API call ────────────────────────────────────────────────────────────────
  function pollCustom() {
    const token = tok(), charId = cid();
    if (!token || !charId) return;

    GM_xmlhttpRequest({
      method: 'GET',
      url: `${API_BASE}/v1/market?characterId=${charId}&locationId=0&range=200000&view=All&searchString=&type=Si&subType=&evolution=-1`,
      headers: { Authorization: token, Accept: 'application/json' },
      onload: (resp) => {
        try {
          const json = JSON.parse(resp.responseText);
          const list = json.data?.shipMarketListings;
          const count = list ? list.length : 0;
          ensureFab();

          if (count !== lastSiCount) {
            lastSiCount = count;
            setBadge(count);
            if (count > 0) chime();
            if (count > 0) {
              showToast(`🛒 ${count} custom ship${count > 1 ? 's' : ''} for sale`);
            }
            log(`Custom ships: ${count}`);
          }
        } catch (e) { log('Parse:', e); }
      },
      onerror: (e) => log('Fail:', e),
    });

    // schedule next poll randomly between MIN and MAX
    const next = MIN_POLL_MS + Math.random() * (MAX_POLL_MS - MIN_POLL_MS);
    setTimeout(pollCustom, next);
  }

  // ─── Toast ───────────────────────────────────────────────────────────────────
  function showToast(msg) {
    const old = document.getElementById('oe2-toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.id = 'oe2-toast';
    t.textContent = msg;
    Object.assign(t.style, {
      position: 'fixed', bottom: '24px', right: '70px',
      background: 'rgba(10,20,36,0.94)', color: '#7ecfff',
      border: '1px solid #3a6ea8', borderRadius: '6px',
      padding: '8px 14px', fontSize: '13px', fontFamily: 'monospace',
      zIndex: '999999', boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
      maxWidth: '360px', whiteSpace: 'pre-line',
      transition: 'opacity 0.4s', opacity: '1', pointerEvents: 'none',
    });
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; }, 4000);
    setTimeout(() => { t.remove(); }, 4400);
  }

  // ─── Bootstrap ───────────────────────────────────────────────────────────────
  // wait for token to be captured, then start
  let waitCount = 0;
  const waitInterval = setInterval(() => {
    ensureFab();
    if (tok() && cid()) {
      clearInterval(waitInterval);
      log('Token captured, starting polls');
      // initial poll right away
      pollCustom();
      return;
    }
    waitCount++;
    if (waitCount > 30) {
      clearInterval(waitInterval);
      showToast('⚠ OE2 Alerts: no API token captured — browse the market once');
    }
  }, 2000);

  log('Loaded');
})();
