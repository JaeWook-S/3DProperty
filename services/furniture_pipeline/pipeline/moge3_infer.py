"""MoGe-3 worker and notebook postprocessing, in the NumPy 2.x environment."""
import argparse
import importlib.metadata
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

if __package__:
    from .postprocess import estimate_up_from_ground, fit_upright_obb, masked_points, save_measurements, unit_vector
else:
    from postprocess import estimate_up_from_ground, fit_upright_obb, masked_points, save_measurements, unit_vector

BOX_EDGES = [(0, 1), (1, 2), (2, 3), (3, 0), (4, 5), (5, 6), (6, 7), (7, 4), (0, 4), (1, 5), (2, 6), (3, 7)]
COLORS = [(55, 143, 216), (220, 144, 40), (60, 174, 98), (183, 92, 172)]


def make_overlay(rgb, masks, records, geometry, path):
    image = Image.fromarray(rgb).convert("RGBA")
    height, width = rgb.shape[:2]
    for record, mask in zip(records, masks):
        color = COLORS[record["object_id"] % len(COLORS)]
        rgba = np.zeros((height, width, 4), dtype=np.uint8)
        rgba[mask] = (*color, 80)
        image = Image.alpha_composite(image, Image.fromarray(rgba))
        draw = ImageDraw.Draw(image)
        if record["status"] == "ok":
            corners = np.asarray(record["corners_camera_m"])
            intrinsics = np.diag([width, height, 1]) @ geometry["intrinsics"]
            projected = corners @ intrinsics.T
            visible = np.isfinite(projected).all(axis=1) & (corners[:, 2] > 1e-6)
            uv = np.zeros((8, 2))
            uv[visible] = projected[visible, :2] / projected[visible, 2:3]
            for a, b in BOX_EDGES:
                if visible[a] and visible[b]:
                    # Pillow cannot draw coordinates outside its integer range.
                    points = np.clip(uv[[a, b]], -1000000, 1000000)
                    draw.line([tuple(points[0]), tuple(points[1])], fill=color, width=2)
        ys, xs = np.nonzero(mask)
        if len(xs):
            label = f'#{record["object_id"]} {record["label"]}'
            if record["status"] == "ok":
                label += f' D/H/W={record["depth_m"]:.2f}/{record["height_m"]:.2f}/{record["width_m"]:.2f}m'
            else:
                label += " insufficient geometry"
            draw.text((int(xs.min()), int(ys.min())), label, fill="white", stroke_width=1, stroke_fill="black")
    image.convert("RGB").save(path)


