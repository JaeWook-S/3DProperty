#!/usr/bin/env python3
"""Correct source-sized entrance openings; partition navigation without adding walls.
uv run --offline --python 3.11 --with bpy==4.5.3 --with shapely==2.1.2 python tools/blender/refine_112a_entrance.py
"""
import argparse,hashlib,json
from pathlib import Path
import bpy
from shapely import constrained_delaunay_triangles
from shapely.geometry import Polygon,box
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from refine_112a_kitchen import geo,envelope,sha,dump,ROOT

REV='archisketch-entry-v4'
BASE=ROOT/'assets/models/acro-river-park/112a'
EVIDENCE=ROOT/'tools/blender/specs/acro112a-entrance-review-20261021.json'

def polys(g):
 if g.is_empty:return []
 if g.geom_type=='Polygon':return [g]
 return [p for q in getattr(g,'geoms',[]) for p in polys(q)]

def prism(name,poly,bottom,top,mat):
 poly=orient(poly,sign=1);coords=[];indices={};rings=[];triangles=[]
 def index(p):
  k=tuple(round(c,9) for c in p)
  if k not in indices:indices[k]=len(coords);coords.append(k)
  return indices[k]
 for ring in [poly.exterior,*poly.interiors]:rings.append([index(p) for p in list(ring.coords)[:-1]])
 for tri in constrained_delaunay_triangles(poly).geoms:triangles.append([index(p) for p in list(orient(tri,sign=1).exterior.coords)[:3]])
 n=len(coords);faces=[]
 for a,b,c in triangles:faces.extend([(a,b,c),(a+n,c+n,b+n)])
 for ring in rings:
  for i,a in enumerate(ring):b=ring[(i+1)%len(ring)];faces.append((a,a+n,b+n,b))
 mesh=bpy.data.meshes.new(name);mesh.from_pydata([(x,-z,y) for y in [bottom,top] for x,z in coords],[],faces);mesh.update()
 obj=bpy.data.objects.new(name,mesh);bpy.data.collections['02_Walls'].objects.link(obj);mesh.materials.append(mat)
 for k,v in {'component':'wall','collision':True,'inferred_wall':True,'layer_bottom_m':bottom,'correction':'restore wall beside 1000mm source entrance'}.items():obj[k]=v
 return obj

def reshape_x(obj,width,center):
 b=envelope(obj);old=(b[0]+b[3])/2;scale=width/(b[3]-b[0]);matrix=obj.matrix_world.copy();inv=matrix.inverted()
 for vert in obj.data.vertices:
  p=matrix@vert.co;p.x=center+(p.x-old)*scale;vert.co=inv@p
 obj.data.update()

def zones(info):
 rooms={r['id']:r for r in info['rooms']};shared=rooms['living-kitchen-hall'];p=Polygon(shared['polygon_m']);b=p.bounds
 entry=p.intersection(box(*info['entry_review']['gross_bounds_m']))
 seam_x=rooms['bedroom-2']['bounds_m'][2]+.2
 seam_z=rooms['primary']['bounds_m'][1]+.95
 hall=p.intersection(box(b[0]-1,b[1]-1,seam_x,b[3]+1)).difference(entry)
 rest=p.difference(unary_union([entry,hall]))
 kitchen=rest.intersection(box(b[0]-1,b[1]-1,b[2]+1,seam_z))
 living=rest.difference(kitchen)
 records=[]
 for id,name,shape in [('living','거실',living),('kitchen','주방',kitchen),('corridor','복도',hall),('entrance','현관',entry)]:
  shape=unary_union(polys(shape))
  assert shape.geom_type=='Polygon' and not shape.interiors,(id,shape.geom_type)
  pt=shape.representative_point();bounds=list(shape.bounds)
  records.append({'id':id,'name':name,'name_ko':name,'kind':'navigation_zone','source_room_id':'living-kitchen-hall','polygon_m':[list(v) for v in list(shape.exterior.coords)[:-1]],'bounds_m':bounds,'width_m':bounds[2]-bounds[0],'depth_m':bounds[3]-bounds[1],'representative_point_m':[pt.x,pt.y],'walk_start_m':[pt.x,pt.y],'viewTarget':[pt.x+.8,pt.y+.4],'navigable':True,'basis':'semantic navigation partition; not a physical wall or separate measured room'})
 shapes=[Polygon(r['polygon_m']) for r in records]
 assert unary_union(shapes).symmetric_difference(p).area<1e-8
 assert all(a.intersection(b).area<1e-8 for i,a in enumerate(shapes) for b in shapes[i+1:])
 return records

