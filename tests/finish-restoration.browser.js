import { test, expect } from '@playwright/test';

for (const variant of ['112a-basic-archisketch', '112a-expanded-archisketch']) {
  test(`${variant}: oak and stone return to the original rendered material set`, async ({ page }, info) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const form = variant.includes('-basic-') ? 'basic' : 'expanded';
    const modelPath = `/archisketch-metric-v1/${form}/acro112a-${form}.glb`;
    const modelResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(modelPath));
    await page.goto(`/?studio=0&variant=${variant}&test=1&quality=light&finish=original`);
    expect((await modelResponse).ok(), 'active GLB and metadata must use the same UV revision').toBe(true);
    await expect(page.locator('body')).toHaveAttribute('data-load-state', 'ready', { timeout: 90000 });
    await page.locator('#view-settings summary').click();
    const state = () => page.evaluate(() => window.__walkthrough.getState());
    const initial = await state();
    const interior = await page.evaluate(() => window.__walkthrough.inspectInterior());
    expect(interior.finishRevision).toBe('archisketch-metric-v1');
    const canvas = page.locator('canvas').first();
    // Element screenshots include overlaid HTML; only the status sentence changes.
    const original = await canvas.screenshot({ path: info.outputPath('original-before.png'), mask: [page.locator('#status')] });
    for (const preset of ['oak', 'stone', 'original']) {
      await page.locator('#finish').selectOption(preset);
      await expect.poll(async () => (await state()).finish).toBe(preset);
      await expect(page.locator('body')).toHaveAttribute('data-finish-state', 'ready');
      const current = await state();
      expect(current.scale).toEqual(initial.scale);
      expect(current.position).toEqual(initial.position);
      expect(current.doors).toEqual(initial.doors);
      expect(current.batching).toEqual(initial.batching);
      if (preset !== 'original') {
        expect((await page.evaluate(() => window.__walkthrough.textureInfo())).length).toBeGreaterThan(0);
      }
    }
    expect(await page.evaluate(() => window.__walkthrough.inspectInterior())).toEqual(interior);
    const restored = await canvas.screenshot({ path: info.outputPath('original-restored.png'), mask: [page.locator('#status')] });
    expect(restored.equals(original), 'unchanged camera and lighting should restore the same canvas pixels').toBe(true);
    expect(errors).toEqual([]);
  });
}
