from pathlib import Path
import argparse,numpy as np,json,hashlib,fcntl,sys
from PIL import Image
parser=argparse.ArgumentParser();parser.add_argument('directory');args=parser.parse_args();R=Path(args.directory)
lock=(R/'.encode-lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX)
prior=R/'rgbm-verification.json';png=R/'indirect-4096-rgbm.png'
if prior.exists() and png.exists():
 d=json.loads(prior.read_text())
 if d.get('passed') and d.get('png_sha256')==hashlib.sha256(png.read_bytes()).hexdigest():
  print(json.dumps({'reused_verified':True,'id':R.name}));sys.exit(0)
a=np.load(R/'linear.npy')[:,:,:3];a=np.maximum(a,0);rng=float(2**np.ceil(np.log2(max(1,float(a.max())))))
m=np.ceil(np.maximum(a.max(axis=2)/rng,1/255)*255)/255
rgb=np.clip(np.round(a/(m[:,:,None]*rng)*255),0,255).astype('uint8');alpha=np.round(m*255).astype('uint8');encoded=np.dstack([rgb,alpha]);decoded=rgb.astype('float32')/255*alpha[:,:,None].astype('float32')/255*rng
errors=np.abs(decoded-a);Image.fromarray(np.flipud(encoded),'RGBA').save(R/'indirect-4096-rgbm.png',compress_level=9)
report={'encoding':'RGBM8','range':rng,'dimensions':[a.shape[1],a.shape[0]],'colorSpace':'NoColorSpace','flipY':True,'channel':1,'shader_decode':'decode each nearest texel RGB*alpha*range BEFORE bilinear','irradiance_factor':float(np.pi),'linear_max_error':float(errors.max()),'linear_mean_error':float(errors.mean()),'linear_p99_error':float(np.percentile(errors,99)),'rgbm_png_bytes':(R/'indirect-4096-rgbm.png').stat().st_size,'texture_memory_bytes':a.shape[0]*a.shape[1]*4,'mipmaps':False,'png_sha256':hashlib.sha256((R/'indirect-4096-rgbm.png').read_bytes()).hexdigest()}
y,x=np.meshgrid(np.arange(0,a.shape[0]-1,7),np.arange(0,a.shape[1]-1,7),indexing='ij');bil=lambda v:.15*v[y,x]+.35*v[y,x+1]+.15*v[y+1,x]+.35*v[y+1,x+1]
err=np.abs(bil(decoded)-bil(a));report['decoded_bilinear_max_error']=float(err.max());report['decoded_bilinear_mean_error']=float(err.mean());report['passed']=bool(errors.max()<.04 and err.max()<.04 and np.isfinite(a).all())
(R/'rgbm-verification.json').write_text(json.dumps(report,indent=2));print(json.dumps(report));assert report['passed']
