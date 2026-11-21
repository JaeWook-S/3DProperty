"""Score a generated apartment GLB against Archisketch source GT (walls + openings).

Measures the GLB geometry directly (never the agent's self-reported elements.json).

GT   : MCP get-floorplan-structure.json (mm, X right, Z down on screen)
Model: GLB (m, glTF Y up). Wall meshes = nodes whose name starts with 'wall'.

Steps
 1. Align model -> GT frame with a rigid transform (rotation + translation, no scale),
    chosen to maximise wall-footprint overlap (raster cross-correlation + Nelder-Mead refine).
    Auxiliary: the same with a free uniform scale ("scale-fitted"), to separate scale errors from shape errors.
 2. Walls: perpendicular probes along each GT centreline -> model thickness, signed centre offset,
    hit ratio; vertical rays -> wall top height.
 3. Openings: vertical section of the model wall meshes along each GT host wall -> void rectangle
    -> width, sill, top, centre shift. Unmatched voids along GT walls are counted as extra openings.

 4. Wall F1@tau (tau = 5/10/30 cm, headline 10 cm): centreline point sets.
    GT: points every 2 cm along GT centrelines (opening spans excluded). Model: skeleton (medial axis) of the
    model wall footprint rasterised at 1 cm. Precision = share of model centreline within tau of a GT centreline,
    Recall = share of GT centreline within tau of the model centreline, F1 = harmonic mean (length weighted).
    Opening F1 = detection P/R/F1 (TP = matched GT openings, FP = extra voids, FN = missing).

GT openings on the same wall at the same position and width (source duplicates with different sill/height) are merged
into one GT opening; its sill/height error uses the closer alternative.

Door hinge / swing is not scored yet (GT mapping from HAR scale.x / rotation.y is unverified).

Usage: python score_glb.py --glb model.glb --gt get-floorplan-structure.json --out <dir>
"""
import argparse, csv, json, math, re
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image, ImageDraw
from scipy.optimize import minimize
from scipy.signal import fftconvolve
from shapely import affinity
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import polygonize, unary_union

TOL = 0.02        # +-2 cm
PROBE = 0.6
RES = 0.02        # raster cell for coarse alignment (m)
LOW_WALL_H = 1.0  # GT walls lower than this are curbs/low partitions, scored separately
MIN_OPENING_W = 0.1  # GT openings narrower than this are source anomalies
F1_TAUS = (0.05, 0.10, 0.30)
F1_HEADLINE = 0.10
SKEL_RES = 0.01


# ---------------------------------------------------------------- GT
def load_gt(path):
    fp = json.loads(Path(path).read_text())['floorplans'][0]
    walls, openings = [], []
    for i, w in enumerate(fp['walls']):
        a = np.array(w['start'], float) / 1000; b = np.array(w['end'], float) / 1000
        L = float(np.linalg.norm(b - a))
        walls.append(dict(idx=i, id=w['archiId'].split(',')[0], a=a, b=b, L=L, t=w['thickness'] / 1000,
                          h=w['height'] / 1000, exterior=w['exterior'], low=w['height'] / 1000 < LOW_WALL_H))
        for o in w['openings']:
            openings.append(dict(id=o['id'], kind=o['kind'], wall=i, offset=o['offset'] / 1000, w=o['width'] / 1000,
                                 h=o['height'] / 1000, sill=o['sill'] / 1000,
                                 anomaly=o['width'] / 1000 < MIN_OPENING_W, alts=[(o['sill'] / 1000, o['height'] / 1000)],
                                 merged_ids=[o['id']]))
    # merge source duplicates: same wall, same centre (<5 cm) and width (<5 cm)
    merged = []
    for o in openings:
        twin = next((m for m in merged if m['wall'] == o['wall'] and not m['anomaly'] and not o['anomaly']
                     and abs(m['offset'] - o['offset']) < 0.05 and abs(m['w'] - o['w']) < 0.05), None)
        if twin:
            twin['alts'] += o['alts']; twin['merged_ids'] += o['merged_ids']
        else:
            merged.append(o)
    return walls, merged


