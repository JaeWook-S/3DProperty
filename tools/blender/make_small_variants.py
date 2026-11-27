"""Derive the house-tour `small_*.glb` variants from GLBs we already have.

Run from the 3DProperty root (Blender 4.2+ / 5.x, no GUI):
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    --python tools/blender/make_small_variants.py -- [variant ...]

Each variant reads one supplied GLB and writes a resized or re-tinted copy beside it:
  small_rug                rug.glb, 0.6x in plan (about 1.0 x 1.4 m), textures halved to 2048
  small_black_side_table   dark_brown_circle_table.glb, 55 -> 40 cm across, black-stained wood
  small_white_nightstand   dark_brown_table.glb, 46x63 -> 42x56 cm, white-stained wood
  small_dark_brown_bed     dark_brown_bed.glb, 191 -> 151 cm wide; posts, rails and slats keep
                           their thickness (only the middle stretches)
  small_black_pendant      black_lamp.glb shade only, hung from a 2.6 m ceiling on a cord
  small_oak_bed            oak_bed.glb with the storage drawer pushed back under the bed
  small_black_wardrobe     black_wardrobe.glb with the two open doors closed, laminate darkened to charcoal
  small_pendant_lamp       pendant_lamp.glb with the 150 cm cord shortened for a 2.6 m ceiling
  small_black_frame        oak_frame.glb in black-stained wood

Blender axes: X = glTF X (width), -Y = glTF Z (depth), Z = glTF Y (height).
"""
import sys
from pathlib import Path

import bpy
import bmesh
import numpy as np
from mathutils import Vector

ROOT = Path.cwd() / 'assets' / 'house-tours'
CEILING = 2.6


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load(path):
    bpy.ops.import_scene.gltf(filepath=str(path))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    # Bake every transform into the vertices so edits happen in world meters.
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.make_single_user(object=True, obdata=True)
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in list(bpy.context.scene.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    return meshes


def bounds(objects):
    pts = [o.matrix_world @ v.co for o in objects for v in o.data.vertices]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def map_vertices(objects, fn):
    for o in objects:
        co = np.empty(len(o.data.vertices) * 3)
        o.data.vertices.foreach_get('co', co)
        co = fn(co.reshape(-1, 3))
        o.data.vertices.foreach_set('co', co.ravel())
        o.data.update()


def scale(objects, sx, sy, sz):
    def fn(co):
        co[:, 0] *= sx; co[:, 1] *= sy; co[:, 2] *= sz
        return co
    map_vertices(objects, fn)


def recenter(objects, keep_height=False):
    """Footprint centered on the origin, standing on z = 0 (unless it hangs from the ceiling)."""
    lo, hi = bounds(objects)
    shift = np.array([(lo.x + hi.x) / 2, (lo.y + hi.y) / 2, 0 if keep_height else lo.z])
    map_vertices(objects, lambda co: co - shift)


def base_color_images(objects, material=lambda name: True):
    images = set()
    for o in objects:
        for slot in o.material_slots:
            mat = slot.material
            if not mat or not mat.use_nodes or not material(mat.name):
                continue
            bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            if not bsdf:
                continue
            for link in bsdf.inputs['Base Color'].links:
                if link.from_node.type == 'TEX_IMAGE' and link.from_node.image:
                    images.add(link.from_node.image)
    return images


def retint(images, fn):
    """Rewrites base-color pixels (sRGB, 0..1) and packs the result into the export."""
    for image in images:
        px = np.empty(image.size[0] * image.size[1] * 4, dtype=np.float32)
        image.pixels.foreach_get(px)
        px = px.reshape(-1, 4)
        px[:, :3] = np.clip(fn(px[:, :3]), 0, 1)
        image.pixels.foreach_set(px.ravel())
        image.update()
        image.pack()


def halve_large_images(limit=2048):
    for image in bpy.data.images:
        w, h = image.size
        if max(w, h) > limit:
            f = limit / max(w, h)
            image.scale(int(w * f), int(h * f))
            image.pack()


def export(path):
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', export_cameras=False,
                              export_lights=False, export_apply=True, export_yup=True)
    print(f'wrote {path} ({path.stat().st_size / 1e6:.1f} MB)')


def small_rug():
    objects = load(ROOT / 'mountain-white' / 'rug.glb')
    objects = [o for o in objects if o.name.startswith('TVR_')]
    scale(objects, 0.6, 0.6, 1.0)  # same weave and pattern, a smaller rug
    recenter(objects)
    halve_large_images()
    export(ROOT / 'mountain-white' / 'small_rug.glb')


def small_black_side_table():
    objects = load(ROOT / 'stone-walnut' / 'dark_brown_circle_table.glb')
    scale(objects, 0.40 / 0.55, 0.40 / 0.55, 1.0)
    recenter(objects)
    luma = lambda rgb: rgb @ np.array([0.2126, 0.7152, 0.0722])
    retint(base_color_images(objects), lambda rgb: rgb * 0.22 + luma(rgb)[:, None] * 0.05)
    export(ROOT / 'mountain-white' / 'small_black_side_table.glb')


