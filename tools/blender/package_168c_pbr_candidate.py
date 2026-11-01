#!/usr/bin/env python3
"""Pair S2's byte-preserving GLB with a pristine-scene, map-backed BLEND.

Run with cached bpy 4.5.3. No rendering/GPU, runtime edits, or active-model switch.
"""
import copy
import hashlib
import json
import shutil
import struct
from pathlib import Path

import bpy
from prepare_112a_uv_p0 import geometry, object_state, uv_snapshot, digest, plain

ROOT = Path(__file__).resolve().parents[2]
S2 = ROOT.parent / 'AisideProject/realestate-spatial-ai/experiments/service-appearance/2026-10-22-168c/s2'
BASE = ROOT / 'assets/models/acro-river-park/168c'
SRC = BASE / 'archisketch-details-v2/expanded'
REV = 'archisketch-pbr-candidate-v1'
OUT = BASE / REV / 'expanded'
EXPECTED = '4834a91ececc43f5c9961ca224024117f1b39192564090c664ac64d72d51e8da'


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def dump(p, value):
    p.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def glb(p):
    raw = p.read_bytes()
    assert struct.unpack_from('<4sII', raw) == (b'glTF', 2, len(raw))
    chunks = {}
    offset = 12
    while offset < len(raw):
        n, kind = struct.unpack_from('<II', raw, offset)
        chunks[kind] = raw[offset + 8:offset + 8 + n]
        offset += 8 + n
    assert offset == len(raw)
    return json.loads(chunks[0x4e4f534a]), chunks[0x004e4942]


def render_state(scene):
    return {
        'camera': scene.camera.name if scene.camera else None,
        'lights': {o.name: {'type': o.data.type, 'energy': o.data.energy,
                           'color': plain(o.data.color)} for o in scene.objects if o.type == 'LIGHT'},
        'engine': scene.render.engine,
        'exposure': scene.view_settings.exposure,
        'view_transform': scene.view_settings.view_transform,
        'samples': scene.cycles.samples,
        'resolution': [scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage],
        'visibility': {o.name: [o.hide_get(), o.hide_render, o.hide_viewport, o.select_get()] for o in scene.objects},
    }


def snapshot(scene):
    return {
        'geometry': {o.name: geometry(o) for o in scene.objects if o.type == 'MESH'},
        'uv': {o.name: digest(uv_snapshot(o)) for o in scene.objects if o.type == 'MESH'},
        'objects': {o.name: object_state(o) for o in scene.objects},
        'render': render_state(scene),
        'units': [scene.unit_settings.system, scene.unit_settings.scale_length],
    }


