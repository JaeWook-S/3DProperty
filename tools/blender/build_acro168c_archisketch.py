#!/usr/bin/env python3
"""Build separate, source-coordinate 168C structural review models.

uv run --python 3.11 --with bpy==4.5.3 --with shapely==2.1.2 python tools/blender/build_acro168c_archisketch.py
"""
import argparse, csv, hashlib, json, math
from pathlib import Path
import bpy
from mathutils import Vector
from shapely import constrained_delaunay_triangles
from shapely.geometry import Polygon, MultiPolygon, GeometryCollection, box as rect
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from archisketch_metrics import require_unique_room_ids

ROOT=Path(__file__).resolve().parents[2]
SPECS=Path(__file__).resolve().parent/'specs'

def dump(path,value):
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def polygons(geom):
    if geom.is_empty:return []
    if geom.geom_type=='Polygon':return [geom]
    return [p for g in geom.geoms for p in polygons(g)]

def clean(points):
    # Preserve source coordinates, dropping only consecutive duplicate vertices.
    pts=[]
    for p in points:
        if not pts or p!=pts[-1]:pts.append(p)
    p=Polygon(pts)
    if not p.is_valid:raise ValueError('Invalid source polygon; do not silently repair or rescale')
    return orient(p,sign=1)

def build(variant,skip_render=False,unit_type="168C",spec_path=None,output_revision="archisketch-structure-v1"):
    unit_key=unit_type.lower()
    spec_path=spec_path or SPECS/f'acro{unit_key}-{variant}-archisketch-v1.json'
    spec=json.loads(spec_path.read_text());height=spec['ceiling_height_m']
    require_unique_room_ids(spec['rooms'])
    out=ROOT/f'assets/models/acro-river-park/{unit_key}/{output_revision}'/variant
    out.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene=bpy.context.scene
    scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1;scene.unit_settings.length_unit='METERS'
    scene['unit_type']=unit_type;scene['variant']=variant;scene['revision']=spec['revision']
    scene['geometry_status']='source_coordinates_with_inferred_walls_not_as_built'
    scene['ceiling_height_m']=height;scene['coordinate_origin_mm']=spec['origin_mm']
    groups={}
    for name in ['01_Floor','02_Walls','03_Openings','04_Excluded','05_Ceiling','90_Review','99_Lights']:
        c=bpy.data.collections.new(name);scene.collection.children.link(c);groups[name]=c
    def material(name,color,rough=.65,alpha=1):
        m=bpy.data.materials.new(name);m.diffuse_color=(*color,alpha);m.use_nodes=True
        n=m.node_tree.nodes['Principled BSDF'];n.inputs['Base Color'].default_value=(*color,1);n.inputs['Roughness'].default_value=rough
        n.inputs['Alpha'].default_value=alpha
        if alpha<1:m.surface_render_method='DITHERED'
        return m
    mats={'wall':material('Structure / ivory',(.84,.83,.78)),
          'excluded':material('Structure / non-occupiable',(.22,.26,.29)),
          'living':material('Review / living floor',(.67,.64,.53)),
          'bedroom':material('Review / bedroom floor',(.60,.47,.32)),
          'wet':material('Review / wet floor',(.38,.58,.60)),
          'balcony':material('Review / balcony floor',(.53,.66,.71)),
          'utility':material('Review / utility floor',(.64,.64,.57)),
          'storage':material('Review / storage floor',(.67,.58,.44)),
          'door':material('Review / nominal door',(.16,.36,.38)),
          'frame':material('Review / frame',(.66,.71,.69)),
          'glass':material('Review / glazing',(.45,.68,.77),.25,.27),
          'ink':material('Review / label',(.035,.05,.06))}
    def props(obj,fields):
        for k,v in fields.items():
            if v is not None:obj[k]=v
    def prism(name,poly,z0,z1,mat,collection,**fields):
        poly=orient(poly,sign=1);points=[];lookup={};faces=[]
        def index(p):
            key=(round(p[0],9),round(p[1],9))
            if key not in lookup:lookup[key]=len(points);points.append(key)
            return lookup[key]
        rings=[]
        for ring in [poly.exterior,*poly.interiors]:rings.append([index(p) for p in list(ring.coords)[:-1]])
        tris=[]
        for tri in constrained_delaunay_triangles(poly).geoms:
            tri=orient(tri,sign=1)
            tris.append([index(p) for p in list(tri.exterior.coords)[:3]])
        n=len(points)
        for a,b,c in tris:faces.extend([(a,b,c),(a+n,c+n,b+n)])
        for ring in rings:
            for i,a in enumerate(ring):
                b=ring[(i+1)%len(ring)];faces.append((a,a+n,b+n,b))
        verts=[(x,-y,z) for z in (z0,z1) for x,y in points]
        mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
        obj=bpy.data.objects.new(name,mesh);groups[collection].objects.link(obj);obj.data.materials.append(mat);props(obj,fields)
        return obj
    def multi(name,geom,z0,z1,mat,collection,**fields):
        return [prism(f'{name}/{i:02d}',p,z0,z1,mat,collection,**fields) for i,p in enumerate(polygons(geom)) if p.area>1e-9]
    def block(name,x,z,w,d,bottom,h,mat,**fields):
        return prism(name,rect(x-w/2,z-d/2,x+w/2,z+d/2),bottom,bottom+h,mat,'03_Openings',**fields)
    room_geoms={r['id']:clean(r['polygon_m']) for r in spec['rooms']}
    active=[r for r in spec['rooms'] if r['kind']!='excluded']
    free=unary_union([room_geoms[r['id']] for r in active])
    all_regions=unary_union(list(room_geoms.values()))
    excluded=unary_union([room_geoms[r['id']] for r in spec['rooms'] if r['kind']=='excluded'])
    # Source room polygons specify inner faces. Keep their gaps and fill outward
    # bands only; no common rectangular approximation of bedrooms or balconies.
    footprint=all_regions.buffer(spec['wall_inference']['external_buffer_m'],join_style='mitre')
    wall_plan=footprint.difference(all_regions)
    multi('Base',footprint,-.15,-.02,mats['wall'],'01_Floor',component='base',collision=False)
    records=[]
    for r in active:
        p=room_geoms[r['id']];minx,minz,maxx,maxz=p.bounds
        obj=prism('Floor/'+r['id'],p,-.02,0,mats[r['kind']],'01_Floor',component='floor',room_id=r['id'],room_name=r['name'],source_id=r['source_id'])
        records.append({**r,'polygon_area_m2':round(p.area,6),'bounds_m':[round(v,6) for v in p.bounds],'bbox_width_m':round(maxx-minx,6),'bbox_depth_m':round(maxz-minz,6),'representative_point_m':list(p.representative_point().coords)[0]})
        label=bpy.data.curves.new('Label/'+r['id'],'FONT');label.body=r['id'].replace('-',' ')+'\n'+f'{p.area:.2f} m²'
        label.align_x='CENTER';label.align_y='CENTER';label.size=.20
        obj=bpy.data.objects.new('Label/'+r['id'],label);groups['90_Review'].objects.link(obj)
        pt=p.representative_point();obj.location=(pt.x,-pt.y,.012);obj.data.materials.append(mats['ink'])
    multi('Non-occupiable',excluded,0,height,mats['excluded'],'04_Excluded',component='excluded_volume',collision=True)
    ceilings=multi('Ceiling',free,height,height+.07,mats['wall'],'05_Ceiling',component='ceiling',underside_m=height)
    openings=[];issues=list(spec['skipped_openings'])
    for o in spec['openings']:
        x,z=o['center_m'];w=o['width_m'];h=o['height_m'];bottom=o['bottom_m'];horizontal=o['axis']=='x'
        cut_depth=spec['wall_inference'].get('opening_cut_half_depth_m',.25)
        cut=rect(x-w/2,z-cut_depth,x+w/2,z+cut_depth) if horizontal else rect(x-cut_depth,z-w/2,x+cut_depth,z+w/2)
        intersection=wall_plan.intersection(cut)
        if intersection.area<.015:
            issues.append({'id':o['id'],'reason':'Opening has insufficient wall intersection; omitted instead of creating an unsupported aperture.'});continue
        if bottom+h>height+1e-7:raise ValueError((o['id'],'opening exceeds ceiling'))
        # Never cut a designated shaft/column to make a questionable opening fit.
        solid_overlap=cut.intersection(excluded).area
        if solid_overlap>.02:
            issues.append({'id':o['id'],'reason':'Opening overlaps a non-occupiable region; needs source review.','overlap_area_m2':solid_overlap});continue
        openings.append({**o,'_cut':cut,'mesh_names':[]})
    levels=sorted(set([0,height]+[v for o in openings for v in [o['bottom_m'],o['bottom_m']+o['height_m']]]))
    for i,(z0,z1) in enumerate(zip(levels,levels[1:])):
        if z1-z0<1e-6:continue
        mid=(z0+z1)/2
        holes=[o['_cut'] for o in openings if o['bottom_m']<=mid<=o['bottom_m']+o['height_m']]
        g=wall_plan.difference(unary_union(holes)) if holes else wall_plan
        multi(f'Wall/layer-{i:02d}',g,z0,z1,mats['wall'],'02_Walls',component='wall',collision=True,inferred_wall=True,layer_bottom_m=z0)
    for o in openings:
        x,z=o['center_m'];w=o['width_m'];h=o['height_m'];b=o['bottom_m'];horizontal=o['axis']=='x';kind=o['kind']
        def part(name,u,width,bottom,partheight,mat,depth=.08,normal=0,**extra):
            xx=x+u if horizontal else x+normal;zz=z+normal if horizontal else z+u
            obj=block(o['id']+'/'+name,xx,zz,width if horizontal else depth,depth if horizontal else width,bottom,partheight,mat,opening_id=o['id'],component=extra.pop('component','opening_frame'),**extra)
            o['mesh_names'].append(obj.name);return obj
        if kind=='door':
            leaf_width=o.get('leaf_width_m',.8);leaf_height=o.get('leaf_height_m',2.4)
            fw=(w-leaf_width)/2
            part('jamb-left',-w/2+fw/2,fw,b,h,mats['frame']);part('jamb-right',w/2-fw/2,fw,b,h,mats['frame'])
            part('head',0,leaf_width,b+leaf_height,.02,mats['frame'])
            part('leaf',0,leaf_width,b,leaf_height,mats['door'],.035,component='door_leaf',nominal_width_m=leaf_width,nominal_height_m=leaf_height,hinge_status='unresolved')
        else:
            clear=o.get('clear_span_m',[w-.10,h-.10]);fw=(w-clear[0])/2;fh=(h-clear[1])/2
            part('frame-left',-w/2+fw/2,fw,b,h,mats['frame']);part('frame-right',w/2-fw/2,fw,b,h,mats['frame'])
            part('frame-bottom',0,w-2*fw,b,fh,mats['frame']);part('frame-top',0,w-2*fw,b+h-fh,fh,mats['frame'])
            # Two separate glass panels retain an interpretable sliding direction.
            for j in (0,1):
                part(f'glass-{j}',(-1 if j==0 else 1)*clear[0]/4,clear[0]/2,b+fh,clear[1],mats['glass'],.012,normal=.018*(-1 if j==0 else 1),component='sliding_panel' if kind=='sliding' else 'glass',panel_index=j)
            part('mullion',0,.022,b+fh,clear[1],mats['frame'])
    bpy.context.view_layer.update()
    # Store source metadata next to the exported files for the independent verifier.
    exported=[o for c in ['01_Floor','02_Walls','03_Openings','04_Excluded','05_Ceiling'] for o in groups[c].objects]
    bpy.ops.object.select_all(action='DESELECT')
    for obj in exported:obj.select_set(True)
    stem=f'acro{unit_key}-{variant}-archisketch'
    glb=out/(stem+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_extras=True,export_cameras=False,export_lights=False,export_yup=True)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in ceilings:obj.hide_render=True;obj.hide_set(True)
    scene.world=bpy.data.worlds.new('Review daylight');scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.72,.78,.83,1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.55
    for name,kind,loc,energy,size in [('Sky','AREA',(10,-5,18),2800,14),('Sun','SUN',(0,0,15),1.8,0)]:
        data=bpy.data.lights.new(name,kind);data.energy=energy
        if kind=='AREA':data.size=size
        else:data.angle=.15
        obj=bpy.data.objects.new(name,data);groups['99_Lights'].objects.link(obj);obj.location=loc;obj.rotation_euler=(.3,-.4,-.2)
    bounds=footprint.bounds;cx=(bounds[0]+bounds[2])/2;cz=(bounds[1]+bounds[3])/2;target=Vector((cx,-cz,.3))
    def camera(name,location,scale):
        d=bpy.data.cameras.new(name);obj=bpy.data.objects.new(name,d);groups['99_Lights'].objects.link(obj);obj.location=location
        obj.rotation_euler=(target-obj.location).to_track_quat('-Z','Y').to_euler();d.type='ORTHO';d.ortho_scale=scale;d.clip_end=300
        return obj
    top=camera('Plan',(cx,-cz,35),24.5)
    iso=camera('Isometric',(cx+15,-cz-21,24),27)
    scene.camera=iso;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=16;scene.cycles.use_denoising=True
    scene.render.threads_mode='FIXED';scene.render.threads=8;scene.render.resolution_x=1600;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX'
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':
                s=area.spaces.active;s.shading.type='MATERIAL';s.clip_end=300;s.region_3d.view_location=target;s.region_3d.view_distance=25;s.region_3d.view_rotation=iso.rotation_euler.to_quaternion()
    scene.render.filepath=str(out/'isometric.png');bpy.context.preferences.filepaths.save_version=0
    blend=out/(stem+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    if not skip_render:
        for cam,filename in [(top,'top-view.png'),(iso,'isometric.png')]:
            for obj in groups['02_Walls'].objects:obj.hide_render=cam==top and obj.get('layer_bottom_m',0)>2.3
            scene.camera=cam;scene.render.filepath=str(out/filename);bpy.ops.render.render(write_still=True)
    for o in openings:o.pop('_cut')
    report={'schema_version':1,'unit_type':unit_type,'variant':variant,'revision':spec['revision'],'units':'m','ceiling_height_m':height,'origin_mm':spec.get('origin_mm'),'source_boundary_repairs':spec.get('source_boundary_repairs',[]),'source_snapshot_kind':spec['source_snapshot_kind'],'source_project_updated_at':spec['source_project_updated_at'],'spec_sha256':hashlib.sha256(spec_path.read_bytes()).hexdigest(),'source_summary_sha256':spec['source_summary_sha256'],'unit_area':spec['unit_area'],'bounds_m':list(bounds),'rooms':records,'openings':openings,'issues':issues,'wall_inference':spec['wall_inference'],'limitations':spec['limitations'],'mesh_count':len(exported),'independent_as_built_validation':False,'blend_sha256':hashlib.sha256(blend.read_bytes()).hexdigest(),'glb_sha256':hashlib.sha256(glb.read_bytes()).hexdigest()}
    dump(out/'model-info.json',report)
    print(json.dumps({'variant':variant,'blend':str(blend),'mesh_count':len(exported),'openings':len(openings),'review_issues':issues},ensure_ascii=False),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--variant',choices=['basic','expanded','both'],default='both');p.add_argument('--skip-render',action='store_true');p.add_argument('--unit-type',choices=['112A','168C'],default='168C');a=p.parse_args()
    for variant in ['basic','expanded'] if a.variant=='both' else [a.variant]:build(variant,a.skip_render,a.unit_type)
