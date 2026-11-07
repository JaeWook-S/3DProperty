import * as THREE from 'three';

function visibleForPicking(object) {
  for (let owner = object; owner; owner = owner.parent) {
    // Static batches hide logical wall meshes, whose geometry still blocks picking.
    if (!owner.visible && !owner.userData.renderBatched) return false;
  }
  return true;
}

export function pickFurniture(active, camera, { pointer = new THREE.Vector2(), maxDistance = Infinity, occluders = [], clippingPlanes = [] } = {}) {
  if (!active?.model || !active.staging) return null;
  active.model.updateWorldMatrix(true, true);
  camera.updateWorldMatrix(true, false);
  const meshes = [];
  for (const root of [active.model, ...occluders]) {
    root.updateWorldMatrix(true, true);
    root.traverse(object => {
      if (object.isMesh && !object.userData.renderBatch && visibleForPicking(object)) meshes.push(object);
    });
  }
  const ray = new THREE.Raycaster();
  ray.near = camera.near;
  ray.far = Math.min(maxDistance, camera.far);
  ray.setFromCamera(pointer, camera);
  // The split 3D view cuts away ceilings/upper walls. Only rendered portions
  // should occlude furniture, while the tour retains the full geometry.
  const hit = ray.intersectObjects(meshes, false).find(hit => clippingPlanes.every(plane => plane.distanceToPoint(hit.point) >= -1e-6));
  let owner = hit?.object;
  while (owner && !owner.userData.stagingId) owner = owner.parent;
  const item = owner && active.staging.items.find(value => value.id === owner.userData.stagingId && !value.deleted);
  return item ? { item, point: hit.point, distance: hit.distance } : null;
}

export function pickTourFurniture(active, camera, options = {}) {
  return pickFurniture(active, camera, { maxDistance: 4, ...options });
}
