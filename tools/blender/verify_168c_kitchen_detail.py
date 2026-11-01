#!/usr/bin/env python3
"""Reopen/check additive kitchen details; optional bounded CPU review renders."""
import argparse, json, time
from pathlib import Path
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector
from detail_168c_kitchen_pbr import ROOT, PARENT, OUT, REV, read_glb, bounds
from prepare_112a_uv_p0 import geometry, object_state, uv_snapshot, digest, plain, sha, dump

EVIDENCE = ROOT / 'runtime/interior/2026-10-22-kitchen-detail'
VIEWS = {
    'kitchen': ((12.0,-6.3,1.60),(11.9,-10.5,1.15),24),
    'appliances': ((12.45,-7.0,1.60),(11.45,-8.4,1.03),32),
    'window': ((12.25,-10.0,1.6),(12.277,-12.251,1.50),35),
}

def material_state():
    result={}
    for m in bpy.data.materials:
        nodes=[]
        for n in m.node_tree.nodes if m.use_nodes else []:
            entry={'name':n.name,'type':n.bl_idname,'inputs':{}}
            for inp in n.inputs:
                if hasattr(inp,'default_value'):
                    try: entry['inputs'][inp.identifier]=plain(inp.default_value)
                    except TypeError: entry['inputs'][inp.identifier]=str(inp.default_value)
            if n.type=='TEX_IMAGE':
                im=n.image
                entry['image']=None if im is None else {'name':im.name,'colorspace':im.colorspace_settings.name,'packed':sha_bytes(bytes(im.packed_file.data)) if im.packed_file else None}
                entry['texture']=[n.extension,n.interpolation,n.projection]
            if n.type=='NORMAL_MAP': entry['space']=[n.space,n.uv_map]
            nodes.append(entry)
        links=sorted((l.from_node.name,l.from_socket.identifier,l.to_node.name,l.to_socket.identifier) for l in m.node_tree.links) if m.use_nodes else []
        result[m.name]=digest({'properties':plain(dict(m.items())),'diffuse':plain(m.diffuse_color),'roughness':m.roughness,'metallic':m.metallic,'nodes':sorted(nodes,key=lambda n:n['name']),'links':links})
    return result

def sha_bytes(b):
    import hashlib
    return hashlib.sha256(b).hexdigest()

def snapshot():
    scene=bpy.context.scene
    bpy.context.view_layer.update()
    return {
      'geometry':{o.name:geometry(o) for o in scene.objects if o.type=='MESH'},
      'uv':{o.name:digest(uv_snapshot(o)) for o in scene.objects if o.type=='MESH'},
      'object':{o.name:object_state(o) for o in scene.objects},
      'visibility':{o.name:[o.hide_get(),o.hide_render,o.hide_viewport,o.select_get()] for o in scene.objects},
      'materials':material_state(),
      'lighting':{o.name:[o.data.type,o.data.energy,plain(o.data.color),getattr(o.data,'size',None)] for o in scene.objects if o.type=='LIGHT'},
      'cameras':{o.name:[o.data.type,o.data.lens,o.data.clip_start,o.data.clip_end] for o in scene.objects if o.type=='CAMERA'},
      'render':[scene.render.engine,scene.cycles.samples,scene.view_settings.view_transform,scene.view_settings.exposure,scene.render.resolution_x,scene.render.resolution_y],
      'units':[scene.unit_settings.system,scene.unit_settings.scale_length]
    }

