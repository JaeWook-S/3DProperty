// Deterministic, tileable PBR texture synthesis. Pure typed-array code: runs in
// a Worker, in Node tests and on the main thread as a fallback. No downloads.
// Every map covers an exact physical repeat (meters), so tiles, planks and
// wallpaper rolls keep true scale on any wall or floor.

const TAU = Math.PI * 2;
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hashSeed(text) { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; }
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = t => t * t * (3 - 2 * t);
const mix = (a, b, t) => a + (b - a) * t;
export function hexColor(hex) { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }

// One octave of periodic value noise on an N×N field.
function octave(out, n, cellsX, cellsY, rand, weight) {
  const grid = new Float32Array(cellsX * cellsY);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  const x0 = new Int32Array(n), x1 = new Int32Array(n), fx = new Float32Array(n);
  for (let x = 0; x < n; x++) { const g = (x + 0.5) / n * cellsX, i = Math.floor(g); x0[x] = i % cellsX; x1[x] = (i + 1) % cellsX; fx[x] = smooth(g - i); }
  for (let y = 0; y < n; y++) {
    const g = (y + 0.5) / n * cellsY, j = Math.floor(g), fy = smooth(g - j), r0 = (j % cellsY) * cellsX, r1 = ((j + 1) % cellsY) * cellsX, row = y * n;
    for (let x = 0; x < n; x++) {
      const a = grid[r0 + x0[x]], b = grid[r0 + x1[x]], c = grid[r1 + x0[x]], d = grid[r1 + x1[x]], t = fx[x];
      out[row + x] += weight * ((a + (b - a) * t) * (1 - fy) + (c + (d - c) * t) * fy);
    }
  }
}
// fBm in [0,1]. Cell counts must be integers so the field tiles exactly.
export function fbm(n, { cellsX = 4, cellsY = cellsX, octaves = 5, gain = 0.5, seed = 1, lacunarity = 2 } = {}) {
  const out = new Float32Array(n * n), rand = rng(seed);
  let weight = 1, total = 0, cx = cellsX, cy = cellsY;
  for (let o = 0; o < octaves; o++) {
    // Above Nyquist an octave only adds aliasing; clamp (keeps integer periods).
    const ix = Math.max(1, Math.min(n >> 1, Math.round(cx))), iy = Math.max(1, Math.min(n >> 1, Math.round(cy)));
    if (o > 0 && ix === n >> 1 && iy === n >> 1) break;
    octave(out, n, ix, iy, rand, weight); total += weight; weight *= gain; cx *= lacunarity; cy *= lacunarity;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}
function sample(field, n, x, y) { // wrapped nearest; fields are already smooth
  const i = ((Math.floor(x) % n) + n) % n, j = ((Math.floor(y) % n) + n) % n;
  return field[j * n + i];
}

// Tile and plank layouts ---------------------------------------------------
// Returns {id, u, v, w, h, rot} for the unit containing (x,y) in meters.
function gridCell(x, y, tw, th, cols, rows, offsetRows = 0) {
  const row = Math.floor(y / th), shift = offsetRows ? ((row % 2 + 2) % 2) * tw * offsetRows : 0;
  const wrapW = cols * tw, xs = ((x + shift) % wrapW + wrapW) % wrapW, col = Math.floor(xs / tw);
  return { id: ((row % rows) + rows) % rows * 1009 + col, u: xs - col * tw, v: y - row * th, w: tw, h: th, rot: 0 };
}
// Axis-aligned herringbone of bricks n×1 (units of width W). Lattice (1,1),(n,-n).
// Band m holds H_k=[k,k+n)×[k,k+1) and V_k=[k-1,k)×[k,k+n); exactly one nearby
// band translate contains any point (verified in tests/interior-textures.test.js).
export function herringboneCell(x, y, W, n) {
  const px = x / W, py = y / W, m0 = Math.floor((px - py + n + 1) / (2 * n));
  for (const m of [m0, m0 - 1, m0 + 1, m0 - 2, m0 + 2]) {
    const qx = px - m * n, qy = py + m * n, k = Math.floor(qy);
    if (qx >= k && qx < k + n) return { id: m * 7919 + k * 2, u: (qx - k) * W, v: (qy - k) * W, w: n * W, h: W, rot: 0 };
    const kv = Math.floor(qx) + 1;
    if (qy >= kv && qy < kv + n) return { id: m * 7919 + kv * 2 + 1, u: (qy - kv) * W, v: (kv - qx) * W, w: n * W, h: W, rot: 1 };
  }
  return { id: 0, u: 0, v: 0, w: n * W, h: W, rot: 0 };
}
// Pointy-top hexagons, circumradius s. Distance to edge returned as `edge`.
function hexCell(x, y, s) {
  const q = (Math.sqrt(3) / 3 * x - y / 3) / s, r = (2 / 3 * y) / s;
  let rx = Math.round(q), rz = Math.round(r), ry = Math.round(-q - r);
  const dx = Math.abs(rx - q), dz = Math.abs(rz - r), dy = Math.abs(ry + q + r);
  if (dx > dy && dx > dz) rx = -ry - rz; else if (dz > dy) rz = -rx - ry;
  const cx = s * Math.sqrt(3) * (rx + rz / 2), cy = s * 1.5 * rz, lx = x - cx, ly = y - cy;
  // Hexagon edge distance via three slab projections.
  const inner = s * Math.sqrt(3) / 2;
  const d = Math.max(Math.abs(lx), Math.abs(lx * 0.5 + ly * Math.sqrt(3) / 2), Math.abs(lx * 0.5 - ly * Math.sqrt(3) / 2));
  return { id: rx * 4241 + rz * 131, edge: inner - d, u: lx + s, v: ly + s, w: 2 * s, h: 2 * s, rot: 0 };
}
function plankCell(x, y, W, lengths, wrapW, rand) {
  // Rows along X; each row has its own staggered break positions.
  const row = Math.floor(y / W), rowSeed = (row * 2654435761) >>> 0;
  const r = rng(rowSeed ^ lengths.seed);
  const offset = Math.floor(r() * lengths.steps) * lengths.step;
  const xs = ((x + offset) % wrapW + wrapW) % wrapW, L = lengths.length, col = Math.floor(xs / L);
  return { id: row * 977 + col, u: xs - col * L, v: y - row * W, w: L, h: W, rot: 0 };
}

// Recipes ----------------------------------------------------------------------
// Each returns per-pixel arrays on an N×N grid: albedo RGB (sRGB 0..1),
// height (mm), roughness (0..1), ao (0..1). Physical repeat: size [u, v] m.
function canvas(n) { return { albedo: new Float32Array(n * n * 3), height: new Float32Array(n * n), rough: new Float32Array(n * n), ao: new Float32Array(n * n).fill(1) }; }
function jitterColor(base, r, amount) { const k = 1 + (r - 0.5) * 2 * amount; return [base[0] * k, base[1] * k, base[2] * k]; }

function paint(n, p) {
  const out = canvas(n), size = p.size ?? [1, 1], base = hexColor(p.color), seed = hashSeed(p.id ?? 'paint');
  const peel = fbm(n, { cellsX: Math.round(size[0] * 220), octaves: 3, gain: 0.55, seed }), mottle = fbm(n, { cellsX: 6, octaves: 4, seed: seed + 3 });
  const roller = fbm(n, { cellsX: 3, cellsY: Math.round(size[1] * 40), octaves: 2, seed: seed + 7 });
  for (let i = 0; i < n * n; i++) {
    const k = 1 + (mottle[i] - 0.5) * 0.035 + (roller[i] - 0.5) * 0.012;
    out.albedo[i * 3] = base[0] * k; out.albedo[i * 3 + 1] = base[1] * k; out.albedo[i * 3 + 2] = base[2] * k;
    out.height[i] = (peel[i] - 0.5) * (p.texture ?? 0.06) + (roller[i] - 0.5) * 0.02;
    out.rough[i] = (p.roughness ?? 0.86) + (peel[i] - 0.5) * 0.05;
  }
  return { ...out, size };
}

function wallpaper(n, p) {
  const out = canvas(n), roll = p.roll ?? 1.06, size = [roll, roll], base = hexColor(p.color), seed = hashSeed(p.id ?? 'wp');
  const accent = p.accent ? hexColor(p.accent) : base;
  const fiber = p.paper ? fbm(n, { cellsX: 180, octaves: 3, seed }) : fbm(n, { cellsX: 520, cellsY: 60, octaves: 3, gain: 0.6, seed });
  const cloud = fbm(n, { cellsX: 5, octaves: 4, seed: seed + 11 }), weaveNoise = fbm(n, { cellsX: 300, cellsY: 300, octaves: 2, seed: seed + 5 });
  const px = size[0] / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const idx = j * n + i, x = (i + 0.5) * px, y = (j + 0.5) * px;
    let h = (fiber[idx] - 0.5) * (p.paper ? 0.05 : 0.035), tone = 1 + (cloud[idx] - 0.5) * 0.03, rough = p.roughness ?? (p.paper ? 0.82 : 0.58);
    let color = base;
    if (p.pattern === 'stripe') {
      const w = p.stripe ?? 0.053, s = Math.floor(x / w) % 2;
      color = s ? accent : base; rough += s ? 0.12 : -0.04; h += s ? 0.015 : 0;
    } else if (p.pattern === 'linen') {
      const pitch = 0.0018, a = Math.sin(x / pitch * TAU), b = Math.sin(y / pitch * TAU);
      h += (a * 0.5 + b * 0.5) * 0.012 + (weaveNoise[idx] - 0.5) * 0.04; tone += (weaveNoise[idx] - 0.5) * 0.05;
    } else if (p.pattern === 'geometric') {
      const cell = p.motif ?? 0.0883, gx = x / cell, gy = y / cell, fx = gx - Math.floor(gx) - 0.5, fy = gy - Math.floor(gy) - 0.5;
      const d = Math.abs(fx) + Math.abs(fy), line = Math.abs(d - 0.36);
      if (line < 0.035) { h += 0.05 * (1 - line / 0.035); rough -= 0.12; color = accent; }
    }
    // Roll seam at the repeat edge: a faint butt joint, not a gap.
    const seam = Math.min(x, size[0] - x);
    if (seam < 0.0006) { h -= 0.02; tone -= 0.015; }
    out.albedo[idx * 3] = color[0] * tone; out.albedo[idx * 3 + 1] = color[1] * tone; out.albedo[idx * 3 + 2] = color[2] * tone;
    out.height[idx] = h; out.rough[idx] = rough;
  }
  return { ...out, size };
}

