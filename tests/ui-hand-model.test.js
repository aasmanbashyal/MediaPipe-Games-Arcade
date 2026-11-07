import test from 'node:test';
import assert from 'node:assert/strict';
import { createPalmAnchors, decodePalms, weightedSuppression, palmToRoi, projectLandmarks, projectWorldLandmarks, normalizeGestureLandmarks, assignHandSlots } from '../shared/hand-model-math.js';
const close = (actual, expected, epsilon = 1e-5) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);

test('the official palm grid has 2016 fixed-size anchors in model order', () => {
    const anchors = createPalmAnchors();
    assert.equal(anchors.length, 2016);
    assert.deepEqual(anchors[0], anchors[1]);
    close(anchors[0].x, 0.5 / 24);
    close(anchors[1152].x, 0.5 / 12);
    assert.deepEqual(anchors[1152], anchors[1157]);
});

test('palm decoding removes letterbox padding before rotated ROI generation', () => {
    const boxes = new Float32Array(2016 * 18), scores = new Float32Array(2016).fill(-100);
    scores[0] = 10;
    // 640x360 letterboxes into 192x192 with 42px of vertical padding.
    boxes.set([92, 92, 60, 60, 92, 104, 92, 92, 92, 86, 92, 92, 92, 92, 92, 92, 92, 92]);
    const [palm] = decodePalms(boxes, scores, 640, 360);
    close(palm.x, 320); close(palm.y, 180); close(palm.w, 200);
    const roi = palmToRoi(palm);
    close(roi.rotation, 0); close(roi.x, 320); close(roi.y, 80); close(roi.size, 520);
    assert.equal(decodePalms(boxes, new Float32Array(2016).fill(-100), 640, 360).length, 0);
});

test('weighted suppression merges duplicate palms while retaining a second hand', () => {
    const box = (x, score) => ({ x, y: 50, w: 40, h: 40, score, points: [{ x, y: 50 }] });
    const hands = weightedSuppression([box(50, 0.8), box(52, 0.9), box(180, 0.7)]);
    assert.equal(hands.length, 2);
    close(hands[0].x, (50 * 0.8 + 52 * 0.9) / 1.7);
    close(hands[1].x, 180);
});

test('crop projection preserves source position, rotation and normalized depth', () => {
    const raw = new Float32Array(63);
    for (let i = 0; i < 21; i++) raw.set([168, 112, 22.4], i * 3);
    const landmarks = projectLandmarks(raw, { x: 320, y: 180, size: 200, rotation: Math.PI / 2 }, 640, 360);
    close(landmarks[0].x, 0.5); close(landmarks[0].y, 230 / 360); close(landmarks[0].z, 50 / 640);
    const world = new Float32Array(63); world.set([1, 0, 0.5]);
    const projected = projectWorldLandmarks(world, Math.PI / 2);
    close(projected[0].x, 0); close(projected[0].y, 1); close(projected[0].z, 0.5);
});

test('gesture inputs remove wrist translation, correct aspect ratio, and remain finite for collapsed hands', () => {
    const points = Array.from({ length: 21 }, (_, i) => ({ x: 0.1 + i * 0.01, y: 0.2 + i * 0.02, z: i * 0.001 }));
    const encoded = normalizeGestureLandmarks(points, { width: 640, height: 320 });
    assert.equal(encoded.length, 63);
    assert.deepEqual(Array.from(encoded.slice(0, 3)), [0, 0, 0]);
    close(encoded[60], encoded[61]);
    close(encoded[60], 0.2 / 0.20001);
    const shifted = normalizeGestureLandmarks(points.map(p => ({ x: p.x + 3, y: p.y - 2, z: p.z + 0.5 })), { width: 640, height: 320 });
    encoded.forEach((value, i) => close(shifted[i], value));
    assert.ok(normalizeGestureLandmarks(Array.from({ length: 21 }, () => ({ x: 1, y: 1, z: 1 }))).every(Number.isFinite));
});

test('two same-handed players keep distinct spatial slots when detection order changes', () => {
    const hand = x => Array.from({ length: 21 }, () => ({ x, y: 0.5, z: 0 }));
    const results = { landmarks: [hand(0.2), hand(0.8)], handednesses: [[{ categoryName: 'Right' }], [{ categoryName: 'Right' }]] };
    const previous = [{ x: 0.8, y: 0.5, active: true }, { x: 0.2, y: 0.5, active: true }];
    assert.deepEqual(assignHandSlots(results, previous), [1, 0]);
    results.landmarks.reverse();
    assert.deepEqual(assignHandSlots(results, previous), [0, 1]);
    previous.forEach(p => { p.active = false; });
    assert.deepEqual(assignHandSlots(results, previous), [0, 1]);
    results.landmarks = [hand(0.2)];
    previous[1].active = true;
    assert.deepEqual(assignHandSlots(results, previous), [1]);
});
