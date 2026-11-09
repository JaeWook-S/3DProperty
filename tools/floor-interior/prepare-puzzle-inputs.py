"""Derive metre room/opening inputs from read-only Archisketch snapshots.
Not an as-built wall boundary, instance-scaled opening, or a transport model.
"""
import json, math, hashlib, html
from pathlib import Path
from datetime import datetime, timezone
from shapely.geometry import Polygon, Point, mapping
from shapely.ops import unary_union
from shapely.validation import explain_validity, make_valid

ROOT=Path(__file__).resolve().parents[2]
DATA=ROOT.parent/'AisideProject/datasets/acro-river-park'
OUT=DATA/'derived/floor-puzzle/2026-11-02'
OUT.mkdir(parents=True,exist_ok=True)
CAT=json.loads((ROOT/'runtime/floor-interior/2026-11-02-puzzle/sources/catalog.json').read_text())

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
def preview(d,path):
    b=d['bounds'];w,h=b['size_m'];scale=38
    out=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-45 -65 {w*scale+90} {h*scale+140}">', '<rect x="-45" y="-65" width="1200" height="1200" fill="#f7f6f2"/>',f'<text x="0" y="-35" font-size="20" font-family="sans-serif">{d["unitType"]} expanded · room coordinates (metres)</text>']
    for i,r in enumerate(d['rooms']):
        pts=' '.join(f'{x*scale:.3f},{z*scale:.3f}' for x,z in r['polygonXZ_m'])
        color='#d6d2c9' if r['sourceType']=='NONE' else '#e3cfad' if r['sourceType']=='침실' else '#d4dfde' if r['sourceType']=='욕실' else '#eee8d7'
        out.append(f'<polygon points="{pts}" fill="{color}" stroke="#77796e" stroke-width="1.2"/>')
        p=Polygon(r['polygonXZ_m']).representative_point()
        if r['computedPolygonArea_m2']>2:out.append(f'<text x="{p.x*scale}" y="{p.y*scale}" font-size="10" text-anchor="middle" font-family="sans-serif">R{i+1}</text>')
    for o in d['openings']:
        x,_,z=o['positionXYZ_m'];is_entry=o['kind']=='entrance';color='#b74d3c' if is_entry else '#377d99' if o['kind']=='window' else '#7d755f'
        out.append(f'<circle cx="{x*scale}" cy="{z*scale}" r="{5 if is_entry else 2.8}" fill="{color}"/>')
        if is_entry:out.append(f'<text x="{x*scale+7}" y="{z*scale-8}" font-size="12" font-family="sans-serif" fill="{color}">ENTRY</text>')
    out.append(f'<text x="0" y="{h*scale+30}" font-size="12" font-family="sans-serif">Room bounds {w:.3f} × {h:.3f} m · no wall thickness added</text>')
    out.append(f'<text x="0" y="{h*scale+50}" font-size="11" font-family="sans-serif">Blue: window centre · red: entrance centre · grey: source NONE</text></svg>')
    path.write_text('\n'.join(out))

