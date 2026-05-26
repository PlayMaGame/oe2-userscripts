// ==UserScript==
// @name         S.T.A.R.S. R.E.L.A.Y. Survey Assistant
// @namespace    stars-relay-oe2
// @version      1.1.0
// @description  Survey/scanning assistant for Outer Empires 2. Player-controlled only. Character Lock Edition.
// @author       S.T.A.R.S.
// @match        https://game.dev.outerempires.net/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict'

  const API = 'https://oe2-api-dev.azure-api.net/v1'

  const IDS = {
    overlay: 'starsRelayOverlay',
    panel: 'starsRelayPanel',
    styles: 'starsRelayStyles',
    importInput: 'starsRelayImportInput'
  }

  const STORAGE = {
    settings: 'starsRelaySettingsV5',
    history: 'starsRelayHistoryV5',
    character: 'starsRelayLockedCharacterV110'
  }

  const SELECTORS = {
    explorerRow: '.SystemExplorer_Item',
    explorerName: '.SystemExplorer_ObjectName',
    scanIcon: '.ui_icon_scan'
  }

  const THEMES = {
    relay: {
      name: 'R.E.L.A.Y.',
      accent: '#00ff99',
      accentSoft: 'rgba(0,255,153,.16)',
      panelBg: 'rgba(0,0,0,.91)',
      text: '#d7fff0',
      muted: '#8aa89b',
      ready: '#ffe066',
      error: '#ff5555',
      border: 'rgba(0,255,153,.55)'
    },
    amber: {
      name: 'Amber',
      accent: '#ffbf3c',
      accentSoft: 'rgba(255,191,60,.16)',
      panelBg: 'rgba(8,6,0,.92)',
      text: '#fff3d0',
      muted: '#b59b62',
      ready: '#00ff99',
      error: '#ff5555',
      border: 'rgba(255,191,60,.55)'
    },
    blue: {
      name: 'Long-Range Blue',
      accent: '#55ccff',
      accentSoft: 'rgba(85,204,255,.16)',
      panelBg: 'rgba(0,8,14,.92)',
      text: '#d8f5ff',
      muted: '#7fa8b6',
      ready: '#ffe066',
      error: '#ff5555',
      border: 'rgba(85,204,255,.55)'
    },
    red: {
      name: 'Rescue Red',
      accent: '#ff5c5c',
      accentSoft: 'rgba(255,92,92,.16)',
      panelBg: 'rgba(12,0,0,.92)',
      text: '#ffe2e2',
      muted: '#b98686',
      ready: '#ffe066',
      error: '#ff3333',
      border: 'rgba(255,92,92,.55)'
    }
  }

  const DEFAULTS = {
    enabled: true,
    compact: false,
    nearestFirst: true,
    showPanel: true,
    altHotkeys: false,
    theme: 'relay',
    panelX: 12,
    panelY: 120
  }

  let settings = {
    ...DEFAULTS,
    ...safeJson(localStorage.getItem(STORAGE.settings), {})
  }

  let history = []
  let currentHistoryCharacterId = null
  let scanTargets = []
  let lastData = null
  let apiCache = null
  let lastApiAt = 0
  let busy = false
  let lastHotkey = 0
  let previousCargoByPlanet = null

  function safeJson(text, fallback) {
    try {
      return JSON.parse(text || '')
    } catch {
      return fallback
    }
  }

  function saveSettings() {
    localStorage.setItem(STORAGE.settings, JSON.stringify(settings))
  }

  function currentToken() {
    return localStorage.getItem('userToken') || ''
  }

  function tokenKey() {
    const token = currentToken()
    return token ? token.slice(0, 10) + ':' + token.slice(-24) : 'no-token'
  }

  function headers() {
    const token = currentToken()

    return {
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    }
  }

  async function api(path) {
    const res = await fetch(`${API}${path}`, {
      headers: headers()
    })

    if (!res.ok) throw new Error(`${res.status} ${path}`)

    return res.json()
  }

  function clean(text) {
    return (text || '').replace(/\s+/g, ' ').trim()
  }

  function esc(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function cssEsc(text) {
    return window.CSS?.escape
      ? CSS.escape(String(text))
      : String(text).replace(/"/g, '\\"')
  }

  function theme() {
    return THEMES[settings.theme] || THEMES.relay
  }

  function injectStyles() {
    if (document.getElementById(IDS.styles)) return

    const style = document.createElement('style')
    style.id = IDS.styles

    style.textContent = `
      #${IDS.panel} { backdrop-filter: blur(4px); }
      #${IDS.panel} button {
        background: rgba(0,0,0,.55);
        color: var(--sr-text);
        border: 1px solid var(--sr-border);
        border-radius: 4px;
        padding: 3px 6px;
        font-size: 11px;
        margin: 2px;
        cursor: pointer;
      }
      #${IDS.panel} button:hover {
        background: var(--sr-soft);
        color: var(--sr-accent);
      }
      .sr-title {
        font-weight: 800;
        cursor: move;
        font-size: 13px;
        letter-spacing: .3px;
      }
      .sr-subtitle {
        font-size: 10px;
        color: var(--sr-text);
        margin: 2px 0 7px;
        line-height: 12px;
        opacity: .9;
      }
      .sr-summary {
        border: 1px solid var(--sr-border);
        background: var(--sr-soft);
        padding: 5px;
        border-radius: 5px;
        margin-bottom: 6px;
        color: var(--sr-text);
      }
      .sr-character {
        color: var(--sr-ready);
        font-weight: 700;
        margin-bottom: 6px;
      }
      .sr-section-title {
        color: var(--sr-text);
        font-weight: 700;
        margin: 7px 0 3px;
      }
      .sr-line {
        margin: 4px 0;
        padding: 5px;
        border-radius: 5px;
        border: 1px solid rgba(255,255,255,.12);
        background: rgba(0,0,0,.28);
        color: var(--sr-text);
        font-size: 11px;
        line-height: 14px;
      }
      .sr-line-next {
        border-color: var(--sr-ready);
        background: rgba(255,224,102,.12);
      }
      .sr-line-ready {
        color: var(--sr-ready);
        border-color: rgba(255,224,102,.5);
      }
      .sr-line-muted {
        color: var(--sr-muted);
      }
      .sr-history {
        color: var(--sr-muted);
        font-size: 11px;
        line-height: 14px;
      }
      .sr-small {
        font-size: 10px;
        color: var(--sr-muted);
      }
      .sr-divider {
        border: 0;
        border-top: 1px solid var(--sr-border);
        margin: 7px 0;
      }
      .sr-flag {
        position: fixed;
        font-weight: 800;
        line-height: 14px;
        background: rgba(0,0,0,.80);
        border: 1px solid var(--sr-accent);
        color: var(--sr-accent);
        border-radius: 4px;
        text-shadow: 1px 1px 2px #000;
        pointer-events: auto;
        cursor: pointer;
        user-select: none;
        white-space: nowrap;
        box-shadow: 0 0 6px rgba(0,0,0,.65);
      }
      .sr-flag-next {
        color: var(--sr-ready);
        border-color: var(--sr-ready);
        background: rgba(0,0,0,.88);
      }
    `

    document.head.appendChild(style)
  }

  function applyTheme() {
    injectStyles()

    const t = theme()

    document.documentElement.style.setProperty('--sr-accent', t.accent)
    document.documentElement.style.setProperty('--sr-soft', t.accentSoft)
    document.documentElement.style.setProperty('--sr-panel-bg', t.panelBg)
    document.documentElement.style.setProperty('--sr-text', t.text)
    document.documentElement.style.setProperty('--sr-muted', t.muted)
    document.documentElement.style.setProperty('--sr-ready', t.ready)
    document.documentElement.style.setProperty('--sr-error', t.error)
    document.documentElement.style.setProperty('--sr-border', t.border)
  }

  function lockedCharacter() {
    const saved = safeJson(localStorage.getItem(STORAGE.character), null)

    if (!saved?.id) return null
    if (saved.tokenKey && saved.tokenKey !== tokenKey()) return null

    return saved
  }

  function characterLabel(character = lockedCharacter()) {
    if (!character?.id) return 'No character selected'

    return character.name
      ? `${character.name} [${character.id}]`
      : `Character [${character.id}]`
  }

  function historyKey(id = currentHistoryCharacterId) {
    return id ? `${STORAGE.history}:${id}` : STORAGE.history
  }

  function loadHistoryForCharacter(id) {
    const nextId = String(id || '')

    if (!nextId || currentHistoryCharacterId === nextId) return

    currentHistoryCharacterId = nextId
    history = safeJson(localStorage.getItem(historyKey(nextId)), [])
    previousCargoByPlanet = null
  }

  function saveHistory() {
    if (!currentHistoryCharacterId) return

    history = history.slice(-100)
    localStorage.setItem(historyKey(), JSON.stringify(history))
  }

  function clearVisibleCharacterData() {
    apiCache = null
    lastData = null
    scanTargets = []
    previousCargoByPlanet = null

    document.getElementById(IDS.overlay)?.replaceChildren()
  }

  function clearCharacterLock() {
    localStorage.removeItem(STORAGE.character)
    sessionStorage.removeItem(STORAGE.character)
    localStorage.removeItem('oe2CharacterId')

    currentHistoryCharacterId = null
    history = []

    clearVisibleCharacterData()
  }

  function lockCharacter(id, name = '') {
    const cleanId = String(id || '').trim()
    if (!cleanId) return false

    localStorage.setItem(STORAGE.character, JSON.stringify({
      id: cleanId,
      name: clean(name),
      tokenKey: tokenKey(),
      savedAt: Date.now()
    }))

    loadHistoryForCharacter(cleanId)
    clearVisibleCharacterData()

    return true
  }

  function clearAllHistories() {
    Object.keys(localStorage)
      .filter(key =>
        key === STORAGE.history ||
        key.startsWith(`${STORAGE.history}:`) ||
        key === 'starsRelayHistory' ||
        key === 'starsRelayHistoryV2' ||
        key === 'starsRelayHistoryV3' ||
        key.startsWith('starsRelayHistoryV3:') ||
        key === 'starsRelayHistoryV4' ||
        key.startsWith('starsRelayHistoryV4:') ||
        key === 'starsRelayHistoryV5' ||
        key.startsWith('starsRelayHistoryV5:')
      )
      .forEach(key => localStorage.removeItem(key))
  }

  async function getCharacters() {
    const json = await api('/characters').catch(() => null)
    return json?.data || []
  }

  function characterChoiceText(list) {
    return list
      .map(c => {
        const id =
          c.characterID ||
          c.characterId ||
          c.id ||
          ''

        const name = [
          c.charFirstName,
          c.charLastName,
          c.name,
          c.characterName
        ].filter(Boolean).join(' ')

        return id ? `${id}${name ? ` — ${name}` : ''}` : ''
      })
      .filter(Boolean)
      .join('\n')
  }

  function characterNameFromList(list, id) {
    const found = list.find(c =>
      String(c.characterID || c.characterId || c.id || '') === String(id)
    )

    if (!found) return ''

    return [
      found.charFirstName,
      found.charLastName,
      found.name,
      found.characterName
    ].filter(Boolean).join(' ')
  }

  async function chooseRelayCharacter() {
    const list = await getCharacters()
    const choices = characterChoiceText(list)

    const message = [
      'S.T.A.R.S. R.E.L.A.Y.: enter the character ID to track',
      '',
      choices ? 'Available characters:' : 'No character list found.',
      choices
    ].filter(Boolean).join('\n')

    const entered = prompt(message)

    if (!entered) return false

    const id = entered.trim()
    const name = characterNameFromList(list, id)

    if (!lockCharacter(id, name)) return false

    await draw(true)
    return true
  }

  function getCharId() {
    const character = lockedCharacter()

    if (!character?.id) return ''

    loadHistoryForCharacter(character.id)
    return character.id
  }

  function planetFromJob(job, objectById = {}) {
    const id = String(job.info2 || '')

    if (id && objectById[id]?.name) return objectById[id].name

    const detail = clean(job.detail)
    const system = clean(job.systemName2)

    if (system) {
      const match = detail.match(
        new RegExp(`(${esc(system)}\\s+[IVXLCDM]+)\\s*\\(`, 'i')
      )

      if (match) return match[1].trim()
    }

    return detail.match(
      /([A-Za-z0-9-]+(?:\s+[A-Za-z0-9-]+)*\s+[IVXLCDM]+)\s*\(/i
    )?.[1]?.trim()
  }

  function planetFromCargo(item) {
    const text = clean(
      item.resourceName ||
      item.name ||
      item.cargoName ||
      ''
    )

    return text.match(/^(.+?),\s*.+?\s*\([A-F0-9]{7}\)/i)?.[1]?.trim()
  }

  function surveyItem(item) {
    return item.typeC === 'Sc' || /survey/i.test(item.resourceName || '')
  }

  function getCurrentSystemName(systemJson, character) {
    return (
      clean(systemJson?.data?.name) ||
      clean(systemJson?.data?.systemName) ||
      clean(character?.systemName) ||
      clean((systemJson?.data?.systemObjects || []).find(o => o.objectType === 'Star')?.name)
    )
  }

  function logCargoChanges(cargoByPlanet) {
    if (!previousCargoByPlanet) {
      previousCargoByPlanet = { ...cargoByPlanet }
      return
    }

    Object.entries(cargoByPlanet).forEach(([planet, amount]) => {
      const old = previousCargoByPlanet[planet] || 0
      const delta = amount - old

      if (delta > 0) {
        history.push({
          time: new Date().toLocaleTimeString(),
          text: `Report received: ${planet}${delta > 1 ? ` x${delta}` : ''}`
        })
      }
    })

    previousCargoByPlanet = { ...cargoByPlanet }
    saveHistory()
  }

  async function getSurveyData(force = false) {
    const now = Date.now()

    if (!force && apiCache && now - lastApiAt < 1000) {
      return apiCache
    }

    const characterId = getCharId()

    if (!characterId) {
      throw new Error('No R.E.L.A.Y. character selected')
    }

    const character = (await api(`/character/${characterId}`)).data
    const shipId = character.currentShipID
    const systemId = character.systemID

    const [jobsJson, cargoJson, systemJson] = await Promise.all([
      api(`/jobs/accepted?characterId=${characterId}`),
      api(`/cargo/location/${shipId}?characterID=${characterId}&locationType=Sh`),
      systemId
        ? api(`/system/${systemId}`)
        : Promise.resolve({ data: { systemObjects: [] } })
    ])

    const currentSystemName = getCurrentSystemName(systemJson, character)
    const systemObjects = systemJson?.data?.systemObjects || []

    const objectById = {}
    const objectIdByName = {}

    systemObjects.forEach(obj => {
      if (!obj?.systemObjectsId || !obj?.name) return

      objectById[String(obj.systemObjectsId)] = obj
      objectIdByName[obj.name] = String(obj.systemObjectsId)
    })

    const cargoItems = []
    const cargoByPlanet = {}

    ;(cargoJson.data || [])
      .filter(surveyItem)
      .forEach(item => {
        const planet = planetFromCargo(item)
        const objectId = item.jobSystemObjectId
          ? String(item.jobSystemObjectId)
          : ''

        const amount = Number(item.amount || 1)

        if (!planet && !objectId) return

        cargoItems.push({
          planet,
          objectId,
          amount
        })

        if (planet) {
          cargoByPlanet[planet] =
            (cargoByPlanet[planet] || 0) + amount
        }
      })

    const groups = {}

    ;(jobsJson.data || [])
      .filter(j => /survey/i.test(j.jobType || ''))
      .forEach(job => {
        const targetObjectId = job.info2
          ? String(job.info2)
          : ''

        const planet = planetFromJob(job, objectById)

        if (!planet && !targetObjectId) return

        const key = targetObjectId
          ? `id:${targetObjectId}`
          : `name:${planet}`

        groups[key] ??= {
          key,
          objectId: targetObjectId,
          planet: planet || objectById[targetObjectId]?.name || `Object ${targetObjectId}`,
          system: job.systemName2 || '',
          deliverTo: job.jobIssuedLocationName || '',
          needed: 0,
          cargo: 0,
          remaining: 0,
          credits: 0,
          xp: 0,
          jobIds: [],
          inCurrentSystem: false,
          ready: false
        }

        groups[key].needed += 1
        groups[key].credits += Number(job.credits || 0)
        groups[key].xp += Number(job.xp || 0)
        groups[key].jobIds.push(job.jobID)
      })

    Object.values(groups).forEach(group => {
      group.cargo = cargoItems.reduce((sum, item) => {
        const sameId =
          group.objectId &&
          item.objectId &&
          group.objectId === item.objectId

        const sameName =
          item.planet &&
          group.planet &&
          item.planet === group.planet

        return sum + (sameId || sameName ? item.amount : 0)
      }, 0)

      group.remaining = Math.max(group.needed - group.cargo, 0)
      group.ready = group.needed > 0 && group.remaining === 0

      group.inCurrentSystem =
        !!(group.objectId && objectById[group.objectId]) ||
        group.system === currentSystemName ||
        !!objectIdByName[group.planet]
    })

    const data = {
      characterId,
      characterName: characterLabel(),
      shipId,
      systemId,
      currentSystemName,
      objectById,
      objectIdByName,
      groups,
      cargoByPlanet
    }

    logCargoChanges(cargoByPlanet)

    apiCache = data
    lastApiAt = now
    lastData = data

    return data
  }

  function getOverlay() {
    let overlay = document.getElementById(IDS.overlay)

    if (!overlay) {
      overlay = document.createElement('div')
      overlay.id = IDS.overlay

      Object.assign(overlay.style, {
        position: 'fixed',
        inset: '0',
        pointerEvents: 'none',
        zIndex: '999999'
      })

      document.body.appendChild(overlay)
    }

    return overlay
  }

  function objectName(nameEl) {
    return clean(
      nameEl.getAttribute('data-ui-tooltip')?.replace('#', '') ||
      nameEl.childNodes[0]?.textContent ||
      nameEl.innerText
    )
  }

  function distance(item) {
    return Number(
      (item.innerText || '').match(/([\d.]+)\s*SU/i)?.[1] ||
      999999
    )
  }

  function visible(el) {
    const r = el.getBoundingClientRect()

    return (
      r.width &&
      r.height &&
      r.bottom > 0 &&
      r.top < innerHeight
    )
  }

  function clickScan(scanIcon) {
    if (!scanIcon) return

    const r = scanIcon.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2

    scanIcon.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      button: 0
    }))

    apiCache = null

    setTimeout(() => draw(true), 350)
    setTimeout(() => draw(true), 1200)
    setTimeout(() => draw(true), 2400)
  }

  function makeFlag(id) {
    const flag = document.createElement('div')
    flag.dataset.id = id
    flag.className = 'sr-flag'

    flag.onclick = e => {
      e.preventDefault()
      e.stopPropagation()

      const target =
        scanTargets[
          Number(flag.dataset.key) - 1
        ]

      if (target) {
        clickScan(target.scanIcon)
      }
    }

    return flag
  }

  function panel() {
    let p = document.getElementById(IDS.panel)

    if (p) return p

    p = document.createElement('div')
    p.id = IDS.panel

    Object.assign(p.style, {
      position: 'fixed',
      left: `${settings.panelX}px`,
      top: `${settings.panelY}px`,
      zIndex: '1000000',
      background: 'var(--sr-panel-bg)',
      border: '1px solid var(--sr-border)',
      color: 'var(--sr-accent)',
      font: '12px Arial, sans-serif',
      padding: '8px',
      borderRadius: '8px',
      width: '350px',
      maxHeight: '490px',
      overflow: 'auto',
      boxShadow: '0 0 18px rgba(0,0,0,.65)'
    })

    p.innerHTML = `
      <div data-drag class="sr-title">Welcome to S.T.A.R.S. R.E.L.A.Y.</div>
      <div class="sr-subtitle">
        Stranded Travelers Assistance and Rescue Squad<br>
        Recovery Exploration &amp; Long-range Analysis Yield-system™
      </div>

      <div data-characterline class="sr-character">Tracking: ${characterLabel()}</div>
      <div data-summary class="sr-summary">Loading...</div>

      <div>
        <button data-character>Character</button>
        <button data-toggle>On/Off</button>
        <button data-compact>Compact</button>
        <button data-nearest>Nearest</button>
        <button data-altkeys>Alt Keys</button>
        <button data-theme>Theme</button>
        <button data-help>Help</button>
      </div>

      <div>
        <button data-export>Export Log</button>
        <button data-export-settings>Export Settings</button>
        <button data-import-settings>Import Settings</button>
      </div>

      <div data-helpbox class="sr-line" style="display:none">
        <b>How to use:</b><br>
        Click Character and choose the character ID R.E.L.A.Y. should track.
        Open Jobs and System Explorer. R.E.L.A.Y. compares accepted survey jobs to survey reports in that character's ship cargo.
        Flags appear beside visible scan targets. Press 1-9, or Alt+1-9 if Alt Keys is enabled.
        Shift+R manually refreshes. The NEXT marker is the closest visible scan target when Nearest mode is on.
      </div>

      <hr class="sr-divider">

      <div class="sr-section-title">In This System</div>
      <div data-current></div>

      <hr class="sr-divider">

      <div class="sr-section-title" style="color:var(--sr-ready)">Ready To Deliver</div>
      <div data-ready></div>

      <hr class="sr-divider">

      <div class="sr-section-title" style="color:var(--sr-muted)">Other Systems</div>
      <div data-other></div>

      <hr class="sr-divider">

      <div class="sr-section-title">Confirmed Scan History</div>
      <div data-history class="sr-history"></div>

      <div class="sr-small" style="margin-top:6px">
        Commands: starsRelaySelectCharacter(), starsRelayDebug(), starsRelayClearHistory(), starsRelayReset()
      </div>
    `

    p.querySelector('[data-character]').onclick = async () => {
      await chooseRelayCharacter()
    }

    p.querySelector('[data-toggle]').onclick = () => {
      settings.enabled = !settings.enabled
      saveSettings()
      draw(true)
    }

    p.querySelector('[data-compact]').onclick = () => {
      settings.compact = !settings.compact
      saveSettings()
      getOverlay().replaceChildren()
      draw(true)
    }

    p.querySelector('[data-nearest]').onclick = () => {
      settings.nearestFirst = !settings.nearestFirst
      saveSettings()
      draw(true)
    }

    p.querySelector('[data-altkeys]').onclick = () => {
      settings.altHotkeys = !settings.altHotkeys
      saveSettings()
      draw(true)
    }

    p.querySelector('[data-theme]').onclick = () => {
      const keys = Object.keys(THEMES)
      const next =
        keys[
          (keys.indexOf(settings.theme) + 1) %
          keys.length
        ]

      settings.theme = next
      saveSettings()
      applyTheme()
      getOverlay().replaceChildren()
      draw(true)
    }

    p.querySelector('[data-help]').onclick = () => {
      const box = p.querySelector('[data-helpbox]')

      box.style.display =
        box.style.display === 'none'
          ? 'block'
          : 'none'
    }

    p.querySelector('[data-export]').onclick = exportSummary
    p.querySelector('[data-export-settings]').onclick = exportSettings
    p.querySelector('[data-import-settings]').onclick = importSettings

    let dragging = false
    let ox = 0
    let oy = 0

    p.querySelector('[data-drag]').onmousedown = e => {
      dragging = true
      ox = e.clientX - p.offsetLeft
      oy = e.clientY - p.offsetTop
    }

    window.addEventListener('mousemove', e => {
      if (!dragging) return

      settings.panelX = e.clientX - ox
      settings.panelY = e.clientY - oy

      p.style.left = `${settings.panelX}px`
      p.style.top = `${settings.panelY}px`
    })

    window.addEventListener('mouseup', () => {
      if (dragging) saveSettings()
      dragging = false
    })

    document.body.appendChild(p)

    return p
  }

  function addPanelLine(container, group, options = {}) {
    const line = document.createElement('div')

    const status =
      options.ready
        ? 'READY'
        : options.next
        ? 'NEXT'
        : group.remaining
        ? 'SCAN'
        : 'DONE'

    line.className =
      `sr-line ` +
      `${options.ready ? 'sr-line-ready' : ''} ` +
      `${options.next ? 'sr-line-next' : ''} ` +
      `${!group.remaining && !options.ready ? 'sr-line-muted' : ''}`

    line.textContent =
      `${options.next ? '▶ ' : ''}${group.planet} — ${status} | ` +
      `${group.remaining} left / ${group.cargo} report(s) | Jobs: ${group.needed}` +
      `${group.deliverTo ? ` | Deliver: ${group.deliverTo}` : ''}`

    container.appendChild(line)
  }

  function clearPanelLists() {
    const p = panel()

    p.querySelector('[data-current]').textContent = ''
    p.querySelector('[data-ready]').textContent = ''
    p.querySelector('[data-other]').textContent = ''
    p.querySelector('[data-history]').textContent = ''
  }

  function updatePanelNoCharacter() {
    const p = panel()

    p.style.display = settings.showPanel ? 'block' : 'none'
    p.querySelector('[data-characterline]').textContent = 'Tracking: No character selected'
    p.querySelector('[data-summary]').textContent = 'Click Character to choose who R.E.L.A.Y. should track.'

    clearPanelLists()
    p.querySelector('[data-current]').textContent = 'No character selected.'
    p.querySelector('[data-ready]').textContent = 'No character selected.'
    p.querySelector('[data-other]').textContent = 'No character selected.'
  }

  function updatePanel(data, visibleTargets) {
    const p = panel()
    p.style.display = settings.showPanel ? 'block' : 'none'

    p.querySelector('[data-characterline]').textContent =
      `Tracking: ${characterLabel()}`

    const groups = Object.values(data.groups)

    const totalLeft =
      groups.reduce((sum, g) => sum + g.remaining, 0)

    const totalReady =
      groups.filter(g => g.ready).length

    const totalCargo =
      Object.values(data.cargoByPlanet)
        .reduce((a, b) => a + b, 0)

    p.querySelector('[data-summary]').textContent =
      settings.enabled
        ? `ONLINE | ${totalLeft} scan left | ${totalReady} ready | ${totalCargo} report(s) held | ${settings.nearestFirst ? 'Nearest-first' : 'Row-order'} | ${THEMES[settings.theme]?.name || 'Theme'}${settings.altHotkeys ? ' | Alt+keys' : ''}`
        : 'R.E.L.A.Y. disabled'

    const current = p.querySelector('[data-current]')
    const ready = p.querySelector('[data-ready]')
    const other = p.querySelector('[data-other]')
    const h = p.querySelector('[data-history]')

    current.textContent = ''
    ready.textContent = ''
    other.textContent = ''
    h.textContent = ''

    const visibleByKey = {}

    visibleTargets.forEach((t, i) => {
      visibleByKey[t.group.key] = {
        ...t,
        index: i
      }
    })

    const currentGroups = groups
      .filter(g => g.inCurrentSystem && g.remaining > 0)
      .sort((a, b) =>
        (visibleByKey[a.key]?.dist || 999999) -
        (visibleByKey[b.key]?.dist || 999999)
      )

    const readyGroups = groups
      .filter(g => g.ready)
      .sort((a, b) => a.planet.localeCompare(b.planet))

    const otherGroups = groups
      .filter(g => !g.inCurrentSystem && g.remaining > 0)
      .sort((a, b) =>
        a.system.localeCompare(b.system) ||
        a.planet.localeCompare(b.planet)
      )

    if (!currentGroups.length) {
      current.textContent = 'No active scan targets visible here.'
    }

    currentGroups.forEach((g, i) =>
      addPanelLine(current, g, { next: i === 0 })
    )

    if (!readyGroups.length) {
      ready.textContent = 'No completed survey reports waiting.'
    }

    readyGroups.forEach(g =>
      addPanelLine(ready, g, { ready: true })
    )

    if (!otherGroups.length) {
      other.textContent = 'No survey targets outside this system.'
    }

    otherGroups.forEach(g =>
      addPanelLine(other, g)
    )

    history.slice(-8).reverse().forEach(x => {
      const div = document.createElement('div')
      div.textContent = `${x.time} — ${x.text}`
      h.appendChild(div)
    })
  }

  function exportSummary() {
    if (!lastData) return

    const lines = [
      'S.T.A.R.S. R.E.L.A.Y.',
      'Recovery Exploration & Long-range Analysis Yield-system™',
      `Tracking: ${characterLabel()}`,
      new Date().toLocaleString(),
      ''
    ]

    Object.values(lastData.groups)
      .sort((a, b) =>
        a.system.localeCompare(b.system) ||
        a.planet.localeCompare(b.planet)
      )
      .forEach(g => {
        lines.push(`${g.planet}`)
        lines.push(`  System: ${g.system}`)
        lines.push(`  Jobs Stacked: ${g.needed}`)
        lines.push(`  Reports Held: ${g.cargo}`)
        lines.push(`  Scans Remaining: ${g.remaining}`)
        lines.push(`  Delivery Location: ${g.deliverTo || 'Unknown'}`)
        lines.push(`  Status: ${g.ready ? 'Ready to Deliver' : g.remaining ? 'Scan Needed' : 'Done'}`)
        lines.push(`  Target Object ID: ${g.objectId || 'Unknown'}`)
        lines.push('')
      })

    downloadText(
      'stars_relay_survey_summary.txt',
      lines.join('\n')
    )
  }

  function exportSettings() {
    const payload = {
      tool: 'S.T.A.R.S. R.E.L.A.Y.',
      version: '1.1.0',
      settings,
      activeCharacter: lockedCharacter(),
      exportedAt: new Date().toISOString()
    }

    downloadText(
      'stars_relay_settings.json',
      JSON.stringify(payload, null, 2)
    )
  }

  function importSettings() {
    let input = document.getElementById(IDS.importInput)

    if (!input) {
      input = document.createElement('input')
      input.id = IDS.importInput
      input.type = 'file'
      input.accept = '.json,application/json'
      input.style.display = 'none'

      input.onchange = () => {
        const file = input.files?.[0]

        if (!file) return

        const reader = new FileReader()

        reader.onload = () => {
          try {
            const payload =
              JSON.parse(String(reader.result || '{}'))

            settings = {
              ...DEFAULTS,
              ...settings,
              ...(payload.settings || payload)
            }

            saveSettings()
            applyTheme()
            getOverlay().replaceChildren()
            draw(true)
          } catch (err) {
            alert(
              'S.T.A.R.S. R.E.L.A.Y.: could not import settings JSON.'
            )

            console.warn(
              '[S.T.A.R.S. R.E.L.A.Y.] Import failed',
              err
            )
          }

          input.value = ''
        }

        reader.readAsText(file)
      }

      document.body.appendChild(input)
    }

    input.click()
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], {
      type: 'text/plain'
    })

    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()

    setTimeout(() =>
      URL.revokeObjectURL(a.href),
      1000
    )
  }

  async function draw(force = false) {
    if (busy) return

    busy = true

    try {
      applyTheme()

      const overlay = getOverlay()

      if (!settings.enabled) {
        overlay.replaceChildren()
        scanTargets = []
        panel().querySelector('[data-summary]').textContent =
          'R.E.L.A.Y. disabled'
        return
      }

      if (!getCharId()) {
        overlay.replaceChildren()
        scanTargets = []
        updatePanelNoCharacter()
        return
      }

      const data = await getSurveyData(force)
      const rows = [...document.querySelectorAll(SELECTORS.explorerRow)]

      if (!rows.length) {
        overlay.replaceChildren()
        scanTargets = []
        updatePanel(data, [])
        return
      }

      const active = new Set()
      scanTargets = []

      let visibleTargets = rows
        .map(item => {
          const nameEl = item.querySelector(SELECTORS.explorerName)
          const scanIcon = item.querySelector(SELECTORS.scanIcon)

          if (!nameEl || !scanIcon || !visible(item)) {
            return null
          }

          const name = objectName(nameEl)
          const objectId = data.objectIdByName[name]

          const group =
            data.groups[`id:${objectId}`] ||
            data.groups[`name:${name}`] ||
            Object.values(data.groups).find(g => g.planet === name)

          if (!group || !group.remaining) {
            return null
          }

          return {
            item,
            name,
            scanIcon,
            group,
            left: group.remaining,
            dist: distance(item)
          }
        })
        .filter(Boolean)

      if (settings.nearestFirst) {
        visibleTargets.sort((a, b) => a.dist - b.dist)
      }

      visibleTargets.forEach((t, index) => {
        scanTargets.push({
          name: t.name,
          scanIcon: t.scanIcon
        })

        const key = scanTargets.length
        const id = t.group.key

        active.add(id)

        const r = t.scanIcon.getBoundingClientRect()

        let flag = overlay.querySelector(
          `[data-id="${cssEsc(id)}"]`
        )

        if (!flag) {
          flag = makeFlag(id)
          overlay.appendChild(flag)
        }

        const next = index === 0

        flag.className =
          `sr-flag ${next ? 'sr-flag-next' : ''}`

        flag.textContent =
          settings.compact
            ? `🚩${t.left}${next ? ' NEXT' : ''}`
            : `🚩${t.left} [${key}]${next ? ' NEXT' : ''}`

        flag.dataset.key = key

        Object.assign(flag.style, {
          right: `${window.innerWidth - r.left + 6}px`,
          top: `${r.top - 1}px`,
          display: 'block',
          fontSize: settings.compact ? '11px' : '12px',
          padding: settings.compact ? '0 2px' : '1px 4px'
        })
      })

      overlay.querySelectorAll('[data-id]').forEach(flag => {
        if (!active.has(flag.dataset.id)) {
          flag.remove()
        }
      })

      updatePanel(data, visibleTargets)
    } catch (err) {
      console.warn('[S.T.A.R.S. R.E.L.A.Y.]', err)

      panel().querySelector('[data-summary]').textContent =
        'R.E.L.A.Y. API error'
    } finally {
      busy = false
    }
  }

  window.addEventListener('keydown', e => {
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return
    if (e.repeat) return

    if (e.shiftKey && e.key.toLowerCase() === 'r') {
      e.preventDefault()
      e.stopImmediatePropagation()

      apiCache = null
      draw(true)

      return
    }

    if (settings.altHotkeys && !e.altKey) return

    const n =
      e.code.startsWith('Digit')
        ? Number(e.code.replace('Digit', ''))
        : e.code.startsWith('Numpad')
        ? Number(e.code.replace('Numpad', ''))
        : 0

    if (!n || !scanTargets[n - 1]) return

    const now = Date.now()

    if (now - lastHotkey < 1200) return

    lastHotkey = now

    e.preventDefault()
    e.stopImmediatePropagation()

    clickScan(scanTargets[n - 1].scanIcon)
  }, true)

  window.starsRelaySelectCharacter = async () => {
    await chooseRelayCharacter()
  }

  window.starsRelayClearCharacter = () => {
    clearCharacterLock()
    draw(true)
  }

  window.starsRelayToggle = () => {
    settings.enabled = !settings.enabled
    saveSettings()
    draw(true)
  }

  window.starsRelayPanel = () => {
    settings.showPanel = !settings.showPanel
    saveSettings()
    draw(true)
  }

  window.starsRelayClearHistory = () => {
    if (currentHistoryCharacterId) {
      localStorage.removeItem(historyKey())
    }

    history = []
    previousCargoByPlanet = null
    draw(true)
  }

  window.starsRelayDebug = () => {
    const debug = {
      activeCharacter: lockedCharacter(),
      activeCharacterId: currentHistoryCharacterId,
      historyKey: historyKey(),
      history,
      lastData
    }

    console.log(debug)
    return debug
  }

  window.starsRelayReset = () => {
    localStorage.removeItem(STORAGE.settings)
    localStorage.removeItem(STORAGE.character)
    localStorage.removeItem('oe2CharacterId')
    clearAllHistories()
    location.reload()
  }

  window.starsRelayExportSettings = exportSettings
  window.starsRelayImportSettings = importSettings

  addEventListener('resize', () => draw(false))
  addEventListener('scroll', () => draw(false), true)

  applyTheme()

  setInterval(() => draw(false), 2500)

  draw(true)
})()