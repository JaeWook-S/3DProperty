#!/usr/bin/env python3
"""CPU-only 211A shells: reuse the shared source-coordinate builder, then preserve
per-room ceilings, refine metadata, and verify exported geometry independently.

CUDA_VISIBLE_DEVICES='' <bpy-python> tools/blender/build_acro211a.py --variant both
"""
import os
os.environ['CUDA_VISIBLE_DEVICES'] = ''
import argparse, hashlib, json, math
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from shapely import constrained_delaunay_triangles
from shapely.geometry import Polygon
from shapely.geometry.polygon import orient
from build_acro168c_archisketch import build as build_shell
from prepare_acro211a import normalize, ROOT, SPECS, REVISION


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')


def ceiling_prism(room, material, collection):
    poly=orient(Polygon(room['polygon_m']),sign=1)
    points=[];lookup={}
    def index(p):
        key=(round(p[0],9),round(p[1],9))
        if key not in lookup:lookup[key]=len(points);points.append(key)
        return lookup[key]
    rings=[[index(p) for p in list(ring.coords)[:-1]] for ring in [poly.exterior,*poly.interiors]]
    tris=[[index(p) for p in list(orient(tri,sign=1).exterior.coords)[:3]] for tri in constrained_delaunay_triangles(poly).geoms]
    n=len(points);faces=[]
    for a,b,c in tris:faces.extend([(a,b,c),(a+n,c+n,b+n)])
    for ring in rings:
        for i,a in enumerate(ring):
            b=ring[(i+1)%len(ring)];faces.append((a,a+n,b+n,b))
    h=room['ceiling_height_m']
    mesh=bpy.data.meshes.new('Ceiling/'+room['id']);mesh.from_pydata([(x,-z,y) for y in (h,h+.07) for x,z in points],[],faces);mesh.update()
    obj=bpy.data.objects.new('Ceiling/'+room['id'],mesh);collection.objects.link(obj);obj.data.materials.append(material)
    obj['component']='ceiling';obj['room_id']=room['id'];obj['underside_m']=h;obj['height_basis']='source_room_ceilingHeight_interpreted_meters';obj['source_id']=room['source_id']
    return obj


def verify_model(spec, info, out):
    errors=[]
    floor_checks=[]
    for room in info['rooms']:
        obj=bpy.data.objects['Floor/'+room['id']]
        horizontal=[face for face in obj.data.polygons if abs(face.normal.z)>.999]
        area=sum(face.area for face in horizontal)/2
        expected=Polygon(room['polygon_m']).area
        delta=abs(area-expected)
        if delta>1e-4:errors.append(f'Floor area mismatch {room["id"]}: {delta}')
        ceiling=bpy.data.objects['Ceiling/'+room['id']]
        zmin=min(v.co.z for v in ceiling.data.vertices)
        if abs(zmin-room['ceiling_height_m'])>1e-6:errors.append('Ceiling height mismatch '+room['id'])
        floor_checks.append(dict(id=room['id'],source_id=room['source_id'],polygon_area_m2=expected,mesh_area_m2=area,error_m2=delta,ceiling_height_m=zmin))
    wall_objects=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.get('component') in ('wall','excluded_volume')]
    wall_trees=[]
    for obj in wall_objects:
        verts=[obj.matrix_world@v.co for v in obj.data.vertices]
        wall_trees.append((obj.name,BVHTree.FromPolygons(verts,[list(p.vertices) for p in obj.data.polygons])))
    opening_checks=[]
    for opening in info['openings']:
        dims=opening['source_scaled_item_dimensions']
        exact=abs(opening['width_m']-dims['width']/1000)<1e-9 and abs(opening['height_m']-dims['height']/1000)<1e-9
        if not exact:errors.append('Opening dimensions differ from placed instance '+opening['id'])
        blockers=[]
        x,z=opening['center_m']
        for along in (-opening['width_m']*.42,0,opening['width_m']*.42):
            for height in (opening['bottom_m']+.10, opening['bottom_m']+opening['height_m']-.10):
                if opening['axis']=='x':origin=Vector((x+along,-(z-.24),height));direction=Vector((0,-1,0))
                else:origin=Vector((x-.24,-(z+along),height));direction=Vector((1,0,0))
                for name,tree in wall_trees:
                    hit=tree.ray_cast(origin,direction,.48)
                    if hit[0] is not None:blockers.append(dict(mesh=name,along_m=along,height_m=height))
        if blockers:errors.append('Structural cut blocked '+opening['id'])
        opening_checks.append(dict(id=opening['id'],source_id=opening['source_id'],placed_dimensions_exact=exact,width_m=opening['width_m'],height_m=opening['height_m'],wall_clearance_rays=6,blockers=blockers))
    if len(info['openings'])!=len(spec['openings']):errors.append('Builder omitted source openings')
    if info['issues']:errors.append('Builder reports source issues')
    if any(abs(v-1)>1e-9 for o in bpy.context.scene.objects if o.type=='MESH' for v in o.scale):errors.append('Non-unit object scale')
    report=dict(unit_type='211A',variant=spec['variant'],status='passed' if not errors else 'failed',errors=errors,source_room_count=len(spec['rooms']),floor_room_count=len(info['rooms']),excluded_room_count=sum(r['kind']=='excluded' for r in spec['rooms']),source_opening_count=len(spec['openings']),exported_opening_count=len(info['openings']),entrance=spec['entrance'],units='m',scene_scale_length=bpy.context.scene.unit_settings.scale_length,device='CPU',cuda_visible_devices=os.environ.get('CUDA_VISIBLE_DEVICES'),floor_checks=floor_checks,opening_checks=opening_checks,source_boundary_repairs=spec['source_boundary_repairs'],scope='source-to-mesh geometry consistency, not field measurement validation')
    save_json(ROOT/f'runtime/acro211a-verification/2026-10-26/{spec["variant"]}-verification.json',report)
    save_json(out/'verification.json',report)
    if errors:raise RuntimeError('; '.join(errors))
    return report


