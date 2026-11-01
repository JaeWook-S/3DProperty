#!/usr/bin/env python3
"""Correct audited opening widths without changing room/furniture geometry.

CPU geometry/export only. Source snapshots and active models are read-only.
The candidate needs independent GLB and browser validation before activation.
"""
import argparse, copy, hashlib, json, struct
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from shapely import constrained_delaunay_triangles, set_precision
from shapely.geometry import Polygon, box
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from prepare_112a_uv_p0 import geometry, uv_snapshot, object_state, plain, bad_uv_faces

ROOT=Path(__file__).resolve().parents[2]
WORK=ROOT.parent/'AisideProject/realestate-spatial-ai/experiments/service-readiness/2026-10-23'
LIVE=WORK/'archisketch-live/20261023T130327Z'
REV='archisketch-metric-v1'
CASES={
 '112a-basic':('112a','basic','archisketch-uv-p0-v1',LIVE,['window-17']),
 '112a-expanded':('112a','expanded','archisketch-uv-p0-v1',LIVE/'112A-expanded',['door-07']),
 '168c-expanded':('168c','expanded','archisketch-kitchen-detail-v1',LIVE/'168C-expanded',['sliding-11','window-20']),
}

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def dump(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
def read_glb(path):
 blob=path.read_bytes();jsonlen,kind=struct.unpack_from('<II',blob,12)
 assert kind==0x4e4f534a
 doc=json.loads(blob[20:20+jsonlen]);binpos=20+jsonlen
 length,kind=struct.unpack_from('<II',blob,binpos);assert kind==0x004e4942
 return doc,blob[binpos+8:binpos+8+length]
def preserve_authored_materials(candidate,parent):
 # Blender may repack an authored MR PNG on re-export. Keep the exact accepted
 # material/image bytes, while retaining the candidate's geometry and UV data.
 doc,data=read_glb(candidate);old,olddata=read_glb(parent)
 byname={m['name']:i for i,m in enumerate(old['materials'])}
 assert len(byname)==len(old['materials']) and set(byname)=={m['name'] for m in doc['materials']}
 remap={i:byname[m['name']] for i,m in enumerate(doc['materials'])}
 for mesh in doc['meshes']:
  for primitive in mesh['primitives']:
   if 'material' in primitive:primitive['material']=remap[primitive['material']]
 imageviews={image['bufferView'] for image in doc.get('images',[])}
 used={a['bufferView'] for a in doc.get('accessors',[]) if 'bufferView' in a}
 assert not imageviews.intersection(used)
 assert all('sparse' not in a for a in doc.get('accessors',[]))
 assert not any('extensions' in v for v in doc['bufferViews'])
 chunks=bytearray();views=[];viewmap={}
 def append(view,source):
  while len(chunks)%4:chunks.append(0)
  offset=view.get('byteOffset',0);length=view['byteLength'];result=copy.deepcopy(view)
  result.update(buffer=0,byteOffset=len(chunks));chunks.extend(source[offset:offset+length]);views.append(result)
  return len(views)-1
 for i,v in enumerate(doc['bufferViews']):
  if i not in imageviews:viewmap[i]=append(v,data)
 for a in doc.get('accessors',[]):
  if 'bufferView' in a:a['bufferView']=viewmap[a['bufferView']]
 doc['materials']=copy.deepcopy(old['materials']);doc['textures']=copy.deepcopy(old.get('textures',[]));doc['samplers']=copy.deepcopy(old.get('samplers',[]));doc['images']=copy.deepcopy(old.get('images',[]))
 for image in doc['images']:image['bufferView']=append(old['bufferViews'][image['bufferView']],olddata)
 doc['bufferViews']=views;doc['buffers']=[{'byteLength':len(chunks)}]
 for key in ['extensionsUsed','extensionsRequired']:
  if key in old or key in doc:doc[key]=sorted(set(old.get(key,[])+doc.get(key,[])))
 encoded=json.dumps(doc,separators=(',',':'),ensure_ascii=False).encode();encoded+=b' '*((-len(encoded))%4)
 chunks.extend(b'\0'*((-len(chunks))%4))
 total=12+8+len(encoded)+8+len(chunks)
 candidate.write_bytes(struct.pack('<III',0x46546c67,2,total)+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(chunks),0x004e4942)+chunks)
