#!/usr/bin/env python3
"""Build the unfurnished 168C expanded review draft with Blender 4.5.

Run: uv run --python 3.11 --with bpy==4.5.3 python tools/blender/build_acro168c_structure.py
Source screenshots stay in the private reference workspace, outside exported assets.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
SPECS = Path(__file__).resolve().parent / 'specs'


def save_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/models/acro-river-park/168c/structural-v0/expanded')
    parser.add_argument('--skip-render', action='store_true')
    parser.add_argument('--layout', type=Path, default=SPECS / 'acro168c-expanded-layout-v0.json')
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    spec_path = SPECS / 'acro168c-expanded-dimensions.json'
    layout_path = args.layout.resolve()
    spec, layout = json.loads(spec_path.read_text()), json.loads(layout_path.read_text())
    cal = layout['calibration']
    mx = lambda p: float(np.interp(p, cal['x_px'], cal['x_m']))
    my = lambda p: float(np.interp(p, cal['y_px'], cal['y_m']))
    height = spec['ceiling']['height_m']
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = 'METERS'
    scene['unit_type'] = '168C'
    scene['variant'] = 'expanded'
    scene['revision'] = layout.get('revision', 'structural-v0')
    scene['geometry_status'] = 'draft_reference_lines_and_thickness_not_surveyed'
    scene['ceiling_height_m'] = height
    scene['coordinate_convention'] = layout['coordinate_convention']
    collections = {}
    for name in ['01_Floor', '02_Walls', '03_Doors', '04_Windows', '05_Ceiling', '06_Excluded', '07_Fixtures', '90_Review_labels', '99_Presentation']:
        c = bpy.data.collections.new(name)
        scene.collection.children.link(c)
        collections[name] = c

    def mat(name, color, roughness=.75, metallic=0):
        m = bpy.data.materials.new(name)
        m.diffuse_color = (*color, 1)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = (*color, 1)
        bsdf.inputs['Roughness'].default_value = roughness
        bsdf.inputs['Metallic'].default_value = metallic
        return m

    floor_mat = mat('Draft / floor neutral', (.53, .56, .57))
    wall_mat = mat('Draft / walls', (.82, .84, .83))
    door_mat = mat('User nominal dimension / door', (.21, .42, .47))
    frame_mat = mat('Configured window / frame', (.10, .23, .29), .4, .12)
    placeholder_mat = mat('Unresolved opening / provisional frame', (.65, .35, .13))
    glass_mat = mat('Draft full window span / not passage', (.40, .67, .76), .23)
    # Opaque pale blue is deliberate in this structural review, not a glass render.
    shaft_mat = mat('Non-occupiable / plan X zones', (.28, .32, .34))
    storage_mat = mat('Draft / fixed storage', (.62, .52, .38))
    ceramic_mat = mat('Draft / shower base', (.77, .83, .84))
    metal_mat = mat('Draft / fixture metal', (.32, .40, .42), .28, .5)
    thin_glass = mat('Draft / shower and sliding glass', (.44, .72, .80), .15)
    thin_glass.diffuse_color = (.44, .72, .80, .24)
    shader = thin_glass.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Alpha'].default_value = .24
    shader.inputs['Transmission Weight'].default_value = .65
    if hasattr(thin_glass, 'surface_render_method'):
        thin_glass.surface_render_method = 'DITHERED'
    text_mat = mat('Review ink', (.025, .07, .09))
    zone_materials = {
        'interior': mat('Review / rooms', (.69, .74, .70)),
        'wet': mat('Review / bathrooms', (.49, .66, .70)),
        'entry': mat('Review / entry', (.70, .68, .62)),
        'circulation': mat('Review / circulation', (.70, .72, .69)),
        'open_zone': mat('Review / living and kitchen', (.79, .74, .61)),
        'utility': mat('Review / utility', (.63, .69, .68)),
        'balcony': mat('Review / balcony', (.61, .72, .77)),
    }

    def move_collection(obj, collection):
        for c in list(obj.users_collection):
            c.objects.unlink(obj)
        collections[collection].objects.link(obj)

    def box(name, dims, loc, material, collection, **props):
        assert min(dims) > 0, (name, dims)
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
        obj = bpy.context.object
        obj.name = name
        obj.dimensions = dims
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        move_collection(obj, collection)
        obj.data.materials.append(material)
        for k, v in props.items():
            obj[k] = v
        return obj

    def slab(name, z_bottom, z_top, material, collection):
        points = [(mx(x), -my(y)) for x, y in layout['outline_px']]
        n = len(points)
        vertices = [(x, y, z_bottom) for x, y in points] + [(x, y, z_top) for x, y in points]
        # Plan y points down; points are clockwise in Blender xy.
        faces = [tuple(range(n)), tuple(range(2*n-1, n-1, -1))]
        faces += [(i, n+i, n+(i+1) % n, (i+1) % n) for i in range(n)]
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        collections[collection].objects.link(obj)
        obj.data.materials.append(material)
        obj['component'] = 'ceiling' if z_bottom > 0 else 'floor'
        mod = obj.modifiers.new('Triangulate concave footprint', 'TRIANGULATE')
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=mod.name)
        obj.select_set(False)
        return obj

    floor = slab('Floor / footprint is not certified area', -.12, 0, floor_mat, '01_Floor')
    ceiling = slab('Ceiling / underside 2.500m / hidden for review', height, height+.08, wall_mat, '05_Ceiling')
    ceiling['underside_m'] = height
    ceiling.hide_render = True
    ceiling.hide_set(True)

    # Colored floor zones are annotations, excluded from GLB.
    rooms = []
    for room in layout['rooms']:
        x0, y0, x1, y1 = room['reference_bounds_px']
        bounds = [mx(x0), my(y0), mx(x1), my(y1)]
        a, b, c, d = bounds
        if room.get('polygon_px'):
            mesh = bpy.data.meshes.new('Review zone polygon / '+room['id'])
            points = [(mx(x), -my(y), .015) for x, y in room['polygon_px']]
            mesh.from_pydata(points, [], [tuple(reversed(range(len(points))))])
            mesh.update()
            zone = bpy.data.objects.new('Review zone / '+room['id'], mesh)
            collections['90_Review_labels'].objects.link(zone)
            zone.data.materials.append(zone_materials[room['kind']])
            zone['component'] = 'annotation'
        else:
            zone = box('Review zone / '+room['id'], (c-a-.16, d-b-.16, .012), ((a+c)/2, -(b+d)/2, .007), zone_materials[room['kind']], '90_Review_labels', component='annotation')
        curve = bpy.data.curves.new('Label '+room['id'], 'FONT')
        curve.body = room['name']
        curve.align_x = 'CENTER'
        curve.align_y = 'CENTER'
        curve.size = min(.25, (c-a)/max(len(room['name'])*.5, 1))
        obj = bpy.data.objects.new('Label / '+room['id'], curve)
        collections['90_Review_labels'].objects.link(obj)
        label = room.get('label_position_px')
        obj.location = (mx(label[0]), -my(label[1]), .023) if label else ((a+c)/2, -(b+d)/2, .023)
        obj.data.materials.append(text_mat)
        # Numeric bounds are reference-line distances, not clear or usable sizes.
        clear = None
        if room['id'] in ['bedroom-1', 'bedroom-2', 'bedroom-3']:
            clear = [c-a-(.15 if room['id'] == 'bedroom-1' else .12), d-b-.15]
        rooms.append({**room, 'reference_bounds_m': bounds,
                      'reference_width_m': round(c-a, 4), 'reference_depth_m': round(d-b, 4),
                      'draft_wall_face_width_m': round(clear[0], 4) if clear else None,
                      'draft_wall_face_depth_m': round(clear[1], 4) if clear else None,
                      'draft_clear_basis': 'main wall faces only; excludes piers, wardrobes and finish thickness; not surveyed' if clear else None,
                      'certified_clear_width_m': None, 'certified_clear_depth_m': None})

    wall_defs, opening_records = {}, []
    wall_meshes = []
    for wall in layout['walls']:
        h = wall['axis'] == 'h'
        cv = mx if h else my
        constant = my(wall['constant_px']) if h else mx(wall['constant_px'])
        start, end = cv(wall['start_px']), cv(wall['end_px'])
        t = wall['thickness_m']
        wh = wall.get('height_m', height)
        wm = thin_glass if wall.get('material') == 'glass' else wall_mat
        wc = wall.get('component', 'wall')
        wall_defs[wall['id']] = {**wall, 'start_m': start, 'end_m': end, 'constant_m': constant}

        def wall_box(name, left, right, z0, z1, material=wm, collection='02_Walls', **props):
            if right-left < 1e-6 or z1-z0 < 1e-6:
                return None
            dims = (right-left, t, z1-z0) if h else (t, right-left, z1-z0)
            loc = ((left+right)/2, -constant, (z0+z1)/2) if h else (constant, -(left+right)/2, (z0+z1)/2)
            return box(name, dims, loc, material, collection, **props)

        holes = sorted([o for o in layout['openings'] if o['wall_id'] == wall['id']], key=lambda o: o['center_px'])
        cursor = start
        for opening in holes:
            oid = opening['id']
            center = cv(opening['center_px'])
            ow, oh, sill = opening['cut_width_m'], opening['cut_height_m'], opening['bottom_m']
            left, right = center-ow/2, center+ow/2
            assert left >= cursor-1e-5 and right <= end+1e-5, (oid, 'opening outside wall or overlap', left, right, cursor, end)
            assert 0 <= sill < sill+oh <= wh+1e-5, (oid, 'opening outside ceiling')
            for n, lo, hi, z0, z1 in [('before', cursor, left, 0, wh), ('sill', left, right, 0, sill), ('lintel', left, right, sill+oh, wh)]:
                obj = wall_box(wall['id']+'/'+oid+'/'+n, lo, hi, z0, z1, wall_id=wall['id'], component=wc)
                if obj:
                    wall_meshes.append(obj)
            location = [center, -constant, sill] if h else [constant, -center, sill]
            record = {**opening, 'center_axis_m': center, 'blender_location_m': location,
                      'axis': wall['axis'], 'effective_clear_opening_m': None, 'mesh_objects': []}
            if opening['kind'] == 'door':
                lw, lh = opening['leaf_width_m'], opening['leaf_height_m']
                # Frame around a leaf; nominal leaf dimensions remain exact at any swing angle.
                for n, lo, hi, z0, z1 in [('jamb-left', left, left+.02, 0, oh), ('jamb-right', right-.02, right, 0, oh), ('head', left+.02, right-.02, lh, oh)]:
                    frame = wall_box(oid+'/'+n, lo, hi, z0, z1, frame_mat, '03_Doors', component='door_frame', opening_id=oid)
                    record['mesh_objects'].append(frame.name)
                hinge_end = opening.get('hinge_side') == 'end'
                base_angle = (0 if h else -math.pi/2) + (math.pi if hinge_end else 0)
                theta = math.radians(opening['swing_degrees']) + base_angle
                hinge_axis = right-.02 if hinge_end else left+.02
                hinge = Vector((hinge_axis, -constant, sill+lh/2)) if h else Vector((constant, -hinge_axis, sill+lh/2))
                leaf = box(oid+'/leaf', (lw, .035, lh), hinge + Vector((math.cos(theta)*lw/2, math.sin(theta)*lw/2, 0)), thin_glass if opening.get('leaf_material') == 'glass' else door_mat, '03_Doors', component='door_leaf', opening_id=oid, nominal_width_m=lw, nominal_height_m=lh, clearance_confirmed=False)
                leaf.rotation_euler.z = theta
                record['mesh_objects'].append(leaf.name)
                record['leaf_mesh_name'] = leaf.name
                record['hinge_blender_m'] = list(hinge)
                record['swing_degrees'] = opening['swing_degrees']
                record['hinge_side'] = opening.get('hinge_side', 'start')
                # A small pull makes the new cupboard and service doors legible.
                handle = box(oid+'/handle', (.035, .075, .15), (0,0,0), metal_mat, '03_Doors', component='door_handle', opening_id=oid)
                handle.parent = leaf
                handle.location = (lw/2-.1, -.045, 1.05-lh/2)
                record['mesh_objects'].append(handle.name)
            elif opening['kind'] == 'passage':
                for n, lo, hi, z0, z1 in [('frame-left', left, left+.02, 0, oh), ('frame-right', right-.02, right, 0, oh), ('frame-top', left+.02, right-.02, oh-.02, oh)]:
                    frame = wall_box(oid+'/'+n, lo, hi, z0, z1, storage_mat, '03_Doors', component='passage_frame', opening_id=oid)
                    record['mesh_objects'].append(frame.name)
            else:
                span = opening['window_span_m']
                sw, sh = span if span else (ow-.12, oh-.12)
                fx, fz = (ow-sw)/2, (oh-sh)/2
                assert fx > 0 and fz > 0, (oid, 'frame must surround span')
                material = placeholder_mat if opening['provisional'] else frame_mat
                for n, lo, hi, z0, z1 in [('frame-left', left, left+fx, sill, sill+oh), ('frame-right', right-fx, right, sill, sill+oh), ('frame-bottom', left+fx, right-fx, sill, sill+fz), ('frame-top', left+fx, right-fx, sill+oh-fz, sill+oh)]:
                    frame = wall_box(oid+'/'+n, lo, hi, z0, z1, material, '04_Windows', component='window_frame', opening_id=oid, provisional=opening['provisional'])
                    record['mesh_objects'].append(frame.name)
                gdims = (sw, .018, sh) if h else (.018, sw, sh)
                gloc = (center, -constant, sill+oh/2) if h else (constant, -center, sill+oh/2)
                if opening['kind'] == 'sliding_door':
                    record['panel_objects'] = []
                    travel = sw/2*opening.get('opening_fraction', .85)
                    for index in [0, 1]:
                        pc = center-sw/4 if index == 0 else center+sw/4-travel
                        normal = constant+(.024 if index else -.024)
                        dims = (sw/2+.018, .012, sh) if h else (.012, sw/2+.018, sh)
                        loc = (pc,-normal,sill+oh/2) if h else (normal,-pc,sill+oh/2)
                        panel = box(oid+f'/panel-{index}', dims, loc, thin_glass, '04_Windows', component='sliding_panel', opening_id=oid, panel_index=index, moving_panel=index==1, displacement_m=travel if index else 0.0)
                        record['mesh_objects'].append(panel.name)
                        record['panel_objects'].append(panel.name)
                        pw = sw/2+.018
                        for edge, offset, width, zc, hz in [('left', -pw/2, .026, sill+oh/2, sh), ('right', pw/2, .026, sill+oh/2, sh), ('bottom',0,pw,sill+fz+.012,.026), ('top',0,pw,sill+oh-fz-.012,.026)]:
                            dims = (width,.035,hz) if h else (.035,width,hz)
                            loc = (pc+offset,-normal,zc) if h else (normal,-pc-offset,zc)
                            sash = box(oid+f'/panel-{index}-'+edge, dims, loc, frame_mat, '04_Windows', component='sliding_frame', opening_id=oid)
                            record['mesh_objects'].append(sash.name)
                    record['draft_slide_travel_m'] = travel
                    record['movement_implemented_in_web'] = False
                else:
                    glass = box(oid+'/full-window-span', gdims, gloc, glass_mat, '04_Windows', component='window_span', opening_id=oid, dimension_basis='specified_span' if span else 'placeholder_span', clearance_confirmed=False)
                    record['mesh_objects'].append(glass.name)
                    record['span_mesh_name'] = glass.name
                record['display_span_m'] = [sw, sh]
            opening_records.append(record)
            cursor = right
        obj = wall_box(wall['id']+'/after', cursor, end, 0, wh, wall_id=wall['id'], component=wc)
        if obj:
            wall_meshes.append(obj)

    for pier in layout.get('piers', []):
        x0, y0, x1, y1 = pier['bounds_px']
        a, b, c, d = mx(x0), my(y0), mx(x1), my(y1)
        wall_meshes.append(box(pier['id'], (c-a, d-b, height), ((a+c)/2, -(b+d)/2, height/2), wall_mat, '02_Walls', component='wall_pier', source='provisional plan trace'))
    from acro168c_structure_details import add_details
    detail_records = add_details(layout, mx, my, height, box, collections,
                                 shaft_mat, storage_mat, ceramic_mat, metal_mat, text_mat)
    excluded_meshes = [bpy.data.objects[r['mesh_name']] for r in detail_records['excluded_zones']]
    bpy.context.view_layer.update()
    # Actual mesh dimensions, not just settings copied to a report.
    measured = []
    for opening in opening_records:
        oid = opening['id']
        if opening['kind'] == 'door':
            obj = bpy.data.objects[opening['leaf_mesh_name']]
            verts = [v.co for v in obj.data.vertices]
            observed = [max(v[i] for v in verts)-min(v[i] for v in verts) for i in [0, 2]]
            expected = [opening['leaf_width_m'], opening['leaf_height_m']]
            measured.append({'component': oid, 'measurement': 'local_leaf_width_height_m', 'expected': expected, 'actual': observed, 'passed': max(abs(a-b) for a,b in zip(expected, observed)) < 1e-5})
        else:
            frame_objs = [bpy.data.objects[n] for n in opening['mesh_objects'] if '/frame-' in n]
            verts = [o.matrix_world @ v.co for o in frame_objs for v in o.data.vertices]
            axis = 0 if opening['axis'] == 'h' else 1
            observed = [max(v[i] for v in verts)-min(v[i] for v in verts) for i in [axis, 2]]
            expected = [opening['cut_width_m'], opening['cut_height_m']]
            measured.append({'component': oid, 'measurement': 'frame_outer_width_height_m', 'expected': expected, 'actual': observed, 'passed': max(abs(a-b) for a,b in zip(expected, observed)) < 1e-5})
            if opening.get('window_span_m'):
                o = bpy.data.objects[opening['span_mesh_name']]
                actual = [float(o.dimensions[axis]), float(o.dimensions[2])]
                expected = opening['window_span_m']
                measured.append({'component': oid, 'measurement': 'whole_window_span_m_not_clear_opening', 'expected': expected, 'actual': actual, 'passed': max(abs(a-b) for a,b in zip(expected, actual)) < 1e-5})
        # No wall box may fill the central aperture (frames/glazing are separate objects).
        probe = Vector(opening['blender_location_m'])
        probe.z += opening['cut_height_m']/2
        blockers = []
        for obj in wall_meshes + excluded_meshes:
            corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
            if all(min(v[i] for v in corners)+1e-5 < probe[i] < max(v[i] for v in corners)-1e-5 for i in range(3)):
                blockers.append(obj.name)
        measured.append({'component': oid, 'measurement': 'wall_hole_center_unblocked', 'blockers': blockers, 'passed': not blockers})
    measured.append({'component': 'ceiling', 'measurement': 'floor_to_underside_m', 'expected': height, 'actual': min((ceiling.matrix_world @ v.co).z for v in ceiling.data.vertices), 'passed': abs(min(v.co.z for v in ceiling.data.vertices)-height) < 1e-5})
    assert all(m['passed'] for m in measured), [m for m in measured if not m['passed']]

    chain_rows = []
    for axis in ['x', 'y']:
        for i in range(len(cal[axis+'_px'])-1):
            a, b = cal[axis+'_px'][i:i+2]
            value = cal[axis+'_m'][i+1]-cal[axis+'_m'][i]
            chain_rows.append({'chain': 'adopted_'+axis, 'segment': i+1, 'source_start_px': a, 'source_end_px': b, 'label_m': round(value, 6), 'model_reference_span_m': round(value, 6), 'residual_mm': 0, 'meaning': 'calibration_constraint_not_independent_validation'})
    for side, cv in [('top', mx), ('right', my)]:
        px, mm = cal['held_out_'+side+'_px'], cal['held_out_'+side+'_mm']
        for i, label in enumerate(mm):
            value = cv(px[i+1])-cv(px[i])
            chain_rows.append({'chain': 'held_out_'+side, 'segment': i+1, 'source_start_px': px[i], 'source_end_px': px[i+1], 'label_m': label/1000, 'model_reference_span_m': round(value, 6), 'residual_mm': round(value*1000-label, 2), 'meaning': 'endpoint_interpretation_check_not_as_built_error'})
    with (out/'dimension-checks.csv').open('w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=list(chain_rows[0]))
        writer.writeheader()
        writer.writerows(chain_rows)
    with (out/'room-dimensions.csv').open('w', newline='') as f:
        keys = ['id', 'name_ko', 'reference_width_m', 'reference_depth_m', 'draft_wall_face_width_m', 'draft_wall_face_depth_m', 'certified_clear_width_m', 'certified_clear_depth_m']
        writer = csv.DictWriter(f, fieldnames=keys)
        writer.writeheader()
        writer.writerows({k:r[k] for k in keys} for r in rooms)

    save_json(out/'excluded-zones.json', detail_records['excluded_zones'])
    save_json(out/'fixtures.json', detail_records['fixtures'])
    save_json(out/'rooms.json', rooms)
    save_json(out/'openings.json', opening_records)
    save_json(out/'assumptions.json', {'assumptions': layout['assumptions'], 'all_sill_heights_provisional': True, 'clearance_checked': False, 'source_plan_sha256': layout['source_plan_sha256']})
    save_json(out/'geometry-checks.json', {'scope': 'configured_dimensions_and_draft_mesh_consistency_only', 'independent_as_built_validation': False, 'checks': measured})

    # Export only architecture, including the ceiling, with metadata for a later web stage.
    bpy.ops.object.select_all(action='DESELECT')
    architecture = []
    for name in ['01_Floor', '02_Walls', '03_Doors', '04_Windows', '05_Ceiling', '06_Excluded', '07_Fixtures']:
        for obj in collections[name].objects:
            obj.hide_set(False)
            obj.hide_render = False
            obj.select_set(True)
            architecture.append(obj)
    glb_path = out/'acro168c-expanded-structure.glb'
    bpy.ops.export_scene.gltf(filepath=str(glb_path), export_format='GLB', use_selection=True, export_extras=True, export_cameras=False, export_lights=False, export_yup=True)
    ceiling.hide_set(True)
    ceiling.hide_render = True
    bpy.ops.object.select_all(action='DESELECT')

    # Review cameras and neutral illumination are not included in the GLB.
    scene.world = bpy.data.worlds.new('Review daylight')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (.70, .77, .85, 1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = .65
    light_data = bpy.data.lights.new('Review area', 'AREA')
    light_data.energy = 2300
    light_data.shape = 'DISK'
    light_data.size = 12
    light = bpy.data.objects.new('Review area', light_data)
    collections['99_Presentation'].objects.link(light)
    light.location = (5, -3, 14)
    sun_data = bpy.data.lights.new('Review sun', 'SUN')
    sun_data.energy = 1.3
    sun_data.angle = math.radians(15)
    sun = bpy.data.objects.new('Review sun', sun_data)
    collections['99_Presentation'].objects.link(sun)
    sun.rotation_euler = (math.radians(25), math.radians(-25), math.radians(-35))
    target = Vector((10.25, -5.755, .6))

    def camera(name, loc, ortho):
        data = bpy.data.cameras.new(name)
        obj = bpy.data.objects.new(name, data)
        collections['99_Presentation'].objects.link(obj)
        obj.location = loc
        obj.rotation_euler = (target-obj.location).to_track_quat('-Z', 'Y').to_euler()
        data.type = 'ORTHO'
        data.ortho_scale = ortho
        data.clip_end = 200
        return obj

    top = camera('Review / plan', (10.25, -5.755, 32), 23.4)
    iso = camera('Review / isometric', (25, -24, 25), 26.5)
    scene.camera = iso
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 20
    scene.cycles.use_denoising = True
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 8
    scene.render.resolution_x = 1440
    scene.render.resolution_y = 960
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX'
    scene.render.filepath = str(out/'isometric.png')
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                space = area.spaces.active
                space.shading.type = 'MATERIAL'
                space.region_3d.view_location = target
                space.region_3d.view_distance = 24
                space.region_3d.view_rotation = iso.rotation_euler.to_quaternion()
                space.clip_end = 200
    blend_path = out/'acro168c-expanded-structure.blend'
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    if not args.skip_render:
        for cam, filename in [(top, 'top-view.png'), (iso, 'isometric.png')]:
            for obj in wall_meshes:
                if obj.name.endswith('/lintel'):
                    obj.hide_render = cam == top
            scene.camera = cam
            scene.render.filepath = str(out/filename)
            bpy.ops.render.render(write_still=True)
    save_json(out/'model-info.json', {
        'schema_version': 1, 'unit_type': '168C', 'variant': 'expanded', 'stage': layout['stage'], 'revision': layout.get('revision', 'structural-v0'),
        'units': 'm', 'blender_version': bpy.app.version_string, 'web_integration_status': 'not_integrated',
        'ceiling_height_m': height, 'architecture_mesh_count': len(architecture), 'excluded_zone_count': len(detail_records['excluded_zones']),
        'source_plan_sha256': layout['source_plan_sha256'],
        'dimension_spec_sha256': hashlib.sha256(spec_path.read_bytes()).hexdigest(),
        'layout_spec_sha256': hashlib.sha256(layout_path.read_bytes()).hexdigest(),
        'blend_sha256': hashlib.sha256(blend_path.read_bytes()).hexdigest(),
        'glb_sha256': hashlib.sha256(glb_path.read_bytes()).hexdigest(),
        'geometry_check_count': len(measured), 'geometry_checks_passed': all(m['passed'] for m in measured),
        'ceiling_visibility': 'hidden in blend review; present in GLB with component=ceiling',
        'source_screenshot_textures_included': False,
        'limitation': 'Reference lines, wall thicknesses, unmeasured openings and sill levels are draft interpretations. Not a certified as-built model.'
    })
    print(json.dumps({'output': str(out), 'checks_passed': len(measured), 'meshes': len(architecture)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
