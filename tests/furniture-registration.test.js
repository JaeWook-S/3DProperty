import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_FURNITURE_IMAGE_BYTES, formatFileSize, validateFurnitureImageFile, measureFurnitureImage, setupFurnitureImageRegistration } from '../src/walkthrough/furniture-registration.js';

const file = (overrides = {}) => ({ name: 'chair.png', type: 'image/png', size: 2048, ...overrides });

test('furniture image validation accepts supported image types and extension fallback', () => {
  assert.deepEqual(validateFurnitureImageFile(file()), { ok: true });
  assert.deepEqual(validateFurnitureImageFile(file({ name: 'SOFA.JPEG', type: '' })), { ok: true });
  assert.deepEqual(validateFurnitureImageFile(file({ name: 'table.webp', type: 'image/webp' })), { ok: true });
});

test('furniture image validation rejects empty, oversized and unsupported files', () => {
  assert.match(validateFurnitureImageFile(null).message, /선택/);
  assert.match(validateFurnitureImageFile(file({ size: 0 })).message, /비어/);
  assert.match(validateFurnitureImageFile(file({ size: MAX_FURNITURE_IMAGE_BYTES + 1 })).message, /20MB/);
  assert.match(validateFurnitureImageFile(file({ name: 'notes.txt', type: 'text/plain' })).message, /JPG/);
});

test('file sizes use compact readable units', () => {
  assert.equal(formatFileSize(512), '512 B');
  assert.equal(formatFileSize(1536), '1.5 KB');
  assert.equal(formatFileSize(2 * 1024 ** 2), '2.0 MB');
});

const imageFile = () => new File(['image bytes'], 'chair.png', { type: 'image/png' });
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const jobId = 'a'.repeat(32);

test('measurement sends multipart image then polls the same job until completed', async () => {
  const calls = [], stages = [];
  const replies = [reply({ job_id: jobId }, 202), reply({ status: 'running', stage: 'sam3' }), reply({ status: 'completed', result: { outcome: 'measured', objects: [] } })];
  const result = await measureFurnitureImage(imageFile(), {
    pollIntervalMs: 0, onStage: (stage) => stages.push(stage),
    fetchImpl: async (url, options) => { calls.push({ url, options }); return replies.shift(); },
  });
  assert.equal(calls[0].url, '/api/furniture/measure');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.body.get('image').name, 'chair.png');
  assert.equal(calls[1].url, `/api/furniture/jobs/${jobId}`);
  assert.deepEqual(stages, ['uploaded', 'sam3']);
  assert.equal(result.status, 'completed');
});

test('measurement reports upload rejection and worker failure instead of success', async () => {
  await assert.rejects(measureFurnitureImage(imageFile(), { fetchImpl: async () => reply({ detail: '서버 설치 필요' }, 503) }), /서버 설치 필요/);
  const replies = [reply({ job_id: jobId }, 202), reply({ status: 'failed', error: 'CUDA memory exhausted' })];
  await assert.rejects(measureFurnitureImage(imageFile(), { pollIntervalMs: 0, fetchImpl: async () => replies.shift() }), /CUDA memory exhausted/);
});

test('measurement respects aborted polling and rejects invalid server job IDs', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(measureFurnitureImage(imageFile(), { signal: controller.signal, pollIntervalMs: 0, fetchImpl: async () => reply({ job_id: jobId }, 202) }), { name: 'AbortError' });
  await assert.rejects(measureFurnitureImage(imageFile(), { fetchImpl: async () => reply({ job_id: '../unsafe' }, 202) }), /작업 ID/);
});

test('web-only registration previews the image and never sends it to the server', async t => {
  const originalImage = globalThis.Image;
  const originalWindow = globalThis.window;
  globalThis.Image = class {
    naturalWidth = 640;
    naturalHeight = 480;
    set src(value) { queueMicrotask(() => this.onload()); }
  };
  const pageListeners = {};
  globalThis.window = { addEventListener: (event, callback) => { pageListeners[event] = callback; } };
  t.after(() => {
    pageListeners.pagehide?.();
    if (originalImage === undefined) delete globalThis.Image; else globalThis.Image = originalImage;
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
  });
  let uploads = 0;
  t.mock.method(globalThis, 'fetch', async () => { uploads += 1; throw new Error('Must not upload in web-only mode'); });
  const element = () => ({ dataset: {}, listeners: {}, addEventListener(event, callback) { this.listeners[event] = callback; } });
  const button = element(), input = element(), panel = element(), preview = element(), name = element(), metadata = element(), status = element();
  const starts = [], completed = [];
  setupFurnitureImageRegistration({ button, input, panel, preview, name, metadata, status, measurementEnabled: false,
    onMeasurementStart: file => starts.push(file.name), onMeasurementComplete: job => completed.push(job),
  });
  assert.match(status.textContent, /웹 전용 모드/);
  input.files = [imageFile()];
  await input.listeners.change();
  assert.equal(panel.hidden, false);
  assert.equal(name.textContent, 'chair.png');
  assert.match(metadata.textContent, /640 × 480px/);
  assert.match(preview.src, /^blob:/);
  assert.match(status.textContent, /서버 전송은 하지 않습니다/);
  assert.equal(button.disabled, false);
  assert.equal(uploads, 0);
  assert.deepEqual(starts, ['chair.png']);
  assert.deepEqual(completed, []);
  // The file picker remains usable for another local preview.
  input.files = [imageFile()];
  await input.listeners.change();
  assert.equal(starts.length, 2);
  assert.equal(uploads, 0);
});
