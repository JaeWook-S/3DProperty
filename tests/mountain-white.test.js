import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONCEPTS } from '../src/concepts/catalog.js';
import { MOUNTAIN_WHITE_SPECS, conceptForTour } from '../src/concepts/mountain-white-spec.js';
import { MOUNTAIN_WHITE_MODELS, loadMountainWhiteFurniture, prepareMountainWhiteModel, installMountainWhiteTemplates, mountainWhiteLoadError } from '../src/concepts/mountain-white-furniture.js';
import { stagingAssets } from '../src/walkthrough/staging-assets.js';
import { archisketchWebData } from '../src/walkthrough/archisketch-model.js';
import { tourPlanInput } from '../src/house-tours/plan-input.js';
import { planConcept } from '../src/concepts/planner.js';
import { applyPalette } from '../src/concepts/kit.js';

const family = CONCEPTS.find(c => c.id === 'family-lounge');
const kinds = Object.keys(MOUNTAIN_WHITE_SPECS).sort();
const gltf = new GLTFLoader();
// Node checks the actual embedded geometry; the browser test decodes the rug image.
gltf.register(() => ({ name: 'test-image-placeholder', loadTexture: async () => new Texture() }));
const loader = { async loadAsync(url) { const b = readFileSync(new URL(url)); return gltf.parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), ''); } };

test('mountain-white is isolated from the shared family-lounge concept and river-view', () => {
  const before = JSON.stringify(family);
  const custom = conceptForTour(family, 'mountain-white');
  assert.equal(conceptForTour(family, 'river-view'), family);
  assert.equal(CONCEPTS.length, 8);
  assert.deepEqual(custom.items.filter(p => p.kind.startsWith('mw')).map(p => p.kind).sort(), kinds);
  assert.ok(!custom.keep.includes('king'));
  assert.equal(JSON.stringify(family), before);
});

test('legacy assembly roots and flattened baked parts preserve world transforms and exclude photography props', () => {
  for (const legacy of [true, false]) {
    const scene = new Group(), assembly = new Group();
    assembly.name = legacy ? 'BED_Bed_ROOT' : 'Baked_export';
    assembly.position.set(4, 2, -3);
    assembly.scale.set(2, 1, 3);
    scene.add(assembly);
    const bed = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    bed.name = 'BED_Frame_GLB';
    assembly.add(bed);
    for (const name of ['BED_Floor_GLB', 'Cube']) {
      const prop = new Mesh(new BoxGeometry(20, 0.1, 20), new MeshStandardMaterial());
      prop.name = name;
      assembly.add(prop);
    }
    const group = prepareMountainWhiteModel('mwBed', scene);
    const bounds = new Box3().setFromObject(group);
    assert.deepEqual(bounds.getSize(new Vector3()).toArray(), [2, 1, 3]);
    assert.deepEqual(bounds.min.toArray(), [-1, 0, -1.5]);
    assert.equal(group.getObjectByName('BED_Floor_GLB'), undefined);
    assert.equal(group.getObjectByName('Cube'), undefined);
  }
  assert.throws(() => prepareMountainWhiteModel('mwBed', new Group()), /BED_ 가구 부품/);
});

test('all seven real GLBs keep native scale and authored materials, excluding the studio floor', async () => {
  for (const [kind, def] of Object.entries(MOUNTAIN_WHITE_MODELS)) {
    const { scene } = await loader.loadAsync(def.url);
    const group = prepareMountainWhiteModel(kind, scene), spec = MOUNTAIN_WHITE_SPECS[kind];
    const b = new Box3().setFromObject(group), size = b.getSize(new Vector3()), c = b.getCenter(new Vector3());
    assert.ok(size.toArray().every((v, i) => Math.abs(v - [spec.w, spec.h, spec.d][i]) < 0.0002), `${kind}: ${size.toArray()}`);
    assert.ok(Math.abs(c.x) < 1e-6 && Math.abs(c.z) < 1e-6 && Math.abs(b.min.y) < 1e-6, kind);
    assert.deepEqual(group.scale.toArray(), [1, 1, 1]);
    assert.equal(group.getObjectByName('BED_Floor'), undefined);
    assert.equal(group.getObjectByName('Cube'), undefined);
    const authored = [];
    group.children[0].traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) authored.push([m, m.color.getHex(), m.roughness, m.metalness, m.map]); });
    assert.ok(authored.some(([, , , , map]) => map), `${kind}: embedded color texture`);
    applyPalette({ wood: '#112233', fabric: '#445566', rug: '#778899' });
    for (const [m, color, roughness, metallic, map] of authored) {
      assert.deepEqual([m.color.getHex(), m.roughness, m.metalness], [color, roughness, metallic]);
      assert.equal(m.map, map);
    }
  }
});

test('the expanded layout uses every supplied model; basic fit does not silently substitute the old table', () => {
  for (const variant of ['expanded', 'basic']) {
    const raw = JSON.parse(readFileSync(new URL(`../assets/models/acro-river-park/112a/archisketch-metric-v1/${variant}/model-info.json`, import.meta.url)));
    const definition = { ...archisketchWebData(raw), coordinateBased: true };
    const concept = conceptForTour(family, 'mountain-white'), input = tourPlanInput(concept, definition);
    const result = planConcept(input.concept, input);
    if (variant === 'expanded') assert.deepEqual(result.placements.filter(p => p.kind.startsWith('mw')).map(p => p.kind).sort(), kinds);
    else {
      assert.ok(result.skipped.some(p => p.kind === 'mwDiningTable'));
      assert.ok(!result.placements.some(p => /^dining[246]$/.test(p.kind)));
    }
  }
});

test('load failures identify the affected GLB and allow a retry', async () => {
  await assert.rejects(loadMountainWhiteFurniture({ async loadAsync() { throw new Error('HTTP 404'); } }), /sofa\.glb: HTTP 404/);
  assert.match(mountainWhiteLoadError().message, /sofa\.glb: HTTP 404/);
});

test('custom kinds survive placement snapshots and restore with their GLB geometry', async () => {
  await loadMountainWhiteFurniture(loader);
  assert.equal(mountainWhiteLoadError(), null);
  const staging = stagingAssets(new Group(), { objects: {} });
  installMountainWhiteTemplates(staging);
  kinds.forEach((kind, i) => staging.place(kind, { id: `added-test-${i}`, x: i * 3, z: 0 }));
  const saved = staging.snapshot();
  staging.reset();
  staging.restore(saved, []);
  assert.deepEqual(staging.snapshot(), saved);
  assert.deepEqual(staging.items.map(p => p.group.userData.furnitureSet), kinds.map(() => 'mountain-white'));
});
