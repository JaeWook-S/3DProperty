import { Box3, BoxGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, PlaneGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const installed = new WeakMap();
const TRIANGLE_BUDGET = 5000;
const BASIS = 'illustrative hardware on identified source meshes; source frame sizes and hinge operation remain provisional';

function descendantOf(object, parent) {
  for (let owner = object; owner; owner = owner.parent) if (owner === parent) return true;
  return false;
}

function identityScale(object) {
  return object.scale.toArray().every(value => Math.abs(value - 1) < 1e-8);
}

// The current 211A exporter bakes meter-valued coordinates into each mesh.
// Reject a different export convention instead of interpreting its axes by eye.
function sourceBounds(object, opening) {
  if (!object?.isMesh || !object.geometry?.attributes.position || !identityScale(object) ||
      Math.abs(object.quaternion.x) + Math.abs(object.quaternion.y) + Math.abs(object.quaternion.z) > 1e-8 ||
      object.userData.opening_id !== opening.id) return null;
  const bounds = new Box3().setFromBufferAttribute(object.geometry.attributes.position);
  return [...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite) && !bounds.isEmpty() ? bounds : null;
}

function metadataValid(opening) {
  return ['x', 'z'].includes(opening.axis) && opening.center_m?.length === 2 &&
    [...opening.center_m, opening.width_m, opening.height_m, opening.bottom_m].every(Number.isFinite) &&
    opening.width_m > .1 && opening.height_m > .1;
}

function point(axis, along, y, normal) {
  return axis === 'x' ? [along, y, normal] : [normal, y, along];
}

function box(parts, axis, along, y, normal, width, height, depth) {
  const geometry = new BoxGeometry(...(axis === 'x' ? [width, height, depth] : [depth, height, width]));
  geometry.translate(...point(axis, along, y, normal)); parts.push(geometry);
}

function cylinder(parts, axis, along, y, normal, radius, length, vertical = false) {
  const geometry = new CylinderGeometry(radius, radius, length, 8);
  if (!vertical) {
    if (axis === 'x') geometry.rotateX(Math.PI / 2); else geometry.rotateZ(Math.PI / 2);
  }
  geometry.translate(...point(axis, along, y, normal)); parts.push(geometry);
}

function strip(parts, axis, along, y, normal, width, height) {
  const geometry = new PlaneGeometry(width, height);
  if (axis === 'z') geometry.rotateY(Math.PI / 2);
  geometry.translate(...point(axis, along, y, normal)); parts.push(geometry);
}

function addMesh(group, parts, material, name) {
  if (!parts.length) return;
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error('Architectural detail geometry could not be merged.');
  const object = new Mesh(geometry, material);
  object.name = name; object.castShadow = true; object.receiveShadow = true;
  Object.assign(object.userData, group.userData);
  group.add(object);
}

function newAttachment(source, opening, kind, moving) {
  const group = new Group();
  group.name = `211A / ${opening.id} / ${kind}`;
  Object.assign(group.userData, {component: 'decoration', collisionDisabled: true,
    pairedArchitecturalDetail: true, sourceObjectId: source.userData.object_id,
    sourceOpening: opening.id, detailBasis: BASIS});
  if (moving) group.userData.doorId = moving.definition.id;
  return {group, sourceObject: source, sourceObjectId: source.userData.object_id,
    openingId: opening.id, kind, moving: Boolean(moving)};
}

/**
 * Attach removable, render-only hardware to a loaded 211A source model.
 *
 * @param {{model: import('three').Object3D, info: object, doors?: object[]}} options
 * `info` is archisketchWebData(metadata).info (raw metadata also works).
 * Call after createDoors and source-only reference hiding, before
 * batchStaticMeshes. Only exact opening IDs and compatible baked mesh bounds
 * qualify. No source geometry, transforms, materials or metadata are changed.
 *
 * @returns {{attachments: object[], stats: object, collisionMeshes: [], dispose: Function}}
 * attachments are already children of their source meshes, including moving
 * leaves/panels. Do not add them to a separate scene group. Every added object is
 * collisionDisabled. Collision and transport walkers MUST honor that flag;
 * MovingDoor collisionTree must exclude these visual descendants on each update.
 * No ceiling components are added. Source unit and attachment scales remain 1.
 * dispose removes source attachments and their resources. If the caller has
 * batched static details, dispose its render batches too when unloading the model.
 */
export function createPairedArchitecturalDetails({model, info, doors = []} = {}) {
  if (model && installed.has(model)) return installed.get(model);
  const attachments = [], skipped = [];
  const stats = {revision: 'paired-architectural-details-v1', unitType: info?.unitType ?? info?.unit_type,
    meshCount: 0, triangleCount: 0, triangleBudget: TRIANGLE_BUDGET, hingedDoors: 0,
    glazingPanels: 0, handles: 0, hinges: 0, sealStrips: 0, ceilingMeshes: 0,
    newCollisionMeshes: 0, sourceGeometryChanged: false, sourceMaterialsChanged: false,
    sourceTransformsChanged: false, basis: BASIS, skipped};
  const materials = [];
  const result = {attachments, stats, collisionMeshes: [], dispose() {
    for (const {group} of attachments) {
      group.removeFromParent();
      group.traverse(object => { if (object.isMesh) object.geometry.dispose(); });
    }
    for (const material of materials) material.dispose();
    if (model && installed.get(model) === result) installed.delete(model);
  }};
  if (!model?.isObject3D || stats.unitType !== '211A' || !identityScale(model)) {
    skipped.push({reason: 'requires_211a_source_model_at_scale_one'}); return result;
  }
  const sourceMeshes = new Map();
  model.traverse(object => {
    const id = object.userData.object_id;
    if (!object.isMesh || !id || object.userData.pairedArchitecturalDetail) return;
    sourceMeshes.set(id, sourceMeshes.has(id) ? null : object);
  });
  const metal = new MeshStandardMaterial({color: 0xb3b0a6, metalness: .82, roughness: .3});
  const dark = new MeshStandardMaterial({color: 0x34332f, roughness: .6, metalness: .22});
  const seal = new MeshStandardMaterial({color: 0x393d39, roughness: .9, side: DoubleSide});
  metal.name = '211A hardware / satin nickel'; dark.name = '211A hardware / lock plate'; seal.name = '211A hardware / glazing seal';
  materials.push(metal, dark, seal);
  const attach = (record, counts) => {
    let meshes = 0, triangles = 0;
    record.group.traverse(object => {
      if (!object.isMesh) return;
      meshes++; triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
    });
    if (stats.triangleCount + triangles > TRIANGLE_BUDGET) {
      record.group.traverse(object => { if (object.isMesh) object.geometry.dispose(); });
      skipped.push({openingId: record.openingId, sourceObjectId: record.sourceObjectId, reason: 'triangle_budget'}); return;
    }
    record.sourceObject.add(record.group); attachments.push(record);
    stats.meshCount += meshes; stats.triangleCount += triangles;
    for (const [key, count] of Object.entries(counts)) stats[key] += count;
  };

  for (const opening of info.openings ?? []) {
    if (!metadataValid(opening)) { skipped.push({openingId: opening.id, reason: 'invalid_opening_metadata'}); continue; }
    const axis = opening.axis, normal = axis === 'x' ? 'z' : 'x';
    const center = opening.center_m[axis === 'x' ? 0 : 1], normalCenter = opening.center_m[axis === 'x' ? 1 : 0];
    if (opening.kind === 'door') {
      const source = sourceMeshes.get(`${opening.id}/leaf`), bounds = sourceBounds(source, opening);
      const matches = doors.filter(door => door.definition?.sourceOpening === opening.id);
      const door = matches.length === 1 ? matches[0] : null;
      const definition = door?.definition;
      const direction = definition?.closedDirection?.[axis === 'x' ? 0 : 1];
      if (!bounds || source.userData.component !== 'door_leaf' || definition?.type !== 'hinged' ||
          definition.objectId !== source.userData.object_id || !descendantOf(source, door.moving) ||
          ![-1, 1].includes(direction) ||
          Math.abs(bounds.max[axis] - bounds.min[axis] - opening.leaf_width_m) > .002 ||
          Math.abs(bounds.max.y - bounds.min.y - opening.leaf_height_m) > .002 ||
          !Number.isFinite(opening.leaf_width_m) || !Number.isFinite(opening.leaf_height_m) ||
          Math.abs((bounds.min[axis] + bounds.max[axis]) / 2 - center) > .002 ||
          Math.abs((bounds.min[normal] + bounds.max[normal]) / 2 - normalCenter) > .002 ||
          Math.abs(bounds.min.y - opening.bottom_m) > .002 || bounds.max[normal] - bounds.min[normal] > .1) {
        skipped.push({openingId: opening.id, reason: 'unresolved_leaf_bounds_or_moving_door'}); continue;
      }
      const record = newAttachment(source, opening, 'leaf hardware', door), parts = [], plates = [];
      const hinge = direction === 1 ? bounds.min[axis] : bounds.max[axis];
      const latch = (direction === 1 ? bounds.max[axis] : bounds.min[axis]) - direction * .085;
      const height = bounds.max.y - bounds.min.y, y = bounds.min.y + Math.min(1.03, height * .48);
      for (const side of [-1, 1]) {
        const face = side < 0 ? bounds.min[normal] : bounds.max[normal];
        cylinder(parts, axis, latch, y, face + side * .005, .025, .008);
        box(parts, axis, latch, y, face + side * .019, .018, .018, .026);
        box(parts, axis, latch - direction * .045, y, face + side * .034, .105, .018, .018);
        if (opening.id === 'door-00') {
          box(plates, axis, latch, y + .035, face + side * .002, .064, .22, .003);
          cylinder(parts, axis, latch, y + .103, face + side * .005, .011, .009);
        }
      }
      for (const yOffset of [.2, height / 2, height - .2]) {
        cylinder(parts, axis, hinge + direction * .006, bounds.min.y + yOffset, bounds.max[normal] + .005, .008, .075, true);
      }
      addMesh(record.group, parts, metal, `${record.group.name} / lever and hinges`);
      addMesh(record.group, plates, dark, `${record.group.name} / entrance lock plates`);
      attach(record, {hingedDoors: 1, handles: 2, hinges: 3});
    } else if (['sliding', 'window'].includes(opening.kind)) {
      // Require all four corresponding frame meshes; a name-only glass guess is
      // insufficient. The original frame, glass and clear opening remain intact.
      const frames = ['left', 'right', 'bottom', 'top'].map(edge => sourceMeshes.get(`${opening.id}/frame-${edge}`));
      if (frames.some(frame => frame?.userData.component !== 'opening_frame' || !sourceBounds(frame, opening))) {
        skipped.push({openingId: opening.id, reason: 'unresolved_glazing_frame'}); continue;
      }
      for (const index of [0, 1]) {
        const source = sourceMeshes.get(`${opening.id}/glass-${index}`), bounds = sourceBounds(source, opening);
        const clearWidth = opening.clear_span_m?.[0], clearHeight = opening.clear_span_m?.[1];
        if (!bounds || !['glass', 'sliding_panel'].includes(source.userData.component) ||
            !Number.isFinite(clearWidth) || !Number.isFinite(clearHeight) ||
            Math.abs(bounds.max[axis] - bounds.min[axis] - clearWidth / 2) > .002 ||
            Math.abs(bounds.max.y - bounds.min.y - clearHeight) > .002 ||
            Math.abs((bounds.min[axis] + bounds.max[axis]) / 2 - (center + (index ? 1 : -1) * clearWidth / 4)) > .002 ||
            Math.abs((bounds.min[normal] + bounds.max[normal]) / 2 - normalCenter) > .06 ||
            Math.abs((bounds.min.y + bounds.max.y) / 2 - (opening.bottom_m + opening.height_m / 2)) > .002 ||
            bounds.max[normal] - bounds.min[normal] > .04) {
          skipped.push({openingId: opening.id, sourceObjectId: `${opening.id}/glass-${index}`, reason: 'unresolved_glazing_bounds'}); continue;
        }
        const matching = doors.filter(door => descendantOf(source, door.moving));
        if (matching.length > 1 || (source.userData.doorId && matching.length !== 1)) {
          skipped.push({openingId: opening.id, reason: 'unresolved_panel_carrier'}); continue;
        }
        const record = newAttachment(source, opening, `panel ${index} seals${index ? '' : ' and pull'}`, matching[0]);
        const gaskets = [], pulls = [], width = bounds.max[axis] - bounds.min[axis], height = bounds.max.y - bounds.min.y;
        const middle = bounds.getCenter(new Vector3()), inset = .003;
        for (const side of [-1, 1]) {
          const face = side < 0 ? bounds.min[normal] : bounds.max[normal];
          for (const end of [-1, 1]) {
            strip(gaskets, axis, middle[axis] + end * (width / 2 - inset), middle.y, face + side * .0007, .006, height);
            strip(gaskets, axis, middle[axis], middle.y + end * (height / 2 - inset), face + side * .0007, width - .012, .006);
          }
          if (index === 0 && width > .12 && height > .3) {
            const along = bounds.max[axis] - .028;
            const y = Math.max(bounds.min.y + .14, Math.min(bounds.max.y - .14, opening.bottom_m + 1.03));
            for (const offset of [-.065, .065]) box(pulls, axis, along, y + offset, face + side * .013, .016, .018, .025);
            box(pulls, axis, along, y, face + side * .028, .016, .16, .016);
          }
        }
        addMesh(record.group, gaskets, seal, `${record.group.name} / seals`);
        addMesh(record.group, pulls, metal, `${record.group.name} / pull`);
        attach(record, {glazingPanels: 1, sealStrips: 8, handles: pulls.length ? 2 : 0});
      }
    }
  }
  installed.set(model, result);
  return result;
}
