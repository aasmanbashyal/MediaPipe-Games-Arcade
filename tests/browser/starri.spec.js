import { test, expect } from '@playwright/test';

for (const [layout, viewport] of Object.entries({
    portrait: { width: 390, height: 844 }, landscape: { width: 844, height: 390 },
})) {
    test(`Starri pointer calibration reaches gameplay in ${layout}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.route('https://**/*', route => route.abort());
        await page.clock.install();
        await page.goto('/games/starri-motion/');
        await page.getByRole('button', { name: 'Mouse or touch' }).click();
        await page.locator('[data-level="easy"]').click();
        await page.clock.runFor(100);
        await expect(page.locator('body')).toHaveAttribute('data-game-state', 'calibrating');
        await expect(page.locator('#calibrationHint')).toContainText('pointer');
        const ring = await page.locator('#calibrationRing').boundingBox();
        const field = await page.locator('#gameCanvas').boundingBox();
        const title = await page.locator('#calibrationTitle').boundingBox();
        const hint = await page.locator('#calibrationHint').boundingBox();
        expect(title.y + title.height).toBeLessThanOrEqual(hint.y + 1);
        expect(hint.y + hint.height).toBeLessThanOrEqual(ring.y + 1);
        const center = { x: ring.x + ring.width / 2, y: ring.y + ring.height / 2 };
        expect(Math.abs(center.x - (field.x + field.width * 0.5))).toBeLessThan(1);
        expect(Math.abs(center.y - (field.y + field.height * 0.48))).toBeLessThan(1);
        // Native hit testing proves the visible overlay no longer eats input.
        expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, center)).toBe('gameCanvas');
        await page.mouse.move(center.x, center.y);
        await page.clock.runFor(2200);
        await expect(page.locator('body')).toHaveAttribute('data-game-state', 'countdown');
        await page.clock.runFor(3800);
        await expect(page.locator('body')).toHaveAttribute('data-game-state', 'playing');
        await expect(page.locator('#hudOverlay')).toBeVisible();
        await expect(page.locator('#calibrationOverlay')).not.toBeVisible();
    });
}

test('Starri touch calibration requires a continuous hold inside the visible ring', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('https://**/*', route => route.abort());
    await page.clock.install();
    await page.goto('/games/starri-motion/');
    await page.getByRole('button', { name: 'Mouse or touch' }).click();
    await page.locator('[data-level="easy"]').click();
    await page.clock.runFor(100);
    const ring = await page.locator('#calibrationRing').boundingBox();
    const canvas = page.locator('#gameCanvas');
    const pointer = { pointerId: 7, pointerType: 'touch', clientX: ring.x + ring.width / 2, clientY: ring.y + ring.height / 2 };
    // Dispatch models a held contact; hit testing is covered by the tests above.
    await page.evaluate(() => { document.querySelector('#gameCanvas').setPointerCapture = () => {}; });
    await canvas.dispatchEvent('pointerdown', pointer);
    await page.clock.runFor(1200);
    await canvas.dispatchEvent('pointerup', pointer);
    await page.clock.runFor(1200);
    await expect(page.locator('body')).toHaveAttribute('data-game-state', 'calibrating');
    await canvas.dispatchEvent('pointerdown', pointer);
    await page.clock.runFor(2200);
    await expect(page.locator('body')).toHaveAttribute('data-game-state', 'countdown');
    await canvas.dispatchEvent('pointerup', pointer);
    await page.clock.runFor(3800);
    await expect(page.locator('body')).toHaveAttribute('data-game-state', 'playing');
});