def build(variant, render=False):
    spec_path=normalize(variant)
    spec=json.loads(spec_path.read_text())
    build_shell(variant,skip_render=True,unit_type='211A',spec_path=spec_path,output_revision=REVISION)
    out=ROOT/f'assets/models/acro-river-park/211a/{REVISION}/{variant}'
    stem=f'acro211a-{variant}-archisketch'
    info=json.loads((out/'model-info.json').read_text())
    scene=bpy.context.scene
    ceilings=bpy.data.collections['05_Ceiling']
    material=bpy.data.materials['Structure / ivory']
    for obj in list(ceilings.objects):bpy.data.objects.remove(obj,do_unlink=True)
    for room in spec['rooms']:
        if room['kind']!='excluded':ceiling_prism(room,material,ceilings)
    # The shared builder's frame widths are visual allowances; remove its legacy
    # nominal labels so nothing implies catalog sizes or measured door leaves.
    for obj in scene.objects:
        if obj.type!='MESH':continue
        for key in ('nominal_width_m','nominal_height_m'):
            if key in obj:
                obj['modeled_'+key.removeprefix('nominal_')]=obj[key];del obj[key]
        if obj.get('opening_id'):
            opening=next(o for o in info['openings'] if o['id']==obj['opening_id'])
            obj['dimension_basis']='source_scaled_item_with_assumed_visual_frame'
            obj['source_opening_id']=opening['source_id']
    if 'Review / nominal door' in bpy.data.materials:bpy.data.materials['Review / nominal door'].name='Review / source-sized door with assumed frame'
    scene['ceiling_height_policy']=spec['ceiling_height_policy'];scene['entrance_opening_id']='door-00';scene['independent_field_measurement']=False
    scene.cycles.device='CPU';scene.render.engine='CYCLES';scene.cycles.samples=12;scene.render.threads_mode='FIXED';scene.render.threads=4
    scene.render.resolution_x=1440;scene.render.resolution_y=960
    bpy.data.objects['Isometric'].data.ortho_scale=32
    info.update({key:spec[key] for key in ('entrance','entrance_opening_id','ceiling_height_policy','ceiling_unit_validation','area_accounting','source_snapshot_paths','source_observed_at_utc','source_layout_sha256')})
    info['excluded_rooms']=[r for r in spec['rooms'] if r['kind']=='excluded']
    info['navigation_zones']=[]
    info['objects']={}
    info['source_room_count']=len(spec['rooms'])
    info['render_device']='CPU'
    info['opening_dimension_policy']='all widths and heights from placed layout instances; no catalog fallback'
    exported=[o for collection in ['01_Floor','02_Walls','03_Openings','04_Excluded','05_Ceiling'] for o in bpy.data.collections[collection].objects]
    info['mesh_count']=len(exported)
    for obj in exported:obj.hide_set(False)
    bpy.context.view_layer.update()
    verification=verify_model(spec,info,out)
    for opening in info['openings']:opening['clear_passage_verified']=True;opening['clear_passage_scope']='structural aperture rays; operable leaf/frame widths remain visual assumptions'
    bpy.ops.object.select_all(action='DESELECT')
    for obj in exported:obj.select_set(True)
    glb=out/(stem+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_extras=True,export_cameras=False,export_lights=False,export_yup=True)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in ceilings.objects:obj.hide_render=True;obj.hide_set(True)
    # Hide source coordinate review labels in the clean structural previews.
    for obj in bpy.data.collections['90_Review'].objects:obj.hide_render=True
    blend=out/(stem+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    info['blend_sha256']=hashlib.sha256(blend.read_bytes()).hexdigest();info['glb_sha256']=hashlib.sha256(glb.read_bytes()).hexdigest()
    save_json(out/'model-info.json',info)
    if render:
        scene.render.resolution_percentage=75
        for camera,filename in [('Plan','top-view.png'),('Isometric','isometric.png')]:
            scene.camera=bpy.data.objects[camera];scene.render.filepath=str(out/filename);bpy.ops.render.render(write_still=True)
    print(json.dumps({'variant':variant,'status':verification['status'],'blend':str(blend),'glb':str(glb),'openings':len(info['openings']),'bounds_m':info['bounds_m']},ensure_ascii=False),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--variant',choices=['basic','expanded','both'],default='both');parser.add_argument('--render',action='store_true');args=parser.parse_args()
    for variant in ['basic','expanded'] if args.variant=='both' else [args.variant]:build(variant,args.render)
