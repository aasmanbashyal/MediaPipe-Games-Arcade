/**
 * Shared Hand Tracker Module — v2 (GestureRecognizer)
 * Uses MediaPipe GestureRecognizer for stable handedness + gesture detection.
 * Includes One Euro Filter for smooth, low-latency pointer tracking.
 */

import { GestureRecognizer, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/vision_bundle.mjs';

// ---- One Euro Filter (adaptive smoothing) ----
class OneEuroFilter {
    constructor(minCutoff = 1.0, beta = 0.05, dCutoff = 1.0) {
        this.minCutoff = minCutoff;
        this.beta = beta;
        this.dCutoff = dCutoff;
        this.xPrev = null;
        this.dxPrev = 0;
        this.tPrev = null;
    }
    _smoothingFactor(te, cutoff) {
        const r = 2 * Math.PI * cutoff * te;
        return r / (r + 1);
    }
    filter(x, t) {
        if (this.tPrev === null) {
            this.xPrev = x;
            this.tPrev = t;
            return x;
        }
        const te = t - this.tPrev;
        if (te <= 0) return this.xPrev;
        // Derivative
        const aD = this._smoothingFactor(te, this.dCutoff);
        const dx = (x - this.xPrev) / te;
        const dxHat = aD * dx + (1 - aD) * this.dxPrev;
        // Adaptive cutoff
        const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
        const a = this._smoothingFactor(te, cutoff);
        const xHat = a * x + (1 - a) * this.xPrev;
        this.xPrev = xHat;
        this.dxPrev = dxHat;
        this.tPrev = t;
        return xHat;
    }
    reset() {
        this.xPrev = null;
        this.dxPrev = 0;
        this.tPrev = null;
    }
}

// ---- Constants ----
const MAX_GRACE_FRAMES = 12;

// Fixed game canvas size (independent of camera resolution)
// This gives consistent element sizes regardless of webcam resolution
export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;

let gestureRecognizer = null;
let lastVideoTime = -1;
let videoElement = null;
let initialized = false;

// Pointer[0] = Left hand (screen-right), Pointer[1] = Right hand (screen-left)
const pointers = [
    { x: 0.5, y: 0.5, active: false, grace: 0, landmarks: null, gesture: 'None', filterX: new OneEuroFilter(), filterY: new OneEuroFilter() },
    { x: 0.5, y: 0.5, active: false, grace: 0, landmarks: null, gesture: 'None', filterX: new OneEuroFilter(), filterY: new OneEuroFilter() }
];

const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]
];

/**
 * Initialize GestureRecognizer + webcam.
 * @param {HTMLVideoElement} video
 * @param {function} onReady  — called when camera is streaming
 * @param {function} onError  — called on failure
 */
export async function initHandTracker(video, onReady, onError) {
    videoElement = video;
    try {
        const vision = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm'
        );
        gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
                delegate: 'GPU'
            },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.4,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.4
        });

        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 640, max: 640 },
                height: { ideal: 360, max: 360 },
                aspectRatio: { ideal: 16 / 9 },
                frameRate: { ideal: 30 }
            }
        });
        videoElement.srcObject = stream;
        videoElement.onloadedmetadata = () => {
            videoElement.play();
            initialized = true;
            if (onReady) onReady(videoElement.videoWidth, videoElement.videoHeight);
        };
    } catch (err) {
        if (onError) onError(err);
    }
}

/** Call once per animation frame to update pointers from vision. */
export function detectHands() {
    if (!gestureRecognizer || !videoElement || videoElement.videoWidth === 0) return;
    const now = performance.now();
    if (videoElement.currentTime === lastVideoTime) return;
    lastVideoTime = videoElement.currentTime;
    const results = gestureRecognizer.recognizeForVideo(videoElement, now);
    updatePointers(results, now);
}

