import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, DirectionalLight, Group, Line, LineBasicMaterial, Matrix4, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, ObjectSpaceNormalMap, PlaneGeometry, PointLight, Sprite, Texture, Vector3 } from 'three';
import { createPathtraceSnapshot } from '../src/walkthrough/pathtrace-snapshot.js';
import { batchStaticMeshes } from '../src/walkthrough/static-batches.js';
import { createSurfaceMaterials } from '../src/walkthrough/surface-materials.js';
import { SurfaceMaterialLibrary } from '../src/walkthrough/surface-material-library.js';

function textureState(texture) {
  return { uuid: texture.uuid, sourceUuid: texture.source.uuid, sourceVersion: texture.source.version, version: texture.version,
    matrix: texture.matrix.toArray(), auto: texture.matrixAutoUpdate, repeat: texture.repeat.toArray(), offset: texture.offset.toArray(),
    rotation: texture.rotation, channel: texture.channel, flipY: texture.flipY, colorSpace: texture.colorSpace };
}
function geometryState(geometry) {
  return { index: geometry.index ? [...geometry.index.array] : null, attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([name, attr]) => [name, [...attr.array]])), groups: structuredClone(geometry.groups) };
}
function matrixState(object) { return { local: object.matrix.toArray(), world: object.matrixWorld.toArray(), auto: object.matrixAutoUpdate, dirty: object.matrixWorldNeedsUpdate }; }

test('world-space clones preserve live matrices, buffers, texture flags and source versions even when source matrices are stale', () => {
  const parent = new Group(), model = new Group(), material = new MeshStandardMaterial(), texture = new Texture({ width: 1, height: 1 });
  texture.repeat.set(2, 3); texture.offset.set(.2, .4); texture.rotation = .3; texture.channel = 1; texture.flipY = false;
  texture.matrixAutoUpdate = false; texture.matrix.set(2, .1, .2, .3, 3, .4, 0, 0, 1);
  material.map = texture; material.roughnessMap = texture; material.metalnessMap = texture;
  const mesh = new Mesh(new BoxGeometry(), material); model.add(mesh); parent.add(model);
  parent.position.set(4, 2, 1); parent.rotation.y = .2; model.position.set(1, 0, 3); mesh.position.set(2, 1, 0);
  const before = { matrix: [parent, model, mesh].map(matrixState), geometry: geometryState(mesh.geometry), texture: textureState(texture) };
  const snapshot = createPathtraceSnapshot({ model }), copy = snapshot.scene.children[0];
  const expected = new Matrix4().compose(parent.position, parent.quaternion, parent.scale)
    .multiply(new Matrix4().compose(model.position, model.quaternion, model.scale)).multiply(new Matrix4().compose(mesh.position, mesh.quaternion, mesh.scale));
  assert.deepEqual(copy.matrixWorld.toArray(), expected.toArray()); assert.notEqual(copy.geometry, mesh.geometry); assert.notEqual(copy.material, material);
  assert.notEqual(copy.material.map, texture); assert.notEqual(copy.material.map.source, texture.source);
  assert.equal(copy.material.map.image, texture.image); assert.equal(copy.material.map, copy.material.roughnessMap); assert.equal(copy.material.map, copy.material.metalnessMap);
  assert.equal(snapshot.stats.textures, 1); assert.deepEqual(copy.material.map.matrix.toArray(), texture.matrix.toArray()); assert.equal(copy.material.map.matrixAutoUpdate, false);
  copy.material.map.matrix.identity(); copy.material.map.matrixAutoUpdate = true; copy.material.map.needsUpdate = true;
  copy.geometry.computeTangents(); copy.geometry.attributes.position.setX(0, 999);
  assert.deepEqual([parent, model, mesh].map(matrixState), before.matrix); assert.deepEqual(geometryState(mesh.geometry), before.geometry); assert.deepEqual(textureState(texture), before.texture);
  snapshot.dispose();
});

