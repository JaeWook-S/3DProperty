#!/usr/bin/env python3
"""Reopen saved BLEND, measure meshes, then import GLB and compare world bounds."""
import argparse
import hashlib
import json
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--output', type=Path, default=ROOT/'assets/models/acro-river-park/168c/structural-v0/expanded')
p.add_argument('--stem',default='acro168c-expanded-structure')
args = p.parse_args()
out = args.output.resolve()
checks = []

def check(name, passed, **data):
    checks.append(dict(name=name, passed=bool(passed), **data))

def bounds(obj):
    vv = [obj.matrix_world @ v.co for v in obj.data.vertices]
    return [[min(v[i] for v in vv) for i in range(3)], [max(v[i] for v in vv) for i in range(3)]]

def local_size(obj):
    return [max(v.co[i] for v in obj.data.vertices)-min(v.co[i] for v in obj.data.vertices) for i in range(3)]

def close(a, b):
    return max(abs(x-y) for x,y in zip(a,b)) < 1e-5

bpy.ops.wm.open_mainfile(filepath=str(out/(args.stem+'.blend')))
bpy.context.view_layer.update()
check('BLEND uses meters', bpy.context.scene.unit_settings.system == 'METRIC' and bpy.context.scene.unit_settings.scale_length == 1)
original = {}
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH' and obj.get('component') and obj.get('component') != 'annotation':
        original[obj.name] = {'bounds':bounds(obj), 'component': obj['component'], 'fixture_id':obj.get('fixture_id')}
        check('unit scale / '+obj.name, close(obj.scale, [1,1,1]))
        if obj['component'] == 'door_leaf':
            size = local_size(obj)
            expected = [.7,2.1] if obj.get('opening_id') == 'bathroom-1-shower-door' else [.8,2.4]
            check('saved leaf / '+obj.name, close([size[0],size[2]], expected), observed_m=[size[0],size[2]])
        if obj['component'] == 'ceiling':
            b = bounds(obj)
            check('saved ceiling underside 2.5m', abs(b[0][2]-2.5)<1e-5, observed_m=b[0][2])
            check('ceiling hidden for Blender review', obj.hide_get() and obj.hide_render)

for prefix, expected in [('bedroom-2-window',[1.4,1.2]),('bedroom-3-window',[1.4,1.2]),('living-window-1',[3.4,1.8])]:
    obj = bpy.data.objects[prefix+'/full-window-span']
    size = local_size(obj)
    observed = [max(size[0:2]), size[2]]
    check('saved user window span / '+prefix, close(observed,expected), observed_m=observed)
    frames = [o for o in bpy.context.scene.objects if o.name.startswith(prefix+'/frame-')]
    bb = [bounds(o) for o in frames]
    span = [max(b[1][i] for b in bb)-min(b[0][i] for b in bb) for i in range(3)]
    exp = [3.6,2.0] if prefix == 'living-window-1' else [1.6,1.4]
    obs = [max(span[:2]),span[2]]
    check('saved frame / '+prefix,close(obs,exp),observed_m=obs)