function fabric(n, p) {
  const out = canvas(n), size = [0.48, 0.48], base = hexColor(p.color), seed = hashSeed(p.id ?? 'fabric');
  const slubX = fbm(n, { cellsX: 2, cellsY: 260, octaves: 2, seed }), slubY = fbm(n, { cellsX: 260, cellsY: 2, octaves: 2, seed: seed + 1 });
  const fuzz = fbm(n, { cellsX: 400, octaves: 2, seed: seed + 2 }), pitch = 0.0024, px = size[0] / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const idx = j * n + i, x = (i + 0.5) * px, y = (j + 0.5) * px, cu = Math.floor(x / pitch), cv = Math.floor(y / pitch);
    const over = (cu + cv) % 2 === 0, fu = x / pitch - cu, fv = y / pitch - cv;
    const thread = over ? Math.sin(fv * Math.PI) : Math.sin(fu * Math.PI);
    const slub = over ? slubX[idx] : slubY[idx];
    const tone = 0.9 + slub * 0.16 + (fuzz[idx] - 0.5) * 0.06;
    const c = jitterColor(base, 0.5, 0);
    out.albedo[idx * 3] = c[0] * tone; out.albedo[idx * 3 + 1] = c[1] * tone; out.albedo[idx * 3 + 2] = c[2] * tone;
    out.height[idx] = thread * 0.09 + (slub - 0.5) * 0.04; out.rough[idx] = 0.9; out.ao[idx] = 0.82 + thread * 0.18;
  }
  return { ...out, size };
}

