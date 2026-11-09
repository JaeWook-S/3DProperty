"""Verify and package the five-unit review separately from the public floor."""
import json, math, hashlib,itertools,datetime
from pathlib import Path
import shapely
from shapely.geometry import shape,mapping,LineString,Point
from shapely.affinity import affine_transform
from shapely.ops import unary_union
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'runtime/floor-interior/2026-11-02-user-models/layout'
source=json.loads((OUT/'plan-review-exact.json').read_text())
search=json.loads((OUT/'siteplan-facade-reviewed.json').read_text())
assert search['layouts'] and len(search['layouts'][0]['units'])==5
units=search['layouts'][0]['units'];domain=shape(search['domain'])
def transform(g,u):
 a=math.radians(u['yawDegrees']);c,s=math.cos(a),math.sin(a);t=u['translation']
 return affine_transform(g,[c,s,-s,c,t[0],t[1]])
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
ready=json.loads((ROOT/'docs/service-readiness/2026-11-02/145f168d-models-ready.json').read_text())
modelmap={typ:{}for typ in source['units']};checks=[]
for typ in modelmap:
 for variant in ['basic','expanded']:
  revision='archisketch-structure-v1' if typ in('145f','168d','211a')else 'archisketch-details-v2'if variant=='basic'else 'archisketch-metric-v1'
  folder=ROOT/f'assets/models/acro-river-park/{typ}/{revision}/{variant}'
  glbs=list(folder.glob('*.glb'));assert len(glbs)==1
  glb=glbs[0];meta=folder/'model-info.json';m=json.loads(meta.read_text())
  if typ in ('145f','168d'):
   record=next(r for r in ready['models']if r['unit_type'].lower()==typ and r['variant']==variant)
   for f in record['files'].values():
    assert digest(ROOT/f['path'])==f['sha256'];checks.append(f['path'])
  modelmap[typ][variant]={'glb':'/'+str(glb.relative_to(ROOT)),
   'metadata':'/'+str(meta.relative_to(ROOT)),'sha256':digest(glb),'metadataSha256':digest(meta),
   'entrance':source['units'][typ]['entry'] if typ in('211a','168c')else m['entrance']['center_m'],
   'summary':f'{typ.upper()} 원본 도면의 좌표와 적용된 문·창 크기를 사용한 모델입니다. 벽 두께·문짝 세부는 일부 가정이며 현장 실측 인증은 아닙니다.',
   'sourceRoomCount':len(m['rooms']),'openingCount':len(m['openings'])}
verification={'units':[],'variants':{},'sourceFileHashChecks':len(checks),'passed':True,
 'scope':'No inter-unit footprint overlaps in either variant; metric transforms and local entry/primary glazing probes. Not actual floor layout / route certification.',
 'sourceConsistentModels':ready['verification'],'modelGenerationRepeated':False,'H200':False}
for variant in ['basic','expanded']:
 poses={u['id']:transform(shapely.set_precision(shape(source['units'][u['type']]['variantFootprints'][variant]),1e-6),u)for u in units}
 overlaps=[{'a':a,'b':b,'m2':poses[a].intersection(poses[b]).area}for a,b in itertools.combinations(poses,2)]
 assert max(o['m2']for o in overlaps)<1e-5
 outside={i:g.difference(domain).area for i,g in poses.items()}
 verification['variants'][variant]={'overlaps':overlaps,'OSMOverflowM2':outside,'totalOSMOverflowM2':sum(outside.values()),
  'areaPreserved':all(abs(poses[u['id']].area-shape(source['units'][u['type']]['variantFootprints'][variant]).area)<.001 for u in units)}
 assert verification['variants'][variant]['areaPreserved']
for u in units:
 rec={k:v for k,v in u.items()if k!='footprint'}
 rec.update({'scale':[1,1,1],'reflection':False,'physicalUnitTypeBasis':'user supplied Naver CSV',
  'relativeRegionBasis':'user supplied siteplan illustration; orientation/translation are hypotheses'})
 verification['units'].append(rec)
overflow=verification['variants']['expanded']['totalOSMOverflowM2']
package={'status':'review_only_actual_floor_not_verified','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'models':modelmap,'placements':verification['units'],'domainRings':[search['domain']['coordinates'][0]],
 'summary':f'1001호 168D · 1002/1003호 145F · 1004호 211A · 1005호 168C. 세대 크기 변경과 좌우 반사 없이 검토했습니다. 세대끼리 겹침은 없으나, 확장형 모델의 약 {overflow:.1f}㎡가 기존 OSM 외곽 밖으로 나옵니다. 외곽이 맞는지 확인할 추가 근거가 필요합니다.',
 'sourcePlan':'plan-review-exact.json','searchResult':'siteplan-facade-reviewed.json',
 'actualCommonAreaVerified':False,'unitMirrorVerified':False,'actualFloorOutlineVerified':False,
 'primaryGlazingProbeM':8,'entryExitProbeM':1.5,'probeScope':'analysis parameters, not field measurements or statutory standards'}
(OUT/'review-package.json').write_text(json.dumps(package,ensure_ascii=False,indent=2)+'\n')
(OUT/'candidate-verification.json').write_text(json.dumps(verification,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':package['status'],'models':8,'newModels':4,'expandedOverflowM2':overflow,'basicOverflowM2':verification['variants']['basic']['totalOSMOverflowM2'],'sourceHashChecks':len(checks),'interUnitOverlapM2':0},indent=2))
