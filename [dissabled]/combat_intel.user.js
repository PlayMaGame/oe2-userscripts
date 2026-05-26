// ==UserScript==
// @name         Combat Intel
// @namespace    combatintel
// @version      3.0
// @description  Learns enemy HP and predicts remaining health
// @match        https://game.dev.outerempires.net/*
// @grant        none
// ==/UserScript==

(function () {

    'use strict';

    // =====================================================
    // CONFIG
    // =====================================================

    const LOG_STORAGE_KEY =
        "combat_logger_logs";

    const INTEL_STORAGE_KEY =
        "combat_ship_intel";

    // Reset combat after inactivity
    const TARGET_TIMEOUT =
        30000;

    // Ignore impossible spikes
    const MAX_REASONABLE_DAMAGE =
        500000;

    // =====================================================
    // STORAGE
    // =====================================================

    let intel = JSON.parse(
        localStorage.getItem(
            INTEL_STORAGE_KEY
        ) || "{}"
    );

    // =====================================================
    // ACTIVE TARGETS
    // =====================================================

    let activeTargets = {};

    let processedKills =
        new Set();

    // =====================================================
    // HELPERS
    // =====================================================

    function saveIntel() {

        localStorage.setItem(
            INTEL_STORAGE_KEY,
            JSON.stringify(
                intel,
                null,
                2
            )
        );
    }

    function getShipClass(name) {

        return name
            .replace(/\s*\([^)]+\)/g, "")
            .trim();
    }

    function getTarget(name) {

        if (!activeTargets[name]) {

            activeTargets[name] = {

                damageTaken: 0,

                missilesSeen: 0,

                started:
                    Date.now(),

                lastSeen:
                    Date.now()
            };
        }

        return activeTargets[name];
    }

    function touchTarget(
        name,
        timestamp
    ) {

        const target =
            getTarget(name);

        target.lastSeen =
            timestamp || Date.now();

        return target;
    }

    // =====================================================
    // CLEANUP
    // =====================================================

    function cleanupTargets() {

        const now = Date.now();

        Object.keys(activeTargets)
            .forEach((ship) => {

                const target =
                    activeTargets[ship];

                if (
                    now - target.lastSeen >
                    TARGET_TIMEOUT
                ) {

                    delete activeTargets[
                        ship
                    ];
                }
            });
    }

    // =====================================================
    // INTEL LEARNING
    // =====================================================

    function updateShipIntel(
        shipClass,
        observedHP,
        missilesSeen
    ) {

        // Ignore garbage data
        if (
            observedHP <= 0
            ||
            observedHP >
            MAX_REASONABLE_DAMAGE
        ) {

            return;
        }

        // =============================================
        // FIRST SAMPLE
        // =============================================

        if (
            !intel[shipClass]
        ) {

            intel[shipClass] = {

                avgHP:
                    observedHP,

                minHP:
                    observedHP,

                maxHP:
                    observedHP,

                samples: 1,

                totalDamage:
                    observedHP,

                missileEncounters:
                    missilesSeen > 0
                        ? 1
                        : 0,

                totalEncounters:
                    1,

                avgMissiles:
                    missilesSeen
            };

        } else {

            const data =
                intel[shipClass];

            // =========================================
            // OUTLIER FILTERING
            // =========================================

            const difference =
                Math.abs(
                    observedHP -
                    data.avgHP
                );

            const deviation =
                difference /
                data.avgHP;

            // Ignore absurd samples
            if (
                data.samples >= 3
                &&
                deviation > 1.5
            ) {

                console.log(
                    "IGNORED OUTLIER:",
                    shipClass,
                    observedHP
                );

                return;
            }

            // =========================================
            // LEARNING
            // =========================================

            data.samples++;

            data.totalEncounters++;

            // Weighted averaging
            data.avgHP =
                (
                    data.avgHP * 0.85
                )
                +
                (
                    observedHP * 0.15
                );

            data.totalDamage +=
                observedHP;

            data.minHP =
                Math.min(
                    data.minHP,
                    observedHP
                );

            data.maxHP =
                Math.max(
                    data.maxHP,
                    observedHP
                );

            data.avgMissiles =
                (
                    (
                        data.avgMissiles *
                        (
                            data.samples - 1
                        )
                    )
                    + missilesSeen
                )
                / data.samples;

            if (
                missilesSeen > 0
            ) {

                data.missileEncounters++;
            }
        }

        saveIntel();

        console.log(
            "INTEL UPDATED:",
            shipClass,
            intel[shipClass]
        );
    }

    // =====================================================
    // PROCESS LOGS
    // =====================================================

    function processLogs() {

        const logs = JSON.parse(
            localStorage.getItem(
                LOG_STORAGE_KEY
            ) || "[]"
        );

        // Rebuild fresh combat state
        activeTargets = {};

        const now =
            Date.now();

        logs.forEach((log) => {

            // Ignore stale logs
            if (
                !log.timestamp
                ||
                now - log.timestamp >
                TARGET_TIMEOUT
            ) {

                return;
            }

            // =============================================
            // OUTGOING DAMAGE
            // =============================================

            if (
                log.type ===
                "outgoing"
            ) {

                if (
                    !log.target
                    ||
                    !log.amount
                ) {

                    return;
                }

                const target =
                    touchTarget(
                        log.target,
                        log.timestamp
                    );

                target.damageTaken +=
                    Number(
                        log.amount
                    ) || 0;
            }

            // =============================================
            // MISSILES
            // =============================================

            if (
                log.type ===
                "missile"
            ) {

                if (!log.source) {
                    return;
                }

                const target =
                    touchTarget(
                        log.source,
                        log.timestamp
                    );

                target.missilesSeen++;
            }

            // =============================================
            // INCOMING DAMAGE
            // =============================================

            if (
                log.type ===
                "incoming"
            ) {

                if (!log.source) {
                    return;
                }

                touchTarget(
                    log.source,
                    log.timestamp
                );
            }

            // =============================================
            // KILL
            // =============================================

            if (
                log.type ===
                "kill"
            ) {

                const killId =
                    (
                        log.timestamp || 0
                    )
                    + "_" +
                    log.target;

                if (
                    processedKills.has(
                        killId
                    )
                ) {

                    return;
                }

                processedKills.add(
                    killId
                );

                const fullName =
                    log.target;

                const target =
                    activeTargets[
                        fullName
                    ];

                if (!target) {
                    return;
                }

                if (
                    target.damageTaken <= 0
                ) {

                    return;
                }

                const shipClass =
                    getShipClass(
                        fullName
                    );

                updateShipIntel(
                    shipClass,
                    target.damageTaken,
                    target.missilesSeen
                );

                delete activeTargets[
                    fullName
                ];
            }
        });
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

        panel.style.bottom =
            "500px";

        panel.style.right =
            "350px";

        panel.style.zIndex =
            "999999";

        panel.style.background =
            "rgba(0,0,0,0.92)";

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
            "300px";

        panel.style.pointerEvents =
            "auto";

        // =================================================
        // PICK ACTIVE TARGET
        // =================================================

        function getCurrentTarget() {

            let currentTarget =
                null;

            Object.entries(
                activeTargets
            )
            .forEach(
                ([ship, target]) => {

                    if (
                        !currentTarget
                        ||
                        target.lastSeen >
                        currentTarget
                            .target
                            .lastSeen
                    ) {

                        currentTarget = {

                            ship,
                            target
                        };
                    }
                }
            );

            return currentTarget;
        }

        // =================================================
        // RENDER TARGET
        // =================================================

        function renderTarget() {

            const currentTarget =
                getCurrentTarget();

            // =============================================
            // NO TARGET
            // =============================================

            if (!currentTarget) {

                return `
                    <div style="
                        padding:10px;
                        text-align:center;
                        color:#888;
                    ">
                        No active target
                    </div>
                `;
            }

            const ship =
                currentTarget.ship;

            const target =
                currentTarget.target;

            const shipClass =
                getShipClass(ship);

            const data =
                intel[shipClass];

            // =============================================
            // LEARNING MODE
            // =============================================

            if (!data) {

                return `

                    <div style="
                        padding:10px;
                    ">

                        <div>
                            <b>${ship}</b>
                        </div>

                        <div style="
                            margin-top:8px;
                            color:#ff0;
                        ">
                            Learning target HP...
                        </div>

                        <div style="
                            margin-top:6px;
                            font-size:18px;
                        ">
                            Damage:
                            ${Math.round(
                                target.damageTaken
                            )}
                        </div>

                    </div>
                `;
            }

            // =============================================
            // HP ESTIMATION
            // =============================================

            const estimatedHP =
                Math.max(
                    data.avgHP,
                    target.damageTaken
                );

            const remaining =
                Math.max(
                    0,
                    estimatedHP -
                    target.damageTaken
                );

            const percent =
                Math.max(
                    0,
                    Math.min(
                        100,
                        (
                            remaining /
                            estimatedHP
                        ) * 100
                    )
                );

            const confidence =
                Math.min(
                    100,
                    data.samples * 10
                );

            // =============================================
            // BAR COLOR
            // =============================================

            let barColor =
                "#0f0";

            if (percent <= 50) {
                barColor = "#ff0";
            }

            if (percent <= 25) {
                barColor = "#f00";
            }

            return `

                <div style="
                    padding:10px;
                ">

                    <div style="
                        font-size:14px;
                        margin-bottom:8px;
                    ">
                        <b>${ship}</b>
                    </div>

                    <div style="
                        width:100%;
                        height:22px;
                        background:#300;
                        border:1px solid #777;
                        overflow:hidden;
                    ">
                        <div style="
                            width:${percent}%;
                            height:100%;
                            background:${barColor};
                            transition:width 0.15s linear;
                        "></div>
                    </div>

                    <div style="
                        margin-top:8px;
                        font-size:20px;
                        color:${barColor};
                    ">
                        ${Math.round(
                            remaining
                        )}
                        /
                        ${Math.round(
                            estimatedHP
                        )} HP
                    </div>

                    <div style="
                        margin-top:4px;
                        color:#888;
                        font-size:11px;
                    ">
                        Confidence:
                        ${confidence.toFixed(0)}%
                    </div>

                </div>
            `;
        }

        // =================================================
        // REFRESH
        // =================================================

        function refreshPanel() {

            cleanupTargets();

            processLogs();

            panel.innerHTML = `

                <div style="
                    font-size:14px;
                    margin-bottom:6px;
                ">
                    <b>Combat Intel</b>
                </div>

                ${renderTarget()}

                <hr>

                <div style="
                    margin-top:8px;
                    text-align:center;
                ">
                    <button id="clearIntel">
                        Reset Learning
                    </button>
                </div>
            `;

            const clearButton =
                panel.querySelector(
                    "#clearIntel"
                );

            if (clearButton) {

                clearButton.onclick =
                    () => {

                        localStorage.removeItem(
                            INTEL_STORAGE_KEY
                        );

                        intel = {};

                        processedKills.clear();

                        activeTargets = {};

                        refreshPanel();
                    };
            }
        }

        // =================================================
        // START LOOP
        // =================================================

        setInterval(
            refreshPanel,
            250
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

        console.log(
            "Combat Intel Started"
        );

        createUI();
    }

    start();

})();