// Stone bodies sampled with a per-tile offset so neighbouring tiles differ.
function stoneBody(kind, fields, n, x, y, offX, offY, px, p, colors) {
  const sx = x / px + offX, sy = y / px + offY;
  if (kind === 'marble') {
    const t = sample(fields.turb, n, sx, sy), w = sample(fields.warp, n, sx * 0.7, sy * 0.7);
    const vein = Math.abs(Math.sin((sx / n * (p.veins ?? 2) + sy / n * 0.9 + t * 4.2 + w * 2.2) * Math.PI));
    const fine = Math.pow(1 - vein, 26), soft = Math.pow(1 - vein, 5) * 0.45, cloud = sample(fields.cloud, n, sx, sy);
    const k = clamp01(fine * (p.veinStrength ?? 0.85) + soft * 0.5);
    const base = [mix(colors.base[0], colors.alt[0], cloud * 0.5), mix(colors.base[1], colors.alt[1], cloud * 0.5), mix(colors.base[2], colors.alt[2], cloud * 0.5)];
    return { c: [mix(base[0], colors.vein[0], k), mix(base[1], colors.vein[1], k), mix(base[2], colors.vein[2], k)], h: -fine * 0.004, r: 0 };
  }
  if (kind === 'terrazzo') {
    const chip = sample(fields.chips, n, sx, sy), cloud = sample(fields.cloud, n, sx, sy);
    if (chip > 0) {
      const pick = colors.chips[Math.floor(chip * 997) % colors.chips.length];
      return { c: jitterColor(pick, (chip * 7.13) % 1, 0.08), h: 0.01, r: -0.05 };
    }
    return { c: jitterColor(colors.base, cloud, 0.05), h: 0, r: 0 };
  }
  if (kind === 'concrete' || kind === 'travertine') {
    const cloud = sample(fields.cloud, n, sx, sy), pores = sample(fields.pores, n, sx, sy), band = sample(fields.turb, n, sx * 0.2, sy * 2.5);
    const pore = pores > (kind === 'travertine' ? 0.83 : 0.88);
    const c = jitterColor(kind === 'travertine' ? [mix(colors.base[0], colors.alt[0], band), mix(colors.base[1], colors.alt[1], band), mix(colors.base[2], colors.alt[2], band)] : colors.base, cloud, 0.09);
    return { c: pore ? c.map(v => v * 0.82) : c, h: pore ? -0.12 : (cloud - 0.5) * 0.02, r: pore ? 0.1 : 0 };
  }
  if (kind === 'zellige') {
    const cloud = sample(fields.cloud, n, sx, sy), w = sample(fields.warp, n, sx * 3, sy * 3);
    return { c: jitterColor(colors.base, cloud * 0.7 + w * 0.3, 0.12), h: (w - 0.5) * 0.25, r: 0 };
  }
  const cloud = sample(fields.cloud, n, sx, sy);
  return { c: jitterColor(colors.base, cloud, 0.025), h: (cloud - 0.5) * 0.01, r: 0 };
}

