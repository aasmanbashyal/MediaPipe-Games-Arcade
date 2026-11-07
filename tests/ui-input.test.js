import test from 'node:test';
import assert from 'node:assert/strict';
import { pointerToGame, cameraErrorMessage, MANUAL_GESTURES, expireCameraPointers } from '../shared/input-utils.js';

test('screen pointer maps to the same visible position after the canvas mirror', () => {
    const rect = { left: 100, top: 80, width: 480, height: 270 };
    for (const screenX of [100, 220, 340, 460, 580]) {
        const point = pointerToGame(screenX, 215, rect);
        assert.equal(rect.left + (1 - point.x) * rect.width, screenX);
        assert.equal(point.y, 0.5);
    }
});

test('pointer capture beyond the playfield stays in bounds and zero-size fields are ignored', () => {
    const rect = { left: 20, top: 30, width: 960, height: 540 };
    assert.deepEqual(pointerToGame(-100, -100, rect), { x: 1, y: 0 });
    assert.deepEqual(pointerToGame(2000, 2000, rect), { x: 0, y: 1 });
    assert.equal(pointerToGame(0, 0, { ...rect, width: 0 }), null);
    assert.equal(pointerToGame(0, 0, { ...rect, height: 0 }), null);
});

test('camera failures give actionable guidance and always offer local controls', () => {
    assert.match(cameraErrorMessage({ name: 'NotAllowedError' }), /denied.*retry.*mouse or touch/);
    assert.match(cameraErrorMessage({ name: 'NotFoundError' }), /No camera.*mouse or touch/);
    assert.match(cameraErrorMessage({ name: 'NotReadableError' }), /busy.*mouse or touch/);
    assert.match(cameraErrorMessage({ name: 'SecurityError' }), /HTTPS.*mouse or touch/);
    assert.match(cameraErrorMessage(new Error('model download failed')), /connection.*mouse or touch/);
});

test('gesture practice offers all seven model categories exactly once', () => {
    assert.deepEqual(new Set(MANUAL_GESTURES.map(([gesture]) => gesture)), new Set([
        'Open_Palm', 'Closed_Fist', 'Victory', 'Thumb_Up', 'Thumb_Down', 'Pointing_Up', 'ILoveYou',
    ]));
});

test('camera input expires by elapsed time even when inference stops producing frames', () => {
    const pointers = [{ active: true, gesture: 'Open_Palm', landmarks: [{}], lastSeenAt: 1000, grace: 350 }];
    expireCameraPointers(pointers, 1340);
    assert.equal(pointers[0].active, true);
    expireCameraPointers(pointers, 1351);
    assert.equal(pointers[0].active, false);
    assert.equal(pointers[0].gesture, 'None');
    assert.equal(pointers[0].landmarks, null);
});
