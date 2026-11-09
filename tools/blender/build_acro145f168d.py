#!/usr/bin/env python3
"""CPU-only source-coordinate 145F/168D shells; existing generators are read-only.

Uses the shared polygon helpers, with exact opening rotations, per-room ceilings,
source-instance opening dimensions and independent exported-GLB verification.
"""
import os
os.environ['CUDA_VISIBLE_DEVICES'] = ''
import argparse
import hashlib
import json
import math
import time
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from shapely import constrained_delaunay_triangles
from shapely.geometry import Polygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

from build_acro168c_archisketch import polygons as shared_polygons
from prepare_acro145f168d import normalize, ROOT, REVISION

EVIDENCE = ROOT / 'runtime/floor-interior/2026-11-02-user-models/s2'
UV_TILE_M = 1.2


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def polygon_surfaces(geometry):
    """Keep all area-bearing parts; boolean boundaries can also contain lines."""
    if geometry.is_empty:
        return []
    if geometry.geom_type in ('Polygon', 'MultiPolygon'):
        return shared_polygons(geometry)
    return [p for g in getattr(geometry, 'geoms', []) for p in polygon_surfaces(g)]


def build(unit_type, variant, render=True):
    started = time.monotonic()
    spec_path = normalize(unit_type, variant)
    spec = json.loads(spec_path.read_text())
    key = unit_type.lower()
    out = ROOT / f'assets/models/acro-river-park/{key}/{REVISION}/{variant}'
    out.mkdir(parents=True, exist_ok=True)
    stem = f'acro{key}-{variant}-archisketch'
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1
    scene.unit_settings.length_unit = 'METERS'
    for k, v in dict(unit_type=unit_type, variant=variant, revision=REVISION,
                     coordinate_origin_mm=spec['origin_mm'], independent_field_measurement=False,
                     geometry_status='source_coordinates_with_inferred_walls_not_as_built').items():
        scene[k] = v
    groups = {}
    for name in ['01_Floor', '02_Walls', '03_Openings', '04_Excluded', '05_Ceiling', '90_Review', '99_Lights']:
        groups[name] = bpy.data.collections.new(name)
        scene.collection.children.link(groups[name])

    def material(name, color, roughness=.75, alpha=1, role=None):
        mat = bpy.data.materials.new(name)
        mat.diffuse_color = (*color, alpha)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes['Principled BSDF']
        bsdf.inputs['Base Color'].default_value = (*color, 1)
        bsdf.inputs['Roughness'].default_value = roughness
        bsdf.inputs['Metallic'].default_value = 0
        bsdf.inputs['Alpha'].default_value = alpha
        if alpha < 1:
            mat.surface_render_method = 'DITHERED'
        mat['surface_role'] = role or name
        mat['material_basis'] = 'structural_preview_assumption_not_photo_reconstruction'
        mat['texture_repeat_m'] = UV_TILE_M
        return mat

    mats = {
        'wall': material('Structure / ivory', (.82, .80, .74), role='wall'),
        'excluded': material('Structure / non-occupiable', (.22, .26, .29), role='excluded'),
        'living': material('Structure / living floor', (.62, .52, .39), role='floor'),
        'bedroom': material('Structure / bedroom floor', (.60, .47, .32), role='floor'),
        'wet': material('Structure / wet floor', (.52, .54, .52), role='floor'),
        'balcony': material('Structure / balcony floor', (.58, .60, .56), role='floor'),
        'utility': material('Structure / utility floor', (.64, .64, .57), role='floor'),
        'storage': material('Structure / storage floor', (.61, .52, .40), role='floor'),
        'door': material('Structure / wood door', (.31, .18, .085), .65, role='door'),
        'frame': material('Structure / opening frame', (.68, .67, .61), .55, role='frame'),
        'glass': material('Structure / transparent glazing', (.68, .81, .86), .18, .22, role='glass'),
    }

    def prism(name, polygon, z0, z1, mat, group, **props):
        p = orient(polygon, sign=1)
        points, lookup = [], {}
        def index(xy):
            v = tuple(round(float(t), 9) for t in xy)
            if v not in lookup:
                lookup[v] = len(points)
                points.append(v)
            return lookup[v]
        rings = [[index(v) for v in list(r.coords)[:-1]] for r in [p.exterior, *p.interiors]]
        triangles = [[index(v) for v in list(orient(t, sign=1).exterior.coords)[:3]]
                     for t in constrained_delaunay_triangles(p).geoms]
        n = len(points)
        faces = []
        for a, b, c in triangles:
            faces.extend([(a, b, c), (a+n, c+n, b+n)])
        for ring in rings:
            for i, a in enumerate(ring):
                b = ring[(i+1) % len(ring)]
                faces.append((a, a+n, b+n, b))
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([(x, -z, h) for h in (z0, z1) for x, z in points], [], faces)
        mesh.update()
        uv = mesh.uv_layers.new(name='UVMap')
        for face in mesh.polygons:
            dominant = max(range(3), key=lambda i: abs(face.normal[i]))
            axes = (0, 1) if dominant == 2 else (0, 2) if dominant == 1 else (1, 2)
            for li in face.loop_indices:
                v = mesh.vertices[mesh.loops[li].vertex_index].co
                uv.data[li].uv = (v[axes[0]] / UV_TILE_M, v[axes[1]] / UV_TILE_M)
        obj = bpy.data.objects.new(name, mesh)
        groups[group].objects.link(obj)
        obj.data.materials.append(mat)
        obj['uv_basis'] = 'planar_projection_1.2m_per_uv_unit_not_measured_material_grain'
        for k, v in props.items():
            if v is not None:
                obj[k] = v
        return obj

    def multi(name, geometry, bottom, top, mat, group, **props):
        return [prism(f'{name}/{i:02d}', p, bottom, top, mat, group, **props)
                for i, p in enumerate(polygon_surfaces(geometry)) if p.area > 1e-10]

    room_geoms = {r['id']: Polygon(r['polygon_m'], r.get('holes_m', [])) for r in spec['rooms']}
    if any(not p.is_valid for p in room_geoms.values()):
        raise ValueError('Prepared geometry must already be valid; builder never repairs source geometry')
    all_regions = unary_union(list(room_geoms.values()))
    active = [r for r in spec['rooms'] if r['kind'] != 'excluded']
    excluded_rooms = [r for r in spec['rooms'] if r['kind'] == 'excluded']
    excluded = unary_union([room_geoms[r['id']] for r in excluded_rooms])
    band = spec['wall_inference']['external_buffer_m']
    footprint = all_regions.buffer(band, join_style='mitre')
    wall_plan = footprint.difference(all_regions)
    maximum_height = max(r['ceiling_height_m'] for r in spec['rooms'])
    multi('Base', footprint, -.15, -.02, mats['wall'], '01_Floor', component='base', collision=False)
    records = []
    for r in active:
        p = room_geoms[r['id']]
        lo_x, lo_z, hi_x, hi_z = p.bounds
        prism('Floor/' + r['id'], p, -.02, 0, mats[r['kind']], '01_Floor',
              component='floor', room_id=r['id'], source_id=r['source_id'], room_name=r['name'])
        prism('Ceiling/' + r['id'], p, r['ceiling_height_m'], r['ceiling_height_m']+.07,
              mats['wall'], '05_Ceiling', component='ceiling', room_id=r['id'],
              source_id=r['source_id'], underside_m=r['ceiling_height_m'],
              height_basis='source_room_ceilingHeight_interpreted_meters')
        records.append({**r, 'polygon_area_m2':p.area, 'bounds_m':list(p.bounds),
                        'bbox_width_m':hi_x-lo_x, 'bbox_depth_m':hi_z-lo_z,
                        'representative_point_m':list(p.representative_point().coords)[0]})
    for r in excluded_rooms:
        prism('Non-occupiable/' + r['id'], room_geoms[r['id']], 0, r['ceiling_height_m'],
              mats['excluded'], '04_Excluded', component='excluded_volume', collision=True,
              room_id=r['id'], source_id=r['source_id'])

    def oriented_rectangle(center, along, normal, width, depth):
        x, z = center
        return Polygon([(x + a*width/2*along[0] + n*depth/2*normal[0],
                         z + a*width/2*along[1] + n*depth/2*normal[1])
                        for a, n in [(-1,-1), (1,-1), (1,1), (-1,1)]])

    openings, errors = [], []
    for source in spec['openings']:
        o = dict(source)
        angle = math.radians(o['source_rotation_degrees'])
        along, normal = [math.cos(angle), -math.sin(angle)], [math.sin(angle), math.cos(angle)]
        depth = max(spec['wall_inference'].get('opening_cut_half_depth_m', .25), o['depth_m']/2)
        cut = oriented_rectangle(o['center_m'], along, normal, o['width_m'], 2*depth)
        intersection = cut.intersection(wall_plan).area
        solid_overlap = cut.intersection(excluded).area
        if intersection < 1e-9:
            errors.append({'id':o['id'], 'reason':'Source opening has no inferred wall intersection', 'intersection_m2':intersection})
        if solid_overlap > .02:
            errors.append({'id':o['id'], 'reason':'Source opening intersects provisionally excluded area', 'overlap_m2':solid_overlap})
        o.update(along_xz=along, normal_xz=normal, cut_half_depth_m=depth,
                 orientation_policy='exact_source_y_rotation_baked_into_mesh_vertices',
                 wall_intersection_m2=intersection, excluded_overlap_m2=solid_overlap,
                 mesh_names=[], _cut=cut)
        openings.append(o)
    if errors:
        write_json(EVIDENCE / f'{key}-{variant}-build-errors.json', {'errors':errors})
        raise ValueError(json.dumps(errors, ensure_ascii=False))

    levels = sorted(set([0, maximum_height] + [r['ceiling_height_m'] for r in spec['rooms']] +
                        [h for o in openings for h in [o['bottom_m'], o['bottom_m']+o['height_m']]]))
    for i, (z0, z1) in enumerate(zip(levels, levels[1:])):
        if z1-z0 < 1e-7:
            continue
        mid = (z0+z1)/2
        # Bands adjacent to taller source rooms continue above lower ceilings.
        continuing = [room_geoms[r['id']].buffer(band, join_style='mitre')
                      for r in spec['rooms'] if r['ceiling_height_m'] >= mid]
        layer_plan = wall_plan.intersection(unary_union(continuing))
        cuts = [o['_cut'] for o in openings if o['bottom_m'] <= mid <= o['bottom_m']+o['height_m']]
        if cuts:
            layer_plan = layer_plan.difference(unary_union(cuts))
        multi(f'Wall/layer-{i:02d}', layer_plan, z0, z1, mats['wall'], '02_Walls',
              component='wall', collision=True, inferred_wall=True, layer_bottom_m=z0,
              layer_top_m=z1, height_basis='maximum_adjacent_source_room_height')

    for o in openings:
        x, z = o['center_m']
        w, h, b = o['width_m'], o['height_m'], o['bottom_m']
        along, normal = o['along_xz'], o['normal_xz']
        def part(name, u, width, bottom, height, mat, depth=.08, offset=0, component='opening_frame', **props):
            center = [x+u*along[0]+offset*normal[0], z+u*along[1]+offset*normal[1]]
            p = oriented_rectangle(center, along, normal, width, depth)
            obj = prism(o['id']+'/'+name, p, bottom, bottom+height, mat, '03_Openings',
                        component=component, opening_id=o['id'], source_opening_id=o['source_id'],
                        dimension_basis='source_scaled_item_with_assumed_visual_frame', **props)
            o['mesh_names'].append(obj.name)
            return obj
        if o['kind'] == 'door':
            leaf_w, leaf_h = o['leaf_width_m'], o['leaf_height_m']
            fw = (w-leaf_w)/2
            part('jamb-left', -w/2+fw/2, fw, b, h, mats['frame'])
            part('jamb-right', w/2-fw/2, fw, b, h, mats['frame'])
            part('head', 0, leaf_w, b+leaf_h, h-leaf_h, mats['frame'])
            part('leaf', 0, leaf_w, b, leaf_h, mats['door'], depth=.035, component='door_leaf',
                 modeled_width_m=leaf_w, modeled_height_m=leaf_h, hinge_status='unresolved',
                 finish_basis='assumed_brown_wood_appearance_not_source_material_measurement')
        else:
            clear_w, clear_h = o['clear_span_m']
            fw, fh = (w-clear_w)/2, (h-clear_h)/2
            part('frame-left', -w/2+fw/2, fw, b, h, mats['frame'])
            part('frame-right', w/2-fw/2, fw, b, h, mats['frame'])
            part('frame-bottom', 0, clear_w, b, fh, mats['frame'])
            part('frame-top', 0, clear_w, b+h-fh, fh, mats['frame'])
            for j in (0,1):
                part(f'glass-{j}', (-1 if j==0 else 1)*clear_w/4, clear_w/2,
                     b+fh, clear_h, mats['glass'], depth=.012, offset=.018*(-1 if j==0 else 1),
                     component='sliding_panel' if o['kind']=='sliding' else 'glass', panel_index=j)
            part('mullion', 0, .022, b+fh, clear_h, mats['frame'])

    bpy.context.view_layer.update()
    wall_trees = [(o.name, BVHTree.FromPolygons([o.matrix_world@v.co for v in o.data.vertices],
                   [list(p.vertices) for p in o.data.polygons]))
                  for c in ['02_Walls','04_Excluded'] for o in groups[c].objects]
    opening_checks = []
    for o in openings:
        blockers = []
        x, z = o['center_m']
        a, n = o['along_xz'], o['normal_xz']
        half = min(.24, o['cut_half_depth_m']-.005)
        for u in [-o['width_m']*.42, 0, o['width_m']*.42]:
            for height in [o['bottom_m']+.1, o['bottom_m']+o['height_m']-.1]:
                ray_origin = Vector((x+u*a[0]-half*n[0], -(z+u*a[1]-half*n[1]), height))
                direction = Vector((n[0], -n[1], 0))
                for name, tree in wall_trees:
                    if tree.ray_cast(ray_origin, direction, 2*half)[0] is not None:
                        blockers.append({'mesh':name,'along_m':u,'height_m':height})
        opening_checks.append({'id':o['id'], 'source_id':o['source_id'], 'wall_clearance_rays':6,
                               'blockers':blockers, 'placed_dimensions_exact':True})
        o['clear_passage_verified'] = not blockers
        o['clear_passage_scope'] = 'six structural aperture rays only; not walkability or door operation validation'
        if blockers:
            errors.append({'id':o['id'],'reason':'Structural aperture ray blocked','blockers':blockers})
        del o['_cut']
    floor_checks = []
    for r in records:
        obj = bpy.data.objects['Floor/'+r['id']]
        mesh_area = sum(p.area for p in obj.data.polygons if p.normal.z > .999)
        delta = abs(mesh_area-room_geoms[r['id']].area)
        floor_checks.append({'id':r['id'],'source_id':r['source_id'],'polygon_area_m2':room_geoms[r['id']].area,
                             'mesh_top_area_m2':mesh_area,'error_m2':delta,'ceiling_height_m':r['ceiling_height_m']})
        if delta > 1e-4:
            errors.append({'id':r['id'],'reason':'Floor area differs from normalized polygon','error_m2':delta})
    exported = [o for c in ['01_Floor','02_Walls','03_Openings','04_Excluded','05_Ceiling'] for o in groups[c].objects]
    if any(abs(v-1)>1e-9 for o in exported for v in o.scale):
        errors.append({'reason':'Non-unit object scale'})
    verification = {'unit_type':unit_type,'variant':variant,'status':'failed' if errors else 'passed',
                    'errors':errors,'units':'m','scene_scale_length':1,'device':'CPU','cuda_visible_devices':'',
                    'floor_checks':floor_checks,'opening_checks':opening_checks,
                    'scope':'source-to-mesh consistency; not field measurements or actual renovation confirmation'}
    write_json(EVIDENCE/f'{key}-{variant}-build-verification.json', verification)
    write_json(out/'verification.json', verification)
    if errors:
        raise ValueError(json.dumps(errors, ensure_ascii=False))

    bounds = footprint.bounds
    cx, cz = (bounds[0]+bounds[2])/2, (bounds[1]+bounds[3])/2
    target = Vector((cx, -cz, .3))
    def camera(name, location, scale):
        data = bpy.data.cameras.new(name)
        obj = bpy.data.objects.new(name, data)
        groups['99_Lights'].objects.link(obj)
        obj.location = location
        obj.rotation_euler = (target-obj.location).to_track_quat('-Z','Y').to_euler()
        data.type = 'ORTHO'
        data.ortho_scale = scale
        data.clip_end = 200
        return obj
    span_x, span_z = bounds[2]-bounds[0], bounds[3]-bounds[1]
    # Landscape image, preserve all source bounds with 8% margin.
    plan_scale = max(span_x, span_z*1.5)*1.08
    top = camera('Plan',(cx,-cz,35),plan_scale)
    iso = camera('Isometric',(cx+15,-cz-21,24),max(span_x,span_z)*1.9)
    scene.world = bpy.data.worlds.new('Structural preview daylight')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (.72,.78,.83,1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = .65
    for name, kind, location, energy, size in [('Sky','AREA',(cx,-cz,18),2300,14),('Sun','SUN',(cx,-cz,15),1.8,0)]:
        data = bpy.data.lights.new(name, kind)
        data.energy = energy
        if kind == 'AREA': data.size = size
        else: data.angle = .15
        obj = bpy.data.objects.new(name, data)
        groups['99_Lights'].objects.link(obj)
        obj.location = location
        obj.rotation_euler = (.3,-.4,-.2)
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 12
    scene.cycles.use_denoising = True
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 4
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'AgX'
    scene.camera = top
    scene['ceiling_visibility_policy'] = 'included_in_GLB; hidden_in_BLEND_cutaway_preview_only'
    scene['ceiling_height_policy'] = 'per_room_raw_source_values_interpreted_meters'
    scene['opening_orientation_policy'] = 'exact_source_rotation; no_cardinal_snapping'
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                space=area.spaces.active
                space.shading.type='MATERIAL'
                space.clip_end=200
                space.region_3d.view_location=target
                space.region_3d.view_distance=plan_scale
                space.region_3d.view_rotation=iso.rotation_euler.to_quaternion()
    bpy.ops.object.select_all(action='DESELECT')
    for obj in exported:
        obj.hide_set(False)
        obj.select_set(True)
    glb = out/(stem+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(glb), export_format='GLB', use_selection=True,
                              export_extras=True, export_cameras=False, export_lights=False, export_yup=True)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in groups['05_Ceiling'].objects:
        obj.hide_render=True
        obj.hide_set(True)
    bpy.context.preferences.filepaths.save_version=0
    blend=out/(stem+'.blend')
    scene.render.filepath=str(out/'top-view.png')
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    if render:
        bpy.ops.render.render(write_still=True)
    export_objects=[]
    for obj in exported:
        vertices=[obj.matrix_world@v.co for v in obj.data.vertices]
        bounds3=[[min(v[i] for v in vertices) for i in range(3)], [max(v[i] for v in vertices) for i in range(3)]]
        export_objects.append({'name':obj.name,'component':obj.get('component'),'room_id':obj.get('room_id'),
                               'source_id':obj.get('source_id'),'opening_id':obj.get('opening_id'),
                               'vertex_count':len(vertices),'bounds_blender_m':bounds3,
                               'scale':list(obj.scale),'uv_layers':[x.name for x in obj.data.uv_layers]})
    info={**spec,'rooms':records,'excluded_rooms':excluded_rooms,'openings':openings,
          'schema_version':1,'units':'m','bounds_m':list(bounds),'mesh_count':len(exported),
          'source_room_count':len(set(r['source_id'] for r in spec['rooms'])),
          'export_objects':export_objects,'issues':[], 'spec_sha256':sha(spec_path),
          'spec_path':str(spec_path.relative_to(ROOT)), 'blend_sha256':sha(blend),'glb_sha256':sha(glb),
          'render_device':'CPU','cuda_visible_devices':'','scene_scale_length':1,
          'source_to_model_scale':.001,'model_object_scale':[1,1,1],
          'independent_as_built_validation':False,'actual_unit_renovation_verified':False,
          'opening_dimension_policy':'placed_layout_instance_only; no_catalog_fallback',
          'opening_orientation_policy':'exact_source_y_rotation_baked_into_mesh_vertices',
          'ceiling_height_policy':'per_room_raw_values_preserved; wall_layers_use_maximum_adjacent_source_room_height',
          'wall_height_policy':'per_layer maximum adjacent raw source room height',
          'ceiling_visibility_policy':'GLB contains complete ceilings; BLEND viewport/render hides ceilings for review',
          'uv_policy':{'channel':0,'tile_m':UV_TILE_M,'basis':'new_planar_projection; not_source_UV_or_measured_grain'},
          'navigation_zones':[],'objects':{},
          'material_policy':'neutral structural preview; source finishes not reconstructed; surface work remains S3',
          'build_elapsed_seconds':time.monotonic()-started}
    if render:
        info['topview_sha256']=sha(out/'top-view.png')
    write_json(out/'model-info.json',info)
    write_json(EVIDENCE/f'{key}-{variant}-build-result.json',{
        'status':'passed','unit_type':unit_type,'variant':variant,'output':str(out),
        'blend_sha256':info['blend_sha256'],'glb_sha256':info['glb_sha256'],
        'metadata_sha256':sha(out/'model-info.json'),'mesh_count':len(exported),
        'openings':len(openings),'source_room_count':info['source_room_count'],
        'build_elapsed_seconds':info['build_elapsed_seconds'],'device':'CPU',
        'source_boundary_repairs':spec.get('source_boundary_repairs',[])})
    print(json.dumps({'unit_type':unit_type,'variant':variant,'output':str(out),'status':'passed',
                       'meshes':len(exported),'elapsed_seconds':info['build_elapsed_seconds']},ensure_ascii=False),flush=True)


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--unit-type',choices=['145F','168D','all'],default='all')
    parser.add_argument('--variant',choices=['basic','expanded','both'],default='both')
    parser.add_argument('--skip-render',action='store_true')
    args=parser.parse_args()
    for unit_type in ['145F','168D'] if args.unit_type=='all' else [args.unit_type]:
        for variant in ['basic','expanded'] if args.variant=='both' else [args.variant]:
            build(unit_type,variant,not args.skip_render)