function chipField(n, seed, density, sizePx) {
  const field = new Float32Array(n * n), rand = rng(seed), count = Math.round(density * n * n / (sizePx * sizePx));
  for (let c = 0; c < count; c++) {
    const cx = rand() * n, cy = rand() * n, r = sizePx * (0.35 + rand() * 0.9), sides = 5 + Math.floor(rand() * 4), rot = rand() * TAU, value = 0.001 + rand() * 0.998;
    const rr = Math.ceil(r);
    for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
      const a = Math.atan2(dy, dx) - rot, sector = TAU / sides, local = Math.cos(sector / 2) / Math.cos((a % sector + sector) % sector - sector / 2);
      if (Math.hypot(dx, dy) > r * local) continue;
      const x = ((Math.floor(cx + dx) % n) + n) % n, y = ((Math.floor(cy + dy) % n) + n) % n;
      field[y * n + x] = value;
    }
  }
  return field;
}

function tile(n, p) {
  const out = canvas(n), seed = hashSeed(p.id ?? 'tile'), [tw, th] = p.tile, grout = p.grout ?? 0.003;
  const colors = { base: hexColor(p.color), alt: hexColor(p.alt ?? p.color), vein: hexColor(p.vein ?? '#7d7a76'), grout: hexColor(p.groutColor ?? '#d8d4cc'),
    chips: (p.chips ?? ['#8a857c', '#b9b1a4', '#5f5b55', '#f3efe8', '#b88a6a']).map(hexColor) };
  let size;
  if (p.pattern === 'hex') { const s = tw / 2; size = [Math.sqrt(3) * s * (p.cols ?? 6), 3 * s * (p.rows ?? 3)]; }
  else if (p.pattern === 'herringbone') { const k = Math.round(tw / th); size = [2 * k * th, 2 * k * th]; }
  else size = [tw * (p.cols ?? 2), th * (p.rows ?? 2)];
  const px = Math.max(size[0], size[1]) / n, sx = size[0] / n, sy = size[1] / n;
  const fields = { cloud: fbm(n, { cellsX: 6, octaves: 5, seed }), turb: fbm(n, { cellsX: 2, octaves: 5, gain: 0.46, seed: seed + 1 }), warp: fbm(n, { cellsX: 2, octaves: 3, seed: seed + 2 }),
    pores: fbm(n, { cellsX: Math.round(n / 6), octaves: 2, seed: seed + 3 }), chips: p.body === 'terrazzo' ? chipField(n, seed + 4, p.chipDensity ?? 0.22, Math.max(1.5, (p.chipSize ?? 0.009) / px)) : null };
  const groutNoise = fbm(n, { cellsX: 160, octaves: 2, seed: seed + 9 });
  const bevel = p.bevel ?? 0.0015, depth = p.groutDepth ?? 1.2, wave = p.body === 'zellige' ? 0.35 : 0;
  const baseRough = { gloss: 0.1, polished: 0.07, satin: 0.32, matte: 0.6, honed: 0.42 }[p.finish ?? 'matte'];
  const rows = p.rows ?? 2, cols = p.cols ?? 2;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const idx = j * n + i, x = (i + 0.5) * sx, y = (j + 0.5) * sy;
    let cell;
    if (p.pattern === 'hex') cell = hexCell(x, y, tw / 2);
    else if (p.pattern === 'herringbone') cell = herringboneCell(x, y, th, Math.round(tw / th));
    else cell = gridCell(x, y, tw, th, cols, rows, p.pattern === 'running' ? 0.5 : 0);
    const edge = cell.edge ?? Math.min(cell.u, cell.w - cell.u, cell.v, cell.h - cell.v);
    const d = edge - grout / 2;
    if (d < 0) {
      const g = jitterColor(colors.grout, groutNoise[idx], 0.06);
      out.albedo.set(g, idx * 3); out.height[idx] = -depth; out.rough[idx] = 0.92; out.ao[idx] = 0.55;
      continue;
    }
    const r = rng((cell.id * 2654435761 ^ seed) >>> 0), offX = r() * n, offY = r() * n, tone = r();
    const body = stoneBody(p.body ?? 'solid', fields, n, cell.rot ? y : x, cell.rot ? x : y, offX, offY, px, p, colors);
    const k = 1 + (tone - 0.5) * 2 * (p.variation ?? 0.03);
    out.albedo[idx * 3] = body.c[0] * k; out.albedo[idx * 3 + 1] = body.c[1] * k; out.albedo[idx * 3 + 2] = body.c[2] * k;
    const b = d < bevel ? smooth(d / bevel) : 1;
    // Zellige pillowing: hand-made tiles dome slightly toward the centre.
    const dome = wave ? Math.sin(Math.min(1, cell.u / cell.w) * Math.PI) * Math.sin(Math.min(1, cell.v / cell.h) * Math.PI) * wave : 0;
    out.height[idx] = -depth * (1 - b) * 0.8 + body.h + dome;
    out.rough[idx] = baseRough + body.r + (groutNoise[idx] - 0.5) * 0.03;
    out.ao[idx] = 1 - (1 - b) * 0.18;
  }
  return { ...out, size };
}