def measure_objects(rgb, sam, geometry, options, directory):
    up = unit_vector(options["up_vector_camera"], "up_vector_camera")
    up_source, ground_info = "configured_camera_up", None
    if geometry is not None and options["auto_estimate_up_from_ground"] and len(sam["masks"]):
        try:
            up, ground_info = estimate_up_from_ground(
                geometry["points"], geometry["mask"], sam["masks"], fallback_up=up,
                lower_image_fraction=options["ground_lower_image_fraction"],
                iterations=options["ground_ransac_iterations"], distance_ratio=options["ground_distance_ratio"],
            )
            up_source = "estimated_ground_plane"
            print("Ground plane up:", up.tolist(), ground_info, flush=True)
        except ValueError as error:
            print("Ground plane fallback:", str(error), flush=True)
    records = []
    for object_id, (mask, score, label) in enumerate(zip(sam["masks"], sam["scores"], sam["labels"])):
        row = {
            "object_id": object_id, "label": str(label), "score": float(score),
            "status": "ok", "depth_m": None, "height_m": None, "width_m": None,
            "measurement_scope": "visible_surface_extent_estimate",
        }
        mask_path = directory / f"mask_{object_id:03d}.png"
        Image.fromarray(mask.astype(np.uint8) * 255).save(mask_path)
        row["mask_path"] = str(mask_path)
        try:
            points, colors, pixels = masked_points(
                geometry["points"], geometry["mask"], mask, rgb,
                min_points=options["min_points"], erode_pixels=options["erode_pixels"], knn_std=options["knn_outlier_std"],
            )
            box = fit_upright_obb(points, up, options["width_direction_camera"], options["trim_percent"], options["swap_width_depth"])
            row.update(box)
            row.update(point_count=len(points), up_vector_camera_used=up.tolist(), up_vector_source=up_source)
            row["assumptions"] = ["single_view_visible_surface", up_source]
            if options["width_direction_camera"] is None:
                row["assumptions"].append("width_depth_semantics_ambiguous")
            cloud_path = directory / f"object_{object_id:03d}.npz"
            np.savez_compressed(cloud_path, points_m=points.astype(np.float32), colors=colors, pixels_xy=pixels, corners_m=np.asarray(box["corners_camera_m"]))
            row["point_cloud_path"] = str(cloud_path)
        except ValueError as error:
            row.update(status="insufficient_geometry", reason=str(error))
        records.append(row)
    return records, ground_info


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--masks", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--settings", required=True)
    parser.add_argument("--checkpoint", required=True)
    args = parser.parse_args()
    directory = Path(args.output).resolve()
    options = json.loads(Path(args.settings).read_text(encoding="utf-8"))
    rgb = np.asarray(Image.open(args.image).convert("RGB"))
    height, width = rgb.shape[:2]
    with np.load(args.masks, allow_pickle=False) as data:
        sam = {key: data[key].copy() for key in data.files}
    if sam["masks"].shape[1:] != (height, width):
        raise RuntimeError("SAM3 mask resolution does not match canonical image")
    geometry = None
    if len(sam["scores"]):
        import torch
        from moge.model.v3 import MoGeModel

        if not torch.cuda.is_available():
            raise RuntimeError("MoGe-3: CUDA GPU is unavailable")
        model = MoGeModel.from_pretrained(args.checkpoint).to("cuda").eval()
        if not hasattr(model, "scale_head"):
            raise RuntimeError("Checkpoint has no metric scale head; use official MoGe-3 weights")
        tensor = torch.from_numpy(rgb.copy()).permute(2, 0, 1).to("cuda", dtype=torch.float32) / 255.0
        with torch.inference_mode():
            prediction = model.infer(
                tensor, resolution_level=options["moge_resolution_level"], refine_steps=options["moge_refine_steps"],
                fov_x=options["fov_x_degrees"], use_fp16=options["moge_use_fp16"], apply_mask=True,
            )
        geometry = {key: value.detach().float().cpu().numpy() for key, value in prediction.items() if key in {"points", "depth", "mask", "intrinsics"}}
        if geometry["points"].shape != (height, width, 3) or geometry["mask"].shape != (height, width):
            raise RuntimeError("MoGe-3 geometry resolution does not match canonical image")
        geometry["mask"] = geometry["mask"] > 0.5
        geometry["points"] *= options["scale_multiplier"]
        geometry["depth"] *= options["scale_multiplier"]
        np.savez_compressed(directory / "moge3_geometry.npz", **geometry)
        del tensor, model, prediction
        torch.cuda.empty_cache()
    records, ground_info = measure_objects(rgb, sam, geometry, options, directory)
    metadata = json.loads((directory / "input.json").read_text(encoding="utf-8")) | {
        "method": "SAM3 + MoGe-3", "unit": "meter", "array_order": ["depth", "height", "width"],
        "moge_checkpoint": args.checkpoint,
        "settings": options, "ground_plane": ground_info,
        "limitations": "Visible surface estimate; no hidden-surface completion; metric scale and axes require validation.",
    }
    metadata["versions"] = {}
    for package in ("torch", "numpy", "moge"):
        try:
            metadata["versions"][package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            pass
    save_measurements(records, metadata, directory)
    make_overlay(rgb, sam["masks"], records, geometry, directory / "measurement_overlay.png")


if __name__ == "__main__":
    main()
