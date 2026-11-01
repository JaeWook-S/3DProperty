import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { CATALOG_FURNITURE, catalogFurniture, decodeCatalogFurniture } from '../src/walkthrough/catalog-furniture.js';
const asset = CATALOG_FURNITURE[0];
const bytes = () => { const data = readFileSync(new URL('../assets/furniture/cc0/modern-arm-chair-01/model.glb', import.meta.url)); return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength); };
function fixture(scale = 1) {
  const d = asset.dimensions_m;
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(d.width * scale, d.height, d.depth), new THREE.MeshStandardMaterial());
  mesh.position.set(2, 4, -3); scene.add(mesh);
  return { parseAsync: async () => ({ scene }) };
}
test('catalog reports source model bounds and CC0, not inferred or measured furniture', () => {
  assert.equal(asset.physical_measurement_verified, false);
  assert.equal(asset.source.license, 'CC0-1.0');
  assert.equal(asset.model_bytes < 3_000_000, true);
  assert.deepEqual(asset.scale, [1, 1, 1]);
  assert.throws(() => catalogFurniture('other'), /등록되지/);
});
test('real packaged GLB hash and metadata pass; loader result is translated without rescaling', async () => {
  const group = await decodeCatalogFurniture(asset.id, bytes(), fixture());
  const b = new THREE.Box3().setFromObject(group), c = b.getCenter(new THREE.Vector3());
  assert.ok(Math.abs(b.min.y) < 1e-6); assert.ok(Math.abs(c.x) < 1e-6); assert.ok(Math.abs(c.z) < 1e-6);
  assert.deepEqual(group.scale.toArray(), [1, 1, 1]);
  assert.deepEqual(group.children[0].scale.toArray(), [1, 1, 1]);
});
test('corrupted model is rejected before invoking GLTFLoader', async () => {
  const buffer = bytes(); new Uint8Array(buffer)[buffer.byteLength - 20] ^= 1;
  let called = false;
  await assert.rejects(decodeCatalogFurniture(asset.id, buffer, { parseAsync: async () => { called = true; } }), /해시/);
  assert.equal(called, false);
});
test('dimensions cannot be repaired by silently scaling the supplied geometry', async () => {
  await assert.rejects(decodeCatalogFurniture(asset.id, bytes(), fixture(1.1)), /규격/);
});
