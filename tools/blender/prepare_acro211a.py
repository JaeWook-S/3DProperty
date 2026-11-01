#!/usr/bin/env python3
"""Normalize archived 211A MCP coordinates without rescaling or catalog sizing."""
import argparse, hashlib, json, math
from pathlib import Path
from shapely.geometry import Polygon, Point, box
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOTS = ROOT / 'runtime/archisketch-source-comparison/2026-10-26'
SPECS = Path(__file__).resolve().parent / 'specs211a'
REVISION = 'archisketch-structure-v1'


def read_snapshot(path):
    wrapper = json.loads(path.read_text())
    return wrapper.get('data', wrapper), wrapper


def normalize(variant):
    summary_path = SNAPSHOTS / f'211a-{variant}-summary.json'
    layout_path = SNAPSHOTS / f'211a-{variant}-layout.json'
    raw, wrapper = read_snapshot(summary_path)
    layout, _ = read_snapshot(layout_path)
    fp = raw['floorplans'][0]
    items = {o['archiId']: o for o in layout['floorplans'][0]['items']}
    source_rooms = fp['rooms']
    points = [p for r in source_rooms for p in r['polygon']]
    origin = [min(p[k] for p in points) - 200 for k in (0, 1)]
    xy = lambda p: [round((p[k] - origin[k]) / 1000, 9) for k in (0, 1)]
    geoms = {r['archiId']: Polygon([xy(p) for p in r['polygon']]) for r in source_rooms}
    for key, polygon in geoms.items():
        if not polygon.is_valid:
            raise ValueError(f'211A source polygon {key} requires explicit review before repair')
    rooms = []
    counters = {}
    # Untyped regions become utility rooms only with an actual door connection.
    connected_unknown = set()
    source_openings = []
    for source_index, opening in enumerate(fp['openings']):
        product = raw['products'][opening['productId']]
        name = product['name']
        kind = 'window' if ('Window' in name or '창문' in name) else 'sliding' if 'Sliding' in name else 'door'
        angle = opening['rotation'][1]
        axis = 'z' if abs(math.sin(math.radians(angle))) > .7 else 'x'
        center = xy([opening['position'][0], opening['position'][2]])
        neighbor_ids = []
        for side in (-1, 1):
            q = [center[0] + (side * .32 if axis == 'z' else 0), center[1] + (side * .32 if axis == 'x' else 0)]
            near = [r['archiId'] for r in source_rooms if geoms[r['archiId']].covers(Point(q))]
            neighbor_ids.append(near)
            if kind != 'window':
                connected_unknown.update(r['archiId'] for r in source_rooms if r['type'] == 'NONE' and r['archiId'] in near)
        source_openings.append((source_index, opening, product, kind, axis, center, neighbor_ids))
    main_living = max((r for r in source_rooms if r['type'] == '거실&다이닝'), key=lambda r: geoms[r['archiId']].area)['archiId']
    primary = max((r for r in source_rooms if r['type'] == '침실'), key=lambda r: geoms[r['archiId']].area)['archiId']
    repairs = []
    for index, source in enumerate(source_rooms):
        source_id = source['archiId']
        kind = {'침실':'bedroom', '욕실':'wet', '저장고':'storage', '거실&다이닝':'living', '발코니':'balcony'}.get(source['type'], 'utility' if source_id in connected_unknown else 'excluded')
        if source_id == main_living:
            room_id, name = 'living-kitchen-hall', '거실 · 주방 · 복도'
        elif source_id == primary:
            room_id, name = 'primary', '안방'
        else:
            prefix = {'bedroom':'bedroom', 'wet':'bathroom', 'storage':'storage', 'living':'living-fragment', 'balcony':'balcony', 'utility':'utility', 'excluded':'excluded'}[kind]
            counters[prefix] = counters.get(prefix, 0) + 1
            room_id = f'{prefix}-{counters[prefix]:02d}'
            name = f"{ {'bedroom':'침실','wet':'욕실','storage':'수납실','living':'거실 부속 조각','balcony':'발코니','utility':'용도 미지정 보조실','excluded':'구조체 · 비사용 공간'}[kind]} {counters[prefix]}"
        cleaned = []
        for p in source['polygon']:
            if not cleaned or p != cleaned[-1]:
                cleaned.append(p)
        if cleaned[0] == cleaned[-1]:
            cleaned.pop()
        duplicates = len(source['polygon']) - len(cleaned)
        if duplicates:
            repairs.append({'source_id':source_id, 'method':'remove consecutive duplicate vertices only', 'removed_vertices':duplicates, 'area_change_m2':0, 'original_polygon_preserved':True})
        height = source['ceilingHeight']
        if height not in (2.3, 2.6):
            raise ValueError(f'Unexpected ceilingHeight {height}: review units')
        polygon = geoms[source_id]
        rooms.append(dict(id=room_id, name=name, kind=kind, source_id=source_id, source_type=source['type'], source_polygon_mm=source['polygon'], polygon_m=[xy(p) for p in cleaned], source_area_m2=source['area']['squareMeters'], source_ceiling_value=height, ceiling_height_m=height, navigable=kind!='excluded' and not polygon.buffer(-.24).is_empty, classification_basis='source_room_type' if source['type']!='NONE' else 'untyped_region_with_source_door_connection_provisional_utility' if source_id in connected_unknown else 'untyped_region_without_door_provisional_exclusion', room_boundary_status='source_model_coordinates_not_as_built'))
    room_ids = {r['source_id']:r['id'] for r in rooms}
    openings, skipped = [], []
    seen = set()
    entrance = None
    for index, source, product, kind, axis, center, neighbors in source_openings:
        item = items[source['archiId']]
        dims = item['dimensions']
        if not all(isinstance(dims[k], (int,float)) and dims[k] > 0 for k in ('width','height','depth')):
            raise ValueError('Invalid placed opening dimensions')
        sig = (source['productId'],tuple(source['position']),tuple(source['rotation']),tuple(dims[k] for k in ('width','height','depth')))
        if sig in seen:
            skipped.append(dict(source_id=source['archiId'],reason='Exact duplicate placed opening'));continue
        seen.add(sig)
        is_entry = 'Entrance Door' in product['name']
        oid = 'door-00' if is_entry else f'{kind}-{index+1:02d}'
        width, height = dims['width']/1000, dims['height']/1000
        source_bottom = (source['position'][1]-dims['height']/2)/1000
        bottom = max(0, source_bottom) if kind=='window' else 0
        normal_axis = 0 if axis=='z' else 1
        near_rooms = [r for r in rooms if r['source_id'] in set(sum(neighbors, []))]
        ceiling = min((r['ceiling_height_m'] for r in near_rooms), default=2.6)
        if bottom + height > ceiling + .0001:
            raise ValueError(f'{oid} exceeds adjacent ceiling: {bottom}+{height}>{ceiling}')
        angle = source['rotation'][1]
        axis_error = min(abs(angle-k*90) for k in range(-4,5))
        record = dict(id=oid, label=product['name'], source_id=source['archiId'], source_index=index, kind=kind, axis=axis, center_m=center, width_m=width, height_m=height, bottom_m=bottom, depth_m=dims['depth']/1000, source_position_mm=source['position'], source_rotation_degrees=angle, source_product_name=product['name'], source_catalog_dimensions=product['dimensions'], source_scaled_item_dimensions=dims, dimension_basis='source_scaled_item', source_span_delta_m=None, source_span_conflict=False, source_bottom_m=source_bottom, vertical_placement_status='placed_instance_center_and_height; doors_floor_aligned_0_to_2mm_source_roundoff', adjacent_room_ids=[[room_ids[sid] for sid in side] for side in neighbors], clear_passage_verified=False, frame_allowance_m=.02 if kind=='door' else .05, frame_allowance_status='assumed_visual_frame_not_source_measurement', orientation_axis_approximation_degrees=axis_error)
        if kind=='door':
            record.update(leaf_width_m=round(width-.04,9), leaf_height_m=round(height-.02,9), operation_basis='source_opening_axis_with_provisional_hinge_and_swing')
        else:
            record['clear_span_m']=[round(width-.10,9),round(height-.10,9)]
        if is_entry:
            assert entrance is None and len(neighbors[0])==1 and not neighbors[1]
            assert neighbors[0][0]==main_living
            outward=[0,0];outward[normal_axis]=1
            entrance=dict(opening_id=oid, source_id=source['archiId'], source_product_name=product['name'], center_m=center, axis=axis, exterior_normal_xz=outward, interior_normal_xz=[-n for n in outward], interior_room_id=room_ids[main_living], width_m=width, height_m=height, identification_basis='source Entrance Door product plus interior living/hall on negative normal and no exterior room on positive normal', exterior_common_area_source_status='absent_from_unit_source; shared_core_placement_is_prototype')
        openings.append(record)
    assert entrance is not None
    areas={r['id']:geoms[r['source_id']].area for r in rooms}
    active=unary_union([geoms[r['source_id']] for r in rooms if r['kind']!='excluded'])
    spec=dict(schema_version=1,unit_type='211A',variant=variant,revision=REVISION,stage='source-coordinate structural shell candidate',ceiling_height_m=2.6,ceiling_height_policy='per_room_source_values_2.3m_or_2.6m; maximum_wall_height_2.6m',ceiling_unit_validation={'raw_values':[2.3,2.6],'interpreted_unit':'m','basis':'room ceilingHeight scalar values; all product and position dimensions are mm; placed entrances height2300mm and other doors2120mm fit 2.3m ceilings','independent_field_measurement':False}, source_project_name=raw['name'],source_project_url=f"https://planner.archisketch.com/?projectId={raw['projectId']}",source_project_updated_at=raw['updatedAt'],source_snapshot_kind='live_mcp_read_archived_wrapper',source_summary_sha256=hashlib.sha256(summary_path.read_bytes()).hexdigest(),source_layout_sha256=hashlib.sha256(layout_path.read_bytes()).hexdigest(),source_snapshot_paths=[str(p.relative_to(ROOT)) for p in (summary_path,layout_path)],source_observed_at_utc=wrapper.get('observed_at_utc'),origin_mm=origin,coordinate_transform='source mm -> meters: x=(source_x-origin_x)/1000, z=(source_z-origin_z)/1000; Blender x,-z,height; glTF x,height,z',unit_area=raw['unitArea'],area_accounting={'supply_area_m2':float(raw['unitArea']['supplyArea']),'exclusive_area_m2':float(raw['unitArea']['exclusiveArea']),'active_floor_polygon_union_m2':active.area,'all_source_polygon_sum_m2':sum(areas.values()),'note':'Supply/exclusive areas are source unit metadata, not polygon sums; no fitting or global scaling applied.'},wall_inference={'external_buffer_m':.2,'opening_cut_half_depth_m':.25,'method':'outside bands around source interior-face polygons; gaps between rooms retain their source widths','status':'assumed_external_wall_band_and_inferred_internal_gaps_not_surveyed','source_external_wall_thickness':None},rooms=rooms,openings=openings,skipped_openings=skipped,source_boundary_repairs=repairs,entrance=entrance,entrance_opening_id=entrance['opening_id'],limitations=['Coordinates and source ceiling values are unverified model data, not as-built measurements.','External wall thickness is absent from MCP: 0.2m outside bands are an explicit modeling assumption.','Room ceiling heights preserve mixed source2.3/2.6m; never inherit168C2.5m override.','Per-instance opening dimensions are retained; frame/jamb visual thickness and operable leaf offsets are assumptions.','Rotations within0.2deg of cardinal axes use cardinal cutouts, recorded per opening; maximum edge offset under4mm.','Untyped areas are provisionally classified using door connections; tiny typed fragments retain source floors but are not walking starts.','Furniture and fixtures are omitted from this structural shell phase.','Supply211.99m² and exclusive164.39m² are metadata distinct from modeled floor polygon area.'])
    SPECS.mkdir(parents=True,exist_ok=True)
    output=SPECS/f'acro211a-{variant}-archisketch-v1.json'
    output.write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'variant':variant,'spec':str(output),'entrance':entrance,'area':spec['area_accounting'],'rooms':len(rooms),'openings':len(openings)},ensure_ascii=False))
    return output

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--variant',choices=['basic','expanded','both'],default='both');args=parser.parse_args()
    for variant in ['basic','expanded'] if args.variant=='both' else [args.variant]:normalize(variant)
