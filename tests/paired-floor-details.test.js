import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { createPairedDetails } from '../src/paired-floor/details.js';
import { staticCollisionMesh } from '../src/paired-floor/geometry.js';

const fixture = JSON.parse(fs.readFileSync(new URL('../src/paired-floor/layout.json', import.meta.url)));

function area(polygon) {
  return Math.abs(polygon.reduce((sum, [x, z], i) => {
    const next = polygon[(i + 1) % polygon.length]; return sum + x * next[1] - next[0] * z;
  }, 0)) / 2;
}

function triangleArea(geometry) {
  const position = geometry.attributes.position, index = geometry.index;
  let sum = 0;
  for (let i = 0; i < (index?.count ?? position.count); i += 3) {
    const points = [0, 1, 2].map(offset => new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(i + offset) : i + offset));
    const cross = points[1].sub(points[0]).cross(points[2].sub(points[0]));
    assert.ok(cross.y >= -1e-8, 'floor triangles must face upward'); sum += cross.length() / 2;
  }
  return sum;
}

for (const [variant, layout] of Object.entries(fixture.variants)) {
  test(`paired details ${variant}: exact floor outlines, unchanged source materials and clear openings`, () => {
    const info = JSON.parse(fs.readFileSync(new URL(`../assets/models/acro-river-park/211a/archisketch-structure-v1/${variant}/model-info.json`, import.meta.url)));
    const before = JSON.stringify(info), placement = layout.units.find(unit => unit.id === '211a');
    const model = new THREE.Group(), originalMaterial = new THREE.MeshStandardMaterial({color: 0x917454, roughness: .38});
    const wall = new THREE.Mesh(new THREE.BoxGeometry(.2, 2.3, 2), originalMaterial);
    wall.userData.component = 'wall'; wall.position.set(4, 1.15, 3); model.add(wall);
    model.position.set(...placement.translation); model.rotation.y = placement.rotationYRadians;
    const positions = [...wall.geometry.attributes.position.array], matrix = model.matrix.clone();
    const details = createPairedDetails({layout, units: [{id: '211a', placement, info, model}]});
    assert.deepEqual(details.collisionMeshes, []);
    assert.equal(JSON.stringify(info), before);
    assert.equal(wall.material, originalMaterial);
    assert.deepEqual([...wall.geometry.attributes.position.array], positions);
    assert.deepEqual(model.position.toArray(), placement.translation);
    assert.equal(model.rotation.y, placement.rotationYRadians);
    assert.equal(details.stats.sourceUnitMaterialsChanged, false);
    assert.equal(details.stats.interiors[0].floorSurfaces, info.rooms.filter(room => room.navigable !== false).length);
    assert.ok(details.stats.generatedTextureBytes < 2 * 1024 * 1024);
    assert.ok(details.stats.triangleCount < 10000);
    details.group.traverse(object => {
      if (!object.isMesh) return;
      assert.equal(staticCollisionMesh(object), false, object.name);
      object.geometry.computeBoundingBox();
      assert.ok(object.geometry.boundingBox.min.toArray().every(Number.isFinite));
      if (object.userData.sourceRoomPolygon) {
        const room = info.rooms.find(room => room.id === object.userData.room_id);
        assert.ok(Math.abs(triangleArea(object.geometry) - area(room.polygon_m)) < .0001, room.id);
        assert.equal(object.position.y, .0015);
      }
      if (!object.name.includes('/ skirting ')) return;
      const halfLength = object.geometry.parameters.width / 2;
      const tangent = [Math.cos(object.rotation.y), -Math.sin(object.rotation.y)];
      for (const opening of info.openings) {
        if (opening.bottom_m > .14) continue;
        const axis = opening.axis === 'x' ? [1, 0] : [0, 1];
        if (Math.abs(tangent[0] * axis[0] + tangent[1] * axis[1]) < .98) continue;
        const offset = [opening.center_m[0] - object.position.x, opening.center_m[1] - object.position.z];
        if (Math.abs(offset[0] * tangent[1] - offset[1] * tangent[0]) > .31) continue;
        const along = Math.abs(offset[0] * tangent[0] + offset[1] * tangent[1]);
        assert.ok(along >= halfLength + opening.width_m / 2 + .079, `${object.name} must leave ${opening.id} clear`);
      }
    });
    assert.ok(details.group.getObjectByName('Elevator / destination display'));
    assert.ok(details.group.getObjectByName('Entrance / 211A type sign'));
    assert.ok(details.group.getObjectByName('211A / mineral plaster on source wall surfaces'));
    const plaster = details.group.getObjectByName('211A / mineral plaster on source wall surfaces').geometry.attributes.position;
    for (let i = 0; i < plaster.count; i += 3) {
      assert.ok(Math.abs(plaster.getY(i) - plaster.getY(i + 1)) > 1e-6 || Math.abs(plaster.getY(i) - plaster.getY(i + 2)) > 1e-6,
        'render-only plaster must not restore horizontal internal caps');
    }
    // Updating cached matrices is allowed; the source's rigid placement is exact.
    assert.equal(matrix.elements[15], model.matrix.elements[15]);
  });
}

test('paired detail textures are deterministic and common door geometry stays intact', () => {
  const layout = fixture.variants.basic, commonGroup = new THREE.Group();
  const door = new THREE.Mesh(new THREE.BoxGeometry(.04, 2.1, .45), new THREE.MeshStandardMaterial());
  door.name = 'Elevator leaf -1'; door.userData.component = 'door'; door.position.set(-2.3, 1.05, .225); commonGroup.add(door);
  const source = [...door.geometry.attributes.position.array], position = door.position.toArray();
  const first = createPairedDetails({layout, commonGroup}), second = createPairedDetails({layout});
  const floorName = 'Common / hall stone 0';
  const a = first.group.getObjectByName(floorName).material.map, b = second.group.getObjectByName(floorName).material.map;
  assert.deepEqual(a.image.data, b.image.data);
  assert.deepEqual([...door.geometry.attributes.position.array], source);
  assert.deepEqual(door.position.toArray(), position);
  assert.equal(door.userData.component, 'door');
  assert.equal(door.material.metalness, .68);
});


test('211A door finish clones retain source material definitions and leaf geometry', () => {
  const layout = fixture.variants.expanded, placement = layout.units.find(unit => unit.id === '211a');
  const model = new THREE.Group(), original = new THREE.MeshStandardMaterial({color: 0x267579, roughness: .65});
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(.04, 2.3, .9), original);
  leaf.userData.object_id = 'door-00/leaf'; leaf.userData.doorId = 'paired-floor:211a:expanded:door-00'; model.add(leaf);
  const geometry = leaf.geometry, originalColor = original.color.getHex();
  const details = createPairedDetails({layout, units: [{id: '211a', placement, model, info: {rooms: [], openings: []}}]});
  assert.equal(leaf.geometry, geometry);
  assert.equal(leaf.parent, model);
  assert.equal(leaf.userData.doorId, 'paired-floor:211a:expanded:door-00');
  assert.notEqual(leaf.material, original);
  assert.equal(original.color.getHex(), originalColor);
  assert.equal(original.roughness, .65);
  assert.equal(leaf.material.color.getHex(), 0x71604c);
  assert.equal(details.stats.interiors[0].doorFinishes, 1);
  assert.equal(details.stats.sourceMaterialDefinitionsChanged, false);
});