test('same source material splits by tangent availability and only derivative tangent-space normals are corrected', () => {
  const model = new Group(), material = new MeshPhysicalMaterial(); material.normalMap = new Texture(); material.clearcoatNormalMap = material.normalMap;
  material.normalScale.set(.7, -.8); material.clearcoatNormalScale.set(.3, -.4);
  const noTangent = new Mesh(new PlaneGeometry(), material), withTangent = new Mesh(new PlaneGeometry(), material);
  withTangent.geometry.computeTangents(); model.add(noTangent, withTangent, new Mesh(new PlaneGeometry(), material));
  const objectNormal = material.clone(); objectNormal.normalMapType = ObjectSpaceNormalMap; objectNormal.clearcoatNormalMap = null; model.add(new Mesh(new PlaneGeometry(), objectNormal));
  const snapshot = createPathtraceSnapshot({ model }), [a, b, c, d] = snapshot.scene.children;
  assert.deepEqual(a.material.normalScale.toArray(), [.7, .8]); assert.deepEqual(a.material.clearcoatNormalScale.toArray(), [.3, .4]);
  assert.deepEqual(b.material.normalScale.toArray(), [.7, -.8]); assert.equal(a.material, c.material); assert.notEqual(a.material, b.material);
  assert.deepEqual(d.material.normalScale.toArray(), [.7, -.8]); assert.deepEqual(material.normalScale.toArray(), [.7, -.8]); assert.equal(a.geometry.attributes.tangent, undefined);
  assert.equal(snapshot.stats.normalBasisCorrections, 2); snapshot.dispose();
});

test('snapshot uses visible static batches with cap removal, excludes hidden source/highlight/basic/line/sprite, and keeps real surface overrides', () => {
  const model = new Group(), material = new MeshStandardMaterial();
  for (let i = 0; i < 2; i++) {
    const geometry = new BoxGeometry(2, 1, .2), position = geometry.attributes.position, index = geometry.index;
    const bottomIndex = vertex => [12, 13, 14, 15].find(j => position.getX(j) === position.getX(vertex) && position.getZ(j) === position.getZ(vertex));
    for (let triangle = 0; triangle < 2; triangle++) {
      const a = index.getX(12 + triangle * 3), b = index.getX(13 + triangle * 3), c = index.getX(14 + triangle * 3);
      index.setX(18 + triangle * 3, bottomIndex(a)); index.setX(19 + triangle * 3, bottomIndex(c)); index.setX(20 + triangle * 3, bottomIndex(b));
    }
    const mesh = new Mesh(geometry, material); mesh.position.y = .5 + i;
    mesh.userData = { component: 'wall', object_id: `Wall/layer-${i}/00`, inferred_wall: true, collision: true, layer_bottom_m: i }; model.add(mesh);
  }
  const batch = batchStaticMeshes(model); assert.ok(batch.removedInternalCapTriangles > 0);
  model.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()), new Line(new BoxGeometry(), new LineBasicMaterial()), new Sprite());
  const highlight = new Mesh(new PlaneGeometry(), material); highlight.userData.surfaceHighlight = true; model.add(highlight);
  const hiddenParent = new Group(); hiddenParent.visible = false; hiddenParent.add(new Mesh(new BoxGeometry(), material)); model.add(hiddenParent);
  const snapshot = createPathtraceSnapshot({ model });
  assert.equal(snapshot.stats.meshes, batch.drawMeshes); assert.equal(snapshot.stats.skipped.highlight, 1); assert.equal(snapshot.stats.skipped.unsupportedMaterial, 1);
  assert.equal(snapshot.stats.skipped.line, 1); assert.equal(snapshot.stats.skipped.sprite, 1);
  assert.deepEqual(geometryState(snapshot.scene.children[0].geometry), geometryState(batch.batches[0].geometry)); snapshot.dispose();
});

