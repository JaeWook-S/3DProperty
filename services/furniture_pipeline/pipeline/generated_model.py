"""Fixed test table, not an image reconstruction. Receives dimensions in meters."""
import bpy


def create_model(dimensions):
    width, depth, height = (dimensions[key] for key in ("width", "depth", "height"))
    wood = bpy.data.materials.new("Test model · warm wood")
    wood.diffuse_color = (0.55, 0.32, 0.14, 1)
    wood.use_nodes = True
    shader = wood.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = wood.diffuse_color
    shader.inputs["Roughness"].default_value = 0.6
    top = height * 0.08
    leg = min(width, depth) * 0.1

    def box(name, location, size):
        bpy.ops.mesh.primitive_cube_add(size=1, location=location)
        obj = bpy.context.object
        obj.name = name
        obj.dimensions = size
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.data.materials.append(wood)
        obj["test_model"] = True

    box("Demo table top (GPT not called)", (0, 0, height - top / 2), (width, depth, top))
    for x in (-1, 1):
        for y in (-1, 1):
            box("Demo table leg", (x * (width - leg) / 2, y * (depth - leg) / 2, (height - top) / 2),
                (leg, leg, height - top))
