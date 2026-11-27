import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONCEPTS, PALETTES } from '../src/concepts/catalog.js';
import { TOUR_FURNITURE_SPECS, TOUR_FURNITURE_SETS, conceptForTour } from '../src/concepts/tour-furniture-spec.js';
import { TOUR_MODELS, TOUR_PARTS, loadTourFurniture, prepareTourModel, installTourTemplates, tourFurnitureLoadError } from '../src/concepts/tour-furniture.js';
import { TOURS } from '../src/house-tours/tours.js';
import { stagingAssets } from '../src/walkthrough/staging-assets.js';
import { archisketchWebData } from '../src/walkthrough/archisketch-model.js';
import { tourPlanInput } from '../src/house-tours/plan-input.js';
import { planConcept } from '../src/concepts/planner.js';
import { applyPalette } from '../src/concepts/kit.js';

const tourOf = (id) => TOURS.find(t => t.id === id);
const conceptOf = (id) => CONCEPTS.find(c => c.id === tourOf(id).concept);
const kindsOf = (set) => Object.keys(TOUR_FURNITURE_SPECS).filter(kind => TOUR_FURNITURE_SPECS[kind].set === set).sort();
const gltf = new GLTFLoader();
// Node checks the actual embedded geometry; the browser test decodes the images.
gltf.register(() => ({ name: 'test-image-placeholder', loadTexture: async () => new Texture() }));
const loader = { async loadAsync(url) { const b = readFileSync(new URL(url)); return gltf.parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), ''); } };
const planFor = (tour, variant) => {
  const raw = JSON.parse(readFileSync(new URL(`../assets/models/acro-river-park/112a/archisketch-metric-v1/${variant}/model-info.json`, import.meta.url)));
  const definition = { ...archisketchWebData(raw), coordinateBased: true };
  const input = tourPlanInput(conceptForTour(conceptOf(tour), tour), definition);
  return planConcept(input.concept, input);
};

test('each furniture set stays inside its own 집들이; the shared concepts and other 집들이 keep the kit', () => {
  assert.deepEqual(TOUR_FURNITURE_SETS, ['mountain-white', 'stone-walnut']);
  assert.equal(CONCEPTS.length, 8);
  for (const tour of TOUR_FURNITURE_SETS) {
    const shared = conceptOf(tour), before = JSON.stringify(shared);
    const custom = conceptForTour(shared, tour);
    assert.notEqual(custom, shared);
    assert.equal(custom.furnitureSet, tour);
    assert.deepEqual([...new Set(custom.items.filter(p => TOUR_FURNITURE_SPECS[p.kind]).map(p => p.kind))].sort(), kindsOf(tour));
    assert.ok(!custom.keep.includes('king'), `${tour}: its own bed replaces the model king bed`);
    assert.equal(JSON.stringify(shared), before);
    // Another 집들이 (or none) gets the shared concept back.
    assert.equal(conceptForTour(shared, 'olive-piano'), shared);
    assert.equal(conceptForTour(shared, null), shared);
    // The palette brings the photos' walls and floor, and the concept offers it.
    const palette = tourOf(tour).palette;
    assert.ok(shared.palettes.includes(palette));
    assert.equal(PALETTES[palette].finish, tour === 'stone-walnut' ? 'walnut' : 'oak');
  }
  assert.equal(conceptForTour(conceptOf('mountain-white'), 'stone-walnut'), conceptOf('mountain-white'));
  assert.equal(conceptOf('olive-piano').furnitureSet, undefined);
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
    const group = prepareTourModel('mwBed', scene);
    const bounds = new Box3().setFromObject(group);
    assert.deepEqual(bounds.getSize(new Vector3()).toArray(), [2, 1, 3]);
    assert.deepEqual(bounds.min.toArray(), [-1, 0, -1.5]);
    assert.equal(group.getObjectByName('BED_Floor_GLB'), undefined);
    assert.equal(group.getObjectByName('Cube'), undefined);
  }
  assert.throws(() => prepareTourModel('mwBed', new Group()), /BED_ 가구 부품/);
  // A clean export without a root or prefix is the whole file, minus stray Cubes.
  const scene = new Group(), sofa = new Mesh(new BoxGeometry(2, 0.8, 0.9), new MeshStandardMaterial());
  sofa.position.set(1, 0.4, 1);
  scene.add(sofa, Object.assign(new Mesh(new BoxGeometry(9, 0.1, 9), new MeshStandardMaterial()), { name: 'Cube' }));
  const bounds = new Box3().setFromObject(prepareTourModel('swSofa', scene));
  assert.deepEqual(bounds.min.toArray().map(v => +v.toFixed(6)), [-1, 0, -0.45]);
});

