// ==UserScript==
// @name         Chat Font Control
// @namespace    http://tampermonkey.net/
// @version      4.1
// @description  Adjust in-game chat font size and toggle bold — follows chat resize
// @match        https://game.dev.outerempires.net/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY_SIZE = 'chatFontSize';
    const STORAGE_KEY_BOLD = 'chatFontBold';

    const MIN_SIZE = 10;
    const MAX_SIZE = 40;
    const STEP = 2;
    const DEFAULT_SIZE_MINI = 12;
    const DEFAULT_SIZE_NORMAL = 14;

    let fontSize = parseInt(localStorage.getItem(STORAGE_KEY_SIZE), 10);
    let isBold = localStorage.getItem(STORAGE_KEY_BOLD) === 'true';
    let wrap = null;

    // ── Detect chat size ──

    function isMini() {
        const area = document.getElementById('ui_chat_area');
        return area && area.classList.contains('min');
    }

    function getDefaultSize() {
        return isMini() ? DEFAULT_SIZE_MINI : DEFAULT_SIZE_NORMAL;
    }

    if (!fontSize || fontSize < MIN_SIZE || fontSize > MAX_SIZE) {
        fontSize = getDefaultSize();
    }

    // ── Style injection ──

    function applyStyle() {
        let el = document.getElementById('oe-chat-font-style');
        if (!el) {
            el = document.createElement('style');
            el.id = 'oe-chat-font-style';
            document.head.appendChild(el);
        }
        el.textContent = `
            .ui_chat_output_message,
            .ui_chat_output_message * {
                font-size: ${fontSize}px !important;
                font-weight: ${isBold ? 'bold' : 'inherit'} !important;
            }
        `;
    }

    const IDS = {
        wrap: 'oe-font-wrap',
        dec: 'oe-font-dec',
        label: 'oe-font-label',
        inc: 'oe-font-inc',
        bold: 'oe-font-bold',
    };

    const BTN_STYLE =
        'display:flex;align-items:center;justify-content:center;' +
        'width:15px;height:15px;cursor:pointer;';

    const BTN_BG = 'rgba(0,0,0,0.35)';
    const CLR = '#43eca1';

    // ── Inject wrapper (flex row, visual order = DOM order) ──

    function injectControls() {
        const area = document.getElementById('ui_chat_area');
        if (!area) return false;
        if (document.getElementById(IDS.wrap)) return true;

        wrap = document.createElement('div');
        wrap.id = IDS.wrap;
        wrap.style.cssText =
            'position:absolute;height:18px;z-index:1;' +
            'display:flex;flex-direction:row;align-items:center;' +
            'gap:2px;pointer-events:none;';

        // DOM order = visual order: [−] [14] [+] [B]
        wrap.innerHTML = `
            <div id="${IDS.dec}" title="Decrease font size"
                 style="${BTN_STYLE}pointer-events:auto;">
                <div class="ui_icon_minus"></div>
            </div>
            <div id="${IDS.label}"
                 style="width:14px;height:15px;pointer-events:none;
                        font-family:BarlowSemiCondensed-Light,sans-serif;
                        font-size:10px;color:${CLR};text-align:center;
                        line-height:15px;background:${BTN_BG};border-radius:2px;
                        display:flex;align-items:center;justify-content:center;">${fontSize}</div>
            <div id="${IDS.inc}" title="Increase font size"
                 style="${BTN_STYLE}pointer-events:auto;">
                <div class="ui_icon_plus"></div>
            </div>
            <div id="${IDS.bold}" title="Toggle bold"
                 style="${BTN_STYLE}border-radius:2px;pointer-events:auto;
                        background:${BTN_BG};
                        font-family:BarlowSemiCondensed-Bold,sans-serif;
                        font-size:12px;color:${CLR};transform:translateY(1px);">B</div>
        `;

        area.appendChild(wrap);
        positionWrap();

        document.getElementById(IDS.dec).onclick = () => changeSize(-STEP);
        document.getElementById(IDS.inc).onclick = () => changeSize(STEP);
        document.getElementById(IDS.bold).onclick = toggleBold;

        return true;
    }

    // ── Position wrapper just left of controls ──

    function positionWrap() {
        if (!wrap) return;
        const controls = document.getElementById('ui_chat_controls');
        if (!controls) return;

        const cs = getComputedStyle(controls);
        wrap.style.bottom = (parseFloat(cs.bottom) + 2) + 'px';
        wrap.style.left = (parseFloat(cs.left) - 18) + 'px';
    }

    // ── State changes ──

    function changeSize(delta) {
        fontSize = Math.max(MIN_SIZE, Math.min(MAX_SIZE, fontSize + delta));
        localStorage.setItem(STORAGE_KEY_SIZE, fontSize);
        const lbl = document.getElementById(IDS.label);
        if (lbl) lbl.textContent = fontSize;
        applyStyle();
    }

    function toggleBold() {
        isBold = !isBold;
        localStorage.setItem(STORAGE_KEY_BOLD, isBold);
        const btn = document.getElementById(IDS.bold);
        if (btn) {
            btn.style.background = isBold
                ? 'rgba(67,236,161,0.25)'
                : BTN_BG;
        }
        applyStyle();
    }

    // ── Observe chat for size changes and re-renders ──

    function observeChanges() {
        const area = document.getElementById('ui_chat_area');
        if (!area) return;

        const classObserver = new MutationObserver(() => {
            positionWrap();
            if (isMini() && fontSize !== DEFAULT_SIZE_MINI) {
                fontSize = DEFAULT_SIZE_MINI;
                localStorage.setItem(STORAGE_KEY_SIZE, fontSize);
                const lbl = document.getElementById(IDS.label);
                if (lbl) lbl.textContent = fontSize;
                applyStyle();
            }
        });
        classObserver.observe(area, { attributes: true, attributeFilter: ['class'] });

        const domObserver = new MutationObserver(() => {
            if (!document.getElementById(IDS.wrap)) {
                injectControls();
                const lbl = document.getElementById(IDS.label);
                if (lbl) lbl.textContent = fontSize;
                const b = document.getElementById(IDS.bold);
                if (b) b.style.background = isBold
                    ? 'rgba(67,236,161,0.25)'
                    : BTN_BG;
            } else {
                positionWrap();
            }
        });
        domObserver.observe(area, { childList: true, subtree: true });
    }

    // ── Init ──

    function init() {
        if (!injectControls()) {
            setTimeout(init, 500);
            return;
        }
        observeChanges();
    }

    applyStyle();
    init();
})();
