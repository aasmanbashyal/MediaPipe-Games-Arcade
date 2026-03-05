/**
 * Shared Game Initialization Helpers
 * Common setup patterns for all games.
 */

import { initHandTracker, detectHands, drawSkeleton, GAME_WIDTH, GAME_HEIGHT } from './hand-tracker.js';

/**
 * Standard game setup: init hand tracker, size canvases, start render loop.
 * @param {object} opts
 * @param {string} opts.videoId - webcam video element ID
 * @param {string} opts.canvasId - main game canvas ID
 * @param {string} opts.miniCanvasId - mini skeleton canvas ID
 * @param {function} opts.onReady - called with (vw, vh, ctx, miniCtx) when ready
 * @param {function} opts.onFrame - called each frame with (ctx, miniCtx, canvas)
 * @param {function} opts.onError - optional error handler
 */
export function setupGame(opts) {
    const videoElement = document.getElementById(opts.videoId);
    const canvas = document.getElementById(opts.canvasId);
    const ctx = canvas.getContext('2d');
    const miniCanvas = document.getElementById(opts.miniCanvasId);
    const miniCtx = miniCanvas.getContext('2d');

    initHandTracker(videoElement, (vw, vh) => {
        canvas.width = GAME_WIDTH;
        canvas.height = GAME_HEIGHT;
        miniCanvas.width = GAME_WIDTH;
        miniCanvas.height = GAME_HEIGHT;

        if (opts.onReady) opts.onReady(GAME_WIDTH, GAME_HEIGHT, ctx, miniCtx);

        function mainLoop() {
            detectHands();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            miniCtx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
            drawSkeleton(miniCtx, miniCanvas.width, miniCanvas.height);
            if (opts.onFrame) opts.onFrame(ctx, miniCtx, canvas);
            requestAnimationFrame(mainLoop);
        }
        requestAnimationFrame(mainLoop);
    }, err => {
        if (opts.onError) opts.onError(err);
    });

    return { videoElement, canvas, ctx, miniCanvas, miniCtx };
}
