"""Normalize saved 112A MCP summaries, preserving source polygons in meters."""
import argparse,datetime,hashlib,json,math
from pathlib import Path
from shapely.geometry import Polygon
from archisketch_metrics import opening_width, require_unique_room_ids, source_room_changes
ROOT=Path(__file__).resolve().parents[2]
LABELS={
'basic':{'506C2161':('service-balcony','다용도 발코니','utility'),'22861D06':('kitchen-balcony','주방 발코니','balcony'),'9C77C3FE':('bedroom-1-strip','침실 1 창가 발코니','balcony'),'B17A5459':('bedroom-2-strip','침실 2 창가 발코니','balcony'),'7E18A707':('living-balcony','거실 발코니','balcony'),'00AFDD94':('bedroom-1-balcony','침실 1 앞 발코니','balcony'),'6E664A78':('bedroom-2-balcony','침실 2 앞 발코니','balcony'),'EB9FAF2B':('balcony-link','발코니 연결부','balcony'),'2639EFDC':('primary-balcony','안방 발코니','balcony'),'16373825':('dressing-balcony','드레스룸 발코니','balcony'),'8E8C41BE':('primary-balcony-storage','안방 발코니 보조실','utility'),'FA5DA151':('rear-storage','후면 보조실','utility')},
'expanded':{'6378DFD1':('primary-balcony-storage','안방 발코니 보조실','utility'),'1D799DF0':('service-balcony','다용도 발코니','utility'),'1B803E05':('bedroom-2-balcony','침실 2 앞 발코니','balcony'),'E455A25D':('primary-balcony','안방 발코니','balcony'),'B9C2832D':('rear-storage','후면 보조실','utility')}}
def normalize(variant,path,*,revision="archisketch-structure-v1",layout_path=None,origin_override=None,repair_small_source_loops=False,output_path=None,archive_source=True,baseline_path=None,allow_source_changes=False):
 raw=json.loads(path.read_text());fp=raw['floorplans'][0];repairs=[]
 if baseline_path:
  baseline=json.loads(baseline_path.read_text())['floorplans'][0]['rooms']
  changes=source_room_changes(fp['rooms'],baseline)
  if any(changes[k] for k in ('added','removed','changed')) and not allow_source_changes:
   raise ValueError('Source room changes require review before importing: '+json.dumps({k:v for k,v in changes.items() if k!='unchanged'}))
 # Labels below describe the reviewed three-bedroom, two-bathroom type only.
 if sum(r['type']=='욕실' for r in fp['rooms'])!=2:
  raise ValueError('112A requires exactly two reviewed bathrooms; inspect added/deleted source rooms before importing')
 layout_items={o['archiId']:o for o in json.loads(layout_path.read_text())['floorplans'][0]['items']} if layout_path else {}
 pts=[p for r in fp['rooms'] for p in r['polygon']]
 origin=origin_override or [min(p[i] for p in pts)-200 for i in (0,1)]
 def xy(p):return [round((p[i]-origin[i])/1000,6) for i in (0,1)]
 labels=dict(LABELS[variant]);sort=lambda r:min(p[0] for p in r['polygon'])
 bedrooms=sorted([r for r in fp['rooms'] if r['type']=='침실'],key=sort);assert len(bedrooms)==3
 for i,r in enumerate(bedrooms):labels[r['archiId'][:8]]=(f'bedroom-{i+1}' if i<2 else 'primary',f'침실 {i+1}' if i<2 else '안방','bedroom')
 for i,r in enumerate(sorted([r for r in fp['rooms'] if r['type']=='욕실'],key=sort)):labels[r['archiId'][:8]]=('bathroom-1' if i==0 else 'primary-bath','화장실 1' if i==0 else '안방 화장실','wet')
 for r in fp['rooms']:
  if r['type']=='거실&다이닝':labels[r['archiId'][:8]]=('living-kitchen-hall','거실 · 주방 · 복도','living')
  if r['type']=='드레스룸':labels[r['archiId'][:8]]=('dressing','드레스룸','storage')
 rooms=[]
 for i,r in enumerate(fp['rooms']):
  label=labels.get(r['archiId'][:8],(f'excluded-{i:02d}','구조체 · 비사용 공간','excluded'));coords=[xy(p) for p in r['polygon']];poly=Polygon(coords)
  if not poly.is_valid and repair_small_source_loops:
   from shapely import make_valid,is_valid_reason
   valid=make_valid(poly);pieces=list(valid.geoms) if valid.geom_type=='MultiPolygon' else [valid]
   main=max(pieces,key=lambda g:g.area);extra=sum(g.area for g in pieces if g!=main)
   assert extra<.001 and abs(main.area-poly.area)<.001,'Source correction exceeds explicit 10cm² tolerance'
   repairs.append(dict(source_id=r['archiId'],reason=is_valid_reason(poly),method='split at exact segment intersection; preserve largest boundary; retain tiny loop as non-occupiable region',extra_area_m2=extra,main_area_change_m2=main.area-poly.area))
   for j,part in enumerate(pieces):
    if part==main:continue
    rooms.append(dict(id=f'source-loop-{i}-{j}',name='원본 경계 중첩 조각',kind='excluded',source_id=r['archiId'],polygon_m=[list(p) for p in list(part.exterior.coords)[:-1]],ceiling_height_m=2.6,navigable=False))
   poly=main;coords=[list(p) for p in list(poly.exterior.coords)[:-1]]
  assert poly.is_valid,(r['archiId'],'invalid source polygon')
  rooms.append(dict(id=label[0],name=label[1],kind=label[2],source_id=r['archiId'],source_type=r['type'],source_polygon_mm=r['polygon'],polygon_m=coords,source_area_m2=r['area']['squareMeters'],source_ceiling_value=r['ceilingHeight'],ceiling_height_m=2.6,navigable=label[2]!='excluded' and not poly.buffer(-.24).is_empty,room_boundary_status='source_model_coordinates_not_as_built',classification_basis='source_type_and_opening_connections' if r['archiId'][:8] in labels else 'untyped_structural_region_provisional'))
 require_unique_room_ids(rooms)
 openings=[];skipped=[];seen=set()
 for index,o in enumerate(fp['openings']):
  p=raw['products'][o['productId']];name=p['name'];angle=o['rotation'][1];axis='z' if abs(math.sin(math.radians(angle)))>.7 else 'x';ax=0 if axis=='x' else 1
  c=[o['position'][0],o['position'][2]];sig=(o['productId'],tuple(o['position']),axis)
  if sig in seen:
   skipped.append(dict(source_id=o['archiId'],reason='Exact duplicate product/position/axis; keep one opening.',source_position_mm=o['position']));continue
  seen.add(sig)
  kind='window' if ('Window' in name or '창문' in name) else 'sliding' if 'Sliding' in name else 'door'
  candidates=sorted(set(q[ax] for r in fp['rooms'] for q in r['polygon'] if abs(q[1-ax]-c[1-ax])<=120))
  before=[v for v in candidates if v<c[ax]-1];after=[v for v in candidates if v>c[ax]+1];span=None
  if before and after:
   lo,hi=max(before),min(after)
   if abs((lo+hi)/2-c[ax])<80 and 500<hi-lo<5000:span=(hi-lo)/1000
  scaled=layout_items.get(o['archiId'],{}).get('dimensions')
  dims=scaled if scaled is not None else p['dimensions']
  metric=opening_width(p['dimensions'],scaled,span)
  width=metric['width_m'];bottom=max(0,(o['position'][1]-dims['height']/2)/1000) if kind=='window' else 0
  height=min(dims['height']/1000,2.6-bottom-.02)
  rec=dict(id=f'{kind}-{index:02d}',label=name,source_id=o['archiId'],kind=kind,axis=axis,center_m=xy(c),width_m=width,height_m=height,bottom_m=bottom,source_position_mm=o['position'],source_rotation_degrees=angle,source_product_name=name,source_catalog_dimensions=p['dimensions'],source_scaled_item_dimensions=scaled,source_endpoint_span_m=span,dimension_basis=metric['dimension_basis'],source_span_delta_m=metric['source_span_delta_m'],source_span_conflict=metric['source_span_conflict'],vertical_placement_status='source_center_and_scaled_height_not_field_measurement' if scaled else 'source_center_and_catalog_height_not_field_measurement',clear_passage_verified=False)
  if kind=='door':rec.update(leaf_width_m=round(width-.04,6),leaf_height_m=height,height_m=height+.02)
  openings.append(rec)
 raw_path=path;snap=path.parent
 if archive_source:
  stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');snap=ROOT.parent/f'AisideProject/datasets/acro-river-park/raw/archisketch/112A/{variant}/modeling-source-{stamp}'
  snap.mkdir(parents=True,exist_ok=False);raw_path=snap/'project-summary.json';raw_path.write_bytes(path.read_bytes())
  if layout_path:(snap/'furniture-layout.json').write_bytes(layout_path.read_bytes())
 spec=dict(schema_version=1,unit_type='112A',variant=variant,revision=revision,source_boundary_repairs=repairs,stage='coordinate-based structure review',ceiling_height_m=2.6,source_project_name=raw['name'],source_project_url=f"https://planner.archisketch.com/?projectId={raw['projectId']}",source_project_updated_at=raw['updatedAt'],source_snapshot_kind='live_mcp_read',source_summary_sha256=hashlib.sha256(raw_path.read_bytes()).hexdigest(),source_private_snapshot=str(snap.relative_to(ROOT.parent)),origin_mm=origin,coordinate_transform='(source_x-origin_x)/1000, -(source_z-origin_z)/1000, height in Blender; glTF x,height,z',unit_area=raw['unitArea'],wall_inference=dict(external_buffer_m=.2,method='room boundary bands; internal width follows polygon gaps; original wall centerlines absent',status='inferred_not_surveyed'),rooms=rooms,openings=openings,skipped_openings=skipped,limitations=['Archisketch coordinates are not independent as-built measurements.','112A ceiling 2.6m retains the selected height; catalog opening heights and frame allowances are provisional.','Basic and expanded source widths differ; no global rescaling.','Source polygons differ from the older dimensioned 112A image. Sources are preserved without averaging.','No fixtures/furniture. Narrow balcony strips retain geometry but are not walking start options.'])
 if layout_path:spec['source_layout_sha256']=hashlib.sha256(layout_path.read_bytes()).hexdigest()
 dest=output_path or ROOT/f'tools/blender/specs/acro112a-{variant}-{revision.replace("-structure","")}.json';dest.write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')
 return dest
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--basic-source',type=Path,required=True);p.add_argument('--expanded-source',type=Path,required=True);a=p.parse_args();normalize('basic',a.basic_source);normalize('expanded',a.expanded_source)
