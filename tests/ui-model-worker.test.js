import test from 'node:test';
import assert from 'node:assert/strict';
import { createGestureModel } from '../shared/gesture-model.js';

function mockBrowser(t, { failInitialization = false, deferInitialization = false } = {}) {
    const workers = [];
    class FakeWorker {
        constructor() { this.messages = []; this.terminated = false; workers.push(this); }
        postMessage(message, transfer) {
            this.messages.push({ ...message, transfer });
            if (message.type === 'initialize' && !deferInitialization) queueMicrotask(() => this.onmessage({ data: {
                id: message.id, ...(failInitialization ? { error: 'model unavailable' } : { result: {} }),
            } }));
        }
        terminate() { this.terminated = true; }
        reply(message, result) { this.onmessage({ data: { id: message.id, result } }); }
    }
    const original = Object.fromEntries(['Worker', 'OffscreenCanvas', 'createImageBitmap'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    Object.assign(globalThis, { Worker: FakeWorker, OffscreenCanvas: class {}, createImageBitmap: async () => ({ close() {} }) });
    t.after(() => {
        for (const [key, descriptor] of Object.entries(original)) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
        }
    });
    return workers;
}

test('only one snapshot is in flight and worker results return unchanged', async t => {
    const workers = mockBrowser(t);
    const model = await createGestureModel();
    t.after(() => model.close());
    const first = model.recognizeForVideo({}, 100);
    const ignored = await model.recognizeForVideo({}, 101);
    assert.equal(ignored, null);
    const requests = workers[0].messages.filter(message => message.type === 'frame');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].transfer[0], requests[0].image);
    const result = { landmarks: [[{ x: 0.2, y: 0.3 }]], gestures: [] };
    workers[0].reply(requests[0], result);
    assert.deepEqual(await first, result);
});

test('close terminates inference, resolves pending work and ignores late results', async t => {
    const workers = mockBrowser(t);
    const model = await createGestureModel();
    const pending = model.recognizeForVideo({}, 100);
    await Promise.resolve();
    const frame = workers[0].messages.find(message => message.type === 'frame');
    model.close();
    assert.equal(workers[0].terminated, true);
    assert.equal(await pending, null);
    workers[0].reply(frame, { landmarks: ['stale'] });
    await assert.rejects(model.recognizeForVideo({}, 101), /closed/);
    model.close();
});

test('failed model initialization terminates its worker instead of leaking it', async t => {
    const workers = mockBrowser(t, { failInitialization: true });
    await assert.rejects(createGestureModel(), /model unavailable/);
    assert.equal(workers[0].terminated, true);
});

test('aborting model initialization immediately terminates a loading worker', async t => {
    const workers = mockBrowser(t, { deferInitialization: true });
    const controller = new AbortController();
    const loading = createGestureModel({ signal: controller.signal });
    const rejected = assert.rejects(loading, error => error.name === 'AbortError');
    assert.equal(workers[0].messages[0].type, 'initialize');
    controller.abort();
    assert.equal(workers[0].terminated, true);
    await rejected;
    workers[0].reply(workers[0].messages[0], { backend: 'late model' });
});

test('an already-aborted initialization never creates a worker', async t => {
    const workers = mockBrowser(t);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(createGestureModel({ signal: controller.signal }), error => error.name === 'AbortError');
    assert.equal(workers.length, 0);
});
