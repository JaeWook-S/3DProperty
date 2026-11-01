#!/usr/bin/env python3
"""Apply a VR-guided finish study without changing the reviewed v2 structure.
Uses existing project-generated oak/stone images; source VR is qualitative evidence.
"""
import bpy, json, math, hashlib, argparse
from pathlib import Path
from mathutils import Vector
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--skip-render',action='store_true');args=p.parse_args()
source=ROOT/'assets/models/acro-river-park/168c/structural-v2/expanded'
out=ROOT/'assets/models/acro-river-park/168c/finishes-v1/expanded';out.mkdir(parents=True,exist_ok=True)
layout=json.loads((ROOT/'tools/blender/specs/acro168c-expanded-layout-v2.json').read_text())
rooms=json.loads((source/'rooms.json').read_text());ops=json.loads((source/'openings.json').read_text())
cal=layout['calibration'];mx=lambda x:float(np.interp(x,cal['x_px'],cal['x_m']));my=lambda y:float(np.interp(y,cal['y_px'],cal['y_m']))
def save(name,data): (out/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
def bounds(o):
 vs=[o.matrix_world@v.co for v in o.data.vertices]
 return [[min(v[i] for v in vs) for i in range(3)],[max(v[i] for v in vs) for i in range(3)]]
bpy.ops.wm.open_mainfile(filepath=str(source/'acro168c-expanded-structure.blend'));bpy.context.view_layer.update()
scene=bpy.context.scene;scene['revision']='finishes-v1';scene['structure_revision']='structural-v2'
original={o.name:bounds(o) for o in scene.objects if o.type=='MESH' and o.get('component')!='annotation'}
original_collections=[c for c in bpy.data.collections if c.name[:2] in ['01','02','03','04','05','06','07']]
finish=bpy.data.collections.new('08_Finishes');scene.collection.children.link(finish)
lamps=bpy.data.collections.new('09_Lighting');scene.collection.children.link(lamps)
images={k:bpy.data.images.load(str(ROOT/'assets/materials/generated-v1'/v),check_existing=True) for k,v in [('stone','limestone.png'),('oak','oak.png')]}
for im in images.values():im.pack()
def mat(name,color,rough=.6,metal=0,texture=None,emission=None):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True;m['texture_repeat_m']=1.2
 bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=rough;bs.inputs['Metallic'].default_value=metal
 if texture:
  node=m.node_tree.nodes.new('ShaderNodeTexImage');node.image=images[texture];m.node_tree.links.new(node.outputs['Color'],bs.inputs['Base Color'])
 if emission:
  bs.inputs['Emission Color'].default_value=(*color,1);bs.inputs['Emission Strength'].default_value=emission
 return m
stone=mat('168C / polished limestone floor',(0.76,.70,.57),.26,texture='stone')
oak=mat('168C / Bedroom light oak',(.62,.42,.23),.38,texture='oak')
wall=mat('168C / Warm ivory plaster',(.81,.79,.72),.82)
gray=mat('168C / bedroom warm gray',(.46,.45,.43),.78)
wallstone=mat('168C / polished limestone wall',(.76,.72,.64),.34,texture='stone')
bath=mat('168C / Travertine bathroom',(.52,.53,.50),.48,texture='stone')
white=mat('168C / ceiling warm white',(.88,.87,.82),.86)
wood=mat('168C / Smoked oak door',(.26,.20,.14),.42,texture='oak')
cream=mat('168C / Lacquer warm white frame',(.78,.76,.69),.36,.1)
charcoal=mat('168C / charcoal kitchen',(.060,.067,.073),.29,.04)
metal=mat('168C / brushed nickel',(.54,.58,.6),.27,.82)
grout=mat('168C / fine stone joints',(.47,.44,.38),.7)
lightmat=mat('168C / warm light diffuser',(1,.84,.63),.5,emission=2)
glass=mat('168C / clear glazing',(.86,.94,.96),.075)
bs=glass.node_tree.nodes.get('Principled BSDF');bs.inputs['Transmission Weight'].default_value=.3;bs.inputs['Alpha'].default_value=.2;bs.inputs['IOR'].default_value=1.45
glass.diffuse_color=(.86,.94,.96,.2);glass.surface_render_method='DITHERED'

def uv_project(o):
 if o.type!='MESH':return
 layer=o.data.uv_layers.active or o.data.uv_layers.new(name='MetricUV')
 for face in o.data.polygons:
  normal=face.normal;axis=max(range(3),key=lambda i:abs(normal[i]))
  for loop in face.loop_indices:
   v=o.matrix_world@o.data.vertices[o.data.loops[loop].vertex_index].co
   uv=(v.x/1.2,-v.y/1.2) if axis==2 else ((-v.y/1.2,v.z/1.2) if axis==0 else (v.x/1.2,v.z/1.2))
   layer.data[loop].uv=uv

def inside(x,y,poly):
 hit=False
 for i,(a,b) in enumerate(poly):
  c,d=poly[i-1]
  if (b>y)!=(d>y) and x<(c-a)*(y-b)/(d-b)+a:hit=not hit
 return hit
for r in rooms:
 a,b,c,d=r['reference_bounds_m'];r['polygon_m']=[[mx(x),my(y)] for x,y in r['polygon_px']] if r.get('polygon_px') else [[a,b],[c,b],[c,d],[a,d]]
wood_rooms={'bedroom-1','bedroom-2','bedroom-3','primary-bedroom','dressing-room','dressing-inner'}
def room_at(x,y):return next((r for r in rooms if inside(x,y,r['polygon_m'])),None)
def wall_finish(x,y):
 r=room_at(x,y)
 if r and r['id'] in ['bedroom-2','bedroom-3']:return gray
 if r and r['kind']=='wet':return bath
 if r and r['id'] in ['living','hall','entry']:return wallstone
 return wall
for o in list(scene.objects):
 if o.type!='MESH' or o.get('component')=='annotation':continue
 component=o.get('component');material=None
 if component in ['wall','wall_pier']:
  o.data.materials.clear()
  for m in [wall,gray,wallstone,bath]:o.data.materials.append(m)
  for face in o.data.polygons:
   pt=o.matrix_world@face.center;normal=o.matrix_world.to_3x3()@face.normal
   chosen=wall_finish(pt.x+normal.x*.12,-pt.y-normal.y*.12)
   face.material_index=[wall,gray,wallstone,bath].index(chosen)
 elif component=='ceiling':material=white
 elif component=='door_leaf':material=glass if o.get('opening_id')=='bathroom-1-shower-door' else wood
 elif component in ['door_frame','passage_frame']:material=wood
 elif component in ['window_frame','sliding_frame']:material=cream
 elif component in ['window_span','sliding_panel','glass_partition']:material=glass
 elif component=='door_handle':material=metal
 elif component=='fixed_storage':
  if o.name.startswith('kitchen-'):
   if any(s in o.name for s in ['fridge-door','fridge-handle','fridge-header','sink-rim','tap-','hood','burner']):material=metal
   elif 'countertop' in o.name:material=mat('168C / kitchen stone '+o.name,(.14,.13,.115),.24)
   elif any(s in o.name for s in ['basin','hob','plinth']):pass
   else:material=charcoal
  else:material=wood
 if material:o.data.materials.clear();o.data.materials.append(material)
 uv_project(o)
# Rebuild only the slab's top surfaces so wood/stone share the exact finished floor z=0.
floor=next(o for o in scene.objects if o.get('component')=='floor')
verts=[tuple(v.co) for v in floor.data.vertices];faces=[tuple(p.vertices) for p in floor.data.polygons if p.normal.z<.5]
mesh=bpy.data.meshes.new('Slab bottom and edges');mesh.from_pydata(verts,[],faces);mesh.materials.append(stone);mesh.update();floor.data=mesh
outline=[[mx(x),my(y)] for x,y in layout['outline_px']]
xs={p[0] for p in outline};ys={p[1] for p in outline}
for r in rooms:
 xs.update(p[0] for p in r['polygon_m']);ys.update(p[1] for p in r['polygon_m'])
xs.update(float(x) for x in np.arange(0,20.5,.6));ys.update(float(y) for y in np.arange(0,11.51,.6));xs=sorted(xs);ys=sorted(ys)
batches={}
def quad(batch,a,b,c,d,mi):
 if c-a<1e-8 or d-b<1e-8:return
 v,f,materials=batch;n=len(v);v.extend([(a,-b,0),(a,-d,0),(c,-d,0),(c,-b,0)]);f.append((n,n+1,n+2,n+3));materials.append(mi)
for a,c in zip(xs,xs[1:]):
 for b,d in zip(ys,ys[1:]):
  x,y=(a+c)/2,(b+d)/2
  if not inside(x,y,outline):continue
  r=room_at(x,y);rid=r['id'] if r else 'connections';batch=batches.setdefault(rid,([],[],[]))
  if rid in wood_rooms:quad(batch,a,b,c,d,1)
  else:
   idx=2 if r and r['kind']=='wet' else 0
   # Only the 600mm design grid gets a fine joint; room segmentation creates no false joints.
   gap=.0012
   a1=a+(gap if abs(a/.6-round(a/.6))<1e-6 else 0);c1=c-(gap if abs(c/.6-round(c/.6))<1e-6 else 0)
   b1=b+(gap if abs(b/.6-round(b/.6))<1e-6 else 0);d1=d-(gap if abs(d/.6-round(d/.6))<1e-6 else 0)
   if a1<c1 and b1<d1:
    quad(batch,a1,b1,c1,d1,idx);quad(batch,a,b,a1,d,3);quad(batch,c1,b,c,d,3);quad(batch,a1,b,c1,b1,3);quad(batch,a1,d1,c1,d,3)
   else:quad(batch,a,b,c,d,idx)
for rid,(verts,faces,indices) in batches.items():
 mesh=bpy.data.meshes.new('Finish floor '+rid);mesh.from_pydata(verts,[],faces);mesh.update()
 o=bpy.data.objects.new('Finish floor / '+rid,mesh);finish.objects.link(o);o['component']='floor_finish';o['room_id']=rid
 for m in [stone,oak,bath,grout]:mesh.materials.append(m)
 for face,index in zip(mesh.polygons,indices):face.material_index=index
 uv_project(o)
for o in bpy.data.collections['90_Review_labels'].objects:o.hide_render=True
# Light fixtures are interpreted from photos, with draft dimensions. No ceiling height change.
def box(name,size,loc,m):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 for c in list(o.users_collection):c.objects.unlink(o)
 lamps.objects.link(o);o.data.materials.append(m);o['component']='light_fixture';return o
light_positions=[[16.8,6.9],[14.8,6.4],[16.4,4.9],[11.6,8.7],[1.9,8],[5.2,8],[8.3,8],[15.8,2.2],[8.3,3.2],[6.5,5],[12.3,2.7],[2,4.8]]
for i,(x,y) in enumerate(light_positions):
 if i in [0,1,2,7]:
  bpy.ops.mesh.primitive_torus_add(major_radius=.23 if i!=7 else .31,minor_radius=.032,major_segments=32,minor_segments=8,location=(x,-y,2.28))
  o=bpy.context.object;o.name=f'168C ring diffuser {i}'
  for c in list(o.users_collection):c.objects.unlink(o)
  lamps.objects.link(o);o.data.materials.append(lightmat);o['component']='light_fixture'
  box(f'168C lamp mount {i}',(.09,.09,.018),(x,-y,2.49),metal)
 else:box(f'168C ceiling panel {i}',(.43,.43,.025),(x,-y,2.465),lightmat)
 data=bpy.data.lights.new(f'168C room light {i}','AREA');data.energy=65 if i<3 else 40;data.shape='DISK';data.size=1.3;data.color=(1,.88,.72)
 o=bpy.data.objects.new(data.name,data);lamps.objects.link(o);o.location=(x,-y,2.37)
# A warm cove accent follows the living ceiling in the reference; profile dimensions remain draft.
for name,size,loc in [('north',(5.4,.035,.018),(16.8,-4.55,2.46)),('south',(5.4,.035,.018),(16.8,-9.25,2.46)),('east',(.035,4.7,.018),(19.5,-6.9,2.46))]:box('168C living cove '+name,size,loc,lightmat)
# Existing review sunlight and neutral world work for both daylight renders and Material Preview.
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.28
bpy.context.view_layer.update()
checks=[]
for name,bb in original.items():
 after=bounds(bpy.data.objects[name]);delta=max(abs(a-b) for p,q in zip(bb,after) for a,b in zip(p,q));checks.append({'name':name,'bounds_preserved':delta<1e-6,'max_difference_m':delta})
assert all(c['bounds_preserved'] for c in checks)
objects={};exported=[]
cat={'floor':'Floors','floor_finish':'Floors','wall':'Structure','wall_pier':'Structure','excluded_volume':'Structure','ceiling':'Ceilings','light_fixture':'Lighting','fixed_storage':'Kitchen','shower_fixture':'Bathrooms'}
bpy.ops.object.select_all(action='DESELECT')
for collection in original_collections+[finish,lamps]:
 for o in collection.objects:
  if o.type!='MESH':continue
  oid='168c:'+o.name;o['object_id']=oid
  component=o.get('component');category=cat.get(component,'Doors_Windows')
  if component in ['wall','wall_pier','excluded_volume']:o['wall_ref']=True
  o.hide_set(False);o.select_set(True);exported.append(o)
  objects[oid]={'name':o.name,'category':category,'component':component}
  if component in ['window_span','sliding_panel','glass_partition']:o['is_glazing']=True
ceiling=next(o for o in exported if o.get('component')=='ceiling');ceiling.hide_render=False
bpy.ops.export_scene.gltf(filepath=str(out/'acro168c-expanded.glb'),export_format='GLB',use_selection=True,export_extras=True,export_yup=True,export_cameras=False,export_lights=False)
ceiling.hide_set(True);ceiling.hide_render=True;bpy.ops.object.select_all(action='DESELECT')
# Current web uses one data contract, independent of the Blender naming scheme.
webrooms=[]
for r in rooms:
 a,b,c,d=r['reference_bounds_m'];webrooms.append({'id':r['id'],'name_ko':r['name_ko'],'bounds_m':[a,b,c,d],'polygon_m':r['polygon_m'],'width_m':c-a,'depth_m':d-b,'kind':r['kind'],'floor_object':'Finish floor / '+r['id'],'source':'draft calibrated reference boundaries, not surveyed clear room area'})
for room in webrooms:
 if room['id']=='living':room['viewTarget']=[12.1,7.8]
 if room['id']=='kitchen':room['viewTarget']=[11.6,10.8]
doors=[]
for op in ops:
 if op['kind']=='door':
  x,y,z=op['hinge_blender_m'];base=(0 if op['axis']=='h' else -math.pi/2)+(math.pi if op.get('hinge_side')=='end' else 0)
  doors.append({'id':'168c-door:'+op['id'],'name':op['id'],'type':'hinged','adapter':'exported','objectId':'168c:'+op['leaf_mesh_name'],'hinge':[x,z,-y],'axis':op['axis'].upper(),'width':op['leaf_width_m'],'height':op['leaf_height_m'],'swingRadians':math.radians(op['swing_degrees']),'closedDirection':[math.cos(base),-math.sin(base)],'sourceObject':op['leaf_mesh_name']})
 elif op['kind']=='sliding_door':
  moving=[o for o in exported if o.name.startswith(op['id']+'/panel-1')]
  doors.append({'id':'168c-door:'+op['id'],'name':op['id'],'type':'sliding','adapter':'exported','movingObjects':['168c:'+o.name for o in moving],'translationAxis':'x' if op['axis']=='h' else 'z','travel':op['draft_slide_travel_m'],'width':op['cut_width_m'],'height':op['cut_height_m'],'openingLocation':[op['blender_location_m'][0],op['blender_location_m'][2],-op['blender_location_m'][1]]})
names={'bedroom-1-door':'침실 1 문','bedroom-2-door':'침실 2 문','bedroom-3-door':'침실 3 문','primary-door':'안방 문','bathroom-1-door':'화장실 1 문','primary-bathroom-door':'안방 욕실 문','entry-door':'현관문','pantry-door':'주방 팬트리 문','hall-pantry-door':'복도 팬트리 문','primary-balcony-service-door':'안방 발코니 안쪽 문','bathroom-1-shower-door':'샤워부스 문','primary-balcony-opening':'안방 발코니 미닫이문','living-window-2':'거실 발코니 미닫이문'}
for d in doors:d['name']=names.get(d['name'],d['name'])
info={'units':'meters','upAxis':'Y','unitType':'168C','variant':'expanded','navigationReady':True,'structureRevision':'structural-v2','finishRevision':'finishes-v1','rooms':webrooms,'objects':objects,'bounds_m':[-.12,-.12,20.62,11.63],'spawn':[16.5,6.5],'defaultRoom':'living','ceilingHeight_m':2.5,'lightPositions':light_positions,'source':'dimensioned plan + user dimensions; VR-guided finishes; unmeasured details remain provisional'}
save('web-info.json',info);save('web-doors.json',doors);save('structure-preservation.json',{'passed':True,'checked_meshes':len(checks),'checks':checks,'scope':'v2 structural world bounds and transforms preserved; floor top remains z=0; new surface meshes and light fixtures added'})
for name in ['rooms.json','openings.json','fixtures.json','excluded-zones.json','assumptions.json']:(out/name).write_bytes((source/name).read_bytes())
scene.camera=bpy.data.objects['Review / isometric'];scene.render.filepath=str(out/'isometric.png');scene.cycles.samples=32
for screen in bpy.data.screens:
 for area in screen.areas:
  if area.type=='VIEW_3D':area.spaces.active.shading.type='MATERIAL'
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(out/'acro168c-expanded.blend'))
if not args.skip_render:
 for camera,file in [('Review / plan','top-view.png'),('Review / isometric','isometric.png')]:
  scene.camera=bpy.data.objects[camera];scene.render.filepath=str(out/file);bpy.ops.render.render(write_still=True)
 scene.camera=bpy.data.objects['Review / isometric'];scene.camera.location=(19,-8.5,1.6);scene.camera.rotation_euler=(Vector((12.3,-7.2,1.35))-scene.camera.location).to_track_quat('-Z','Y').to_euler();scene.camera.data.type='PERSP';scene.camera.data.lens=24
 ceiling.hide_render=False;scene.render.filepath=str(out/'living-kitchen.png');bpy.ops.render.render(write_still=True)
save('model-info.json',{'unit_type':'168C','variant':'expanded','revision':'finishes-v1','structure_revision':'structural-v2','source_blend_sha256':hashlib.sha256((source/'acro168c-expanded-structure.blend').read_bytes()).hexdigest(),'blend_sha256':hashlib.sha256((out/'acro168c-expanded.blend').read_bytes()).hexdigest(),'glb_sha256':hashlib.sha256((out/'acro168c-expanded.glb').read_bytes()).hexdigest(),'architecture_meshes':len(exported),'source_vr_textures_embedded':False,'finish_basis':'qualitative VR appearance + existing project-generated oak/limestone; finish dimensions and light positions are draft'})
print(json.dumps({'output':str(out),'mesh_count':len(exported),'preserved':len(checks),'doors':len(doors)}))
