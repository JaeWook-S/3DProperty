#!/usr/bin/env python3
"""Add VR-guided appliance/joinery cues within existing occupied envelopes.

No new surveyed dimensions are claimed. Original GLB binary/nodes/materials and
original Blender meshes/UVs remain immutable. No render/GPU/runtime activation.
"""
import copy
import json
import math
import struct
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

from prepare_112a_uv_p0 import geometry, object_state, uv_snapshot, digest, metric_projection, bad_uv_faces, plain, sha, dump

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'assets/models/acro-river-park/168c'
PARENT = BASE / 'archisketch-pbr-candidate-v1/expanded'
REV = 'archisketch-kitchen-detail-v1'
OUT = BASE / REV / 'expanded'
EXPECTED = '4834a91ececc43f5c9961ca224024117f1b39192564090c664ac64d72d51e8da'


def read_glb(path):
    raw = path.read_bytes()
    assert struct.unpack_from('<4sII', raw) == (b'glTF', 2, len(raw))
    n, tag = struct.unpack_from('<II', raw, 12)
    assert tag == 0x4e4f534a
    doc = json.loads(raw[20:20+n])
    size, tag = struct.unpack_from('<II', raw, 20+n)
    assert tag == 0x004e4942
    return doc, raw[28+n:28+n+size]


