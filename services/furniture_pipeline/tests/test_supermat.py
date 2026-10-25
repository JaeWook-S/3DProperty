"""CPU integration tests use synthetic material maps, never model downloads."""
from dataclasses import replace
import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
import numpy as np
from PIL import Image

from services.furniture_pipeline.api.main import create_app
from services.furniture_pipeline.pipeline import code_provider
from services.furniture_pipeline.pipeline.material_prompt import prepare_material_prompt
from services.furniture_pipeline.tests.test_api import image_bytes
from services.furniture_pipeline.tests.test_generation import fake_export, JOB_ID, RECORD, tiny_glb
from services.furniture_pipeline.tests.test_measurement import settings_for


DIMENSIONS = {"width": .8, "depth": .6, "height": .75}


def material_fixture(directory):
    """Canonical image and SAM mask share a frame unlike the original upload."""
    directory = Path(directory)
    canonical, mask = directory / "input_rgb.png", directory / "mask_000.png"
    Image.new("RGB", (8, 6), (160, 90, 40)).save(canonical)
    pixels = np.zeros((6, 8), dtype=np.uint8)
    pixels[:, :4] = 255
    Image.fromarray(pixels).save(mask)
    return canonical, mask


def material_worker(command, settings, timeout=None):
    """Replace only neural inference; execute the actual summarizer as a worker."""
    if "--output-dir" not in command:
        subprocess.run(command, check=True, env=settings.worker_environment(), capture_output=True, text=True)
        return
    image = Path(command[command.index("--input") + 1])
    maps = Path(command[command.index("--output-dir") + 1]) / image.stem
    maps.mkdir(parents=True, exist_ok=True)
    with Image.open(image) as foreground:
        selected = np.asarray(foreground.getchannel("A")) > 127
    albedo = np.empty((*selected.shape, 3), dtype=np.uint8)
    albedo[:] = [0, 0, 255]
    albedo[selected] = [160, 90, 40]
    Image.fromarray(albedo).save(maps / "albedo.png")
    for name, foreground_value, background_value in (("roughness", 51, 230), ("metallic", 204, 0)):
        Image.fromarray(np.where(selected, foreground_value, background_value).astype(np.uint8)).save(maps / f"{name}.png")


class SuperMatTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        self.enterContext(patch.dict(os.environ, {"PIPELINE_CODE_PROVIDER": "stub"}))

    def configured(self, directory):
        checkpoint = Path(directory) / "test-supermat.pth"
        checkpoint.write_bytes(b"synthetic inference fixture; never loaded")
        return replace(settings_for(directory), generate_3d=True,
            blender_executable=Path(shutil.which("true")), supermat_python=Path(sys.executable),
            supermat_checkpoint=checkpoint)

    def test_material_prompt_uses_canonical_frame_alpha_and_real_foreground_statistics(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / JOB_ID
            directory.mkdir()
            original = directory / "upload.png"
            original.write_bytes(image_bytes())
            canonical, mask = material_fixture(directory)
            stages = []
            measurement = {"objects": [RECORD | {"mask_path": str(mask)}], "artifacts": {"input": str(canonical)}}
            with patch("services.furniture_pipeline.pipeline.material_prompt.run_worker", side_effect=material_worker) as worker:
                material = prepare_material_prompt(self.configured(temporary), original, directory,
                    measurement["objects"][0], 0, DIMENSIONS, measurement, progress=stages.append)
            self.assertEqual(worker.call_count, 2)
            foreground = Path(material["image_path"])
            with Image.open(foreground) as image:
                self.assertEqual(image.mode, "RGBA")
                self.assertEqual(image.size, (8, 6))
                self.assertEqual(image.getpixel((0, 0))[-1], 255)
                self.assertEqual(image.getpixel((7, 0))[-1], 0)
            summary = json.loads(Path(material["summary_path"]).read_text())
            self.assertEqual(summary["dimensions_cm"], {"width": 80, "depth": 60, "height": 75})
            self.assertIsNone(summary["background_warning"])
            self.assertTrue(summary["regions"])
            for region in summary["regions"]:
                self.assertEqual(region["albedo_rgb_8bit_median"], [160, 90, 40])
                self.assertEqual(region["roughness"]["median"], .2)
                self.assertEqual(region["metallic"]["median"], .8)
            self.assertEqual(material["prompt"], Path(material["prompt_path"]).read_text())
            self.assertIn("create_model(dimensions)", material["prompt"])
            self.assertIn('"width": 0.8', material["prompt"])
            self.assertEqual(set(material["maps"]), {"albedo", "roughness", "metallic"})
            for path in material["maps"].values(): self.assertTrue(Path(path).is_file())

    def test_missing_mask_never_runs_unmasked_inference(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / JOB_ID
            directory.mkdir()
            original = directory / "upload.png"
            original.write_bytes(image_bytes())
            Image.new("RGB", (8, 6), "white").save(directory / "input_rgb.png")
            with patch("services.furniture_pipeline.pipeline.material_prompt.run_worker") as worker:
                with self.assertRaises((ValueError, RuntimeError, FileNotFoundError)):
                    prepare_material_prompt(self.configured(temporary), original, directory, RECORD, 0, DIMENSIONS, {"objects": [RECORD]})
                worker.assert_not_called()

    def test_misaligned_and_empty_sam_masks_are_rejected_before_inference(self):
        for pixels in (np.ones((3, 4), dtype=np.uint8) * 255, np.zeros((6, 8), dtype=np.uint8)):
            with self.subTest(mask_shape=pixels.shape, selected=int(pixels.sum())), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary) / JOB_ID
                directory.mkdir()
                canonical, mask = material_fixture(directory)
                Image.fromarray(pixels).save(mask)
                record = RECORD | {"mask_path": str(mask)}
                with patch("services.furniture_pipeline.pipeline.material_prompt.run_worker") as worker:
                    with self.assertRaises(ValueError):
                        prepare_material_prompt(self.configured(temporary), canonical, directory, record, 0,
                            DIMENSIONS, {"objects": [record]})
                    worker.assert_not_called()

    def test_saved_measurement_uses_original_canonical_frame_and_sam_mask(self):
        with tempfile.TemporaryDirectory() as temporary:
            original_job, new_job = Path(temporary) / "original", Path(temporary) / JOB_ID
            original_job.mkdir()
            new_job.mkdir()
            canonical, mask = material_fixture(original_job)
            uploaded = new_job / "upload.png"
            uploaded.write_bytes(image_bytes())
            record = RECORD | {"mask_path": str(mask)}
            with patch("services.furniture_pipeline.pipeline.material_prompt.run_worker", side_effect=material_worker):
                material = prepare_material_prompt(self.configured(temporary), uploaded, new_job,
                    record, 0, DIMENSIONS, {"objects": [record], "artifacts": {"input": str(canonical)}})
            with Image.open(material["image_path"]) as image:
                self.assertEqual(image.size, (8, 6))
            self.assertTrue(Path(material["prompt_path"]).is_relative_to(new_job.resolve()))

    def test_upload_reaches_real_material_prompt_handoff_and_published_model(self):
        with tempfile.TemporaryDirectory() as temporary:
            def runner(settings, image, directory, progress):
                canonical, mask = material_fixture(directory)
                return {"outcome": "measured", "objects": [RECORD | {"mask_path": str(mask)}], "artifacts": {"input": str(canonical)}}
            with patch("services.furniture_pipeline.pipeline.material_prompt.run_worker", side_effect=material_worker), \
                    patch("services.furniture_pipeline.pipeline.build_assets.run_worker", side_effect=fake_export), \
                    TestClient(create_app(self.configured(temporary), runner)) as client:
                response = client.post("/api/furniture/measure", files={"image": ("chair.png", image_bytes(), "image/png")})
                self.assertEqual(response.status_code, 202)
                accepted = response.json()
                job = client.get(accepted["status_url"]).json()
                self.assertEqual(job["status"], "completed", job)
                generation = job["result"]["generation"]
                self.assertEqual(generation["status"], "completed", generation)
                self.assertEqual(job["result"]["objects"][0]["depth_m"], .6)
                handoff = json.loads((Path(temporary) / accepted["job_id"] / "gpt_input.json").read_text())
                self.assertIn("create_model(dimensions)", handoff["prompt"])
                self.assertEqual(handoff["objects"][0]["dimensions_m"], DIMENSIONS)
                asset, = generation["assets"]
                self.assertEqual(client.get(asset["model_uri"]).content, tiny_glb())
                self.assertEqual(client.get(asset["manifest_uri"]).json(), asset)
                self.assertEqual(client.get("/api/furniture/assets").json()["assets"], [asset])


class CodeProviderTests(unittest.TestCase):
    def test_default_stub_is_local_and_retains_compatible_metadata(self):
        with patch.dict(os.environ, {"PIPELINE_CODE_PROVIDER": "stub"}), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(code_provider.provider_info(), {
                "provider": "stub-no-api", "mode": "stub", "template": "demo-table-v1"})
            source = code_provider.provide_blender_code({"prompt": "material prompt", "dimensions_m": DIMENSIONS})
            self.assertEqual(source, code_provider.TEMPLATE.read_text())
            code_provider.validate_blender_code(source)

    def test_invalid_source_cannot_reach_blender(self):
        invalid = (None, "", "```python\ndef create_model(dimensions): pass\n```", "print('missing function')",
            "def create_model(): pass", "def create_model(dimensions, material): pass",
            "async def create_model(dimensions): pass")
        for source in invalid:
            with self.subTest(source=source), self.assertRaises((TypeError, ValueError)):
                code_provider.validate_blender_code(source)


if __name__ == "__main__": unittest.main()
