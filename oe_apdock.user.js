// ==UserScript==
// @name         Outer Empires – AP+Dock / AP+Warp Button
// @namespace    https://game.dev.outerempires.net/
// @version      2.1.0
// @description  Adds "AP+Dock" and "AP+Warp" buttons next to Auto Pilot. AP+Dock docks at a station on arrival; AP+Warp warps to the first job location.
// @author       You
// @match        https://game.dev.outerempires.net/*
// @match        https://outerempires.net/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ─── Config ────────────────────────────────────────────────────────────────
  const DOCK_DELAY_MS      = 1500;
  const WARP_DELAY_MS      = 1500;
  const STATION_KEYWORDS   = ['station', 'outpost', 'platform', 'depot', 'hub'];
  const JOB_KEYWORDS       = ['sec-contract', 'bounty', 'contract', 'mission'];
  const DEBUG              = false;
  // ───────────────────────────────────────────────────────────────────────────

  const log = (...a) => DEBUG && console.log('[AP+Warp]', ...a);

  let dockOnNextArrival = false;
  let warpOnNextArrival = false;
  let lastArrivalState  = false;
  let lastApEngaged     = false;
  let dockTimeout       = null;
  let warpTimeout       = null;

  // ── Button injection ─────────────────────────────────────────────────────────

  function injectButton() {
    if (document.getElementById('apdock-btn') && document.getElementById('apwarp-btn')) return;

    const actionsBar = document.querySelector('.system-info-actions');
    if (!actionsBar) return;

    const apBtn = actionsBar.querySelector('.system-auto-route-btn');
    if (!apBtn) return;

    // ── AP+Dock ──
    if (!document.getElementById('apdock-btn')) {
      const dockBtn = apBtn.cloneNode(true);
      dockBtn.id = 'apdock-btn';
      dockBtn.textContent = 'AP+Dock';
      actionsBar.insertBefore(dockBtn, apBtn);
      dockBtn.style.marginRight = '4px';

      dockBtn.addEventListener('click', () => {
        log('AP+Dock clicked — arming dock-on-arrival');
        dockOnNextArrival = true;
        warpOnNextArrival = false;
        lastArrivalState = false;
        dockBtn.textContent = 'AP+Dock ⚓';
        dockBtn.style.opacity = '0.7';
        resetBtn('apwarp-btn');
        apBtn.click();
      });
      log('AP+Dock button injected.');
    }

    // ── AP+Warp ──
    if (!document.getElementById('apwarp-btn')) {
      const warpBtn = apBtn.cloneNode(true);
      warpBtn.id = 'apwarp-btn';
      warpBtn.textContent = 'AP+Warp';
      actionsBar.insertBefore(warpBtn, apBtn);
      warpBtn.style.marginRight = '4px';

      warpBtn.addEventListener('click', () => {
        log('AP+Warp clicked — arming warp-on-arrival');
        warpOnNextArrival = true;
        dockOnNextArrival = false;
        lastArrivalState = false;
        warpBtn.textContent = 'AP+Warp ⚓';
        warpBtn.style.opacity = '0.7';
        resetBtn('apdock-btn');
        apBtn.click();
      });
      log('AP+Warp button injected.');
    }

    // Ensure the gap between our buttons and the original AP button
    apBtn.style.marginLeft = '4px';
  }

  function resetBtn(id) {
    const btn = document.getElementById(id);
    if (btn) { btn.textContent = id === 'apdock-btn' ? 'AP+Dock' : 'AP+Warp'; btn.style.opacity = '1'; }
  }

  // ── Arrival detection ────────────────────────────────────────────────────────

  function hasArrived() {
    for (const el of document.querySelectorAll('.route-complete-message')) {
      if (el.textContent.trim().toLowerCase().includes('arrived at destination')) return true;
    }
    return false;
  }

  // ── Docking logic ────────────────────────────────────────────────────────────

  function isStation(nameEl) {
    const name = nameEl.textContent.trim().toLowerCase();
    return STATION_KEYWORDS.some(kw => name.includes(kw));
  }

  function findDockButton(nameEl) {
    let node = nameEl;
    for (let i = 0; i < 6; i++) {
      node = node.parentElement;
      if (!node) break;
      const dock = node.querySelector('.ui_icon_dock');
      if (dock) return dock;
    }
    return null;
  }

  function tryDock() {
    log('Scanning for orbital stations…');
    const nameEls = document.querySelectorAll('.SystemExplorer_ObjectName');
    for (const nameEl of nameEls) {
      if (!isStation(nameEl)) continue;
      const stationName = nameEl.textContent.trim();
      log(`Station: "${stationName}"`);
      const dockBtn = findDockButton(nameEl);
      if (dockBtn) {
        log(`Docking at "${stationName}"`);
        dockBtn.click();
        showToast(`⚓ Auto-docked at ${stationName}`);
        resetBtn('apdock-btn');
        return;
      }
    }
    log('No dock-able station found.');
    showToast('⚠ Arrived – no dockable station found');
    resetBtn('apdock-btn');
  }

  // ── Warp logic ───────────────────────────────────────────────────────────────

  function isJobNavMarker(itemEl) {
    const nameEl = itemEl.querySelector('.SystemExplorer_ObjectName');
    if (!nameEl) return false;
    const name = nameEl.textContent.trim().toLowerCase();
    return JOB_KEYWORDS.some(kw => name.includes(kw));
  }

  function getJobName(itemEl) {
    const nameEl = itemEl.querySelector('.SystemExplorer_ObjectName');
    return nameEl ? nameEl.textContent.trim() : 'Unknown Job';
  }

  function findMoveToButton(itemEl) {
    return itemEl.querySelector('.ui_icon_moveto');
  }

  function tryWarp() {
    log('Scanning for job nav markers…');
    const items = document.querySelectorAll('#SystemExplorer_NavMarkers_Expanded .SystemExplorer_Item');
    log(`Found ${items.length} nav markers.`);
    for (const item of items) {
      if (!isJobNavMarker(item)) continue;
      const jobName = getJobName(item);
      log(`Job found: "${jobName}"`);
      const moveto = findMoveToButton(item);
      if (moveto) {
        log(`Warping to "${jobName}"`);
        moveto.click();
        showToast(`⚓ Warped to ${jobName}`);
        resetBtn('apwarp-btn');
        return;
      }
    }
    log('No warp-able job found in nav markers.');
    showToast('⚠ Arrived – no job nav marker found');
    resetBtn('apwarp-btn');
  }

  // ── Auto-close hex tabs when AP engaged ──────────────────────────────────

  function closeHexTabs() {
    const apEngaged = !!document.querySelector('.route-stop-btn');

    if (apEngaged && !lastApEngaged) {
      const closeBtn = document.getElementById('ui_hex_left_close');
      if (closeBtn && closeBtn.style.display !== 'none') { closeBtn.click(); }

      const galaxyHex = document.getElementById('ui_galaxy_hex');
      if (galaxyHex && galaxyHex.classList.contains('galaxy_map_open')) { galaxyHex.click(); }

      const soeHex = document.getElementById('ui_soe_hex');
      if (soeHex && soeHex.classList.contains('active')) { soeHex.click(); }
    }

    lastApEngaged = apEngaged;
  }

  // ── Polling ──────────────────────────────────────────────────────────────────

  function poll() {
    injectButton();
    closeHexTabs();

    const arrived = hasArrived();

    if (arrived && !lastArrivalState) {
      log('Arrived at destination – scheduling action');
      lastArrivalState = true;

      if (dockOnNextArrival) {
        if (dockTimeout) clearTimeout(dockTimeout);
        dockTimeout = setTimeout(() => { tryDock(); dockTimeout = null; }, DOCK_DELAY_MS);
      }

      if (warpOnNextArrival) {
        if (warpTimeout) clearTimeout(warpTimeout);
        warpTimeout = setTimeout(() => { tryWarp(); warpTimeout = null; }, WARP_DELAY_MS);
      }
    }

    if (!arrived && lastArrivalState) {
      lastArrivalState = false;
    }
  }

  // ── Toast ────────────────────────────────────────────────────────────────────

  function showToast(msg) {
    const old = document.getElementById('apdock-toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.id = 'apdock-toast';
    t.textContent = msg;
    Object.assign(t.style, {
      position: 'fixed', bottom: '24px', right: '24px',
      background: 'rgba(20,30,48,0.92)', color: '#7ecfff',
      border: '1px solid #3a6ea8', borderRadius: '6px',
      padding: '10px 18px', fontSize: '13px', fontFamily: 'monospace',
      zIndex: '999999', boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
      transition: 'opacity 0.4s ease', opacity: '1', pointerEvents: 'none',
    });
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; }, 3500);
    setTimeout(() => { t.remove(); }, 3900);
  }

  // ── Bootstrap ────────────────────────────────────────────────────────────────

  const observer = new MutationObserver(poll);
  observer.observe(document.body, { childList: true, subtree: true });
  setInterval(poll, 800);

  log('Script loaded.');
})();
