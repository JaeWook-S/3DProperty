"""CPU-only BLEND/GLB assembly of two unchanged source units and an assumed core."""
import argparse
import hashlib
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2]
FIXTURE=ROOT/'src/paired-floor/layout.json'


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def build(variant,render=True):
    fixture=json.loads(FIXTURE.read_text());layout=fixture['variants'][variant]
    out=ROOT/f'assets/models/acro-river-park/shared-floor/168c-211a-v1/{variant}';out.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
    scene['basis']='illustrative_two_unit_core_not_actual_building_floor';scene['variant']=variant
    scene['description']=fixture['note'];scene['unit_count']=2;scene['source_units_unchanged']=True
    exported=[];sources=[]
    for placement in layout['units']:
        meta_path=ROOT/placement['sourceMetadata'];info=json.loads(meta_path.read_text())
        candidates=list(meta_path.parent.glob('*.glb'));assert len(candidates)==1
        glb=candidates[0];assert sha(glb)==placement['sourceGlbSha256']
        before=set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(glb))
        imported=[o for o in bpy.data.objects if o not in before]
        matrices={o.name:o.matrix_world.copy() for o in imported if o.type=='MESH'}
        root=bpy.data.objects.new(placement['id']+'/rigid-placement',None);scene.collection.objects.link(root)
        for o in imported:
            if o.parent is None:o.parent=root
        tx,_,tz=placement['translation'];root.location=(tx,-tz,0);root.rotation_euler.z=placement['rotationYRadians']
        root['source_unit']=placement['id'];root['scale_status']='original_meter_scale_1';root['placement_basis']='assumed_nonoverlapping_relative_placement'
        bpy.context.view_layer.update()
        max_error=0
        for o in imported:
            if o.type=='MESH':
                original=matrices[o.name]
                for corner in o.bound_box:
                    p=Vector(corner)
                    max_error=max(max_error,(o.matrix_world@p-root.matrix_world@original@p).length)
            o['original_source_object_name']=o.name;o.name=placement['id']+'/'+o.name
        assert max_error<1e-5,(placement['id'],max_error)
        exported.extend(imported);exported.append(root)
        sources.append({'unit':placement['id'],'source_glb':str(glb.relative_to(ROOT)),'source_glb_sha256':sha(glb),
                        'rigid_transform':placement,'max_rigid_transform_corner_error_m':max_error,'imported_meshes':len(matrices)})
    def mat(name,color,metal=0,rough=.8):
        m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
        n=m.node_tree.nodes['Principled BSDF'];n.inputs['Base Color'].default_value=(*color,1);n.inputs['Metallic'].default_value=metal;n.inputs['Roughness'].default_value=rough
        return m
    mats={'wall':mat('Assumed core / warm stone',(.72,.74,.69)),
          'floor':mat('Assumed core / pale terrazzo',(.50,.55,.48)),
          'metal':mat('Assumed core / elevator steel',(.42,.49,.46),.45,.4),
          'button':mat('Assumed core / call panel',(.20,.32,.25),.2,.5)}
    def block(name,center,size,height,bottom,material,component):
        bpy.ops.mesh.primitive_cube_add(size=1,location=(center[0],-center[1],bottom+height/2))
        o=bpy.context.object;o.name='SharedCore/'+name;o.dimensions=(size[0],size[1],height)
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        o.data.materials.append(material);o['component']=component;o['basis']='assumed_common_area';o['collision']=component not in ['floor','decoration']
        exported.append(o);return o
    core=layout['commonArea']
    for i,s in enumerate(core['slabs']):block('Slab '+str(i),s['center'],s['size'],.12,-.12,mats['floor'],'floor')
    for wall in core['walls']:block(wall['id'],wall['center'],wall['size'],wall['height'],wall['bottom'],mats['wall'],wall['component'])
    lift=core['elevator'];x,z=lift['doorCenter'];width=lift['doorWidth']
    for sign in [-1,1]:
        o=block('Elevator leaf '+str(sign),[x,z+sign*width/4],[.04,width/2],lift['doorHeight'],0,mats['metal'],'door_leaf')
        o['door_id']='shared:elevator';o['panel_slide_z_m']=sign*(width/2+.035);o['open_state']='closed'
    block('Elevator call panel',[x+.13,z+.62],[.05,.10],.16,1.1,mats['button'],'decoration')
    for placement in layout['units']:
        label=bpy.data.curves.new(placement['id']+' label','FONT');label.body=placement['label']+' / '+('BASIC' if variant=='basic' else 'EXPANDED');label.size=.65;label.align_x='CENTER'
        text=bpy.data.objects.new(placement['id']+' review label',label);scene.collection.objects.link(text)
        _,_,tz=placement['translation'];text.location=(4,-(4 if placement['id']=='168c' else -4),2.9)
        text.hide_render=True
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT')
    for o in exported:o.select_set(True)
    stem=f'acro168c-211a-{variant}-shared-floor'
    glb=out/(stem+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_extras=True,export_cameras=False,export_lights=False,export_yup=True)
    for o in exported:
        if o.get('component')=='ceiling':o.hide_render=True;o.hide_set(True)
    scene.world=bpy.data.worlds.new('Neutral CPU review light');scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.65
    for name,loc,energy,size in [('Main',(2,0,18),2500,20),('Fill',(-10,3,14),1500,15)]:
        data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.size=size
        light=bpy.data.objects.new(name,data);scene.collection.objects.link(light);light.location=loc
    bounds=[o.matrix_world@Vector(c) for o in exported if o.type=='MESH' for c in o.bound_box]
    low=Vector(tuple(min(p[i] for p in bounds) for i in range(3)));high=Vector(tuple(max(p[i] for p in bounds) for i in range(3)))
    target=(low+high)/2;target.z=.4
    # Match the landscape render aspect so neither source unit is cropped.
    span=max(high.x-low.x,(high.y-low.y)*1152/864)*1.25
    def cam(name,location):
        data=bpy.data.cameras.new(name);data.type='ORTHO';data.ortho_scale=span;data.clip_end=300
        o=bpy.data.objects.new(name,data);scene.collection.objects.link(o);o.location=location;o.rotation_euler=(target-o.location).to_track_quat('-Z','Y').to_euler();return o
    top=cam('Top view',target+Vector((.001,0,65)));iso=cam('Isometric',target+Vector((-28,-30,32)))
    scene.camera=iso;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=12;scene.cycles.use_denoising=True
    scene.render.threads_mode='FIXED';scene.render.threads=8;scene.render.resolution_x=1152;scene.render.resolution_y=864;scene.render.resolution_percentage=100
    scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG'
    bpy.context.preferences.filepaths.save_version=0
    blend=out/(stem+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    if render:
        for camera,filename in [(top,'top-view.png'),(iso,'isometric.png')]:
            scene.camera=camera;scene.render.filepath=str(out/filename);bpy.ops.render.render(write_still=True)
    report={'variant':variant,'units':'m','scale':1,'basis':'two_source_units_plus_assumed_core',
            'actual_building_floor_verified':False,'actual_opposite_doors_verified':False,'unit_count':2,
            'not_modeled':['remaining units of100 building floor','stairs','vertical elevator travel','actual core dimensions'],
            'fixture_sha256':sha(FIXTURE),'sources':sources,'common_area':core,'bounds_blender_xyz':[list(low),list(high)],
            'blend_sha256':sha(blend),'glb_sha256':sha(glb),'render_device':'CPU','source_geometry_scaled':False}
    (out/'model-info.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'variant':variant,'blend':str(blend),'glb':str(glb),'sources':len(sources),'cpu_only':True}),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--variant',choices=['basic','expanded','both'],default='both');p.add_argument('--skip-render',action='store_true');a=p.parse_args()
    for v in ['basic','expanded'] if a.variant=='both' else [a.variant]:build(v,not a.skip_render)
