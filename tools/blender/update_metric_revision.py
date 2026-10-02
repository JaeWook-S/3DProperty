"""Derive v2 from committed v1 files without changing the archived originals.
Run from repository: uv run --python 3.11 --with bpy==4.5.3 python tools/blender/update_metric_revision.py
"""
import json, hashlib
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT/'assets/models/acro-river-park/112a'
SOURCE = 'https://www.acro.co.kr/Posm_main.action?commonMap.CD_BIZ_LND=010366'
report = {'ceiling_m':2.6,'ceiling_source':SOURCE,'door_opening_m':2.1,
          'door_basis':'design assumption; not an as-built door schedule',
          'bed_basis':'selected mattress size; frame and upholstery are approximations','variants':{}}
for variant, info_file, door_file in [('basic','basic-info.json','basic-doors.json'),('expanded','model-info.json','doors.json')]:
    bpy.ops.wm.open_mainfile(filepath=str(BASE/'dimensioned-v1'/variant/f'acro112a-{variant}.blend'))
    scene=bpy.context.scene
    scene['height_status']='Official advertised ceiling height 2.60 m; local soffits approximated'
    scene['height_source']=SOURCE
    scene['revision']='dimensioned-v2'
    scene['door_status']='Opening height 2.10m is a design assumption; not verified on site'
    for o in scene.objects:
        category=o.users_collection[0].name if o.users_collection else ''
        if o.type=='MESH' and o.get('wall_ref'):
            # Preserve horizontal dimensions and lower opening lintels only.
            inv=o.matrix_world.inverted()
            for v in o.data.vertices:
                p=o.matrix_world@v.co
                if abs(p.z-2.7)<.003: p.z-=.1
                elif abs(p.z-2.15)<.003: p.z-=.05
                v.co=inv@p
        elif category=='Ceilings' or o.name.startswith('Fan ') or (o.type=='LIGHT' and 'soft light' in o.name):
            o.location.z-=.1
        elif category=='Doors_Windows' and ('open door' in o.name or 'jamb' in o.name or 'rail' in o.name):
            # Interior openings originally use 2.15m; window heads stay unchanged.
            if 'open door' in o.name or ('jamb' in o.name and abs(o.location.z-1.075)<.005):
                o.location.z*=2.1/2.15; o.scale.z*=2.1/2.15
            elif 'rail' in o.name and abs(o.location.z-2.15)<.005: o.location.z-=.05
    beds=[]
    for prefix,width,length,label in [('Master staged',1.67,2.075,'King'),('West staged',1.,2.,'Single'),('Center staged',1.,2.,'Single')]:
        mattress=bpy.data.objects[prefix+' mattress'];cx,cy=mattress.location.x,mattress.location.y
        sx=width/mattress.dimensions.x; sy=length/mattress.dimensions.y
        for o in scene.objects:
            if o.name.startswith(prefix):
                o.location.x=cx+(o.location.x-cx)*sx;o.location.y=cy+(o.location.y-cy)*sy
                if 'nightstand' not in o.name: o.scale.x*=sx;o.scale.y*=sy
                o['dimension_basis']='selected_standard_size';o['size_label']=label
        bpy.context.view_layer.update()
        assert abs(mattress.dimensions.x-width)<1e-5 and abs(mattress.dimensions.y-length)<1e-5
        beds.append({'name':prefix,'label':label,'mattress_m':[width,length],'measured_m':list(mattress.dimensions)})
    bpy.context.view_layer.update()
    wall=bpy.data.objects.get('East facade pier')
    wall_tops=[(o.matrix_world@Vector(c)).z for o in scene.objects if o.get('wall_ref') for c in o.bound_box]
    assert abs(max(wall_tops)-2.6)<.0001
    out=BASE/'dimensioned-v2'/variant;out.mkdir(parents=True,exist_ok=True)
    for o in scene.objects:
        if o.users_collection and o.users_collection[0].name=='Ceilings':o.hide_set(True)
    bpy.ops.wm.save_as_mainfile(filepath=str(out/f'acro112a-{variant}.blend'))
    for o in scene.objects:o.hide_set(False)
    glb=out/f'acro112a-{variant}.glb'
    bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_active_scene=True,use_visible=False,export_apply=True,export_extras=True,export_lights=False)
    info_path=ROOT/'src/walkthrough'/info_file; info=json.loads(info_path.read_text())
    info['source']=f'dimensioned-v2/{variant}; Blender (x,y,z) -> glTF (x,z,-y)'
    info['glbSha256']=hashlib.sha256(glb.read_bytes()).hexdigest()
    info['ceiling_m']=2.6; info['ceiling_source']=SOURCE;info['beds']=beds
    info_path.write_text(json.dumps(info,ensure_ascii=False,indent=2)+'\n')
    path=ROOT/'src/walkthrough'/door_file;doors=json.loads(path.read_text())
    for d in doors:
        if d['type']=='hinged':d['height']=2.1
    path.write_text(json.dumps(doors,ensure_ascii=False,indent=2)+'\n')
    report['variants'][variant]={'beds':beds,'wall_top_m':max(wall_tops),'sha256':info['glbSha256']}
(BASE/'dimensioned-v2/verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print('METRIC_V2_OK '+json.dumps(report,ensure_ascii=False))
# Editable expanded scene with the existing catalog furniture in world meters.
bpy.ops.wm.open_mainfile(filepath=str(BASE/'dimensioned-v2/expanded/acro112a-expanded.blend'))
bpy.ops.import_scene.gltf(filepath=str(ROOT/'assets/furniture/catalog-sofa2790-stool980-v1/living-furniture.glb'))
scene=bpy.context.scene
scene.name='ACRO112A_EXPANDED_2600_KingSingle_Staged'
cam=scene.camera
cam.location=(6.18,-6.15,1.6);cam.rotation_euler=(Vector((9,-7.53,.43))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.lens=25
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':area.spaces.active.shading.type='MATERIAL';area.spaces.active.region_3d.view_perspective='CAMERA'
bpy.ops.wm.save_as_mainfile(filepath=str(BASE/'dimensioned-v2/expanded/acro112a-expanded-staged.blend'))
