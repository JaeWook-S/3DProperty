#!/usr/bin/env python3
"""Refine source-sized 112A kitchens; preserve the complete structural geometry.
Run: uv run --offline --python 3.11 --with bpy==4.5.3 --with shapely==2.1.2 python tools/blender/refine_112a_kitchen.py
"""
import argparse, hashlib, json, math
from pathlib import Path
import bpy
from mathutils import Vector
from shapely.geometry import Polygon, box as rect
from shapely.ops import unary_union

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'assets/models/acro-river-park/112a'
REV='archisketch-kitchen-v3'
STRUCTURE={'floor','wall','ceiling','base','excluded_volume','opening_frame','door_leaf','glass','sliding_panel'}

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def dump(path,data): path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
def geo(obj):
    return hashlib.sha256(json.dumps({'matrix':list(map(list,obj.matrix_world)), 'vertices':[list(v.co) for v in obj.data.vertices], 'faces':[list(p.vertices) for p in obj.data.polygons]},sort_keys=True).encode()).hexdigest()
def envelope(obj):
    pts=[obj.matrix_world@v.co for v in obj.data.vertices]
    return [min(v.x for v in pts),min(v.y for v in pts),min(v.z for v in pts),max(v.x for v in pts),max(v.y for v in pts),max(v.z for v in pts)]
def material(name,color,roughness,metallic=0):
    m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=(*color,1)
    node=m.node_tree.nodes.get('Principled BSDF')
    node.inputs['Base Color'].default_value=(*color,1);node.inputs['Roughness'].default_value=roughness;node.inputs['Metallic'].default_value=metallic
    return m

