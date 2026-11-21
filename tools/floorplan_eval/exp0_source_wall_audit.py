"""Exp0: source-wall audit for Acro River Park 168C (expanded).

Compares the user-provided Archisketch ZIP walls (start/end/thickness/height)
with the wall geometry of existing 3D models, in one coordinate frame, and
compares opening sizes (placed vs catalog vs model).

Read-only: inputs are never modified. CPU only. No LLM / API calls.

Frames
  MCP summary   : (sx, sz) mm
  ZIP floorplan : (zx, zy) mm with zy = -sz
  model / glTF  : x = (sx - ox)/1000, z = (sz - oz)/1000, y = height  (origin_mm from spec)

Usage
  python exp0_source_wall_audit.py --out <dir>
"""
import argparse, csv, json, math, re, struct, zipfile
from pathlib import Path

import numpy as np
import trimesh
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

REPO = Path('/home/nas5/kinamkim/Repos/geonwoo')
AISIDE = REPO / 'AisideProject'
PROP = REPO / '3DProperty'
SUMMARY = AISIDE / 'datasets/acro-river-park/raw/archisketch/168C/expanded/modeling-source-20261012T091458Z/project-summary.json'
LAYOUT = AISIDE / 'realestate-spatial-ai/experiments/service-readiness/2026-10-23/archisketch-live/20261023T130327Z/168C-expanded/furniture-layout.json'
ZIP = AISIDE / 'datasets/acro-river-park/raw/user-provided/168c-intake-20261025/archisketch_168C.zip'
SPEC = PROP / 'tools/blender/specs/acro168c-expanded-archisketch-v1.json'
MODELS = {
    'structure-v1': PROP / 'assets/models/acro-river-park/168c/archisketch-structure-v1/expanded',
    'metric-v1': PROP / 'assets/models/acro-river-park/168c/archisketch-metric-v1/expanded',
}
TOL = 0.02          # 2 cm tolerance for thickness / offset classification
PROBE = 0.6         # half-length of perpendicular probe (m)
GT_THICK_DEFAULT = None


def glb_json(path):
    b = path.read_bytes()
    n = struct.unpack('<I', b[12:16])[0]
    return json.loads(b[20:20 + n])


def model_footprint(glb_path, components=('wall',)):
    """Top-down union of all triangles of nodes whose extras.component is in components."""
    meta = glb_json(glb_path)
    wanted = {n['name'] for n in meta['nodes'] if 'mesh' in n and n.get('extras', {}).get('component') in components}
    scene = trimesh.load(glb_path, process=False)
    polys = []
    for node in scene.graph.nodes_geometry:
        T, gname = scene.graph[node]
        base = node if node in wanted else re.sub(r'_[0-9a-f]{6}$', '', node)
        if base not in wanted:
            continue
        m = scene.geometry[gname].copy()
        m.apply_transform(T)
        tri = m.vertices[m.faces][:, :, [0, 2]]  # (x, z)
        for t in tri:
            p = Polygon(t)
            if p.area > 1e-8:
                polys.append(p)
    return unary_union(polys).buffer(0), len(wanted)


