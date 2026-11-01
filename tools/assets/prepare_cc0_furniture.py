#!/usr/bin/env python3
"""Package a reviewed CC0 chair; preserve original geometry and image bytes."""
import hashlib,json,shutil,struct
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT.parent/'AisideProject/realestate-spatial-ai/experiments/service-appearance/2026-10-23-cc0-furniture'
OUT=ROOT/'assets/furniture/cc0/modern-arm-chair-01'

def sha(blob):return hashlib.sha256(blob).hexdigest()
def main():
 meta=json.loads((SOURCE/'manifest.json').read_text());raw=(SOURCE/meta['packed_glb']['path']).read_bytes()
 assert sha(raw)==meta['packed_glb']['sha256']
 n,kind=struct.unpack_from('<II',raw,12);assert kind==0x4e4f534a
 doc=json.loads(raw[20:20+n]);tail=raw[20+n:]
 for mat in doc['materials']:mat.setdefault('extras',{})['appearance_policy']='authored-pbr-v1'
 encoded=json.dumps(doc,ensure_ascii=False,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
 data=struct.pack('<III',0x46546c67,2,20+len(encoded)+len(tail))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+tail
 OUT.mkdir(parents=True,exist_ok=True);(OUT/'model.glb').write_bytes(data)
 record={'schema_version':1,'id':'cc0-modern-arm-chair-01','title':'원목 라운지 체어','kind':'catalog:modern-arm-chair-01','role':'lounge_chair','geometry_kind':'glb','model_file':'model.glb','model_sha256':sha(data),'model_bytes':len(data),'source_model_sha256':sha(raw),'dimensions_m':dict(zip(['width','depth','height'],meta['geometry']['width_depth_height_m'])),'dimension_basis':'source_model_bounds_not_physical_measurement','physical_measurement_verified':False,'unit':'m','scale':[1,1,1],'original_bounds_xyz':{'min':meta['geometry']['bounds_min_xyz'],'max':meta['geometry']['bounds_max_xyz']},'front_direction':'+Z visual inspection; not a manufacturer axis declaration','runtime_normalization':'translation only: center X/Z and ground minimum Y; preserve scale','source':meta['source'],'triangles':meta['triangles'],'materials':[m['name'] for m in doc['materials']],'appearance_policy':'authored-pbr-v1','original_BIN_and_images_preserved':True,'metadata_change_only':'two material appearance_policy properties','preview_file':'preview.png','preview_basis':'CPU render of original source Blender; not a product photograph','GPU_used':False}
 (OUT/'manifest.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
 shutil.copyfile(SOURCE/'preview/chair-cpu.png',OUT/'preview.png')
 (OUT/'LICENSE.txt').write_text('Modern Arm Chair 01 by Vibrant Nordic / Poly Haven\nLicense: CC0-1.0\nSource: https://polyhaven.com/a/modern_arm_chair_01\nLicense: https://polyhaven.com/license\nhttps://creativecommons.org/publicdomain/zero/1.0/\n\nGeometry and textures retain original dimensions and image bytes.\nDerived package only adds material runtime-preservation metadata.\nDimensions describe the 3D model; no independent physical measurement is claimed.\n')
 print(json.dumps({'output':str(OUT),'bytes':len(data),'sha256':record['model_sha256'],'triangles':record['triangles']},ensure_ascii=False))
if __name__=='__main__':main()
