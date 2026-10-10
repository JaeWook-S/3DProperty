import concurrent.futures
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest

from fastapi.testclient import TestClient
from PIL import Image

from services.furniture_pipeline.api.main import create_app
from services.furniture_pipeline.config import MAX_UPLOAD_BYTES
from services.furniture_pipeline.tests.test_measurement import settings_for


def image_bytes():
    data = io.BytesIO()
    Image.new("RGB", (64, 48), "white").save(data, format="PNG")
    return data.getvalue()


class ApiTests(unittest.TestCase):
    def test_uploaded_bytes_saved_and_completed_job_remains_available_after_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            data = image_bytes()
            def runner(settings, image, output, progress):
                self.assertEqual(image.read_bytes(), data)
                self.assertEqual(image.name, "upload.png")
                progress("sam3")
                return {"outcome": "measured", "objects": [{"status": "ok", "width_m": 0.8, "depth_m": 0.6, "height_m": 0.75}]}
            settings = settings_for(directory)
            with TestClient(create_app(settings, runner)) as client:
                response = client.post("/api/furniture/measure", files={"image": ("../../chair.png", data, "image/png")})
                self.assertEqual(response.status_code, 202)
                job = response.json()
                self.assertEqual(job["input"]["filename"], "chair.png")
                saved = client.get(job["status_url"]).json()
                self.assertEqual(saved["status"], "completed")
                self.assertEqual(saved["result"]["objects"][0]["width_m"], 0.8)
            with TestClient(create_app(settings, runner)) as restarted:
                self.assertEqual(restarted.get(job["status_url"]).json()["status"], "completed")

    def test_rejects_invalid_empty_oversized_and_unknown_files(self):
        with tempfile.TemporaryDirectory() as directory, TestClient(create_app(settings_for(directory))) as client:
            for payload, expected in ((b"", 400), (b"not really png", 415)):
                response = client.post("/api/furniture/measure", files={"image": ("chair.png", payload, "image/png")})
                self.assertEqual(response.status_code, expected)
            response = client.post("/api/furniture/measure", content=b"too large", headers={"Content-Length": str(MAX_UPLOAD_BYTES + 65537)})
            self.assertEqual(response.status_code, 413)
            self.assertEqual(client.get("/api/furniture/jobs/not-an-id").status_code, 404)
            self.assertEqual(client.get("/api/furniture/jobs/" + "a" * 32).status_code, 404)
            self.assertFalse(client.get("/health").json()["busy"])

    def test_worker_failure_frees_gpu_slot_for_next_image(self):
        with tempfile.TemporaryDirectory() as directory:
            def fail(*args, **kwargs):
                raise RuntimeError("CUDA test failure")
            with TestClient(create_app(settings_for(directory), fail)) as client, self.assertLogs("uvicorn.error", level="ERROR"):
                for _ in range(2):
                    response = client.post("/api/furniture/measure", files={"image": ("chair.png", image_bytes(), "image/png")})
                    self.assertEqual(response.status_code, 202)
                    job = client.get(response.json()["status_url"]).json()
                    self.assertEqual(job["status"], "failed")
                    self.assertIn("CUDA test failure", job["error"])
                    self.assertFalse(client.get("/health").json()["busy"])

    def test_running_measurement_is_visible_and_second_upload_is_rejected(self):
        entered, release = threading.Event(), threading.Event()
        with tempfile.TemporaryDirectory() as directory:
            def wait(settings, image, output, progress):
                progress("sam3")
                entered.set()
                release.wait(5)
                return {"outcome": "no_detection", "objects": []}
            with TestClient(create_app(settings_for(directory), wait)) as client, concurrent.futures.ThreadPoolExecutor() as executor:
                pending = executor.submit(client.post, "/api/furniture/measure", files={"image": ("chair.png", image_bytes(), "image/png")})
                try:
                    self.assertTrue(entered.wait(5))
                    job_id = next(Path(directory).glob("*/job.json")).parent.name
                    self.assertEqual(client.get(f"/api/furniture/jobs/{job_id}").json()["stage"], "sam3")
                    rejected = client.post("/api/furniture/measure", files={"image": ("chair.png", image_bytes(), "image/png")})
                    self.assertEqual(rejected.status_code, 409)
                finally:
                    release.set()
                self.assertEqual(pending.result().status_code, 202)


if __name__ == "__main__":
    unittest.main()