test('actual editor surfaceRenderParts are retained with 1 mm world normal offset while selection highlight and original geometry stay unchanged', async () => {
  const model = new Group(), material = new MeshStandardMaterial(), mesh = new Mesh(new BoxGeometry(2, 2, .2), material);
  mesh.userData = { component: 'wall', object_id: 'wall-1' }; model.add(mesh); model.scale.set(2, 1, 3); model.rotation.y = .2;
  const editor = createSurfaceMaterials({ library: new SurfaceMaterialLibrary({ loadTexture: async () => new Texture() }) });
  await editor.activate({ model, key: 'fixture', definition: { info: { rooms: [] } } }, 'unit'); editor.setEditing(true);
  editor.select([...editor.targets().values()].find(target => target.normal.z > .99).id); await editor.apply('greige-plaster-v1');
  const sources = []; model.traverse(o => { if (o.isMesh && o.userData.surfaceOverride && !o.userData.surfaceHighlight) sources.push(o); });
  const source = sources[0], before = geometryState(source.geometry); model.updateWorldMatrix(true, true);
  const snapshot = createPathtraceSnapshot({ model }), copy = snapshot.scene.children.find(o => o.userData.sourceUuid === source.uuid);
  assert.ok(copy); assert.equal(snapshot.stats.surfaceOverrides, 1); assert.equal(snapshot.stats.skipped.highlight, 1);
  const originalPoint = new Vector3().fromBufferAttribute(source.geometry.attributes.position, 0).applyMatrix4(source.matrixWorld);
  const copiedPoint = new Vector3().fromBufferAttribute(copy.geometry.attributes.position, 0).applyMatrix4(copy.matrixWorld);
  assert.ok(Math.abs(copiedPoint.distanceTo(originalPoint) - .001) < 1e-7); assert.deepEqual(geometryState(source.geometry), before);
  assert.equal(copy.material.userData.surfaceMaterial, 'greige-plaster-v1'); snapshot.dispose();
});

test('lights and targets have independent world transforms; disposal is idempotent and never disposes borrowed environment or originals', () => {
  const model = new Group(), geometry = new BoxGeometry(), material = new MeshStandardMaterial(), texture = new Texture(); material.map = texture; model.add(new Mesh(geometry, material));
  const group = new Group(); group.position.set(4, 0, 3); const sun = new DirectionalLight(); sun.position.set(1, 2, 3); group.add(sun, sun.target); sun.target.position.set(-1, 0, 2);
  const point = new PointLight(); point.visible = false; const environment = new Texture(), background = new Texture();
  let originalDisposals = 0, copiedDisposals = 0;
  for (const item of [geometry, material, texture, environment, background, sun]) item.addEventListener('dispose', () => originalDisposals++);
  const sourceMatrices = [sun, sun.target].map(matrixState);
  const snapshot = createPathtraceSnapshot({ model, lights: [sun, point], environment, background, environmentIntensity: .4 });
  const copiedSun = snapshot.scene.children.find(o => o.isDirectionalLight), copiedMesh = snapshot.scene.children.find(o => o.isMesh);
  assert.deepEqual(new Vector3().setFromMatrixPosition(copiedSun.matrix).toArray(), [5, 2, 6]);
  assert.deepEqual(new Vector3().setFromMatrixPosition(copiedSun.target.matrix).toArray(), [3, 0, 5]); assert.notEqual(copiedSun.target, sun.target);
  assert.equal(snapshot.scene.environment, environment); assert.equal(snapshot.scene.environmentIntensity, .4); assert.equal(snapshot.stats.lights, 1); assert.equal(snapshot.stats.skipped.light, 1);
  for (const item of [copiedMesh.geometry, copiedMesh.material, copiedMesh.material.map, copiedSun]) item.addEventListener('dispose', () => copiedDisposals++);
  snapshot.dispose(); snapshot.dispose(); assert.equal(copiedDisposals, 4); assert.equal(originalDisposals, 0); assert.deepEqual([sun, sun.target].map(matrixState), sourceMatrices);
});
