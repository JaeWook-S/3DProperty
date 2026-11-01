#!/usr/bin/env python3
"""UV-only candidate from circulation-v5. Never changes active variants or source assets."""
import argparse,hashlib,json
from pathlib import Path
import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'assets/models/acro-river-park/112a'
PARENT='archisketch-circulation-v5'
REV='archisketch-uv-p0-v1'
NEW_UV=['Entry wall correction/00','Entry wall correction/01','Sink detail / recessed bowl']
FAUCET='Sink detail / curved faucet'
TILE_METERS=1.2

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def plain(v):
 if isinstance(v,(str,int,float,bool)) or v is None:return v
 if hasattr(v,'items'):return {str(k):plain(x) for k,x in v.items()}
 return [plain(x) for x in v]
def digest(v):return hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def dump(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def geometry(o):
 m=o.data
 return digest({'matrix':plain(o.matrix_world),'verts':[plain(v.co) for v in m.vertices],'edges':[list(e.vertices) for e in m.edges],'faces':[list(p.vertices) for p in m.polygons],'loops':[(l.vertex_index,l.edge_index) for l in m.loops],'smooth':[p.use_smooth for p in m.polygons],'material_indices':[p.material_index for p in m.polygons],'corner_normals':[plain(n.vector) for n in m.corner_normals]})
def object_state(o):return digest({'name':o.name,'type':o.type,'parent':o.parent.name if o.parent else None,'matrix':plain(o.matrix_world),'props':plain(dict(o.items())),'mesh_props':plain(dict(o.data.items())) if o.type=='MESH' else None,'materials':[m.name if m else None for m in o.data.materials] if o.type=='MESH' else None})
def uv_snapshot(o):return {layer.name:[list(x.uv) for x in layer.data] for layer in o.data.uv_layers}
def bad_uv_faces(o):
 m=o.data;m.calc_loop_triangles();layer=m.uv_layers.active;bad=[]
 if not layer:return None
 for t in m.loop_triangles:
  a,b,c=[layer.data[i].uv for i in t.loops]
  det=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)
  if t.area>1e-12 and abs(det)<1e-10:bad.append(t.polygon_index)
 return bad

def metric_projection(o,layer,faces):
 # Same meter-valued dominant-plane mapping as the existing material generator.
 # It is a tiling UV, not a unique baking atlas. All original topology is retained.
 normal_matrix=o.matrix_world.to_3x3().inverted().transposed()
 for i in faces:
  face=o.data.polygons[i];normal=(normal_matrix@face.normal).normalized();axis=max(range(3),key=lambda j:abs(normal[j]))
  for j in face.loop_indices:
   v=o.matrix_world@o.data.vertices[o.data.loops[j].vertex_index].co
   layer.data[j].uv=(v.x/TILE_METERS,-v.y/TILE_METERS) if axis==2 else ((-v.y/TILE_METERS,v.z/TILE_METERS) if axis==0 else (v.x/TILE_METERS,v.z/TILE_METERS))