function updatePointers(results, now) {
    const t = now / 1000; // seconds for filter

    // Decrement grace on both pointers
    pointers.forEach(p => {
        if (p.grace > 0) p.grace--;
        if (p.grace <= 0) {
            p.active = false;
            p.gesture = 'None';
        }
    });

    if (!results || !results.landmarks || results.landmarks.length === 0) return;

    // Process each detected hand using handedness for stable assignment
    for (let i = 0; i < results.landmarks.length; i++) {
        const lm = results.landmarks[i];
        const handedness = results.handednesses[i];
        const gestures = results.gestures[i];

        // Determine pointer index from handedness
        // MediaPipe reports "Left"/"Right" from camera perspective
        // Left hand (camera) = user's right hand = pointer[1]
        // Right hand (camera) = user's left hand = pointer[0]
        const label = handedness?.[0]?.categoryName || '';
        let pIdx;
        if (label === 'Right') {
            pIdx = 0; // Camera-right = user's left
        } else if (label === 'Left') {
            pIdx = 1; // Camera-left = user's right
        } else {
            // Fallback to nearest-match
            pIdx = findNearestPointer(lm[8].x, lm[8].y);
        }

        const p = pointers[pIdx];
        const tipX = lm[8].x;
        const tipY = lm[8].y;

        if (!p.active) {
            // First detection — snap to position, reset filters
            p.filterX.reset();
            p.filterY.reset();
            p.x = tipX;
            p.y = tipY;
        } else {
            // Smooth with One Euro Filter
            p.x = p.filterX.filter(tipX, t);
            p.y = p.filterY.filter(tipY, t);
        }

        p.active = true;
        p.grace = MAX_GRACE_FRAMES;
        p.landmarks = lm;

        // Gesture
        if (gestures && gestures.length > 0 && gestures[0].score > 0.5) {
            p.gesture = gestures[0].categoryName;
        } else {
            p.gesture = 'None';
        }
    }
}

function findNearestPointer(tipX, tipY) {
    let bestIdx = 0, bestDist = Infinity;
    pointers.forEach((p, idx) => {
        const dx = p.x - tipX, dy = p.y - tipY;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) { bestDist = dist; bestIdx = idx; }
    });
    return bestIdx;
}

/** Get current pointer array (read-only). */
export function getPointers() { return pointers; }

/** Get recognized gesture for a pointer index. */
export function getGestures() {
    return pointers.map(p => p.gesture);
}

/** Get hand connections array for skeleton drawing. */
export function getHandConnections() { return HAND_CONNECTIONS; }

/** Draw hand skeletons onto a given canvas context. */
export function drawSkeleton(ctx, w, h, colors = ['#ff6ec7', '#00e5ff']) {
    ctx.save();
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';

    pointers.forEach((p, idx) => {
        if (!p.active || !p.landmarks) return;
        const lm = p.landmarks;
        const color = colors[idx] || colors[0];

        ctx.strokeStyle = color;
        ctx.fillStyle = '#ffffff';

        HAND_CONNECTIONS.forEach(([a, b]) => {
            const p1 = lm[a], p2 = lm[b];
            if (p1 && p2) {
                ctx.beginPath();
                ctx.moveTo(p1.x * w, p1.y * h);
                ctx.lineTo(p2.x * w, p2.y * h);
                ctx.stroke();
            }
        });

        lm.forEach(l => {
            ctx.beginPath();
            ctx.arc(l.x * w, l.y * h, 2, 0, Math.PI * 2);
            ctx.fill();
        });
    });
    ctx.restore();
}

/** Draw neon pointer cursors on a canvas. */
export function drawPointers(ctx, w, h, colors = ['#ff6ec7', '#00e5ff']) {
    pointers.forEach((p, idx) => {
        if (!p.active) return;
        const px = p.x * w, py = p.y * h;
        const color = colors[idx] || colors[0];

        ctx.save();
        // Fake glow
        ctx.beginPath();
        ctx.arc(px, py, 26, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 12;
        ctx.globalAlpha = 0.2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(px, py, 24, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(px, py, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 1;
        ctx.fill();
        ctx.restore();
    });
}

export function isReady() { return initialized; }
