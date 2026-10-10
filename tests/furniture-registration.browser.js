import { test, expect } from '@playwright/test';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test('register furniture uploads a selected image and handles measurement progress and failure', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const writes = [];
  const jobId = 'a'.repeat(32);
  let pollCount = 0;
  let rejectUpload = false;
  await page.route('**/api/furniture/**', async (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().headers()['content-type']).toContain('multipart/form-data');
      expect(route.request().postDataBuffer().toString()).toContain('my-chair.png');
      await route.fulfill({ status: rejectUpload ? 503 : 202, json: rejectUpload ? { detail: '측정 서버 설정이 필요합니다.' } : { job_id: jobId } });
    } else {
      pollCount += 1;
      await route.fulfill({ json: pollCount === 1 ? { status: 'running', stage: 'sam3' } : {
        status: 'completed', result: { outcome: 'measured', objects: [{ status: 'ok', width_m: 0.8, depth_m: 0.6, height_m: 0.75 }] },
      } });
    }
  });
  page.on('request', (request) => {
    if (!['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`);
  });

  await page.goto('/?test=1&quality=light');
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'complex', { timeout: 90000 });
  await page.locator('#select-building').click();
  await page.locator('#open-unit').click();
  await page.locator('#studio-room').selectOption('Living front');
  await page.locator('#room-edit').click();

  const button = page.locator('#register-furniture');
  await expect(button).toBeVisible();
  await expect(page.locator('#furniture-image-file')).toBeHidden();

  const chooserPromise = page.waitForEvent('filechooser');
  await button.click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'my-chair.png', mimeType: 'image/png', buffer: ONE_PIXEL_PNG });

  await expect(page.locator('#furniture-image-preview')).toBeVisible();
  await expect(page.locator('#furniture-image-name')).toHaveText('my-chair.png');
  await expect(page.locator('#furniture-image-metadata')).toContainText('1 × 1px');
  await expect(button).toBeDisabled();
  await expect(page.locator('#furniture-image-status')).toContainText('가구 영역을 찾는 중', { timeout: 10000 });
  await expect(page.locator('#furniture-image-status')).toContainText('가구 1개를 측정했어요', { timeout: 10000 });
  await expect(button).toBeEnabled();
  await expect(page.locator('#furniture-image-preview img')).toHaveAttribute('src', /^blob:/);
  expect(writes).toEqual([`POST http://127.0.0.1:5173/api/furniture/measure`]);
  await page.screenshot({ path: testInfo.outputPath('furniture-registration-ready.png') });

  await page.locator('#furniture-image-file').setInputFiles({
    name: 'not-an-image.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image'),
  });
  await expect(page.locator('#furniture-image-status')).toContainText('JPG, PNG, WebP');
  await expect(page.locator('#furniture-image-name')).toHaveText('my-chair.png');
  expect(writes).toHaveLength(1);

  rejectUpload = true;
  await page.locator('#furniture-image-file').setInputFiles({ name: 'my-chair.png', mimeType: 'image/png', buffer: ONE_PIXEL_PNG });
  await expect(page.locator('#furniture-image-status')).toContainText('측정 서버 설정이 필요합니다.');
  await expect(button).toBeEnabled();
});
