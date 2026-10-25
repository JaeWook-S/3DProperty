"""Exercise the real OpenAI SDK over an in-memory transport; no paid calls."""
import base64
import contextlib
from dataclasses import replace
import io
import json
import os
from pathlib import Path
import shutil
import struct
import sys
import tempfile
import traceback
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
import httpx
from openai import OpenAI as SDKClient
from PIL import Image

from services.furniture_pipeline.api.main import create_app
from services.furniture_pipeline.pipeline import gpt_provider
from services.furniture_pipeline.pipeline.code_provider import provide_blender_code
from services.furniture_pipeline.tests.test_api import image_bytes
from services.furniture_pipeline.tests.test_generation import RECORD, JOB_ID
from services.furniture_pipeline.tests.test_measurement import settings_for
from services.furniture_pipeline.tests.test_supermat import material_fixture, material_worker

PROVIDER = "services.furniture_pipeline.pipeline.gpt_provider:generate"
KEY = "sk-test-placeholder-not-a-real-key"
DIMENSIONS = {"width": .8, "depth": .6, "height": .75}
SOURCE = '''import bpy

def create_model(dimensions):
    width, depth, height = (dimensions[key] for key in ("width", "depth", "height"))
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, height / 2))
    obj = bpy.context.object
    obj.name = "GPT response fixture, one mesh"
    obj.dimensions = (width, depth, height)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # Constant, unlinked PBR inputs must survive the production GLB exporter.
    rgb = (160, 90, 40)
    color = tuple(((value / 255.0 + 0.055) / 1.055) ** 2.4 for value in rgb)
    material = bpy.data.materials.new("GPT constant PBR fixture")
    material.use_nodes = True
    material.diffuse_color = (*color, 1.0)
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Roughness"].default_value = 0.786
    shader.inputs["Metallic"].default_value = 0.006
    obj.data.materials.append(material)
'''


def response_body(source=SOURCE, status="completed", reason=None, refusal=False):
    content = [{"type": "refusal", "refusal": "fixture refusal"}] if refusal else [
        {"type": "output_text", "text": source, "annotations": []}]
    return {"id": "resp_fixture", "object": "response", "created_at": 1,
        "model": "gpt-6-astra", "status": status, "error": None,
        "incomplete_details": {"reason": reason} if reason else None,
        "output": [{"type": "reasoning", "id": "rs_fixture", "summary": []},
            {"type": "message", "id": "msg_fixture", "role": "assistant", "status": status, "content": content}],
        "usage": {"input_tokens": 100, "output_tokens": 400, "total_tokens": 500,
            "input_tokens_details": {"cached_tokens": 0}, "output_tokens_details": {"reasoning_tokens": 250}}}


class GPTProviderTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        self.enterContext(patch.dict(os.environ, {"OPENAI_API_KEY": KEY,
            "PIPELINE_GPT_MODEL": "gpt-6-astra", "PIPELINE_GPT_REASONING_EFFORT": "xhigh",
            "PIPELINE_GPT_MAX_OUTPUT_TOKENS": "32768", "PIPELINE_GPT_TIMEOUT": "900"}))

    def handoff(self, directory):
        directory = Path(directory)
        original = directory / "upload.png"
        original.write_bytes(image_bytes())
        reference = directory / "reference.png"
        Image.new("RGB", (8, 6), (160, 90, 40)).save(reference)
        foreground = directory / "foreground.png"
        Image.new("RGBA", (8, 6), (160, 90, 40, 255)).save(foreground)
        return {"image_path": str(original), "reference_image_path": str(reference),
            "dimensions_m": DIMENSIONS, "prompt": "SuperMat material fixture: roughness=0.6.",
            "objects": [{"object_index": 0, "label": "chair", "dimensions_m": DIMENSIONS,
                "material": {"image_path": str(foreground)}}]}

    @contextlib.contextmanager
    def transport(self, body=None, status=200, failure=None):
        requests, constructor = [], []
        def handle(request):
            requests.append(request)
            if failure:
                raise failure(request)
            return httpx.Response(status, json=body if body is not None else response_body(),
                headers={"x-request-id": "req_fixture"})
        def client(**kwargs):
            constructor.append(kwargs)
            return SDKClient(**kwargs, http_client=httpx.Client(transport=httpx.MockTransport(handle)))
        with patch.object(gpt_provider, "OpenAI", side_effect=client):
            yield requests, constructor

    def test_real_sdk_sends_astra_xhigh_photo_foreground_dimensions_and_material_prompt(self):
        with tempfile.TemporaryDirectory() as directory:
            handoff = self.handoff(directory)
            with self.transport() as (requests, constructor):
                self.assertEqual(gpt_provider.generate(handoff), SOURCE)
            self.assertEqual(len(requests), 1)
            self.assertEqual(str(requests[0].url), "https://api.openai.com/v1/responses")
            self.assertEqual(requests[0].method, "POST")
            self.assertEqual(requests[0].headers["authorization"], f"Bearer {KEY}")
            body = json.loads(requests[0].content)
            self.assertEqual(body["model"], "gpt-6-astra")
            self.assertEqual(body["reasoning"], {"effort": "xhigh"})
            self.assertEqual(body["max_output_tokens"], 32768)
            self.assertFalse(body["store"])
            self.assertNotIn("temperature", body)
            self.assertNotIn("top_p", body)
            self.assertIn(gpt_provider.GLB_MATERIAL_CONTRACT, body["instructions"])
            self.assertEqual(constructor[0]["timeout"], 900)
            self.assertEqual(constructor[0]["max_retries"], 0)
            content = body["input"][0]["content"]
            texts = "\n".join(part["text"] for part in content if part["type"] == "input_text")
            self.assertIn(handoff["prompt"], texts)
            self.assertIn('"width": 0.8', texts)
            self.assertIn("create_model(dimensions)", texts)
            self.assertIn(gpt_provider.GLB_MATERIAL_CONTRACT, texts)
            images = [part for part in content if part["type"] == "input_image"]
            self.assertEqual(len(images), 2)
            for part, file in zip(images, (handoff["reference_image_path"], handoff["objects"][0]["material"]["image_path"])):
                self.assertEqual(part["detail"], "high")
                header, encoded = part["image_url"].split(",", 1)
                self.assertEqual(header, "data:image/png;base64")
                self.assertEqual(base64.b64decode(encoded), Path(file).read_bytes())
            report = json.loads((Path(directory) / "gpt_response.json").read_text())
            self.assertEqual(report["response_id"], "resp_fixture")
            self.assertEqual(report["request_id"], "req_fixture")
            self.assertEqual(report["usage"]["output_tokens_details"]["reasoning_tokens"], 250)
            self.assertNotIn(KEY, json.dumps(report))
            self.assertEqual((Path(directory) / "gpt_output.py").read_text(), SOURCE)

    def test_single_markdown_fence_is_extracted_through_existing_provider_interface(self):
        with tempfile.TemporaryDirectory() as directory, self.transport(response_body(f"```python\n{SOURCE}```")), \
                patch.dict(os.environ, {"PIPELINE_CODE_PROVIDER": PROVIDER}):
            self.assertEqual(provide_blender_code(self.handoff(directory)), SOURCE)

    def test_missing_key_and_bad_inputs_never_send_a_request(self):
        with tempfile.TemporaryDirectory() as directory:
            handoff = self.handoff(directory)
            for update, environment in (({}, {"OPENAI_API_KEY": ""}),
                ({"prompt": ""}, {}), ({"dimensions_m": DIMENSIONS | {"height": float("nan")}}, {}),
                ({"reference_image_path": str(Path(directory) / "missing.png")}, {})):
                with self.subTest(update=update, environment=environment), patch.dict(os.environ, environment), \
                        patch.object(gpt_provider, "OpenAI") as client:
                    with self.assertRaises((RuntimeError, ValueError, OSError)):
                        gpt_provider.generate(handoff | update)
                    client.assert_not_called()

    def test_incomplete_refused_empty_and_invalid_code_are_saved_but_never_executed(self):
        cases = [response_body(status="incomplete", reason="max_output_tokens"),
                 response_body(refusal=True), response_body(source=""),
                 response_body(source="def create_model():\n    pass\n"),
                 response_body(source="Here is the code:\n" + SOURCE)]
        for body in cases:
            with self.subTest(body=body), tempfile.TemporaryDirectory() as directory, self.transport(body) as (requests, _):
                with self.assertRaises((RuntimeError, ValueError)):
                    gpt_provider.generate(self.handoff(directory))
                self.assertEqual(len(requests), 1)
                self.assertTrue((Path(directory) / "gpt_response.json").is_file())
                self.assertFalse((Path(directory) / "gpt_output.py").exists())

    def test_api_errors_are_sanitized_and_never_automatically_retried(self):
        for status in (400, 401, 403, 404, 429, 500):
            body = {"error": {"message": f"credential fragment {KEY}", "type": "fixture_error", "code": "fixture"}}
            with self.subTest(status=status), tempfile.TemporaryDirectory() as directory, \
                    self.transport(body, status=status) as (requests, _):
                with self.assertRaises(RuntimeError) as caught:
                    gpt_provider.generate(self.handoff(directory))
                self.assertEqual(len(requests), 1)
                self.assertNotIn(KEY, "".join(traceback.format_exception(caught.exception)))
                self.assertFalse((Path(directory) / "gpt_output.py").exists())

    def test_connection_failure_and_timeout_are_sanitized_without_retries(self):
        for error in (httpx.ConnectError, httpx.ReadTimeout):
            with self.subTest(error=error), tempfile.TemporaryDirectory() as directory, \
                    self.transport(failure=lambda request: error(KEY, request=request)) as (requests, _):
                with self.assertRaises(RuntimeError) as caught:
                    gpt_provider.generate(self.handoff(directory))
                self.assertEqual(len(requests), 1)
                self.assertNotIn(KEY, "".join(traceback.format_exception(caught.exception)))

    def test_options_preserve_explicit_model_and_validate_limits(self):
        with patch.dict(os.environ, {"PIPELINE_GPT_MODEL": "explicit-model-id", "PIPELINE_GPT_REASONING_EFFORT": "high"}):
            self.assertEqual(gpt_provider.GPTOptions.from_env().model, "explicit-model-id")
            self.assertEqual(gpt_provider.GPTOptions.from_env().reasoning_effort, "high")
        for update in ({"PIPELINE_GPT_REASONING_EFFORT": "extra high"}, {"PIPELINE_GPT_MODEL": " "},
            {"PIPELINE_GPT_MAX_OUTPUT_TOKENS": "0"}, {"PIPELINE_GPT_MAX_OUTPUT_TOKENS": "128001"},
            {"PIPELINE_GPT_TIMEOUT": "nan"}, {"PIPELINE_GPT_TIMEOUT": "0"}):
            with self.subTest(update=update), patch.dict(os.environ, update), self.assertRaises(ValueError):
                gpt_provider.GPTOptions.from_env()

    def test_api_failure_preserves_measurement_and_releases_job_slot_without_stub(self):
        with tempfile.TemporaryDirectory() as temporary:
            def runner(settings, image, directory, progress):
                handoff = self.handoff(directory)
                return {"outcome": "measured", "objects": [RECORD], "fixture": handoff}
            def material(settings, image, directory, record, index, dimensions, measurement, progress):
                handoff = measurement["fixture"]
                return {"image_path": handoff["objects"][0]["material"]["image_path"],
                    "reference_image_path": handoff["reference_image_path"], "prompt": handoff["prompt"]}
            settings = replace(settings_for(temporary), generate_3d=True)
            with patch.dict(os.environ, {"PIPELINE_CODE_PROVIDER": PROVIDER}), \
                    patch("services.furniture_pipeline.pipeline.build_assets.prepare_material_prompt", side_effect=material), \
                    patch("services.furniture_pipeline.pipeline.build_assets.run_worker") as blender, \
                    self.transport({"error": {"message": KEY}}, status=401) as (requests, _), \
                    TestClient(create_app(settings, runner)) as client, self.assertLogs("uvicorn.error", level="ERROR") as logs:
                for _ in range(2):
                    accepted = client.post("/api/furniture/measure", files={"image": ("chair.png", image_bytes(), "image/png")}).json()
                    job = client.get(accepted["status_url"]).json()
                    self.assertEqual(job["status"], "completed")
                    self.assertEqual(job["result"]["objects"][0]["width_m"], .8)
                    self.assertEqual(job["result"]["generation"]["status"], "failed")
                    self.assertEqual(job["result"]["generation"]["provider"], PROVIDER)
                    self.assertEqual(job["result"]["generation"]["assets"], [])
                    self.assertFalse(client.get("/health").json()["busy"])
                self.assertEqual(len(requests), 2)
                blender.assert_not_called()
            self.assertNotIn(KEY, "\n".join(logs.output))

    def test_upload_material_prompt_mock_gpt_and_real_blender_publish_the_returned_model(self):
        executable = os.getenv("BLENDER_TEST_EXECUTABLE") or shutil.which("blender") or "/Applications/Blender.app/Contents/MacOS/Blender"
        if not Path(executable).is_file():
            self.skipTest("Install Blender to run the real GPT-output export integration test")
        with tempfile.TemporaryDirectory() as temporary:
            checkpoint = Path(temporary) / "fixture.pth"
            checkpoint.write_bytes(b"synthetic inference fixture, never loaded")
            settings = replace(settings_for(temporary), generate_3d=True,
                blender_executable=Path(executable), supermat_python=Path(sys.executable), supermat_checkpoint=checkpoint)
            def runner(settings, image, directory, progress):
                canonical, mask = material_fixture(directory)
                return {"outcome": "measured", "objects": [RECORD | {"mask_path": str(mask)}],
                    "artifacts": {"input": str(canonical)}}
            with patch.dict(os.environ, {"PIPELINE_CODE_PROVIDER": PROVIDER}), \
                    patch("services.furniture_pipeline.pipeline.material_prompt.run_worker", side_effect=material_worker), \
                    self.transport() as (requests, _), TestClient(create_app(settings, runner)) as client:
                accepted = client.post("/api/furniture/measure", files={"image": ("chair.png", image_bytes(), "image/png")}).json()
                job = client.get(accepted["status_url"]).json()
                generation = job["result"]["generation"]
                self.assertEqual(generation["status"], "completed", generation)
                self.assertEqual(len(requests), 1)
                asset, = generation["assets"]
                self.assertEqual(asset["generation_provider"], PROVIDER)
                self.assertEqual(asset["export"]["mesh_count"], 1)  # Stub table has five.
                self.assertEqual(asset["dimensions_m"], DIMENSIONS)
                glb = client.get(asset["model_uri"]).content
                self.assertEqual(glb[:4], b"glTF")
                document = json.loads(glb[20:20 + struct.unpack_from("<I", glb, 12)[0]])
                material = document["materials"][0]["pbrMetallicRoughness"]
                expected_color = [((value / 255.0 + .055) / 1.055) ** 2.4 for value in (160, 90, 40)]
                for actual, expected in zip(material["baseColorFactor"], [*expected_color, 1]):
                    self.assertAlmostEqual(actual, expected, places=5)
                self.assertAlmostEqual(material["roughnessFactor"], .786, places=5)
                self.assertAlmostEqual(material["metallicFactor"], .006, places=5)
                self.assertEqual(client.get(asset["manifest_uri"]).json(), asset)
                directory = Path(temporary) / accepted["job_id"]
                self.assertEqual((directory / "assets/000/generated_model.py").read_text(), SOURCE)
                self.assertEqual((directory / "gpt_output.py").read_text(), SOURCE)
                self.assertTrue((directory / "gpt_input.json").is_file())


if __name__ == "__main__":
    unittest.main()
