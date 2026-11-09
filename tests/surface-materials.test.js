import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, BufferAttribute, Group, Mesh, MeshStandardMaterial, Texture, NoColorSpace, SRGBColorSpace } from 'three';
import { createSurfaceMaterials } from '../src/walkthrough/surface-materials.js';
import { SurfaceMaterialLibrary } from '../src/walkthrough/surface-material-library.js';
import { FinishLibrary } from '../src/walkthrough/finishes.js';

function fixture() {
  const model = new Group(), material = new MeshStandardMaterial({ color: 0xd8d3bd, roughness: .62 });
  material.name = '168C / Warm ivory plaster'; material.userData.texture_repeat_m = 1.2;
  material.map = new Texture(); material.map.repeat.set(2, 3); material.map.rotation = .2; material.normalMap = new Texture(); material.normalScale.set(.7, -.7);
  for (const [i, kind] of ['wall', 'wall', 'floor', 'floor', 'furniture'].entries()) {
    const mesh = new Mesh(new BoxGeometry(2, kind === 'wall' ? 2 : .1, kind === 'wall' ? .2 : 2), material);
    mesh.position.set(i * 3, kind === 'wall' ? 1 : 0, 0); mesh.userData = { component: kind, object_id: `${kind}/${i}`, room_id: `room-${i}` }; model.add(mesh);
  }
  return { key: 'fixture', model, definition: { info: { rooms: [] } } };
}
const normalLibrary = () => new SurfaceMaterialLibrary({ loadTexture: async () => new Texture() });
const firstWall = editor => [...editor.targets().values()].find(t => t.kind === 'wall' && t.normal.z > .99);
const selectWall = editor => { editor.setEditing(true); editor.select(firstWall(editor).id); };

test('only render copies change; source map identity/scalars/UV, reverse walls, floors and furniture stay untouched', async () => {
  const target = fixture(), source = target.model.children[0].material;
  const original = { map: source.map, normal: source.normalMap, color: source.color.toArray(), roughness: source.roughness, scale: source.normalScale.toArray(), repeat: source.map.repeat.toArray() };
  const editor = createSurfaceMaterials({ library: normalLibrary() }); await editor.activate(target, 'unit:A'); selectWall(editor);
  assert.equal(await editor.apply('greige-plaster-v1'), true); assert.equal(editor.state().count, 1);
  const overlay = editor.overlayMaterials()[0]; assert.notEqual(overlay, source); assert.equal(overlay.roughness, 1); assert.equal(overlay.metalness, 0);
  assert.equal(overlay.roughnessMap, overlay.metalnessMap); assert.equal(overlay.roughnessMap.colorSpace, NoColorSpace); assert.deepEqual(overlay.normalScale.toArray(), [1, -1]);
  assert.equal(source.map, original.map); assert.equal(source.normalMap, original.normal); assert.equal(source.roughness, original.roughness); assert.deepEqual(source.color.toArray(), original.color); assert.deepEqual(source.normalScale.toArray(), original.scale); assert.deepEqual(source.map.repeat.toArray(), original.repeat);
  assert.ok(target.model.children.filter(m => m.isMesh).every(m => m.material === source));
  await new FinishLibrary({ capabilities: { getMaxAnisotropy: () => 1 } }).apply(target.model, 'original');
  assert.equal(editor.overlayMaterials()[0], overlay); assert.equal(overlay.userData.surfaceMaterial, 'greige-plaster-v1');
  assert.equal(await editor.apply('original'), true); assert.equal(editor.state().count, 0); assert.equal(editor.snapshot().surfaces.length, 0);
  assert.equal(source.map, original.map); assert.deepEqual(source.normalScale.toArray(), original.scale);
});