def wall_rect(w):
    return LineString([w['a'], w['b']]).buffer(w['t'] / 2, cap_style=2)


# ---------------------------------------------------------------- model
def load_model(glb):
    scene = trimesh.load(glb, process=False)
    parts = []
    for node in scene.graph.nodes_geometry:
        if not re.match(r'^wall', node, re.I):
            continue
        T, g = scene.graph[node]
        m = scene.geometry[g].copy(); m.apply_transform(T)
        parts.append(m)
    if not parts:
        raise SystemExit('no wall_* nodes in GLB')
    walls = trimesh.util.concatenate(parts)
    polys = [Polygon(t) for t in walls.vertices[walls.faces][:, :, [0, 2]]]
    fp = unary_union([p for p in polys if p.area > 1e-8]).buffer(0)
    return walls, fp, len(parts)


def apply_xz(mesh, s, th, tx, tz):
    """x' = s*R(th)*[x,z] + t ; y unchanged."""
    c, si = math.cos(th), math.sin(th)
    M = np.eye(4)
    M[0, 0], M[0, 2], M[2, 0], M[2, 2] = s * c, -s * si, s * si, s * c
    M[0, 3], M[2, 3] = tx, tz
    m = mesh.copy(); m.apply_transform(M)
    return m


def tf_poly(p, s, th, tx, tz):
    p = affinity.scale(p, s, s, origin=(0, 0))
    p = affinity.rotate(p, th, origin=(0, 0), use_radians=True)
    return affinity.translate(p, tx, tz)


# ---------------------------------------------------------------- alignment
def raster(geom, x0, z0, nx, nz):
    img = Image.new('L', (nx, nz), 0); d = ImageDraw.Draw(img)
    for g in getattr(geom, 'geoms', [geom]):
        if g.geom_type != 'Polygon' or g.is_empty:
            continue
        d.polygon([((x - x0) / RES, (z - z0) / RES) for x, z in g.exterior.coords], fill=1)
        for r in g.interiors:
            d.polygon([((x - x0) / RES, (z - z0) / RES) for x, z in r.coords], fill=0)
    return np.asarray(img, dtype=np.float32)


def iou(a, b):
    u = a.union(b).area
    return a.intersection(b).area / u if u else 0.0


