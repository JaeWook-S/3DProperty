import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Mesh, BoxGeometry, MeshStandardMaterial, Texture, RepeatWrapping, SRGBColorSpace } from 'three';
import { FinishLibrary } from '../src/walkthrough/finishes.js';

const slots = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'];
function setup() {
  const library = new FinishLibrary({ capabilities: { getMaxAnisotropy: () => 8 } });
  const assets = { oak: new Texture(), limestone: new Texture() };
  for (const map of Object.values(assets)) { map.colorSpace = SRGBColorSpace; map.wrapS = map.wrapT = RepeatWrapping; }
  library.preload = async () => assets;
  return { library, assets };
}
function material(name = '112A / Bedroom light oak') {
  const result = new MeshStandardMaterial({ name, color: 0xb9a48e, roughness: .37, metalness: .08, aoMapIntensity: .65 });
  result.normalScale.set(.18, -.27);
  for (const key of ['map', 'normalMap', 'roughnessMap']) {
    const map = new Texture();
    map.channel = key === 'roughnessMap' ? 1 : 0;
    map.repeat.set(2, 3); map.offset.set(.1, .2); map.center.set(.4, .3); map.rotation = .3;
    map.matrixAutoUpdate = false;
    map.matrix.set(1.9, .8, .1, -.6, 2.8, .2, 0, 0, 1);
    map.flipY = false; map.wrapS = map.wrapT = RepeatWrapping;
    result[key] = map;
  }
  // The loader may share a packed ORM texture across multiple surface slots.
  result.aoMap = result.metalnessMap = result.roughnessMap;
  result.map.colorSpace = SRGBColorSpace;
  return result;
}
function model(...materials) {
  const root = new Group();
  for (const value of materials) root.add(new Mesh(new BoxGeometry(), value));
  return root;
}
function state(value) {
  return {
    color: value.color.toArray(), roughness: value.roughness, metalness: value.metalness,
    normalScale: value.normalScale.toArray(), normalMapType: value.normalMapType, aoMapIntensity: value.aoMapIntensity,
    maps: Object.fromEntries(slots.map(key => {
      const map = value[key];
      return [key, map && { uuid: map.uuid, repeat: map.repeat.toArray(), offset: map.offset.toArray(), center: map.center.toArray(),
        rotation: map.rotation, matrix: map.matrix.toArray(), matrixAutoUpdate: map.matrixAutoUpdate, channel: map.channel,
        wrapS: map.wrapS, wrapT: map.wrapT, flipY: map.flipY, colorSpace: map.colorSpace }];
    })),
  };
}

test('color-only presets clear mismatched PBR channels and restore shared maps, scalars and manual UV transforms', async () => {
  const { library } = setup(), surface = material(), root = model(surface, [surface, surface]);
  const original = state(surface), references = slots.map(key => surface[key]);
  await library.apply(root, 'original');
  await library.apply(root, 'oak');
  assert.notEqual(surface.map, references[0]);
  for (const key of slots.slice(1)) assert.equal(surface[key], null);
  assert.equal(surface.metalness, 0);
  // Detached originals may be changed by another consumer; restoration must still
  // recover the captured transform, including manual glTF rotation matrices.
  for (const texture of new Set(references)) {
    texture.channel = 3; texture.flipY = true; texture.colorSpace = SRGBColorSpace;
    texture.repeat.set(7, 8); texture.offset.set(9, 10); texture.center.set(0, 0);
    texture.rotation = 2; texture.matrix.identity(); texture.matrixAutoUpdate = true;
  }
  await library.apply(root, 'stone');
  for (const key of slots.slice(1)) assert.equal(surface[key], null);
  await library.apply(root, 'original');
  assert.deepEqual(state(surface), original);
  slots.forEach((key, index) => assert.equal(surface[key], references[index]));
  assert.equal(surface.aoMap, surface.roughnessMap);
  assert.equal(root.userData.finish, 'original');
});

test('switching floor presets leaves the existing catalog sofa PBR unchanged', async () => {
  const { library } = setup(), floor = material(), sofa = material('Catalog charcoal leather');
  const root = model(floor, sofa), original = state(sofa);
  for (const preset of ['oak', 'stone', 'original']) {
    await library.apply(root, preset);
    assert.deepEqual(state(sofa), original);
  }
});

test('failed texture loading leaves all materials and the committed finish unchanged', async () => {
  const { library } = setup(), surface = material(), root = model(surface);
  await library.apply(root, 'original');
  const original = state(surface);
  library.preload = async () => { throw new Error('missing texture'); };
  await assert.rejects(library.apply(root, 'oak'), /missing texture/);
  assert.deepEqual(state(surface), original);
  assert.equal(root.userData.finish, 'original');
});

test('different metric UV scales use independent preset textures without mutating source or original textures', async () => {
  const { library, assets } = setup(), first = material(), second = material();
  first.userData.texture_repeat_m = 1.2; second.userData.texture_repeat_m = 2.4;
  const originals = [state(first), state(second)], root = model(first, second);
  await library.apply(root, 'oak');
  assert.notEqual(first.map, second.map);
  assert.deepEqual(first.map.repeat.toArray(), [1, 1]);
  assert.deepEqual(second.map.repeat.toArray(), [2, 2]);
  assert.deepEqual(assets.oak.repeat.toArray(), [1, 1]);
  await library.apply(root, 'original');
  assert.deepEqual([state(first), state(second)], originals);
});
