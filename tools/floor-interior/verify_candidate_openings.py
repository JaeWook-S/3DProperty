"""Independently check the chosen pose using actual full source opening spans.

Search used narrower trial spans for old A/C assets. This check uses their
actual metadata spans and both endpoints; it does not rerun or alter a model.
"""
import json,math,hashlib
from pathlib import Path
from shapely.geometry import shape,LineString,Point
from shapely.affinity import affine_transform
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'runtime/floor-interior/2026-11-02-user-models/layout'
p=json.loads((OUT/'review-package.json').read_text());d=json.loads((OUT/'plan-review-exact.json').read_text())
def pt(x,u,vector=False):
 a=math.radians(u['yawDegrees']);c,s=math.cos(a),math.sin(a);t=[0,0]if vector else u['translation']
 return [c*x[0]+s*x[1]+t[0],-s*x[0]+c*x[1]+t[1]]
def tr(g,u):
 a=math.radians(u['yawDegrees']);c,s=math.cos(a),math.sin(a);t=u['translation'];return affine_transform(g,[c,s,-s,c,*t])
ids={'211a':'sliding-02','168c':'living-main-window','145f':'sliding-02','168d':'sliding-15'}
units=p['placements'];polys={u['id']:tr(shape(d['units'][u['type']]['footprint']),u)for u in units};checks=[]
for u in units:
 model=p['models'][u['type']]['expanded'];meta=ROOT/model['metadata'].lstrip('/');m=json.loads(meta.read_text());assert hashlib.sha256(meta.read_bytes()).hexdigest()==model['metadataSha256']
 o=next(o for o in m['openings']if o['id']==ids[u['type']]);source=d['units'][u['type']];n=source['primaryGlazing']['normal'];along=[-n[1],n[0]]
 for f in (-.5,0,.5):
  point=[o['center_m'][i]+f*o['width_m']*along[i]for i in (0,1)]
  ray=LineString([pt([point[i]+dist*n[i]for i in (0,1)],u)for dist in(.3,8)])
  hit=[other for other,g in polys.items()if other!=u['id']and ray.intersects(g)]
  checks.append({'unit':u['id'],'opening':o['id'],'sourceWidthM':o['width_m'],'spanFraction':f,'ray':list(ray.coords),'otherUnitHits':hit,'passed':not hit})
 e=source['entry'];n=source['entryNormal'];ray=LineString([pt([e[i]+dist*n[i]for i in (0,1)],u)for dist in(.35,1.5)])
 hit=[other for other,g in polys.items()if other!=u['id']and ray.intersects(g)]
 checks.append({'unit':u['id'],'opening':'entry','ray':list(ray.coords),'otherUnitHits':hit,'passed':not hit})
result={'passed':all(c['passed']for c in checks),'checks':checks,'checkCount':len(checks),
 'scope':'Expanded opening full span endpoints/center against both-variant footprint unions. No access-width/continuous walking/actual common core check.',
 'searchSpanCorrection':{'211a':{'trialM':3.0,'actualMetadataM':4.376},'168c':{'trialM':3.4,'actualMetadataM':3.6}},
 'rayLengthsAreAnalysisParametersNotMeasuredClearance':True,'modelsChanged':False,'searchRepeated':False}
(OUT/'opening-endpoint-verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
assert result['passed'],json.dumps([c for c in checks if not c['passed']])
print('20 actual-span / entry rays pass; actual endpoint widths used; no model changes.')
