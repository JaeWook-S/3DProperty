"""CPU-only tests with explicit synthetic geometry; no fake GPU mode in the service."""
import contextlib
import io
import itertools
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

from services.furniture_pipeline.config import SERVICE_ROOT, Settings, load_options, project_path
from services.furniture_pipeline.pipeline.moge3_infer import measure_objects, make_overlay
from services.furniture_pipeline.pipeline.postprocess import deduplicate_masks, dimension_array, estimate_up_from_ground, fit_upright_obb, masked_points, save_measurements
from services.furniture_pipeline.pipeline.run_measurement import run_measurement, run_worker, WorkerError


def settings_for(directory):
    return Settings(Path(directory), Path(directory) / "cache", Path(sys.executable), Path(sys.executable), SERVICE_ROOT / "settings.json", generate_3d=False)


class MeasurementTests(unittest.TestCase):
    def test_python_path_keeps_virtual_environment_symlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "python"
            path.symlink_to(sys.executable)
            self.assertEqual(project_path(str(path)), path)
            self.assertNotEqual(project_path(str(path)), path.resolve())

    def test_rotated_cuboid_retains_meter_dimensions_and_axis_swap(self):
        corners = np.array(list(itertools.product([-1, 1], [-0.75, 0.75], [-0.3, 0.3])))
        angle = np.deg2rad(25)
        rotation = np.array([[np.cos(angle), 0, np.sin(angle)], [0, 1, 0], [-np.sin(angle), 0, np.cos(angle)]])
        points = corners @ rotation.T + [0, 0, 4]
        result = fit_upright_obb(points)
        np.testing.assert_allclose([result["width_m"], result["height_m"], result["depth_m"]], [2, 1.5, 0.6], atol=1e-6)
        swapped = fit_upright_obb(points, swap_width_depth=True)
        np.testing.assert_allclose([swapped["width_m"], swapped["depth_m"]], [0.6, 2], atol=1e-6)

    def test_ground_plane_and_duplicate_prompts(self):
        x, z = np.meshgrid(np.linspace(-2, 2, 30), np.linspace(1, 6, 30))
        points = np.stack([x, np.ones_like(x), z], axis=-1)
        up, info = estimate_up_from_ground(points, np.ones((30, 30), bool), np.empty((0, 30, 30), bool), lower_image_fraction=0)
        np.testing.assert_allclose(up, [0, -1, 0], atol=1e-8)
        self.assertEqual(info["inlier_points"], 900)
        mask = np.ones((20, 20), bool)
        data = {"masks": np.stack([mask, mask]), "scores": np.array([0.8, 0.9]), "labels": np.array(["table", "desk"])}
        result = deduplicate_masks(data)
        self.assertEqual(result["labels"].tolist(), ["desk"])

    def test_invalid_geometry_is_excluded_without_zero_dimensions(self):
        points = np.ones((20, 20, 3))
        points[:, :, 2] = -1
        with self.assertRaises(ValueError):
            masked_points(points, np.ones((20, 20), bool), np.ones((20, 20), bool), np.zeros((20, 20, 3), np.uint8))
        options = load_options(SERVICE_ROOT / "settings.json")
        sam = {"masks": np.ones((1, 20, 20), bool), "scores": [0.9], "labels": ["chair"]}
        with tempfile.TemporaryDirectory() as directory:
            records, _ = measure_objects(np.zeros((20, 20, 3), np.uint8), sam, {"points": points, "mask": np.ones((20, 20), bool)}, options, Path(directory))
            self.assertEqual(records[0]["status"], "insufficient_geometry")
            self.assertIsNone(records[0]["width_m"])
            self.assertEqual(dimension_array(records).shape, (0, 3))

    def test_masked_point_map_is_measured_and_overlay_and_cloud_are_saved(self):
        options = load_options(SERVICE_ROOT / "settings.json")
        options.update(auto_estimate_up_from_ground=False, erode_pixels=0, knn_outlier_std=None, trim_percent=0)
        # Surface samples with known extents W=2, H=1.5, D=0.6.
        x, y = np.meshgrid(np.linspace(-1, 1, 40), np.linspace(-0.75, 0.75, 32))
        z = 4 + 0.3 * np.sin(np.linspace(-np.pi / 2, np.pi / 2, 40))[None, :]
        points = np.stack([x, y, np.broadcast_to(z, x.shape)], axis=-1)
        rgb = np.full((32, 40, 3), 160, np.uint8)
        sam = {"masks": np.ones((1, 32, 40), bool), "scores": [0.9], "labels": ["chair"]}
        geometry = {"points": points, "mask": np.ones((32, 40), bool), "intrinsics": np.array([[1, 0, 0.5], [0, 1, 0.5], [0, 0, 1]])}
        with tempfile.TemporaryDirectory() as directory:
            records, _ = measure_objects(rgb, sam, geometry, options, Path(directory))
            self.assertEqual(records[0]["status"], "ok")
            self.assertTrue(Path(records[0]["point_cloud_path"]).is_file())
            self.assertTrue(Path(records[0]["mask_path"]).is_file())
            make_overlay(rgb, sam["masks"], records, geometry, Path(directory) / "overlay.png")
            with Image.open(Path(directory) / "overlay.png") as overlay:
                self.assertEqual(overlay.size, (40, 32))


    def test_orchestrator_normalizes_once_runs_workers_sequentially_and_prints_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            image = root / "image.jpg"
            Image.new("RGB", (80, 40), "white").save(image)
            output = root / "result"
            calls = []
            def worker(command, settings):
                calls.append(command)
                if len(calls) == 1:
                    np.savez_compressed(output / "sam3_masks.npz", masks=np.ones((1, 40, 80), bool))
                else:
                    records = [{"object_id": 0, "label": "chair", "status": "ok", "score": 0.9, "depth_m": 0.6, "height_m": 0.75, "width_m": 0.8}]
                    save_measurements(records, {}, output)
                    Image.new("RGB", (80, 40)).save(output / "measurement_overlay.png")
            capture = io.StringIO()
            with patch("services.furniture_pipeline.pipeline.run_measurement.run_worker", side_effect=worker), contextlib.redirect_stdout(capture):
                result = run_measurement(settings_for(root), image, output)
            self.assertEqual(result["outcome"], "measured")
            self.assertIn("sam3_infer.py", calls[0][1])
            self.assertIn("moge3_infer.py", calls[1][1])
            self.assertIn('"width_m": 0.8', capture.getvalue())
            np.testing.assert_allclose(np.load(output / "dimensions_dhw_m.npy"), [[0.6, 0.75, 0.8]])

    def test_empty_sam_result_runs_real_worker_without_loading_gpu_weights(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            Image.new("RGB", (40, 32), "white").save(directory / "input_rgb.png")
            (directory / "input.json").write_text("{}")
            np.savez_compressed(directory / "sam3_masks.npz", masks=np.empty((0, 32, 40), bool), scores=np.array([]), labels=np.array([], dtype=str))
            subprocess.run([sys.executable, str(SERVICE_ROOT / "pipeline/moge3_infer.py"), "--image", str(directory / "input_rgb.png"), "--masks", str(directory / "sam3_masks.npz"), "--output", str(directory), "--settings", str(SERVICE_ROOT / "settings.json"), "--checkpoint", "NOT_DOWNLOADED"], check=True)
            self.assertEqual(json.loads((directory / "measurements.json").read_text())["objects"], [])
            self.assertTrue((directory / "measurement_overlay.png").is_file())

    def test_worker_failure_and_timeout_are_not_successful_measurements(self):
        with tempfile.TemporaryDirectory() as directory:
            settings = settings_for(directory)
            with self.assertRaises(WorkerError):
                run_worker([sys.executable, "-c", "raise SystemExit(3)"], settings)
            from dataclasses import replace
            with self.assertRaises(WorkerError):
                run_worker([sys.executable, "-c", "import time; time.sleep(10)"], replace(settings, worker_timeout=1))


if __name__ == "__main__":
    unittest.main()