def build():
    OUT.mkdir(parents=True, exist_ok=True)
    source_files = [SRC / n for n in ['acro168c-expanded.blend', 'acro168c-expanded.glb', 'model-info.json']]
    protected = {str(p): sha(p) for p in source_files}
    manifest = json.loads((S2 / 'material-manifest.json').read_text())
    s2_glb = S2 / manifest['candidate']
    assert sha(s2_glb) == EXPECTED == manifest['candidate_sha256']
    old, oldbin = glb(source_files[1])
    new, newbin = glb(s2_glb)
    assert newbin[:len(oldbin)] == oldbin
    allowed_keys = {'materials', 'images', 'textures', 'samplers', 'bufferViews', 'buffers'}
    assert {k: v for k, v in old.items() if k not in allowed_keys} == {k: v for k, v in new.items() if k not in allowed_keys}
    for key in ['images', 'textures', 'samplers', 'bufferViews']:
        assert new[key][:len(old[key])] == old[key], key
    target_indices = {m['material_index'] for m in manifest['materials']}
    assert len(target_indices) == 5
    for i, m in enumerate(old['materials']):
        if i not in target_indices:
            assert new['materials'][i] == m
    (OUT / 'maps').mkdir(exist_ok=True)
    maps = {}
    for entry in manifest['materials']:
        for channel, f in entry['files'].items():
            p = S2 / f['path']
            assert sha(p) == f['sha256'], p
            dest = OUT / f['path']
            shutil.copyfile(p, dest)
            maps[str(dest.relative_to(OUT))] = sha(dest)
    bpy.ops.wm.open_mainfile(filepath=str(source_files[0]), use_scripts=False)
    scene = bpy.context.scene
    bpy.context.view_layer.update()
    before = snapshot(scene)
    original_properties = {m.name: plain(dict(m.items())) for m in bpy.data.materials}
    blender_maps = []
    for entry in manifest['materials']:
        mat = bpy.data.materials[entry['name']]
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        bs = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
        gm = new['materials'][entry['material_index']]
        assert gm['name'] == mat.name
        assert gm['extras']['appearance_policy'] == 'authored-pbr-v1'
        pbr = gm['pbrMetallicRoughness']
        bs.inputs['Metallic'].default_value = pbr['metallicFactor']
        for channel in ['basecolor', 'roughness', 'normal']:
            if channel not in entry['files']:
                continue
            im = bpy.data.images.load(str(OUT / entry['files'][channel]['path']), check_existing=False)
            im.colorspace_settings.name = 'sRGB' if channel == 'basecolor' else 'Non-Color'
            im.pack()
            tex = nodes.new('ShaderNodeTexImage')
            tex.name = 'Authored PBR / ' + channel
            tex.image = im
            tex.extension = 'REPEAT'
            tex.interpolation = 'Linear'
            if channel == 'normal':
                normal = nodes.new('ShaderNodeNormalMap')
                normal.inputs['Strength'].default_value = gm['normalTexture'].get('scale', 1)
                links.new(tex.outputs['Color'], normal.inputs['Color'])
                links.new(normal.outputs['Normal'], bs.inputs['Normal'])
            else:
                links.new(tex.outputs['Color'], bs.inputs['Base Color' if channel == 'basecolor' else 'Roughness'])
            blender_maps.append({'material': mat.name, 'channel': channel, 'sha256': sha(OUT / entry['files'][channel]['path']), 'packed': True, 'colorspace': im.colorspace_settings.name})
        mat['appearance_policy'] = 'authored-pbr-v1'
        assert plain({k: v for k, v in mat.items() if k != 'appearance_policy'}) == original_properties[mat.name]
    bpy.context.view_layer.update()
    assert snapshot(scene) == before, 'Scene geometry/UV/transforms/render settings changed'
    scene['revision'] = REV
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.file.pack_all()
    blend_path = OUT / 'acro168c-expanded.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    # Reload the actual deliverable, rather than asserting only in-memory state.
    bpy.ops.wm.open_mainfile(filepath=str(blend_path), use_scripts=False)
    bpy.context.view_layer.update()
    assert snapshot(bpy.context.scene) == before
    for entry in manifest['materials']:
        m = bpy.data.materials[entry['name']]
        assert m['appearance_policy'] == 'authored-pbr-v1'
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.name.startswith('Authored PBR / '):
                assert n.image.packed_file is not None
    candidate_glb = OUT / 'acro168c-expanded.glb'
    shutil.copyfile(s2_glb, candidate_glb)
    assert sha(candidate_glb) == EXPECTED
    info = json.loads(source_files[2].read_text())
    parent_info = copy.deepcopy(info)
    info.update(finish_revision=REV, blend_sha256=sha(blend_path), glb_sha256=sha(candidate_glb))
    assert {k for k in info if info[k] != parent_info.get(k)} == {'finish_revision', 'blend_sha256', 'glb_sha256'}
    dump(OUT / 'model-info.json', info)
    assert protected == {str(p): sha(p) for p in source_files}
    result_manifest = copy.deepcopy(manifest)
    result_manifest.update(revision=REV, candidate='acro168c-expanded.glb', paired_blend='acro168c-expanded.blend', paired_blend_sha256=sha(blend_path), source_manifest=str(S2 / 'material-manifest.json'), source_manifest_sha256=sha(S2 / 'material-manifest.json'), metadata='model-info.json', active_web_changed=False)
    result_manifest['blender_files'] = 'This paired BLEND starts from pristine details-v2 and includes all five appearance_policy markers, packed source maps and preserved source camera/light/visibility settings.'
    result_manifest['preview_reuse_reason'] = 'GLB bytes identical to S2 authored candidate; paired BLEND uses the same source maps and source lighting. S2 before/after PNGs restore ceilings and use their recorded review camera; paired BLEND preserves original cutaway viewport settings.'
    for entry in result_manifest['materials']:
        entry['normal']['runtime_normalScale'] = 'Preserve signed GLTFLoader result. With no TANGENT attribute this loader uses [1,-1], not setScalar(1). glTF normalTexture.scale stays 1.'
        entry['uv']['application_tile_m'] = [1.2, 1.2]
        entry['uv']['physical_sample_status'] = 'Existing generator UV convention 1.2m/tile, not a measured material sample. Normal swatch baked at 1m; physical relief height unverified. No UV transform added.'
    dump(OUT / 'material-manifest.json', result_manifest)
    report = {
        'passed': True, 'revision': REV, 'source_files_sha256': protected,
        'source_files_unchanged': True, 'source_glb_binary_prefix_identical': True,
        'glb_all_nodes_meshes_accessors_scenes_extras_equal': True,
        'glb_original_images_preserved': len(old['images']),
        'glb_untargeted_materials_preserved': len(old['materials']) - len(target_indices),
        'glb_exact_s2_candidate_sha256': EXPECTED,
        'blender_geometry_and_normals_equal_meshes': len(before['geometry']),
        'blender_all_uv_layers_equal_meshes': len(before['uv']),
        'blender_object_state_equal': len(before['objects']),
        'blender_source_light_camera_visibility_settings_preserved': True,
        'blender_reopened_file_verification': True,
        'blender_five_material_properties_tagged': True,
        'source_geometry_digest': digest(before['geometry']), 'source_uv_digest': digest(before['uv']),
        'maps_sha256': maps, 'blender_map_bindings': blender_maps,
        'outputs_sha256': {p.name: sha(p) for p in [blend_path, candidate_glb, OUT / 'model-info.json', OUT / 'material-manifest.json']},
        'modeling_metadata_changed_fields_only': ['finish_revision', 'blend_sha256', 'glb_sha256'],
        'material_scope': 'Shared named materials, including adjacent rooms, exactly as S2 manifest affected_nodes; not a kitchen-only mask.',
        'gpu_render_inference_calls': 0, 'web_runtime_or_active_paths_changed': False,
        'visual_validation': 'S2 before/after render inspected; subtle appearance change, not photorealism or measured-material recovery.',
    }
    dump(OUT / 'verification.json', report)
    print(json.dumps({'passed': True, 'candidate_directory': str(OUT), 'outputs_sha256': report['outputs_sha256'], 'mesh_count': len(before['geometry'])}), flush=True)


if __name__ == '__main__':
    build()
