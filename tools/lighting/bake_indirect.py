import os,argparse,json,pathlib,time,hashlib,subprocess,math,fcntl,sys
parser=argparse.ArgumentParser();parser.add_argument('--id',required=True);parser.add_argument('--device',default='CPU');parser.add_argument('--threads',type=int,default=32);parser.add_argument('--authorized-shared-gpu1',action='store_true');args=parser.parse_args()
os.environ['CUDA_VISIBLE_DEVICES']='' if args.device=='CPU' else args.device
import bpy,numpy as np
ROOT=pathlib.Path(__file__).resolve().parents[2];work=ROOT/'runtime/web-quality/2026-11-09-lightmaps';R=work/'bakes'/args.id;R.mkdir(parents=True,exist_ok=True)
models=json.loads((work/'model-inputs.json').read_text());model=next(m for m in models if m['unit_type'].lower()+'-'+m['variant']==args.id)
src=ROOT.parent/model['blend_path'];sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
lock=(R/'.bake-lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX)
if (R/'verification.json').exists():
 prior=json.loads((R/'verification.json').read_text())
 if prior.get('passed') and prior.get('source_sha256')==sha(src) and prior.get('source_glb_sha256')==model['glb_sha256']:
  print('REUSED_VERIFIED '+args.id,flush=True);sys.exit(0)
gpu='CPU only'
if args.device!='CPU':
 gpu=subprocess.check_output(['nvidia-smi','--id='+args.device,'--query-gpu=index,uuid,memory.used,utilization.gpu','--format=csv,noheader,nounits'],text=True).strip();parts=gpu.split(', ')
 if (int(parts[-2])>256 or int(parts[-1])>0) and not(args.authorized_shared_gpu1 and args.device=='1'):raise RuntimeError('Selected GPU is not idle: '+gpu)
 if args.authorized_shared_gpu1 and int(parts[-2])>120000:raise RuntimeError('GPU1 lacks reserved memory headroom: '+gpu)
r={'id':args.id,'source_sha256':sha(src),'source_glb_sha256':model['glb_sha256'],'gpu_before':gpu,'gpu_authorization':'User explicitly authorized GPU1 on 2026-11-09; existing processes untouched' if args.authorized_shared_gpu1 else 'CPU or idle-only','samples':4096,'atlas':[2048,2048],'scope':'static architecture, indirect only, original source lighting','status':'baking','startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'original_material_uv':'UV0 active_render retained; UV1 active edit bake target'}
(R/'progress.json').write_text(json.dumps(r,indent=2));bpy.ops.wm.open_mainfile(filepath=str(src),use_scripts=False);s=bpy.context.scene
s.render.engine='CYCLES';s.cycles.samples=4096;s.cycles.use_adaptive_sampling=False;s.cycles.seed=42
s.render.threads_mode='FIXED';s.render.threads=args.threads
if args.device=='CPU':s.cycles.device='CPU'
else:
 pref=bpy.context.preferences.addons['cycles'].preferences;pref.compute_device_type='CUDA';pref.get_devices()
 for d in pref.devices:d.use=d.type=='CUDA'
 assert sum(d.use for d in pref.devices)==1;s.cycles.device='GPU'
if not s.world:s.world=bpy.data.worlds.new('Day indirect')
s.world.use_nodes=True;s.world.node_tree.nodes.get('Background').inputs[0].default_value=(.72,.78,.83,1);s.world.node_tree.nodes.get('Background').inputs[1].default_value=.4
r['lights']=[{'name':o.name,'type':o.data.type,'energy':o.data.energy}for o in s.objects if o.type=='LIGHT']
receivers=[];excluded=[];before={}
# The original render UV stays active for source materials; only active edit UV is the bake target.

for o in s.objects:
 if o.get('component') in ['furniture','door_leaf','sliding_panel','door_accessory','decoration']:o.hide_render=True;excluded.append(o.name)
 if o.type=='MESH' and o.get('component') in ['floor','wall','ceiling']:
  o.hide_render=False;o.hide_set(False);receivers.append(o)
  if not o.data.uv_layers:
   o.data.uv_layers.new(name='SourceUV0-placeholder')
   r.setdefault('source_uv0_missing_untextured_objects',[]).append(o.name)
  before[o.name]={'co':np.array([v.co[:] for v in o.data.vertices]).tolist(),'uv0':np.array([v.uv[:] for v in o.data.uv_layers[0].data]).tolist()}
  uv=o.data.uv_layers.new(name='IndirectUV');o.data.uv_layers.active=uv;uv.active_render=False
bpy.ops.object.select_all(action='DESELECT')
for o in receivers:o.select_set(True)
bpy.context.view_layer.objects.active=receivers[0];bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.004,area_weight=0,correct_aspect=True,scale_to_bounds=True);bpy.ops.object.mode_set(mode='OBJECT')
# Smart projection and packing across all selected objects creates one UV1 atlas.
image=bpy.data.images.new('Architecture indirect',width=2048,height=2048,alpha=False,float_buffer=True);image.colorspace_settings.name='Non-Color'
materials=set(m for o in receivers for m in o.data.materials if m)
for m in materials:
 m.use_nodes=True;n=m.node_tree.nodes.new('ShaderNodeTexImage');n.name='Architecture indirect target';n.image=image;m.node_tree.nodes.active=n
s.render.bake.use_pass_direct=False;s.render.bake.use_pass_indirect=True;s.render.bake.use_pass_color=False;s.render.bake.margin=6;s.render.bake.use_clear=True
mapping=[]
for o in receivers:
 me=o.data;me.calc_loop_triangles();tris=[]
 for t in me.loop_triangles:
  normal=o.matrix_world.to_3x3().inverted().transposed()@t.normal
  verts=[o.matrix_world@me.vertices[i].co for i in t.vertices]
  tris.append({'p':[[v.x,v.z,-v.y] for v in verts],'n':[normal.x,normal.z,-normal.y],'uv':[list(me.uv_layers.active.data[i].uv) for i in t.loops]})
 mapping.append({'name':o.name,'component':o.get('component'),'source_id':o.get('source_id'),'room_id':o.get('room_id'),'triangles':tris})
(R/'uv1-sidecar.json').write_text(json.dumps({'coordinate_system':'Three X/Y/Z meters','models':mapping},separators=(',',':')))
# Remove only exactly matched opposite horizontal cap triangles from the bake
# copy. Runtime static-batches already removes these faces when displaying walls.
# Canonical mesh files, other faces, UV0 and room dimensions stay untouched.
from collections import defaultdict
caps=defaultdict(list)
for o in receivers:
 if o.get('component')!='wall':continue
 for t in o.data.loop_triangles:
  n=o.matrix_world.to_3x3().inverted().transposed()@t.normal
  if abs(n.z)<.999999:continue
  coords=[o.matrix_world@o.data.vertices[i].co for i in t.vertices]
  if len(set(v.z for v in coords))!=1:continue
  key=tuple(sorted(tuple(v) for v in coords));caps[key].append((o,t.index,1 if n.z>0 else -1))
removed=defaultdict(set)
for group in caps.values():
 if len(group)!=2:continue
 a,b=group
 if a[0] is b[0] or a[2]==b[2]:continue
 removed[a[0].name].add(a[1]);removed[b[0].name].add(b[1])
cap_report={'removed_triangles':sum(map(len,removed.values())),'objects':{k:len(v) for k,v in removed.items()},'rule':'exact world vertices; horizontal; opposite normals; exactly two faces; distinct wall objects'}
for o in receivers:
 if o.name not in removed:continue
 original=o.data;triangles=[t for t in original.loop_triangles if t.index not in removed[o.name]]
 me=bpy.data.meshes.new(o.name+' bake cap cleanup');me.from_pydata([v.co[:] for v in original.vertices],[],[list(t.vertices) for t in triangles]);me.update()
 for m in original.materials:me.materials.append(m)
 for p,t in zip(me.polygons,triangles):p.material_index=t.material_index
 for layer in original.uv_layers:
  uv=me.uv_layers.new(name=layer.name)
  for p,t in zip(me.polygons,triangles):
   for newloop,oldloop in zip(p.loop_indices,t.loops):uv.data[newloop].uv=layer.data[oldloop].uv
 me.uv_layers.active=me.uv_layers['IndirectUV'];me.uv_layers.active.active_render=False;o.data=me
(R/'internal-cap-cleanup.json').write_text(json.dumps(cap_report,indent=2))
print('CAP_CLEANUP '+str(cap_report['removed_triangles']),flush=True)
start=time.monotonic();bpy.ops.object.bake(type='DIFFUSE',uv_layer='IndirectUV');elapsed=time.monotonic()-start
image.filepath_raw=str(R/'indirect-4096.exr');image.file_format='OPEN_EXR';image.save()
np.save(R/'linear.npy',np.array(image.pixels[:],dtype=np.float32).reshape((2048,2048,4)))
s.view_settings.view_transform='AgX';s.render.image_settings.file_format='PNG';s.render.image_settings.color_mode='RGB';image.save_render(str(R/'atlas-preview.png'),scene=s)
unchanged=all(before[o.name]['co']==np.array([v.co[:] for v in o.data.vertices]).tolist() for o in receivers)
r.update({'seconds':elapsed,'receivers':len(receivers),'triangle_count':sum(len(x['triangles']) for x in mapping),'source_unchanged':sha(src)==r['source_sha256'],'positions_unchanged':unchanged,'bake_copy_cap_cleanup':cap_report,'uv0_copy_policy':'Retained triangles copy loop UV0 exactly; source file unchanged; sidecar records original unmodified geometry','excluded_dynamic_occluders':excluded,'exr_sha256':sha(R/'indirect-4096.exr'),'sidecar_sha256':sha(R/'uv1-sidecar.json'),'status':'baked_candidate_not_activated','passed':unchanged and sha(src)==r['source_sha256'],'completedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())});(R/'verification.json').write_text(json.dumps(r,indent=2));print(json.dumps({k:r[k] for k in ['passed','receivers','triangle_count','seconds']}),flush=True)
