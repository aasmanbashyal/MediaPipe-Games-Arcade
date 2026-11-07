import { decodePalms, palmToRoi, projectLandmarks, projectWorldLandmarks, normalizeGestureLandmarks } from './hand-model-math.js';
import { specializeBatchOne } from './tflite-batch.js';

const RUNTIME = 'https://cdn.jsdelivr.net/npm/@litertjs/core@2.6.0';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';
const LABELS = ['None', 'Closed_Fist', 'Open_Palm', 'Pointing_Up', 'Thumb_Down', 'Thumb_Up', 'Victory', 'ILoveYou'];
let runtimePromise;

async function getRuntime() {
    if (!runtimePromise) runtimePromise = (async () => {
        const runtime = await import(`${RUNTIME}/+esm`);
        // In a worker Emscripten otherwise resolves the .wasm next to this
        // worker script, rather than next to the pinned CDN loader script.
        globalThis.Module = { locateFile: file => new URL(file, `${RUNTIME}/wasm/`).href };
        await runtime.loadLiteRt(`${RUNTIME}/wasm/`);
        return runtime;
    })().catch(error => { runtimePromise = null; throw error; });
    return runtimePromise;
}

function canvasSurface(width, height) {
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }) };
}
function readRgb(surface) {
    const pixels = surface.ctx.getImageData(0, 0, surface.canvas.width, surface.canvas.height).data;
    const tensor = new Float32Array(pixels.length / 4 * 3);
    // Both official image models specify mean=0, standard deviation=255.
    for (let i = 0, j = 0; i < pixels.length; i += 4) {
        tensor[j++] = pixels[i] / 255; tensor[j++] = pixels[i + 1] / 255; tensor[j++] = pixels[i + 2] / 255;
    }
    return tensor;
}

/**
 * Run the official palm, landmark, gesture embedding and classifier graphs on
 * LiteRT.js's WebAssembly backend. No MediaPipe Tasks inference runtime is used.
 * Model preprocessing references are in hand-model-math.js.
 */
export async function createGestureEngine() {
    const [{ Tensor, loadAndCompile }, { unzipSync }, response] = await Promise.all([
        getRuntime(), import('https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js'), fetch(MODEL_URL),
    ]);
    if (!response.ok) throw new Error(`Hand model download failed (${response.status})`);
    const bundle = unzipSync(new Uint8Array(await response.arrayBuffer()));
    const landmarker = unzipSync(bundle['hand_landmarker.task']);
    const gesture = unzipSync(bundle['hand_gesture_recognizer.task']);
    const models = [];
    try {
        for (const bytes of [landmarker['hand_detector.tflite'], landmarker['hand_landmarks_detector.tflite'], gesture['gesture_embedder.tflite'], gesture['canned_gesture_classifier.tflite']]) {
            if (!bytes) throw new Error('Hand model bundle is incomplete');
            models.push(await loadAndCompile(specializeBatchOne(bytes), { accelerator: 'wasm' }));
        }
    } catch (error) { models.forEach(model => model.delete()); throw error; }
    const [palmModel, landmarkModel, embedder, classifier] = models;
    const frame = canvasSurface(640, 360), palmImage = canvasSurface(192, 192), handImage = canvasSurface(224, 224);
    let closed = false, inFlight = false, released = false;
    function release() {
        if (released) return;
        released = true;
        models.forEach(model => model.delete());
        for (const surface of [frame, palmImage, handImage]) { surface.canvas.width = 0; surface.canvas.height = 0; }
    }
    async function run(model, buffers) {
        const inputs = [];
        let outputs = [];
        try {
            buffers.forEach((data, index) => inputs.push(new Tensor(data, Array.from(model.getInputDetails()[index].shape))));
            outputs = await model.run(inputs);
            return outputs.map(output => new Float32Array(output.toTypedArray()));
        } finally { inputs.forEach(input => input.delete()); outputs.forEach(output => output.delete()); }
    }
    return {
        backend: 'litert-wasm',
        async recognizeForVideo(source) {
            if (closed) throw new Error('Hand model is closed');
            if (inFlight) return null;
            inFlight = true;
            try {
                const width = source.videoWidth || source.naturalWidth || source.width;
                const height = source.videoHeight || source.naturalHeight || source.height;
                if (!(width > 0 && height > 0)) return { landmarks: [], handednesses: [], gestures: [] };
                if (frame.canvas.width !== width || frame.canvas.height !== height) { frame.canvas.width = width; frame.canvas.height = height; }
                // Snapshot once so crops and palm detections refer to the same frame.
                frame.ctx.drawImage(source, 0, 0, width, height);
                palmImage.ctx.fillStyle = '#000'; palmImage.ctx.fillRect(0, 0, 192, 192);
                const scale = 192 / Math.max(width, height);
                palmImage.ctx.drawImage(frame.canvas, (192 - width * scale) / 2, (192 - height * scale) / 2, width * scale, height * scale);
                const palmOutput = await run(palmModel, [readRgb(palmImage)]);
                if (closed) return null;
                const palms = decodePalms(palmOutput[0], palmOutput[1], width, height);
                const result = { landmarks: [], worldLandmarks: [], handednesses: [], gestures: [] };
                for (const palm of palms) {
                    const roi = palmToRoi(palm);
                    const ctx = handImage.ctx;
                    ctx.setTransform(1, 0, 0, 1, 0, 0);
                    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 224, 224);
                    ctx.translate(112, 112); ctx.rotate(-roi.rotation); ctx.scale(224 / roi.size, 224 / roi.size); ctx.translate(-roi.x, -roi.y);
                    ctx.drawImage(frame.canvas, 0, 0);
                    ctx.setTransform(1, 0, 0, 1, 0, 0);
                    const output = await run(landmarkModel, [readRgb(handImage)]);
                    if (closed) return null;
                    if (output[1][0] < 0.5) continue;
                    const landmarks = projectLandmarks(output[0], roi, width, height);
                    const world = projectWorldLandmarks(output[3], roi.rotation);
                    const rightProbability = output[2][0];
                    const embedding = await run(embedder, [normalizeGestureLandmarks(landmarks, { width, height }), new Float32Array([rightProbability]), normalizeGestureLandmarks(world)]);
                    if (closed) return null;
                    const [probabilities] = await run(classifier, [embedding[0]]);
                    if (closed) return null;
                    let best = 0;
                    for (let i = 1; i < probabilities.length; i++) if (probabilities[i] > probabilities[best]) best = i;
                    result.landmarks.push(landmarks); result.worldLandmarks.push(world);
                    result.handednesses.push([{ categoryName: rightProbability >= 0.5 ? 'Right' : 'Left', score: Math.max(rightProbability, 1 - rightProbability) }]);
                    result.gestures.push([{ categoryName: LABELS[best], score: probabilities[best] }]);
                }
                return result;
            } finally { inFlight = false; if (closed) release(); }
        },
        close() { closed = true; if (!inFlight) release(); },
    };
}
