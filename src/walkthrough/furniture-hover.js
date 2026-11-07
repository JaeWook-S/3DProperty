import * as THREE from 'three';
import { CATALOG_FURNITURE } from './catalog-furniture.js';
import { EXAMPLE_PRODUCTS, parseFurnitureProducts, resolveFurnitureProduct } from './furniture-products.js';
import { pickFurniture } from './furniture-picker.js';
import { createFurnitureThumbnail } from './furniture-thumbnail.js';
import './furniture-hover.css';

// Mouse-only product tags in the split view. No listeners are installed on the 2D plan.
export function createFurnitureHover({ viewport, renderer, camera, getActive, eligible }) {
  const layer = document.createElement('div');
  layer.id = 'furniture-hover-layer'; layer.hidden = true;
  layer.innerHTML = `<button id="furniture-hover-plus" type="button" aria-label="가구 상품 정보 보기" aria-controls="furniture-hover-card" aria-expanded="false" hidden><span aria-hidden="true">+</span></button>
    <section id="furniture-hover-card" role="dialog" aria-labelledby="furniture-hover-name" tabindex="-1" hidden>
      <button id="furniture-hover-close" type="button" aria-label="상품 정보 닫기">×</button>
      <div class="furniture-hover-summary"><img id="furniture-hover-image" alt=""><div class="furniture-hover-details">
        <p id="furniture-hover-seller"></p><h3 id="furniture-hover-name"></h3><p id="furniture-hover-price"></p><span id="furniture-hover-example">예시 상품</span>
      </div></div>
      <a id="furniture-hover-link" target="_blank" rel="noopener noreferrer">상품 보러가기 <span aria-hidden="true">↗</span></a>
      <p id="furniture-hover-status" role="status" hidden></p>
    </section>`;
  viewport.append(layer);
  const el = id => layer.querySelector(`#furniture-hover-${id}`);
  const plus = el('plus'), card = el('card'), image = el('image'), link = el('link');
  const thumbnail = createFurnitureThumbnail();
  const bounds = new THREE.Box3(), center = new THREE.Vector3();
  let hover = null, selection = null, activeModel = null, sequence = 0, hideTimer, dragging = false;

  function project(point) {
    const p = point.clone().project(camera);
    if (p.z < -1 || p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1) return null;
    return { x: (p.x + 1) * viewport.clientWidth / 2, y: (1 - p.y) * viewport.clientHeight / 2 };
  }
  function current(hit) {
    return hit && getActive()?.model === activeModel && getActive().staging.items.includes(hit.item) && !hit.item.deleted && hit.item.group.visible;
  }
  function furnitureCenter(hit) {
    hit.item.group.updateWorldMatrix(true, true);
    return project(bounds.setFromObject(hit.item.group).getCenter(center));
  }
  function position() {
    const target = hover ?? selection;
    const anchor = target && furnitureCenter(target);
    if (!anchor) { plus.hidden = true; if (selection) closeCard(); return; }
    layer.hidden = false; plus.hidden = false;
    plus.style.left = `${anchor.x}px`;
    plus.style.top = `${anchor.y}px`;
    plus.dataset.itemId = target.item.id;
    plus.setAttribute('aria-label', `${target.item.title} 상품 정보 보기`);
    plus.setAttribute('aria-expanded', String(selection?.item === target.item));
    if (!selection) return;
    const point = furnitureCenter(selection);
    if (!point) { closeCard(); return; }
    const margin = 10, gap = 23, width = card.offsetWidth, height = card.offsetHeight;
    const right = point.x + gap + width <= viewport.clientWidth - margin;
    const left = Math.max(margin, Math.min(right ? point.x + gap : point.x - gap - width, viewport.clientWidth - width - margin));
    const top = Math.max(margin, Math.min(point.y - 30, viewport.clientHeight - height - margin));
    card.style.left = `${left}px`; card.style.top = `${top}px`;
    card.dataset.side = right ? 'right' : 'left';
  }
  function showProduct(config, error = '') {
    const product = resolveFurnitureProduct(config, selection.item);
    el('name').textContent = product.name;
    el('price').textContent = product.priceLabel;
    el('seller').textContent = product.seller;
    el('example').hidden = !product.placeholder;
    el('status').textContent = error; el('status').hidden = !error;
    if (product.url) { link.href = product.url; link.removeAttribute('aria-disabled'); }
    else { link.removeAttribute('href'); link.setAttribute('aria-disabled', 'true'); }
    card.dataset.productKey = product.key;
    position();
  }
  function renderModel(item) {
    try { image.src = thumbnail(item.group); }
    catch (error) { image.hidden = true; console.warn('Furniture hover thumbnail:', error); }
  }
  async function openCard(hit) {
    const token = ++sequence;
    selection = hit; hover = hit;
    card.hidden = false; card.dataset.itemId = hit.item.id;
    image.hidden = false;
    image.alt = `${hit.item.title} 3D 모델 미리보기`;
    image.onerror = () => { if (selection && token === sequence) { image.onerror = null; renderModel(hit.item); } };
    showProduct(EXAMPLE_PRODUCTS);
    const catalog = CATALOG_FURNITURE.find(asset => asset.kind === hit.item.kind || asset.id === hit.item.group.userData.catalog_id);
    if (catalog) image.src = catalog.previewUrl; else renderModel(hit.item);
    card.focus({ preventScroll: true }); position();
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}furniture-products.yaml`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`파일 응답 ${response.status}`);
      const config = parseFurnitureProducts(await response.text());
      if (selection && token === sequence) showProduct(config);
    } catch (error) {
      if (selection && token === sequence) showProduct(EXAMPLE_PRODUCTS, `상품 정보를 읽지 못해 예시 정보를 표시합니다. ${error.message}`);
    }
  }
  function closeCard({ focus = false } = {}) {
    selection = null; ++sequence; card.hidden = true; image.onerror = null;
    plus.setAttribute('aria-expanded', 'false');
    if (focus && !plus.hidden) plus.focus({ preventScroll: true });
  }
  function clear() {
    clearTimeout(hideTimer); hover = null; closeCard(); plus.hidden = true; layer.hidden = true;
  }
  function leave() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { hover = null; if (selection) position(); else { plus.hidden = true; layer.hidden = true; } }, 180);
  }
  viewport.addEventListener('pointermove', event => {
    if (!eligible()) { clear(); return; }
    if (event.pointerType === 'touch' || dragging || event.buttons) return;
    if (layer.contains(event.target)) { clearTimeout(hideTimer); return; }
    if (event.target !== renderer.domElement) { leave(); return; }
    const rect = renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    const hit = pickFurniture(getActive(), camera, { pointer, clippingPlanes: renderer.clippingPlanes });
    if (!hit) { leave(); return; }
    clearTimeout(hideTimer); activeModel = getActive().model;
    // One tag per furniture group, always anchored to its center rather than the hit surface.
    if (hover?.item !== hit.item) hover = hit;
    position();
  });
  viewport.addEventListener('pointerleave', leave);
  plus.addEventListener('pointerenter', () => clearTimeout(hideTimer));
  plus.addEventListener('click', event => {
    event.preventDefault(); event.stopPropagation();
    if (!eligible()) { clear(); return; }
    const target = hover ?? selection;
    if (!current(target)) { clear(); return; }
    if (selection?.item === target.item) closeCard({ focus: true }); else void openCard(target);
  });
  el('close').addEventListener('click', () => closeCard({ focus: true }));
  // Let orbit controls receive the original gesture. Product tags never start a scene drag.
  renderer.domElement.addEventListener('pointerdown', () => { dragging = true; clear(); });
  document.addEventListener('pointerup', () => { dragging = false; });
  document.addEventListener('pointercancel', () => { dragging = false; clear(); });
  renderer.domElement.addEventListener('wheel', clear, { passive: true });
  document.addEventListener('pointerdown', event => { if (selection && !layer.contains(event.target)) closeCard(); }, true);
  document.addEventListener('keydown', event => {
    if (selection && event.code === 'Escape') { event.preventDefault(); event.stopPropagation(); closeCard({ focus: true }); }
  });
  window.addEventListener('blur', () => { hover = null; if (!selection) clear(); });
  return {
    clear,
    update() {
      if (!eligible() || ((hover || selection) && getActive()?.model !== activeModel)) { clear(); return; }
      if (selection && !current(selection)) closeCard();
      if (hover && !current(hover)) hover = null;
      if (hover || selection) position(); else { plus.hidden = true; layer.hidden = true; }
    },
    inspect: () => ({ hover: hover?.item.id ?? null, selected: selection?.item.id ?? null }),
  };
}
