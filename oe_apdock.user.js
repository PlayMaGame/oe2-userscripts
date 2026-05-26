// ==UserScript==
// @name         Outer Empires – AP+Dock / AP+Warp Button
// @namespace    https://game.dev.outerempires.net/
// @version      2.4.0
// @description  Adds "AP+Dock" and "AP+Warp" buttons next to Auto Pilot. AP+Dock docks at the only station on arrival; AP+Warp warps to the specific job whose map icon you clicked. State persisted across refreshes.
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
  const JOB_KEYWORDS       = ['sec-contract', 'bounty', 'contract', 'mission'];
  const DEBUG              = false;
  // ───────────────────────────────────────────────────────────────────────────

  const log = (...a) => DEBUG && console.log('[AP+Warp]', ...a);

  const LS_DOCK    = 'oe_apdock_dock';
  const LS_WARP    = 'oe_apdock_warp';
  const LS_JOB_REF = 'oe_apdock_jobRef';

  let dockOnNextArrival = localStorage.getItem(LS_DOCK) === 'true';
  let warpOnNextArrival = localStorage.getItem(LS_WARP) === 'true';
  let selectedJobRef    = localStorage.getItem(LS_JOB_REF) || '';
  let lastArrivalState  = false;
  let lastApEngaged     = false;
  let apEngagedOnce     = false;
  let dockTimeout       = null;
  let warpTimeout       = null;
  let pendingLocUpdate  = null;

  function saveState() {
    localStorage.setItem(LS_DOCK, dockOnNextArrival);
    localStorage.setItem(LS_WARP, warpOnNextArrival);
    localStorage.setItem(LS_JOB_REF, selectedJobRef);
  }

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
        selectedJobRef = '';
        lastArrivalState = false;
        saveState();
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
        saveState();
        warpBtn.textContent = 'AP+Warp ⚓';
        warpBtn.style.opacity = '0.7';
        resetBtn('apdock-btn');
        apBtn.click();
      });
      log('AP+Warp button injected.');
    }

    // Restore button visuals from persisted state
    applyPersistedState();

    // Ensure the gap between our buttons and the original AP button
    apBtn.style.marginLeft = '4px';
  }

  function applyPersistedState() {
    const dockBtn = document.getElementById('apdock-btn');
    const warpBtn = document.getElementById('apwarp-btn');
    if (!dockBtn && !warpBtn) return;
    if (dockOnNextArrival && dockBtn) {
      dockBtn.textContent = 'AP+Dock ⚓';
      dockBtn.style.opacity = '0.7';
    } else if (dockBtn) {
      dockBtn.textContent = 'AP+Dock';
      dockBtn.style.opacity = '1';
    }
    if (warpOnNextArrival && warpBtn) {
      warpBtn.textContent = 'AP+Warp ⚓';
      warpBtn.style.opacity = '0.7';
    } else if (warpBtn) {
      warpBtn.textContent = 'AP+Warp';
      warpBtn.style.opacity = '1';
    }
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

  function findStationName(dockEl) {
    let node = dockEl.parentElement;
    for (let i = 0; i < 8; i++) {
      if (!node) break;
      const nameEl = node.querySelector('.SystemExplorer_ObjectName');
      if (nameEl) return nameEl.textContent.trim();
      node = node.parentElement;
    }
    return null;
  }

  function tryDock() {
    log('Scanning for dock buttons…');
    const dockEls = [...document.querySelectorAll('.ui_icon_dock')].filter(
      el => el.getAttribute('data-ui-tooltip') !== 'ICONS.LAND'
    );

    const stations = [];
    for (const dockEl of dockEls) {
      const name = findStationName(dockEl);
      stations.push({ name: name || 'Unknown', btn: dockEl });
    }

    if (stations.length === 0) {
      log('No dock-able station found.');
      showToast('⚠ Arrived – no dockable station found');
      resetBtn('apdock-btn');
      dockOnNextArrival = false;
      saveState();
      return;
    }

    if (stations.length === 1) {
      const s = stations[0];
      log(`Docking at "${s.name}"`);
      s.btn.click();
      showToast(`⚓ Auto-docked at ${s.name}`);
      resetBtn('apdock-btn');
      dockOnNextArrival = false;
      saveState();
      return;
    }

    log(`${stations.length} stations found – skipping auto-dock.`);
    showToast(`⚠ ${stations.length} stations – auto-dock skipped, pick manually`);
    resetBtn('apdock-btn');
    dockOnNextArrival = false;
    saveState();
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

    // If we have a specific job ref stored, try to match it
    if (selectedJobRef) {
      const target = selectedJobRef.toLowerCase();
      log(`Looking for nav marker matching "${selectedJobRef}"…`);
      for (const item of items) {
        const nameEl = item.querySelector('.SystemExplorer_ObjectName');
        if (!nameEl) continue;
        const name = nameEl.textContent.trim();
        if (name.toLowerCase().includes(target)) {
          const moveto = findMoveToButton(item);
          if (moveto) {
            log(`Warping to matching job: "${name}"`);
            moveto.click();
            showToast(`⚓ Warped to ${name}`);
            resetBtn('apwarp-btn');
            warpOnNextArrival = false;
            selectedJobRef = '';
            saveState();
            return;
          }
        }
      }
      log(`No nav marker matched "${selectedJobRef}" – falling back to keyword search.`);
    }

    // Fallback: find by keywords
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
        warpOnNextArrival = false;
        selectedJobRef = '';
        saveState();
        return;
      }
    }
    log('No warp-able job found in nav markers.');
    showToast('⚠ Arrived – no job nav marker found');
    resetBtn('apwarp-btn');
    warpOnNextArrival = false;
    selectedJobRef = '';
    saveState();
  }

  // ── Accepted jobs location tracking ───────────────────────────────────────

  function setupAcceptedJobsInterceptor() {
    document.addEventListener('click', (e) => {
      const mapIcon = e.target.closest('.ui_icon_map_acceptedjobs');
      if (!mapIcon) { return; }

      // Store the bounty ref from this job for AP+Warp targeting
      const jobItem = mapIcon.closest('.JobItem');
      if (jobItem) {
        const refEl = jobItem.querySelector('.JobItem_Short_Detail');
        if (refEl) {
          selectedJobRef = refEl.textContent.trim();
          saveState();
          log(`Stored job ref for warp targeting: ${selectedJobRef}`);
        }
      }

      // ── existing loc-rename tracking ──
      let container = mapIcon.parentElement;
      let locEl = container ? container.querySelector('.oe-loc.oe-click') : null;
      for (let i = 0; i < 8 && !locEl && container; i++) {
        container = container.parentElement;
        if (container) { locEl = container.querySelector('.oe-loc.oe-click'); }
      }
      if (!locEl) { return; }

      const text = container.textContent;
      const idMatch = text.match(/#(\d+)/);
      if (!idMatch) { return; }

      pendingLocUpdate = {
        element: locEl,
        originalText: locEl.textContent.trim(),
        jobLabel: `#${idMatch[1]}`,
      };
      log(`Tracking: "${locEl.textContent.trim()}" -> ${pendingLocUpdate.jobLabel}`);
    });
  }

  function checkPendingLocUpdate() {
    if (!pendingLocUpdate) { return; }
    const { element, originalText, jobLabel } = pendingLocUpdate;
    if (document.contains(element)) {
      element.textContent = jobLabel;
      element.title = originalText;
      element.style.color = '#ffcc00';
      showToast(`📍 ${originalText} → ${jobLabel}`);
    }
    pendingLocUpdate = null;
  }

  // ── Auto-close hex tabs when AP engaged ──────────────────────────────────

  function closeHexTabs() {
    const apEngaged = !!document.querySelector('.route-stop-btn');

    if (apEngaged && !lastApEngaged) {
      apEngagedOnce = true;
      const closeBtn = document.getElementById('ui_hex_left_close');
      if (closeBtn && closeBtn.style.display !== 'none') { closeBtn.click(); }

      const galaxyHex = document.getElementById('ui_galaxy_hex');
      if (galaxyHex && galaxyHex.classList.contains('galaxy_map_open')) { galaxyHex.click(); }


    }

    lastApEngaged = apEngaged;
  }

  // ── Polling ──────────────────────────────────────────────────────────────────

  function poll() {
    injectButton();
    closeHexTabs();

    const arrived = hasArrived() && apEngagedOnce && !document.querySelector('.route-stop-btn');

    if (arrived && !lastArrivalState) {
      log('Arrived at destination – scheduling action');
      apEngagedOnce = false;
      lastArrivalState = true;

      if (dockOnNextArrival) {
        if (dockTimeout) clearTimeout(dockTimeout);
        dockTimeout = setTimeout(() => { tryDock(); dockTimeout = null; }, DOCK_DELAY_MS);
      }

      if (warpOnNextArrival) {
        if (warpTimeout) clearTimeout(warpTimeout);
        warpTimeout = setTimeout(() => { tryWarp(); warpTimeout = null; }, WARP_DELAY_MS);
      }

      checkPendingLocUpdate();
    }

    if (!arrived && lastArrivalState) {
      apEngagedOnce = false;
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

  setupAcceptedJobsInterceptor();

  const observer = new MutationObserver(poll);
  observer.observe(document.body, { childList: true, subtree: true });
  setInterval(poll, 800);

  log('Script loaded. Persisted state:', { dock: dockOnNextArrival, warp: warpOnNextArrival });
})();