function wood(n, p) {
  const out = canvas(n), seed = hashSeed(p.id ?? 'wood'), base = hexColor(p.color), dark = hexColor(p.dark ?? '#6e4f35');
  const W = p.width ?? 0.19, herring = p.pattern === 'herringbone';
  const ratio = herring ? Math.round((p.length ?? 0.6) / W) : 0;
  const size = herring ? [2 * ratio * W, 2 * ratio * W] : [p.length * 2, W * (p.rows ?? 6)];
  const sx = size[0] / n, sy = size[1] / n, px = Math.max(sx, sy);
  // Two isotropic fields; each plank samples them in its own along/across frame.
  const warp = fbm(n, { cellsX: 4, octaves: 4, gain: 0.5, seed: seed + 4 }), streak = fbm(n, { cellsX: 64, octaves: 3, gain: 0.5, seed: seed + 5 });
  const lengths = { length: p.length ?? 1.2, step: (p.length ?? 1.2) / 6, steps: 6, seed };
  const gap = Math.max(p.gap ?? 0.0004, px * 0.9), bevel = p.flat ? 0 : Math.max(p.bevel ?? 0.0012, px * 1.6), rings = p.rings ?? 9;
  const fieldAt = (field, a, b, offA, offB) => sample(field, n, (a + offA) / px, (b + offB) / px);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const idx = j * n + i, x = (i + 0.5) * sx, y = (j + 0.5) * sy;
    const cell = herring ? herringboneCell(x, y, W, ratio) : plankCell(x, y, W, lengths, size[0]);
    const edge = Math.min(cell.u, cell.w - cell.u, cell.v, cell.h - cell.v) - gap / 2;
    const r = rng((cell.id * 2246822519 ^ seed) >>> 0), tone = r(), offA = r() * 9, offB = r() * 9, centre = 0.2 + r() * 0.6, quarter = r() < 0.35;
    const a = cell.u, b = cell.v;
    // Flat-sawn figure: growth rings as nested arches (cathedrals) whose apex
    // drifts along the plank; quarter-sawn boards show straight stripes.
    const meander = fieldAt(warp, a * 0.18, b * 1.6, offA, offB) - 0.5, fine = fieldAt(streak, a * 0.06, b * 2.2, offA, offB);
    const across = (b / W - centre), arch = quarter ? 0 : Math.sqrt(Math.abs(across) * 0.9 + 0.002) * 1.4 - Math.pow((a / cell.w - 0.5) * 1.3, 2) * 0.5;
    const phase = (quarter ? b / W * rings * 1.6 : (arch + meander * 0.35) * rings) + meander * 1.2 + fine * 0.25;
    const late = Math.pow(0.5 + 0.5 * Math.cos(phase * TAU), 5);
    const pore = fine > 0.76 ? (fine - 0.76) * 4 : 0;
    const k = 1 + (tone - 0.5) * 2 * (p.variation ?? 0.09);
    const darkness = clamp01(late * (p.contrast ?? 0.5) + pore * 0.35 + (fine - 0.5) * 0.18);
    let c = [mix(base[0], dark[0], darkness) * k, mix(base[1], dark[1], darkness) * k, mix(base[2], dark[2], darkness) * k];
    let h = late * 0.04 - pore * 0.05 + (fine - 0.5) * 0.03, ao = 1;
    if (edge < 0) { c = c.map(v => v * 0.38); h = -0.45; ao = 0.55; }
    else if (bevel && edge < bevel) { const t = smooth(edge / bevel); h -= 0.3 * (1 - t); ao = 1 - (1 - t) * 0.22; c = c.map(v => v * (0.9 + 0.1 * t)); }
    out.albedo[idx * 3] = c[0]; out.albedo[idx * 3 + 1] = c[1]; out.albedo[idx * 3 + 2] = c[2];
    out.height[idx] = h; out.rough[idx] = (p.roughness ?? 0.42) + late * 0.06 + pore * 0.15; out.ao[idx] = ao;
  }
  return { ...out, size };
}

