#!/usr/bin/env python3
"""Normalize the 2026-11-02 user-saved 145F/168D source shells.

Only this new normalizer and specs145f168d are written. Source snapshots, existing
normalizers, and existing model revisions are never altered. No global fitting,
catalog opening dimensions, polygon buffering repair, or inferred field accuracy.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path

from shapely import make_valid
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union
from shapely.validation import explain_validity

ROOT = Path(__file__).resolve().parents[2]
WORKSPACE = ROOT.parent
SNAPSHOTS = WORKSPACE / 'AisideProject/datasets/acro-river-park/raw/archisketch'
SPECS = Path(__file__).resolve().parent / 'specs145f168d'
REVISION = 'archisketch-structure-v1'
SOURCE_DATE = '2026-11-02-user-saved'


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_snapshot(path):
    wrapper = json.loads(path.read_text())
    return wrapper['data'], wrapper


def polygon_parts(geom):
    if geom.is_empty:
        return []
    if geom.geom_type == 'Polygon':
        return [geom]
    if hasattr(geom, 'geoms'):
        return [p for g in geom.geoms for p in polygon_parts(g)]
    return []


def clean_ring(points):
    result = []
    for p in points:
        if not result or p != result[-1]:
            result.append(p)
    if len(result) > 1 and result[0] == result[-1]:
        result.pop()
    return result


def source_geometry(source):
    """Repair only by exact GEOS make_valid linework, without any tolerance."""
    original = Polygon(source['polygon'])
    cleaned = Polygon(clean_ring(source['polygon']))
    repaired = cleaned if cleaned.is_valid else make_valid(cleaned, method='linework')
    parts = sorted(polygon_parts(repaired), key=lambda p: (-p.area, p.bounds, p.wkt))
    if not parts or any(not p.is_valid or p.area <= 0 for p in parts):
        raise ValueError(f"No positive valid polygon for {source['archiId']}")
    if any(p.interiors for p in parts):
        raise ValueError('New source hole requires a builder contract review; never flatten it')
    repaired_boundary = unary_union([p.boundary for p in parts])
    original_boundary = LineString(list(original.exterior.coords))
    polygon_area = sum(p.area for p in parts)
    audit = {
        'source_id': source['archiId'],
        'source_type': source['type'],
        'valid_before': original.is_valid,
        'validity_reason_before': explain_validity(original),
        'method': 'exact_make_valid_linework_no_tolerance' if not cleaned.is_valid else 'remove_consecutive_duplicates_only' if len(clean_ring(source['polygon'])) != len(source['polygon']) else 'unchanged',
        'original_polygon_mm': source['polygon'],
        'original_polygon_wkt_mm': original.wkt,
        'normalized_polygon_parts_wkt_mm': [p.wkt for p in parts],
        'original_signed_ring_absolute_area_m2': original.area / 1e6,
        'source_reported_area_m2': source['area']['squareMeters'],
        'normalized_polygon_parts_area_m2': [p.area / 1e6 for p in parts],
        'normalized_polygon_area_m2': polygon_area / 1e6,
        'area_change_vs_original_ring_m2': (polygon_area - original.area) / 1e6,
        'boundary_hausdorff_distance_m': original_boundary.hausdorff_distance(repaired_boundary) / 1000,
        'original_boundary_length_m': original_boundary.length / 1000,
        'normalized_boundary_length_m': repaired_boundary.length / 1000,
        'original_boundary_not_in_normalized_length_m': original_boundary.difference(repaired_boundary).length / 1000,
        'normalized_boundary_not_in_original_length_m': repaired_boundary.difference(original_boundary).length / 1000,
        'part_count': len(parts),
        'removed_consecutive_or_closing_duplicate_vertices': len(source['polygon']) - len(clean_ring(source['polygon'])),
        'source_bytes_preserved': True,
        'coordinate_tolerance_m': 0,
        'area_interpretation': 'For an invalid self-crossing ring, shoelace area is not a valid occupied-area reference; exact linework partitions are preserved separately.' if not original.is_valid else 'Valid source polygon area retained.',
    }
    return parts, audit


def normalize(unit_type, variant):
    unit_type = unit_type.upper()
    if unit_type not in ('145F', '168D') or variant not in ('basic', 'expanded'):
        raise ValueError((unit_type, variant))
    source_dir = SNAPSHOTS / unit_type / variant / SOURCE_DATE
    summary_path, layout_path = [source_dir / name for name in ('project-summary.json', 'furniture-layout.json')]
    raw, wrapper = read_snapshot(summary_path)
    layout, _ = read_snapshot(layout_path)
    if len(raw['floorplans']) != 1 or len(layout['floorplans']) != 1:
        raise ValueError('Multiple source floorplans require explicit selection')
    fp = raw['floorplans'][0]
    source_rooms = fp['rooms']
    item_list = layout['floorplans'][0]['items']
    items = {item['archiId']: item for item in item_list}
    if len(items) != len(item_list):
        raise ValueError('Duplicate placed-item IDs')
    source_ids = [r['archiId'] for r in source_rooms]
    if len(set(source_ids)) != len(source_ids):
        raise ValueError('Duplicate source room IDs')
    source_parts, audits = {}, []
    for source in source_rooms:
        parts, audit = source_geometry(source)
        source_parts[source['archiId']] = parts
        audits.append(audit)
    all_points = [p for room in source_rooms for p in room['polygon']]
    origin = [min(p[k] for p in all_points) - 200 for k in (0, 1)]

    def xy(point):
        return [round((point[k] - origin[k]) / 1000, 12) for k in (0, 1)]

    geometries = {
        source_id: unary_union([Polygon([xy(p) for p in list(poly.exterior.coords)[:-1]]) for poly in parts])
        for source_id, parts in source_parts.items()
    }
    prepared_openings, connected_unknown = [], set()
    for index, opening in enumerate(fp['openings']):
        if opening['archiId'] not in items:
            raise ValueError(f"No placed dimensions for opening {opening['archiId']}")
        product = raw['products'][opening['productId']]
        name = product['name']
        kind = 'window' if ('Window' in name or '창문' in name) else 'sliding' if 'Sliding' in name else 'door'
        angle = opening['rotation'][1]
        radians = math.radians(angle)
        along = [math.cos(radians), -math.sin(radians)]
        normal = [math.sin(radians), math.cos(radians)]
        axis = 'z' if abs(along[1]) > .7 else 'x'
        center = xy([opening['position'][0], opening['position'][2]])
        side_points = [[center[k] + side * .32 * normal[k] for k in (0, 1)] for side in (-1, 1)]
        neighbors = [[r['archiId'] for r in source_rooms if geometries[r['archiId']].covers(Point(q))] for q in side_points]
        if kind != 'window':
            connected_unknown.update(r['archiId'] for r in source_rooms if r['type'] == 'NONE' and any(r['archiId'] in side for side in neighbors))
        prepared_openings.append((index, opening, product, kind, axis, center, along, normal, side_points, neighbors))
    living_sources = [r for r in source_rooms if r['type'] == '거실&다이닝']
    bedroom_sources = [r for r in source_rooms if r['type'] == '침실']
    main_living = max(living_sources, key=lambda r: geometries[r['archiId']].area)['archiId'] if living_sources else None
    primary = max(bedroom_sources, key=lambda r: geometries[r['archiId']].area)['archiId'] if bedroom_sources else None
    kinds = {'침실': 'bedroom', '욕실': 'wet', '저장고': 'storage', '드레스룸': 'storage', '벽장': 'storage', '거실&다이닝': 'living', '발코니': 'balcony'}
    prefixes = {'bedroom': 'bedroom', 'wet': 'bathroom', 'storage': 'storage', 'living': 'living-fragment', 'balcony': 'balcony', 'utility': 'utility', 'excluded': 'excluded'}
    labels = {'bedroom': '침실', 'wet': '욕실', 'storage': '수납실', 'living': '거실 부속 조각', 'balcony': '발코니', 'utility': '용도 미지정 보조실', 'excluded': '구조체 · 비사용 공간'}
    counters, rooms, room_geometries = {}, [], {}
    for source_index, source in enumerate(source_rooms):
        sid = source['archiId']
        if source['type'] not in kinds and source['type'] != 'NONE':
            raise ValueError(f"Unreviewed room type {source['type']}")
        kind = kinds.get(source['type'], 'utility' if sid in connected_unknown else 'excluded')
        if sid == main_living:
            base_id, name = 'living-kitchen-hall', '거실 · 주방 · 복도'
        elif sid == primary:
            base_id, name = 'primary', '안방'
        else:
            prefix = prefixes[kind]
            counters[prefix] = counters.get(prefix, 0) + 1
            base_id = f'{prefix}-{counters[prefix]:02d}'
            name = f'{labels[kind]} {counters[prefix]}'
        height = source['ceilingHeight']
        if height not in (2.3, 2.6):
            raise ValueError(f'Unexpected ceiling scalar {height}; review units')
        parts = source_parts[sid]
        for part_index, poly_mm in enumerate(parts):
            room_id = f'{base_id}-part-{part_index + 1:02d}' if len(parts) > 1 else base_id
            points = [xy(p) for p in list(poly_mm.exterior.coords)[:-1]]
            poly = Polygon(points)
            room_geometries[room_id] = poly
            rooms.append({
                'id': room_id, 'name': name + (f' / 원본 분할 {part_index + 1}' if len(parts) > 1 else ''),
                'kind': kind, 'source_id': sid, 'source_index': source_index, 'source_type': source['type'],
                'source_polygon_mm': source['polygon'], 'polygon_m': points,
                'source_area_m2': source['area']['squareMeters'], 'polygon_part_area_m2': poly.area,
                'source_part_index': part_index, 'source_part_count': len(parts),
                'source_ceiling_value': height, 'ceiling_height_m': height,
                'navigable': kind != 'excluded' and not poly.buffer(-.24).is_empty,
                'classification_basis': 'source_room_type' if source['type'] != 'NONE' else 'untyped_region_with_source_door_connection_provisional_utility' if sid in connected_unknown else 'untyped_region_without_door_provisional_exclusion',
                'room_boundary_status': 'exact_make_valid_partition_of_self_crossing_source_not_as_built' if len(parts) > 1 else 'source_model_coordinates_not_as_built',
            })
    openings, skipped, entrance, seen = [], [], None, set()
    for index, source, product, kind, axis, center, along, normal, side_points, source_neighbors in prepared_openings:
        dims = items[source['archiId']]['dimensions']
        if not all(isinstance(dims[k], (int, float)) and dims[k] > 0 for k in ('width', 'height', 'depth')):
            raise ValueError('Invalid placed opening dimensions')
        signature = (source['productId'], tuple(source['position']), tuple(source['rotation']), tuple(dims[k] for k in ('width', 'height', 'depth')))
        if signature in seen:
            skipped.append({'source_id': source['archiId'], 'reason': 'Exact duplicate placed opening'} )
            continue
        seen.add(signature)
        is_entry = 'Entrance Door' in product['name']
        oid = 'door-00' if is_entry else f'{kind}-{index + 1:02d}'
        width, height = dims['width'] / 1000, dims['height'] / 1000
        source_bottom = (source['position'][1] - dims['height'] / 2) / 1000
        if kind != 'window' and not (-.000001 <= source_bottom <= .002001):
            raise ValueError(f'Unexpected door sill offset {source_bottom}; do not silently floor-align')
        bottom = source_bottom if kind == 'window' else 0
        neighbor_rooms = [[r['id'] for r in rooms if room_geometries[r['id']].covers(Point(q))] for q in side_points]
        near_rooms = [r for r in rooms if any(r['id'] in side for side in neighbor_rooms)]
        adjacent_ceiling = min((r['ceiling_height_m'] for r in near_rooms), default=max(r['ceiling_height_m'] for r in rooms))
        if bottom < 0 or bottom + height > adjacent_ceiling + .0001:
            raise ValueError(f'{oid} exceeds adjacent ceiling: {bottom}+{height}>{adjacent_ceiling}')
        angle = source['rotation'][1]
        record = {
            'id': oid, 'label': product['name'], 'source_id': source['archiId'], 'source_index': index,
            'kind': kind, 'axis': axis, 'center_m': center, 'along_xz': along, 'normal_xz': normal,
            'width_m': width, 'height_m': height, 'bottom_m': bottom, 'depth_m': dims['depth'] / 1000,
            'source_position_mm': source['position'], 'source_rotation_degrees': angle,
            'source_product_name': product['name'], 'source_catalog_dimensions': product.get('dimensions'),
            'source_scaled_item_dimensions': dims, 'dimension_basis': 'source_scaled_item',
            'source_span_delta_m': None, 'source_span_conflict': False,
            'source_bottom_m': source_bottom, 'source_top_m': source_bottom + height,
            'vertical_placement_status': 'source_window_center_and_instance_height_exact' if kind == 'window' else 'door_floor_aligned; source_center_roundoff_0_to_2mm_explicit',
            'vertical_alignment_delta_m': bottom - source_bottom,
            'adjacent_room_ids': neighbor_rooms, 'adjacent_source_room_ids': source_neighbors,
            'neighbor_sampling': {'side_order': [-1, 1], 'offset_m': .32, 'points_xz_m': side_points},
            'adjacent_min_ceiling_m': adjacent_ceiling,
            'clear_passage_verified': False,
            'frame_allowance_m': .02 if kind == 'door' else .05,
            'frame_allowance_status': 'assumed_visual_frame_not_source_measurement',
            'orientation_basis': 'source_y_rotation_degrees; along_xz=(cos(theta),-sin(theta)); normal_xz=(sin(theta),cos(theta))',
            'orientation_axis_approximation_degrees': 0,
            'source_nearest_cardinal_delta_degrees': abs((angle + 45) % 90 - 45),
        }
        if kind == 'door':
            record.update(leaf_width_m=round(width - .04, 9), leaf_height_m=round(height - .02, 9), operation_basis='source_opening_axis_with_provisional_hinge_and_swing')
        else:
            record['clear_span_m'] = [round(width - .10, 9), round(height - .10, 9)]
        if is_entry:
            if entrance is not None:
                raise ValueError('Multiple Entrance Door products require review')
            occupied_sides = [side for side in (0, 1) if any(r['id'] in neighbor_rooms[side] and r['kind'] != 'excluded' for r in rooms)]
            if len(occupied_sides) != 1:
                raise ValueError(f'Entrance inside/outside ambiguous: {neighbor_rooms}')
            interior_side = occupied_sides[0]
            interior_ids = [r['id'] for r in rooms if r['id'] in neighbor_rooms[interior_side] and r['kind'] != 'excluded']
            inward_sign = (-1, 1)[interior_side]
            inward = [inward_sign * n for n in normal]
            entrance = {
                'opening_id': oid, 'source_id': source['archiId'], 'source_product_name': product['name'],
                'center_m': center, 'axis': axis, 'along_xz': along,
                'exterior_normal_xz': [-v for v in inward], 'interior_normal_xz': inward,
                'interior_room_id': interior_ids[0], 'interior_room_ids': interior_ids,
                'width_m': width, 'height_m': height,
                'identification_basis': 'source Entrance Door product; interior direction from actual occupied polygon on one sampled side, no assumed cardinal orientation',
                'exterior_common_area_source_status': 'absent_from_unit_source; floor/common_core_placement_not_determined',
            }
        openings.append(record)
    if entrance is None:
        raise ValueError('No source Entrance Door found')
    active = unary_union([room_geometries[r['id']] for r in rooms if r['kind'] != 'excluded'])
    all_geom = unary_union(list(geometries.values()))
    overlaps = []
    for i, sid in enumerate(source_ids):
        for other in source_ids[i + 1:]:
            intersection = geometries[sid].intersection(geometries[other])
            if intersection.area > 1e-12:
                overlaps.append({'source_ids': [sid, other], 'overlap_area_m2': intersection.area, 'policy': 'recorded_only_source_polygons_not_moved_or_trimmed'})
    raw_heights = sorted({r['ceilingHeight'] for r in source_rooms})
    spec = {
        'schema_version': 1, 'unit_type': unit_type, 'variant': variant, 'revision': REVISION,
        'stage': 'source-coordinate structural shell candidate',
        'ceiling_height_m': max(raw_heights),
        'ceiling_height_policy': 'per_room_source_values_preserved; global_wall_top_uses_maximum_source_ceiling_explicitly',
        'ceiling_unit_validation': {
            'raw_values': raw_heights, 'interpreted_unit': 'm', 'schema_reported_unit': 'mm',
            'schema_unit_conflict': True,
            'basis': 'Room ceilingHeight raw2.3/2.6 conflicts with mm schema: literal millimeters cannot contain placed doors height1977/2120/2296/2300mm. Values interpreted as meters per room; no replacement by a generic2.5m or room-type default.',
            'placed_opening_height_range_mm': [min(o['source_scaled_item_dimensions']['height'] for o in openings), max(o['source_scaled_item_dimensions']['height'] for o in openings)],
            'placed_entrance_height_mm': entrance['height_m'] * 1000,
            'source_door_center_roundoff_m_max': max(abs(o['vertical_alignment_delta_m']) for o in openings),
            'independent_field_measurement': False,
        },
        'source_project_name': raw['name'], 'source_project_url': f"https://planner.archisketch.com/?projectId={raw['projectId']}",
        'source_project_updated_at': raw['updatedAt'], 'source_snapshot_kind': 'live_mcp_read_user_saved_archived_wrapper',
        'source_summary_sha256': sha256(summary_path), 'source_layout_sha256': sha256(layout_path),
        'source_snapshot_paths': [os.path.relpath(p, ROOT) for p in (summary_path, layout_path)],
        'source_observed_at_utc': wrapper.get('observed_at_utc'),
        'origin_mm': origin,
        'coordinate_transform': 'source mm -> meters: x=(source_x-origin_x)/1000, z=(source_z-origin_z)/1000; Blender x,-z,height; glTF x,height,z',
        'coordinate_scale': 1, 'units': 'm', 'unit_area': raw['unitArea'],
        'area_accounting': {
            'supply_area_m2': float(raw['unitArea']['supplyArea']), 'exclusive_area_m2': float(raw['unitArea']['exclusiveArea']),
            'active_floor_polygon_union_m2': active.area,
            'all_source_polygon_sum_m2': sum(g.area for g in geometries.values()),
            'all_source_polygon_union_m2': all_geom.area,
            'original_signed_ring_absolute_area_sum_m2': sum(a['original_signed_ring_absolute_area_m2'] for a in audits),
            'source_reported_room_area_sum_m2': sum(r['area']['squareMeters'] for r in source_rooms),
            'note': 'Supply/exclusive areas are source metadata, not floor polygon sums. Exact make_valid area interpretation is separately audited; no fitting or global rescaling applied.',
        },
        'wall_inference': {'external_buffer_m': .2, 'opening_cut_half_depth_m': .25, 'method': 'outside bands around source interior-face polygons; source inter-room gaps preserved', 'status': 'assumed_external_wall_band_and_inferred_internal_gaps_not_surveyed', 'source_external_wall_thickness': None},
        'rooms': rooms, 'openings': openings, 'skipped_openings': skipped,
        'source_geometry_audit': audits,
        'source_boundary_repairs': [a for a in audits if a['method'] != 'unchanged'],
        'source_room_intersections': overlaps,
        'entrance': entrance, 'entrance_opening_id': entrance['opening_id'],
        'classification_summary': {'source_room_count': len(source_rooms), 'normalized_room_part_count': len(rooms), 'connected_unknown_source_ids': sorted(connected_unknown), 'type_counts': {kind: sum(r['kind'] == kind for r in rooms) for kind in sorted({r['kind'] for r in rooms})}},
        'independent_as_built_validation': False, 'actual_unit_renovation_verified': False,
        'limitations': [
            'Coordinates, ceilings and opening sizes are source model data, not field measurements or confirmed renovation status.',
            'Source positions/opening instance dimensions convert mm to meters without global fitting or arbitrary scaling.',
            'External wall thickness is absent: the0.2m outside band is an explicit modeling assumption.',
            'Per-room raw2.3/2.6 ceiling values are interpreted as meters against placed opening dimensions; no2.5m default override.',
            'Frame thickness, glazing thickness, door leaf offsets and hinge/swing construction are visual assumptions, not product measurements.',
            'Source opening rotations are retained; axis is a compatibility label only, not a cardinal-angle replacement.',
            'Untyped regions use actual source door adjacency for provisional utility/excluded classification; tiny fragments are not walking starts.',
            'Exact make_valid partitions of any invalid polygon are recorded with original coordinates, area and boundary audit; no arbitrary shape correction.',
            'Furniture, fixtures, materials matching and common-core/floor placement are outside this structural shell artifact.',
        ],
    }
    SPECS.mkdir(parents=True, exist_ok=True)
    output = SPECS / f'acro{unit_type.lower()}-{variant}-archisketch-v1.json'
    output.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'unit_type': unit_type, 'variant': variant, 'spec': str(output), 'rooms': len(rooms), 'openings': len(openings), 'entrance': entrance, 'invalid_source_polygons': sum(not a['valid_before'] for a in audits), 'overlaps': overlaps, 'area': spec['area_accounting']}, ensure_ascii=False), flush=True)
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--unit-type', choices=['145F', '168D', 'both'], default='both')
    parser.add_argument('--variant', choices=['basic', 'expanded', 'both'], default='both')
    args = parser.parse_args()
    for unit in ['145F', '168D'] if args.unit_type == 'both' else [args.unit_type]:
        for variant in ['basic', 'expanded'] if args.variant == 'both' else [args.variant]:
            normalize(unit, variant)
