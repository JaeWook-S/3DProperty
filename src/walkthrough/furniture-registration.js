export const MAX_FURNITURE_IMAGE_BYTES = 20 * 1024 * 1024;

const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

function extensionOf(name = '') {
  const match = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? '';
}

export function validateFurnitureImageFile(file) {
  if (!file) return { ok: false, message: '이미지 파일을 선택해 주세요.' };
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, message: '비어 있거나 읽을 수 없는 파일이에요.' };
  if (file.size > MAX_FURNITURE_IMAGE_BYTES) return { ok: false, message: '이미지는 20MB 이하로 선택해 주세요.' };
  const mime = String(file.type || '').toLowerCase();
  const supported = mime ? MIME_TYPES.has(mime) : EXTENSIONS.has(extensionOf(file.name));
  if (!supported) return { ok: false, message: 'JPG, PNG, WebP 이미지만 선택할 수 있어요.' };
  return { ok: true };
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
}

function probeImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('decode'));
    image.src = url;
  });
}

const STAGES = {
  uploaded: '이미지를 전송했어요. 측정을 시작합니다…',
  preprocessing: '이미지를 준비하는 중…',
  sam3: '가구 영역을 찾는 중…',
  moge3_postprocessing: '가구 치수를 계산하는 중…',
};

async function readResponse(response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : '측정 서버에 연결하지 못했습니다. 서버 연결을 확인해 주세요.';
    throw new Error(detail);
  }
  if (!body) throw new Error('측정 서버가 올바른 응답을 보내지 않았습니다.');
  return body;
}

function pause(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const stop = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, milliseconds);
    if (signal?.aborted) stop();
    else signal?.addEventListener('abort', stop, { once: true });
  });
}

// The browser talks to Vite's same-origin proxy, not directly to a GPU host.
export async function measureFurnitureImage(file, {
  fetchImpl = globalThis.fetch, signal, onStage = () => {}, pollIntervalMs = 2000,
  timeoutMs = 65 * 60 * 1000,
} = {}) {
  const form = new FormData();
  form.append('image', file, file.name);
  const accepted = await readResponse(await fetchImpl('/api/furniture/measure', { method: 'POST', body: form, signal }));
  if (!/^[a-f0-9]{32}$/.test(accepted.job_id)) throw new Error('측정 작업 ID를 확인하지 못했습니다.');
  onStage('uploaded');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await pause(pollIntervalMs, signal);
    const job = await readResponse(await fetchImpl(`/api/furniture/jobs/${accepted.job_id}`, { signal, cache: 'no-store' }));
    if (job.status === 'completed') return job;
    if (job.status === 'failed') throw new Error(job.error || '가구 측정에 실패했습니다. 서버 터미널을 확인해 주세요.');
    if (!['accepted', 'running'].includes(job.status)) throw new Error('알 수 없는 측정 상태입니다.');
    onStage(job.stage);
  }
  throw new Error(`측정 응답 대기 시간이 지났습니다. 서버 터미널에서 작업 ${accepted.job_id}을 확인해 주세요.`);
}

export function setupFurnitureImageRegistration({
  button, input, panel, preview, name, metadata, status,
  onMeasurementStart = () => {}, onMeasurementComplete = () => {},
  measurementEnabled = import.meta.env?.VITE_FURNITURE_MEASUREMENT_ENABLED !== '0',
}) {
  let selectedFile = null;
  let previewUrl = null;
  let busy = false;
  const lifetime = new AbortController();

  function message(text, state) {
    status.textContent = text;
    status.dataset.state = state;
  }

  if (!measurementEnabled) message('웹 전용 모드입니다. 이미지 미리보기는 가능하지만 GPU 모델 측정은 실행하지 않습니다.', 'offline');

  button.addEventListener('click', () => {
    // Reset only the native control so selecting the same file emits change.
    // The last successful preview remains when the picker is canceled.
    input.value = '';
    input.click();
  });

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file || busy) return;
    const validation = validateFurnitureImageFile(file);
    if (!validation.ok) {
      message(validation.message, 'error');
      return;
    }

    const candidateUrl = URL.createObjectURL(file);
    busy = true;
    button.disabled = true;
    message('이미지를 확인하는 중…', 'loading');
    try {
      const dimensions = await probeImage(candidateUrl);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = candidateUrl;
      selectedFile = file;
      preview.src = previewUrl;
      preview.alt = `등록할 가구 미리보기: ${file.name}`;
      name.textContent = file.name;
      metadata.textContent = `${dimensions.width} × ${dimensions.height}px · ${formatFileSize(file.size)} · ${file.type || extensionOf(file.name).toUpperCase()}`;
      panel.hidden = false;
    } catch {
      URL.revokeObjectURL(candidateUrl);
      busy = false;
      button.disabled = false;
      message('이미지 내용을 읽지 못했습니다. 다른 파일을 선택해 주세요.', 'error');
      return;
    }
    try {
      onMeasurementStart(selectedFile);
      if (!measurementEnabled) {
        message('이미지를 Mac에서 확인했어요. GPU 서버 미연결로 모델 측정·서버 전송은 하지 않습니다.', 'offline');
        return;
      }
      message('이미지를 전송하는 중…', 'loading');
      const job = await measureFurnitureImage(selectedFile, {
        signal: lifetime.signal,
        onStage: (stage) => message(STAGES[stage] || '가구를 측정하는 중…', 'loading'),
      });
      const objects = job.result?.objects || [];
      const measured = objects.filter((object) => object.status === 'ok');
      if (measured.length) message(`가구 ${measured.length}개를 측정했어요. 결과를 서버 터미널에 출력했습니다.`, 'ready');
      else if (!objects.length) message('가구를 찾지 못했어요. 가구가 잘 보이는 사진을 선택해 주세요.', 'error');
      else message('가구 영역은 찾았지만 치수를 계산하지 못했어요. 다른 각도의 사진을 선택해 주세요.', 'error');
      onMeasurementComplete(job, selectedFile);
    } catch (error) {
      if (error.name !== 'AbortError') message(error.message || '측정 서버에 연결하지 못했습니다.', 'error');
    } finally {
      busy = false;
      button.disabled = false;
    }
  });

  window.addEventListener('pagehide', () => {
    lifetime.abort();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, { once: true });

  return { get selectedFile() { return selectedFile; } };
}