info=json.loads((out/'model-info.json').read_text())
if info.get('revision') in ['structural-v1', 'structural-v2']:
    excluded=json.loads((out/'excluded-zones.json').read_text())
    expected_zones={'shaft-bathroom-1-north','shaft-hall-west','shaft-hall-east','shaft-entry-north','shaft-primary-bathroom','shaft-kitchen','shaft-utility'}
    check('seven plan X regions represented', {z['id'] for z in excluded} == expected_zones)
    for zone in excluded:
        obj=bpy.data.objects[zone['mesh_name']]
        box=bounds(obj)
        a,b,c,d=zone['reference_bounds_m']
        center=[(a+c)/2,-(b+d)/2,1.2]
        inside=all(box[0][i]<center[i]<box[1][i] for i in range(3))
        check('X region physically blocked / '+zone['id'],inside and obj.get('occupiable') is False and obj.get('furniture_placeable') is False)
    solid=[obj for obj in bpy.context.scene.objects if obj.type=='MESH' and obj.get('component') in ['wall','wall_pier','excluded_volume','glass_partition','fixed_storage','passage_frame']]
    def blockers(point):
        result=[]
        for obj in solid:
            bb=bounds(obj)
            if all(bb[0][i]+1e-5<point[i]<bb[1][i]-1e-5 for i in range(3)):
                result.append(obj.name)
        return result
    ops={o['id']:o for o in json.loads((out/'openings.json').read_text())}
    for oid in ['hall-pantry-door','dressing-inner-passage','primary-balcony-service-door','bathroom-1-shower-door']:
        op=ops[oid];point=op['blender_location_m'][:];point[2]=1.0
        blocked=[]
        for shift in [-.09,0,.09]:
            pt=point[:];pt[1 if op['axis']=='h' else 0]+=shift
            blocked.extend(blockers(pt))
        check('new structural aperture open / '+oid,not blocked,blockers=blocked)
    # Independent saved-geometry sampling from the dressing entry into its back area.
    op=ops['dressing-inner-passage'];x,y,z=op['blender_location_m']
    blocked=[]
    for dx in [.3,0,-.3,-.6,-.9,-1.2,-1.5]:
        blocked.extend(blockers([x+dx,y,1.0]))
    check('deeper dressing connection is not walled off',not blocked,blockers=blocked)
    sliding_ids=['primary-balcony-opening'] + (['living-window-2'] if info['revision']=='structural-v2' else [])
    for oid in sliding_ids:
        panels=[o for o in bpy.context.scene.objects if o.get('component')=='sliding_panel' and o.get('opening_id')==oid]
        check('balcony has separate moving and fixed panels / '+oid,len(panels)==2 and sum(bool(o.get('moving_panel')) for o in panels)==1)
        check('balcony has no full-width fixed glazing / '+oid,bpy.data.objects.get(oid+'/full-window-span') is None)
    check('old full-span balcony glass removed',bpy.data.objects.get('primary-balcony-opening/full-window-span') is None)
    check('hall and kitchen pantry distinct',bpy.data.objects.get('hall-pantry-door/leaf') is not None and bpy.data.objects.get('pantry-door/leaf') is not None)
    check('shower tray and pull present',bpy.data.objects.get('bathroom-1-shower/base') is not None and bpy.data.objects.get('bathroom-1-shower-door/handle') is not None)