test('independent floor and wall overrides coexist; restoring one preserves the other and returns owned texture channels', async () => {
  const editor = createSurfaceMaterials({ library: normalLibrary() }); await editor.activate(fixture(), 'unit:A'); selectWall(editor);
  const wallId = editor.state().selected.id; await editor.apply('ivory-plaster-v1');
  const floors = [...editor.targets().values()].filter(t => t.kind === 'floor'); editor.select(floors[0].id); await editor.apply('warm-stone-v1');
  assert.equal(editor.state().count, 2); assert.equal(editor.snapshot().surfaces.some(s => s.id === floors[1].id), false);
  const stone = editor.overlayMaterials().find(m => m.userData.surfaceMaterial === 'warm-stone-v1'); assert.equal(stone.map.colorSpace, SRGBColorSpace); assert.equal(stone.map.flipY, false); assert.equal(stone.normalMap.channel, 0);
  editor.select(wallId); await editor.apply('original'); assert.deepEqual(editor.snapshot().surfaces, [{ id: floors[0].id, material: 'warm-stone-v1' }]);
});

test('late texture completion after household switch cannot repaint the reused model or save in the new household', async () => {
  const resolve = []; const library = new SurfaceMaterialLibrary({ loadTexture: () => new Promise(r => resolve.push(r)) });
  const editor = createSurfaceMaterials({ library }), target = fixture(); await editor.activate(target, 'unit:A'); selectWall(editor);
  const pending = editor.apply('ivory-plaster-v1'); assert.equal(editor.pending, true);
  editor.beginLoad(); await editor.activate(target, 'unit:B'); resolve.forEach(r => r(new Texture()));
  assert.equal(await pending, false); assert.equal(editor.state().count, 0); assert.equal(editor.snapshot().surfaces.length, 0);
  await editor.activate(target, 'unit:A'); assert.equal(editor.state().count, 0);
});

test('drafts are isolated by unit/variant/revision, and restore validates every surface before any mutation', async () => {
  const editor = createSurfaceMaterials({ library: normalLibrary() }), target = fixture();
  await editor.activate(target, 'unit:A:basic:r1'); selectWall(editor); await editor.apply('greige-plaster-v1'); const saved = editor.snapshot();
  editor.beginLoad(); await editor.activate(target, 'unit:B:basic:r1'); assert.equal(editor.state().count, 0);
  editor.beginLoad(); await editor.activate(target, 'unit:A:basic:r1'); assert.deepEqual(editor.snapshot(), saved); assert.equal(editor.state().count, 1);
  editor.setEditing(false); assert.equal(editor.state().count, 1);
  await assert.rejects(editor.prepareRestore({ version: 1, surfaces: [...saved.surfaces, { id: 'not-this-model', material: 'warm-stone-v1' }] }));
  assert.deepEqual(editor.snapshot(), saved); assert.equal(editor.state().count, 1);
  const reset = await editor.prepareRestore(null); assert.equal(reset.commit(), true); assert.equal(editor.state().count, 0);
  const pending = await editor.prepareRestore(saved); editor.beginLoad(); await editor.activate(target, 'unit:A:expanded:r1'); assert.equal(pending.commit(), false); assert.equal(editor.state().count, 0);
});

test('failed assets retain the previous surface and failed cache entries can retry', async () => {
  let fail = false, calls = 0;
  const library = new SurfaceMaterialLibrary({ loadTexture: async () => { calls++; if (fail) throw Error('404'); return new Texture(); } });
  const editor = createSurfaceMaterials({ library }); await editor.activate(fixture(), 'unit:A'); selectWall(editor);
  await editor.apply('ivory-plaster-v1'); const saved = editor.snapshot(), overlay = editor.overlayMaterials()[0]; fail = true;
  assert.equal(await editor.apply('warm-stone-v1'), false); assert.deepEqual(editor.snapshot(), saved); assert.equal(editor.overlayMaterials()[0], overlay);
  assert.ok(editor.state().error); fail = false; assert.equal(await editor.apply('warm-stone-v1'), true);
  const count = calls; await editor.apply('warm-stone-v1'); assert.equal(calls, count);
});

test('new sample basis follows tangent availability while preserving the source normalScale', async () => {
  const library = normalLibrary(), asset = await library.load('ivory-plaster-v1'), source = new MeshStandardMaterial(), geometry = new BoxGeometry();
  source.normalScale.set(.4, -.4); geometry.setAttribute('tangent', new BufferAttribute(new Float32Array(geometry.attributes.position.count * 4), 4));
  const owned = library.material(asset, source, geometry); assert.deepEqual(owned.material.normalScale.toArray(), [1, 1]); assert.deepEqual(source.normalScale.toArray(), [.4, -.4]); owned.dispose();
});
