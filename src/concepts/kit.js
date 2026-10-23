import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FURNITURE } from './furniture-spec.js';

// Furniture built in code at the sizes in furniture-spec.js (meters, front = +Z).
// Palette slots are shared materials, so recoloring one restyles every placed piece.
// Each piece merges its parts per material, keeping draw calls low on phones.

const standard = (color, roughness, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
export const MATERIALS = {
  fabric: standard('#d6cab6', 0.95), fabric2: standard('#c2ac8c', 0.95),
  wood: standard('#c69c6d', 0.58), woodDark: standard('#7d5a3f', 0.55),
  metal: standard('#3b3833', 0.38, { metalness: 0.65 }), accent: standard('#8a9a72', 0.9),
  rug: standard('#e8dfcf', 1), rugPattern: standard('#b8916a', 1),
  bedding: standard('#f3eee5', 0.92), white: standard('#f1ede4', 0.5), pot: standard('#b97a55', 0.82),
};
// Fixed materials that read the same in every palette.
const FIXED = {
  leaf: standard('#58744b', 0.82), leafLight: standard('#7a9466', 0.82), screen: standard('#101317', 0.22, { metalness: 0.25 }),
  mattress: standard('#f6f4ee', 0.9), soil: standard('#4a3a2c', 1), mirror: standard('#dfe6e8', 0.08, { metalness: 0.15 }), sisal: standard('#c9b28b', 1),
  lamp: new THREE.MeshStandardMaterial({ color: '#fff1d6', emissive: '#ffd9a0', emissiveIntensity: 0.55, roughness: 0.8, side: THREE.DoubleSide }),
  book1: standard('#8b5e4a', 0.85), book2: standard('#d8cba9', 0.85), book3: standard('#4f6a7a', 0.85), book4: standard('#a9a59b', 0.85),
  toy1: standard('#f1a796', 0.8), toy2: standard('#f5d27f', 0.8), toy3: standard('#9fc6dc', 0.8), toy4: standard('#a9d1a2', 0.8),
};
for (const [name, material] of Object.entries({ ...MATERIALS, ...FIXED })) material.name = `Kit ${name}`;

/** Recolors the palette slots (hex strings keyed by slot name). */
export function applyPalette(colors) {
  for (const [slot, color] of Object.entries(colors)) MATERIALS[slot]?.color.set(color);
}

const cache = new Map();
const cached = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };
const rbox = (w, h, d, r = 0.02) => cached(`r${w},${h},${d},${r}`, () => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)));
const box = (w, h, d) => cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (top, bottom, h, segments = 20, open = false) => cached(`c${top},${bottom},${h},${segments},${open}`, () => new THREE.CylinderGeometry(top, bottom, h, segments, 1, open));
const ball = (r) => cached(`s${r}`, () => new THREE.IcosahedronGeometry(r, 1));

// Collects parts as [geometry, material, position, rotation] and merges them per material.
class Parts {
  constructor() { this.list = []; }
  add(geometry, material, [x, y, z], [rx = 0, ry = 0, rz = 0] = []) {
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
    this.list.push({ geometry, material, matrix });
    return this;
  }
  build(kind, { castShadow = true, center = true } = {}) {
    const group = new THREE.Group();
    const byMaterial = new Map();
    for (const part of this.list) {
      const placed = part.geometry.clone().applyMatrix4(part.matrix);
      for (const name of Object.keys(placed.attributes)) if (!['position', 'normal', 'uv'].includes(name)) placed.deleteAttribute(name);
      if (!placed.index) placed.setIndex([...Array(placed.attributes.position.count).keys()]);
      if (!byMaterial.has(part.material)) byMaterial.set(part.material, []);
      byMaterial.get(part.material).push(placed);
    }
    for (const [material, geometries] of byMaterial) {
      const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
      mesh.castShadow = castShadow && material !== MATERIALS.rug && material !== MATERIALS.rugPattern;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    // Center the footprint on the origin so the staging position is the plan center.
    if (center) {
      const bounds = new THREE.Box3().setFromObject(group);
      const middle = bounds.getCenter(new THREE.Vector3());
      for (const mesh of group.children) mesh.position.set(-middle.x, -bounds.min.y, -middle.z);
    }
    group.name = FURNITURE[kind]?.title ?? kind;
    group.userData.kitKind = kind;
    return group;
  }
}

// Seeded random numbers keep book spines identical between reloads.
function random(seed) { let s = seed >>> 0; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) ^ Math.imul(s ^ (s >>> 13), 3266489917)) >>> 0) / 4294967296; }

function legs(parts, w, d, h, material, inset = 0.07, radius = 0.022) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.add(cyl(radius, radius * 0.8, h, 12), material, [sx * (w / 2 - inset), h / 2, sz * (d / 2 - inset)]);
}

function sofa(w, d, h, seats) {
  const p = new Parts(), arm = 0.18, legH = 0.09, base = 0.21;
  legs(p, w, d, legH, MATERIALS.woodDark, 0.08);
  p.add(rbox(w, base, d, 0.035), MATERIALS.fabric, [0, legH + base / 2, 0]);
  for (const s of [-1, 1]) p.add(rbox(arm, 0.6 - legH, d, 0.06), MATERIALS.fabric, [s * (w / 2 - arm / 2), legH + (0.6 - legH) / 2, 0]);
  const inner = w - 2 * arm, cushion = inner / seats;
  for (let i = 0; i < seats; i++) {
    const x = -inner / 2 + cushion * (i + 0.5);
    p.add(rbox(cushion - 0.012, 0.13, d - 0.24, 0.05), MATERIALS.fabric, [x, legH + base + 0.065, 0.1]);
    p.add(rbox(cushion - 0.012, 0.44, 0.2, 0.08), MATERIALS.fabric, [x, h - 0.22, -d / 2 + 0.16], [-0.12, 0, 0]);
  }
  p.add(rbox(inner, h - legH - base, 0.13, 0.03), MATERIALS.fabric, [0, legH + base + (h - legH - base) / 2, -d / 2 + 0.065]);
  for (const s of [-1, 1]) p.add(rbox(0.42, 0.36, 0.12, 0.06), MATERIALS.accent, [s * (inner / 2 - 0.3), legH + base + 0.3, -d / 2 + 0.3], [-0.25, s * 0.25, s * 0.08]);
  return p;
}

