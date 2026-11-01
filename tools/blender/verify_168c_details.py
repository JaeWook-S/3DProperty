#!/usr/bin/env python3
"""Reopen saved artifacts; independently compare source polygons and GLB roundtrip."""
import json,hashlib,math
from pathlib import Path
import bpy
from shapely.geometry import Polygon,box,Point
from shapely.ops import unary_union
from refine_112a_kitchen import ROOT,geo,envelope,sha,dump
from refine_168c_details import REV,BASE,STRUCTURE

def run(variant):
 out=BASE/REV/variant;stem='acro168c-'+variant;info=json.loads((out/'model-info.json').read_text());old=BASE/'archisketch-interiors-v1'/variant
 specpath=ROOT/f'tools/blender/specs/acro168c-{variant}-archisketch-v1.json';spec=json.loads(specpath.read_text());rawpath=ROOT.parent/spec['source_private_snapshot']/'project-summary.json';raw=json.loads(rawpath.read_text());sr={r['archiId']:r for r in raw['floorplans'][0]['rooms']}
 checks=[]
 def check(n,ok,**kw):checks.append(dict(name=n,passed=bool(ok),**kw))
 check('model metadata artifact hashes',sha(out/(stem+'.blend'))==info['blend_sha256'] and sha(out/(stem+'.glb'))==info['glb_sha256'])
 check('saved Archisketch source SHA',sha(rawpath)==info['source_summary_sha256'])
 check('spec SHA',sha(specpath)==info['spec_sha256'])
 bpy.ops.wm.open_mainfile(filepath=str(old/(stem+'.blend')),use_scripts=False);bpy.context.view_layer.update()
 oldgeo={o.name:geo(o) for o in bpy.context.scene.objects if o.type=='MESH' and o.get('component') in STRUCTURE}
 bpy.ops.wm.open_mainfile(filepath=str(out/(stem+'.blend')),use_scripts=False);bpy.context.view_layer.update();scene=bpy.context.scene
 allowed={n for o in info['openings'] if o.get('sliding_operation') for g in o['sliding_operation']['panel_groups'] for n in g['objects']}
 allowed.update(j['mesh'] for j in info.get('joinery_review',[]))
 for n,h in oldgeo.items():
  if n not in allowed:check('protected geometry / '+n,bpy.data.objects.get(n) is not None and geo(bpy.data.objects[n])==h)
 for j in info.get('joinery_review',[]):
  op=next(o for o in info['openings'] if o['id']==j['id']);axis=1 if op['axis']=='x' else 0;a=envelope(bpy.data.objects[j['mesh']]);b=envelope(bpy.data.objects[j['id']+'/glass-1']);over=min(a[axis+3],b[axis+3])-max(a[axis],b[axis])
  check('moving stile and fixed pane tracks / '+j['id'],over<-.001,normal_separation_m=-over)
 check('meters / no unit scaling',scene.unit_settings.scale_length==1)
 def room_poly(o):
  tris=[]
  for f in o.data.polygons:
   pts=[o.matrix_world@o.data.vertices[i].co for i in f.vertices]
   if all(abs(p.z)<1e-5 for p in pts):tris.append(Polygon([(p.x,-p.y) for p in pts]))
  return unary_union(tris)
 room_results=[]
 for r in info['rooms']:
  origin=spec['origin_mm'];source=Polygon([((x-origin[0])/1000,(z-origin[1])/1000) for x,z in sr[r['source_id']]['polygon']]);actual=room_poly(bpy.data.objects['Floor/'+r['id']]);diff=source.symmetric_difference(actual).area;hd=source.hausdorff_distance(actual)
  check('raw source room polygon / '+r['id'],diff<5e-5 and hd<5e-6,symmetric_difference_m2=diff,hausdorff_m=hd);room_results.append(dict(id=r['id'],max_boundary_difference_m=hd))
 for o in info['openings']:
  if o['kind']=='door':
   leaf=bpy.data.objects[o['id']+'/leaf'];b=envelope(leaf);w=b[3]-b[0] if o['axis']=='x' else b[4]-b[1]
   check('door dimensions / '+o['id'],abs(w-.8)<5e-6 and abs((b[5]-b[2])-2.4)<5e-6,width_m=w,height_m=b[5]-b[2])
 for r in info['rooms']:
  # Every room still has its ceiling at the user-specified height.
  ceilings=[o for o in scene.objects if o.type=='MESH' and o.get('component')=='ceiling' and o.get('room_id')==r['id']]
  if not ceilings:ceilings=[o for o in scene.objects if o.type=='MESH' and o.name=='Ceiling/'+r['id']]
  for o in ceilings:check('ceiling / '+r['id'],abs(envelope(o)[2]-2.5)<5e-6)
 footprints=[]
 for f in info['fixtures']:
  bs=[envelope(bpy.data.objects[n]) for n in f['mesh_names']];fp=[[b[0],-b[4],b[3],-b[1]] for b in bs];bounds=[min(p[0] for p in fp),min(p[1] for p in fp),max(p[2] for p in fp),max(p[3] for p in fp)]
  check('fixture metadata / '+f['id'],max(abs(a-b) for a,b in zip(bounds,f['bounds_m']))<1e-6)
  poly=next(r['polygon_m'] for r in info['rooms'] if r['id']==f['room_id']);over=unary_union([box(*b) for b in fp]).difference(Polygon(poly).buffer(.015)).area
  check('fixture contained / '+f['id'],over<.001,outside_room_m2=over)
  footprints.append((f,unary_union([box(*p) for p in f['collision_footprints_m']])))
 # Nonzero collision-height fixture overlaps are listed; decorations are excluded.
 overlaps=[]
 for i,(f,a) in enumerate(footprints):
  for g,b in footprints[i+1:]:
   if f['room_id']!=g['room_id']:continue
   area=a.intersection(b).area
   if area>.002:overlaps.append(dict(a=f['id'],b=g['id'],area_m2=area))
 # Upper cabinets/hood live above the worktop: projected overlap is intentional,
 # so validate height intervals before calling it a solid volume collision.
 solid_overlap=[]
 fs=[f for f in info['fixtures'] if f['component']!='decoration']
 for i,f in enumerate(fs):
  for g in fs[i+1:]:
   if f['room_id']!=g['room_id']:continue
   for fn in f['mesh_names']:
    a=envelope(bpy.data.objects[fn])
    for gn in g['mesh_names']:
     b=envelope(bpy.data.objects[gn]);dx=min(a[3],b[3])-max(a[0],b[0]);dy=min(a[4],b[4])-max(a[1],b[1]);dz=min(a[5],b[5])-max(a[2],b[2]);volume=max(0,dx)*max(0,dy)*max(0,dz)
     if volume>.001:solid_overlap.append(dict(a=fn,b=gn,aabb_overlap_m3=volume))
 check('independent fixture solid envelopes',not solid_overlap,overlaps=solid_overlap)
 before={o.name:{'bounds':envelope(o),'component':o.get('component')} for o in scene.objects if o.type=='MESH' and o.get('component')}
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(out/(stem+'.glb')));bpy.context.view_layer.update()
 imported={o.name:o for o in bpy.context.scene.objects if o.type=='MESH'};check('GLB mesh identities',set(before)==set(imported),missing=sorted(set(before)-set(imported)),extra=sorted(set(imported)-set(before)))
 maxdiff=0
 for n,d in before.items():
  if n not in imported:continue
  delta=max(abs(a-b) for a,b in zip(envelope(imported[n]),d['bounds']));maxdiff=max(maxdiff,delta);check('GLB roundtrip / '+n,delta<8e-6 and imported[n].get('component')==d['component'],max_m=delta)
 result=dict(variant=variant,passed=all(c['passed'] for c in checks),checks=checks,check_count=len(checks),max_glb_roundtrip_m=maxdiff,room_boundaries=room_results,projected_overlaps=overlaps,solid_envelope_overlaps=solid_overlap,independent_as_built_validation=False)
 dump(out/'independent-verification.json',result);print(json.dumps({k:v for k,v in result.items() if k not in ['checks','room_boundaries','projected_overlaps','solid_envelope_overlaps']}),flush=True)
 print(json.dumps([c for c in checks if not c['passed']],ensure_ascii=False),flush=True)
 return result['passed']
if __name__=='__main__':raise SystemExit(0 if all([run(v) for v in ['basic','expanded']]) else 1)
