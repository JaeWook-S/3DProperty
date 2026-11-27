import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONCEPTS, PALETTES } from '../src/concepts/catalog.js';
import { TOUR_FURNITURE_SPECS, TOUR_FURNITURE_SETS, conceptForTour } from '../src/concepts/tour-furniture-spec.js';
import { TOUR_MODELS, TOUR_PARTS, loadTourFurniture, prepareTourModel, installTourTemplates, tourFurnitureLoadError, tourProp } from '../src/concepts/tour-furniture.js';
import { createDressing } from '../src/concepts/dressing.js';
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
  assert.deepEqual(Object.keys(TOUR_PARTS).sort(), ['mwChair', 'mwFrame', 'mwNightstand', 'mwPendant', 'mwSideTable', 'swChair', 'swFrame', 'swPendant', 'swShelf', 'swTriptych', 'tableLamp']);
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
  assert.equal(chairs('swDesk'), 1);
});

test('small_ variants made from the supplied GLBs keep their edited sizes', async () => {
  const size = async (tour, file) => {
    const { scene } = await loader.loadAsync(new URL(`../assets/house-tours/${tour}/${file}`, import.meta.url).href);
    const b = new Box3().setFromObject(scene);
    return [...b.getSize(new Vector3()).toArray(), b.min.y].map(v => +v.toFixed(3));
  };
  assert.deepEqual(await size('mountain-white', 'small_rug.glb'), [1.02, 0.01, 1.44, 0]);
  assert.deepEqual(await size('mountain-white', 'small_black_side_table.glb'), [0.4, 0.48, 0.4, 0]);
  assert.deepEqual(await size('mountain-white', 'small_white_nightstand.glb'), [0.42, 0.56, 0.36, 0]);
  assert.deepEqual(await size('stone-walnut', 'small_dark_brown_bed.glb'), [1.51, 1.12, 2.07, 0]);
  // The pendant hangs from a 2.6 m ceiling: shade from 1.59 m, cord and canopy up to 2.6 m.
  assert.deepEqual(await size('stone-walnut', 'small_black_pendant.glb'), [0.44, 1.01, 0.44, 1.59]);
  // Fixed copies of supplied GLBs: drawer pushed in, doors closed, cord shortened, frame stained black.
  assert.deepEqual(await size('mountain-white', 'small_oak_bed.glb'), [1.05, 1, 2.09, 0]);
  assert.deepEqual(await size('stone-walnut', 'small_black_wardrobe.glb'), [2.508, 2.012, 0.612, 0]);
  assert.deepEqual(await size('mountain-white', 'small_pendant_lamp.glb'), [0.38, 1, 0.38, 1.6]);
  assert.deepEqual(await size('stone-walnut', 'small_black_frame.glb'), [0.52, 0.72, 0.03, 0]);
});

test('a 집들이 swaps styling props for its own models and never disposes their shared meshes', async () => {
  await loadTourFurniture(loader);
  const pendant = tourProp('stone-walnut', 'pendant');
  assert.ok(pendant);
  assert.ok(Math.abs(new Box3().setFromObject(pendant).min.y - 1.59) < 0.005, 'the pendant keeps its hanging height');
  for (const [tour, kind, top] of [['mountain-white', 'sideLamp', 0.48], ['mountain-white', 'nightLamp', 0.56], ['stone-walnut', 'nightLamp', 0.63]]) {
    const prop = tourProp(tour, kind);
    assert.equal(prop.children.length, 2, `${tour} ${kind}: the model and a kit lamp`);
    const lamp = new Box3().setFromObject(prop.children[1]);
    assert.ok(Math.abs(lamp.min.y - top) < 0.005, `${tour} ${kind}: lamp stands on the ${top} m top`);
  }
  assert.ok(Math.abs(new Box3().setFromObject(tourProp('mountain-white', 'pendant')).min.y - 1.6) < 0.005);
  // Art: the triptych over the stone-walnut sofa, black frames over its beds; small oak frames
  // repeat to fill the width planned over the mountain-white sofa. Centered on the prop height.
  const art = (tour, over, w) => tourProp(tour, 'art', { options: { over, w } });
  assert.match(art('stone-walnut', 'sofa', 0.9).name, /swTriptych/);
  assert.match(art('stone-walnut', 'bed', 1.0).name, /swFrame/);
  assert.equal(art('mountain-white', 'sofa', 1.2).children.length, 2);
  assert.equal(art('mountain-white', 'bed', 1.0).children.length, 1);
  const frame = new Box3().setFromObject(art('mountain-white', 'bed', 1.0));
  assert.ok(Math.abs(frame.min.y + frame.max.y) < 0.005, 'centered on the prop height');
  // The shelf's board sits at the prop origin with its back on the wall, 3 cm behind the origin.
  const shelf = new Box3().setFromObject(tourProp('stone-walnut', 'wallShelf'));
  assert.ok(Math.abs(shelf.max.y - 0.0125) < 0.005 && Math.abs(shelf.min.z + 0.03) < 0.005);
  assert.equal(tourProp('mountain-white', 'wallShelf'), null);
  assert.equal(tourProp('olive-piano', 'sideLamp'), null);
  assert.equal(tourProp(null, 'nightLamp'), null);
  // Building and clearing the props leaves the template geometry usable, and the group is never batched.
  const model = new Group(), dressing = createDressing();
  const geometry = (prop) => { let g; prop.traverse(o => { if (!g && o.isMesh) g = o.geometry; }); return g; };
  const shared = geometry(pendant);
  let disposed = false;
  shared.addEventListener('dispose', () => { disposed = true; });
  const group = dressing.build(model, [{ kind: 'pendant', x: 1, y: 0, z: 2, angle: 0 }], {}, (prop) => tourProp('stone-walnut', prop.kind));
  assert.equal(group.userData.noBatch, true);
  assert.equal(geometry(group), shared);
  dressing.clear(model);
  assert.equal(disposed, false);
  assert.equal(model.children.length, 0);
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
