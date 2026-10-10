"""Run SAM3 then MoGe-3 in separate processes, without notebook dependencies."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import threading
import uuid

from PIL import Image, ImageOps

from services.furniture_pipeline.config import SERVICE_ROOT, Settings, load_options


class WorkerError(RuntimeError):
    pass


_ACTIVE_PROCESSES = set()
_PROCESS_LOCK = threading.Lock()


def stop_active_workers():
    with _PROCESS_LOCK:
        for process in tuple(_ACTIVE_PROCESSES):
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass


def run_worker(command, settings, timeout=None):
    # Each worker owns a process group so a timeout also stops child processes.
    with subprocess.Popen(command, env=settings.worker_environment(), start_new_session=True) as process:
        with _PROCESS_LOCK:
            _ACTIVE_PROCESSES.add(process)
        try:
            code = process.wait(timeout=timeout or settings.worker_timeout)
        except (subprocess.TimeoutExpired, KeyboardInterrupt):
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            raise WorkerError(f"Worker timed out or interrupted after {timeout or settings.worker_timeout}s")
        finally:
            with _PROCESS_LOCK:
                _ACTIVE_PROCESSES.discard(process)
        if code:
            raise WorkerError(f"Worker exited with code {code}; see server terminal traceback.")


def run_measurement(settings, image_path, run_dir, progress=lambda stage: None):
    started = time.monotonic()
    image_path, run_dir = Path(image_path).resolve(), Path(run_dir).resolve()
    missing = settings.missing_environments()
    if missing:
        raise WorkerError("Model environments are missing. Run setup_gpu_envs.sh: " + ", ".join(missing))
    options = load_options(settings.settings_file)
    run_dir.mkdir(parents=True, exist_ok=True)
    config_path = run_dir / "settings.json"
    config_path.write_text(json.dumps(options, allow_nan=False, indent=2), encoding="utf-8")
    progress("preprocessing")
    with Image.open(image_path) as original:
        image = ImageOps.exif_transpose(original).convert("RGB")
    original_size = image.size
    image.thumbnail((options["max_image_side"], options["max_image_side"]), Image.Resampling.LANCZOS)
    canonical = run_dir / "input_rgb.png"
    image.save(canonical)
    (run_dir / "input.json").write_text(json.dumps({
        "image": str(image_path), "original_size_wh": list(original_size),
        "inference_size_wh": list(image.size), "sam3_checkpoint": settings.sam3_checkpoint or "facebook/sam3",
    }), encoding="utf-8")
    masks = run_dir / "sam3_masks.npz"
    print(f"[measurement {run_dir.name}] input={image.size} saved={canonical}", flush=True)
    progress("sam3")
    command = [str(settings.sam3_python), str(SERVICE_ROOT / "pipeline/sam3_infer.py"),
               "--image", str(canonical), "--output", str(masks), "--settings", str(config_path),
               "--prompts-json", json.dumps(options["prompts"]), "--threshold", str(options["sam_score_threshold"])]
    if settings.sam3_checkpoint:
        command += ["--checkpoint", settings.sam3_checkpoint]
    run_worker(command, settings)
    if not masks.is_file():
        raise WorkerError("SAM3 did not save sam3_masks.npz")
    progress("moge3_postprocessing")
    run_worker([str(settings.moge3_python), str(SERVICE_ROOT / "pipeline/moge3_infer.py"),
                "--image", str(canonical), "--masks", str(masks), "--output", str(run_dir),
                "--settings", str(config_path), "--checkpoint", settings.moge_checkpoint], settings)
    measurement_file = run_dir / "measurements.json"
    result = json.loads(measurement_file.read_text(encoding="utf-8"))
    records = result["objects"]
    measured = [record for record in records if record["status"] == "ok"]
    result.update(
        outcome="measured" if measured else "insufficient_geometry" if records else "no_detection",
        elapsed_seconds=round(time.monotonic() - started, 2),
        artifacts={"directory": str(run_dir), "input": str(canonical), "masks": str(masks),
                   "measurements": str(measurement_file), "csv": str(run_dir / "measurements.csv"),
                   "dimensions": str(run_dir / "dimensions_dhw_m.npy"), "overlay": str(run_dir / "measurement_overlay.png")},
    )
    (run_dir / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    print(f"\n[measurement {run_dir.name}] OUTPUT (meters)", flush=True)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False), flush=True)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--output", help="A new output directory (must not already exist)")
    args = parser.parse_args()
    settings = Settings.from_env()
    directory = Path(args.output).expanduser().resolve() if args.output else settings.runtime_dir / uuid.uuid4().hex
    directory.mkdir(parents=True, exist_ok=False)
    run_measurement(settings, args.image, directory, progress=lambda stage: print(f"[stage] {stage}", flush=True))


if __name__ == "__main__":
    main()