const RECIPES = { paint, wallpaper, fabric, tile, wood };
export const recipeKinds = Object.keys(RECIPES);

function toSrgbByte(v) { return Math.max(0, Math.min(255, Math.round(v * 255))); }
// Height (mm) to a tangent-space normal map; OpenGL convention (+Y = +V).
export function heightToNormal(height, n, size, strength = 1.6) {
  const out = new Uint8ClampedArray(n * n * 4), pxU = size[0] * 1000 / n, pxV = size[1] * 1000 / n;
  for (let j = 0; j < n; j++) {
    const up = ((j + 1) % n) * n, down = ((j - 1 + n) % n) * n, row = j * n;
    for (let i = 0; i < n; i++) {
      const right = (i + 1) % n, left = (i - 1 + n) % n;
      const dx = (height[row + right] - height[row + left]) / (2 * pxU) * strength, dy = (height[up + i] - height[down + i]) / (2 * pxV) * strength;
      const len = Math.hypot(dx, dy, 1), o = (row + i) * 4;
      out[o] = Math.round((-dx / len * 0.5 + 0.5) * 255); out[o + 1] = Math.round((-dy / len * 0.5 + 0.5) * 255); out[o + 2] = Math.round((1 / len * 0.5 + 0.5) * 255); out[o + 3] = 255;
    }
  }
  return out;
}