def polys(g):
 if g.is_empty:return []
 return [g] if g.geom_type=='Polygon' else [p for c in g.geoms for p in polys(c)]
def world_vertices(obj):return [obj.matrix_world@v.co for v in obj.data.vertices]
def bounds(obj):
 v=world_vertices(obj)
 return [min(p[a] for p in v) for a in range(3)]+[max(p[a] for p in v) for a in range(3)]
def projected_shape(obj):
 obj.data.calc_loop_triangles();vertices=world_vertices(obj)
 parts=[Polygon([(vertices[i].x,-vertices[i].y) for i in t.vertices]) for t in obj.data.loop_triangles]
 return unary_union([p for p in parts if p.area>1e-12])
def cut(opening,width,depth):
 x,z=opening['center_m']
 return box(x-width/2,z-depth,x+width/2,z+depth) if opening['axis']=='x' else box(x-depth,z-width/2,x+depth,z+width/2)
def uv_metric(obj):
 layer=obj.data.uv_layers.active or obj.data.uv_layers.new(name='MetricUV')
 normals=obj.matrix_world.to_3x3().inverted().transposed()
 for face in obj.data.polygons:
  normal=(normals@face.normal).normalized();axis=max(range(3),key=lambda a:abs(normal[a]))
  mat=obj.data.materials[face.material_index] if obj.data.materials else None
  tile=float(mat.get('texture_repeat_m',1.2)) if mat else 1.2
  for i in face.loop_indices:
   p=obj.matrix_world@obj.data.vertices[obj.data.loops[i].vertex_index].co
   layer.data[i].uv=(p.x/tile,-p.y/tile) if axis==2 else ((-p.y/tile,p.z/tile) if axis==0 else (p.x/tile,p.z/tile))
 assert bad_uv_faces(obj)==[],obj.name

def prism_mesh(name,shape,z0,z1):
 # Snap reconstructed wall boundaries before triangulation. The accepted floor
 # polygons stay untouched. A10um grid removes float32-induced sliver contours
 # without deleting edges/faces after the closed extrusion has been built.
 shape=set_precision(shape,1e-5,mode='valid_output')
 points=[];indices={};faces=[]
 def idx(p):
  key=tuple(round(float(v),9) for v in p)
  if key not in indices:indices[key]=len(points);points.append(key)
  return indices[key]
 rings=[];triangles=[]
 for poly in polys(shape):
  poly=orient(poly,sign=1)
  for ring in [poly.exterior,*poly.interiors]:rings.append([idx(p) for p in list(ring.coords)[:-1]])
  for tri in constrained_delaunay_triangles(poly).geoms:
   triangles.append([idx(p) for p in list(orient(tri,sign=1).exterior.coords)[:3]])
 n=len(points)
 for a,b,c in triangles:faces.extend([(a,b,c),(a+n,c+n,b+n)])
 for ring in rings:
  for i,a in enumerate(ring):
   b=ring[(i+1)%len(ring)];faces.append((a,a+n,b+n,b))
 mesh=bpy.data.meshes.new(name)
 mesh.from_pydata([(x,-z,y) for y in (z0,z1) for x,z in points],[],faces);mesh.update()
 return mesh

def wall_sampler(objects):
 verts=[];faces=[];mats=[];slots=[]
 for o in objects:
  offset=len(verts);verts.extend(world_vertices(o))
  for f in o.data.polygons:
   faces.append([offset+i for i in f.vertices]);mat=o.data.materials[f.material_index]
   if mat not in slots:slots.append(mat)
   mats.append(slots.index(mat))
 return BVHTree.FromPolygons(verts,faces,all_triangles=False),mats,slots

