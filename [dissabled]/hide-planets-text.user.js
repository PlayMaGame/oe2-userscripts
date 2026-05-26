// ==UserScript==
// @name         Hide Space Flags
// @namespace    custom.space.hide
// @version      1.0
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Hide all canvas text
    CanvasRenderingContext2D.prototype.fillText = function() {};
    CanvasRenderingContext2D.prototype.strokeText = function() {};

    // Intercept image drawing
    const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;

    CanvasRenderingContext2D.prototype.drawImage = function(...args) {

        /*
            args:
            [image, x, y]
            OR
            [image, x, y, width, height]
        */

        const width = args[3];
        const height = args[4];

        // Hide small horizontal UI elements
        if (
            width > 40 &&
            width < 300 &&
            height > 5 &&
            height < 80
        ) {
            return;
        }

        return originalDrawImage.apply(this, args);
    };

})();