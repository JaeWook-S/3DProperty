import * as THREE from 'three';

// Visual facade design only: OSM constrains the shell, not window schedules.
// Instances keep the repeated facade details cheap and leave picking on the shell.
export function createFacade(record, materials) {
  const boxes = { glass: [], frame: [], slab: [] };
  const storey = record.height_m / record.levels;
  function inside([x, z], points) {
    let result = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [ax, az] = points[i], [bx, bz] = points[j];
      if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) result = !result;
    }
    return result;
  }
  for (const part of record.parts) {
    const points = part.footprint_m;
    const area = points.reduce((sum, [x, z], i) => {
      const [bx, bz] = points[(i + 1) % points.length]; return sum + x * bz - bx * z;
    }, 0);
    for (let edge = 0; edge < points.length; edge++) {
      const [ax, az] = points[edge], [bx, bz] = points[(edge + 1) % points.length];
      const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz);
      if (length < 1.2) continue;
      const nx = dz / length * Math.sign(area), nz = -dx / length * Math.sign(area);
      const angle = -Math.atan2(dz, dx), bays = Math.max(1, Math.floor(length / 2.7)), bay = length / bays;
      function box(kind, along, y, width, height, depth, offset) {
        boxes[kind].push({ x: ax + dx * along + nx * offset, y, z: az + dz * along + nz * offset, width, height, depth, angle });
      }
      for (let level = 0; level < part.levels; level++) {
        const bottom = level * storey, top = Math.min((level + 1) * storey, part.height_m);
        if (top - bottom < 1.5) continue;
        for (let col = 0; col < bays; col++) {
          const t = (col + .5) / bays;
          const exterior = [ax + dx * t + nx * .15, az + dz * t + nz * .15];
          if (record.parts.some(other => other !== part && other.height_m >= top - .1 && inside(exterior, other.footprint_m))) continue;
          const h = top - bottom;
          // A sill/spandrel and side piers reveal a recess around reflective glass.
          box('glass', t, bottom + h * .55, bay - .30, h * .75, .06, .085);
          box('frame', t, bottom + h * .55, .055, h * .75, .13, .13);
          box('slab', t, top - .13, bay, .26, .36, .13);
          box('frame', t, bottom + h * .18, bay - .26, .055, .14, .14);
        }
      }
      // Slim facade piers and a coping edge; the surveyed roof height is unchanged.
      for (let col = 0; col <= bays; col++) {
        box('slab', col / bays, part.height_m / 2, col % 3 === 0 ? .24 : .12, part.height_m, .25, .11);
      }
      box('slab', .5, part.height_m - .15, length, .30, .48, .14);
    }
  }
  const group = new THREE.Group(); group.name = 'Illustrative facade / windows and slab edges';
  const geometry = new THREE.BoxGeometry(1, 1, 1), dummy = new THREE.Object3D();
  for (const [kind, elements] of Object.entries(boxes)) {
    const mesh = new THREE.InstancedMesh(geometry, materials[kind], elements.length);
    mesh.name = `Facade ${kind}`; mesh.receiveShadow = true;
    // The shell supplies the building shadow. Tiny frames do not need another shadow pass.
    mesh.castShadow = false;
    elements.forEach((item, index) => {
      dummy.position.set(item.x, item.y, item.z); dummy.rotation.set(0, item.angle, 0);
      dummy.scale.set(item.width, item.height, item.depth); dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
      if (kind === 'glass') {
        const shade = .84 + ((index * 37) % 17) / 100;
        mesh.setColorAt(index, new THREE.Color(shade, shade, Math.min(1, shade + .025)));
      }
    });
    mesh.computeBoundingSphere(); group.add(mesh);
  }
  group.userData.windowCount = boxes.glass.length;
  return group;
}

export function createStoneMap() {
  const size = 256, canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(size, size);
  let seed = 781;
  for (let i = 0; i < size * size; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const value = 229 + (seed % 17), offset = i * 4;
    pixels.data.set([value, value - 2, value - 5, 255], offset);
  }
  ctx.putImageData(pixels, 0, 0);
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.set(.5, .5);
  map.name = 'Procedural fine mineral surface / illustrative';
  return map;
}

export function createGlazingMaps() {
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  // An illustrative interior-depth field behind the coated glass, not a photo
  // of an apartment. The sky supplies view-dependent reflections separately.
  const depth = ctx.createLinearGradient(0, 0, 0, 256);
  depth.addColorStop(0, '#758c99'); depth.addColorStop(.12, '#bccbd2');
  depth.addColorStop(.55, '#9badb9'); depth.addColorStop(1, '#405b70');
  ctx.fillStyle = depth; ctx.fillRect(0, 0, 128, 256);
  ctx.fillStyle = 'rgba(15,28,38,.25)'; ctx.fillRect(0, 0, 5, 256); ctx.fillRect(123, 0, 5, 256);
  ctx.fillRect(0, 0, 128, 8); ctx.fillRect(0, 250, 128, 6);
  const color = new THREE.CanvasTexture(canvas); color.colorSpace = THREE.SRGBColorSpace;
  color.name = 'Illustrative glazing / interior depth';
  const normalBytes = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const i = (y * 32 + x) * 4;
    normalBytes.set([128 + Math.round(3 * Math.sin(x / 31 * Math.PI * 2)), 128 + Math.round(2 * Math.sin(y / 31 * Math.PI * 2)), 255, 255], i);
  }
  const normal = new THREE.DataTexture(normalBytes, 32, 32); normal.needsUpdate = true;
  normal.name = 'Illustrative subtle glazing surface';
  return { color, normal };
}