if info.get('revision') == 'structural-v2':
    # Inspect the saved wall and door geometry independently of generator parameters.
    old_ops={o['id']:o for o in json.loads((out.parents[1]/'structural-v1/expanded/openings.json').read_text())}
    pantry=ops['pantry-door'];old_pantry=old_ops['pantry-door']
    check('pantry door moved to west wall',pantry['axis']=='v' and pantry['wall_id']=='pantry-west' and pantry['blender_location_m'][0]<old_pantry['blender_location_m'][0])
    blocked=[]
    x,y,_=pantry['blender_location_m']
    for dx in [-.65,-.3,0,.3,.65]:
        for dz in [.3,1.2,2.2]:
            blocked.extend(blockers([x+dx,y,dz]))
    check('west pantry approach and aperture free of fixed geometry',not blocked,blockers=blocked)
    ox,oy,_=old_pantry['blender_location_m']
    closure_samples=[bool(blockers([ox+dx,oy,z])) for dx in [-.3,0,.3] for z in [.3,1.2,2.3]]
    check('former pantry north doorway filled full height',all(closure_samples),samples=len(closure_samples))
    wall=bpy.data.objects['primary-balcony-south-closure/after'];bb=bounds(wall)
    check('primary balcony south closure full ceiling height',abs(bb[0][2])<1e-5 and abs(bb[1][2]-2.5)<1e-5)
    wall_samples=[bool(blockers([bb[0][0]+(bb[1][0]-bb[0][0])*t,(bb[0][1]+bb[1][1])/2,z])) for t in [.02,.15,.30,.5,.7,.85,.98] for z in [.2,1.2,2.4]]
    check('primary balcony cannot open directly to living',all(wall_samples),samples=len(wall_samples))
    # Probe the uncovered half of both sliders, including panel/sash/frame solids.
    sliding_solids=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.get('component') in ['sliding_panel','sliding_frame','window_frame']]
    for oid in ['primary-balcony-opening','living-window-2']:
        op=ops[oid];x,y,_=op['blender_location_m'];span=op['display_span_m'][0]
        pt=[x+span*.25,y,1.2] if op['axis']=='h' else [x,y-span*.25,1.2]
        blocked=blockers(pt)
        for obj in sliding_solids:
            bb=bounds(obj)
            if all(bb[0][i]+1e-5<pt[i]<bb[1][i]-1e-5 for i in range(3)):blocked.append(obj.name)
        check('shown-open sliding assembly leaves uncovered half / '+oid,not blocked and op['kind']=='sliding_door',blockers=blocked)
    fixtures=json.loads((out/'fixtures.json').read_text())
    kitchen=[f for f in fixtures if f['id'].startswith('kitchen-')]
    check('kitchen has seven fixed fixture groups',len(kitchen)==7)
    exclusions=[bounds(bpy.data.objects[z['mesh_name']]) for z in excluded]
    for fixture in kitchen:
        meshes=[bpy.data.objects[n] for n in fixture['mesh_names']]
        check('fixed fixture metadata / '+fixture['id'],len(meshes)>0 and all(o.get('collision') is True and o.get('furniture_placeable') is False and o.get('dimension_status')=='unmeasured_placeholder' for o in meshes))
        collisions=[]
        for obj in meshes:
            bb=bounds(obj)
            if bb[1][2]>2.5+1e-5:collisions.append(obj.name+'/ceiling')
            for index,eb in enumerate(exclusions):
                if all(min(bb[1][i],eb[1][i])-max(bb[0][i],eb[0][i])>1e-5 for i in range(3)):collisions.append(obj.name+'/X'+str(index))
        check('fixed kitchen avoids excluded shafts and ceiling / '+fixture['id'],not collisions,collisions=collisions)
    # These are draft route samples, not a certified person-radius clearance test.
    blocked=[]
    for y in [6.5,7,7.5,8,8.5,9,9.5,10,10.3]:
        for x in [11.2,11.5,11.8]:
            blocked.extend(blockers([x,-y,.5]))
    check('draft kitchen approach samples free of fixed cabinets',not blocked,blockers=blocked,clearance_certified=False)

(out/'review-geometry.json').write_text(json.dumps(original,ensure_ascii=False,indent=2)+'\n')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(out/(args.stem+'.glb')))
bpy.context.view_layer.update()
imported = {o.name:o for o in bpy.context.scene.objects if o.type == 'MESH'}
check('GLB mesh identity set', set(imported)==set(original), expected_count=len(original), actual_count=len(imported))
max_delta = 0.0
for name, before in original.items():
    obj = imported.get(name)
    if obj is None:
        continue
    after = bounds(obj)
    delta = max(abs(a-b) for x,y in zip(before['bounds'],after) for a,b in zip(x,y))
    max_delta = max(max_delta,delta)
    check('GLB bounds / '+name, delta<1e-5, max_difference_m=delta)
    check('GLB category / '+name, obj.get('component') == before['component'])
    if info.get('revision') == 'structural-v2' and before.get('fixture_id'):
        check('GLB fixed fixture semantics / '+name,obj.get('fixture_id')==before['fixture_id'] and obj.get('collision') is True and obj.get('furniture_placeable') is False)
    if before['component']=='excluded_volume':
        check('GLB non-occupiable semantics / '+name,obj.get('occupiable') is False and obj.get('furniture_placeable') is False)
check('GLB contains no cameras or lights', not any(o.type in ['CAMERA','LIGHT'] for o in bpy.context.scene.objects))
result = {'passed':all(x['passed'] for x in checks),'checks_count':len(checks),'checks':checks,
          'architecture_meshes':len(original),'max_glb_roundtrip_difference_m':max_delta,
          'scope':'saved geometry and GLB export/import; no claim of as-built dimensional validation or web integration',
          'blender_version':bpy.app.version_string,
          'blend_sha256':hashlib.sha256((out/(args.stem+'.blend')).read_bytes()).hexdigest(),
          'glb_sha256':hashlib.sha256((out/(args.stem+'.glb')).read_bytes()).hexdigest()}
(out/'verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='checks'}))
assert result['passed'], [x for x in checks if not x['passed']]
