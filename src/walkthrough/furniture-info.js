import * as THREE from 'three';
import { CATALOG_FURNITURE } from './catalog-furniture.js';
import { EXAMPLE_PRODUCTS, parseFurnitureProducts, resolveFurnitureProduct } from './furniture-products.js';
import { pickTourFurniture } from './furniture-picker.js';
import { createFurnitureThumbnail } from './furniture-thumbnail.js';
import './furniture-info.css';

const movement = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export function createFurnitureInfo({ viewport, camera, getActive, eligible, walking, pause, resume, paused, occluders = () => [] }) {
  const hint = document.createElement('div');
  hint.id = 'furniture-info-hint'; hint.hidden = true; hint.textContent = 'P · 가구 정보 보기';
  viewport.append(hint);
  const layer = document.createElement('div');
  layer.id = 'furniture-info-layer'; layer.hidden = true;
  layer.innerHTML = `<section id="furniture-info-card" role="dialog" aria-modal="true" aria-labelledby="furniture-info-name" aria-describedby="furniture-info-help" tabindex="-1">
    <div class="furniture-info-photo"><img id="furniture-info-image" alt=""><span id="furniture-info-example">예시 상품 정보</span></div>
    <div class="furniture-info-content"><p class="furniture-info-eyebrow">FURNITURE DETAILS</p><h2 id="furniture-info-name"></h2>
    <p id="furniture-info-price"></p><p class="furniture-info-seller">판매처 <strong id="furniture-info-seller"></strong></p>
    <a id="furniture-info-link" target="_blank" rel="noopener noreferrer">판매 사이트에서 보기 <span aria-hidden="true">↗</span></a>
    <p id="furniture-info-status" role="status" hidden></p>
    <button id="furniture-info-close" type="button">P · 닫고 둘러보기 계속</button>
    <p id="furniture-info-help">정보 확인 중에는 이동과 시점 회전이 멈춥니다.</p></div></section>`;
  document.body.append(layer);
  const el = id => layer.querySelector(`#furniture-info-${id}`);
  const card = el('card'), image = el('image'), link = el('link');
  const renderThumbnail = createFurnitureThumbnail();
  let selection = null, sequence = 0;
  const anchor = new THREE.Vector3();
  const pick = () => pickTourFurniture(getActive(), camera, { occluders: occluders() });

  function positionCard() {
    if (!selection) return;
    const rect = viewport.getBoundingClientRect();
    const point = anchor.clone().project(camera);
    const x = rect.left + (point.x + 1) * rect.width / 2;
    const y = rect.top + (1 - point.y) * rect.height / 2;
    const width = card.offsetWidth, height = card.offsetHeight, gap = 24, margin = 16;
    const right = x + gap + width < rect.right - margin;
    const left = Math.max(rect.left + margin, Math.min(right ? x + gap : x - width - gap, rect.right - width - margin));
    const top = Math.max(margin, Math.min(y - 40, innerHeight - height - margin));
    card.style.left = `${Math.max(margin, left)}px`; card.style.top = `${top}px`;
    card.dataset.side = right ? 'right' : 'left';
    card.style.setProperty('--pointer-top', `${Math.max(24, Math.min(y - top, height - 24))}px`);
  }
  function showProduct(config, error = '') {
    const product = resolveFurnitureProduct(config, selection.item);
    el('name').textContent = product.name;
    el('price').textContent = product.priceLabel;
    el('seller').textContent = product.seller;
    el('example').hidden = !product.placeholder;
    if (product.url) { link.href = product.url; link.removeAttribute('aria-disabled'); }
    else { link.removeAttribute('href'); link.setAttribute('aria-disabled', 'true'); }
    el('status').textContent = error; el('status').hidden = !error;
    card.dataset.productKey = product.key;
    positionCard();
  }
  async function open(hit) {
    const token = ++sequence;
    selection = hit;
    const bounds = new THREE.Box3().setFromObject(hit.item.group);
    bounds.getCenter(anchor); anchor.y = bounds.max.y;
    layer.hidden = false; hint.hidden = true;
    card.dataset.itemId = hit.item.id;
    document.body.classList.add('furniture-info-open');
    pause();
    showProduct(EXAMPLE_PRODUCTS);
    image.alt = `${hit.item.title} 3D 모델 미리보기`;
    const catalog = CATALOG_FURNITURE.find(asset => asset.kind === hit.item.kind || asset.id === hit.item.group.userData.catalog_id);
    image.hidden = false;
    image.onerror = () => { if (selection && token === sequence) { image.onerror = null; renderSelectedThumbnail(hit.item); } };
    if (catalog) image.src = catalog.previewUrl;
    else renderSelectedThumbnail(hit.item);
    card.focus({ preventScroll: true });
    positionCard();
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}furniture-products.yaml`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`파일 응답 ${response.status}`);
      const config = parseFurnitureProducts(await response.text());
      if (selection && token === sequence) showProduct(config);
    } catch (error) {
      if (selection && token === sequence) showProduct(EXAMPLE_PRODUCTS, `상품 정보를 읽지 못해 예시 정보를 표시합니다. ${error.message}`);
    }
  }
  function renderSelectedThumbnail(item) {
    try { image.src = renderThumbnail(item.group); }
    catch (error) { image.hidden = true; console.warn('Furniture thumbnail:', error); }
  }
  function close({ continueWalking = false } = {}) {
    if (!selection) return;
    selection = null; ++sequence;
    layer.hidden = true; image.onerror = null;
    document.body.classList.remove('furniture-info-open');
    if (continueWalking && eligible()) resume(); else paused();
  }
  el('close').addEventListener('click', () => close({ continueWalking: true }));
  document.addEventListener('keydown', event => {
    if (selection) {
      event.stopImmediatePropagation();
      if (event.code === 'KeyP' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault(); if (!event.repeat) close({ continueWalking: true });
      } else if (event.code === 'Escape') {
        event.preventDefault(); close();
      } else if (movement.has(event.code)) event.preventDefault();
      else if (event.code === 'Tab') {
        const nodes = [...card.querySelectorAll('a[href],button')];
        const index = nodes.indexOf(document.activeElement);
        event.preventDefault(); nodes[(index + (event.shiftKey ? -1 : 1) + nodes.length) % nodes.length].focus();
      }
      return;
    }
    if (event.code !== 'KeyP' || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.isComposing ||
        event.target.closest?.('input,textarea,select,[contenteditable="true"]') || !eligible() || !walking()) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const hit = pick(); if (hit) void open(hit);
  }, true);
  return {
    get isOpen() { return selection !== null; },
    close,
    update() {
      if (selection) { if (!eligible()) close(); else positionCard(); return; }
      hint.hidden = !eligible() || !walking() || !pick();
    },
    inspect: () => selection ? { id: selection.item.id, kind: selection.item.kind, productKey: card.dataset.productKey } : null,
    target: () => { const hit = pick(); return hit ? { id: hit.item.id, kind: hit.item.kind } : null; },
  };
}
