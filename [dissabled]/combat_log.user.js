// ==UserScript==
// @name         Combat Logger
// @namespace    combatlog
// @version      1.0
// @description  Lightweight combat event logger
// @match        https://game.dev.outerempires.net/*
// @grant        none
// ==/UserScript==

(function () {

    'use strict';

    // =====================================================
    // CONFIG
    // =====================================================

    const CONTAINER_ID =
        "ui_chat_output_SysLogs::Combat";

    const STORAGE_KEY =
        "combat_logger_logs";

    // =====================================================
    // STORAGE
    // =====================================================

    let logs = JSON.parse(
        localStorage.getItem(STORAGE_KEY) || "[]"
    );

    // =====================================================
    // DUPLICATE PROTECTION
    // =====================================================

    let processed = new Set();

    // =====================================================
    // HELPERS
    // =====================================================

    function saveLogs() {

        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(logs)
        );
    }

    function addLog(entry) {

        logs.push(entry);

        saveLogs();

        console.log(
            "COMBAT LOG:",
            entry
        );
    }

    // =====================================================
    // PARSER
    // =====================================================

    function parseMessage(text) {

        // =============================================
        // OUTGOING DAMAGE
        // =============================================

        if (
            text.includes("You deal")
        ) {

            const match =
                text.match(
                    /You deal (\d+) points of (\w+) damage to (.+)\./
                );

            if (match) {

                return {

                    timestamp:
                        Date.now(),

                    type:
                        "outgoing",

                    target:
                        match[3].trim(),

                    amount:
                        Number(match[1]),

                    damageType:
                        match[2]
                };
            }
        }

        // =============================================
        // INCOMING DAMAGE
        // =============================================

        if (
            text.includes("damage to you")
        ) {

            const match =
                text.match(
                    /(.+) deals (\d+) points of (\w+) damage to you/
                );

            if (match) {

                return {

                    timestamp:
                        Date.now(),

                    type:
                        "incoming",

                    source:
                        match[1].trim(),

                    amount:
                        Number(match[2]),

                    damageType:
                        match[3]
                };
            }
        }

        // =============================================
        // MISSILE DETECTION
        // =============================================

        if (
            text.includes(
                "Missile launch detected"
            )
        ) {

            const match =
                text.match(
                    /(.+) launches/i
                );

            return {

                timestamp:
                    Date.now(),

                type:
                    "missile",

                source:
                    match
                        ? match[1].trim()
                        : "unknown"
            };
        }

        // =============================================
        // SHIELD ABSORB
        // =============================================

        if (
            text.includes(
                "Your shields absorb"
            )
        ) {

            const match =
                text.match(
                    /Your shields absorb (\d+) points of (\w+) damage/
                );

            if (match) {

                return {

                    timestamp:
                        Date.now(),

                    type:
                        "shield",

                    amount:
                        Number(match[1]),

                    damageType:
                        match[2]
                };
            }
        }

		// =============================================
		// KILL DETECTION
		// =============================================

		const killPatterns = [

			/You destroy (.+?)\.?$/i,

			/You destroyed (.+?)\.?$/i,

			/You have destroyed (.+?)\.?$/i,

			/(.+?) has been destroyed\.?$/i,

			/Target (.+?) eliminated\.?$/i,

			/(.+?) eliminated\.?$/i
		];

		for (
			const pattern
			of killPatterns
		) {

			const match =
				text.match(pattern);

			if (match) {

				return {

					timestamp:
						Date.now(),

					type:
						"kill",

					target:
						match[1].trim(),

					raw:
						text
				};
			}
		}

		return null;
		}
		
		
    // =====================================================
    // PROCESS NODE
    // =====================================================

    function processNode(node) {

        const text =
            node.innerText.trim();

        if (!text) return;

        if (
            processed.has(text)
        ) {
            return;
        }

        processed.add(text);

        const parsed =
            parseMessage(text);

        if (!parsed) return;

        addLog(parsed);
    }

    // =====================================================
    // OBSERVER
    // =====================================================

    function observeCombatLog(
        container
    ) {

        // Existing messages
        container
            .querySelectorAll(
                ".ui_chat_log_message"
            )
            .forEach(processNode);

        // Live updates
        const observer =
            new MutationObserver(
                (mutations) => {

                    mutations.forEach(
                        (mutation) => {

                            mutation.addedNodes
                                .forEach(
                                    (node) => {

                                        if (

                                            node.nodeType === 1

                                            &&

                                            node.classList.contains(
                                                "ui_chat_log_message"
                                            )

                                        ) {

                                            processNode(
                                                node
                                            );
                                        }
                                    }
                                );
                        }
                    );
                }
            );

        observer.observe(
            container,
            {

                childList: true,

                subtree: true
            }
        );

        console.log(
            "Combat Logger Active"
        );
    }

    // =====================================================
    // UI
    // =====================================================

    function createUI() {

        const panel =
            document.createElement(
                "div"
            );

        panel.style.position =
            "fixed";

        panel.style.top =
            "750px";

        panel.style.right =
            "35px";

        panel.style.zIndex =
            "999999";

        panel.style.background =
            "rgba(0,0,0,0.9)";

        panel.style.color =
            "#0f0";

        panel.style.padding =
            "10px";

        panel.style.fontSize =
            "12px";

        panel.style.fontFamily =
            "monospace";

        panel.style.border =
            "1px solid #0f0";

        panel.style.width =
            "260px";

        function refreshPanel() {

            panel.innerHTML = `

                <div>
                    <b>Combat Logger</b>
                </div>

                <hr>

                <div>
                    Entries:
                    ${logs.length}
                </div>

                <hr>

                <button id="downloadLogs">
                    Download Logs
                </button>

                <button id="clearLogs">
                    Clear
                </button>
            `;

            // =========================================
            // DOWNLOAD
            // =========================================

            panel.querySelector(
                "#downloadLogs"
            ).onclick = () => {

                const blob =
                    new Blob(
                        [
                            JSON.stringify(
                                logs,
                                null,
                                2
                            )
                        ],
                        {
                            type:
                                "application/json"
                        }
                    );

                const url =
                    URL.createObjectURL(
                        blob
                    );

                const a =
                    document.createElement(
                        "a"
                    );

                a.href = url;

                a.download =
                    `combat_logs_${Date.now()}.json`;

                a.click();

                URL.revokeObjectURL(
                    url
                );
            };

            // =========================================
            // CLEAR
            // =========================================

            panel.querySelector(
                "#clearLogs"
            ).onclick = () => {

                localStorage.removeItem(
                    STORAGE_KEY
                );

                logs = [];

                processed.clear();

                refreshPanel();
            };
        }

        setInterval(
            refreshPanel,
            1000
        );

        refreshPanel();

        document.body.appendChild(
            panel
        );
    }

    // =====================================================
    // START
    // =====================================================

    function start() {

        const container =
            document.getElementById(
                CONTAINER_ID
            );

        if (!container) {

            console.log(
                "Combat container not found..."
            );

            setTimeout(
                start,
                2000
            );

            return;
        }

        console.log(
            "Combat Logger Started"
        );

        createUI();

        observeCombatLog(
            container
        );
    }

    start();

})();