import { Box3, BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { BoundedOctree } from './bounded-octree.js';

export function collisionTree(root, include = () => true) {
  root.updateWorldMatrix(true, true);
  const graph = new Group();
  root.traverse((object) => {
    if (!object.isMesh || !include(object)) return;
    const copy = new Mesh(object.geometry);
    copy.matrixAutoUpdate = false;
    copy.matrix.copy(object.matrixWorld);
    graph.add(copy);
  });
  return new BoundedOctree().fromGraphNode(graph);
}
export function combinedWorld(staticTree, doors) {
  return { capsuleIntersect(body) {
    let deepest = staticTree.capsuleIntersect(body);
    for (const door of doors) {
      const hit = door.tree.capsuleIntersect(body);
      if (hit && (!deepest || hit.depth > deepest.depth)) deepest = hit;
    }
    return deepest;
  } };
}

export class MovingDoor {
  constructor(definition, pivot, moving, applyProgress) {
    Object.assign(this, { definition, pivot, moving, applyProgress });
    this.progress = 0;
    this.target = 0;
    this.setProgress(0);
    moving.traverse((object) => { object.userData.doorId = definition.id; });
  }
  setProgress(progress) {
    this.progress = progress;
    this.applyProgress(progress);
    this.pivot.updateWorldMatrix(true, true);
    this.tree = collisionTree(this.moving);
  }
  toggle() { this.target = this.target >= 0.5 ? 0 : 1; }
  update(dt, body) {
    if (Math.abs(this.target - this.progress) < 1e-6) return { changed: false, blocked: false };
    const change = Math.sign(this.target - this.progress) * Math.min(Math.abs(this.target - this.progress), Math.min(dt, 0.25) / 0.85);
    // Sweep in <= ~2-degree increments, and keep the last non-overlapping pose.
    const steps = Math.max(1, Math.ceil(Math.abs(change) / 0.02));
    let changed = false;
    for (let i = 0; i < steps; i++) {
      const previous = this.progress;
      this.setProgress(previous + change / steps);
      const hit = this.tree.capsuleIntersect(body);
      if (hit && hit.depth > 0.0001) {
        this.setProgress(previous);
        this.target = previous;
        return { changed, blocked: true };
      }
      changed = true;
    }
    return { changed, blocked: false };
  }
  getState() {
    return { id: this.definition.id, name: this.definition.name, type: this.definition.type,
      progress: this.progress, target: this.target, moving: Math.abs(this.target - this.progress) > 1e-6 };
  }
}

export function createDoors(model, definitions) {
  const objects = new Map();
  model.traverse((object) => { if (object.userData.object_id) objects.set(object.userData.object_id, object); });
  const doors = [];
  const nickel = new MeshStandardMaterial({ color: 0x9d9890, metalness: 0.85, roughness: 0.3 });
  const frameMaterial = new MeshStandardMaterial({ color: 0xe5e1d8, roughness: 0.48 });
  const addBox = (parent, size, position, material) => {
    const mesh = new Mesh(new BoxGeometry(...size), material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  for (const definition of definitions) {
    const original = objects.get(definition.id);
    if (!original?.isMesh) throw new Error(`Door mesh missing: ${definition.id}`);
    const pivot = new Group();
    pivot.name = definition.name;
    model.add(pivot);
    if (definition.type === 'hinged') {
      pivot.position.set(...definition.hinge);
      pivot.updateWorldMatrix(true, true);
      pivot.attach(original); // preserves the exported, open leaf in world meters
      // A leaf and its handles share a hinge. Handles are visual details only.
      const handleGroup = new Group();
      original.add(handleGroup);
      const axisH = definition.axis === 'H';
      for (const side of [-1, 1]) {
        const h = new Group();
        h.position.set(axisH ? side * 0.045 : -definition.width * 0.32, -0.07, axisH ? definition.width * 0.32 : side * 0.045);
        const rose = new Mesh(new CylinderGeometry(0.028, 0.028, 0.012, 16), nickel);
        if (axisH) rose.rotation.z = Math.PI / 2; else rose.rotation.x = Math.PI / 2;
        h.add(rose);
        addBox(h, axisH ? [0.025, 0.018, 0.12] : [0.12, 0.018, 0.025], [0, 0, 0], nickel);
        handleGroup.add(h);
      }
      const door = new MovingDoor(definition, pivot, pivot, (p) => { pivot.rotation.y = (1 - p) * Math.PI / 2; });
      doors.push(door);
    } else {
      // A single exported sheet is partitioned into two real half-width leaves.
      // Only internal balcony openings are configured this way; facade windows stay fixed.
      original.visible = false;
      original.userData.collisionDisabled = true;
      const bounds = new Box3().setFromObject(original);
      const center = bounds.getCenter(new Vector3());
      const size = bounds.getSize(new Vector3());
      const span = size.x;
      pivot.position.copy(center);
      const moving = new Group();
      const fixed = new Group();
      pivot.add(moving, fixed);
      for (const [panel, sign] of [[moving, -1], [fixed, 1]]) {
        panel.position.x = sign * span / 4;
        panel.position.z = sign * 0.025;
        const glass = addBox(panel, [span / 2 - 0.035, size.y - 0.035, 0.008], [0, 0, 0], original.material);
        glass.castShadow = false;
        for (const edge of [-1, 1]) {
          addBox(panel, [0.035, size.y, 0.045], [edge * span / 4, 0, 0], frameMaterial);
          addBox(panel, [span / 2, 0.035, 0.045], [0, edge * size.y / 2, 0], frameMaterial);
        }
      }
      addBox(moving, [0.018, 0.2, 0.04], [span / 4 - 0.055, 0, -0.055], nickel);
      // The original center mullion belongs to the old unsplit glazing.
      const prefix = definition.sourceObject.replace(/ glazing$/, '');
      model.traverse((object) => {
        if (object.name.replaceAll('_', ' ').startsWith(`${prefix} mullion`)) {
          object.visible = false;
          object.userData.collisionDisabled = true;
        }
      });
      const door = new MovingDoor(definition, pivot, moving, (p) => { moving.position.x = -span / 4 + p * (span / 2 - 0.025); });
      doors.push(door);
    }
  }
  model.updateMatrixWorld(true);
  return doors;
}
