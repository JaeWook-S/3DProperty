import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MeshStandardMaterial, Matrix4, Vector3, Quaternion } from 'three';
import { createFacade } from '../src/walkthrough/site-facade.js';
const site = JSON.parse(readFileSync(new URL('../assets/location/acro-river-park/site-context.json', import.meta.url)));
const material = new MeshStandardMaterial();
const materials = { glass: material, slab: material, frame: material };

test('facades preserve OSM data, retain each roof height and use three instanced draw meshes per building', () => {
  const original = JSON.stringify(site);
  for (const building of site.buildings) {
    const group = createFacade(building, materials);
    assert.equal(group.children.length, 3);
    assert.ok(group.userData.windowCount > 0);
    for (const mesh of group.children) {
      assert.ok(mesh.isInstancedMesh);
      const matrix = new Matrix4(), position = new Vector3(), scale = new Vector3(), quaternion = new Quaternion();
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix); matrix.decompose(position, quaternion, scale);
        assert.ok(matrix.elements.every(Number.isFinite));
        assert.ok(position.y - scale.y / 2 >= -.0001);
        assert.ok(position.y + scale.y / 2 <= building.height_m + .0001);
      }
    }
  }
  assert.equal(JSON.stringify(site), original);
});

test('adjoining parts do not receive windows along their shared internal face', () => {
  const part = x => ({ footprint_m: [[x, 0], [x + 6, 0], [x + 6, 6], [x, 6]], height_m: 7, levels: 2 });
  const left = part(0), right = part(6);
  const isolated = createFacade({ height_m: 7, levels: 2, parts: [left] }, materials).userData.windowCount;
  const together = createFacade({ height_m: 7, levels: 2, parts: [left, right] }, materials).userData.windowCount;
  assert.equal(together, isolated * 1.5);
});
