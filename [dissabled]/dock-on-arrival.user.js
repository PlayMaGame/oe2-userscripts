// ==UserScript==
// @name         Outer Empires – AP+Dock Button
// @namespace    https://game.dev.outerempires.net/
// @version      2.0.0
// @description  Adds an "AP+Dock" button next to Auto Pilot. Clicking it starts autopilot AND auto-docks at a station on arrival.
// @author       You
// @match        https://game.dev.outerempires.net/*
// @match        https://outerempires.net/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ─── Config ────────────────────────────────────────────────────────────────
  const DOCK_DELAY_MS    = 1500;  // ms to wait after arrival before scanning
  const STATION_KEYWORDS = ['station', 'outpost', 'platform', 'depot', 'hub'];
  const DEBUG            = false;
  // ───────────────────────────────────────────────────────────────────────────

  const log = (...a) => DEBUG && console.log('[AP+Dock]', ...a);

  let dockOnNextArrival = false;
  let lastArrivalState  = false;
  let dockTimeout       = null;

  // ── Button injection ─────────────────────────────────────────────────────────

  function injectButton() {
    // Don't double-inject
    if (document.getElementById('apdock-btn')) return;

    const actionsBar = document.querySelector('.system-info-actions');
    if (!actionsBar) return;

    const apBtn = actionsBar.querySelector('.system-auto-route-btn');
    if (!apBtn) return;

    // Clone the exact Auto Pilot button so we inherit all its live styles
    const apDockBtn = apBtn.cloneNode(true);
    apDockBtn.id        = 'apdock-btn';
    apDockBtn.textContent = 'AP+Dock';

    // Insert to the LEFT of Auto Pilot
    actionsBar.insertBefore(apDockBtn, apBtn);

    // Small gap between the two buttons — matches game spacing
    apDockBtn.style.marginRight = '4px';

    apDockBtn.addEventListener('click', () => {
      log('AP+Dock clicked — arming dock-on-arrival');
      dockOnNextArrival = true;
      lastArrivalState  = false; // reset so edge fires fresh

      // Visually indicate it's armed
      apDockBtn.textContent = 'AP+Dock ⚓';
      apDockBtn.style.opacity = '0.7';

      // Trigger Auto Pilot exactly as the game does
      apBtn.click();
    });

    log('AP+Dock button injected.');
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
        resetApDockBtn();
        return;
      }
    }
    log('No dock-able station found.');
    showToast('⚠ Arrived – no dockable station found');
    resetApDockBtn();
  }

  function resetApDockBtn() {
    const btn = document.getElementById('apdock-btn');
    if (btn) { btn.textContent = 'AP+Dock'; btn.style.opacity = '1'; }
    dockOnNextArrival = false;
  }

  // ── Polling ──────────────────────────────────────────────────────────────────

  function poll() {
    // Always try to inject (panel may have been re-rendered by the game)
    injectButton();

    if (!dockOnNextArrival) return;

    const arrived = hasArrived();

    if (arrived && !lastArrivalState) {
      log('Arrived at destination – scheduling dock attempt');
      lastArrivalState = true;
      if (dockTimeout) clearTimeout(dockTimeout);
      dockTimeout = setTimeout(() => { tryDock(); dockTimeout = null; }, DOCK_DELAY_MS);
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
      position:'fixed', bottom:'24px', right:'24px',
      background:'rgba(20,30,48,0.92)', color:'#7ecfff',
      border:'1px solid #3a6ea8', borderRadius:'6px',
      padding:'10px 18px', fontSize:'13px', fontFamily:'monospace',
      zIndex:'999999', boxShadow:'0 4px 16px rgba(0,0,0,0.5)',
      transition:'opacity 0.4s ease', opacity:'1', pointerEvents:'none',
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