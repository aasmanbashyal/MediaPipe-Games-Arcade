/**
 * Shared controls using the official hand/gesture models on LiteRT.js in a worker.
 * Includes One Euro Filter for smooth, low-latency pointer tracking.
 */

import { pointerToGame, cameraErrorMessage, MANUAL_GESTURES, expireCameraPointers } from './input-utils.js';
import { createGestureModel } from './gesture-model.js';
import { assignHandSlots } from './hand-model-math.js';

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
const HAND_GRACE_MS = 350;

// Fixed game canvas size (independent of camera resolution)
// This gives consistent element sizes regardless of webcam resolution
export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;

let gestureRecognizer = null;
let lastVideoTime = -1;
let videoElement = null;
let initialized = false;
let inputMode = 'none';
let inputVersion = 0;
let stopPointerInput = null;
let onTrackingError = null;
let inferencePending = null;
let initAbortController = null;

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
    video.muted = true;
    const status = document.getElementById('statusText');
    const panel = document.createElement('section');
    panel.className = 'input-choice';
    panel.setAttribute('aria-label', 'Choose controls');
    panel.innerHTML = '<p class="input-heading">Choose your controls</p><div class="input-buttons"><button type="button" id="useCameraBtn">Use camera</button><button type="button" id="usePointerBtn">Mouse or touch</button></div><p id="inputHelp">Camera frames stay on your device. Mouse and touch work without a camera.</p><p id="inputError" role="alert"></p>';
    status.before(panel);
    status.textContent = 'Choose controls to get started';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const cameraButton = panel.querySelector('#useCameraBtn');
    const pointerButton = panel.querySelector('#usePointerBtn');
    const error = panel.querySelector('#inputError');
    let readyCalled = false;

    function ready(mode) {
        inputMode = mode;
        initialized = true;
        document.body.dataset.inputMode = mode;
        panel.hidden = true;
        if (!readyCalled) {
            readyCalled = true;
            onReady?.(GAME_WIDTH, GAME_HEIGHT);
        }
    }
    function fail(cause) {
        disposeHandTracker();
        document.body.dataset.inputMode = 'none';
        if (readyCalled) {
            document.dispatchEvent(new Event('arcade:inputlost'));
            const dialog = document.querySelector('.pause-dialog');
            if (dialog?.open) dialog.append(panel);
        }
        panel.hidden = false;
        cameraButton.disabled = false;
        cameraButton.textContent = 'Retry camera';
        error.textContent = cameraErrorMessage(cause);
        onError?.(cause);
        status.textContent = readyCalled ? 'Tracking stopped. Choose controls to continue.' : 'Choose another control method or retry';
    }
    onTrackingError = fail;
    function usePointer() {
        inputVersion++;
        disposeHandTracker();
        stopPointerInput = enablePointerInput();
        ready('pointer');
    }
    pointerButton.addEventListener('click', usePointer);
    document.addEventListener('arcade:use-pointer', usePointer);
    cameraButton.addEventListener('click', async () => {
        const version = ++inputVersion;
        error.textContent = '';
        cameraButton.disabled = true;
        cameraButton.textContent = 'Starting camera…';
        status.textContent = 'Loading hand tracking. You can use mouse or touch while this loads.';
        try {
            if (!window.isSecureContext) throw Object.assign(new Error('Secure context required'), { name: 'SecurityError' });
            if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('No camera API'), { name: 'NotFoundError' });
            // Load the remote model only after an explicit camera choice. A CDN
            // outage must not prevent the local games or pointer controls loading.
            const loading = new AbortController();
            initAbortController = loading;
            let recognizer;
            try { recognizer = await createGestureModel({ signal: loading.signal }); }
            finally { if (initAbortController === loading) initAbortController = null; }
            if (version !== inputVersion) { recognizer.close(); return; }
            gestureRecognizer = recognizer;
            const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 30 } }, audio: false });
            if (version !== inputVersion) { stream.getTracks().forEach(track => track.stop()); return; }
            video.srcObject = stream;
            await video.play();
            if (version !== inputVersion) return;
            stream.getVideoTracks()[0].addEventListener('ended', () => {
                if (inputMode === 'camera') fail(new Error('Camera disconnected'));
            });
            ready('camera');
        } catch (cause) {
            if (version === inputVersion) fail(cause);
        }
    });
    window.addEventListener('pagehide', () => { inputVersion++; disposeHandTracker(); });
    window.addEventListener('pageshow', event => {
        if (event.persisted) fail(new Error('Choose controls after returning to the game'));
    });
}

export function disposeHandTracker() {
    initialized = false;
    inputMode = 'none';
    lastVideoTime = -1;
    inferencePending = null;
    const loading = initAbortController;
    initAbortController = null;
    loading?.abort();
    stopPointerInput?.();
    stopPointerInput = null;
    videoElement?.srcObject?.getTracks().forEach(track => track.stop());
    if (videoElement) videoElement.srcObject = null;
    gestureRecognizer?.close();
    gestureRecognizer = null;
    pointers.forEach(pointer => { pointer.active = false; pointer.landmarks = null; pointer.gesture = 'None'; pointer.grace = 0; });
}

