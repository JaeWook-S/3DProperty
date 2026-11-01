#!/usr/bin/env python3
"""Independently reopen saved BLEND and GLB and compare with archived source polygons."""
import argparse,hashlib,json,math
from pathlib import Path
import bpy
from mathutils import Vector
from shapely.geometry import Polygon
from shapely.ops import unary_union
ROOT=Path(__file__).resolve().parents[2]

def bounds(obj):
    pts=[obj.matrix_world@Vector(p) for p in obj.bound_box]
    return [min(p[i] for p in pts) for i in range(3)]+[max(p[i] for p in pts) for i in range(3)]

def verify(variant,unit_type="168C",revision="v1"):
    unit_key=unit_type.lower()
    out=ROOT/f'assets/models/acro-river-park/{unit_key}/archisketch-structure-{revision}'/variant
    info=json.loads((out/'model-info.json').read_text());spec=json.loads((ROOT/f'tools/blender/specs/acro{unit_key}-{variant}-archisketch-{revision}.json').read_text())
    raw_path=ROOT.parent/spec['source_private_snapshot']/'project-summary.json';raw=json.loads(raw_path.read_text())
    source_rooms={r['archiId']:r for r in raw['floorplans'][0]['rooms']}
    checks=[]
    def check(name,condition,**detail):checks.append({'name':name,'passed':bool(condition),**detail})
    stem=f'acro{unit_key}-{variant}-archisketch'
    bpy.ops.wm.open_mainfile(filepath=str(out/(stem+'.blend')))
    check('meters / scale_length',bpy.context.scene.unit_settings.scale_length==1)
    measured_rooms=[]
    for room in info['rooms']:
        obj=bpy.data.objects['Floor/'+room['id']];triangles=[]
        for face in obj.data.polygons:
            pts=[obj.matrix_world@obj.data.vertices[i].co for i in face.vertices]
            if all(abs(v.z)<1e-6 for v in pts):triangles.append(Polygon([(v.x,-v.y) for v in pts]))
        actual=unary_union(triangles)
        origin=spec['origin_mm'];sr=source_rooms[room['source_id']]
        expected=Polygon([((x-origin[0])/1000,(z-origin[1])/1000) for x,z in sr['polygon']])
        if not expected.is_valid:
            from shapely import make_valid
            audit=next((a for a in spec.get('source_boundary_repairs',[]) if a['source_id']==room['source_id']),None)
            assert audit and audit['extra_area_m2']<.001,'Unapproved boundary repair'
            expected=max(make_valid(expected).geoms,key=lambda g:g.area)
        delta=actual.symmetric_difference(expected).area;hd=actual.hausdorff_distance(expected)
        check('source room polygon / '+room['id'],delta<5e-5 and hd<5e-6,symmetric_difference_m2=delta,hausdorff_m=hd)
        measured_rooms.append({'id':room['id'],'source_area_m2':sr['area']['squareMeters'],'mesh_area_m2':actual.area,'source_coordinate_area_m2':expected.area,'max_boundary_difference_m':hd})
    meshes={o.name:o for o in bpy.context.scene.objects if o.type=='MESH' and o.get('component')}
    for obj in meshes.values():
        if obj.get('component')=='ceiling':check('ceiling underside / '+obj.name,abs(bounds(obj)[2]-spec['ceiling_height_m'])<1e-6)
        if obj.get('component')=='door_leaf':
            dims=sorted(obj.dimensions[:2]);op=next(o for o in info['openings'] if o['id']==obj['opening_id']);check('specified door leaf / '+obj.name,abs(dims[1]-op.get('leaf_width_m',.8))<2e-6 and abs(obj.dimensions.z-op.get('leaf_height_m',2.4))<2e-6,width_m=dims[1],height_m=obj.dimensions.z)
    walls=[o for o in meshes.values() if o.get('component') in ('wall','excluded_volume')]
    for op in info['openings']:
        x,z=op['center_m'];h=op['bottom_m']+op['height_m']/2
        direction=Vector((0,-1,0)) if op['axis']=='x' else Vector((1,0,0))
        start=Vector((x,-z,h))-direction*.24
        hits=[]
        for obj in walls:
            inv=obj.matrix_world.inverted();hit,loc,normal,face=obj.ray_cast(inv@start,inv.to_3x3()@direction,distance=.48)
            if hit:hits.append(obj.name)
        check('aperture not blocked by structure / '+op['id'],not hits,blockers=hits)
        if op.get('clear_span_m'):
            glass=[bpy.data.objects[n] for n in op['mesh_names'] if '/glass-' in n]
            bs=[bounds(o) for o in glass];horizontal=op['axis']=='x';axis=0 if horizontal else 1
            span=max(b[axis+3] for b in bs)-min(b[axis] for b in bs)
            high=max(b[5] for b in bs)-min(b[2] for b in bs)
            check('user full window span / '+op['id'],abs(span-op['clear_span_m'][0])<3e-6 and abs(high-op['clear_span_m'][1])<3e-6,span_m=[span,high],not_clear_passage=True)
    original={n:{'bounds':bounds(o),'component':o.get('component'),'room_id':o.get('room_id')} for n,o in meshes.items()}
    bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(out/(stem+'.glb')));bpy.context.view_layer.update()
    imported={o.name:o for o in bpy.context.scene.objects if o.type=='MESH'}
    check('mesh names survive GLB',set(original)==set(imported))
    maxdiff=0
    for name,expected in original.items():
        o=imported.get(name)
        if o is None:continue
        diff=max(abs(a-b) for a,b in zip(expected['bounds'],bounds(o)));maxdiff=max(maxdiff,diff)
        check('GLB bounds and metadata / '+name,diff<5e-6 and o.get('component')==expected['component'] and o.get('room_id')==expected['room_id'],max_difference_m=diff)
    report={'variant':variant,'passed':all(x['passed'] for x in checks),'scope':'source_coordinate_transfer_user_dimensions_and_saved_file_roundtrip','independent_as_built_validation':False,'checks':checks,'check_count':len(checks),'max_glb_difference_m':maxdiff,'rooms':measured_rooms,'review_issues':info['issues'],'source_sha256':hashlib.sha256(raw_path.read_bytes()).hexdigest()}
    (out/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'variant':variant,'passed':report['passed'],'checks':len(checks),'max_glb_difference_m':maxdiff,'failed':[c for c in checks if not c['passed']]},ensure_ascii=False),flush=True)
    return report['passed']
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--variant',choices=['basic','expanded','both'],default='both');p.add_argument('--unit-type',choices=['112A','168C'],default='168C');p.add_argument('--revision',choices=['v1','v2'],default='v1');a=p.parse_args()
    results=[verify(v,a.unit_type,a.revision) for v in (['basic','expanded'] if a.variant=='both' else [a.variant])]
    raise SystemExit(0 if all(results) else 1)