// Full PBR set: albedo (sRGB RGBA), normal (RGBA), orm (R=AO, G=rough, B=metal).
export function generateMaps(recipe, n = 512) {
  const fn = RECIPES[recipe.kind];
  if (!fn) throw Error(`Unknown recipe ${recipe.kind}`);
  const result = fn(n, recipe), albedo = new Uint8ClampedArray(n * n * 4), orm = new Uint8ClampedArray(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    albedo[i * 4] = toSrgbByte(result.albedo[i * 3]); albedo[i * 4 + 1] = toSrgbByte(result.albedo[i * 3 + 1]); albedo[i * 4 + 2] = toSrgbByte(result.albedo[i * 3 + 2]); albedo[i * 4 + 3] = 255;
    orm[i * 4] = toSrgbByte(result.ao[i]); orm[i * 4 + 1] = toSrgbByte(clamp01(result.rough[i])); orm[i * 4 + 2] = 0; orm[i * 4 + 3] = 255;
  }
  const normal = heightToNormal(result.height, n, result.size, recipe.normalStrength ?? 1.6);
  let r = 0, g = 0, b = 0; for (let i = 0; i < n * n; i += 7) { r += albedo[i * 4]; g += albedo[i * 4 + 1]; b += albedo[i * 4 + 2]; }
  const count = Math.ceil(n * n / 7);
  return { n, size: result.size, albedo, normal, orm, average: [r / count / 255, g / count / 255, b / count / 255] };
}

// A small lit swatch for the catalog: albedo shaded by its own normal under a
// soft key light, rows flipped for canvas (top-down) display.
export function swatchPixels(maps, out = 96, repeat = 1) {
  const pixels = new Uint8ClampedArray(out * out * 4), n = maps.n, light = [-0.45, 0.55, 0.7], ll = Math.hypot(...light);
  for (let y = 0; y < out; y++) for (let x = 0; x < out; x++) {
    const si = Math.floor(x / out * n * repeat) % n, sj = Math.floor((out - 1 - y) / out * n * repeat) % n, s = (sj * n + si) * 4;
    const nx = maps.normal[s] / 127.5 - 1, ny = maps.normal[s + 1] / 127.5 - 1, nz = maps.normal[s + 2] / 127.5 - 1;
    const lambert = Math.max(0, (nx * light[0] + ny * light[1] + nz * light[2]) / ll);
    const rough = maps.orm[s + 1] / 255, spec = Math.pow(lambert, 40) * (1 - rough) * 0.6, ao = maps.orm[s] / 255;
    const shade = (0.62 + 0.42 * lambert) * ao, o = (y * out + x) * 4;
    for (let c = 0; c < 3; c++) pixels[o + c] = Math.min(255, maps.albedo[s + c] * shade + spec * 255);
    pixels[o + 3] = 255;
  }
  return pixels;
}