test('every supplied GLB keeps its native scale and authored materials; chairs and TV fill their footprints', async () => {
  assert.deepEqual(Object.keys(TOUR_PARTS).sort(), ['mwChair', 'swChair']);
  await loadTourFurniture(loader);
  const groups = new Map();
  installTourTemplates({ addTemplate: (kind, template) => groups.set(kind, template.group) });
  assert.deepEqual([...groups.keys()].sort(), Object.keys(TOUR_MODELS).sort());
  for (const [kind, group] of groups) {
    const spec = TOUR_FURNITURE_SPECS[kind];
    const b = new Box3().setFromObject(group), size = b.getSize(new Vector3()), c = b.getCenter(new Vector3());
    assert.ok(size.toArray().every((v, i) => Math.abs(v - [spec.w, spec.h, spec.d][i]) < 0.0002), `${kind}: ${size.toArray()}`);
    assert.ok(Math.abs(c.x) < 1e-6 && Math.abs(c.z) < 1e-6 && Math.abs(b.min.y) < 1e-6, kind);
    assert.deepEqual(group.scale.toArray(), [1, 1, 1]);
    assert.equal(group.userData.furnitureSet, spec.set);
    // Everything that came from a supplied GLB keeps its textures and colors under any palette.
    const authored = [];
    group.traverse(o => { if (o.isMesh && !o.material.name?.startsWith('Kit ')) for (const m of [].concat(o.material)) authored.push([m, m.color.getHex(), m.roughness, m.metalness, m.map]); });
    assert.ok(authored.some(([, , , , map]) => map), `${kind}: embedded color texture`);
    applyPalette({ wood: '#112233', fabric: '#445566', rug: '#778899' });
    for (const [m, color, roughness, metallic, map] of authored) {
      assert.deepEqual([m.color.getHex(), m.roughness, m.metalness], [color, roughness, metallic]);
      assert.equal(m.map, map);
    }
  }
  const chairs = (kind) => groups.get(kind).getObjectByName('Dining chairs').children.length;
  assert.equal(chairs('mwDiningTable'), 6);
  assert.equal(chairs('swDining'), 4);
});

test('the expanded plan uses every piece of each set; the basic plan never swaps in a kit dining set', () => {
  for (const tour of TOUR_FURNITURE_SETS) {
    const expanded = planFor(tour, 'expanded');
    assert.deepEqual([...new Set(expanded.placements.filter(p => TOUR_FURNITURE_SPECS[p.kind]).map(p => p.kind))].sort(), kindsOf(tour), tour);
    const basic = planFor(tour, 'basic');
    const dining = tour === 'mountain-white' ? 'mwDiningTable' : 'swDining';
    assert.ok(basic.skipped.some(p => p.kind === dining), `${tour}: the basic kitchen is too small for the set's table`);
    assert.ok(!basic.placements.some(p => /^dining[246]$/.test(p.kind)), tour);
  }
});

test('load failures identify the affected GLB and allow a retry', async () => {
  // A fresh module instance would be cleaner; the failed promise resets the shared one.
  const fresh = await import(`../src/concepts/tour-furniture.js?retry=${Date.now()}`);
  await assert.rejects(fresh.loadTourFurniture({ async loadAsync() { throw new Error('HTTP 404'); } }), /black_chair\.glb: HTTP 404/);
  assert.match(fresh.tourFurnitureLoadError().message, /black_chair\.glb: HTTP 404/);
});

test('set kinds survive placement snapshots and restore with their GLB geometry', async () => {
  await loadTourFurniture(loader);
  assert.equal(tourFurnitureLoadError(), null);
  const staging = stagingAssets(new Group(), { objects: {} });
  installTourTemplates(staging);
  const kinds = Object.keys(TOUR_MODELS).sort();
  kinds.forEach((kind, i) => staging.place(kind, { id: `added-test-${i}`, x: i * 3, z: 0 }));
  const saved = staging.snapshot();
  staging.reset();
  staging.restore(saved, []);
  assert.deepEqual(staging.snapshot(), saved);
  assert.deepEqual(staging.items.map(p => p.group.userData.furnitureSet), kinds.map(kind => TOUR_FURNITURE_SPECS[kind].set));
});