def build(variant,render=True):
    source=BASE/'archisketch-details-v2'/variant;out=BASE/REV/variant
    out.mkdir(parents=True,exist_ok=True)
    stem=f'acro112a-{variant}'
    info=json.loads((source/'model-info.json').read_text())
    bpy.ops.wm.open_mainfile(filepath=str(source/(stem+'.blend')))
    scene=bpy.context.scene;bpy.context.view_layer.update()
    structural={o.name:geo(o) for o in scene.objects if o.type=='MESH' and o.get('component') in STRUCTURE}
    all_before={o.name:geo(o) for o in scene.objects if o.type=='MESH'}
    kitchen_before={f['id']:f for f in info['fixtures'] if f['component']=='kitchen_fixture'}
    col=bpy.data.collections['06_Interiors'];made=[]
    steel=material('112A / Satin sink stainless',(.56,.59,.61),.29,.92)
    recess=material('112A / Drain dark inset',(.04,.047,.05),.44,.4)
    fixture_id='kitchen-appliances' if variant=='basic' else 'Kitchen north counter'
    def tag(obj,name):
        obj.name=name
        for c in list(obj.users_collection):c.objects.unlink(obj)
        col.objects.link(obj)
        obj['component']='kitchen_fixture';obj['fixture_id']=fixture_id;obj['room_id']='living-kitchen-hall';obj['dimension_basis']='design_detail_within_existing_kitchen_envelope'
        made.append(obj);return obj
    def mesh(name,verts,faces,mat,smooth=False):
        d=bpy.data.meshes.new(name);d.from_pydata(verts,[],faces);d.update();o=bpy.data.objects.new(name,d);col.objects.link(o);tag(o,name);d.materials.append(mat)
        for p in d.polygons:p.use_smooth=smooth
        return o
    def cube(name,center,size,mat,bevel=0):
        bpy.ops.mesh.primitive_cube_add(size=1,location=center);o=tag(bpy.context.object,name);o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(mat)
        if bevel:
            m=o.modifiers.new('Manufactured edge','BEVEL');m.width=bevel;m.segments=3;bpy.ops.object.modifier_apply(modifier=m.name)
        return o
    def cylinder(name,center,radius,depth,mat):
        bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=radius,depth=depth,location=center);o=tag(bpy.context.object,name);o.data.materials.append(mat)
        for p in o.data.polygons:p.use_smooth=len(p.vertices)==4
        return o
    def rounded(w,d,r,z,cx,cy):
        pts=[]
        for x,y,start in [(w/2-r,d/2-r,0),(-w/2+r,d/2-r,90),(-w/2+r,-d/2+r,180),(w/2-r,-d/2+r,270)]:
            for j in range(7):
                a=math.radians(start+j*90/6);pts.append((cx+x+r*math.cos(a),cy+y+r*math.sin(a),z))
        return pts
    def camera():
        data=bpy.data.cameras.new('Kitchen detail review');cam=bpy.data.objects.new(data.name,data);scene.collection.objects.link(cam)
        if variant=='basic':loc=(7.35,-4.55,2.05);target=(9.15,-2.7,.95)
        else:loc=(6.95,-2.85,2.05);target=(8.65,-.70,.95)
        cam.location=loc;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();data.lens=26;scene.camera=cam
        scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
        scene.render.threads_mode='FIXED';scene.render.threads=6;scene.render.resolution_x=1080;scene.render.resolution_y=760;scene.render.resolution_percentage=100
        return cam
    camera()
    if render:
        scene.render.filepath=str(out/'kitchen-before.png');bpy.ops.render.render(write_still=True)
    rim_name='Sink / rim' if variant=='basic' else 'Kitchen north counter/sink-rim'
    tap_name='Sink / tap' if variant=='basic' else 'Kitchen north counter/tap-upright'
    rim=bpy.data.objects[rim_name];a,b,_,c,d,_=envelope(rim);cx,cy=(a+c)/2,(b+d)/2;w,depth=c-a,d-b
    tap=envelope(bpy.data.objects[tap_name]);tx,ty=(tap[0]+tap[3])/2,(tap[1]+tap[4])/2
    countertop=bpy.data.objects['Kitchen east counter/countertop' if variant=='basic' else 'Kitchen north counter/countertop']
    top=envelope(countertop)[5];cut_w,cut_d=w-.06,depth-.06
    removed=['Sink / rim','Sink / basin','Sink / tap','Sink / spout'] if variant=='basic' else ['Kitchen north counter/'+s for s in ['sink-rim','sink-basin-indication','tap-upright','tap-spout']]
    for name in removed:bpy.data.objects.remove(bpy.data.objects[name],do_unlink=True)
    # Cut only the chosen cabinet, never an architectural wall/floor or doorway.
    cutter=cube('TEMP sink cut',(cx,cy,top-.085),(cut_w,cut_d,.23),steel,.025)
    cut_names=[countertop.name,countertop.name.replace('/countertop','/carcass')]
    for name in cut_names:
        obj=bpy.data.objects[name];bpy.context.view_layer.objects.active=obj
        modifier=obj.modifiers.new('Recessed sink opening','BOOLEAN');modifier.operation='DIFFERENCE';modifier.solver='EXACT';modifier.object=cutter
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    made.remove(cutter);bpy.data.objects.remove(cutter,do_unlink=True)
    # One continuous rim, sloping inner walls, and a bowl bottom with a drain hole.
    rings=[rounded(w,depth,.045,top+.007,cx,cy),rounded(cut_w-.002,cut_d-.002,.025,top+.003,cx,cy),rounded(cut_w-.055,cut_d-.055,.035,top-.18,cx,cy)]
    count=len(rings[0]);verts=[p for ring in rings for p in ring];faces=[]
    for ring in range(2):
        for j in range(count):faces.append((ring*count+j,ring*count+(j+1)%count,(ring+1)*count+(j+1)%count,(ring+1)*count+j))
    # Drain circle matches rounded ring vertex count to keep the bottom open.
    verts.extend((cx+.028*math.cos(2*math.pi*j/count+math.pi/4),cy+.028*math.sin(2*math.pi*j/count+math.pi/4),top-.18) for j in range(count))
    for j in range(count):faces.append((2*count+j,2*count+(j+1)%count,3*count+(j+1)%count,3*count+j))
    mesh('Sink detail / recessed bowl',verts,faces,steel)
    cylinder('Sink detail / drain inset',(cx,cy,top-.185),.027,.007,recess)
    # Small drain strainer cross, inside the existing bowl envelope.
    cube('Sink detail / drain cross X',(cx,cy,top-.1805),(.038,.004,.002),steel)
    cube('Sink detail / drain cross Y',(cx,cy,top-.1805),(.004,.038,.002),steel)
    cylinder('Sink detail / faucet base',(tx,ty,top+.012),.025,.022,steel)
    direction=Vector((cx-tx,cy-ty,0)).normalized();radius=.073;points=[]
    for j in range(5):points.append((tx,ty,top+.023+j*.19/4))
    for j in range(1,17):
        angle=math.pi*j/16;offset=radius*(1-math.cos(angle));z=top+.213+radius*math.sin(angle)
        points.append((tx+direction.x*offset,ty+direction.y*offset,z))
    points.append((tx+direction.x*radius*2,ty+direction.y*radius*2,top+.19))
    curve=bpy.data.curves.new('Gooseneck curve','CURVE');curve.dimensions='3D';curve.bevel_depth=.012;curve.bevel_resolution=3;curve.resolution_u=1;curve.use_fill_caps=True
    sp=curve.splines.new('POLY');sp.points.add(len(points)-1)
    for p,v in zip(sp.points,points):p.co=(*v,1)
    obj=bpy.data.objects.new('Sink detail / curved faucet',curve);col.objects.link(obj);obj.select_set(True);bpy.context.view_layer.objects.active=obj
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.ops.object.convert(target='MESH');obj=tag(bpy.context.object,'Sink detail / curved faucet');obj.data.materials.append(steel)
    for p in obj.data.polygons:p.use_smooth=True
    # Physical PBR parameters export directly to glTF; no Blender-only shader nodes.
    for m in bpy.data.materials:
        if m.name in ['112A / Lacquer warm white','112A / brushed nickel']:
            n=m.node_tree.nodes.get('Principled BSDF');n.inputs['Roughness'].default_value=.33 if 'Lacquer' in m.name else .30
    bpy.context.view_layer.update()
    structural_changed=[name for name,old in structural.items() if geo(bpy.data.objects[name])!=old]
    assert not structural_changed,structural_changed
    intentional=set(cut_names+removed)
    unexpectedly_changed=[name for name,old in all_before.items() if name not in intentional and (bpy.data.objects.get(name) is None or geo(bpy.data.objects[name])!=old)]
    assert not unexpectedly_changed,unexpectedly_changed
    poly=Polygon(next(r['polygon_m'] for r in info['rooms'] if r['id']=='living-kitchen-hall'))
    for f in info['fixtures']:
        if f['id'] not in [fixture_id,countertop.name.split('/')[0]]:continue
        f['mesh_names']=[n for n in f['mesh_names'] if n not in removed]+([o.name for o in made] if f['id']==fixture_id else [])
        objects=[bpy.data.objects[n] for n in f['mesh_names']];bounds=[envelope(o) for o in objects]
        footprints=[[p[0],-p[4],p[3],-p[1]] for p in bounds]
        f['footprints_m']=footprints;f['collision_footprints_m']=[fp for fp,b in zip(footprints,bounds) if b[5]>.12 and b[2]<1.75]
        f['bounds_m']=[min(p[0] for p in footprints),min(p[1] for p in footprints),max(p[2] for p in footprints),max(p[3] for p in footprints)]
        f['bottom_m']=min(b[2] for b in bounds);f['top_m']=max(b[5] for b in bounds)
        f['outside_room_m2']=unary_union([rect(*fp) for fp in footprints]).difference(poly.buffer(.015)).area
        assert f['outside_room_m2']<.001,(f['id'],f['outside_room_m2'])
    exported=[o for o in scene.objects if o.type=='MESH' and o.get('component')]
    bpy.ops.object.select_all(action='DESELECT')
    for o in exported:o.hide_set(False);o.select_set(True)
    for o in col.objects:
        if o.type=='EMPTY':o.select_set(True)
    glb=out/(stem+'.glb');bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_extras=True,export_yup=True,export_cameras=False,export_lights=False)
    bpy.ops.object.select_all(action='DESELECT')
    for o in exported:
        if o.get('component')=='ceiling':o.hide_render=True;o.hide_set(True)
    scene['revision']=REV;scene['refinement_basis']='Existing kitchen envelopes; sink/faucet design details, not measured appliance specifications'
    bpy.context.preferences.filepaths.save_version=0;blend=out/(stem+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    info.update(finish_revision=REV,mesh_count=len(exported),blend_sha256=sha(blend),glb_sha256=sha(glb))
    info['kitchen_refinement']={'parent_revision':'archisketch-details-v2','parent_blend_sha256':sha(source/(stem+'.blend')),'sink_depth_m':.18,'basis':'design assumption inside existing counter envelope','structural_change_count':0,'movable_furniture_geometry_change_count':0,'web_activation':'pending S1/S3 integration; current active variants still v2'}
    dump(out/'model-info.json',info)
    dump(out/'preservation.json',{'passed':True,'structural_meshes_checked':len(structural),'structural_changed':structural_changed,'other_unexpected_geometry_changes':unexpectedly_changed,'intentional_changed_or_removed':sorted(intentional),'new_meshes':[o.name for o in made],'source_blend_sha256':sha(source/(stem+'.blend')),'notes':['Cabinet footprint, apartment structure and movable furniture placements are preserved.','Sink/faucet are illustrative modeled details, not independently measured catalog geometry.','No runtime light or collision architecture changes.']})
    if render:
        scene.render.filepath=str(out/'kitchen-after.png');bpy.ops.render.render(write_still=True)
    print(json.dumps({'variant':variant,'out':str(out),'structural_meshes_unchanged':len(structural),'meshes':len(exported),'glb_bytes':glb.stat().st_size},ensure_ascii=False),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--variant',choices=['basic','expanded','both'],default='both');p.add_argument('--skip-render',action='store_true');a=p.parse_args()
    for v in ['basic','expanded'] if a.variant=='both' else [a.variant]:build(v,not a.skip_render)