def align(model_fp, gt_fp, free_scale=False):
    best = None
    scales = np.arange(0.94, 1.0601, 0.005) if free_scale else [1.0]
    gb = gt_fp.bounds; pad = 3.0
    x0, z0 = gb[0] - pad, gb[1] - pad
    nx, nz = int((gb[2] - gb[0] + 2 * pad) / RES), int((gb[3] - gb[1] + 2 * pad) / RES)
    G = raster(gt_fp, x0, z0, nx, nz)
    for s in scales:
        for k in range(4):
            th = k * math.pi / 2
            p = tf_poly(model_fp, s, th, 0, 0)
            mb = p.bounds
            # centre model bbox on gt bbox, then search residual shift by correlation
            tx0 = (gb[0] + gb[2]) / 2 - (mb[0] + mb[2]) / 2; tz0 = (gb[1] + gb[3]) / 2 - (mb[1] + mb[3]) / 2
            M = raster(affinity.translate(p, tx0, tz0), x0, z0, nx, nz)
            C = fftconvolve(G, M[::-1, ::-1], mode='same')
            iz, ix = np.unravel_index(np.argmax(C), C.shape)
            dx, dz = (ix - nx // 2) * RES, (iz - nz // 2) * RES
            score = C[iz, ix] / max(1.0, G.sum() + M.sum() - C[iz, ix])
            if best is None or score > best[0]:
                best = (score, s, th, tx0 + dx, tz0 + dz)
    _, s, th, tx, tz = best
    if free_scale:
        f = lambda v: -iou(tf_poly(model_fp, v[0], v[1], v[2], v[3]), gt_fp)
        r = minimize(f, [s, th, tx, tz], method='Nelder-Mead',
                     options=dict(xatol=1e-4, fatol=1e-6, initial_simplex=None, maxiter=600))
        s, th, tx, tz = r.x
    else:
        f = lambda v: -iou(tf_poly(model_fp, 1.0, v[0], v[1], v[2]), gt_fp)
        r = minimize(f, [th, tx, tz], method='Nelder-Mead', options=dict(xatol=1e-4, fatol=1e-6, maxiter=600))
        th, tx, tz = r.x
    return dict(scale=float(s), theta=float(th), tx=float(tx), tz=float(tz), iou=-float(r.fun))


# ---------------------------------------------------------------- walls
def score_walls(gt, openings, mesh, mf):
    rects = [wall_rect(w) if w['L'] > 1e-6 else None for w in gt]
    op_pts = []
    for o in openings:
        w = gt[o['wall']]; d = (w['b'] - w['a']) / w['L']
        op_pts.append((w['a'] + d * o['offset'], max(o['w'], 0.3)))
    rmi = trimesh.ray.ray_triangle.RayMeshIntersector(mesh)
    rows = []
    for g in gt:
        if g['L'] < 0.05:
            continue
        a, b = g['a'], g['b']; dvec = (b - a) / g['L']; nvec = np.array([-dvec[1], dvec[0]])
        cross = [rq for q, rq in zip(gt, rects) if rq is not None and q is not g
                 and abs(float(np.dot((q['b'] - q['a']) / q['L'], dvec))) < 0.98]
        cross_u = unary_union(cross) if cross else None
        margin = max(0.25, g['t'])
        k = max(3, int(g['L'] / 0.2))
        th, off, tops_xyz, hit, used = [], [], [], 0, 0
        for s_al in (np.linspace(margin, g['L'] - margin, k) if g['L'] > 2 * margin else []):
            c = a + dvec * s_al
            if any(np.linalg.norm(c - p) < wd / 2 + 0.05 for p, wd in op_pts):
                continue
            probe = LineString([c - nvec * PROBE, c + nvec * PROBE])
            if cross_u is not None and cross_u.distance(probe) < 0.02:
                continue
            used += 1
            seg = probe.intersection(mf)
            best = None
            for p in getattr(seg, 'geoms', [seg]):
                if p.is_empty or p.geom_type != 'LineString' or p.length < 0.01:
                    continue
                s = [float(np.dot(np.array(q) - c, nvec)) for q in p.coords]
                lo, hi = min(s), max(s)
                dist = 0 if lo <= 0 <= hi else min(abs(lo), abs(hi))
                if dist <= 0.3 and (best is None or dist < best[0]):
                    best = (dist, hi - lo, (lo + hi) / 2)
            if best:
                hit += 1; th.append(best[1]); off.append(best[2])
                cc = c + nvec * best[2]
                tops_xyz.append([cc[0], 20.0, cc[1]])
        top = None
        if tops_xyz:
            o_ = np.array(tops_xyz); dirs = np.tile([0, -1.0, 0], (len(o_), 1))
            loc, ri, _ = rmi.intersects_location(o_, dirs, multiple_hits=False)
            if len(loc):
                top = float(np.median(loc[:, 1]))
        r = dict(idx=g['idx'], wall_id=g['id'][:36], exterior=g['exterior'], low_wall=g['low'], length_m=round(g['L'], 3),
                 gt_thickness_m=g['t'], gt_height_m=g['h'], samples=used,
                 hit_ratio=round(hit / used, 3) if used else None,
                 model_thickness_m=round(float(np.median(th)), 4) if th else None,
                 thickness_err_m=round(float(np.median(th)) - g['t'], 4) if th else None,
                 center_offset_signed_m=round(float(np.median(off)), 4) if off else None,
                 model_top_m=round(top, 4) if top is not None else None,
                 height_err_m=round(top - g['h'], 4) if top is not None else None)
        co = abs(r['center_offset_signed_m']) if off else None
        if g['L'] <= 2 * margin:
            st = 'short_stub'
        elif not used:
            st = 'opening_or_junction'
        elif r['hit_ratio'] < 0.5:
            st = 'missing'
        elif abs(r['thickness_err_m']) > TOL and co > TOL:
            st = 'thickness_and_offset'
        elif abs(r['thickness_err_m']) > TOL:
            st = 'thickness'
        elif co > TOL:
            st = 'offset'
        else:
            st = 'ok'
        r['status'] = st
        rows.append(r)
    return rows


# ---------------------------------------------------------------- openings
def wall_grid(mesh, w, u_lo, u_hi, y_hi, du=0.02, dy=0.02):
    """Occupancy of the model wall meshes on a (u, y) grid along GT wall w.

    For each grid point a horizontal ray is cast along the wall normal from -PROBE to +PROBE;
    the point is solid if the ray hits wall geometry within that span. Robust to non-watertight meshes.
    """
    d = (w['b'] - w['a']) / w['L']; n = np.array([-d[1], d[0]])
    us = np.arange(u_lo + du / 2, u_hi, du); ys = np.arange(dy / 2, y_hi, dy)
    U, Y = np.meshgrid(us, ys, indexing='ij')
    base = w['a'][None, :] + U.reshape(-1, 1) * d[None, :] - n[None, :] * PROBE
    org = np.stack([base[:, 0], Y.reshape(-1), base[:, 1]], 1)
    dirs = np.tile([n[0], 0, n[1]], (len(org), 1))
    occ = np.zeros(len(org), bool)
    loc, ri, _ = mesh.ray.intersects_location(org, dirs, multiple_hits=False)
    if len(ri):
        dist = np.linalg.norm(loc - org[ri], axis=1)
        occ[ri[dist <= 2 * PROBE]] = True
    return us, ys, occ.reshape(len(us), len(ys))


COL = 0.02  # must equal wall_grid du


def columns(grid):
    """Classify grid columns: 'wall' (no real gap), 'gap' (hole with solid above), 'empty' (no solid)."""
    us, ys, occ = grid
    dy = ys[1] - ys[0]
    cols = []
    for i, u in enumerate(us):
        c = occ[i]
        if not c.any():
            cols.append(dict(u=u, kind='empty')); continue
        top = np.nonzero(c)[0].max()
        free = ~c[:top + 1]
        best, cur, start = (0, 0, 0), 0, 0
        for j, f in enumerate(free):
            if f:
                if cur == 0:
                    start = j
                cur += 1
                if cur > best[0]:
                    best = (cur, start, j)
            else:
                cur = 0
        if best[0] * dy < 0.3:
            cols.append(dict(u=u, kind='wall'))
        else:
            cols.append(dict(u=u, kind='gap', lo=0.0 if best[1] == 0 else best[1] * dy, hi=(best[2] + 1) * dy))
    return cols


def runs(cols):
    """Contiguous non-wall runs with their bounding info."""
    out, i = [], 0
    while i < len(cols):
        if cols[i]['kind'] == 'wall':
            i += 1; continue
        j = i
        while j < len(cols) and cols[j]['kind'] != 'wall':
            j += 1
        seg = cols[i:j]; gaps = [c for c in seg if c['kind'] == 'gap']
        out.append(dict(u0=seg[0]['u'] - COL / 2, u1=seg[-1]['u'] + COL / 2, bounded=i > 0 and j < len(cols),
                        lintel_ratio=len(gaps) / len(seg),
                        lo=float(np.median([c['lo'] for c in gaps])) if gaps else 0.0,
                        hi=float(np.median([c['hi'] for c in gaps])) if gaps else None))
        i = j
    return out


def score_openings(gt, openings, mesh, wall_rows):
    off_by_wall = {r['idx']: (r['center_offset_signed_m'] or 0.0) for r in wall_rows}
    rows, matched_world = [], []
    for o in openings:
        w = gt[o['wall']]
        r = dict(id=o['id'][:8], kind=o['kind'], gt_wall=o['wall'], gt_offset_m=o['offset'], gt_width_m=o['w'],
                 gt_height_m=o['h'], gt_sill_m=o['sill'], anomaly=o['anomaly'],
                 merged_ids='+'.join(i[:8] for i in o['merged_ids']) if len(o['merged_ids']) > 1 else '')
        if o['anomaly']:
            r['status'] = 'gt_anomaly'; rows.append(r); continue
        half = o['w'] / 2 + 0.6
        u_lo, u_hi = o['offset'] - half, o['offset'] + half
        y_hi = max(w['h'], o['sill'] + o['h']) + 0.4
        g0, g1 = o['offset'] - o['w'] / 2, o['offset'] + o['w'] / 2
        cand = [v for v in runs(columns(wall_grid(mesh, w, u_lo, u_hi, y_hi))) if (v['u1'] - v['u0']) > 0.25
                and (v['lintel_ratio'] > 0.5 or v['bounded']) and min(v['u1'], g1) - max(v['u0'], g0) > 0.1]
        if not cand:
            r['status'] = 'missing'; rows.append(r); continue
        v = max(cand, key=lambda v: min(v['u1'], g1) - max(v['u0'], g0))
        mw, mc = v['u1'] - v['u0'], (v['u0'] + v['u1']) / 2
        top = v['hi'] if v['hi'] is not None else w['h']
        sill_gt, h_gt = min(o['alts'], key=lambda a: abs(v['lo'] - a[0]) + abs((top - v['lo']) - a[1]))
        r.update(gt_sill_m=sill_gt, gt_height_m=h_gt)
        r.update(model_width_m=round(mw, 4), model_sill_m=round(v['lo'], 4), model_height_m=round(top - v['lo'], 4),
                 width_err_m=round(mw - o['w'], 4), sill_err_m=round(v['lo'] - sill_gt, 4),
                 height_err_m=round((top - v['lo']) - h_gt, 4), center_err_m=round(mc - o['offset'], 4),
                 open_to_window_edge=not v['bounded'], lintel_ratio=round(v['lintel_ratio'], 2))
        errs = [abs(r[k]) for k in ('width_err_m', 'sill_err_m', 'height_err_m', 'center_err_m')]
        r['status'] = 'ok' if max(errs) <= TOL else 'error'
        d = (w['b'] - w['a']) / w['L']
        matched_world.append(w['a'] + d * mc)
        rows.append(r)
    # extra openings: voids along GT walls that no GT opening explains
    extras = []
    for r in wall_rows:
        w = gt[r['idx']]
        if w['low'] or w['L'] < 0.8 or r['status'] == 'missing':
            continue
        u_lo, u_hi = 0.15, w['L'] - 0.15
        d = (w['b'] - w['a']) / w['L']
        for v in runs(columns(wall_grid(mesh, w, u_lo, u_hi, w['h'] + 0.4))):
            if not v['bounded'] or v['lintel_ratio'] < 0.5 or (v['u1'] - v['u0']) < 0.4 or v['hi'] - v['lo'] < 0.6:
                continue
            p = w['a'] + d * (v['u0'] + v['u1']) / 2
            if any(np.linalg.norm(p - q) < 0.5 for q in matched_world):
                continue
            gt_near = False
            for o in openings:
                ww = gt[o['wall']]; dd = (ww['b'] - ww['a']) / ww['L']
                if np.linalg.norm(p - (ww['a'] + dd * o['offset'])) < max(0.5, o['w'] / 2):
                    gt_near = True
            if gt_near or any(np.linalg.norm(p - e['xz']) < 0.3 for e in extras):
                continue
            extras.append(dict(xz=p, width_m=round(v['u1'] - v['u0'], 3), sill_m=round(v['lo'], 3),
                               height_m=round(v['hi'] - v['lo'], 3), gt_wall=r['idx']))
    return rows, extras


# ---------------------------------------------------------------- wall F1@tau
def gt_centre_points(gt, openings, step=0.02):
    spans = {}
    for o in openings:
        spans.setdefault(o['wall'], []).append((o['offset'] - o['w'] / 2, o['offset'] + o['w'] / 2))
    pts = []
    for w in gt:
        if w['L'] < 0.05:
            continue
        d = (w['b'] - w['a']) / w['L']
        for u in np.arange(step / 2, w['L'], step):
            if any(lo <= u <= hi for lo, hi in spans.get(w['idx'], [])):
                continue
            pts.append(w['a'] + d * u)
    return np.array(pts)


def model_centre_points(mf):
    from skimage.morphology import skeletonize
    b = mf.bounds; x0, z0 = b[0] - 0.1, b[1] - 0.1
    nx, nz = int((b[2] - x0 + 0.1) / SKEL_RES), int((b[3] - z0 + 0.1) / SKEL_RES)
    img = Image.new('L', (nx, nz), 0); dr = ImageDraw.Draw(img)
    for g in getattr(mf, 'geoms', [mf]):
        if g.geom_type != 'Polygon' or g.is_empty:
            continue
        dr.polygon([((x - x0) / SKEL_RES, (z - z0) / SKEL_RES) for x, z in g.exterior.coords], fill=1)
        for r in g.interiors:
            dr.polygon([((x - x0) / SKEL_RES, (z - z0) / SKEL_RES) for x, z in r.coords], fill=0)
    sk = skeletonize(np.asarray(img, bool))
    iz, ix = np.nonzero(sk)
    return np.stack([x0 + (ix + 0.5) * SKEL_RES, z0 + (iz + 0.5) * SKEL_RES], 1)


def seg_dist(pts, gt):
    """Distance from each point to the nearest GT centreline segment."""
    best = np.full(len(pts), np.inf)
    for w in gt:
        if w['L'] < 1e-6:
            continue
        ab = w['b'] - w['a']; t = np.clip(((pts - w['a']) @ ab) / (ab @ ab), 0, 1)
        best = np.minimum(best, np.linalg.norm(pts - (w['a'] + t[:, None] * ab), axis=1))
    return best


def wall_f1(gt, openings, mf):
    from scipy.spatial import cKDTree
    gpts, mpts = gt_centre_points(gt, openings), model_centre_points(mf)
    d_model = seg_dist(mpts, gt)                     # model centreline -> GT centrelines
    d_gt = cKDTree(mpts).query(gpts)[0]              # GT centreline -> model centreline
    out = {}
    for tau in F1_TAUS:
        P = float(np.mean(d_model <= tau)); R = float(np.mean(d_gt <= tau))
        out[f'{round(tau * 100)}cm'] = dict(precision=round(P, 4), recall=round(R, 4),
                                            f1=round(2 * P * R / (P + R), 4) if P + R else 0.0)
    out['headline'] = f'{round(F1_HEADLINE * 100)}cm'
    out['n_points'] = dict(gt=len(gpts), model=len(mpts))
    return out, mpts, d_model


# ---------------------------------------------------------------- summary
def mae_cm(vals):
    vals = [abs(v) for v in vals if v is not None]
    return round(100 * float(np.mean(vals)), 2) if vals else None


def p90_cm(vals):
    vals = [abs(v) for v in vals if v is not None]
    return round(100 * float(np.percentile(vals, 90)), 2) if vals else None


def summarize(walls, ops, extras, gt_ops):
    def wagg(sel):
        sub = [r for r in walls if sel(r)]
        scored = [r for r in sub if r['status'] not in ('opening_or_junction', 'short_stub')]
        meas = [r for r in scored if r['status'] != 'missing']
        st = {}
        for r in sub:
            st[r['status']] = st.get(r['status'], 0) + 1
        return dict(n=len(sub), scored=len(scored), missing=st.get('missing', 0), status=st,
                    center_offset_mae_cm=mae_cm([r['center_offset_signed_m'] for r in meas]),
                    center_offset_p90_cm=p90_cm([r['center_offset_signed_m'] for r in meas]),
                    thickness_mae_cm=mae_cm([r['thickness_err_m'] for r in meas]),
                    height_mae_cm=mae_cm([r['height_err_m'] for r in meas]),
                    within_2cm_ratio=round(st.get('ok', 0) / max(1, len(scored)), 3))
    valid = [r for r in ops if r['status'] != 'gt_anomaly']
    det = [r for r in valid if r['status'] != 'missing']
    oagg = dict(gt=len(valid), detected=len(det), missing=len(valid) - len(det), extra=len(extras),
                gt_anomaly_excluded=len(ops) - len(valid),
                width_mae_cm=mae_cm([r['width_err_m'] for r in det]), height_mae_cm=mae_cm([r['height_err_m'] for r in det]),
                sill_mae_cm=mae_cm([r['sill_err_m'] for r in det]), center_mae_cm=mae_cm([r['center_err_m'] for r in det]),
                all_within_2cm=sum(1 for r in det if r['status'] == 'ok'),
                merged_gt_pairs=[r['merged_ids'] for r in valid if r.get('merged_ids')])
    P = len(det) / (len(det) + len(extras)) if det or extras else 0.0
    R = len(det) / len(valid) if valid else 0.0
    oagg['detection'] = dict(precision=round(P, 4), recall=round(R, 4), f1=round(2 * P * R / (P + R), 4) if P + R else 0.0)
    for kind in ('door', 'window', 'entrance'):
        k = [r for r in det if r['kind'] == kind]
        oagg[f'{kind}_width_mae_cm'] = mae_cm([r['width_err_m'] for r in k])
    return dict(walls_all=wagg(lambda r: not r['low_wall']), walls_exterior=wagg(lambda r: r['exterior'] and not r['low_wall']),
                walls_interior=wagg(lambda r: not r['exterior'] and not r['low_wall']), walls_low=wagg(lambda r: r['low_wall']),
                openings=oagg)


def overlay(path, gt, walls, ops, extras, mf, gt_fp, title):
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
    from matplotlib.patches import PathPatch
    from matplotlib.path import Path as MPath
    fig, ax = plt.subplots(figsize=(15, 9), dpi=130)

    def fill(geom, **kw):
        for g in getattr(geom, 'geoms', [geom]):
            if g.geom_type != 'Polygon' or g.is_empty:
                continue
            rings = [np.asarray(g.exterior.coords)] + [np.asarray(i.coords) for i in g.interiors]
            codes = np.concatenate([[MPath.MOVETO] + [MPath.LINETO] * (len(r) - 2) + [MPath.CLOSEPOLY] for r in rings])
            ax.add_patch(PathPatch(MPath(np.concatenate(rings), codes), **kw))
    fill(gt_fp.difference(mf), color='#d62728', alpha=.75, lw=0)
    fill(mf.difference(gt_fp), color='#1f77b4', alpha=.75, lw=0)
    fill(gt_fp.intersection(mf), color='#9a9a9a', alpha=.5, lw=0)
    cmap = {'ok': '#2ca02c', 'thickness': '#ff7f0e', 'offset': '#9467bd', 'thickness_and_offset': '#8c564b',
            'missing': '#d62728', 'opening_or_junction': '#cccccc', 'short_stub': '#dddddd'}
    for r in walls:
        g = gt[r['idx']]
        ax.plot([g['a'][0], g['b'][0]], [g['a'][1], g['b'][1]], color=cmap[r['status']], lw=1.3)
    for r in ops:
        w = gt[r['gt_wall']]; d = (w['b'] - w['a']) / w['L']; c = w['a'] + d * r['gt_offset_m']
        col = {'ok': '#2ca02c', 'error': '#ff7f0e', 'missing': '#d62728', 'gt_anomaly': '#aaaaaa'}[r['status']]
        ax.plot(*c, 'o', color=col, ms=7, mfc='none', mew=2)
        if r['status'] == 'error':
            ax.annotate(f"w{100*r['width_err_m']:+.0f}", c, fontsize=7, color='#a04000', xytext=(4, 4), textcoords='offset points')
    for e in extras:
        ax.plot(*e['xz'], 'x', color='#1f77b4', ms=9, mew=2)
    ax.set_aspect('equal'); ax.invert_yaxis()
    ax.set_title(title, fontsize=9)
    fig.tight_layout(); fig.savefig(path); plt.close(fig)


def run(gt, openings, mesh0, mf0, out, tag, s, th, tx, tz):
    mesh = apply_xz(mesh0, s, th, tx, tz)
    mf = tf_poly(mf0, s, th, tx, tz)
    gt_fp = unary_union([wall_rect(w) for w in gt if w['L'] > 1e-6])
    walls = score_walls(gt, openings, mesh, mf)
    ops, extras = score_openings(gt, openings, mesh, walls)
    summ = summarize(walls, ops, extras, openings)
    summ['wall_f1'], mpts, d_model = wall_f1(gt, openings, mf)
    np.savetxt(out / f'model_centreline_{tag}.csv', np.column_stack([mpts, d_model]), delimiter=',',
               header='x,z,dist_to_gt_centreline_m', comments='', fmt='%.4f')
    summ['footprint'] = dict(iou=round(iou(mf, gt_fp), 4), model_only_m2=round(mf.difference(gt_fp).area, 3),
                             gt_only_m2=round(gt_fp.difference(mf).area, 3))
    for name, rows in (('walls', walls), ('openings', ops)):
        with open(out / f'{name}_{tag}.csv', 'w', newline='') as f:
            keys = list(dict.fromkeys(k for r in rows for k in r))
            wtr = csv.DictWriter(f, fieldnames=keys); wtr.writeheader(); wtr.writerows(rows)
    with open(out / f'extra_openings_{tag}.csv', 'w', newline='') as f:
        wtr = csv.writer(f); wtr.writerow(['x', 'z', 'width_m', 'sill_m', 'height_m', 'gt_wall'])
        for e in extras:
            wtr.writerow([round(e['xz'][0], 3), round(e['xz'][1], 3), e['width_m'], e['sill_m'], e['height_m'], e['gt_wall']])
    W, O, F = summ['walls_all'], summ['openings'], summ['wall_f1'][summ['wall_f1']['headline']]
    overlay(out / f'overlay_{tag}.png', gt, walls, ops, extras, mf, gt_fp,
            f"[{tag}] scale={s:.4f} rot={math.degrees(th):.2f}deg  IoU={summ['footprint']['iou']} | wall F1@10cm {F['f1']} (P {F['precision']} R {F['recall']}) | centre MAE {W['center_offset_mae_cm']}cm, "
            f"thick MAE {W['thickness_mae_cm']}cm, +-2cm {W['within_2cm_ratio']}, missing {W['missing']} | openings: {O['detected']}/{O['gt']} "
            f"width MAE {O['width_mae_cm']}cm, extra {O['extra']}\n"
            "grey=both  red=GT only  blue=model only | centreline colour=wall status | circle=GT opening (green ok / orange error / red missing) | x=extra")
    return summ


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--glb', required=True)
    ap.add_argument('--gt', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    gt, openings = load_gt(a.gt)
    mesh0, mf0, n_wall_nodes = load_model(a.glb)
    gt_fp = unary_union([wall_rect(w) for w in gt if w['L'] > 1e-6])
    rigid = align(mf0, gt_fp, free_scale=False)
    scaled = align(mf0, gt_fp, free_scale=True)
    report = dict(glb=str(a.glb), gt=str(a.gt), wall_nodes=n_wall_nodes, tolerance_m=TOL, scorer_version='v2-f1',
                  gt_counts=dict(walls=len(gt), low_walls=sum(w['low'] for w in gt), openings=len(openings)),
                  alignment=dict(rigid=rigid, scale_fitted=scaled),
                  rigid=run(gt, openings, mesh0, mf0, out, 'rigid', 1.0, rigid['theta'], rigid['tx'], rigid['tz']),
                  scale_fitted=run(gt, openings, mesh0, mf0, out, 'scaled', scaled['scale'], scaled['theta'], scaled['tx'], scaled['tz']),
                  not_scored=['door hinge side / swing direction (HAR scale.x / rotation.y mapping unverified)'])
    (out / 'score.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({k: report[k] for k in ('alignment', 'rigid', 'scale_fitted')}, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