def accessor(g,b,i):
    a=g['accessors'][i];v=g['bufferViews'][a['bufferView']]
    assert a['componentType']==5126 and a['type']=='VEC3'
    return np.ndarray((a['count'],3),dtype='<f4',buffer=b,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',12),4)).copy()

def validate_glb_bounds():
    old,_=read_glb(PARENT/'acro168c-expanded.glb')
    g,b=read_glb(OUT/'acro168c-expanded.glb')
    parents={child:i for i,n in enumerate(g['nodes']) for child in n.get('children',[])}
    def transform(i):
        n=g['nodes'][i]
        if 'matrix' in n: local=Matrix(np.array(n['matrix']).reshape(4,4).T.tolist())
        else:
            q=n.get('rotation',[0,0,0,1])
            local=Matrix.Translation(Vector(n.get('translation',[0,0,0]))) @ Quaternion((q[3],q[0],q[1],q[2])).to_matrix().to_4x4() @ Matrix.Diagonal(Vector(n.get('scale',[1,1,1])+[1]))
        return transform(parents[i])@local if i in parents else local
    checks=[]
    for i in range(len(old['nodes']),len(g['nodes'])):
        n=g['nodes'][i]
        if 'mesh' not in n: continue
        verts=np.vstack([accessor(g,b,p['attributes']['POSITION']) for p in g['meshes'][n['mesh']]['primitives']])
        mat=np.array(transform(i))
        world=np.c_[verts,np.ones(len(verts))] @ mat.T
        actual=np.r_[world[:,:3].min(axis=0),world[:,:3].max(axis=0)]
        a=bounds(bpy.data.objects[n['name']])
        expected=np.array([a[0],a[2],-a[4],a[3],a[5],-a[1]])
        error=float(np.abs(actual-expected).max())
        assert error<2e-5,(n['name'],error,actual,expected)
        assert n['extras']['collision'] is False
        checks.append({'name':n['name'],'max_bbox_error_m':error})
    assert len(checks)==69
    return checks

def render_review(folder,label):
    bpy.ops.wm.open_mainfile(filepath=str(folder/'acro168c-expanded.blend'),use_scripts=False)
    scene=bpy.context.scene
    for o in scene.objects:
        if o.get('component')=='ceiling': o.hide_render=False;o.hide_set(False)
    scene.render.engine='CYCLES'
    scene.cycles.device='CPU'
    scene.render.threads_mode='FIXED';scene.render.threads=12
    scene.cycles.samples=32
    scene.cycles.use_denoising=True
    scene.cycles.use_adaptive_sampling=False
    scene.cycles.seed=7
    scene.render.resolution_x=960;scene.render.resolution_y=640;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    cam=bpy.data.objects.get('Kitchen review')
    assert cam is not None
    scene.camera=cam
    records=[]
    for name,(position,target,lens) in VIEWS.items():
        cam.location=position
        cam.rotation_euler=(Vector(target)-Vector(position)).to_track_quat('-Z','Y').to_euler()
        cam.data.lens=lens
        scene.render.filepath=str(EVIDENCE/f'{name}-{label}.png')
        start=time.monotonic()
        bpy.ops.render.render(write_still=True)
        records.append({'view':name,'position':position,'target':target,'lens_mm':lens,'png':scene.render.filepath,'sha256':sha(Path(scene.render.filepath)),'seconds':time.monotonic()-start,'eye_m':position[2],'view_is_review_not_default_walkthrough':True})
    return records

def main(render=False):
    EVIDENCE.mkdir(parents=True,exist_ok=True)
    files=[d/n for d in [PARENT,OUT] for n in ['acro168c-expanded.blend','acro168c-expanded.glb','model-info.json']]
    files += [ROOT/'src/walkthrough/variants.js',ROOT/'src/walkthrough/appearance.js',ROOT/'src/walkthrough/finishes.js']
    protected={str(p):sha(p) for p in files}
    bpy.ops.wm.open_mainfile(filepath=str(PARENT/'acro168c-expanded.blend'),use_scripts=False);before=snapshot()
    bpy.ops.wm.open_mainfile(filepath=str(OUT/'acro168c-expanded.blend'),use_scripts=False);after=snapshot()
    for category in ['geometry','uv','object','visibility']:
        assert before[category]=={k:after[category][k] for k in before[category]},category
    for category in ['materials','lighting','cameras','render','units']:
        assert before[category]==after[category],category
    extra=set(after['geometry'])-set(before['geometry'])
    assert len(extra)==69
    assert all(bpy.data.objects[n]['collision'] is False for n in extra)
    oldinfo=json.loads((PARENT/'model-info.json').read_text());info=json.loads((OUT/'model-info.json').read_text())
    changed={k for k in set(oldinfo)|set(info) if oldinfo.get(k)!=info.get(k)}
    assert changed=={'finish_revision','blend_sha256','glb_sha256','mesh_count','visual_details'},changed
    bbox=validate_glb_bounds()
    result={'passed':True,'reopened_deliverable':True,'original_meshes':len(before['geometry']),'original_objects':len(before['object']),'added_noncollision_meshes':len(extra),'source_geometry_uv_object_visibility_material_nodes_images_lights_camera_preserved':True,'metadata_changed_fields_only':sorted(changed),'original_source_and_web_files':protected,'new_glb_blender_bounds_checks':bbox,'render':None,'gpu_used':False,'web_activation':False}
    if render:
        result['render']={'device':'CPU','threads':12,'samples':32,'seed':7,'denoise':True,'resolution':[960,640],'matched_lighting':True,'ceilings_restored_both':True,'before':render_review(PARENT,'before'),'after':render_review(OUT,'after'),'does_not_measure_web_quality_or_device_fps':True}
    assert protected=={str(p):sha(p) for p in files}
    dump(EVIDENCE/'verification.json',result)
    print(json.dumps({'passed':True,'evidence':str(EVIDENCE),'rendered':render,'added_meshes':len(extra)}),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--render',action='store_true');args=p.parse_args();main(args.render)