def build(variant):
 src=BASE/'archisketch-kitchen-v3'/variant;out=BASE/REV/variant;out.mkdir(parents=True,exist_ok=True);stem=f'acro112a-{variant}'
 info=json.loads((src/'model-info.json').read_text());spec=json.loads((ROOT/f'tools/blender/specs/acro112a-{variant}-archisketch-v2.json').read_text())
 proof=json.loads(EVIDENCE.read_text())['variants'][variant]
 bpy.ops.wm.open_mainfile(filepath=str(src/(stem+'.blend')));scene=bpy.context.scene;bpy.context.view_layer.update()
 before={o.name:geo(o) for o in scene.objects if o.type=='MESH'};old_rooms=json.dumps(info['rooms'],sort_keys=True)
 door=next(o for o in info['openings'] if o['id']=='door-00');previous=dict(door);assert proof['entrance']['archiId']==door['source_id']
 width=proof['entrance']['dimensions']['width']/1000;assert width==1.0
 x,z=door['center_m'];old_width=door['width_m'];old_leaf=door['leaf_width_m'];leaf_width=width-.04
 # Restore exactly the portion of the original inferred wall removed by the oversized opening.
 regions=unary_union([Polygon(r['polygon_m']) for r in spec['rooms']]);wall=regions.buffer(spec['wall_inference']['external_buffer_m'],join_style='mitre').difference(regions)
 depth=spec['wall_inference'].get('opening_cut_half_depth_m',.25)
 old_cut=box(x-old_width/2,z-depth,x+old_width/2,z+depth);new_cut=box(x-width/2,z-depth,x+width/2,z+depth)
 restored=wall.intersection(old_cut.difference(new_cut));mat=next(o for o in scene.objects if o.get('component')=='wall').data.materials[0]
 made=[prism(f'Entry wall correction/{i:02d}',p,door['bottom_m'],door['bottom_m']+door['height_m'],mat) for i,p in enumerate(polys(restored))]
 assert made and restored.area>.1
 reshape_x(bpy.data.objects['door-00/jamb-left'],.02,x-width/2+.01)
 reshape_x(bpy.data.objects['door-00/jamb-right'],.02,x+width/2-.01)
 reshape_x(bpy.data.objects['door-00/head'],leaf_width,x)
 reshape_x(bpy.data.objects['door-00/leaf'],leaf_width,x)
 bpy.data.objects['door-00/leaf']['nominal_width_m']=leaf_width
 accessories=info.get('door_accessories',{}).get('door-00',[])
 # Handles keep their offset relative to the original leaf surface, using the existing lever convention.
 for name in accessories:
  obj=bpy.data.objects[name];b=envelope(obj);center=(b[0]+b[3])/2
  reshape_x(obj,b[3]-b[0],x+(center-x)*leaf_width/old_leaf)
 door.update(width_m=width,leaf_width_m=leaf_width,dimension_basis='live_scaled_editor_entrance_width',previous_inferred_host_span_m=old_width,frame_allowance_each_m=.02)
 b=info['entry_review']['gross_bounds_m'];review={'opening_width_m':width,'leaf_width_m':leaf_width,'frame_allowance_each_m':.02,'left_wall_m':round(x-width/2-b[0],6),'right_wall_m':round(b[2]-x-width/2,6),'previous_width_m':old_width,'basis':'live Archisketch scaled entrance instance1000mm; side offsets from room inner faces','as_built_verified':False}
 if variant=='basic':assert abs(review['left_wall_m']-.479)<1e-6 and abs(review['right_wall_m']-.503)<1e-6
 info['entry_review']['door_review']=review
 info['navigation_zones']=zones(info)
 info['navigation_default']='living'
 bpy.context.view_layer.update()
 intentional=set(door['mesh_names']+accessories)
 unexpected=[name for name,h in before.items() if name not in intentional and (name not in bpy.data.objects or geo(bpy.data.objects[name])!=h)]
 assert not unexpected,unexpected
 assert json.dumps(info['rooms'],sort_keys=True)==old_rooms
 assert abs(envelope(bpy.data.objects['door-00/leaf'])[3]-envelope(bpy.data.objects['door-00/leaf'])[0]-.96)<1e-6
 # Persist high-quality final-render settings without imposing them on interactive editing.
 scene.cycles.samples=2048;scene.cycles.preview_samples=128;scene.cycles.use_denoising=True;scene.cycles.use_preview_denoising=True
 scene.cycles.denoiser='OPENIMAGEDENOISE';scene.cycles.preview_denoiser='OPENIMAGEDENOISE';scene.cycles.preview_denoising_start_sample=16
 scene.cycles.use_adaptive_sampling=True;scene.cycles.adaptive_threshold=.01
 exported=[o for o in scene.objects if o.type=='MESH' and o.get('component')]
 bpy.ops.object.select_all(action='DESELECT')
 for o in exported:o.hide_set(False);o.select_set(True)
 for o in bpy.data.collections['06_Interiors'].objects:
  if o.type=='EMPTY':o.select_set(True)
 glb=out/(stem+'.glb');bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_extras=True,export_yup=True,export_cameras=False,export_lights=False)
 bpy.ops.object.select_all(action='DESELECT')
 for o in exported:
  if o.get('component')=='ceiling':o.hide_render=True;o.hide_set(True)
 scene['revision']=REV;scene['entrance_width_m']=width
 blend=out/(stem+'.blend');bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(blend))
 info.update(finish_revision=REV,mesh_count=len(exported),blend_sha256=sha(blend),glb_sha256=sha(glb))
 info['kitchen_refinement']['web_activation']='included in entry-v4'
 info['entry_correction']={'parent_revision':'archisketch-kitchen-v3','parent_blend_sha256':sha(src/(stem+'.blend')),'source_evidence':str(EVIDENCE.relative_to(ROOT)),'source_evidence_sha256':sha(EVIDENCE),'old_opening':previous,'review':review}
 dump(out/'model-info.json',info)
 dump(out/'verification.json',{'passed':True,'variant':variant,'unchanged_meshes':len(before)-len(intentional),'unexpected_changes':unexpected,'changed_meshes':sorted(intentional),'restored_wall_meshes':[o.name for o in made],'restored_wall_area_m2':restored.area,'room_geometry_unchanged':True,'navigation_zones_cover_source_room':True,'navigation_zones_overlap_m2':0,'entrance':review,'render_max_samples':2048,'preview_max_samples':128,'render_performed':False})
 print(json.dumps({'variant':variant,'path':str(out),'entrance':review,'unchanged_meshes':len(before)-len(intentional)},ensure_ascii=False),flush=True)

if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('--variant',choices=['basic','expanded','both'],default='both');args=a.parse_args()
 for v in ['basic','expanded'] if args.variant=='both' else [args.variant]:build(v)