function chair(p, x, z, facing, seat = MATERIALS.fabric, frame = MATERIALS.woodDark) {
  // facing: angle the sitter faces; the back sits behind.
  const dx = Math.sin(facing), dz = Math.cos(facing);
  const at = (f, s, y) => [x + dx * f + dz * s, y, z + dz * f - dx * s];
  for (const f of [-0.17, 0.17]) for (const s of [-0.18, 0.18]) p.add(cyl(0.016, 0.014, 0.44, 8), frame, at(f, s, 0.22));
  p.add(rbox(0.44, 0.045, 0.42, 0.015), seat, at(0, 0, 0.46), [0, facing, 0]);
  p.add(rbox(0.42, 0.36, 0.035, 0.012), frame, at(-0.2, 0, 0.7), [0, facing, 0]);
}

function dining(tableW, tableD, chairs) {
  const p = new Parts();
  p.add(rbox(tableW, 0.04, tableD, 0.012), MATERIALS.wood, [0, 0.73, 0]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.add(box(0.06, 0.71, 0.06), MATERIALS.woodDark, [sx * (tableW / 2 - 0.1), 0.355, sz * (tableD / 2 - 0.1)]);
  for (const [x, z, facing] of chairs) chair(p, x, z, facing);
  p.add(cyl(0.07, 0.05, 0.12, 16), MATERIALS.pot, [0, 0.81, 0]);
  p.add(ball(0.1), FIXED.leaf, [0, 0.92, 0]);
  p.add(rbox(Math.min(1.2, tableW * 0.6), 0.005, 0.3, 0.002), MATERIALS.accent, [0, 0.7525, 0]);
  return p;
}

function bed(w, d, { top = 0.3, headboard = 0.9, frameMaterial = MATERIALS.wood } = {}) {
  const p = new Parts();
  legs(p, w, d - 0.05, 0.06, MATERIALS.woodDark, 0.08, 0.025);
  p.add(rbox(w, top - 0.06, d - 0.05, 0.02), frameMaterial, [0, 0.06 + (top - 0.06) / 2, 0.025]);
  p.add(rbox(w - 0.1, 0.2, d - 0.18, 0.05), FIXED.mattress, [0, top + 0.1, 0.06]);
  p.add(rbox(w - 0.06, 0.07, (d - 0.18) * 0.68, 0.035), MATERIALS.bedding, [0, top + 0.215, 0.06 + (d - 0.18) * 0.16]);
  p.add(rbox(w - 0.06, 0.075, 0.32, 0.035), MATERIALS.accent, [0, top + 0.218, d / 2 - 0.3]);
  p.add(rbox(Math.min(0.62, w - 0.3), 0.12, 0.36, 0.06), MATERIALS.white, [0, top + 0.26, -d / 2 + 0.33]);
  p.add(rbox(w, headboard - 0.06, 0.07, 0.025), MATERIALS.fabric, [0, 0.06 + (headboard - 0.06) / 2, -d / 2 + 0.035]);
  return p;
}

function shelfBooks(p, x0, x1, y, depth, seed) {
  const r = random(seed), materials = [FIXED.book1, FIXED.book2, FIXED.book3, FIXED.book4, MATERIALS.accent];
  for (let x = x0; x < x1 - 0.03;) {
    const width = 0.025 + r() * 0.03, height = 0.17 + r() * 0.1;
    if (r() < 0.16) { x += 0.06 + r() * 0.08; continue; }
    p.add(box(width, height, depth * (0.7 + r() * 0.2)), materials[Math.floor(r() * materials.length)], [x + width / 2, y + height / 2, 0.01], [0, 0, r() < 0.12 ? 0.18 : 0]);
    x += width + 0.003;
  }
}

function shelf(w, d, h, { shelves = 5, books = true, material = MATERIALS.wood, seed = 7 } = {}) {
  const p = new Parts(), t = 0.024;
  for (const s of [-1, 1]) p.add(box(t, h, d), material, [s * (w / 2 - t / 2), h / 2, 0]);
  p.add(box(w - 2 * t, h, 0.01), MATERIALS.woodDark, [0, h / 2, -d / 2 + 0.005]);
  for (let i = 0; i <= shelves; i++) {
    const y = 0.04 + i * (h - 0.06) / shelves;
    p.add(box(w - 2 * t, t, d - 0.012), material, [0, y, 0.006]);
    const bays = Math.max(1, Math.round((w - 2 * t) / 0.78));
    if (books && i < shelves) for (let b = 0; b < bays; b++) {
      const x0 = -w / 2 + t + b * (w - 2 * t) / bays, x1 = x0 + (w - 2 * t) / bays;
      if (b > 0) p.add(box(t, (h - 0.06) / shelves, d - 0.012), material, [x0, y + (h - 0.06) / shelves / 2, 0.006]);
      shelfBooks(p, x0 + 0.02, x1 - 0.02, y + t / 2, d - 0.06, seed + i * 31 + b * 7);
    }
  }
  return p;
}

function deskTop(p, w, d, z, legMaterial = MATERIALS.metal) {
  p.add(rbox(w, 0.03, d, 0.008), MATERIALS.wood, [0, 0.735, z]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.add(box(0.03, 0.72, 0.03), legMaterial, [sx * (w / 2 - 0.05), 0.36, z + sz * (d / 2 - 0.05)]);
}
// `facing` is the direction the sitter looks (radians about +Y; Math.PI faces -Z).
function taskChair(p, x, z, facing = Math.PI) {
  const bx = -Math.sin(facing) * 0.2, bz = -Math.cos(facing) * 0.2;
  p.add(cyl(0.26, 0.26, 0.03, 20), MATERIALS.metal, [x, 0.05, z]);
  p.add(cyl(0.025, 0.025, 0.36, 10), MATERIALS.metal, [x, 0.25, z]);
  p.add(rbox(0.46, 0.07, 0.44, 0.03), MATERIALS.fabric2, [x, 0.46, z], [0, facing, 0]);
  p.add(rbox(0.44, 0.44, 0.05, 0.03), MATERIALS.fabric2, [x + bx, 0.73, z + bz], [0, facing, 0]);
}
function monitor(p, x, z, width = 0.55, turn = 0) {
  p.add(box(0.2, 0.012, 0.15), MATERIALS.metal, [x, 0.756, z]);
  p.add(box(0.03, 0.16, 0.03), MATERIALS.metal, [x, 0.83, z - 0.03]);
  p.add(rbox(width, 0.33, 0.025, 0.006), FIXED.screen, [x, 0.98, z], [0, turn, 0]);
}

const BUILDERS = {
  sofa4: () => sofa(2.6, 0.98, 0.8, 4),
  sofa3: () => sofa(2.2, 0.95, 0.8, 3),
  loveseat: () => sofa(1.6, 0.88, 0.78, 2),
  armchair() {
    const p = new Parts();
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.add(cyl(0.02, 0.014, 0.24, 10), MATERIALS.woodDark, [sx * 0.3, 0.12, sz * 0.3], [sz * 0.12, 0, -sx * 0.12]);
    p.add(rbox(0.72, 0.16, 0.7, 0.05), MATERIALS.fabric, [0, 0.31, 0.04]);
    p.add(rbox(0.6, 0.1, 0.56, 0.05), MATERIALS.fabric2, [0, 0.43, 0.08]);
    p.add(rbox(0.8, 0.52, 0.16, 0.07), MATERIALS.fabric, [0, 0.52, -0.33], [-0.1, 0, 0]);
    for (const s of [-1, 1]) p.add(rbox(0.12, 0.24, 0.66, 0.05), MATERIALS.fabric, [s * 0.34, 0.47, 0.04]);
    p.add(rbox(0.4, 0.32, 0.11, 0.05), MATERIALS.accent, [0, 0.6, -0.18], [-0.3, 0, 0]);
    return p;
  },
  coffeeRound() {
    const p = new Parts();
    p.add(cyl(0.45, 0.45, 0.035, 48), MATERIALS.wood, [0, 0.3625, 0]);
    p.add(cyl(0.12, 0.17, 0.33, 24), MATERIALS.woodDark, [0, 0.18, 0]);
    p.add(cyl(0.27, 0.27, 0.02, 32), MATERIALS.woodDark, [0, 0.01, 0]);
    p.add(rbox(0.26, 0.04, 0.2, 0.01), FIXED.book3, [-0.12, 0.4, 0.08], [0, 0.4, 0]);
    p.add(cyl(0.06, 0.05, 0.1, 16), MATERIALS.pot, [0.18, 0.43, -0.08]);
    return p;
  },
  coffeeRect() {
    const p = new Parts();
    p.add(rbox(1.1, 0.035, 0.6, 0.01), MATERIALS.wood, [0, 0.3625, 0]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.add(box(0.035, 0.345, 0.035), MATERIALS.metal, [sx * 0.5, 0.1725, sz * 0.25]);
    p.add(rbox(1.0, 0.02, 0.5, 0.005), MATERIALS.woodDark, [0, 0.12, 0]);
    p.add(rbox(0.3, 0.05, 0.22, 0.01), FIXED.book1, [-0.25, 0.405, 0.05], [0, -0.2, 0]);
    p.add(ball(0.06), FIXED.leafLight, [0.3, 0.43, -0.05]);
    p.add(cyl(0.05, 0.045, 0.06, 14), MATERIALS.pot, [0.3, 0.41, -0.05]);
    return p;
  },
  rugRound() {
    const p = new Parts();
    p.add(cyl(1.1, 1.1, 0.008, 64), MATERIALS.rug, [0, 0.004, 0]);
    p.add(cyl(0.94, 0.94, 0.004, 64), MATERIALS.rugPattern, [0, 0.009, 0]);
    p.add(cyl(0.88, 0.88, 0.004, 64), MATERIALS.rug, [0, 0.01, 0]);
    return p;
  },
  rugRect: () => rug(2.4, 1.7),
  rugSmall: () => rug(1.4, 0.9),
  playMat() {
    const p = new Parts(), colors = [FIXED.toy1, FIXED.toy2, FIXED.toy3, FIXED.toy4, MATERIALS.rug];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) p.add(rbox(0.395, 0.04, 0.345, 0.01), colors[(i + j * 2) % colors.length], [-0.8 + i * 0.4, 0.02, -0.525 + j * 0.35]);
    return p;
  },
  tvConsole() {
    const p = new Parts();
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.add(box(0.03, 0.08, 0.03), MATERIALS.metal, [sx * 0.84, 0.04, sz * 0.15]);
    p.add(rbox(1.8, 0.38, 0.42, 0.012), MATERIALS.white, [0, 0.27, 0]);
    p.add(rbox(1.8, 0.025, 0.42, 0.006), MATERIALS.wood, [0, 0.4725, 0]);
    for (const x of [-0.45, 0, 0.45]) p.add(box(0.004, 0.33, 0.004), MATERIALS.woodDark, [x, 0.27, 0.211]);
    p.add(box(0.36, 0.015, 0.22), MATERIALS.metal, [0, 0.4925, -0.05]);
    p.add(box(0.07, 0.05, 0.03), MATERIALS.metal, [0, 0.52, -0.05]);
    p.add(rbox(1.45, 0.83, 0.035, 0.008), FIXED.screen, [0, 0.915, -0.05]);
    p.add(ball(0.09), FIXED.leaf, [0.72, 0.6, 0.05]);
    p.add(cyl(0.07, 0.06, 0.14, 14), MATERIALS.pot, [0.72, 0.555, 0.05]);
    return p;
  },
  bookshelf: () => shelf(0.8, 0.33, 1.8, { seed: 11 }),
  bookshelfWide: () => shelf(2.4, 0.35, 1.8, { seed: 23 }),
  wardrobe2() {
    const p = new Parts();
    p.add(box(2.36, 0.06, 0.56), MATERIALS.woodDark, [0, 0.03, -0.01]);
    p.add(rbox(2.4, 2.04, 0.6, 0.008), MATERIALS.white, [0, 0.06 + 1.02, 0]);
    for (const x of [-0.6, 0, 0.6]) p.add(box(0.005, 1.98, 0.005), MATERIALS.woodDark, [x, 1.08, 0.301]);
    for (const x of [-0.65, -0.55, 0.55, 0.65, -0.05, 0.05]) p.add(box(0.016, 0.3, 0.03), MATERIALS.metal, [x, 1.1, 0.31]);
    return p;
  },
  toyShelf() {
    const p = new Parts(), bins = [FIXED.toy1, FIXED.toy3, FIXED.toy2, FIXED.toy4, FIXED.toy3, FIXED.toy1];
    p.add(rbox(1.2, 0.8, 0.35, 0.02), MATERIALS.white, [0, 0.4, 0]);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) p.add(rbox(0.34, 0.25, 0.04, 0.02), bins[i * 2 + j], [-0.4 + i * 0.4, 0.2 + j * 0.37, 0.165]);
    p.add(ball(0.08), FIXED.toy2, [-0.3, 0.88, 0]);
    p.add(rbox(0.16, 0.16, 0.16, 0.03), FIXED.toy3, [0.32, 0.88, 0]);
    return p;
  },
  teepee() {
    const p = new Parts(), r = 0.55 * Math.SQRT2;
    p.add(new THREE.ConeGeometry(r, 1.3, 4, 1, true), MATERIALS.fabric2, [0, 0.65, 0], [0, Math.PI / 4, 0]);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) p.add(cyl(0.015, 0.015, 1.62, 8), MATERIALS.wood, [sx * 0.22, 0.79, sz * 0.22], [-sz * 0.38, 0, sx * 0.38]);
    p.add(cyl(0.42, 0.42, 0.06, 28), MATERIALS.accent, [0, 0.03, 0]);
    p.add(rbox(0.3, 0.3, 0.12, 0.06), MATERIALS.white, [0.12, 0.2, -0.1], [-0.3, 0.3, 0]);
    return p;
  },
  kidsTable() {
    const p = new Parts();
    p.add(rbox(0.6, 0.03, 0.5, 0.06), MATERIALS.white, [0, 0.475, 0]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.add(cyl(0.022, 0.022, 0.46, 10), MATERIALS.wood, [sx * 0.24, 0.23, sz * 0.19]);
    for (const [z, material, s] of [[0.36, FIXED.toy3, 1], [-0.36, FIXED.toy1, -1]]) {
      p.add(rbox(0.3, 0.03, 0.18, 0.04), material, [0, 0.27, z]);
      p.add(rbox(0.3, 0.2, 0.03, 0.04), material, [0, 0.38, z + s * 0.08]);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.add(cyl(0.015, 0.015, 0.26, 8), MATERIALS.wood, [sx * 0.12, 0.13, z + sz * 0.07]);
    }
    p.add(rbox(0.16, 0.012, 0.22, 0.003), MATERIALS.white, [-0.1, 0.495, 0.05]);
    return p;
  },
  singleBed: () => bed(1.1, 2.15),
  loftBed() {
    const p = new Parts(), w = 1.1, d = 2.15;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.add(box(0.06, 1.65, 0.06), MATERIALS.wood, [sx * (w / 2 - 0.03), 0.825, sz * (d / 2 - 0.03)]);
    p.add(rbox(w, 0.1, d, 0.01), MATERIALS.wood, [0, 1.17, 0]);
    p.add(rbox(w - 0.1, 0.16, d - 0.14, 0.04), FIXED.mattress, [0, 1.3, 0]);
    p.add(rbox(w - 0.08, 0.06, (d - 0.14) * 0.66, 0.03), MATERIALS.bedding, [0, 1.4, 0.3]);
    p.add(rbox(0.56, 0.1, 0.32, 0.05), MATERIALS.white, [0, 1.42, -d / 2 + 0.3]);
    for (const z of [-1, 1]) p.add(box(w, 0.26, 0.03), MATERIALS.wood, [0, 1.5, z * (d / 2 - 0.015)]);
    p.add(box(0.03, 0.26, d * 0.6), MATERIALS.wood, [w / 2 - 0.015, 1.5, -d * 0.2]);
    p.add(box(0.03, 0.26, d), MATERIALS.wood, [-w / 2 + 0.015, 1.5, 0]);
    for (const z of [0.55, 0.95]) p.add(box(0.035, 1.17, 0.035), MATERIALS.wood, [w / 2 - 0.02, 0.585, z]);
    for (let y = 0.25; y < 1.15; y += 0.25) p.add(box(0.03, 0.03, 0.4), MATERIALS.wood, [w / 2 - 0.02, y, 0.75]);
    p.add(rbox(0.6, 0.03, 1.3, 0.008), MATERIALS.wood, [-w / 2 + 0.33, 0.74, -0.25]);
    p.add(box(0.03, 0.72, 0.03), MATERIALS.metal, [-w / 2 + 0.6, 0.36, -0.85]);
    p.add(box(0.03, 0.72, 0.03), MATERIALS.metal, [-w / 2 + 0.6, 0.36, 0.35]);
    shelfBooks(p, -0.3, 0.05, 0.755, 0.18, 41);
    taskChair(p, 0.18, -0.2, -Math.PI / 2);
    return p;
  },
  crib() {
    const p = new Parts(), w = 0.7, d = 1.3;
    legs(p, w, d, 0.2, MATERIALS.white, 0.03, 0.02);
    p.add(box(w - 0.04, 0.04, d - 0.04), MATERIALS.white, [0, 0.26, 0]);
    p.add(rbox(w - 0.1, 0.1, d - 0.1, 0.03), FIXED.mattress, [0, 0.33, 0]);
    p.add(rbox(w - 0.14, 0.04, 0.5, 0.02), MATERIALS.bedding, [0, 0.4, 0.22]);
    for (const s of [-1, 1]) {
      p.add(box(0.04, 0.04, d), MATERIALS.white, [s * (w / 2 - 0.02), 0.93, 0]);
      for (let z = -d / 2 + 0.08; z < d / 2 - 0.05; z += 0.08) p.add(box(0.018, 0.64, 0.018), MATERIALS.white, [s * (w / 2 - 0.02), 0.6, z]);
      p.add(rbox(w, 0.75, 0.035, 0.012), MATERIALS.white, [0, 0.575, s * (d / 2 - 0.0175)]);
    }
    p.add(ball(0.06), FIXED.toy2, [0.08, 0.46, -0.3]);
    return p;
  },
  deskSet() {
    const p = new Parts();
    deskTop(p, 1.0, 0.55, -0.2);
    p.add(cyl(0.06, 0.07, 0.02, 16), MATERIALS.metal, [0.36, 0.76, -0.38]);
    p.add(cyl(0.008, 0.008, 0.36, 8), MATERIALS.metal, [0.36, 0.93, -0.38]);
    p.add(cyl(0.05, 0.08, 0.09, 16, true), FIXED.lamp, [0.32, 1.11, -0.33], [0.5, 0, 0]);
    p.add(rbox(0.32, 0.012, 0.22, 0.004), MATERIALS.metal, [-0.05, 0.758, -0.15]);
    p.add(rbox(0.32, 0.21, 0.01, 0.004), FIXED.screen, [-0.05, 0.86, -0.26], [-0.25, 0, 0]);
    shelfBooks(p, -0.48, -0.32, 0.75, 0.2, 5);
    taskChair(p, 0, 0.22);
    return p;
  },
  deskWide() {
    const p = new Parts();
    deskTop(p, 1.8, 0.7, -0.25);
    for (const x of [-0.45, 0.45]) { monitor(p, x, -0.48); taskChair(p, x, 0.35); p.add(rbox(0.36, 0.012, 0.13, 0.004), MATERIALS.white, [x, 0.756, -0.2]); }
    p.add(ball(0.08), FIXED.leaf, [0.82, 0.86, -0.5]);
    p.add(cyl(0.06, 0.05, 0.1, 14), MATERIALS.pot, [0.82, 0.8, -0.5]);
    return p;
  },
  deskPro() {
    const p = new Parts();
    deskTop(p, 1.6, 0.7, -0.25);
    monitor(p, -0.29, -0.45, 0.6, 0.18);
    monitor(p, 0.29, -0.45, 0.6, -0.18);
    p.add(rbox(0.44, 0.012, 0.14, 0.004), MATERIALS.white, [0, 0.756, -0.18]);
    p.add(cyl(0.06, 0.07, 0.02, 16), MATERIALS.metal, [0.68, 0.76, -0.5]);
    p.add(cyl(0.008, 0.008, 0.4, 8), MATERIALS.metal, [0.68, 0.95, -0.5]);
    p.add(cyl(0.05, 0.08, 0.09, 16, true), FIXED.lamp, [0.64, 1.12, -0.46], [0.5, 0, 0]);
    taskChair(p, 0, 0.35);
    return p;
  },
  dining6: () => dining(1.8, 0.9, [-0.6, 0, 0.6].flatMap((x) => [[x, 0.68, Math.PI], [x, -0.68, 0]])),
  dining4: () => dining(1.4, 0.8, [-0.35, 0.35].flatMap((x) => [[x, 0.6, Math.PI], [x, -0.6, 0]])),
  dining2() {
    const p = new Parts();
    p.add(cyl(0.4, 0.4, 0.035, 40), MATERIALS.wood, [0, 0.7325, 0]);
    p.add(cyl(0.05, 0.05, 0.69, 16), MATERIALS.woodDark, [0, 0.36, 0]);
    p.add(cyl(0.24, 0.24, 0.025, 28), MATERIALS.woodDark, [0, 0.0125, 0]);
    chair(p, -0.58, 0, Math.PI / 2);
    chair(p, 0.58, 0, -Math.PI / 2);
    p.add(cyl(0.05, 0.04, 0.12, 16), MATERIALS.pot, [0, 0.81, 0]);
    p.add(ball(0.08), FIXED.leafLight, [0, 0.9, 0]);
    return p;
  },
  // Low, boxy modular sofa on a recessed plinth: deep seats, no visible legs.
  sofaLow() {
    const p = new Parts(), w = 2.6, d = 1.02, seats = 3, plinth = 0.06, base = 0.24;
    p.add(box(w - 0.08, plinth, d - 0.08), MATERIALS.woodDark, [0, plinth / 2, 0]);
    p.add(rbox(w, base, d, 0.03), MATERIALS.fabric, [0, plinth + base / 2, 0]);
    const cushion = w / seats;
    for (let i = 0; i < seats; i++) {
      const x = -w / 2 + cushion * (i + 0.5);
      p.add(rbox(cushion - 0.014, 0.14, d - 0.3, 0.06), MATERIALS.fabric, [x, plinth + base + 0.07, 0.12]);
      p.add(rbox(cushion - 0.03, 0.3, 0.24, 0.1), MATERIALS.fabric, [x, plinth + base + 0.17, -d / 2 + 0.2], [-0.1, 0, 0]);
    }
    p.add(rbox(w, 0.68 - plinth - base, 0.12, 0.04), MATERIALS.fabric, [0, plinth + base + (0.68 - plinth - base) / 2, -d / 2 + 0.06]);
    p.add(rbox(0.46, 0.3, 0.12, 0.06), MATERIALS.accent, [-w / 2 + 0.4, plinth + base + 0.27, -d / 2 + 0.3], [-0.2, 0.2, 0]);
    p.add(rbox(0.34, 0.025, 0.24, 0.008), MATERIALS.fabric2, [w / 2 - 0.5, plinth + base + 0.155, 0.2], [0, 0.15, 0]);
    return p;
  },
  sideboard() {
    const p = new Parts(), w = 1.8, d = 0.45;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.add(cyl(0.018, 0.014, 0.12, 10), MATERIALS.metal, [sx * (w / 2 - 0.08), 0.06, sz * (d / 2 - 0.07)]);
    p.add(rbox(w, 0.46, d, 0.012), MATERIALS.wood, [0, 0.12 + 0.23, 0]);
    for (const x of [-0.6, 0, 0.6]) p.add(rbox(0.58, 0.4, 0.012, 0.004), MATERIALS.woodDark, [x, 0.35, d / 2 + 0.002]);
    for (const x of [-0.36, 0.36]) p.add(box(0.12, 0.012, 0.02), MATERIALS.metal, [x, 0.48, d / 2 + 0.012]);
    p.add(cyl(0.07, 0.05, 0.22, 18), MATERIALS.white, [-0.6, 0.69, 0]);
    p.add(rbox(0.28, 0.06, 0.2, 0.01), FIXED.book2, [0.15, 0.61, 0.02], [0, 0.2, 0]);
    p.add(rbox(0.24, 0.04, 0.18, 0.01), FIXED.book3, [0.15, 0.66, 0.02], [0, -0.1, 0]);
    p.add(ball(0.06), MATERIALS.accent, [0.6, 0.64, 0]);
    return p;
  },
  queenBed: () => bed(1.65, 2.15, { headboard: 1.0, frameMaterial: MATERIALS.woodDark }),
  dresser() {
    const p = new Parts(), w = 1.0;
    // Table against the wall (back at -Z), mirror above, stool in front.
    legs(p, w, 0.42, 0.72, MATERIALS.wood, 0.05, 0.016);
    p.add(rbox(w, 0.04, 0.42, 0.01), MATERIALS.white, [0, 0.74, -0.215]);
    p.add(rbox(w - 0.1, 0.12, 0.38, 0.008), MATERIALS.white, [0, 0.66, -0.215]);
    p.add(cyl(0.3, 0.3, 0.02, 40), MATERIALS.metal, [0, 1.14, -0.41], [Math.PI / 2, 0, 0]);
    p.add(cyl(0.28, 0.28, 0.022, 40), FIXED.mirror, [0, 1.14, -0.4], [Math.PI / 2, 0, 0]);
    p.add(cyl(0.035, 0.035, 0.12, 14), MATERIALS.pot, [0.3, 0.82, -0.25]);
    p.add(cyl(0.025, 0.03, 0.08, 14), MATERIALS.accent, [0.38, 0.8, -0.2]);
    p.add(cyl(0.2, 0.2, 0.06, 28), MATERIALS.fabric2, [0, 0.45, 0.2]);
    p.add(cyl(0.018, 0.018, 0.42, 10), MATERIALS.metal, [0, 0.21, 0.2]);
    p.add(cyl(0.16, 0.16, 0.012, 24), MATERIALS.metal, [0, 0.006, 0.2]);
    return p;
  },
  piano() {
    const p = new Parts(), w = 1.5, case_ = 0.6, h = 1.25;
    const back = -0.95 / 2 + case_ / 2;
    p.add(rbox(w, h - 0.04, 0.32, 0.012), MATERIALS.woodDark, [0, (h - 0.04) / 2 + 0.04, back - 0.14]);
    p.add(rbox(w, 0.04, case_, 0.01), MATERIALS.woodDark, [0, h - 0.02, back]);
    p.add(rbox(w - 0.12, 0.1, 0.3, 0.01), MATERIALS.woodDark, [0, 0.68, back + 0.12]);
    p.add(box(w - 0.18, 0.02, 0.16), MATERIALS.white, [0, 0.74, back + 0.17]);
    for (let i = 0; i < 36; i++) if ([1, 2, 4, 5, 6].includes(i % 7)) p.add(box(0.016, 0.018, 0.09), FIXED.screen, [-(w - 0.18) / 2 + 0.02 + i * 0.0365, 0.755, back + 0.13]);
    for (const s of [-1, 1]) p.add(rbox(0.06, 0.66, case_ - 0.08, 0.01), MATERIALS.woodDark, [s * (w / 2 - 0.03), 0.37, back + 0.02]);
    p.add(box(0.04, 0.04, 0.04), MATERIALS.metal, [-0.12, 0.06, back + 0.1]);
    p.add(box(0.04, 0.04, 0.04), MATERIALS.metal, [0.12, 0.06, back + 0.1]);
    p.add(rbox(0.36, 0.26, 0.012, 0.004), FIXED.book2, [0.05, 0.96, back + 0.05], [-0.25, 0, 0]);
    // Bench in front.
    p.add(rbox(0.7, 0.06, 0.32, 0.015), MATERIALS.fabric, [0, 0.48, 0.95 / 2 - 0.17]);
    legs(p, 0.66, 0.3, 0.45, MATERIALS.woodDark, 0.04, 0.016);
    for (const part of p.list.slice(-4)) part.matrix.premultiply(new THREE.Matrix4().makeTranslation(0, 0, 0.95 / 2 - 0.17));
    p.add(cyl(0.05, 0.04, 0.12, 14), MATERIALS.pot, [w / 2 - 0.2, h + 0.06, back]);
    p.add(ball(0.07), FIXED.leafLight, [w / 2 - 0.2, h + 0.15, back]);
    return p;
  },
  catTower() {
    const p = new Parts(), sisal = FIXED.sisal;
    p.add(rbox(0.6, 0.05, 0.5, 0.02), MATERIALS.fabric2, [0, 0.025, 0]);
    for (const [x, z, h] of [[-0.18, -0.14, 1.45], [0.18, 0.12, 0.95], [-0.18, 0.14, 0.6]]) p.add(cyl(0.055, 0.055, h, 16), sisal, [x, h / 2 + 0.05, z]);
    p.add(rbox(0.46, 0.04, 0.4, 0.02), MATERIALS.fabric2, [-0.05, 0.62, 0.02]);
    p.add(rbox(0.42, 0.04, 0.36, 0.02), MATERIALS.fabric2, [0.06, 0.98, 0.04]);
    p.add(cyl(0.2, 0.19, 0.1, 24), MATERIALS.fabric2, [-0.1, 1.53, -0.05]);
    p.add(cyl(0.16, 0.16, 0.04, 24), MATERIALS.fabric, [-0.1, 1.58, -0.05]);
    p.add(rbox(0.3, 0.26, 0.28, 0.06), MATERIALS.fabric2, [0.12, 0.25, -0.08]);
    p.add(cyl(0.07, 0.07, 0.02, 16), FIXED.screen, [0.12, 0.25, 0.061], [Math.PI / 2, 0, 0]);
    return p;
  },
  petBed() {
    const p = new Parts();
    p.add(cyl(0.4, 0.4, 0.08, 36), MATERIALS.fabric2, [0, 0.04, 0]);
    p.add(new THREE.TorusGeometry(0.33, 0.07, 10, 36), MATERIALS.fabric2, [0, 0.13, 0], [Math.PI / 2, 0, 0]);
    p.add(cyl(0.3, 0.3, 0.05, 32), MATERIALS.fabric, [0, 0.105, 0]);
    p.add(ball(0.05), FIXED.toy2, [0.14, 0.17, 0.08]);
    return p;
  },
  yogaMat() {
    const p = new Parts();
    p.add(rbox(0.65, 0.006, 1.85, 0.003), MATERIALS.accent, [0, 0.003, 0]);
    return p;
  },
  exerciseBike() {
    const p = new Parts();
    for (const z of [-0.45, 0.45]) p.add(rbox(0.55, 0.05, 0.08, 0.02), MATERIALS.metal, [0, 0.025, z]);
    p.add(box(0.06, 0.06, 0.95), MATERIALS.metal, [0, 0.1, 0]);
    p.add(cyl(0.22, 0.22, 0.05, 32), MATERIALS.metal, [0, 0.36, 0.33], [0, 0, Math.PI / 2]);
    p.add(box(0.05, 0.75, 0.05), MATERIALS.metal, [0, 0.5, -0.12], [0.18, 0, 0]);
    p.add(box(0.05, 0.85, 0.05), MATERIALS.metal, [0, 0.55, 0.38], [-0.25, 0, 0]);
    p.add(rbox(0.22, 0.06, 0.28, 0.03), MATERIALS.fabric2, [0, 0.9, -0.2]);
    p.add(cyl(0.015, 0.015, 0.45, 10), MATERIALS.metal, [0, 1.1, 0.5], [0, 0, Math.PI / 2]);
    p.add(rbox(0.16, 0.1, 0.03, 0.01), FIXED.screen, [0, 1.2, 0.48], [-0.5, 0, 0]);
    return p;
  },
  dumbbellRack() {
    const p = new Parts();
    for (const sx of [-1, 1]) p.add(box(0.04, 0.8, 0.36), MATERIALS.metal, [sx * 0.35, 0.4, 0]);
    for (const [y, r] of [[0.25, 0.05], [0.52, 0.045], [0.76, 0.04]]) {
      p.add(box(0.7, 0.025, 0.3), MATERIALS.metal, [0, y - 0.07, 0], [0.25, 0, 0]);
      for (const x of [-0.22, 0, 0.22]) for (const s of [-1, 1]) p.add(cyl(r, r, 0.05, 14), FIXED.screen, [x + s * 0.07, y, 0], [0, 0, Math.PI / 2]);
      for (const x of [-0.22, 0, 0.22]) p.add(cyl(0.014, 0.014, 0.1, 8), MATERIALS.metal, [x, y, 0], [0, 0, Math.PI / 2]);
    }
    return p;
  },
  floorMirror() {
    const p = new Parts();
    p.add(rbox(0.6, 1.75, 0.04, 0.02), MATERIALS.woodDark, [0, 0.875, -0.12], [-0.1, 0, 0]);
    p.add(box(0.52, 1.66, 0.01), FIXED.mirror, [0, 0.88, -0.095], [-0.1, 0, 0]);
    for (const sx of [-1, 1]) p.add(box(0.03, 0.03, 0.3), MATERIALS.woodDark, [sx * 0.25, 0.015, 0.02]);
    return p;
  },
  plant() {
    const p = new Parts();
    p.add(cyl(0.2, 0.16, 0.38, 24), MATERIALS.pot, [0, 0.19, 0]);
    p.add(cyl(0.185, 0.185, 0.02, 24), FIXED.soil, [0, 0.37, 0]);
    p.add(cyl(0.02, 0.03, 0.5, 8), MATERIALS.woodDark, [0, 0.62, 0]);
    for (const [x, y, z, r] of [[0, 1.16, 0, 0.2], [-0.1, 0.98, 0.05, 0.16], [0.1, 1.02, -0.08, 0.15], [0.03, 0.84, 0.13, 0.12], [-0.06, 0.88, -0.13, 0.12], [0.05, 1.28, 0.03, 0.12]])
      p.add(ball(r), y > 1.1 ? FIXED.leafLight : FIXED.leaf, [x, y, z]);
    return p;
  },
  floorLamp() {
    const p = new Parts();
    p.add(cyl(0.16, 0.18, 0.03, 24), MATERIALS.metal, [0, 0.015, 0]);
    p.add(cyl(0.012, 0.012, 1.34, 10), MATERIALS.metal, [0, 0.69, 0]);
    p.add(cyl(0.14, 0.2, 0.27, 28, true), FIXED.lamp, [0, 1.465, 0]);
    return p;
  },
};

function rug(w, d) {
  const p = new Parts(), b = 0.06, inset = 0.14;
  p.add(box(w, 0.008, d), MATERIALS.rug, [0, 0.004, 0]);
  for (const s of [-1, 1]) {
    p.add(box(w - 2 * inset, 0.004, b), MATERIALS.rugPattern, [0, 0.0095, s * (d / 2 - inset)]);
    p.add(box(b, 0.004, d - 2 * inset), MATERIALS.rugPattern, [s * (w / 2 - inset), 0.0095, 0]);
  }
  return p;
}

// --- styling props (src/concepts/dressing.js places them) -------------------------------
// Decoration only: wall art, curtains, lamps and shelves. Not staging items or colliders.

/** Abstract print for wall art, drawn in the palette's colors (seeded, so it is stable). */
function artTexture(w, h, colors, seed) {
  const scale = 320, canvas = Object.assign(document.createElement('canvas'), { width: Math.round(w * scale), height: Math.round(h * scale) });
  const c = canvas.getContext('2d'), W = canvas.width, H = canvas.height, r = random(seed);
  c.fillStyle = '#f3efe7'; c.fillRect(0, 0, W, H);
  const tones = [colors.accent, colors.fabric2, colors.wood, colors.rugPattern, colors.woodDark];
  const pick = () => tones[Math.floor(r() * tones.length)];
  const style = seed % 4;
  c.globalAlpha = 0.92;
  if (style === 0) { // arches
    for (let i = 0; i < 2; i++) {
      const aw = W * (0.34 + r() * 0.16), ax = W * (0.18 + i * 0.36 + r() * 0.06), ay = H * (0.3 + r() * 0.1);
      c.fillStyle = pick(); c.beginPath(); c.moveTo(ax, H * 0.86); c.lineTo(ax, ay + aw / 2); c.arc(ax + aw / 2, ay + aw / 2, aw / 2, Math.PI, 0); c.lineTo(ax + aw, H * 0.86); c.fill();
    }
    c.fillStyle = colors.wood; c.beginPath(); c.arc(W * 0.78, H * 0.22, Math.min(W, H) * 0.09, 0, Math.PI * 2); c.fill();
  } else if (style === 1) { // soft color blocks
    const cols = 3 + Math.floor(r() * 2);
    for (let i = 0; i < cols; i++) { c.fillStyle = pick(); c.fillRect(W * (0.1 + i * 0.8 / cols), H * (0.15 + r() * 0.25), W * 0.8 / cols - W * 0.03, H * (0.35 + r() * 0.3)); }
  } else if (style === 2) { // horizon
    c.fillStyle = colors.fabric; c.fillRect(0, H * 0.58, W, H * 0.42);
    c.fillStyle = pick(); c.beginPath(); c.ellipse(W * 0.35, H * 0.62, W * 0.42, H * 0.2, 0, Math.PI, 0); c.fill();
    c.fillStyle = pick(); c.beginPath(); c.ellipse(W * 0.8, H * 0.64, W * 0.32, H * 0.14, 0, Math.PI, 0); c.fill();
    c.fillStyle = colors.accent; c.beginPath(); c.arc(W * 0.66, H * 0.3, Math.min(W, H) * 0.08, 0, Math.PI * 2); c.fill();
  } else { // leaves
    for (let i = 0; i < 9; i++) {
      c.save(); c.translate(W * (0.2 + r() * 0.6), H * (0.2 + r() * 0.6)); c.rotate(r() * Math.PI);
      c.fillStyle = r() < 0.5 ? colors.accent : '#6f8c5f'; c.beginPath(); c.ellipse(0, 0, W * 0.05, H * 0.17, 0, 0, Math.PI * 2); c.fill(); c.restore();
    }
  }
  c.globalAlpha = 0.08; c.fillStyle = '#000';
  for (let i = 0; i < 1400; i++) c.fillRect(r() * W, r() * H, 1, 1); // paper grain
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const DRESSING = {
  // Framed print, centered on the origin, facing +Z.
  art({ w = 0.9, h = 0.65, colors, seed = 1 }) {
    const p = new Parts(), t = 0.035, d = 0.03;
    p.add(box(w, t, d), MATERIALS.woodDark, [0, h / 2 - t / 2, 0]); p.add(box(w, t, d), MATERIALS.woodDark, [0, -h / 2 + t / 2, 0]);
    p.add(box(t, h - 2 * t, d), MATERIALS.woodDark, [-w / 2 + t / 2, 0, 0]); p.add(box(t, h - 2 * t, d), MATERIALS.woodDark, [w / 2 - t / 2, 0, 0]);
    p.add(box(w - 2 * t, h - 2 * t, 0.006), MATERIALS.white, [0, 0, -0.008]);
    const group = p.build('art', { center: false });
    const print = new THREE.Mesh(new THREE.PlaneGeometry(w - 2 * t - 0.07, h - 2 * t - 0.07), new THREE.MeshStandardMaterial({ map: artTexture(w, h, colors, seed), roughness: 0.85 }));
    print.position.z = -0.004;
    group.add(print);
    return group;
  },
  // Linen panel gathered in pleats, standing on the floor.
  curtain() {
    const p = new Parts(), pleats = 6, w = 0.5, h = 2.36;
    for (let i = 0; i < pleats; i++) p.add(rbox(w / pleats + 0.02, h, 0.07, 0.03), MATERIALS.bedding, [-w / 2 + (i + 0.5) * w / pleats, h / 2 + 0.02, i % 2 ? 0.035 : -0.015]);
    return p.build('curtain', { center: false });
  },
  rod({ length = 3 }) {
    const p = new Parts();
    p.add(cyl(0.012, 0.012, length, 10), MATERIALS.metal, [0, 0, 0], [0, 0, Math.PI / 2]);
    for (const s of [-1, 1]) p.add(ball(0.022), MATERIALS.metal, [s * length / 2, 0, 0]);
    return p.build('rod', { center: false });
  },
  // Hangs from the 2.6 m ceiling; origin on the floor below.
  pendant() {
    const p = new Parts();
    p.add(cyl(0.004, 0.004, 0.7, 6), MATERIALS.metal, [0, 2.25, 0]);
    p.add(cyl(0.05, 0.05, 0.02, 16), MATERIALS.metal, [0, 2.59, 0]);
    p.add(cyl(0.06, 0.22, 0.2, 32, true), MATERIALS.woodDark, [0, 1.8, 0]);
    p.add(ball(0.05), FIXED.lamp, [0, 1.74, 0]);
    return p.build('pendant', { center: false });
  },
  // Round side table with a lamp and a book.
  sideLamp() {
    const p = new Parts();
    p.add(cyl(0.22, 0.22, 0.03, 32), MATERIALS.wood, [0, 0.52, 0]);
    p.add(cyl(0.025, 0.025, 0.5, 10), MATERIALS.woodDark, [0, 0.26, 0]);
    p.add(cyl(0.14, 0.14, 0.02, 24), MATERIALS.woodDark, [0, 0.01, 0]);
    p.add(cyl(0.05, 0.07, 0.2, 18), MATERIALS.pot, [0.04, 0.635, -0.03]);
    p.add(cyl(0.1, 0.14, 0.16, 24, true), FIXED.lamp, [0.04, 0.82, -0.03]);
    p.add(rbox(0.18, 0.03, 0.13, 0.006), FIXED.book1, [-0.07, 0.55, 0.08], [0, 0.4, 0]);
    return p.build('sideLamp', { center: false });
  },
  // Nightstand with a lamp.
  nightLamp() {
    const p = new Parts();
    p.add(rbox(0.42, 0.46, 0.38, 0.012), MATERIALS.white, [0, 0.27, 0]);
    p.add(box(0.36, 0.004, 0.004), MATERIALS.woodDark, [0, 0.3, 0.191]);
    for (const sx of [-1, 1]) p.add(cyl(0.012, 0.012, 0.06, 8), MATERIALS.woodDark, [sx * 0.17, 0.03, 0]);
    p.add(cyl(0.045, 0.06, 0.16, 18), MATERIALS.pot, [0.06, 0.58, -0.04]);
    p.add(cyl(0.09, 0.12, 0.15, 24, true), FIXED.lamp, [0.06, 0.74, -0.04]);
    return p.build('nightLamp', { center: false });
  },
  // Floating shelf with books and a small plant; origin at the shelf, back at -Z.
  wallShelf({ w = 0.9 }) {
    const p = new Parts();
    p.add(rbox(w, 0.025, 0.22, 0.004), MATERIALS.wood, [0, 0, 0]);
    shelfBooks(p, -w / 2 + 0.05, w / 2 - 0.3, 0.0125, 0.16, Math.round(w * 97));
    p.add(cyl(0.05, 0.04, 0.09, 14), MATERIALS.pot, [w / 2 - 0.14, 0.057, 0]);
    p.add(ball(0.07), FIXED.leafLight, [w / 2 - 0.14, 0.14, 0]);
    return p.build('wallShelf', { center: false });
  },
};

/** Builds one styling prop (see DRESSING); positions come from src/concepts/dressing.js. */
export function buildDressing(kind, options = {}) {
  const make = DRESSING[kind];
  if (!make) throw new Error(`No builder for dressing: ${kind}`);
  const group = make(options);
  group.name = `Dressing ${kind}`;
  group.userData.dressing = kind;
  return group;
}

/** Builds one kit piece as a Group centered on the origin, front facing +Z. */
export function buildFurniture(kind) {
  const make = BUILDERS[kind];
  if (!make) throw new Error(`No builder for furniture kind: ${kind}`);
  const spec = FURNITURE[kind];
  return make().build(kind, { castShadow: !spec.flat });
}

export const KIT_KINDS = Object.keys(BUILDERS);
