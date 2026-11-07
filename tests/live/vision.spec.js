import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';

// Official MediaPipe test images, downloaded only for this optional live check.
const fixtures = [
    { name: 'right_hands.jpg', hands: 2, sha256: '4b5134daa4cb60465535239535f9f74c2842aba3aa5fd30bf04ef5678f93d87f' },
    { name: 'woman_hands.jpg', hands: 2, sha256: '70cbeb38e198c9862202e0979c21a99b40ca980d3e7b250176c85b1636a40f12' },
    { name: 'fist.jpg', hands: 1, sha256: '43fa1cabf3f90d574accc9a56986e2ee48638ce59fc65af1846487f73bb2ef24' },
];

async function serveFixture(page, request, fixture) {
    const response = await request.get(`https://storage.googleapis.com/mediapipe-assets/${fixture.name}`);
    expect(response.ok()).toBe(true);
    const body = await response.body();
    expect(createHash('sha256').update(body).digest('hex')).toBe(fixture.sha256);
    await page.route(`**/__fixtures/${fixture.name}`, route => route.fulfill({ contentType: 'image/jpeg', body }));
}

test('real LiteRT graphs detect both hands and recognize a closed fist', async ({ page, request }) => {
    for (const fixture of fixtures) {
        await serveFixture(page, request, fixture);
    }
    await page.goto('/');
    const result = await page.evaluate(async names => {
        const { createGestureModel } = await import('/shared/gesture-model.js');
        const model = await createGestureModel();
        const results = [];
        try {
            for (const name of names) {
                const image = new Image();
                image.src = `/__fixtures/${name}`;
                await image.decode();
                const started = performance.now();
                const inference = await model.recognizeForVideo(image, started);
                results.push({ name, ms: performance.now() - started, ...inference });
            }
            return { backend: model.backend, results };
        } finally { model.close(); }
    }, fixtures.map(fixture => fixture.name));
    expect(result.backend).toBe('litert-wasm');
    for (const [index, inference] of result.results.entries()) {
        expect(inference.landmarks).toHaveLength(fixtures[index].hands);
        for (const hand of inference.landmarks) {
            expect(hand).toHaveLength(21);
            for (const point of hand) {
                expect([point.x, point.y, point.z].every(Number.isFinite)).toBe(true);
                expect(point.x).toBeGreaterThan(-0.1);
                expect(point.x).toBeLessThan(1.1);
                expect(point.y).toBeGreaterThan(-0.1);
                expect(point.y).toBeLessThan(1.1);
            }
        }
    }
    const fist = result.results[2].gestures[0][0];
    expect(fist.categoryName).toBe('Closed_Fist');
    expect(fist.score).toBeGreaterThan(0.8);
    console.log('Real LiteRT vision:', result.results.map(({ name, ms, landmarks, gestures }) => ({ name, ms, hands: landmarks.length, gestures })));
});

test('real inference updates game pointers and switching controls stops its video stream', async ({ page, request }) => {
    await serveFixture(page, request, fixtures[2]);
    await page.addInitScript(() => {
        // A real video track with a known image exercises the camera-to-worker
        // integration without accessing a physical webcam in an automated test.
        Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
            const image = new Image();
            image.src = '/__fixtures/fist.jpg';
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.width; canvas.height = image.height;
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            const stream = canvas.captureStream(10);
            window.fixtureStream = stream;
            const paint = () => {
                if (stream.getTracks().every(track => track.readyState === 'ended')) return;
                context.drawImage(image, 0, 0);
                requestAnimationFrame(paint);
            };
            requestAnimationFrame(paint);
            return stream;
        } });
    });
    await page.goto('/games/air-hockey/');
    await page.getByRole('button', { name: 'Use camera', exact: true }).click();
    await expect(page.locator('#btn1P')).toBeVisible({ timeout: 60000 });
    await page.locator('#btn1P').click();
    await expect.poll(() => page.evaluate(async () => {
        const { getPointers, getGestures } = await import('/shared/hand-tracker.js');
        return getPointers().some(pointer => pointer.active) && getGestures().includes('Closed_Fist');
    }), { timeout: 30000 }).toBe(true);
    await page.getByRole('button', { name: /Pause/ }).click();
    await page.getByRole('button', { name: 'Turn camera off · use pointer' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-input-mode', 'pointer');
    expect(await page.evaluate(() => window.fixtureStream.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
    await page.getByRole('button', { name: 'Resume game' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-paused', 'false');
});
