import { Box3, Vector3 } from 'three';
import { Octree } from 'three/addons/math/Octree.js';

// Architectural meshes combine very large walls with tiny beveled fittings.
// Bounding the broad-phase depth avoids duplicating those wall triangles down
// microscopic cells. Exact triangle/capsule tests remain Three.js's originals.
// r186's Octree.split creates children with default limits; enforce the limits
// through the recursion here rather than only setting them on the root.
export class BoundedOctree extends Octree {
  constructor(box) {
    super(box);
    this.maxLevel = 7;
    this.trianglesPerLeaf = 32;
  }
  split(level = 0) {
    const splitNode = (node, depth) => {
      const half = node.box.getSize(new Vector3()).multiplyScalar(0.5);
      const children = [];
      for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) {
        const min = node.box.min.clone().add(new Vector3(x, y, z).multiply(half));
        children.push(new Octree(new Box3(min, min.clone().add(half))));
      }
      for (const triangle of node.triangles) {
        for (const child of children) if (child.box.intersectsTriangle(triangle)) child.triangles.push(triangle);
      }
      node.triangles.length = 0;
      node.subTrees.length = 0;
      for (const child of children) {
        if (!child.triangles.length) continue;
        if (child.triangles.length > this.trianglesPerLeaf && depth + 1 < this.maxLevel) splitNode(child, depth + 1);
        node.subTrees.push(child);
      }
    };
    splitNode(this, level);
    return this;
  }
}
