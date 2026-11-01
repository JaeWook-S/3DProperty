#!/usr/bin/env python3
"""Keep coordinate architecture; fix provisional sliding operation and furniture circulation.
uv run --offline --python 3.11 --with bpy==4.5.3 --with shapely==2.1.2 python tools/blender/refine_112a_circulation.py
"""
import argparse,json
import bpy
from mathutils import Vector
from shapely.geometry import Polygon,box
from shapely.ops import unary_union
from refine_112a_kitchen import ROOT,geo,envelope,sha,dump
REV='archisketch-circulation-v5'
BASE=ROOT/'assets/models/acro-river-park/112a'

def build(variant):
 src=BASE/'archisketch-entry-v4'/variant;out=BASE/REV/variant;out.mkdir(parents=True,exist_ok=True);stem=f'acro112a-{variant}'
 info=json.loads((src/'model-info.json').read_text());original=json.loads((src/'model-info.json').read_text())
 bpy.ops.wm.open_mainfile(filepath=str(src/(stem+'.blend')),use_scripts=False);scene=bpy.context.scene;bpy.context.view_layer.update()
 before={o.name:geo(o) for o in scene.objects if o.type=='MESH'};intentional=set();sliding=[]
 # Width/height stay source-derived. The generic patio product was scaled down to
 # passages too narrow for its assumed half-opening operation. Real hardware is
 # unknown; surface-sliding leaves are an explicit design proposal, not a survey.
 choices={'basic':[('sliding-10','single',-.14),('sliding-11','biparting',.14),('sliding-20','biparting',-.14)],'expanded':[('sliding-10','biparting',.14)]}[variant]
 for id,mode,offset in choices:
  o=next(o for o in info['openings'] if o['id']==id);assert o['axis']=='x';clear=o['width_m']-.1
  ids=[id+'/glass-0',id+'/glass-1',id+'/mullion']
  for name in ids:
   obj=bpy.data.objects[name];obj.location.y-=offset;intentional.add(name)
   obj['operation_basis']='proposed_surface_sliding_hardware_not_as_built'
  bpy.context.view_layer.update()
  for name in ids:
   b=envelope(bpy.data.objects[name]);assert abs(-(b[1]+b[4])/2-o['center_m'][1]-offset)<.04,(id,name,b)
  groups=[{'objects':ids,'travel_m':round(clear+.025,6)}] if mode=='single' else [
   {'objects':[id+'/glass-0',id+'/mullion'],'travel_m':round(-clear/2-.025,6)},
   {'objects':[id+'/glass-1'],'travel_m':round(clear/2+.025,6)}]
  o['sliding_operation']={'kind':mode+'_surface_slide','axis':'x','panel_groups':groups,'clear_opening_m':round(clear,6),'closed_panel_plane_offset_m':offset,'basis':'design_proposal_keep_source_opening_dimensions','as_built_hardware_verified':False,'reason':'generic half-opening blocked adult-width capsule in narrow source-scaled opening'}
  o['operation_basis']='design_proposal_keep_source_opening_dimensions'
  sliding.append({'id':id,'width_m':o['width_m'],'previous_effective_clear_m':round(clear/2-.02,6),'new_clear_m':round(clear,6),'operation':o['sliding_operation']})
 # Keep the dining set sizes and relative arrangement; translate it as one set.
 modified=[]
 for f in info['fixtures']:
  if not (f['id'].startswith('dining-') or f['id']=='living-coffee-table'):continue
  if f['id'].startswith('dining-'):
   for name in f['mesh_names']:
    obj=bpy.data.objects[name];obj.location+=Vector((-.25,-.55,0));intentional.add(name)
   f['placement_revision']={'translation_m':[-.25,.55],'basis':'proposed_walkable_staging_layout_not_measured_installation'}
  else:
   for name in f['mesh_names']:
    obj=bpy.data.objects[name];intentional.add(name)
    if name.endswith('/top'):obj.location.z+=.06
    else:
     # Stretch only the supporting legs from the unchanged floor datum.
     b=envelope(obj);oldtop=b[5];matrix=obj.matrix_world.copy();inv=matrix.inverted()
     for vert in obj.data.vertices:
      p=matrix@vert.co;p.z*= (oldtop+.06)/oldtop;vert.co=inv@p
     obj.data.update()
   f['height_revision']={'previous_m':.39,'new_m':.45,'basis':'user_feedback_design_height_not_product_measurement'}
  modified.append(f)
 bpy.context.view_layer.update()
 for f in modified:
  bounds=[envelope(bpy.data.objects[n]) for n in f['mesh_names']];fp=[[p[0],-p[4],p[3],-p[1]] for p in bounds]
  f.update(footprints_m=fp,collision_footprints_m=[p for p,b in zip(fp,bounds) if b[5]>.12 and b[2]<1.75],bounds_m=[min(p[0] for p in fp),min(p[1] for p in fp),max(p[2] for p in fp),max(p[3] for p in fp)],bottom_m=min(b[2] for b in bounds),top_m=max(b[5] for b in bounds))
  room=next(r for r in info['rooms'] if r['id']==f['room_id']);f['outside_room_m2']=unary_union([box(*p) for p in fp]).difference(Polygon(room['polygon_m']).buffer(.015)).area
  assert f['outside_room_m2']<.001,(f['id'],f['outside_room_m2'])
 assert abs(next(f for f in info['fixtures'] if f['id']=='living-coffee-table')['top_m']-.45)<1e-5
 assert info['rooms']==original['rooms'] and info['navigation_zones']==original['navigation_zones']
 for old,new in zip(original['openings'],info['openings']):
  for k in ['center_m','width_m','height_m','bottom_m','axis']:assert old[k]==new[k],(old['id'],k)
 unchanged=[n for n in before if n not in intentional];unexpected=[n for n in unchanged if geo(bpy.data.objects[n])!=before[n]];assert not unexpected,unexpected
 info['circulation_revision']={'parent_revision':'archisketch-entry-v4','parent_blend_sha256':sha(src/(stem+'.blend')),'sliding_review':sliding,'dining_set_translation_m':[-.25,.55],'coffee_table_height_m':.45,'structural_geometry_unchanged':True,'source_opening_dimensions_unchanged':True,'body_width_m':.44,'eye_height_m':1.6,'as_built_operation_verified':False}
 exported=[o for o in scene.objects if o.type=='MESH' and o.get('component')]
 bpy.ops.object.select_all(action='DESELECT')
 for o in exported:o.hide_set(False);o.select_set(True)
 for o in bpy.data.collections['06_Interiors'].objects:
  if o.type=='EMPTY':o.select_set(True)
 glb=out/(stem+'.glb');bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_extras=True,export_yup=True,export_cameras=False,export_lights=False)
 bpy.ops.object.select_all(action='DESELECT')
 for o in exported:
  if o.get('component')=='ceiling':o.hide_render=True;o.hide_set(True)
 scene['revision']=REV
 blend=out/(stem+'.blend');bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(blend))
 info.update(finish_revision=REV,mesh_count=len(exported),blend_sha256=sha(blend),glb_sha256=sha(glb))
 dump(out/'model-info.json',info)
 dump(out/'verification.json',{'passed':True,'variant':variant,'unchanged_meshes':len(unchanged),'changed_meshes':sorted(intentional),'unexpected_changes':unexpected,'rooms_and_zones_unchanged':True,'source_opening_dimensions_unchanged':True,'sliding':sliding,'dining_translation_m':[-.25,.55],'coffee_table_height_m':.45,'render_performed':False,'passage_requires_browser_validation':True})
 print(json.dumps({'variant':variant,'output':str(out),'sliding':sliding,'unchanged_meshes':len(unchanged)},ensure_ascii=False),flush=True)
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('--variant',choices=['basic','expanded','both'],default='both');args=a.parse_args()
 for v in ['basic','expanded'] if args.variant=='both' else [args.variant]:build(v)
