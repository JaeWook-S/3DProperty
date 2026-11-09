"""Opening placement contract, original-scale source instances + inferred normals.
No product/model mutation. Width endpoints describe the placed model, not clear passage.
"""
import json,math,hashlib
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[2]
DATA=ROOT.parent/'AisideProject/datasets/acro-river-park'
INPUT=DATA/'derived/floor-puzzle/2026-11-02'
OUT=INPUT/'opening-contract-v2'
REVIEW=ROOT/'runtime/floor-interior/2026-11-02-puzzle/opening-contract/normal-review.json'
OUT.mkdir(parents=True,exist_ok=True)
def read(p):return json.loads(p.read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,x):p.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
review=read(REVIEW)
reports=[]
for typ in ('145F','168D'):
 raw=DATA/f'raw/archisketch/{typ}/expanded/2026-11-02-puzzle'
 sp=raw/'project-summary.json';lp=raw/'furniture-layout.json';mp=INPUT/f'{typ}-expanded-metric-input.json'
 source=read(sp);layout=read(lp);metric=read(mp)
 sf=source['floorplans'][0];lf=layout['floorplans'][0]
 ox,oz=metric['coordinates']['sourceOriginXZ_mm']
 items={x['archiId']:x for x in lf['items']}
 norms={x['id']:x for x in review['units'][typ]['openings']}
 sr={x['archiId']:x for x in sf['rooms']};lr={x['archiId']:x for x in lf['rooms']}
 assert sr.keys()==lr.keys() and all(sr[k]['polygon']==lr[k]['polygon'] for k in sr)
 openings=[];max_summary_delta=0;max_endpoint_error=0
 for original in sf['openings']:
  key=original['archiId'];item=items[key];normal=norms[key]
  assert original['rotation']==item['rotation']
  delta=max(abs(a-b) for a,b in zip(original['position'],item['position']));max_summary_delta=max(max_summary_delta,delta)
  assert delta<=.500000001,(typ,key,delta)
  pos=[(item['position'][0]-ox)/1000,item['position'][1]/1000,(item['position'][2]-oz)/1000]
  rotation=item['rotation'];assert abs(rotation[0])<1e-9 and abs(rotation[2])<1e-9
  angle=math.radians(rotation[1]);t=[math.cos(angle),-math.sin(angle)]
  width=item['dimensions']['width']/1000;center=[pos[0],pos[2]]
  endpoints=[[center[0]+side*width*.5*t[0],center[1]+side*width*.5*t[1]] for side in (-1,1)]
  max_endpoint_error=max(max_endpoint_error,abs(math.dist(*endpoints)-width))
  n=normal.get('outwardNormalXZ')
  if n is not None:
   assert abs(math.hypot(*n)-1)<1e-7 and abs(n[0]*t[0]+n[1]*t[1])<1e-7,(key,n,t)
  assert math.dist(normal['instanceCenterXZ_m'],center)<1e-9
  catalog=source['products'][original['productId']]['dimensions']
  op={'id':key,'name':item['name'],'positionXYZ_m':pos,'centerXZ_m':center,'sourceEulerXYZ_degrees':rotation,'sourceEulerOrder':'XZY','widthAxisXZ':t,'endpointsXZ_m':endpoints,'appliedDimensions_m':{k:v/1000 for k,v in item['dimensions'].items()},'dimensionsBasis':'get_furniture_layout dimensions includes product size times item scale; source output rounded to mm','dimensionsAreAppliedModelValues':True,'dimensionsAreSiteMeasurements':False,'endpointBasis':'width-axis centre ± applied model width/2; model extent, not wall aperture or traversable clearance','clearOpeningWidth_m':None,'catalogDimensions':catalog,'outwardNormalXZ':n,'normalBasis':normal.get('basis'),'normalConfidence':normal.get('confidence'),'exteriorClassification':normal.get('classification'),'isExteriorToUnitRoomFootprint':normal.get('exterior'),'exteriorScope':normal.get('exteriorScope'),'adjacentRoomIds':normal.get('adjacentRoomIds',[]),'adjacentRoomTypes':normal.get('adjacentRoomTypes',[]),'preferredLivingFacadeAnchor':('Sliding Door 06' in item['name'] and '거실&다이닝' in normal.get('adjacentRoomTypes',[])),'ambiguityFlags':normal.get('ambiguityFlags',[]),'normalReviewSourceId':key,'kind':'entrance' if 'Entrance' in item['name'] else 'glazed_sliding_door' if 'Sliding Door 06' in item['name'] else 'window' if 'window' in item['name'].lower() or '창' in item['name'] else 'door'}
  op['kind']=normal['kind']
  openings.append(op)
 entries=[o for o in openings if o['kind']=='entrance'];assert len(entries)==1
 rooms=[{'id':r['id'],'label':r['sourceLabel'],'type':r['sourceType'],'polygon_m':r['polygonXZ_m'],'sourceTopologyValid':r['topologyValid'],'sourceTopologyReason':r['topologyReason'],'ceilingHeight_m':None,'sourceCeilingHeightValue':r['sourceCeilingHeightValue'],'heightUnitReviewRequired':True} for r in metric['rooms']]
 d={'schemaVersion':2,'unitType':typ,'variant':'expanded','basicVariantAvailableInThisPackage':False,'status':'source_layout_search_input_not_mesh_or_as_built','coordinateSystem':{**metric['coordinates'],'arrayConvention':'polygon_m,centerXZ_m,endpointsXZ_m,outwardNormalXZ are [x,z]; positionXYZ_m is [x,y,z]','sourceScreenConvention':'source 2D +X right, +Z down; source2D upperleft is minimum X/Z','rotationConvention':'Euler vector components XYZ, composition XZY, right-handed Y-up; width axis=(cos(yaw), -sin(yaw))','buildingPlacement':None},'sources':{'projectSummary':{'path':str(sp.relative_to(DATA)),'sha256':sha(sp)},'furnitureLayout':{'path':str(lp.relative_to(DATA)),'sha256':sha(lp)},'metricInput':{'path':str(mp.relative_to(DATA)),'sha256':sha(mp)},'normalReview':{'path':str(REVIEW.relative_to(ROOT)),'sha256':sha(REVIEW)}},'bounds':metric['bounds'],'catalogAreas_m2':metric['catalogAreas_m2'],'rooms':rooms,'entrance':entries[0],'openings':openings,'exteriorGlazingCandidates':[o for o in openings if o['kind'] in ('window','glazed_sliding_door') and o['outwardNormalXZ'] is not None],'limitations':['Normal direction/exterior classification are inferred from room-side occupancy, not source-labelled façade data. Inspect confidence and ambiguity flags.','Expanded reference only. No inferred basic variant or actual unit renovation state.','Placed-model dimensions and endpoints are not wall-hole boundaries or net clear passage.','Room polygons exclude external-wall thickness; NONE spaces and the145F self-intersection remain unresolved.','Ceiling-height unit conflict remains; do not auto-mesh heights. No building transform, common-core position or type adjacency is established.']}
 path=OUT/f'{typ}-expanded.json';write(path,d)
 reports.append({'type':typ,'input':str(path),'sha256':sha(path),'roomPolygonsUnchanged':all(r['polygon_m']==m['polygonXZ_m'] for r,m in zip(rooms,metric['rooms'])),'roomCount':len(rooms),'openingCount':len(openings),'maxSummaryCenterDelta_mm':max_summary_delta,'maxEndpointLengthError_m':max_endpoint_error,'appliedDimensionsMatchedByInstanceId':True,'clearOpeningWidthRemainsUnknown':all(o['clearOpeningWidth_m'] is None for o in openings),'normalCount':sum(o['outwardNormalXZ'] is not None for o in openings),'entryNormal':entries[0]['outwardNormalXZ'],'glazingCandidateCount':len(d['exteriorGlazingCandidates'])})
 assert max_endpoint_error<1e-8
write(OUT/'verification.json',{'passed':True,'verifiedAt':datetime.now(timezone.utc).isoformat(),'scope':'source matching, coordinates and rigid endpoint construction; normals are inferred, not independently surveyed','units':reports})
write(OUT/'S3-READY.json',{'status':'opening_contract_ready_for_candidate_search','inputs':[r['input'] for r in reports],'verification':str(OUT/'verification.json'),'normalReview':str(REVIEW),'variant':'expanded_only','notProvided':['basic geometry','verified wall clear openings','verified ceiling height','as-built placement/core'],'currentProductOrModelChanges':0})
print(json.dumps(reports,ensure_ascii=False,indent=2))