reports=[]
for typ in ('145F','168D'):
    src=DATA/f'raw/archisketch/{typ}/expanded/2026-11-02-puzzle/project-summary.json'
    d=json.loads(src.read_text());f=d['floorplans'][0]
    points=[p for r in f['rooms'] for p in r['polygon']]
    ox,oz=min(p[0] for p in points),min(p[1] for p in points)
    rooms=[];polys=[];source_validity=[];roundtrip=0
    for r in f['rooms']:
        ps=[[(p[0]-ox)/1000,(p[1]-oz)/1000] for p in r['polygon']];p=Polygon(ps)
        assert not p.is_empty,(typ,r['archiId'])
        source_validity.append({'roomId':r['archiId'],'valid':p.is_valid,'reason':explain_validity(p),'sourceArea_m2':p.area,'diagnosticMakeValidArea_m2':make_valid(p).area})
        polys.append(p if p.is_valid else make_valid(p))
        roundtrip=max(roundtrip,max(max(abs(x*1000+ox-a),abs(z*1000+oz-b)) for (x,z),(a,b) in zip(ps,r['polygon'])))
        rooms.append({'id':r['archiId'],'sourceLabel':r['label'],'sourceType':r['type'],'polygonXZ_m':ps,'sourceCeilingHeightValue':r['ceilingHeight'],'sourceCeilingHeightDeclaredUnit':'mm per MCP tool schema','ceilingHeight_m':None,'ceilingHeightCandidateMetres':r['ceilingHeight'] if 1.5<=r['ceilingHeight']<=5 else None,'ceilingHeightRequiresUnitReview':True,'sourceReportedArea':r['area'],'computedPolygonArea_m2':p.area,'topologyValid':p.is_valid,'topologyReason':explain_validity(p),'classification':'unclassified_source_space' if r['type']=='NONE' else 'source_labeled_room'})
    union=unary_union(polys)
    openings=[];opening_roundtrip=0
    for o in f['openings']:
        prod=d['products'][o['productId']];name=prod['name'];pos=[(o['position'][0]-ox)/1000,o['position'][1]/1000,(o['position'][2]-oz)/1000]
        opening_roundtrip=max(opening_roundtrip,abs(pos[0]*1000+ox-o['position'][0]),abs(pos[1]*1000-o['position'][1]),abs(pos[2]*1000+oz-o['position'][2]))
        kind='entrance' if 'Entrance' in name else 'window' if 'window' in name.lower() or '창' in name else 'door'
        op={'id':o['archiId'],'productId':o['productId'],'name':name,'kind':kind,'positionXYZ_m':pos,'sourceEulerXYZ_degrees':o.get('rotation'),'sourceEulerOrder':'XZY','catalogDimensions':prod.get('dimensions'),'catalogDimensionsAreVerifiedInstanceOpening':False,'clearWidth_m':None,'scaleProvidedBySummary':False}
        if kind=='entrance':
            probes=[]
            for step in (.15,.3,.6):
                probes.append({'offset_m':step,'roomOccupancy':{key:union.covers(Point(pos[0]+dx*step,pos[2]+dz*step)) for key,dx,dz in [('positiveX',1,0),('negativeX',-1,0),('positiveZ',0,1),('negativeZ',0,-1)]}})
            op['adjacencyProbes']=probes
        openings.append(op)
    cat=next(p for p in CAT['floorplans'] if p['area']==typ and p['areaType']=='확장형')
    out={'schemaVersion':1,'unitType':typ,'variant':'expanded','source':{'kind':'Archisketch MCP project summary','path':str(src.relative_to(DATA)),'sha256':digest(src),'sourceProjectId':d['projectId'],'sourceUpdatedAt':d['updatedAt'],'publicFloorplanId':cat['id']},'coordinates':{'unit':'m','up':'Y','horizontal':['X','Z'],'sourceUnit':'mm','sourceOriginXZ_mm':[ox,oz],'transform':'x=(sourceX-originX)/1000; y=sourceY/1000; z=(sourceZ-originZ)/1000','scale':1,'mirrored':False,'rotated':False},'catalogAreas_m2':{'supply':cat['supplyArea'],'exclusive':cat['exclusiveArea']},'sourceFloorplanReportedArea':f['area'],'bounds':{'minXZ_m':list(union.bounds[:2]),'maxXZ_m':list(union.bounds[2:]),'size_m':[union.bounds[2]-union.bounds[0],union.bounds[3]-union.bounds[1]],'basis':'room polygons; excludes external wall thickness and opening extent'},'roomUnionForDiagnosticOnly':mapping(union),'diagnosticUnionMethod':'source valid polygons; invalid ones make_valid for diagnostic display only; original polygonXZ_m preserved','sourceTopology':source_validity,'rooms':rooms,'openings':openings,'limitations':['MCP declares ceiling height in mm but returns 2.3 in these sources; normalized ceiling height is null pending review.', 'Room polygon union is not the building or external-wall footprint. Do not equate it with supply/exclusive area.','NONE rooms are preserved and unclassified; not automatically walkable, shaft, or furniture space.','Opening position and rotation are source instances. Product dimensions may be unscaled catalog dimensions; clear opening size is unknown.','This expanded snapshot does not establish renovation state of any actual unit.','No building placement, mirror orientation, common core, collision or transport validation is supplied.']}
    target=OUT/f'{typ}-expanded-metric-input.json';write(target,out);preview(out,OUT/f'{typ}-expanded-room-plan.svg')
    report={'unitType':typ,'sourceSHA256':digest(src),'derivedSHA256':digest(target),'rooms':len(rooms),'openings':len(openings),'entrances':len([o for o in openings if o['kind']=='entrance']),'maxRoundTripError_mm':roundtrip,'maxOpeningRoundTripError_mm':opening_roundtrip,'allSourceRoomPolygonsValid':all(p['valid'] for p in source_validity),'sourceTopology':source_validity,'pairwiseOverlap_m2':sum(polys[i].intersection(polys[j]).area for i in range(len(polys)) for j in range(i)),'roomUnionArea_m2':union.area,'sumPolygonArea_m2':sum(p.area for p in polys),'sourceReportedArea_m2':f['area']['squareMeters'],'roomBounds_m':out['bounds']['size_m'],'catalogSupplyArea_m2':cat['supplyArea'],'catalogExclusiveArea_m2':cat['exclusiveArea'],'noneRoomCount':sum(r['sourceType']=='NONE' for r in rooms),'unsupportedInstanceDimensions':len(openings)}
    assert roundtrip<1e-8 and opening_roundtrip<1e-8 and report['entrances']==1,report
    report['metricCoordinatePreservationPassed']=True
    report['readyForUnreviewedMeshing']=False
    report['ceilingUnitConflict']=True
    report['readyForPlanReview']=True
    reports.append(report)
write(OUT/'verification.json',{'metricPreservationPassed':True,'allSourceTopologyValid':all(r['allSourceRoomPolygonsValid'] for r in reports),'checkedAt':datetime.now(timezone.utc).isoformat(),'scope':'source metric transform/room topology/instance centre preservation only; not external shell, door size, 3D or runtime verification','units':reports})
write(OUT/'S3-READY.json',{'status':'metric_input_ready_with_source_topology_issue_not_model_or_activation','inputs':[str(OUT/f'{typ}-expanded-metric-input.json') for typ in ['145F','168D']],'verification':str(OUT/'verification.json'),'previewSVGs':[str(OUT/f'{typ}-expanded-room-plan.svg') for typ in ['145F','168D']],'sourceTopologyIssue':'145F source room fed41868-0413-8f4e-8b81-dae440778406 self-intersects. Original points preserved. Do not treat diagnostic make_valid union as corrected original.','heightUnitIssue':'MCP schema declares mm but these ceilingHeight values are 2.3. Preserve raw and leave ceilingHeight_m null pending unit review. Do not create 2.3mm walls.','requiredHandling':'Use only as source room/instance geometry. Do not use catalog door/window width as verified physical opening. Current release untouched.'})
print(json.dumps(reports,ensure_ascii=False,indent=2))