def load_inputs():
    summ = json.loads(SUMMARY.read_text())
    fp = summ['floorplans'][0]
    lay = json.loads(LAYOUT.read_text())['floorplans'][0]
    with zipfile.ZipFile(ZIP) as z:
        zf = json.loads(z.read('out_archisketch/floorplan.json'))['floors'][0]
    spec = json.loads(SPEC.read_text())
    ox, oz = spec['origin_mm']
    return summ, fp, lay, zf, ox, oz


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    summ, fp, lay, zf, ox, oz = load_inputs()
    to_m = lambda sx, sz: ((sx - ox) / 1000.0, (sz - oz) / 1000.0)

    rooms = [Polygon([to_m(x, z) for x, z in r['polygon']]).buffer(0) for r in fp['rooms']]
    rooms_u = unary_union(rooms)

    # GT walls from ZIP (zy = -sz)
    gt = []
    for i, w in enumerate(zf['walls']):
        a = to_m(w['start'][0], -w['start'][1]); b = to_m(w['end'][0], -w['end'][1])
        gt.append(dict(idx=i, id=w['id'], a=a, b=b, L=w['length_mm'] / 1000, t=w['thickness_mm'] / 1000, h=w['height_mm']))
    gt_fp = unary_union([LineString([g['a'], g['b']]).buffer(g['t'] / 2, cap_style=2) for g in gt if g['L'] > 1e-6])

    # openings: catalog vs placed, spans used to mask wall samples
    items = {it['archiId']: it for it in lay['items']}
    zk = {o['id']: o['kind'] for o in zf['openings']}
    openings = []
    for o in fp['openings']:
        cat = summ['products'][o['productId']]['dimensions']
        pl = items.get(o['archiId'], {}).get('dimensions')
        cx, cz = to_m(o['position'][0], o['position'][2])
        openings.append(dict(id=o['archiId'], name=summ['products'][o['productId']]['name'], kind=zk.get(o['archiId']),
                             c=(cx, cz), rot=o['rotation'][1], cat_w=cat['width'] / 1000, cat_h=cat['height'] / 1000,
                             pl_w=(pl or {}).get('width', 0) / 1000 or None, pl_h=(pl or {}).get('height', 0) / 1000 or None))

    def near_opening(p):
        for o in openings:
            w = max(o['pl_w'] or 0, 0.3)
            if math.dist(p, o['c']) < w / 2 + 0.05:
                return True
        return False

    report = dict(experiment='exp0_source_wall_audit', unit='168C expanded',
                  inputs=dict(summary=str(SUMMARY), layout=str(LAYOUT), zip=str(ZIP), spec=str(SPEC)),
                  origin_mm=[ox, oz], tolerance_m=TOL,
                  gt=dict(walls=len(gt), thickness_mm=sorted({round(g['t'] * 1000) for g in gt}),
                          height_mm_counts={str(h): sum(1 for g in gt if g['h'] == h) for h in sorted({g['h'] for g in gt})},
                          footprint_area_m2=round(gt_fp.area, 3)),
                  models={})

    for name, d in MODELS.items():
        glb = next(d.glob('*.glb'))
        info = json.loads((d / 'model-info.json').read_text())
        mf, n_nodes = model_footprint(glb, ('wall',))
        mfx, _ = model_footprint(glb, ('wall', 'excluded_volume'))
        inter = mf.intersection(gt_fp).area
        res = dict(glb=str(glb), wall_nodes=n_nodes, ceiling_height_m=info.get('ceiling_height_m'),
                   footprint_area_m2=round(mf.area, 3),
                   iou=round(inter / mf.union(gt_fp).area, 4),
                   gt_covered_ratio=round(inter / gt_fp.area, 4),
                   model_outside_gt_m2=round(mf.difference(gt_fp).area, 3),
                   gt_missing_m2=round(gt_fp.difference(mf).area, 3),
                   iou_with_excluded_volume=round(mfx.intersection(gt_fp).area / mfx.union(gt_fp).area, 4))

        rows = []
        rects = [LineString([q['a'], q['b']]).buffer(q['t'] / 2, cap_style=2) if q['L'] > 1e-6 else None for q in gt]
        for g in gt:
            if g['L'] < 0.05:
                continue
            a, b = np.array(g['a']), np.array(g['b'])
            dvec = (b - a) / g['L']; nvec = np.array([-dvec[1], dvec[0]])
            mid = (a + b) / 2
            side = [rooms_u.contains(Point(*(mid + s * nvec * 0.3))) for s in (1, -1)]
            ext = not all(side)
            # non-parallel neighbours: probes near them would measure the crossing wall, not this one
            cross = []
            for q, rq in zip(gt, rects):
                if rq is None or q is g:
                    continue
                dq = (np.array(q['b']) - np.array(q['a'])) / q['L']
                if abs(float(np.dot(dq, dvec))) < 0.98:
                    cross.append(rq)
            cross_u = unary_union(cross) if cross else None
            margin = max(0.25, g['t'])
            k = max(3, int(g['L'] / 0.2))
            th, off, hit, used, skipped_junction = [], [], 0, 0, 0
            for s_along in np.linspace(margin, g['L'] - margin, k) if g['L'] > 2 * margin else []:
                c = a + dvec * s_along
                if near_opening(tuple(c)):
                    continue
                if cross_u is not None and cross_u.distance(LineString([c - nvec * PROBE, c + nvec * PROBE])) < 0.02:
                    skipped_junction += 1
                    continue
                used += 1
                seg = LineString([c - nvec * PROBE, c + nvec * PROBE]).intersection(mf)
                parts = [seg] if seg.geom_type == 'LineString' else list(getattr(seg, 'geoms', []))
                best = None
                for p in parts:
                    if p.is_empty or p.length < 0.01:  # ignore seam slivers
                        continue
                    s = [float(np.dot(np.array(q) - c, nvec)) for q in p.coords]
                    lo, hi = min(s), max(s)
                    dist = 0 if lo <= 0 <= hi else min(abs(lo), abs(hi))
                    if dist <= 0.3 and (best is None or dist < best[0]):
                        best = (dist, hi - lo, (lo + hi) / 2)
                if best:
                    hit += 1; th.append(best[1]); off.append(best[2])
            r = dict(idx=g['idx'], wall_id=g['id'][:40], exterior=ext, length_m=round(g['L'], 3), gt_thickness_m=g['t'], gt_height_mm=g['h'],
                     samples=used, hit_ratio=round(hit / used, 3) if used else None,
                     model_thickness_m=round(float(np.median(th)), 3) if th else None,
                     thickness_err_m=round(float(np.median(th)) - g['t'], 3) if th else None,
                     center_offset_m=round(float(np.median(np.abs(off))), 3) if off else None)
            r['skipped_junction'] = skipped_junction
            if g['L'] <= 2 * margin:
                r['status'] = 'short_stub'
            elif not used:
                r['status'] = 'opening_or_junction'
            elif r['hit_ratio'] < 0.5:
                r['status'] = 'missing'
            elif abs(r['thickness_err_m']) > TOL and r['center_offset_m'] > TOL:
                r['status'] = 'thickness_and_offset'
            elif abs(r['thickness_err_m']) > TOL:
                r['status'] = 'thickness'
            elif r['center_offset_m'] > TOL:
                r['status'] = 'offset'
            else:
                r['status'] = 'ok'
            rows.append(r)
        with open(out / f'walls_{name}.csv', 'w', newline='') as f:
            wtr = csv.DictWriter(f, fieldnames=list(rows[0].keys())); wtr.writeheader(); wtr.writerows(rows)

        def agg(sel):
            sub = [r for r in rows if sel(r)]
            st = {}
            for r in sub:
                st[r['status']] = st.get(r['status'], 0) + 1
            te = [abs(r['thickness_err_m']) for r in sub if r['thickness_err_m'] is not None and r['status'] != 'missing']
            co = [r['center_offset_m'] for r in sub if r['center_offset_m'] is not None and r['status'] != 'missing']
            return dict(n=len(sub), status=st,
                        thickness_mae_cm=round(100 * float(np.mean(te)), 2) if te else None,
                        center_offset_mae_cm=round(100 * float(np.mean(co)), 2) if co else None,
                        within_2cm_ratio=round(sum(1 for r in sub if r['status'] == 'ok') / max(1, sum(1 for r in sub if r['status'] not in ('opening_or_junction', 'short_stub'))), 3))
        res['walls_all'] = agg(lambda r: True)
        res['walls_exterior'] = agg(lambda r: r['exterior'])
        res['walls_interior'] = agg(lambda r: not r['exterior'])

        # openings: model width vs placed vs catalog
        mo = {o.get('source_id'): o for o in info.get('openings', [])}
        orows = []
        for o in openings:
            m = mo.get(o['id'])
            orows.append(dict(id=o['id'][:8], name=o['name'], kind=o['kind'], catalog_w=o['cat_w'], placed_w=o['pl_w'],
                              model_w=m.get('width_m') if m else None, model_basis=m.get('dimension_basis') if m else 'not_in_model',
                              model_minus_placed_cm=round(100 * (m['width_m'] - o['pl_w']), 1) if (m and o['pl_w'] and m.get('width_m')) else None,
                              catalog_minus_placed_cm=round(100 * (o['cat_w'] - o['pl_w']), 1) if o['pl_w'] else None))
        with open(out / f'openings_{name}.csv', 'w', newline='') as f:
            wtr = csv.DictWriter(f, fieldnames=list(orows[0].keys())); wtr.writeheader(); wtr.writerows(orows)
        diffs = [abs(r['model_minus_placed_cm']) for r in orows if r['model_minus_placed_cm'] is not None]
        res['openings'] = dict(n=len(orows), in_model=sum(1 for r in orows if r['model_basis'] != 'not_in_model'),
                               width_mae_vs_placed_cm=round(float(np.mean(diffs)), 1) if diffs else None,
                               within_2cm=sum(1 for x in diffs if x <= 2),
                               catalog_vs_placed_over_10cm=sum(1 for r in orows if r['catalog_minus_placed_cm'] is not None and abs(r['catalog_minus_placed_cm']) > 10))
        report['models'][name] = res

        # overlay figure
        try:
            import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
            fig, ax = plt.subplots(figsize=(14, 8.5), dpi=130)
            from matplotlib.path import Path as MPath
            from matplotlib.patches import PathPatch
            def fill(geom, **kw):  # draws polygons with their holes
                for g in getattr(geom, 'geoms', [geom]):
                    if g.geom_type != 'Polygon' or g.is_empty:
                        continue
                    rings = [np.asarray(g.exterior.coords)] + [np.asarray(i.coords) for i in g.interiors]
                    verts = np.concatenate(rings)
                    codes = np.concatenate([[MPath.MOVETO] + [MPath.LINETO] * (len(r) - 2) + [MPath.CLOSEPOLY] for r in rings])
                    ax.add_patch(PathPatch(MPath(verts, codes), **kw))
            fill(gt_fp.difference(mf), color='#d62728', alpha=.8, lw=0)
            fill(mf.difference(gt_fp), color='#1f77b4', alpha=.8, lw=0)
            fill(gt_fp.intersection(mf), color='#7f7f7f', alpha=.5, lw=0)
            cmap = {'ok': '#2ca02c', 'thickness': '#ff7f0e', 'offset': '#9467bd', 'thickness_and_offset': '#8c564b', 'missing': '#d62728', 'opening_or_junction': '#bbbbbb', 'short_stub': '#dddddd'}
            for r in rows:
                g = gt[r['idx']]
                ax.plot([g['a'][0], g['b'][0]], [g['a'][1], g['b'][1]], color=cmap[r['status']], lw=1.2)
            for o in openings:
                ax.plot(*o['c'], 'k+', ms=6)
            ax.set_aspect('equal'); ax.invert_yaxis()
            ax.set_title(f'{name}: grey=both, red=ZIP only (missing), blue=model only | centerline colour=status  IoU={res["iou"]}')
            fig.tight_layout(); fig.savefig(out / f'overlay_{name}.png'); plt.close(fig)
        except Exception as e:  # figure is optional
            res['figure_error'] = repr(e)

    (out / 'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report['models'], ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
