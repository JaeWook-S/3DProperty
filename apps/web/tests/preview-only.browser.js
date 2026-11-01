import { test, expect } from '@playwright/test';
import {mockMap} from './map-fixtures.js';
// Exercise the real startup flag, without intercepting source or mocking requests.
// Run while the API is absent (or with VITE_FURNITURE_MEASUREMENT_ENABLED=0).
test('API-offline dev keeps previews in both apps and sends no furniture request', async({page,context})=>{
 test.skip(process.env.CORTEX_EXPECT_API_OFFLINE!=='1','Run with CORTEX_EXPECT_API_OFFLINE=1 against preview-only dev servers.');
 const requests=[];context.on('request',r=>{if(r.url().includes('/api/furniture'))requests.push(r.url());});
 await mockMap(page);await page.goto('/');await page.locator('#furniture-tab').click();
 const file={name:'chair.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')};
 await expect(page.locator('#furniture-image-status')).toHaveAttribute('data-state','offline');
 await page.locator('#furniture-image-file').setInputFiles(file);
 await expect(page.locator('#furniture-image-status')).toContainText('서버 전송은 하지 않습니다');
 await expect(page.locator('#furniture-image-preview')).toBeVisible();
 await page.locator('#space-tab').click();
 await page.locator('[data-place-id="acro-river-park"]').click();await page.locator('#selected-building').selectOption('100');await page.locator('#selected-floor').selectOption('7');await page.locator('#open-3d').click();const viewer=page.frameLocator('#service-viewer');
 await expect(viewer.locator('body')).toHaveAttribute('data-studio-mode','overview',{timeout:90000});
 await viewer.locator('#room-edit').click();
 await expect(viewer.locator('#furniture-image-status')).toHaveAttribute('data-state','offline');
 await viewer.locator('#furniture-image-file').setInputFiles(file);
 await expect(viewer.locator('#furniture-image-status')).toContainText('서버 전송은 하지 않습니다');
 await expect(viewer.locator('#furniture-image-preview')).toBeVisible();
 expect(requests).toEqual([]);
});
