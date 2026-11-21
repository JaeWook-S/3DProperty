"""Build the stage-2 numeric input (HAR base + MCP derived values) for each unit of the release.

Input : <release>/data/<unit>/{har_project_edit.json, project.har, mcp_get-*.json}
        (release = AisideProject/datasets/acro-river-park/releases/2026-11-20-floorplans10)
Output: <out_root>/<unit>/stage2/floorplan_numbers.json
Usage : python build_stage2_input.py <release_dir> <out_root>   (out_root = 3DProperty/runtime/floorplan-accuracy/inputs)

Only floorplan geometry is kept (corners, walls, rooms, openings). Furniture, finishes, owner/address,
image URLs and other project metadata are dropped.
"""
import json, math, sys
from pathlib import Path

import numpy as np

REL = Path(sys.argv[1]); OUT = Path(sys.argv[2])


def product_dims(har_path):
    h = json.loads(Path(har_path).read_text())
    dims = {}
    for e in h['log']['entries']:
        if 'components/multi/detail' not in e['request']['url']:
            continue
        t = (e['response'].get('content') or {}).get('text')
        if not t:
            continue
        for c in json.loads(t).get('result', []):
            c = c.get('component', c); d = c.get('dimension') or {}
            if 'mmWidth' in d:
                dims[c['id']] = dict(name=c.get('name'), width=d['mmWidth'], height=d['mmHeight'], depth=d['mmDepth'])
    return dims


def build(u):
    D = REL / 'data' / u
    H = json.loads((D / 'har_project_edit.json').read_text())['data']['floorplans'][0]
    M = json.loads((D / 'mcp_get-floorplan-structure.json').read_text())['floorplans'][0]
    S = json.loads((D / 'mcp_get-project-summary.json').read_text())
    pd = product_dims(D / 'project.har')
    for k, v in S['products'].items():          # fallback to MCP summary product dims
        pd.setdefault(k, dict(name=v['name'], width=v['dimensions']['width'], height=v['dimensions']['height'],
                              depth=v['dimensions']['depth']))
    corners = {c['archiId']: c['position'] for c in H['corners']}
    mw = {w['archiId']: w for w in M['walls']}
    mo = {o['id']: (o, w['archiId']) for w in M['walls'] for o in w['openings']}
    mr = {r['archiId']: r for r in M['rooms']}
    items = {i['archiId']: i for i in H['items']}

    walls = []
    for w in H['walls']:
        a, b = corners[w['corners'][0]], corners[w['corners'][1]]; m = mw[w['archiId']]
        walls.append(dict(id=w['archiId'], corner_ids=w['corners'],
                          start=[a['x'], a['z']], end=[b['x'], b['z']],
                          length=math.hypot(b['x'] - a['x'], b['z'] - a['z']),
                          thickness=w['thickness'], height=w['height'], exterior=m['exterior'],
                          room_ids=m['rooms'], opening_ids=[o['id'] for o in m['openings']]))
    rooms = []
    for r in H['rooms']:
        m = mr.get(r['archiId'], {})
        rooms.append(dict(id=r['archiId'], label=r['label'], type=m.get('type'), type_code=r['type'],
                          ceiling_height=r['height'], area_m2=round(r['area'] / 1e6, 4),
                          corner_ids=r['corners'], polygon=[[p['x'], p['z']] for p in r['innerPoints']]))
    openings = []
    for oid, (o, wid) in mo.items():
        i = items[oid]; et = i['meta']['editorType']; p = pd[i['productId']]
        rec = dict(id=oid, kind=o['kind'], editor_type=et['name'], host_wall_id=wid,
                   offset_center=o['offset'], width=o['width'], height=o['height'], sill=o['sill'],
                   product=dict(id=i['productId'], **p),
                   position=[i['position']['x'], i['position']['y'], i['position']['z']],
                   rotation_rad=[i['rotation']['x'], i['rotation']['y'], i['rotation']['z']],
                   scale=[i['scale']['x'], i['scale']['y'], i['scale']['z']],
                   local_transform=i['localTransform'], open=et.get('open'))
        if et.get('swingDoorSetting'):
            rec['swing_door_setting'] = et['swingDoorSetting']
        # consistency check: HAR-derived values vs MCP values (mm)
        W = p['width'] * abs(i['scale']['x']); Hh = p['height'] * abs(i['scale']['y'])
        assert abs(W - o['width']) < 1.5 and abs(Hh - o['height']) < 1.5 and abs(i['position']['y'] - Hh / 2 - o['sill']) < 1.5, oid
        openings.append(rec)
    xs = [c['x'] for c in corners.values()]; zs = [c['z'] for c in corners.values()]
    doc = dict(
        about=('Archisketch source floorplan numbers for this apartment unit. Base: planner project data (HAR). '
               'Opening offset/width/height/sill, wall exterior flag, wall-room links and room type names are added '
               'from the Archisketch MCP read tools.'),
        units=dict(length='mm', rotation='radian', area='m2'),
        axes=('Floor plane is X and Z, Y is up. On the 2D plan X grows to the right and Z grows downward. '
              'Wall start/end are wall centreline end points.'),
        fields=dict(
            offset_center='distance along the host wall from wall start to the opening centre',
            sill='height of the opening bottom above the floor', height='opening height', width='opening width',
            scale='product scale; a negative x means the product is mirrored',
            swing_door_setting='door opening direction (PUSH/PULL) and handle side as set in the planner'),
        floor_height=H['floorHeight'], slab_thickness=H['slabThickness'],
        extent=dict(min_x=min(xs), max_x=max(xs), min_z=min(zs), max_z=max(zs)),
        counts=dict(walls=len(walls), rooms=len(rooms), openings=len(openings)),
        corners=[dict(id=k, x=v['x'], z=v['z']) for k, v in corners.items()],
        walls=walls, rooms=rooms, openings=openings)
    out = OUT / u / 'stage2'; out.mkdir(parents=True, exist_ok=True)
    (out / 'floorplan_numbers.json').write_text(json.dumps(doc, ensure_ascii=False, indent=1))
    return doc['counts'], len(pd)


for u in sorted(p.name for p in (REL / 'data').iterdir() if p.is_dir()):
    print(u, *build(u))
