import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { parseFurnitureProducts, resolveFurnitureProduct, safeProductUrl } from '../src/walkthrough/furniture-products.js';
import { pickFurniture, pickTourFurniture } from '../src/walkthrough/furniture-picker.js';
import { PIECES } from '../src/concepts/furniture-spec.js';

test('editable YAML resolves instance/model/kind entries and explicit unknown prices', () => {
  const config = parseFurnitureProducts(readFileSync(new URL('../public/furniture-products.yaml', import.meta.url), 'utf8'));
  const item = { id: 'added-9', title: '의자', kind: 'catalog:modern-arm-chair-01', group: { userData: { catalog_id: 'cc0-modern-arm-chair-01' } } };
  assert.equal(resolveFurnitureProduct(config, item).name, '임시 상품 · 라운지 체어');
  assert.equal(resolveFurnitureProduct(config, item).price, 249000);
  config.products['added-9'] = { name: '직접 수정한 의자', price: null, seller: '새 판매처', url: 'https://example.org/chair?color=green', placeholder: false };
  const product = resolveFurnitureProduct(config, item);
  assert.equal(product.name, '직접 수정한 의자');
  assert.equal(product.priceLabel, '판매처에서 가격 확인');
  assert.equal(product.seller, '새 판매처');
  assert.equal(product.placeholder, false);
  assert.equal(product.url, 'https://example.org/chair?color=green');
  const fallback = resolveFurnitureProduct(config, { id: 'unknown', kind: 'new-kind', title: '새 가구' });
  assert.match(fallback.name, /새 가구/);
  assert.equal(fallback.price, config.defaults.price);
  assert.equal(resolveFurnitureProduct(config, { id: 'a', kind: 'sofa', title: '소파' }).price, 899000);
});

test('IKEA-based 집들이 pieces carry their IKEA name, price and shop link; everything else has no shop link', () => {
  const config = parseFurnitureProducts(readFileSync(new URL('../public/furniture-products.yaml', import.meta.url), 'utf8'));
  assert.equal(config.defaults.url, undefined);
  const resolve = (kind) => resolveFurnitureProduct(config, { id: `added-${kind}`, kind, title: kind });
  const ikea = ['mwSofa', 'mwRug', 'mwSmallRug', 'mwCoffeeTable', 'mwTvConsole', 'mwFloorLamp', 'mwBed', 'mwChair',
    'mwArmchair', 'mwPlant', 'mwSingleBed', 'mwLoftBed', 'mwBookcase', 'swSofa', 'swRug', 'swCoffeeTable', 'swSideTable',
    'swSideboard', 'swFloorLamp', 'swDiningTable', 'swChair', 'swBed', 'swGuestBed', 'swNightstand', 'swDesk', 'swPlant', 'swWardrobe',
    // styling props on walls, ceilings and side tables
    'mwSideTable', 'tableLamp', 'mwPendant', 'mwFrame', 'swShelf', 'swFrame'];
  for (const kind of ikea) {
    const product = resolve(kind);
    assert.match(product.url, /^https:\/\/www\.ikea\.com\/kr\/ko\/p\//, kind);
    assert.equal(product.seller, 'IKEA', kind);
    assert.equal(product.placeholder, false, kind);
    assert.ok(product.price > 0 && !/임시/.test(product.name), kind);
  }
  assert.equal(resolve('swSofa').priceLabel, '₩1,029,000');
  // A table or desk and its chairs are separate pieces with separate products (one chair's price).
  assert.deepEqual(['swDiningTable', 'swDesk', 'swChair', 'mwChair'].map(kind => resolve(kind).price), [799000, 119000, 199000, 79900]);
  assert.match(resolve('swChair').name, /TOSSBERG/);
  assert.doesNotMatch(resolve('swDiningTable').name, /의자/);
  // Plan-only set kinds never stand in staging, so they have no product of their own.
  for (const kind of Object.keys(PIECES)) if (PIECES[kind][0][0] !== kind) assert.equal(config.products[kind], undefined, kind);
  // Pieces whose source product is unknown, kit furniture and model furniture are the customer's own.
  for (const kind of ['mwDiningTable', 'sideChair', 'diningTable6', 'officeChair', 'sofa3', 'king', 'catalog:modern-arm-chair-01',
    'mwNightstand', 'swTriptych', 'swPendant', 'art', 'wallShelf']) assert.equal(resolve(kind).url, null, kind);
});

test('bad YAML, duplicate keys and invalid prices are rejected; purchase URLs cannot execute scripts', () => {
  for (const text of ['version: [', 'version: 2\nproducts: {}', 'version: 1\nproducts:\n  sofa:\n    price: -3',
    'version: 1\nproducts:\n  sofa:\n    price: "1,000"', 'version: 1\nproducts: {}\nproducts: {}']) {
    assert.throws(() => parseFurnitureProducts(text));
  }
  for (const url of ['javascript:alert(1)', 'data:text/html,<script>', '//example.org', 'https://user:secret@example.org']) assert.equal(safeProductUrl(url), null);
  assert.equal(safeProductUrl('https://example.org/p'), 'https://example.org/p');
});

function fixture() {
  const model = new THREE.Group(), camera = new THREE.PerspectiveCamera(60, 1, .01, 100);
  camera.position.set(0, 1, 0); camera.lookAt(0, 1, -3);
  const group = new THREE.Group(); group.userData.stagingId = 'chair-1'; group.position.set(0, 1, -3);
  const nested = new THREE.Group(); nested.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
  group.add(nested); model.add(group);
  const item = { id: 'chair-1', kind: 'chair', group, deleted: false };
  return { model, camera, staging: { items: [item] }, item };
}

test('tour picking resolves nested parts, current transforms, distance and deleted furniture', () => {
  const active = fixture();
  assert.equal(pickTourFurniture(active, active.camera).item.id, 'chair-1');
  active.item.group.position.x = 3;
  assert.equal(pickTourFurniture(active, active.camera), null);
  active.item.group.position.x = 0;
  active.item.group.position.z = -8;
  assert.equal(pickTourFurniture(active, active.camera), null);
  active.item.group.position.z = -3;
  active.item.deleted = true;
  assert.equal(pickTourFurniture(active, active.camera), null);
  active.item.deleted = false; active.item.group.visible = false;
  assert.equal(pickTourFurniture(active, active.camera), null);
});

test('styling on the walls (frames, shelves) and lamps on side tables are picked with their own product', () => {
  const active = fixture();
  const shelf = new THREE.Group(); shelf.position.set(0, 1, -2);
  shelf.userData.furnitureInfo = { id: 'styling-4', kind: 'swShelf', title: '다크 스톤 · 벽 선반' };
  const board = new THREE.Group(); board.add(new THREE.Mesh(new THREE.BoxGeometry(1, 0.05, 0.3), new THREE.MeshBasicMaterial()));
  shelf.add(board); active.model.add(shelf);
  const hit = pickTourFurniture(active, active.camera);
  assert.deepEqual([hit.item.id, hit.item.kind, hit.item.title, hit.item.group], ['styling-4', 'swShelf', '다크 스톤 · 벽 선반', shelf]);
  // A lamp standing on the prop table is its own product; the table below it stays the table.
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial());
  lamp.userData.furnitureInfo = { id: 'styling-4-1', kind: 'tableLamp', title: '탁상 조명' };
  lamp.position.set(0, 0, 0.3); shelf.add(lamp);
  assert.equal(pickTourFurniture(active, active.camera).item.kind, 'tableLamp');
  // Hidden styling (another theme's props) is never picked; the furniture behind shows instead.
  shelf.visible = false;
  assert.equal(pickTourFurniture(active, active.camera).item.id, 'chair-1');
});

