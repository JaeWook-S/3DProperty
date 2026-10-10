import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Group, Vector3 } from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';
import { generatedFixture } from './fixtures/generated-asset.js';
import { decodeGeneratedModel, generatedViewerUrl, installGeneratedTemplate, validateGeneratedAsset } from '../src/walkthrough/generated-furniture.js';
import { stagingAssets } from '../src/walkthrough/staging-assets.js';

const { asset, bytes } = generatedFixture();
const buffer = () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

test('generated asset uses the original furniture contract and same-origin immutable model URLs', () => {
  assert.equal(validateGeneratedAsset(asset), asset);
  for (const update of [{ units: 'cm' }, { model_uri: 'https://evil.invalid/model.glb' }, { model_sha256: null },
    { asset_id: '../../escape' }, { dimensions_m: { width: null, depth: .6, height: .75 } }]) {
    assert.throws(() => validateGeneratedAsset({ ...asset, ...update }));
  }
  const url = new URL(generatedViewerUrl('http://127.0.0.1:5173/?quality=light', asset, 'basic'));
  assert.equal(url.searchParams.get('furnitureAsset'), asset.asset_id);
  assert.equal(url.searchParams.get('variant'), 'basic');
  assert.equal(url.searchParams.get('quality'), 'light');
  assert.throws(() => generatedViewerUrl('javascript:alert(1)', asset));
});

test('GLTFLoader decodes the exported GLB with exact meter dimensions and bottom-center pivot', async () => {
  const group = await decodeGeneratedModel(asset, buffer());
  const bounds = new Box3().setFromObject(group), size = bounds.getSize(new Vector3());
  [.8, .75, .6].forEach((value, index) => assert.ok(Math.abs(size.toArray()[index] - value) < 1e-5));
  assert.ok(Math.abs(bounds.min.y) < 1e-6);
  assert.ok(Math.abs(bounds.min.x + bounds.max.x) < 1e-6);
});

test('bad hashes and dimensions are rejected instead of rescaling or claiming a successful model', async () => {
  await assert.rejects(decodeGeneratedModel({ ...asset, model_sha256: '0'.repeat(64) }, buffer()), /해시/);
  await assert.rejects(decodeGeneratedModel({ ...asset, dimensions_m: { ...asset.dimensions_m, width: 1.2 } }, buffer()), /크기/);
  await assert.rejects(decodeGeneratedModel(asset, new ArrayBuffer(40)), /GLB/);
});

test('generated model moves, rotates, collides and restores through the existing editor without resizing', async () => {
  const staging = stagingAssets(new Group(), { objects: {} });
  const kind = installGeneratedTemplate(staging, asset, await decodeGeneratedModel(asset, buffer()));
  const room = { bounds_m: [0, 0, 10, 10] };
  const { item } = staging.add(kind, room, true);
  assert.equal(staging.move(item.id, { x: 3, z: 3, angle: Math.PI / 2 }, room, true, true), null);
  assert.equal(item.width, .8); assert.equal(item.height, .75); assert.equal(item.depth, .6);
  assert.deepEqual(item.group.scale.toArray(), [1, 1, 1]);
  assert.ok(staging.capsuleIntersect(new Capsule(new Vector3(3, .8, 3), new Vector3(3, 1.3, 3), .2)));
  const saved = staging.snapshot(); staging.reset(); assert.equal(staging.items.length, 0);
  staging.restore(saved, [room]);
  assert.equal(staging.items[0].kind, kind);
  assert.equal(staging.items[0].angle, Math.PI / 2);
  assert.equal(staging.items[0].width, .8);
});