def build(variant):
 src=BASE/PARENT/variant;out=BASE/REV/variant;out.mkdir(parents=True,exist_ok=True);stem=f'acro112a-{variant}'
 paths=[src/(stem+ext) for ext in ['.blend','.glb']]+[src/'model-info.json'];source_hashes={str(p.relative_to(ROOT)):sha(p) for p in paths}
 original=json.loads(paths[2].read_text())
 bpy.ops.wm.open_mainfile(filepath=str(paths[0]),use_scripts=False);scene=bpy.context.scene;bpy.context.view_layer.update()
 objects=list(scene.objects);meshes=[o for o in objects if o.type=='MESH']
 old_geometry={o.name:geometry(o) for o in meshes};old_state={o.name:object_state(o) for o in objects};old_uv={o.name:uv_snapshot(o) for o in meshes}
 old_mats={m.name:plain(dict(m.items())) for m in bpy.data.materials}
 visibility={o.name:(o.hide_get(),o.hide_render,o.select_get()) for o in objects}
 changes=[]
 for name in NEW_UV:
  o=bpy.data.objects[name];assert not o.data.uv_layers,name
  layer=o.data.uv_layers.new(name='MetricUV');metric_projection(o,layer,range(len(o.data.polygons)))
  assert bad_uv_faces(o)==[],(name,bad_uv_faces(o))
  changes.append({'name':name,'operation':'add_uv0_metric_dominant_plane','faces':len(o.data.polygons),'meters_per_uv_tile':TILE_METERS,'scale_basis':'existing design UV convention, not measured surface sample','unique_atlas':False})
 o=bpy.data.objects[FAUCET];bad=bad_uv_faces(o);assert len(bad)==16,bad
 faces=sorted(set(bad));assert len(faces)==16,faces
 cap_loops={l for i in faces for l in o.data.polygons[i].loop_indices}
 assert all(len(o.data.polygons[i].vertices)==3 and abs(o.data.polygons[i].normal.z)>.999 for i in faces),'Expected triangulated horizontal end caps only'
 assert len({round(o.data.polygons[i].center.z,6) for i in faces})==2,'Expected two cap planes'
 before=uv_snapshot(o);layer=o.data.uv_layers.active;metric_projection(o,layer,faces)
 assert bad_uv_faces(o)==[],bad_uv_faces(o)
 after=uv_snapshot(o)
 for name,values in before.items():
  for i,value in enumerate(values):
   if name!=layer.name or i not in cap_loops:assert value==after[name][i],(name,i)
 changes.append({'name':FAUCET,'operation':'repair_degenerate_end_caps_only','polygon_indices':faces,'loops_changed':len(cap_loops),'degenerate_triangles_before':len(bad),'degenerate_triangles_after':0,'preserved':'all non-cap UV loops and all other UV layers','meters_per_uv_tile':TILE_METERS,'scale_basis':'assumed metric cap projection; no material map currently uses this UV'})
 changed={x['name'] for x in changes}
 assert old_geometry=={o.name:geometry(o) for o in meshes}
 assert old_state=={o.name:object_state(o) for o in objects}
 assert old_mats=={m.name:plain(dict(m.items())) for m in bpy.data.materials}
 for o in meshes:
  if o.name not in changed:assert old_uv[o.name]==uv_snapshot(o),o.name
 exported=[o for o in meshes if o.get('component')]
 bpy.ops.object.select_all(action='DESELECT')
 for o in exported:o.hide_set(False);o.select_set(True)
 for o in bpy.data.collections['06_Interiors'].objects:
  if o.type=='EMPTY':o.select_set(True)
 glb=out/(stem+'.glb');bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_extras=True,export_yup=True,export_cameras=False,export_lights=False)
 bpy.ops.object.select_all(action='DESELECT')
 for o in objects:
  hidden,render_hidden,selected=visibility[o.name];o.hide_set(hidden);o.hide_render=render_hidden;o.select_set(selected)
 scene['revision']=REV
 bpy.context.preferences.filepaths.save_version=0;blend=out/(stem+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(blend))
 info=dict(original);info.update(finish_revision=REV,blend_sha256=sha(blend),glb_sha256=sha(glb))
 allowed={'finish_revision','blend_sha256','glb_sha256'};protected=lambda d:{k:v for k,v in d.items() if k not in allowed}
 assert protected(info)==protected(original)
 assert source_hashes=={str(p.relative_to(ROOT)):sha(p) for p in paths}
 dump(out/'model-info.json',info)
 dump(out/'uv-preservation.json',{'passed':True,'candidate_revision':REV,'variant':variant,'source_files_sha256':source_hashes,'source_files_unchanged':True,'geometry_meshes_equal':len(meshes),'object_metadata_transforms_equal':len(objects),'material_names_properties_equal':True,'unmodified_mesh_uv_equal':len(meshes)-len(changed),'changes':changes,'metadata_identity_fields_changed':sorted(allowed),'protected_metadata_sha256':digest(protected(info)),'protected_geometry_sha256':digest(old_geometry),'modeling_metadata_including_rooms_fixtures_openings_collision_equal':True,'new_texture_assets':0,'active_web_changed':False,'scene_revision_changed_only_for_candidate_identity':True,'render_performed':False})
 print(json.dumps({'variant':variant,'candidate':str(out),'geometry_equal':len(meshes),'changes':changes}),flush=True)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--variant',choices=['basic','expanded','both'],default='both');a=p.parse_args()
 for v in ['basic','expanded'] if a.variant=='both' else [a.variant]:build(v)
