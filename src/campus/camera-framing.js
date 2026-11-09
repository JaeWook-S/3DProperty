import {MathUtils, Vector3} from 'three';

// Fit a world-space envelope to the real canvas frustum. Coordinates and target
// remain unchanged; only distance along the requested (orbit-safe) view changes.
export function fitPerspectiveEnvelope({points, target, position, fov, aspect,
  near = 5, minDistance = 35, maxPolarAngle = Math.PI * .47,
  safeX = .86, safeY = .78}) {
  if (!points.length || !(aspect > 0) || !(fov > 0 && fov < 180)) {
    throw new RangeError('A nonempty envelope and valid camera frustum are required');
  }
  const center = new Vector3(...target);
  const back = new Vector3(...position).sub(center);
  const requestedDistance = back.length();
  if (!requestedDistance) throw new RangeError('Camera position must differ from target');
  back.normalize();
  // OrbitControls applies this constraint during update; fit the final direction.
  const polar = Math.min(Math.acos(MathUtils.clamp(back.y, -1, 1)), maxPolarAngle);
  const azimuth = Math.atan2(back.x, back.z);
  back.set(Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth));
  const right = new Vector3().crossVectors(new Vector3(0, 1, 0), back).normalize();
  if (!right.lengthSq()) right.set(1, 0, 0);
  const up = new Vector3().crossVectors(back, right).normalize();
  const tanV = Math.tan(MathUtils.degToRad(fov) / 2), tanH = tanV * aspect;
  let distance = Math.max(requestedDistance, minDistance);
  for (const point of points) {
    const q = new Vector3(...point).sub(center), depth = q.dot(back);
    distance = Math.max(distance, depth + Math.abs(q.dot(right)) / (tanH * safeX),
      depth + Math.abs(q.dot(up)) / (tanV * safeY), depth + near + .1);
  }
  return {position: center.clone().addScaledVector(back, distance).toArray(), target: [...target], distance};
}

// Merged render batches are in the building's local axes. Transform their local
// box corners rather than using a larger, axis-aligned world bounding rectangle.
export function meshEnvelopePoints(group) {
  const points = [];
  group.updateWorldMatrix(true, true);
  group.traverse(mesh => {
    if (!mesh.isMesh) return;
    mesh.geometry.computeBoundingBox();
    const {min, max} = mesh.geometry.boundingBox;
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
      points.push(new Vector3(x, y, z).applyMatrix4(mesh.matrixWorld).toArray());
    }
  });
  return points;
}