def small_white_nightstand():
    objects = load(ROOT / 'stone-walnut' / 'dark_brown_table.glb')
    scale(objects, 0.42 / 0.46, 1.0, 0.56 / 0.63)
    recenter(objects)

    def white_stain(rgb):
        l = rgb @ np.array([0.2126, 0.7152, 0.0722])
        l = (l - l.min()) / max(l.max() - l.min(), 1e-6)  # keep the grain, lose the brown
        return (0.80 + 0.14 * l)[:, None] * np.array([1.0, 0.975, 0.94])
    retint(base_color_images(objects), white_stain)
    export(ROOT / 'mountain-white' / 'small_white_nightstand.glb')


def small_dark_brown_bed(width=1.51):
    objects = load(ROOT / 'stone-walnut' / 'dark_brown_bed.glb')
    lo, hi = bounds(objects)
    half = (hi.x - lo.x) / 2
    inner = half - 0.12            # posts and side rails live outside this
    delta = half - width / 2       # each side moves in by this much
    f = lambda x: np.where(np.abs(x) > inner, np.sign(x) * (np.abs(x) - delta), x * (inner - delta) / inner)
    for o in objects:
        olo, ohi = bounds([o])
        if ohi.x - olo.x < 0.15:   # narrow parts (posts, rails, headboard slats) move, keeping their size
            cx = (olo.x + ohi.x) / 2
            dx = float(f(np.array([cx]))[0] - cx)
            map_vertices([o], lambda co, dx=dx: co + np.array([dx, 0, 0]))
        else:                      # wide parts (mattress, base slats, headboard rails) stretch in the middle
            map_vertices([o], lambda co: np.column_stack([f(co[:, 0]), co[:, 1], co[:, 2]]))
    recenter(objects)
    export(ROOT / 'stone-walnut' / 'small_dark_brown_bed.glb')


def small_black_pendant(shade_center=1.75):
    objects = load(ROOT / 'stone-walnut' / 'black_lamp.glb')
    drop = ('Black_base_bottom', 'Gold_base_disc', 'Gold_upright', 'Pole_base_collar', 'Power_cord_visible_segment')
    keep = []
    for o in objects:
        olo, ohi = bounds([o])
        if o.name.startswith(drop) or ohi.z < 1.2:
            bpy.data.objects.remove(o, do_unlink=True)
        else:
            keep.append(o)
    lo, hi = bounds(keep)
    lift = shade_center - (lo.z + hi.z) / 2
    center = np.array([(lo.x + hi.x) / 2, (lo.y + hi.y) / 2, -lift])
    map_vertices(keep, lambda co: co - center)
    top = hi.z + lift
    cord_material = bpy.data.materials.get('Black_base_and_cord')
    for name, radius, z0, z1 in (('Pendant_cord', 0.004, top - 0.02, CEILING - 0.02), ('Ceiling_canopy', 0.055, CEILING - 0.025, CEILING)):
        mesh = bpy.data.meshes.new(name)
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=radius, radius2=radius, depth=z1 - z0)
        bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, (z0 + z1) / 2))
        bm.to_mesh(mesh); bm.free()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        if cord_material:
            obj.data.materials.append(cord_material)
        keep.append(obj)
    recenter(keep, keep_height=True)
    export(ROOT / 'stone-walnut' / 'small_black_pendant.glb')


def small_oak_bed():
    """oak_bed.glb with its storage drawer pushed back under the bed (it was modeled pulled out)."""
    objects = load(ROOT / 'mountain-white' / 'oak_bed.glb')
    frame = [o for o in objects if 'Drawer' not in o.name]
    _, fhi = bounds(frame)
    for prefix in sorted({o.name[:9] for o in objects if o.name.startswith('Drawer_')}):
        drawer = [o for o in objects if o.name.startswith(prefix)]
        _, dhi = bounds(drawer)
        if dhi.x > fhi.x:
            # Its front screws are separate parts (Visible_Drawer_Screw_*) out beside the frame.
            drawer += [o for o in objects if 'Drawer' in o.name and not o.name.startswith('Drawer_') and bounds([o])[0].x > fhi.x]
            map_vertices(drawer, lambda co, dx=fhi.x - 0.03 - dhi.x: co + np.array([dx, 0, 0]))
    recenter(objects)
    export(ROOT / 'mountain-white' / 'small_oak_bed.glb')