test('walls and batched logical walls occlude furniture; nearest object wins', () => {
  const active = fixture();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(3, 3, .1), new THREE.MeshBasicMaterial());
  wall.position.set(0, 1, -1.5); active.model.add(wall);
  assert.equal(pickTourFurniture(active, active.camera), null);
  wall.visible = false; wall.userData.renderBatched = true;
  assert.equal(pickTourFurniture(active, active.camera), null);
  wall.userData.renderBatched = false;
  assert.equal(pickTourFurniture(active, active.camera).item.id, 'chair-1');
  active.model.remove(wall); wall.visible = true;
  assert.equal(pickTourFurniture(active, active.camera, { occluders: [wall] }), null);
});

test('split view picks at the mouse position without the tour distance restriction', () => {
  const active = fixture();
  active.item.group.position.set(1, 1, -3);
  const pointer = new THREE.Vector3(1, 1, -3).project(active.camera);
  assert.equal(pickFurniture(active, active.camera, { pointer: new THREE.Vector2(pointer.x, pointer.y) }).item.id, 'chair-1');
  assert.equal(pickTourFurniture(active, active.camera), null);
  active.item.group.position.set(0, 1, -8);
  assert.equal(pickFurniture(active, active.camera).item.id, 'chair-1');
  assert.equal(pickTourFurniture(active, active.camera), null);
});

test('cutaway surfaces do not occlude the split view while real walls and tour geometry do', () => {
  const active = fixture();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(3, 3, .1), new THREE.MeshBasicMaterial());
  wall.position.set(0, 1, -1.5); active.model.add(wall);
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), -2);
  assert.equal(pickFurniture(active, active.camera), null);
  assert.equal(pickFurniture(active, active.camera, { clippingPlanes: [plane] }).item.id, 'chair-1');
  assert.equal(pickTourFurniture(active, active.camera), null);
  plane.constant = 0;
  assert.equal(pickFurniture(active, active.camera, { clippingPlanes: [plane] }), null);
});