def append_geometry(parent, addon, output):
    old, binary = read_glb(parent)
    part, extra = read_glb(addon)
    assert not part.get('images') and not part.get('textures')
    assert not part.get('animations') and not part.get('skins')
    g = copy.deepcopy(old)
    material_ids = {i: next(j for j, m in enumerate(old['materials']) if m['name'] == mat['name']) for i, mat in enumerate(part['materials'])}
    bv_offset, acc_offset = len(g['bufferViews']), len(g['accessors'])
    mesh_offset, node_offset = len(g['meshes']), len(g['nodes'])
    data = bytearray(binary)
    data.extend(b'\x00' * ((-len(data)) % 4))
    byte_offset = len(data)
    data.extend(extra)
    for view in part['bufferViews']:
        v = copy.deepcopy(view)
        assert v['buffer'] == 0
        v['byteOffset'] = v.get('byteOffset', 0) + byte_offset
        g['bufferViews'].append(v)
    for accessor in part['accessors']:
        a = copy.deepcopy(accessor)
        assert not a.get('sparse')
        a['bufferView'] += bv_offset
        g['accessors'].append(a)
    for mesh in part['meshes']:
        m = copy.deepcopy(mesh)
        for primitive in m['primitives']:
            assert set(primitive) <= {'attributes', 'indices', 'material', 'mode'}
            primitive['attributes'] = {k: v + acc_offset for k, v in primitive['attributes'].items()}
            primitive['indices'] += acc_offset
            primitive['material'] = material_ids[primitive['material']]
        g['meshes'].append(m)
    for node in part['nodes']:
        n = copy.deepcopy(node)
        assert not n.get('skin') and not n.get('camera')
        if 'mesh' in n:
            n['mesh'] += mesh_offset
        if 'children' in n:
            n['children'] = [x + node_offset for x in n['children']]
        g['nodes'].append(n)
    assert not ({n['name'] for n in old['nodes']} & {n['name'] for n in part['nodes']})
    g['scenes'][g.get('scene', 0)]['nodes'].extend(x + node_offset for x in part['scenes'][part.get('scene', 0)]['nodes'])
    g['buffers'][0]['byteLength'] = len(data)
    js = json.dumps(g, ensure_ascii=False, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    output.write_bytes(struct.pack('<4sII', b'glTF', 2, 28+len(js)+len(data)) + struct.pack('<II', len(js), 0x4e4f534a) + js + struct.pack('<II', len(data), 0x004e4942) + data)
    check, result_bin = read_glb(output)
    assert result_bin[:len(binary)] == binary
    for key in ['materials', 'images', 'textures', 'samplers']:
        assert check.get(key) == old.get(key), key
    for key in ['nodes', 'meshes', 'accessors', 'bufferViews']:
        assert check[key][:len(old[key])] == old[key], key
    for n in check['nodes'][node_offset:]:
        if 'mesh' in n:
            assert n['extras']['collision'] is False and n['extras']['component'] == 'decoration'
    return {'old_nodes': node_offset, 'added_nodes': len(part['nodes']), 'old_meshes': mesh_offset, 'added_meshes': len(part['meshes']), 'original_binary_bytes_preserved': len(binary), 'new_bytes': output.stat().st_size - parent.stat().st_size}


def bounds(o):
    v = [o.matrix_world @ Vector(p) for p in o.bound_box]
    return [min(p[i] for p in v) for i in range(3)] + [max(p[i] for p in v) for i in range(3)]


def build():
    assert sha(PARENT / 'acro168c-expanded.glb') == EXPECTED
    OUT.mkdir(parents=True, exist_ok=True)
    inputs = {p.name: sha(p) for p in [PARENT/'acro168c-expanded.blend', PARENT/'acro168c-expanded.glb', PARENT/'model-info.json']}
    info = json.loads((PARENT/'model-info.json').read_text())
    bpy.ops.wm.open_mainfile(filepath=str(PARENT/'acro168c-expanded.blend'), use_scripts=False)
    scene = bpy.context.scene
    bpy.context.view_layer.update()
    original = list(scene.objects)
    meshes = [o for o in original if o.type == 'MESH']
    snapshot = lambda: ({o.name: geometry(o) for o in meshes}, {o.name: digest(uv_snapshot(o)) for o in meshes}, {o.name: object_state(o) for o in original})
    before = snapshot()
    visibility = {o.name: (o.hide_get(), o.hide_render, o.select_get()) for o in original}
    material_before = {m.name: plain(dict(m.items())) for m in bpy.data.materials}
    col = bpy.data.collections.new('08_Kitchen_Visual_Details')
    scene.collection.children.link(col)
    made, evidence = [], []
    steel = bpy.data.materials['168C / brushed nickel']
    black = bpy.data.materials['168C / Black glass']
    recess = bpy.data.materials['Draft kitchen / recess']
    white = bpy.data.materials['168C / Lacquer warm white']
    light = bpy.data.materials['168C / Warm light diffuser']
    west = next(f for f in info['fixtures'] if f['id'] == 'Kitchen west base')['bounds_m']
    host = 'Kitchen west base'
    footprint = west

    def finish_obj(o, name, mat):
        o.name = 'Visual detail / ' + name
        for c in list(o.users_collection):
            c.objects.unlink(o)
        col.objects.link(o)
        o.data.materials.append(mat)
        o['component'] = 'decoration'
        o['collision'] = False
        o['detail_parent'] = host
        o['dimension_basis'] = 'VR_guided_design_detail_not_surveyed'
        bpy.context.view_layer.update()
        uv = o.data.uv_layers.active or o.data.uv_layers.new(name='MetricUV')
        metric_projection(o, uv, range(len(o.data.polygons)))
        assert bad_uv_faces(o) == [], o.name
        b = bounds(o)
        fp = [b[0], -b[4], b[3], -b[1]]
        assert fp[0] >= footprint[0]-1e-5 and fp[1] >= footprint[1]-1e-5 and fp[2] <= footprint[2]+1e-5 and fp[3] <= footprint[3]+1e-5, (o.name, fp, footprint)
        made.append(o)
        evidence.append({'name': o.name, 'host': host, 'bbox_xyz': b, 'footprint_xz': fp, 'allowed_occupied_envelope_xz': footprint, 'collision': False, 'basis': 'visual approximation, no surveyed appliance specification'})
        return o

    def box(name, center, size, mat, bevel=0.001):
        bpy.ops.mesh.primitive_cube_add(size=1, location=center)
        o = bpy.context.object
        o.dimensions = size
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        if bevel:
            mod = o.modifiers.new('Manufactured edge', 'BEVEL')
            mod.width = min(bevel, min(size)/4)
            mod.segments = 2
            bpy.ops.object.modifier_apply(modifier=mod.name)
        return finish_obj(o, name, mat)

    def dial(name, center, radius, depth, mat):
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=radius, depth=depth, location=center, rotation=(0, math.pi/2, 0))
        o = bpy.context.object
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        return finish_obj(o, name, mat)

    # Front cues sit behind the already protruding handle and inside its existing
    # counter footprint. The oven/cabinet geometry and collision envelope stay.
    a,b,c,d,e,f = bounds(bpy.data.objects['Kitchen west base/oven glass'])
    face, mid = d + .004, (b+e)/2
    for y in [b+.005,e-.005]:
        box('oven vertical trim', (face,y,(c+f)/2), (.005,.009,f-c), steel)
    for z in [c+.005,f-.005]:
        box('oven horizontal trim', (face,mid,z), (.005,e-b-.01,.009), steel)
    box('oven control fascia', (face+.002,mid,.745), (.006,.57,.125), steel)
    box('oven display glass', (face+.007,mid,.755), (.004,.14,.040), black)
    for y in [mid-.205,mid+.205]:
        dial('oven selector', (face+.013,y,.755), .025,.016,steel)
        box('oven selector index', (face+.022,y,.767), (.002,.002,.012), recess, 0)
    for dy in [-.035,-.012,.012,.035]:
        box('oven display indicator', (face+.010,mid+dy,.755), (.002,.003,.012), white, 0)
    for j in range(10):
        box('oven lower vent', (face,mid+(j-4.5)*.045,.188), (.003,.028,.003), recess, 0)

    # Hood front buttons, removable-filter appearance and two light diffusers.
    # All projections remain inside the already occupied base-cabinet footprint.
    a,b,c,d,e,f = bounds(bpy.data.objects['Kitchen hood and backsplash/hood'])
    cx,cy=(a+d)/2,(b+e)/2
    box('hood filter recess', (cx,cy,c-.002), (d-a-.08,e-b-.08,.004), recess)
    for j in range(14):
        box('hood filter rail', (a+.055+(d-a-.11)*j/13,cy,c-.005), (.003,e-b-.12,.003), steel, 0)
    for y in [b+.025,e-.025]:
        box('hood diffuser', (d-.10,y,c-.003), (.10,.019,.004), light)
    box('hood fascia inset', (d+.002,cy,(c+f)/2), (.004,.33,.035), recess)
    for j in range(5):
        dial('hood push button', (d+.006,cy+(j-2)*.052,(c+f)/2), .009,.004,steel)

    # Use the actual opening/glass bounds, not a photo-derived new opening size.
    for window in ['window-23', 'window-15']:
        host = window
        frame_bounds = [bounds(bpy.data.objects[n]) for n in next(o for o in info['openings'] if o['id']==window)['mesh_names']]
        footprint = [min(b[0] for b in frame_bounds),-max(b[4] for b in frame_bounds),max(b[3] for b in frame_bounds),-min(b[1] for b in frame_bounds)]
        for pane in [0,1]:
            a,b,c,d,e,f = bounds(bpy.data.objects[f'{window}/glass-{pane}'])
            front = e + .006
            for x in [a+.002,d-.002]:
                box(window+' pane seal', (x,front,(c+f)/2), (.004,.003,f-c), recess, 0)
            for z in [c+.002,f-.002]:
                box(window+' pane seal', ((a+d)/2,front,z), (d-a-.004,.003,.004), recess, 0)
        center = next(o for o in info['openings'] if o['id']==window)['center_m'][0]
        for z in [1.30,1.42]:
            box(window+' grip mount', (center-.025,-12.216,z), (.018,.008,.014), white)
        box(window+' inset grip', (center-.025,-12.213,1.36), (.012,.004,.12), white)

    assert snapshot() == before
    assert material_before == {m.name: plain(dict(m.items())) for m in bpy.data.materials}
    bpy.ops.object.select_all(action='DESELECT')
    for o in made:
        o.select_set(True)
    addon = OUT/'visual-details.glb'
    bpy.ops.export_scene.gltf(filepath=str(addon),export_format='GLB',use_selection=True,export_extras=True,export_yup=True,export_cameras=False,export_lights=False)
    glb = OUT/'acro168c-expanded.glb'
    appended = append_geometry(PARENT/'acro168c-expanded.glb',addon,glb)
    bpy.ops.object.select_all(action='DESELECT')
    for o in original:
        hidden, rendered, selected = visibility[o.name]
        o.hide_set(hidden);o.hide_render=rendered;o.select_set(selected)
    assert snapshot() == before
    scene['revision'] = REV
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.file.pack_all()
    blend = OUT/'acro168c-expanded.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    metadata = copy.deepcopy(info)
    metadata.update(finish_revision=REV,blend_sha256=sha(blend),glb_sha256=sha(glb),mesh_count=len(meshes)+len(made))
    metadata['visual_details']={'parent_revision':'archisketch-pbr-candidate-v1','mesh_names':[o.name for o in made],'basis':'VR appearance reference; detail dimensions are design assumptions','collision':'All added decorations are non-collidable and contained in existing occupied fixture/window envelopes','architecture_and_fixture_metadata_unchanged':True}
    assert metadata['fixtures']==info['fixtures'] and metadata['openings']==info['openings'] and metadata['rooms']==info['rooms']
    dump(OUT/'model-info.json',metadata)
    assert inputs == {n:sha(PARENT/n) for n in inputs}
    report={'passed':True,'revision':REV,'parent_files_sha256':inputs,'original_blender_mesh_geometry_normals_uv_equal':len(meshes),'original_blender_object_metadata_transforms_equal':len(original),'original_material_names_properties_equal':True,'glb_append':appended,'all_original_glb_materials_textures_images_equal':True,'unchanged_rooms_openings_fixtures_metadata':True,'new_meshes':evidence,'all_new_uv_valid':True,'new_triangles':sum(len(o.data.loop_triangles) for o in made),'outputs_sha256':{p.name:sha(p) for p in [blend,glb,OUT/'model-info.json',addon]},'gpu_calls':0,'render_calls':0,'web_active_paths_changed':False,'browser_validation_pending':True,'detail_dimensions_are_not_surveyed':True}
    dump(OUT/'verification.json',report)
    print(json.dumps({'passed':True,'candidate':str(OUT),'new_meshes':len(made),'glb_append':appended,'hashes':report['outputs_sha256']}),flush=True)


if __name__=='__main__':
    build()
