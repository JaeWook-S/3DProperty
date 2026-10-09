import * as THREE from 'three';
import './window-view.css';

// Window views for the 112A walkthrough (W7-07). The official ACRO River Park photo
// stays the main background; a viewer can try their own 360° photo from the window,
// which is how a real capture from the unit's floor would be shown later.

const $ = (id) => document.getElementById(id);
const UPLOAD_NOTE = '창밖: 직접 불러온 360° 사진 · 방향은 슬라이더로 맞춰요';

export function createWindowView(hooks) {
  const state = { texture: null, heading: 0, note: null };
  const { group, photo } = hooks.exterior;

  // Panorama sphere around the unit at eye height so the horizon stays level.
  const geometry = new THREE.SphereGeometry(70, 96, 48);
  geometry.scale(-1, 1, 1); // view the texture from inside without mirroring it
  const sphere = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ toneMapped: false, depthWrite: false }));
  sphere.name = 'Window view panorama';
  sphere.position.set(7, 1.6, 5);
  sphere.renderOrder = -1;
  sphere.visible = false;
  group.add(sphere);

  function sync() {
    const custom = Boolean(state.texture);
    sphere.visible = custom;
    sphere.material.map = state.texture;
    sphere.material.needsUpdate = true;
    sphere.rotation.y = (state.heading * Math.PI) / 180;
    if (photo) photo.visible = !custom;
    const badge = $('exterior-note');
    if (badge && custom && badge.textContent !== UPLOAD_NOTE) { state.note = badge.textContent; badge.textContent = UPLOAD_NOTE; }
    if (badge && !custom && state.note) { badge.textContent = state.note; state.note = null; }
    reset.hidden = !custom;
    heading.closest('.wv-heading').hidden = !custom;
    hooks.invalidate();
  }

  const section = document.createElement('details');
  section.id = 'window-view';
  section.className = 'wv';
  section.innerHTML = `
    <summary>내 360° 사진으로 창밖 바꾸기</summary>
    <label class="wv-file">360° 사진 선택<input id="wv-file" type="file" accept="image/*"></label>
    <p class="wv-hint" id="wv-file-status">창가에서 찍은 2:1 파노라마를 권장해요. 사진은 이 브라우저 안에서만 쓰고 업로드하지 않아요.</p>
    <div class="wv-heading" hidden><label class="wv-label" for="wv-photo-heading">사진 방향 맞추기 <output id="wv-photo-heading-value">0°</output></label>
    <input id="wv-photo-heading" type="range" min="0" max="359" step="1" value="0"></div>
    <button type="button" id="wv-reset" hidden>공식 사진으로 돌아가기</button>`;
  const anchor = $('exterior-enabled')?.closest('label');
  (anchor ?? $('room-picker')).after(section);
  const heading = $('wv-photo-heading'), reset = $('wv-reset');

  heading.addEventListener('input', (event) => {
    state.heading = Number(event.target.value);
    $('wv-photo-heading-value').textContent = `${state.heading}°`;
    sync();
  });
  reset.addEventListener('click', () => {
    state.texture?.dispose();
    state.texture = null;
    $('wv-file').value = '';
    $('wv-file-status').textContent = '공식 사진 배경으로 돌아왔어요.';
    sync();
  });
  $('wv-file').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    new THREE.TextureLoader().load(url, (texture) => {
      URL.revokeObjectURL(url);
      texture.colorSpace = THREE.SRGBColorSpace;
      state.texture?.dispose();
      state.texture = texture;
      const ratio = texture.image.width / texture.image.height;
      $('wv-file-status').textContent = Math.abs(ratio - 2) > 0.15
        ? `${file.name} · 비율 ${ratio.toFixed(2)}:1 — 360° 파노라마가 아니면 늘어나 보일 수 있어요.`
        : `${file.name} 적용됨. 슬라이더로 방향을 맞춰 보세요.`;
      sync();
    }, undefined, () => { URL.revokeObjectURL(url); $('wv-file-status').textContent = '이미지를 읽지 못했어요. 다른 파일을 선택해 주세요.'; });
  });

  if (import.meta.env.DEV && new URLSearchParams(location.search).has('test')) {
    window.__windowView = {
      state: () => ({ custom: Boolean(state.texture), sphereVisible: sphere.visible, photoVisible: photo?.visible ?? null,
        rotation: sphere.rotation.y, badge: $('exterior-note')?.textContent }),
    };
  }

  return {
    onMode(mode) { section.hidden = mode !== 'tour'; },
  };
}
