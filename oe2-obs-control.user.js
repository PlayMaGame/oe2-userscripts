// ==UserScript==
// @name         OE2 → OBS Control
// @namespace    https://game.dev.outerempires.net/
// @version      3.1
// @description  Direct WebSocket to obs-websocket — toggles filters + ASSS on galaxy map
// @match        https://game.dev.outerempires.net/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(async function () {
    'use strict';

    const PASSWORD = 'IOcg8RcF5sMwh7Kv';

    const FILTERS = [
        { source: 'OE2', filter: 'Composite Blur' },
        { source: 'OE2', filter: 'Color Correction' },
    ];

    let ws = null;
    let wasMapOpen = false;
    let reconnectTimer = null;
    let closeTimer = null;
    let assItemId = null;

    function sha256(str) {
        return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    }

    function b64(buf) {
        return btoa(String.fromCharCode(...new Uint8Array(buf)));
    }

    async function connect() {
        ws = new WebSocket('ws://localhost:4455');
        ws.onmessage = async (event) => {
            const msg = JSON.parse(event.data);
            if (msg.op === 0) {
                const a = msg.d.authentication;
                const secret = b64(await sha256(PASSWORD + a.salt));
                const authStr = b64(await sha256(secret + a.challenge));
                ws.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, authentication: authStr } }));
            } else if (msg.op === 2) {
                console.log('[OE2→OBS] Connected');
                if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
                ws.send(JSON.stringify({ op: 6, d: { requestType: 'GetSceneItemId', requestData: { sceneName: 'Scene', sourceName: 'ASSS' }, requestId: 'getAss' } }));
            } else if (msg.op === 7 && msg.d.requestId === 'getAss') {
                const st = msg.d.requestStatus;
                console.log('[OE2→OBS] GetSceneItemId result:', st.result, st.comment || '');
                if (st.result) {
                    assItemId = msg.d.responseData.sceneItemId;
                    console.log('[OE2→OBS] ASSS item ID:', assItemId);
                }
            }
        };
        ws.onclose = () => {
            ws = null;
            assItemId = null;
            if (!reconnectTimer) reconnectTimer = setTimeout(connect, 2000);
        };
        ws.onerror = () => {};
    }

    function send(enabled) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        for (const f of FILTERS) {
            ws.send(JSON.stringify({
                op: 6, d: {
                    requestType: 'SetSourceFilterEnabled',
                    requestData: { sourceName: f.source, filterName: f.filter, filterEnabled: enabled },
                    requestId: '1',
                },
            }));
        }
        if (assItemId !== null) {
            ws.send(JSON.stringify({
                op: 6, d: {
                    requestType: 'SetSceneItemEnabled',
                    requestData: { sceneName: 'Scene', sceneItemId: assItemId, sceneItemEnabled: enabled },
                    requestId: 'ass',
                },
            }));
        }
    }

    function isGalaxyMapOpen() {
        const btn = document.getElementById('ui_galaxy_hex');
        return btn && btn.classList.contains('galaxy_map_open');
    }

    function check() {
        const open = isGalaxyMapOpen();
        if (open !== wasMapOpen) {
            wasMapOpen = open;
            if (open) {
                if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
                send(true);
            } else {
                if (closeTimer) clearTimeout(closeTimer);
                closeTimer = setTimeout(() => { closeTimer = null; send(false); }, 75);
            }
        }
    }

    function observeHex() {
        const btn = document.getElementById('ui_galaxy_hex');
        if (!btn) { setTimeout(observeHex, 500); return; }
        new MutationObserver(check).observe(btn, { attributes: true, attributeFilter: ['class'] });
        check();
    }

    await connect();
    observeHex();
    setInterval(check, 200);
})();
