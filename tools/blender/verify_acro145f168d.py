#!/usr/bin/env python3
"""Independently reopen new 145F/168D BLENDs and actually import their final GLBs.

No rendering, GPU initialization, dependency installation, or existing asset
mutation is performed. Geometry is tested in Blender world coordinates, then
mapped back to source plan coordinates (x, -y). This is source consistency,
not independent field measurement or a web/runtime acceptance test.
"""
import os
os.environ['CUDA_VISIBLE_DEVICES'] = ''

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import struct
import traceback

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from shapely import make_valid
from shapely.geometry import GeometryCollection, Polygon, shape
from shapely.ops import unary_union


ROOT = Path(__file__).resolve().parents[2]
WORKSPACE = ROOT.parent
REVISION = 'archisketch-structure-v1'
SPECS = Path(__file__).resolve().parent / 'specs145f168d'
EVIDENCE = ROOT / 'runtime/floor-interior/2026-11-02-user-models/s2'
POSITION_TOL_M = 1e-5
AREA_TOL_M2 = 1e-4
IDENTITY_KEYS = ('component', 'room_id', 'source_id', 'opening_id',
                 'source_opening_id', 'collision', 'occupiable',
                 'furniture_placeable', 'underside_m')


def sha256(path):
    with path.open('rb') as handle:
        digest = hashlib.sha256()
        for data in iter(lambda: handle.read(1048576), b''):
            digest.update(data)
    return digest.hexdigest()


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2,
                               allow_nan=False) + '\n', encoding='utf-8')


def payload(path):
    wrapper = json.loads(path.read_text())
    return wrapper.get('data', wrapper)


def polygonal(geom):
    if geom.is_empty:
        return []
    if geom.geom_type == 'Polygon':
        return [geom]
    return [poly for child in getattr(geom, 'geoms', []) for poly in polygonal(child)]


def region(geom):
    parts = polygonal(geom)
    return unary_union(parts) if parts else GeometryCollection()


def room_region(room):
    """Accommodate explicit exact split polygons and holes without simplification."""
    if 'geometry_m' in room:
        return region(shape(room['geometry_m']))
    if 'polygon_parts_m' in room:
        parts = []
        for part in room['polygon_parts_m']:
            if isinstance(part, dict):
                parts.append(Polygon(part.get('exterior', part.get('polygon_m')),
                                     part.get('holes', part.get('holes_m', []))))
            else:
                parts.append(Polygon(part))
        return unary_union(parts)
    return Polygon(room['polygon_m'], room.get('holes_m', []))


def world_vertices(obj):
    return [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]


def bounds(obj):
    vertices = world_vertices(obj)
    return [min(v[axis] for v in vertices) for axis in range(3)] + [
        max(v[axis] for v in vertices) for axis in range(3)]


def footprint(objects, plane_m):
    faces = []
    for obj in objects:
        vertices = world_vertices(obj)
        for face in obj.data.polygons:
            coords = [vertices[i] for i in face.vertices]
            if len(coords) >= 3 and all(abs(v.z - plane_m) <= POSITION_TOL_M for v in coords):
                candidate = Polygon([(v.x, -v.y) for v in coords])
                if candidate.area > 1e-14:
                    faces.append(candidate)
    return unary_union(faces) if faces else GeometryCollection()


def plain(value):
    if hasattr(value, 'to_list'):
        return value.to_list()
    if hasattr(value, 'to_dict'):
        return value.to_dict()
    return value


def finite_nested(value):
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return True
    if isinstance(value, (int, float)):
        return math.isfinite(value)
    if isinstance(value, dict):
        return all(finite_nested(v) for v in value.values())
    if isinstance(value, (list, tuple)) or hasattr(value, '__iter__'):
        return all(finite_nested(v) for v in value)
    return True


