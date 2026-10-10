"""Trusted test-code export tests. No model downloads or GPT calls."""
import contextlib
from dataclasses import replace
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import struct
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

from services.furniture_pipeline.api.main import create_app
from services.furniture_pipeline.pipeline.build_assets import build_assets, dimensions_for, validate_glb
from services.furniture_pipeline.tests.test_api import image_bytes
from services.furniture_pipeline.tests.test_measurement import settings_for

RECORD = {"status": "ok", "label": "chair", "width_m": 0.8, "depth_m": 0.6, "height_m": 0.75}
JOB_ID = 'b' * 32


def tiny_glb():
    doc = json.dumps({"asset": {"version": "2.0"}, "meshes": [{"primitives": []}], "buffers": [{"byteLength": 4}]}).encode()
    doc += b' ' * (-len(doc) % 4)
    return struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(doc) + 12) + struct.pack('<II', len(doc), 0x4E4F534A) + doc + struct.pack('<II', 4, 0x004E4942) + b'\0' * 4


def fake_export(command, settings, timeout):
    model = Path(command[command.index('--output') + 1])
    model.write_bytes(tiny_glb())
    Path(command[command.index('--report') + 1]).write_text(json.dumps({"blender_version": "test-only"}))


class GenerationTests(unittest.TestCase):
    def test_failed_null_or_invalid_dimensions_are_not_fabricated(self):
        self.assertEqual(dimensions_for(RECORD), {"width": .8, "depth": .6, "height": .75})
        for update in ({"status": "insufficient_geometry"}, {"width_m": None}, {"height_m": False}, {"depth_m": float('nan')}, {"width_m": 51}):
            self.assertIsNone(dimensions_for(RECORD | update))

    def test_stub_receives_original_image_and_dimensions_and_writes_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / JOB_ID
            directory.mkdir()
            image = directory / 'upload.png'
            image.write_bytes(image_bytes())
            settings = replace(settings_for(temporary), generate_3d=True, blender_executable=Path(shutil.which('true')))
            output = io.StringIO()
            with contextlib.redirect_stdout(output), patch('services.furniture_pipeline.pipeline.build_assets.run_worker', side_effect=fake_export) as worker:
                result = build_assets(settings, image, directory, {"objects": [RECORD, RECORD | {"status": "insufficient_geometry"}]})
            self.assertIn('이미지 + 치수 받았습니다. 나중엔 GPT API를 연결하세요', output.getvalue())
            handoff = json.loads((directory / 'gpt_input.json').read_text())
            self.assertEqual(handoff['image_path'], str(image))
            self.assertEqual(handoff['image_sha256'], hashlib.sha256(image_bytes()).hexdigest())
            self.assertEqual(handoff['objects'][0]['dimensions_m']['height'], .75)
            self.assertEqual(worker.call_count, 1)
            self.assertEqual(result['status'], 'completed')
            self.assertEqual(result['assets'][0]['revision'], 'stub-blender-v1')
            self.assertTrue((directory / 'assets/000/generated_model.py').is_file())
            self.assertEqual(result['assets'][0], json.loads((directory / 'assets/000/asset.json').read_text()))

    def test_no_detection_skips_blender_and_failed_exports_publish_no_assets(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / JOB_ID
            directory.mkdir()
            image = directory / 'upload.png'
            image.write_bytes(image_bytes())
            settings = replace(settings_for(temporary), generate_3d=True, blender_executable=Path(shutil.which('true')))
            with patch('services.furniture_pipeline.pipeline.build_assets.run_worker') as worker:
                self.assertEqual(build_assets(settings, image, directory, {"objects": []})['status'], 'skipped')
                worker.assert_not_called()
            with patch('services.furniture_pipeline.pipeline.build_assets.run_worker', side_effect=RuntimeError('export timeout')):
                result = build_assets(settings, image, directory, {"objects": [RECORD]})
            self.assertEqual(result['status'], 'failed')
            self.assertEqual(result['assets'], [])
            self.assertFalse((directory / 'assets/000/asset.json').exists())

    def test_bad_or_external_resource_glb_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'bad.glb'
            for data in (b'bad', tiny_glb()[:-1], tiny_glb().replace(b'"buffers"', b'"bufferr"')):
                path.write_bytes(data)
                with self.assertRaises(ValueError): validate_glb(path)

    def test_api_preserves_measurement_when_blender_fails(self):
        with tempfile.TemporaryDirectory() as temporary:
            settings = replace(settings_for(temporary), generate_3d=True)
            def runner(*args, **kwargs): return {"outcome": "measured", "objects": [RECORD]}
            def builder(*args, **kwargs): raise RuntimeError('Blender missing')
            with TestClient(create_app(settings, runner, builder)) as client, self.assertLogs('uvicorn.error', level='ERROR'):
                accepted = client.post('/api/furniture/measure', files={'image': ('chair.png', image_bytes(), 'image/png')}).json()
                job = client.get(accepted['status_url']).json()
                self.assertEqual(job['status'], 'completed')
                self.assertEqual(job['result']['objects'][0]['width_m'], .8)
                self.assertEqual(job['result']['generation']['status'], 'failed')
                self.assertEqual(client.get('/api/furniture/assets').json()['assets'], [])

    def test_api_serves_only_published_glb_and_manifest_and_survives_restart(self):
        with tempfile.TemporaryDirectory() as temporary:
            settings = replace(settings_for(temporary), generate_3d=True, blender_executable=Path(shutil.which('true')))
            def runner(*args, **kwargs): return {"outcome": "measured", "objects": [RECORD]}
            with patch('services.furniture_pipeline.pipeline.build_assets.run_worker', side_effect=fake_export), TestClient(create_app(settings, runner)) as client:
                accepted = client.post('/api/furniture/measure', files={'image': ('chair.png', image_bytes(), 'image/png')}).json()
                assets = client.get('/api/furniture/assets').json()['assets']
                self.assertEqual(len(assets), 1)
                asset = assets[0]
                self.assertEqual(client.get(asset['model_uri']).content, tiny_glb())
                self.assertEqual(client.get(asset['manifest_uri']).json(), asset)
                for filename in ('upload.png', 'generated_model.py', 'generation_input.json', '%2e%2e', 'job.json'):
                    self.assertEqual(client.get(f"/api/furniture/assets/{asset['asset_id']}/{filename}").status_code, 404)
                self.assertEqual(client.get('/api/furniture/assets/' + 'c' * 32 + '-000/model.glb').status_code, 404)
            with TestClient(create_app(settings, runner)) as restarted:
                self.assertEqual(restarted.get(asset['model_uri']).status_code, 200)

    def test_real_headless_blender_exports_metric_embedded_glb(self):
        executable = os.getenv('BLENDER_TEST_EXECUTABLE') or shutil.which('blender') or '/Applications/Blender.app/Contents/MacOS/Blender'
        if not Path(executable).is_file(): self.skipTest('Install Blender to run the real export test')
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / JOB_ID
            directory.mkdir()
            image = directory / 'upload.png'
            Image.new('RGB', (40, 32), 'white').save(image)
            settings = replace(settings_for(temporary), generate_3d=True, blender_executable=Path(executable))
            result = build_assets(settings, image, directory, {"objects": [RECORD]})
            self.assertEqual(result['status'], 'completed', result)
            report = result['assets'][0]['export']
            self.assertEqual(report['mesh_count'], 5)
            self.assertEqual(result['assets'][0]['model_sha256'], validate_glb(directory / 'assets/000/model.glb'))
            for value, expected in zip(report['bounds_blender'][1], [.4, .3, .75]): self.assertAlmostEqual(value, expected, places=5)


if __name__ == '__main__': unittest.main()