def finish_wall_mesh(mesh,sampler):
 bvh,indices,slots=sampler
 for mat in slots:mesh.materials.append(mat)
 for face in mesh.polygons:
  near=bvh.find_nearest(face.center)
  face.material_index=indices[near[2]] if near[2] is not None else 0

def resize_axis(obj,axis,new_width,new_center):
 b=bounds(obj);old_center=(b[axis]+b[axis+3])/2;old_width=b[axis+3]-b[axis]
 matrix=obj.matrix_world.copy();inverse=matrix.inverted()
 for vertex in obj.data.vertices:
  p=matrix@vertex.co;p[axis]=new_center+(p[axis]-old_center)*new_width/old_width;vertex.co=inverse@p
 obj.data.update();uv_metric(obj)

def build(case):
 unit,variant,parent,live,ids=CASES[case]
 base=ROOT/'assets/models/acro-river-park'/unit
 src=base/parent/variant;out=base/REV/variant;out.mkdir(parents=True,exist_ok=True)
 stem=f'acro{unit}-{variant}';info=json.loads((src/'model-info.json').read_text());original=copy.deepcopy(info)
 parent_files={str(p.relative_to(ROOT)):sha(p) for p in [src/(stem+'.blend'),src/(stem+'.glb'),src/'model-info.json']}
 layout_path=live/'furniture-layout.json';source_items={o['archiId']:o for o in json.loads(layout_path.read_text())['floorplans'][0]['items']}
 spec_path=ROOT/f'tools/blender/specs/acro{unit}-{variant}-archisketch-v{2 if unit=="112a" else 1}.json';spec=json.loads(spec_path.read_text())
 bpy.ops.wm.open_mainfile(filepath=str(src/(stem+'.blend')),use_scripts=False);scene=bpy.context.scene;bpy.context.view_layer.update()
 meshes=[o for o in scene.objects if o.type=='MESH'];before={o.name:(geometry(o),uv_snapshot(o),object_state(o)) for o in meshes}
 visibility={o.name:(o.hide_get(),o.hide_render,o.select_get()) for o in scene.objects}
 material_names=set(bpy.data.materials.keys());material_props={m.name:plain(dict(m.items())) for m in bpy.data.materials}
 changed=set();added=[];reviews=[]
 regions=unary_union([Polygon(r['polygon_m']) for r in spec['rooms']]);excluded=unary_union([Polygon(r['polygon_m']) for r in spec['rooms'] if r['kind']=='excluded'])
 wall_plan=regions.buffer(spec['wall_inference']['external_buffer_m'],join_style='mitre').difference(regions)
 depth=info['wall_inference'].get('opening_cut_half_depth_m',.25)
 for id in ids:
  op=next(o for o in info['openings'] if o['id']==id);old=copy.deepcopy(op)
  item=source_items[op['source_id']];width=item['dimensions']['width']/1000
  assert abs(width-op['width_m'])>.05 and op['dimension_basis']=='source_polygon_opening_breakpoints',(id,width,op['dimension_basis'])
  assert all(abs(a-b)<=.51 for a,b in zip(item['position'],op['source_position_mm'])),(id,'source position changed beyond summary millimeter rounding')
  oldcut,newcut=cut(op,op['width_m'],depth),cut(op,width,depth)
  assert newcut.intersection(excluded).area<1e-8,(id,'would cut a protected structure')
  removal=newcut.difference(oldcut);restored=wall_plan.intersection(oldcut.difference(newcut))
  low,high=op['bottom_m'],op['bottom_m']+op['height_m']
  walls=[o for o in scene.objects if o.type=='MESH' and o.get('component')=='wall'];sampler=wall_sampler(walls)
  removed_volume=0
  for obj in walls:
   b=bounds(obj)
   if b[5]<=low+1e-7 or b[2]>=high-1e-7:continue
   shape=projected_shape(obj);overlap=shape.intersection(removal)
   if overlap.area<1e-9:continue
   assert b[2]>=low-1e-6 and b[5]<=high+1e-6,(obj.name,'unexpected height stratum')
   replacement=shape.difference(removal);assert replacement.area>1e-9
   new_mesh=prism_mesh(obj.name+'/metric',replacement,b[2],b[5]);finish_wall_mesh(new_mesh,sampler)
   oldmesh=obj.data;obj.data=new_mesh;obj.matrix_world.identity();uv_metric(obj)
   error=projected_shape(obj).symmetric_difference(replacement).area
   assert error<2e-5,(obj.name,'float32 wall reconstruction error m2',error,'before',shape.area,'after',replacement.area)
   changed.add(obj.name);removed_volume+=overlap.area*(b[5]-b[2])
  # Reinsert only original inferred wall bands, excluding all other apertures.
  restored_volume=0;newwallnames=[]
  levels=sorted(set([low,high]+[v for o in info['openings'] for v in [o['bottom_m'],o['bottom_m']+o['height_m']] if low<v<high]))
  for i,(bottom,top) in enumerate(zip(levels,levels[1:])):
   mid=(bottom+top)/2
   holes=[cut(o,o['width_m'],depth) for o in info['openings'] if o['id']!=id and o['bottom_m']<mid<o['bottom_m']+o['height_m']]
   patch=restored.difference(unary_union(holes))
   if patch.area<1e-9:continue
   name=f'Metric wall correction/{id}/{i:02d}';mesh=prism_mesh(name,patch,bottom,top);finish_wall_mesh(mesh,sampler)
   obj=bpy.data.objects.new(name,mesh);bpy.data.collections['02_Walls'].objects.link(obj)
   for k,v in dict(component='wall',collision=True,inferred_wall=True,layer_bottom_m=bottom,metric_correction=id).items():obj[k]=v
   uv_metric(obj);added.append(name);newwallnames.append(name);restored_volume+=patch.area*(top-bottom)
  x,z=op['center_m'];axis=0 if op['axis']=='x' else 1;center=x if axis==0 else -z
  # Local u is plan x or plan z; Blender uses negative plan z on axis1.
  sign=1 if axis==0 else -1
  def part(name,length,u):
   obj=bpy.data.objects[id+'/'+name];resize_axis(obj,axis,length,center+sign*u);changed.add(obj.name)
  if op['kind']=='door':
   frame=(op['width_m']-op['leaf_width_m'])/2;leaf=width-2*frame
   part('jamb-left',frame,-width/2+frame/2);part('jamb-right',frame,width/2-frame/2)
   part('head',leaf,0);part('leaf',leaf,0);bpy.data.objects[id+'/leaf']['nominal_width_m']=leaf
   for name in info.get('door_accessories',{}).get(id,[]):
    obj=bpy.data.objects[name];b=bounds(obj);mid=(b[axis]+b[axis+3])/2;u=(mid-center)/sign
    # Preserve physical distance to the free leaf edge and hardware dimensions.
    newu=u+(1 if u>=0 else -1)*(leaf-op['leaf_width_m'])/2
    resize_axis(obj,axis,b[axis+3]-b[axis],center+sign*newu);changed.add(name)
   op['leaf_width_m']=round(leaf,6)
  else:
   oldclear=op.get('clear_span_m',[op['width_m']-.1,op['height_m']-.1]);frame=(op['width_m']-oldclear[0])/2;clear=width-2*frame
   part('frame-left',frame,-width/2+frame/2);part('frame-right',frame,width/2-frame/2)
   part('frame-bottom',clear,0);part('frame-top',clear,0)
   part('glass-0',clear/2,-clear/4);part('glass-1',clear/2,clear/4)
   if 'clear_span_m' in op:op['clear_span_m']=[clear,oldclear[1]]
   assert 'sliding_operation' not in op,'Explicit hardware requires separate reviewed travel update'
  op.update(width_m=width,dimension_basis='scaled_editor_item_width',source_scaled_item_dimensions=item['dimensions'],previous_inferred_width_m=old['width_m'],source_width_review={'source_layout_sha256':sha(layout_path),'source_id':op['source_id'],'policy':'placed instance width overrides nearest room vertices','independent_as_built_validation':False})
  review={'id':id,'old_width_m':old['width_m'],'new_width_m':width,'source_id':op['source_id'],'source_layout_sha256':sha(layout_path),'removed_wall_volume_m3':removed_volume,'restored_wall_volume_m3':restored_volume,'added_wall_meshes':newwallnames,'height_center_axis_unchanged':True}
  expected_removed=0
  for bottom,top in zip(levels,levels[1:]):
   mid=(bottom+top)/2
   other_holes=unary_union([cut(o,o['width_m'],depth) for o in original['openings'] if o['id']!=id and o['bottom_m']<mid<o['bottom_m']+o['height_m']])
   expected_removed+=wall_plan.intersection(removal).difference(other_holes).area*(top-bottom)
  review['expected_removed_wall_volume_m3']=expected_removed
  assert abs(removed_volume-expected_removed)<2e-5,(id,removed_volume,expected_removed)
  reviews.append(review)
 bpy.context.view_layer.update()
 for name,state in before.items():
  if name not in changed:
   obj=bpy.data.objects[name];assert state==(geometry(obj),uv_snapshot(obj),object_state(obj)),('unexpected change',name)
 for field in ['rooms','fixtures','navigation_zones','unit_area','ceiling_height_m']:
  assert info.get(field)==original.get(field),field
 assert material_names==set(bpy.data.materials.keys())
 assert material_props=={m.name:plain(dict(m.items())) for m in bpy.data.materials}
 exported=[o for o in scene.objects if o.type=='MESH' and o.get('component')]
 bpy.ops.object.select_all(action='DESELECT')
 for obj in exported:obj.hide_set(False);obj.select_set(True)
 for obj in bpy.data.collections['06_Interiors'].objects:
  if obj.type=='EMPTY':obj.select_set(True)
 glb=out/(stem+'.glb');bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_extras=True,export_yup=True,export_cameras=False,export_lights=False)
 preserve_authored_materials(glb,src/(stem+'.glb'))
 bpy.ops.object.select_all(action='DESELECT')
 for obj in scene.objects:
  if obj.name in visibility:
   hidden,render,selected=visibility[obj.name];obj.hide_set(hidden);obj.hide_render=render;obj.select_set(selected)
 scene['revision']=REV;scene.cycles.device='CPU';bpy.context.preferences.filepaths.save_version=0
 blend=out/(stem+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(blend))
 info.update(finish_revision=REV,mesh_count=len(exported),blend_sha256=sha(blend),glb_sha256=sha(glb))
 info['metric_revision']={'parent_revision':parent,'source_files':parent_files,'opening_reviews':reviews,'rooms_fixtures_units_preserved':True,'source_model_not_as_built':True}
 dump(out/'model-info.json',info)
 verification={'passed':True,'candidate':case,'revision':REV,'source_files':parent_files,'files':{p.name:sha(p) for p in [blend,glb,out/'model-info.json']},'changed_meshes':sorted(changed),'new_wall_meshes':added,'unchanged_meshes':len(before)-len(changed),'protected_rooms_fixtures_metadata':True,'material_names_and_extras_preserved':True,'opening_reviews':reviews,'GPU_used':False,'render_performed':False,'browser_validation':'pending','active_web_changed':False}
 assert all(sha(ROOT/p)==h for p,h in parent_files.items())
 dump(out/'metric-verification.json',verification);print(json.dumps(verification,ensure_ascii=False),flush=True)

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--case',choices=[*CASES,'all'],default='all');args=parser.parse_args()
 for case in CASES if args.case=='all' else [args.case]:build(case)