function enablePointerInput() {
    const canvas = document.getElementById('gameCanvas');
    const activeIds = new Map();
    const abort = new AbortController();
    const options = { signal: abort.signal };
    function move(event) {
        if (document.body.dataset.paused === 'true') return;
        if (event.pointerType !== 'mouse' && !activeIds.has(event.pointerId)) return;
        if (!activeIds.has(event.pointerId)) {
            const slot = [0, 1].find(index => ![...activeIds.values()].includes(index));
            if (slot === undefined) return;
            activeIds.set(event.pointerId, slot);
        }
        const index = activeIds.get(event.pointerId);
        const point = pointerToGame(event.clientX, event.clientY, canvas.getBoundingClientRect());
        if (point) Object.assign(pointers[index], point, { active: true, grace: 1, landmarks: null, sampleTime: performance.now() });
    }
    canvas.addEventListener('pointerdown', event => {
        if (document.body.dataset.paused === 'true') return;
        const slot = [0, 1].find(index => ![...activeIds.values()].includes(index));
        if (slot === undefined && !activeIds.has(event.pointerId)) return;
        activeIds.set(event.pointerId, activeIds.get(event.pointerId) ?? slot);
        canvas.setPointerCapture(event.pointerId);
        move(event);
    }, options);
    canvas.addEventListener('pointermove', move, options);
    function end(event) {
        const index = activeIds.get(event.pointerId);
        if (index !== undefined) { pointers[index].active = false; pointers[index].gesture = 'None'; }
        activeIds.delete(event.pointerId);
    }
    canvas.addEventListener('pointerup', event => { if (event.pointerType !== 'mouse') end(event); }, options);
    canvas.addEventListener('pointercancel', end, options);
    canvas.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse') end(event); }, options);
    window.addEventListener('blur', () => { activeIds.clear(); pointers.forEach(pointer => { pointer.active = false; pointer.gesture = 'None'; }); }, options);
    let gesturePanel = null;
    if (location.pathname.includes('/shadow-puppets/')) {
        gesturePanel = document.createElement('div');
        gesturePanel.className = 'manual-gestures';
        gesturePanel.setAttribute('aria-label', 'Practice gestures');
        gesturePanel.innerHTML = '<p>Practice mode · hold a button or its number key</p>';
        const hold = index => {
            if (document.body.dataset.paused !== 'true') Object.assign(pointers[0], { x: 0.5, y: 0.5, active: true, gesture: MANUAL_GESTURES[index][0] });
        };
        const release = () => { pointers[0].active = false; pointers[0].gesture = 'None'; };
        MANUAL_GESTURES.forEach((gesture, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = `${index + 1} ${gesture[2]}`;
            button.setAttribute('aria-label', `${index + 1}: ${gesture[1]}`);
            button.addEventListener('pointerdown', event => { button.setPointerCapture(event.pointerId); hold(index); }, options);
            button.addEventListener('pointerup', release, options);
            button.addEventListener('pointercancel', release, options);
            button.addEventListener('keydown', event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); hold(index); } }, options);
            button.addEventListener('keyup', release, options);
            gesturePanel.append(button);
        });
        document.addEventListener('keydown', event => { const index = Number(event.key) - 1; if (index >= 0 && index < MANUAL_GESTURES.length) hold(index); }, options);
        document.addEventListener('keyup', event => { if (/^[1-7]$/.test(event.key)) release(); }, options);
        document.body.append(gesturePanel);
    }
    return () => { abort.abort(); gesturePanel?.remove(); };
}

/** Call once per animation frame to update pointers from vision. */
export function detectHands() {
    if (inputMode === 'camera') expireCameraPointers(pointers, performance.now(), HAND_GRACE_MS);
    if (inferencePending || inputMode !== 'camera' || !gestureRecognizer || !videoElement || videoElement.readyState < 2) return;
    const now = performance.now();
    if (videoElement.currentTime === lastVideoTime) return;
    lastVideoTime = videoElement.currentTime;
    const model = gestureRecognizer, version = inputVersion;
    const request = { model, version };
    inferencePending = request;
    Promise.resolve().then(() => model.recognizeForVideo(videoElement, now)).then(results => {
        if (results && model === gestureRecognizer && version === inputVersion && inputMode === 'camera') updatePointers(results, now);
    }).catch(error => {
        if (model === gestureRecognizer && version === inputVersion && inputMode === 'camera') onTrackingError?.(error);
    }).finally(() => { if (inferencePending === request) inferencePending = null; });
}

function updatePointers(results, now) {
    const t = now / 1000; // seconds for filter
    const slots = results?.landmarks ? assignHandSlots(results, pointers) : [];

    // A missing hand must stop matching gestures as soon as a completed frame
    // omits it. Position may linger briefly to avoid visual flicker.
    pointers.forEach(p => {
        p.gesture = 'None';
    });
    expireCameraPointers(pointers, performance.now(), HAND_GRACE_MS);

    if (!results || !results.landmarks || results.landmarks.length === 0) return;

    // Handedness plus spatial matching keeps two same-handed players distinct.
    for (let i = 0; i < Math.min(2, results.landmarks.length); i++) {
        const lm = results.landmarks[i];
        const gestures = results.gestures?.[i];

        const pIdx = slots[i];

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
        p.grace = HAND_GRACE_MS;
        p.lastSeenAt = performance.now();
        p.landmarks = lm;
        p.sampleTime = now;

        // Gesture
        if (gestures && gestures.length > 0 && gestures[0].score > 0.5) {
            p.gesture = gestures[0].categoryName;
        } else {
            p.gesture = 'None';
        }
    }
}

/** Get current pointer array (read-only). */
export function getPointers() {
    if (inputMode === 'camera') expireCameraPointers(pointers, performance.now(), HAND_GRACE_MS);
    return pointers;
}

/** Get recognized gesture for a pointer index. */
export function getGestures() {
    return getPointers().map(p => p.active ? p.gesture : 'None');
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
