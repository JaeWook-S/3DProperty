#!/usr/bin/env python3
"""Independent binary glTF checks and S3 material manifest for the UV-only candidate."""
import hashlib,json,struct
from pathlib import Path
from datetime import datetime,timezone
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'assets/models/acro-river-park/112a';PARENT='archisketch-circulation-v5';REV='archisketch-uv-p0-v1'
OUT=ROOT/'runtime/interior/2026-10-21-uv-p0';OUT.mkdir(parents=True,exist_ok=True)
TARGETS={'Entry wall correction/00','Entry wall correction/01','Sink detail / recessed bowl','Sink detail / curved faucet'}
ROLES={'112A / Warm ivory plaster':'wall_plaster','112A / Bedroom light oak':'floor_wood','112A / VR polished stone floor':'floor_stone','112A / Reference gray porcelain tile':'floor_stone','112A / Ivory woven linen':'fabric_upholstery','112A / Offwhite bed linen':'fabric_bedding'}
def sha(b):return hashlib.sha256(b).hexdigest()
def dump(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
class GLB:
 def __init__(self,path):
  self.path=path;self.raw=path.read_bytes();magic,version,size=struct.unpack_from('<4sII',self.raw);assert magic==b'glTF' and version==2 and size==len(self.raw)
  chunks={};offset=12
  while offset<size:
   n,k=struct.unpack_from('<II',self.raw,offset);chunks[k]=self.raw[offset+8:offset+8+n];offset+=8+n
  self.doc=json.loads(chunks[0x4e4f534a]);self.bin=chunks[0x004e4942]
 def acc(self,i):
  a=self.doc['accessors'][i];v=self.doc['bufferViews'][a['bufferView']];d={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']];dt=np.dtype({5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1'}[a['componentType']]);return np.ndarray((a['count'],d),dtype=dt,buffer=self.bin,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',d*dt.itemsize),dt.itemsize))
 def image(self,i):
  im=self.doc['images'][i];v=self.doc['bufferViews'][im['bufferView']];return self.bin[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]
 def prims(self):
  for n in self.doc['nodes']:
   if 'mesh' in n:
    for i,p in enumerate(self.doc['meshes'][n['mesh']]['primitives']):yield (n['name'],i),p
 def corners(self,p,k):
  idx=self.acc(p['indices']).ravel();return self.acc(p['attributes'][k])[idx]
 def geometry(self,p):
  # Canonical oriented triangles, invariant to vertex splits needed for UV seams.
  rows=np.concatenate([self.corners(p,'POSITION'),self.corners(p,'NORMAL')],axis=1).reshape(-1,3,6)
  triangles=[]
  for tri in rows:
   verts=[tuple(v) for v in tri];rotations=[tuple(verts[j:]+verts[:j]) for j in range(3)];triangles.append(min(rotations))
  return sha(np.asarray(sorted(triangles),dtype='<f4').tobytes())
 def uv_stats(self):
  missing=[];degenerate=[];nonfinite=[];normal_bad=0
  for key,p in self.prims():
   pos=self.corners(p,'POSITION').reshape(-1,3,3);valid=np.linalg.norm(np.cross(pos[:,1]-pos[:,0],pos[:,2]-pos[:,0]),axis=1)>1e-12
   normals=self.acc(p['attributes']['NORMAL']);normal_bad+=int((abs(np.linalg.norm(normals,axis=1)-1)>1e-3).sum())
   if 'TEXCOORD_0' not in p['attributes']:missing.append(key);continue
   t=self.corners(p,'TEXCOORD_0').reshape(-1,3,2)
   if not np.isfinite(t).all():nonfinite.append(key)
   a=t[:,1]-t[:,0];b=t[:,2]-t[:,0];bad=int(((abs(a[:,0]*b[:,1]-a[:,1]*b[:,0])<1e-10)&valid).sum())
   if bad:degenerate.append({'primitive':key,'triangles':bad})
  return {'missing_uv0':missing,'degenerate_uv_on_valid_geometry':degenerate,'nonfinite_uv':nonfinite,'nonunit_normals':normal_bad}

def material_manifest(g):
 result=[]
 for m in g.doc['materials']:
  p=m.get('pbrMetallicRoughness',{});maps={}
  for slot,component,color in [('baseColorTexture','RGB','sRGB'),('normalTexture','RGB','linear'),('metallicRoughnessTexture',{'roughness':'G','metallic':'B'},'linear'),('occlusionTexture','R','linear')]:
   t=p.get(slot) if slot in ('baseColorTexture','metallicRoughnessTexture') else m.get(slot)
   if t is None:maps[slot]=None;continue
   texture=g.doc['textures'][t['index']];i=texture['source'];raw=g.image(i);h=sha(raw);im=g.doc['images'][i];ext='.png' if im['mimeType']=='image/png' else '.jpg'
   path=BASE/REV/'inherited-textures'/(h+ext);path.parent.mkdir(parents=True,exist_ok=True)
   if path.exists():assert path.read_bytes()==raw
   else:path.write_bytes(raw)
   x=t.get('extensions',{}).get('KHR_texture_transform');sample_m=m.get('extras',{}).get('texture_repeat_m');generated=sample_m==1.2
   maps[slot]={'uri':str(path.relative_to(ROOT)),'sha256':h,'source_container':str(g.path.relative_to(ROOT)),'embedded_image_index':i,'colorSpace':color,'packed_channel':component,'texCoord':(x or {}).get('texCoord',t.get('texCoord',0)),'KHR_texture_transform':x,'texture_transform':{'repeat':(x or {}).get('scale',[1,1]),'offset':(x or {}).get('offset',[0,0]),'rotation':(x or {}).get('rotation',0)},'sampler':g.doc.get('samplers',[{}])[texture.get('sampler',0)],'normal_convention':'OpenGL tangent-space +Y (glTF)' if slot=='normalTexture' else None,'normal_scale':t.get('scale',1) if slot=='normalTexture' else None,'meters_per_uv_tile':sample_m,'sample_size_basis':'assumed metric tiling; not measured surface sample' if sample_m is not None else 'unchanged baseline mapping; physical sample size not established','source':{'basis':'inherited v5 bytes; no new PBR content','record':'assets/materials/generated-v1/manifest.json' if generated else None,'external_url':None,'license':'project-generated baseline texture; no third-party CC0 claim' if generated else 'inherited catalog texture; license not re-audited in P0, preserve existing use only'},'ao_scope':'material_micro_AO' if slot=='occlusionTexture' else None}
  result.append({'name':m['name'],'role':ROLES.get(m['name']),'first_pbr_comparison':m['name'] in ROLES,'material_extras':m.get('extras',{}),'maps':maps,'ao_atlas':'none','new_pbr_material_applied':False})
 return result
report={'created_at_utc':datetime.now(timezone.utc).isoformat(),'candidate':REV,'baseline':PARENT,'variants':{},'active_web_changed':False}
manifest={'schema':'cortex.material-candidate.v1','phase':'P0 UV-only; inherited texture bytes, not new PBR','candidate_revision':REV,'baseline_revision':PARENT,'material_name_mapping':'identity; names unchanged','variants':{},'roles':ROLES,'default_excluded':['ceiling','lacquer','catalog sofa leather/PVC'],'UV1_scene_atlas':None,'forced_attribute_removal':False}
for v in ['basic','expanded']:
 old=GLB(BASE/PARENT/v/f'acro112a-{v}.glb');new=GLB(BASE/REV/v/f'acro112a-{v}.glb')
 assert old.doc['materials']==new.doc['materials'],'materials'
 assert old.doc.get('textures')==new.doc.get('textures') and old.doc.get('samplers')==new.doc.get('samplers'),'textures/samplers'
 assert len(old.doc['images'])==len(new.doc['images']) and all(old.image(i)==new.image(i) for i in range(len(old.doc['images']))),'embedded image bytes'
 assert old.doc['nodes']==new.doc['nodes'],'nodes, metadata or transforms changed'
 a=dict(old.prims());b=dict(new.prims());assert a.keys()==b.keys();same_geo=[];same_other_attrs=[]
 for key,p in a.items():
  q=b[key];assert p.get('material')==q.get('material'),key
  assert old.geometry(p)==new.geometry(q),('geometry or normals',key);same_geo.append(key)
  for attr in p['attributes']:
   if attr=='TEXCOORD_0' and key[0] in TARGETS:continue
   assert attr in q['attributes'],(key,attr)
   assert np.array_equal(old.corners(p,attr),new.corners(q,attr)),('corner attributes changed',key,attr)
  same_other_attrs.append(key)
 stat=new.uv_stats();assert not stat['missing_uv0'] and not stat['degenerate_uv_on_valid_geometry'] and not stat['nonfinite_uv'] and stat['nonunit_normals']==0,stat
 oldmeta=json.loads((BASE/PARENT/v/'model-info.json').read_text());meta=json.loads((BASE/REV/v/'model-info.json').read_text())
 changed={k for k in set(oldmeta)|set(meta) if oldmeta.get(k)!=meta.get(k)};assert changed=={'finish_revision','blend_sha256','glb_sha256'},changed
 assert meta['glb_sha256']==sha(new.raw) and meta['blend_sha256']==sha((BASE/REV/v/f'acro112a-{v}.blend').read_bytes())
 preservation=json.loads((BASE/REV/v/'uv-preservation.json').read_text());assert preservation['passed']
 for path,h in preservation['source_files_sha256'].items():assert sha((ROOT/path).read_bytes())==h,path
 report['variants'][v]={'passed':True,'geometry_and_normals_equal_primitives':len(same_geo),'non_target_corner_attributes_equal':True,'material_definitions_equal':True,'nodes_metadata_transforms_equal':True,'embedded_images_unchanged':len(old.doc['images']),'uv_before':old.uv_stats(),'uv_after':stat,'model_metadata_changed_fields':sorted(changed),'baseline_glb_sha256':sha(old.raw),'candidate_glb_sha256':sha(new.raw),'baseline_glb_bytes':len(old.raw),'candidate_glb_bytes':len(new.raw),'blender_preservation':preservation}
 manifest['variants'][v]={'model_uri':str(new.path.relative_to(ROOT)),'model_info_uri':str((BASE/REV/v/'model-info.json').relative_to(ROOT)),'baseline_files_sha256':preservation['source_files_sha256'],'candidate_files_sha256':{str((BASE/REV/v/f).relative_to(ROOT)):sha((BASE/REV/v/f).read_bytes()) for f in [f'acro112a-{v}.blend',f'acro112a-{v}.glb','model-info.json']},'materials':material_manifest(new)}
report['passed']=True;dump(OUT/'glb-verification.json',report);dump(BASE/REV/'material-manifest.json',manifest)
print(json.dumps({'passed':True,'report':str(OUT/'glb-verification.json'),'manifest':str(BASE/REV/'material-manifest.json'),'variants':{v:{'uv_after':r['uv_after'],'geometry_primitives':r['geometry_and_normals_equal_primitives']} for v,r in report['variants'].items()}},ensure_ascii=False))
