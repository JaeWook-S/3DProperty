import { test, expect } from '@playwright/test';

const image = {
  name: 'my-chair.png', mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
};
const jobId = 'a'.repeat(32);

test('existing service uploads an image, displays dimensions and retains the JSON tools', async ({ page }, testInfo) => {
  const errors = [], uploads = [];
  page.on('pageerror', error => errors.push(error.message));
  let polls = 0;
  await page.route('**/api/furniture/**', async route => {
    if (route.request().method() === 'POST') {
      uploads.push(route.request());
      expect(route.request().headers()['content-type']).toContain('multipart/form-data');
      expect(route.request().postDataBuffer().toString()).toContain(image.name);
      await route.fulfill({ status: 202, json: { job_id: jobId } });
    } else {
      polls += 1;
      await route.fulfill({ json: polls === 1 ? { status: 'running', stage: 'sam3' } : {
        status: 'completed', result: { outcome: 'measured', objects: [
          { status: 'ok', label: '<img src=x onerror=alert(1)>', width_m: 0.8, depth_m: 0.6, height_m: 0.75 },
          { status: 'insufficient_geometry', label: 'table', width_m: 99, depth_m: 99, height_m: 99, reason: '점군 부족' },
        ] },
      } });
    }
  });
  await page.goto('/');
  await expect(page.locator('#space-panel')).toBeVisible();
  await expect(page.locator('#furniture-panel')).toBeHidden();
  await page.locator('#furniture-tab').click();
  const chooserWait = page.waitForEvent('filechooser');
  await page.locator('#register-furniture').click();
  await (await chooserWait).setFiles(image);
  await expect(page.locator('#furniture-image-name')).toHaveText(image.name);
  await expect(page.locator('#furniture-image-metadata')).toContainText('1 × 1px');
  await expect(page.locator('#register-furniture')).toBeDisabled();
  await expect(page.locator('#furniture-image-status')).toContainText('가구 영역을 찾는 중', { timeout: 10000 });
  await expect(page.locator('#furniture-image-status')).toContainText('가구 1개를 측정했어요', { timeout: 10000 });
  const result = page.locator('#image-measurement-result');
  await expect(result).toBeVisible();
  await expect(result.locator('.measurement-object').first().locator('.dimensions strong')).toHaveText(['80 cm', '60 cm', '75 cm']);
  await expect(result.locator('.measurement-object').nth(1).locator('.dimensions strong')).toHaveText(['미정', '미정', '미정']);
  await expect(result.locator('img')).toHaveCount(0);
  await page.locator('#measurement-unit').selectOption('mm');
  await expect(result.locator('.measurement-object').first().locator('.dimensions strong')).toHaveText(['800 mm', '600 mm', '750 mm']);
  await expect(page.locator('#register-furniture')).toBeEnabled();

  await page.locator('#load-example').click();
  await expect(page.locator('#result')).toHaveAttribute('data-status', 'valid');
  await expect(page.locator('#result .dimensions')).toContainText('120 cm');
  await page.locator('#display-unit').selectOption('mm');
  await expect(page.locator('#result .dimensions')).toContainText('1,200 mm');
  await expect(result).toBeVisible();
  expect(uploads).toHaveLength(1);
  expect(uploads[0].url()).toBe('http://127.0.0.1:5185/api/furniture/measure');
  await page.screenshot({ path: testInfo.outputPath('service-image-measurement.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('service-image-measurement-mobile.png') });
  await result.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('service-image-measurement-mobile-result.png') });
  expect(errors).toEqual([]);
});

test('invalid image and unavailable server remain retryable without affecting JSON import', async ({ page }) => {
  let uploads = 0;
  await page.route('**/api/furniture/measure', async route => {
    uploads += 1;
    await route.fulfill({ status: 503, json: { detail: '측정 서버에 연결할 수 없습니다.' } });
  });
  await page.goto('/');
  await page.locator('#furniture-tab').click();
  await page.locator('#furniture-image-file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
  await expect(page.locator('#furniture-image-status')).toContainText('JPG, PNG, WebP');
  expect(uploads).toBe(0);
  await page.locator('#furniture-image-file').setInputFiles(image);
  await expect(page.locator('#furniture-image-status')).toContainText('측정 서버에 연결할 수 없습니다.');
  await expect(page.locator('#register-furniture')).toBeEnabled();
  await expect(page.locator('#image-measurement-result')).toBeHidden();
  await page.locator('#load-example').click();
  await expect(page.locator('#result')).toHaveAttribute('data-status', 'valid');
  expect(uploads).toBe(1);
});

test('no detection and insufficient geometry never display invented dimensions', async ({ page }) => {
  let objects = [];
  await page.route('**/api/furniture/**', async route => {
    await route.fulfill(route.request().method() === 'POST' ? { status: 202, json: { job_id: jobId } } : {
      json: { status: 'completed', result: { outcome: objects.length ? 'insufficient_geometry' : 'no_detection', objects } },
    });
  });
  await page.goto('/');
  await page.locator('#furniture-tab').click();
  await page.locator('#furniture-image-file').setInputFiles(image);
  await expect(page.locator('#image-measurement-result')).toContainText('가구를 찾지 못했습니다.', { timeout: 10000 });
  objects = [{ status: 'insufficient_geometry', label: 'chair', width_m: null, depth_m: null, height_m: null }];
  await page.locator('#furniture-image-file').setInputFiles(image);
  await expect(page.locator('#image-measurement-result .dimensions strong')).toHaveText(['미정', '미정', '미정'], { timeout: 10000 });
  await expect(page.locator('#measurement-unit')).toBeDisabled();
});

test('web-only mode keeps the image preview and JSON tools without sending an API request', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/furniture/**', route => { requests += 1; return route.abort(); });
  // Test the launcher's disabled setting without changing the user's Vite server.
  await page.route('**/furniture-registration.js*', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const body = source.replace("measurementEnabled = import.meta.env?.VITE_FURNITURE_MEASUREMENT_ENABLED !== '0'", 'measurementEnabled = false');
    expect(body).not.toBe(source);
    await route.fulfill({ response, body });
  });
  await page.goto('/');
  await expect(page.locator('#space-panel')).toBeVisible();
  await expect(page.locator('#open-viewer')).toHaveAttribute('href', /5173/);
  await page.locator('#furniture-tab').click();
  await expect(page.locator('#furniture-image-status')).toContainText('웹 전용 모드');
  await page.locator('#furniture-image-file').setInputFiles(image);
  await expect(page.locator('#furniture-image-preview')).toBeVisible();
  await expect(page.locator('#furniture-image-name')).toHaveText(image.name);
  await expect(page.locator('#furniture-image-status')).toContainText('서버 전송은 하지 않습니다.');
  await expect(page.locator('#register-furniture')).toBeEnabled();
  await expect(page.locator('#image-measurement-result')).toBeHidden();
  await page.locator('#load-example').click();
  await expect(page.locator('#result')).toHaveAttribute('data-status', 'valid');
  expect(requests).toBe(0);
});
