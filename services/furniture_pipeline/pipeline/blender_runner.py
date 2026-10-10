"""Run trusted repository test code, validate bounds and export a self-contained GLB."""
import argparse
import json
import math
from pathlib import Path
import runpy
import sys

import bpy
from mathutils import Vector


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--script", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--report", required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    dimensions = json.loads(Path(args.input).read_text(encoding="utf-8"))["dimensions_m"]
    expected = [dimensions[key] for key in ("width", "depth", "height")]
    if not all(type(v) in (int, float) and math.isfinite(v) and 0 < v <= 50 for v in expected):
        raise ValueError("Dimensions must be finite positive meters, at most 50 m")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1
    runpy.run_path(args.script)["create_model"](dimensions)
    bpy.context.view_layer.update()
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise ValueError("Blender code produced no meshes")
    points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    low = [min(p[axis] for p in points) for axis in range(3)]
    high = [max(p[axis] for p in points) for axis in range(3)]
    actual = [high[axis] - low[axis] for axis in range(3)]
    for given, measured in zip(expected, actual):
        if not math.isclose(given, measured, rel_tol=1e-4, abs_tol=1e-6):
            raise ValueError(f"Test model dimensions differ: expected {expected}, got {actual}")
    if abs(low[2]) > 1e-6 or abs(low[0] + high[0]) > 1e-5 or abs(low[1] + high[1]) > 1e-5:
        raise ValueError("Test model must use a bottom-center pivot")
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(output), export_format="GLB", use_active_scene=True,
        export_apply=True, export_extras=True, export_yup=True, export_lights=False, export_cameras=False)
    Path(args.report).write_text(json.dumps({"dimensions_m": dimensions, "bounds_blender": [low, high],
        "mesh_count": len(meshes), "blender_version": bpy.app.version_string}), encoding="utf-8")
    print(f"[Blender export] {output} · W/D/H={actual} m", flush=True)


if __name__ == "__main__":
    main()
