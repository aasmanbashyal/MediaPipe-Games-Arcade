import { test, expect } from '@playwright/test';

const games = ['air-hockey', 'bubble-pop', 'fruit-ninja', 'reaction-duel', 'shadow-puppets', 'starri-motion'];

test.beforeEach(async ({ page }) => {
    // Local pointer play must work even when every external service is unavailable.
    await page.route('https://**/*', route => route.abort());
});

test('hub exposes all games with keyboard access and no horizontal overflow', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.game-card')).toHaveCount(6);
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();
    await page.keyboard.press('Enter');
    await page.locator('.game-card').last().scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const game of games) await expect(page.locator(`a[href="games/${game}/index.html"]`)).toBeVisible();
});

for (const game of games) {
    test(`${game}: start, pause, resume, and restart without camera or network`, async ({ page }) => {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.clock.install();
        await page.goto(`/games/${game}/`);
        await expect(page.getByRole('button', { name: 'Mouse or touch' })).toBeVisible();
        await page.getByRole('button', { name: 'Mouse or touch' }).click();
        await page.locator('.mode-card, .level-card, .diff-card').first().click();
        const box = await page.locator('#gameCanvas').boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.48);
        await page.clock.runFor(game === 'starri-motion' ? 6000 : 3500);
        await expect(page.locator('#pauseGameBtn')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

        await page.locator('#pauseGameBtn').click();
        await expect(page.getByRole('dialog', { name: 'Game paused' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Resume game' })).toBeFocused();
        const hud = await page.locator('#hudOverlay').textContent();
        await page.clock.runFor(6000);
        expect(await page.locator('#hudOverlay').textContent()).toBe(hud);
        await page.getByRole('button', { name: 'Resume game' }).click();
        await expect(page.locator('body')).toHaveAttribute('data-paused', 'false');
        await page.clock.runFor(250);
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Restart round' }).click();
        await page.clock.runFor(100);
        await expect(page.getByRole('dialog')).not.toBeVisible();
        await expect(page.locator('#pauseGameBtn')).toBeVisible();
        expect(errors).toEqual([]);
    });
}

test('denied camera explains recovery and pointer play remains available', async ({ page }) => {
    await page.route('**/shared/gesture-model.js', route => route.fulfill({
        contentType: 'text/javascript',
        body: 'export async function createGestureModel(){return {recognizeForVideo(){return {landmarks:[]}},close(){}}}',
    }));
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
            getUserMedia: async () => { throw new DOMException('Permission denied', 'NotAllowedError'); },
        } });
    });
    await page.goto('/games/air-hockey/');
    await page.getByRole('button', { name: 'Use camera', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(/permission|denied|blocked/i);
    await expect(page.getByRole('button', { name: 'Retry camera' })).toBeEnabled();
    await page.getByRole('button', { name: 'Mouse or touch' }).click();
    await expect(page.locator('#btn1P')).toBeVisible();
});

test('pointer coordinates match the mirrored playfield and release off canvas', async ({ page }) => {
    await page.goto('/games/air-hockey/');
    await page.getByRole('button', { name: 'Mouse or touch' }).click();
    await page.locator('#btn1P').click();
    const box = await page.locator('#gameCanvas').boundingBox();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.4);
    const pointer = await page.evaluate(async () => {
        const { getPointers } = await import('/shared/hand-tracker.js');
        const { x, y, active } = getPointers()[0];
        return { x, y, active };
    });
    expect(pointer.active).toBe(true);
    expect(pointer.x).toBeCloseTo(0.8, 2);
    expect(pointer.y).toBeCloseTo(0.4, 2);
    await page.mouse.move(0, 0);
    expect(await page.evaluate(async () => (await import('/shared/hand-tracker.js')).getPointers()[0].active)).toBe(false);
});

test('a held practice gesture clears when the game loses focus', async ({ page }) => {
    await page.goto('/games/shadow-puppets/');
    await page.getByRole('button', { name: 'Mouse or touch' }).click();
    await page.keyboard.down('2');
    const gestures = () => page.evaluate(async () => (await import('/shared/hand-tracker.js')).getGestures());
    expect(await gestures()).toContain('Closed_Fist');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    expect(await gestures()).toEqual(['None', 'None']);
    await page.keyboard.up('2');
});

test('returning from page cache requires controls before resuming', async ({ page }) => {
    await page.goto('/games/air-hockey/');
    await page.getByRole('button', { name: 'Mouse or touch' }).click();
    await page.locator('#btn1P').click();
    await page.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await expect(page.getByRole('dialog', { name: 'Game paused' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume game' })).toBeDisabled();
    await page.getByRole('button', { name: 'Mouse or touch' }).click();
    await expect(page.getByRole('button', { name: 'Resume game' })).toBeEnabled();
    await page.getByRole('button', { name: 'Resume game' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-input-mode', 'pointer');
    await expect(page.locator('body')).toHaveAttribute('data-paused', 'false');
});

test('switching to pointer while the camera model loads disposes its late result', async ({ page }) => {
    await page.route('**/shared/gesture-model.js', route => route.fulfill({
        contentType: 'text/javascript',
        body: `export function createGestureModel() {
            return new Promise(resolve => { window.finishModel = () => resolve({ close() { window.modelClosed = true; } }); });
        }`,
    }));
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
            getUserMedia: async () => { window.cameraRequested = true; throw new Error('Should not request camera'); },
        } });
    });
    await page.goto('/games/air-hockey/');
    await page.getByRole('button', { name: 'Use camera', exact: true }).click();
    await page.waitForFunction(() => typeof window.finishModel === 'function');
    await page.getByRole('button', { name: 'Mouse or touch' }).click();
    await page.evaluate(() => window.finishModel());
    await page.waitForFunction(() => window.modelClosed);
    expect(await page.evaluate(() => Boolean(window.cameraRequested))).toBe(false);
    await expect(page.locator('body')).toHaveAttribute('data-input-mode', 'pointer');
    await expect(page.locator('#btn1P')).toBeVisible();
});