def glb_document(path):
    data = path.read_bytes()
    magic, version, total = struct.unpack_from('<4sII', data)
    if magic != b'glTF' or version != 2 or total != len(data):
        raise ValueError('Invalid GLB header or declared byte count')
    offset, document, chunks = 12, None, []
    while offset < len(data):
        length, kind = struct.unpack_from('<II', data, offset)
        start = offset + 8
        if start + length > len(data):
            raise ValueError('GLB chunk exceeds file')
        chunks.append({'kind': kind, 'bytes': length})
        if kind == 0x4E4F534A:
            document = json.loads(data[start:start + length])
        offset = start + length
    if offset != len(data) or document is None:
        raise ValueError('Missing GLB JSON or malformed chunks')
    return document, chunks


def principal_inputs(material):
    if not material or not material.use_nodes:
        return None
    for node in material.node_tree.nodes:
        if node.type == 'BSDF_PRINCIPLED':
            return {name: plain(node.inputs[name].default_value)
                    for name in ('Base Color', 'Metallic', 'Roughness', 'Alpha',
                                 'Transmission Weight') if name in node.inputs}
    return None


def verify(unit_type, variant):
    unit = unit_type.lower()
    out = ROOT / f'assets/models/acro-river-park/{unit}/{REVISION}/{variant}'
    stem = f'acro{unit}-{variant}-archisketch'
    paths = {'blend': out / (stem + '.blend'), 'glb': out / (stem + '.glb'),
             'metadata': out / 'model-info.json', 'topview': out / 'top-view.png',
             'spec': SPECS / f'acro{unit}-{variant}-archisketch-v1.json'}
    raw_dir = WORKSPACE / f'AisideProject/datasets/acro-river-park/raw/archisketch/{unit_type}/{variant}/2026-11-02-user-saved'
    paths.update(summary=raw_dir / 'project-summary.json',
                 layout=raw_dir / 'furniture-layout.json')
    checks = []

    def check(name, condition, **detail):
        checks.append({'name': name, 'passed': bool(condition), **detail})

    report = {
        'schema_version': 1, 'unit_type': unit_type, 'variant': variant,
        'revision': REVISION, 'verified_at_utc': datetime.now(timezone.utc).isoformat(),
        'device': 'CPU', 'cuda_visible_devices': os.environ['CUDA_VISIBLE_DEVICES'],
        'rendered': False, 'actual_glb_reimport': False,
        'scope': 'saved BLEND and actual GLB reimport against archived Archisketch source coordinates and placed item dimensions',
        'independent_field_measurement': False, 'actual_unit_renovation_confirmed': False,
        'blender_version': bpy.app.version_string,
        'paths': {key: str(path) for key, path in paths.items()}, 'checks': checks,
    }
    try:
        for key, path in paths.items():
            check('required file / ' + key, path.is_file())
        if not all(path.is_file() for path in paths.values()):
            raise FileNotFoundError('New model package incomplete; required files listed in checks')
        info = json.loads(paths['metadata'].read_text())
        spec = json.loads(paths['spec'].read_text())
        raw = payload(paths['summary'])
        layout = payload(paths['layout'])
        raw_rooms = {room['archiId']: room for room in raw['floorplans'][0]['rooms']}
        raw_openings = {op['archiId']: op for op in raw['floorplans'][0]['openings']}
        placed = {item['archiId']: item for item in layout['floorplans'][0]['items']}
        hashes = {key: sha256(path) for key, path in paths.items()}
        report['file_sha256'] = hashes
        check('unit, variant, revision, and meter metadata', info.get('unit_type') == unit_type
              and info.get('variant') == variant and info.get('revision') == REVISION
              and info.get('units') == 'm')
        for key, field in [('blend', 'blend_sha256'), ('glb', 'glb_sha256'),
                           ('spec', 'spec_sha256'), ('summary', 'source_summary_sha256'),
                           ('layout', 'source_layout_sha256'), ('topview', 'topview_sha256')]:
            check('metadata SHA256 / ' + key, info.get(field) == hashes[key],
                  expected=hashes[key], recorded=info.get(field))
        for key, field in [('summary', 'source_summary_sha256'), ('layout', 'source_layout_sha256')]:
            check('spec source SHA256 / ' + key, spec.get(field) == hashes[key])
        check('metadata finite numbers', finite_nested(info))
        check('source origin retained in metadata', info.get('origin_mm') == spec.get('origin_mm')
              and len(info.get('origin_mm', [])) == 2, origin_mm=info.get('origin_mm'))
        check('no field exactness asserted', info.get('independent_as_built_validation') is False
              and info.get('actual_unit_renovation_confirmed') is not True
              and info.get('actual_unit_renovation_verified') is not True)
        origin = spec['origin_mm']
        transformed = {}
        repairs = spec.get('source_boundary_repairs', [])
        for sid, source in raw_rooms.items():
            polygon = Polygon([((point[0] - origin[0]) / 1000,
                                (point[1] - origin[1]) / 1000)
                               for point in source['polygon']])
            if not polygon.is_valid:
                check('invalid raw boundary has explicit audit / ' + sid,
                      any(repair.get('source_id') == sid for repair in repairs))
                polygon = region(make_valid(polygon))
            transformed[sid] = polygon
        check('all source room IDs represented in spec',
              {r['source_id'] for r in spec['rooms']} == set(raw_rooms))
        for room in spec['rooms']:
            sid = room['source_id']
            check('raw polygon retained / ' + room['id'],
                  room.get('source_polygon_mm') == raw_rooms[sid]['polygon'])
            check('per-room ceiling source scalar preserved / ' + room['id'],
                  abs(room['ceiling_height_m'] - raw_rooms[sid]['ceilingHeight']) < 1e-9)
        # Compare all split pieces together; no largest-component shortcut.
        expected_by_source = defaultdict(list)
        for room in spec['rooms']:
            expected_by_source[room['source_id']].append(room_region(room))
        for sid, pieces in expected_by_source.items():
            combined = unary_union(pieces)
            delta = combined.symmetric_difference(transformed[sid]).area
            distance = combined.hausdorff_distance(transformed[sid])
            check('normalized full source region / ' + sid,
                  delta <= AREA_TOL_M2 and distance <= POSITION_TOL_M,
                  symmetric_difference_m2=delta, hausdorff_m=distance)

        bpy.ops.wm.open_mainfile(filepath=str(paths['blend']))
        bpy.context.view_layer.update()
        scene = bpy.context.scene
        check('BLEND metric units and scale one', scene.unit_settings.system == 'METRIC'
              and scene.unit_settings.scale_length == 1)
        check('BLEND source origin retained',
              plain(scene.get('coordinate_origin_mm')) == spec['origin_mm'])
        check('BLEND CPU render device', scene.render.engine == 'CYCLES'
              and scene.cycles.device == 'CPU')
        original = {obj.name: obj for obj in scene.objects
                    if obj.type == 'MESH' and obj.get('component') not in (None, 'annotation')}
        original_snapshot = {}
        for name, obj in original.items():
            check('BLEND unit object scale / ' + name,
                  max(abs(value - 1) for value in obj.scale) <= 1e-8)
            original_snapshot[name] = {'bounds': bounds(obj),
                                       'properties': {key: plain(obj.get(key)) for key in IDENTITY_KEYS}}
        check('metadata mesh count', info.get('mesh_count') == len(original),
              metadata_count=info.get('mesh_count'), saved_count=len(original))
        report['blend_component_counts'] = dict(Counter(obj.get('component') for obj in original.values()))

        doc, chunks = glb_document(paths['glb'])
        check('GLB embedded buffers', all('uri' not in buffer for buffer in doc.get('buffers', [])))
        check('GLB embedded images', all('uri' not in image for image in doc.get('images', [])))
        check('GLB JSON finite numbers', finite_nested(doc))
        report['glb_chunks'] = chunks
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(paths['glb']))
        bpy.context.view_layer.update()
        report['actual_glb_reimport'] = True
        imported = {obj.name: obj for obj in bpy.context.scene.objects if obj.type == 'MESH'}
        check('GLB complete mesh identity set', set(imported) == set(original_snapshot),
              missing=sorted(set(original_snapshot) - set(imported)),
              unexpected=sorted(set(imported) - set(original_snapshot)))
        check('GLB contains no cameras or lights', not any(
            obj.type in ('CAMERA', 'LIGHT') for obj in bpy.context.scene.objects))
        max_delta = 0.0
        for name, obj in imported.items():
            verts = world_vertices(obj)
            check('GLB finite geometry and transforms / ' + name,
                  bool(verts) and all(math.isfinite(value) for v in verts for value in v)
                  and finite_nested(obj.matrix_world))
            check('GLB unit object scale / ' + name,
                  max(abs(value - 1) for value in obj.scale) <= 1e-6)
            check('GLB finite UV0 / ' + name,
                  bool(obj.data.uv_layers) and all(
                      math.isfinite(value) for loop in obj.data.uv_layers[0].data for value in loop.uv))
            check('GLB faces and assigned materials / ' + name,
                  len(obj.data.polygons) > 0 and len(obj.data.materials) > 0
                  and all(0 <= poly.material_index < len(obj.data.materials)
                          for poly in obj.data.polygons))
            before = original_snapshot.get(name)
            if before is not None:
                delta = max(abs(a - b) for a, b in zip(before['bounds'], bounds(obj)))
                max_delta = max(max_delta, delta)
                check('GLB world bounds roundtrip / ' + name, delta <= POSITION_TOL_M,
                      maximum_difference_m=delta)
                check('GLB component and source identities / ' + name,
                      all(plain(obj.get(key)) == value
                          for key, value in before['properties'].items()))
        report['max_glb_bounds_difference_m'] = max_delta
        report['imported_component_counts'] = dict(Counter(obj.get('component') for obj in imported.values()))
        report['imported_meshes'] = len(imported)
        report['imported_triangles'] = sum(sum(len(poly.vertices) - 2 for poly in obj.data.polygons)
                                           for obj in imported.values())
        for mat in bpy.data.materials:
            if mat.users == 0:
                continue
            inputs = principal_inputs(mat)
            check('GLB finite PBR material / ' + mat.name, inputs is not None and finite_nested(inputs)
                  and all(0 <= inputs[key] <= 1 for key in ('Metallic', 'Roughness', 'Alpha')
                          if key in inputs))

        floors = [obj for obj in imported.values() if obj.get('component') == 'floor']
        ceilings = [obj for obj in imported.values() if obj.get('component') == 'ceiling']
        active_rooms = [room for room in spec['rooms'] if room['kind'] != 'excluded']
        check('metadata active room IDs', {r['id'] for r in info['rooms']} == {r['id'] for r in active_rooms})
        check('GLB floor room IDs', {obj.get('room_id') for obj in floors} == {r['id'] for r in active_rooms})
        check('GLB ceiling room IDs', {obj.get('room_id') for obj in ceilings} == {r['id'] for r in active_rooms})
        room_checks = []
        floor_by_source = defaultdict(list)
        for room in active_rooms:
            rid = room['id']
            room_floors = [obj for obj in floors if obj.get('room_id') == rid]
            room_ceilings = [obj for obj in ceilings if obj.get('room_id') == rid]
            expected = room_region(room)
            floor = footprint(room_floors, 0)
            ceiling = footprint(room_ceilings, room['ceiling_height_m'])
            for label, actual in [('floor', floor), ('ceiling', ceiling)]:
                delta = actual.symmetric_difference(expected).area
                distance = actual.hausdorff_distance(expected)
                check('GLB source footprint ' + label + ' / ' + rid,
                      not actual.is_empty and delta <= AREA_TOL_M2 and distance <= POSITION_TOL_M,
                      expected_area_m2=expected.area, mesh_area_m2=actual.area,
                      symmetric_difference_m2=delta,
                      hausdorff_m=distance if math.isfinite(distance) else None)
            for obj in room_floors:
                box = bounds(obj)
                check('GLB floor height / ' + obj.name,
                      abs(box[2] + .02) <= POSITION_TOL_M and abs(box[5]) <= POSITION_TOL_M)
            for obj in room_ceilings:
                box = bounds(obj)
                check('GLB per-room ceiling underside / ' + obj.name,
                      abs(box[2] - room['ceiling_height_m']) <= POSITION_TOL_M,
                      underside_m=box[2], source_height_m=room['ceiling_height_m'])
            floor_by_source[room['source_id']].append(floor)
            room_checks.append({'id': rid, 'source_id': room['source_id'],
                                'area_m2': floor.area, 'ceiling_height_m': room['ceiling_height_m']})
        for sid, pieces in floor_by_source.items():
            actual = unary_union(pieces)
            delta = actual.symmetric_difference(transformed[sid]).area
            check('GLB full source floor with all split pieces / ' + sid,
                  delta <= AREA_TOL_M2, symmetric_difference_m2=delta)
        report['room_checks'] = room_checks

        excluded_expected = unary_union([room_region(room) for room in spec['rooms']
                                         if room['kind'] == 'excluded'])
        excluded_objects = [obj for obj in imported.values()
                            if obj.get('component') == 'excluded_volume']
        excluded_actual = footprint(excluded_objects, 0)
        excluded_delta = excluded_actual.symmetric_difference(excluded_expected).area
        check('GLB excluded source region footprint', excluded_delta <= AREA_TOL_M2,
              expected_area_m2=excluded_expected.area, mesh_area_m2=excluded_actual.area,
              symmetric_difference_m2=excluded_delta)

        walls = [obj for obj in imported.values() if obj.get('component') in ('wall', 'excluded_volume')]
        wall_trees = [(obj.name, BVHTree.FromPolygons(world_vertices(obj),
                      [tuple(face.vertices) for face in obj.data.polygons])) for obj in walls]
        check('source opening IDs retained without omissions',
              {op['source_id'] for op in info['openings']} == {op['source_id'] for op in spec['openings']})
        opening_checks = []
        for op in info['openings']:
            source = raw_openings[op['source_id']]
            dims = placed[op['source_id']]['dimensions']
            check('placed opening source dimensions / ' + op['id'],
                  op.get('source_scaled_item_dimensions') == dims
                  and all(abs(op[key + '_m'] - dims[key] / 1000) <= 1e-9
                          for key in ('width', 'height', 'depth')),
                  placed_instance_dimensions_mm=dims)
            center = [(source['position'][0] - origin[0]) / 1000,
                      (source['position'][2] - origin[1]) / 1000]
            check('placed opening source center / ' + op['id'],
                  max(abs(a - b) for a, b in zip(center, op['center_m'])) <= 1e-8)
            check('placed opening source rotation / ' + op['id'],
                  abs(op['source_rotation_degrees'] - source['rotation'][1]) <= 1e-8)
            members = [obj for obj in imported.values() if obj.get('opening_id') == op['id']]
            check('opening mesh identities / ' + op['id'],
                  bool(members) and set(op['mesh_names']) == {obj.name for obj in members})
            angle = math.radians(source['rotation'][1])
            along_xz = op.get('along_xz', [math.cos(angle), -math.sin(angle)])
            along = Vector((along_xz[0], -along_xz[1], 0))
            along.normalize()
            normal = Vector((-along.y, along.x, 0))
            verts = [v for obj in members for v in world_vertices(obj)]
            width = max((v.dot(along) for v in verts), default=0) - min((v.dot(along) for v in verts), default=0)
            height = max((v.z for v in verts), default=0) - min((v.z for v in verts), default=0)
            check('GLB rotated opening assembly width and height / ' + op['id'],
                  abs(width - op['width_m']) <= POSITION_TOL_M
                  and abs(height - op['height_m']) <= POSITION_TOL_M,
                  actual_width_m=width, actual_height_m=height)
            if verts:
                expected_center = Vector((center[0], -center[1], 0))
                actual_along = (max(v.dot(along) for v in verts) +
                                min(v.dot(along) for v in verts)) / 2
                actual_normal = (max(v.dot(normal) for v in verts) +
                                 min(v.dot(normal) for v in verts)) / 2
                check('GLB opening assembly placed center and bottom / ' + op['id'],
                      abs(actual_along - expected_center.dot(along)) <= POSITION_TOL_M
                      and abs(actual_normal - expected_center.dot(normal)) <= POSITION_TOL_M
                      and abs(min(v.z for v in verts) - op['bottom_m']) <= POSITION_TOL_M)
            blockers = []
            half_depth = op.get('cut_half_depth_m', spec['wall_inference'].get('opening_cut_half_depth_m', .25))
            ray_length = 2 * max(half_depth - .01, .01)
            for u in (-.42 * op['width_m'], 0, .42 * op['width_m']):
                for h in (op['bottom_m'] + .1, op['bottom_m'] + op['height_m'] - .1):
                    point = Vector((center[0], -center[1], h)) + along * u
                    start = point - normal * (ray_length / 2)
                    for name, tree in wall_trees:
                        if tree.ray_cast(start, normal, ray_length)[0] is not None:
                            blockers.append({'mesh': name, 'along_m': u, 'height_m': h})
            check('GLB structural aperture rays / ' + op['id'], not blockers, blockers=blockers)
            panels = [obj for obj in members if obj.get('component') in ('glass', 'sliding_panel')]
            if op['kind'] in ('window', 'sliding'):
                transparent = []
                for obj in panels:
                    inputs = [principal_inputs(mat) for mat in obj.data.materials]
                    transparent.append(any(v and (v.get('Alpha', 1) < 1 or
                                                  v.get('Transmission Weight', 0) > 0) for v in inputs))
                check('GLB transparent window material / ' + op['id'],
                      bool(panels) and all(transparent))
            opening_checks.append({'id': op['id'], 'source_id': op['source_id'],
                                   'width_m': width, 'height_m': height,
                                   'structural_aperture_ray_count': 6, 'blocker_count': len(blockers)})
        report['opening_checks'] = opening_checks
        png = paths['topview'].read_bytes()
        check('topview PNG with finite nonzero dimensions', png[:8] == b'\x89PNG\r\n\x1a\n'
              and len(png) >= 24 and min(struct.unpack('>II', png[16:24])) > 0,
              dimensions_px=list(struct.unpack('>II', png[16:24])) if len(png) >= 24 else None)
    except Exception as exc:
        check('verification execution completed', False, error=repr(exc), traceback=traceback.format_exc())
    report['passed'] = bool(checks) and all(item['passed'] for item in checks)
    report['status'] = 'passed' if report['passed'] else 'failed'
    report['check_count'] = len(checks)
    report['failures'] = [item for item in checks if not item['passed']]
    save_json(EVIDENCE / f'{unit}-{variant}-glb-reimport.json', report)
    save_json(out / 'glb-verification.json', report)
    print(json.dumps({'unit_type': unit_type, 'variant': variant, 'passed': report['passed'],
                      'actual_glb_reimport': report['actual_glb_reimport'],
                      'checks': report['check_count'], 'failures': report['failures'],
                      'evidence': str(EVIDENCE / f'{unit}-{variant}-glb-reimport.json')},
                     ensure_ascii=False), flush=True)
    return report['passed']


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--unit-type', choices=['145F', '168D', 'all'], default='all')
    parser.add_argument('--variant', choices=['basic', 'expanded', 'both'], default='both')
    args = parser.parse_args()
    units = ['145F', '168D'] if args.unit_type == 'all' else [args.unit_type]
    variants = ['basic', 'expanded'] if args.variant == 'both' else [args.variant]
    results = [verify(unit, variant) for unit in units for variant in variants]
    raise SystemExit(0 if all(results) else 1)