def small_black_wardrobe():
    """black_wardrobe.glb with every door closed onto the carcass front (two were modeled open).

    The carcass has a doorless center section (Center_*) between a left and a right pair of
    doors. A door closes toward whichever side keeps it off that open section, off the doors
    that are already closed and inside the carcass.
    """
    objects = load(ROOT / 'stone-walnut' / 'black_wardrobe.glb')
    body = [o for o in objects if not o.name.startswith('Door_')]
    blo, bhi = bounds(body)
    center = [o for o in objects if o.name.startswith('Center_')]
    open_section = (bounds(center)[0].x + 0.02, bounds(center)[1].x - 0.02) if center else None
    overlap = lambda a, b: max(0.0, min(a[1], b[1]) - max(a[0], b[0]))
    leaves = {}
    for i in range(1, 10):
        door = [o for o in objects if o.name.startswith(f'Door_{i}_')]
        panel = [o for o in door if 'leaf' in o.name]
        if panel:
            leaves[i] = (door, panel)
    pose = {}
    for i, (door, panel) in leaves.items():
        pts = np.array([(o.matrix_world @ v.co)[:2] for o in panel for v in o.data.vertices])
        back = pts[:, 1].max()                      # hinge side sits against the carcass (front is -Y)
        hinge = pts[pts[:, 1] > back - 0.02].mean(axis=0)
        tip = pts[pts[:, 1].argmin()]
        angle = np.arctan2(tip[1] - hinge[1], tip[0] - hinge[0])
        pose[i] = (door, hinge, angle, np.hypot(*(tip - hinge)))
    closed = {i: (p[1][0], p[1][0] + p[3] * np.sign(np.cos(p[2]))) for i, p in pose.items() if abs(np.sin(p[2])) < 0.05}
    for i, (door, hinge, angle, width) in pose.items():
        if i in closed:
            continue
        def score(theta):
            span = sorted((hinge[0], hinge[0] + width * np.cos(theta)))
            outside = max(0.0, blo.x - span[0]) + max(0.0, span[1] - bhi.x)
            covered = sum(overlap(span, sorted(c)) for c in closed.values())
            blocked = overlap(span, open_section) if open_section else 0.0
            return outside * 10 + covered + blocked
        target = min((0.0, np.pi), key=score)
        turn = target - angle
        c, s = np.cos(turn), np.sin(turn)
        def rotate(co, hinge=hinge, c=c, s=s):
            x, y = co[:, 0] - hinge[0], co[:, 1] - hinge[1]
            return np.column_stack([hinge[0] + c * x - s * y, hinge[1] + s * x + c * y, co[:, 2]])
        map_vertices(door, rotate)
        closed[i] = (hinge[0], hinge[0] + width * np.cos(target))
    # The laminate texture is mid grey (sRGB ~130); darken it to the charcoal its material names.
    retint(base_color_images(objects, lambda name: 'charcoal' in name.lower()), lambda rgb: rgb * 0.42)
    recenter(objects)
    export(ROOT / 'stone-walnut' / 'small_black_wardrobe.glb')


def small_pendant_lamp(shade_bottom=1.6):
    """pendant_lamp.glb with the cord shortened so the canopy meets a 2.6 m ceiling."""
    objects = load(ROOT / 'mountain-white' / 'pendant_lamp.glb')
    cord = next(o for o in objects if o.name.startswith('Suspension_cord'))
    clo, chi = bounds([cord])
    lo, hi = bounds(objects)
    excess = (hi.z - lo.z) - (CEILING - shade_bottom)
    length = (chi.z - clo.z) - excess
    lift = shade_bottom - lo.z
    for o in objects:
        olo, ohi = bounds([o])
        if o is cord:
            map_vertices([o], lambda co: np.column_stack([co[:, 0], co[:, 1], clo.z + (co[:, 2] - clo.z) * length / (chi.z - clo.z) + lift]))
        elif olo.z >= chi.z - 1e-4:                 # strain relief and canopy follow the cord's top
            map_vertices([o], lambda co: co + np.array([0, 0, lift - excess]))
        else:                                       # shade, housing and socket
            map_vertices([o], lambda co: co + np.array([0, 0, lift]))
    recenter(objects, keep_height=True)
    export(ROOT / 'mountain-white' / 'small_pendant_lamp.glb')


def small_black_frame():
    """oak_frame.glb in black-stained wood, for the dark walls of stone-walnut."""
    objects = load(ROOT / 'mountain-white' / 'oak_frame.glb')
    rails = [o for o in objects if 'rail' in o.name]
    luma = lambda rgb: rgb @ np.array([0.2126, 0.7152, 0.0722])
    retint(base_color_images(rails), lambda rgb: rgb * 0.18 + luma(rgb)[:, None] * 0.04)
    recenter(objects)
    export(ROOT / 'stone-walnut' / 'small_black_frame.glb')


VARIANTS = {f.__name__: f for f in (small_rug, small_black_side_table, small_white_nightstand, small_dark_brown_bed, small_black_pendant,
                                     small_oak_bed, small_black_wardrobe, small_pendant_lamp, small_black_frame)}

if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    for name in args or VARIANTS:
        reset()
        VARIANTS[name]()
