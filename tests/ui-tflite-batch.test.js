import test from 'node:test';
import assert from 'node:assert/strict';
import { specializeBatchOne } from '../shared/tflite-batch.js';

// Minimal schema-shaped FlatBuffer with one graph/tensor. Unrelated tail bytes
// stand in for weights and must remain untouched by signature specialization.
function modelFixture() {
    const bytes = new Uint8Array(192), view = new DataView(bytes.buffer);
    const u16 = (at, value) => view.setUint16(at, value, true);
    const i32 = (at, value) => view.setInt32(at, value, true);
    i32(0, 20); bytes.set(new TextEncoder().encode('TFL3'), 4);
    u16(8, 10); u16(10, 8); u16(16, 4); i32(20, 12); i32(24, 8);
    i32(32, 1); i32(36, 28);
    u16(48, 6); u16(50, 8); u16(52, 4); i32(64, 16); i32(68, 12);
    i32(80, 1); i32(84, 44);
    u16(100, 20); u16(102, 12); u16(104, 4); u16(118, 8);
    i32(128, 28); i32(132, 16); i32(136, 28);
    i32(148, 2); i32(152, 1); i32(156, 128);
    i32(164, 2); i32(168, -1); i32(172, 128);
    bytes.fill(73, 180);
    return bytes;
}

test('dynamic batch signature becomes one without altering weights or source bytes', () => {
    const source = modelFixture(), specialized = specializeBatchOne(source);
    assert.equal(new DataView(source.buffer).getInt32(168, true), -1);
    assert.equal(new DataView(specialized.buffer).getInt32(168, true), 1);
    source.forEach((byte, index) => { if (index < 168 || index > 171) assert.equal(specialized[index], byte); });
    assert.deepEqual(specializeBatchOne(specialized), specialized);
});

test('unsupported variable axes and malformed models are rejected', () => {
    const bytes = modelFixture();
    new DataView(bytes.buffer).setInt32(172, -1, true);
    assert.throws(() => specializeBatchOne(bytes), /Only dynamic batch-one/);
    assert.throws(() => specializeBatchOne(new Uint8Array(10)), /Invalid TFLite/);
});
