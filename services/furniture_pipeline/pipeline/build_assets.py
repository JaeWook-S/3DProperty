"""Measured dimensions → stub GPT handoff → trusted Blender table → GLB/asset.json."""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import struct
import time

from services.furniture_pipeline.config import SERVICE_ROOT
from services.furniture_pipeline.pipeline.code_provider import provide_blender_code
from services.furniture_pipeline.pipeline.run_measurement import run_worker

ASSET_ID = re.compile(r"([a-f0-9]{32})-([0-9]{3})")
MAX_ASSETS = 16
MAX_GLB_BYTES = 10 * 1024 * 1024


def dimensions_for(record):
    values = {axis: record.get(f"{axis}_m") for axis in ("width", "depth", "height")}
    return values if record.get("status") == "ok" and all(
        type(v) in (int, float) and math.isfinite(v) and 0 < v <= 50 for v in values.values()) else None


def validate_glb(path):
    data = Path(path).read_bytes()
    if len(data) < 28 or len(data) > MAX_GLB_BYTES:
        raise ValueError("GLB is empty or too large")
    magic, version, length = struct.unpack_from("<4sII", data)
    if magic != b"glTF" or version != 2 or length != len(data):
        raise ValueError("Blender did not produce a valid GLB 2.0")
    offset, chunks = 12, []
    while offset < len(data):
        if offset + 8 > len(data):
            raise ValueError("Truncated GLB chunk")
        size, kind = struct.unpack_from("<II", data, offset)
        if size % 4 or offset + 8 + size > len(data):
            raise ValueError("Invalid GLB chunk length")
        chunks.append((kind, data[offset + 8:offset + 8 + size]))
        offset += 8 + size
    if len(chunks) != 2 or chunks[0][0] != 0x4E4F534A or chunks[1][0] != 0x004E4942:
        raise ValueError("GLB must contain JSON and embedded binary data")
    doc = json.loads(chunks[0][1])
    if not doc.get("meshes") or doc.get("asset", {}).get("version") != "2.0":
        raise ValueError("GLB has no meshes")
    if any("uri" in entry for entry in doc.get("buffers", []) + doc.get("images", [])):
        raise ValueError("GLB must embed all buffers and images")
    if len(doc.get("buffers", [])) != 1 or not 0 < doc["buffers"][0].get("byteLength", 0) <= len(chunks[1][1]):
        raise ValueError("GLB binary buffer is invalid")
    return hashlib.sha256(data).hexdigest()


def build_assets(settings, image_path, run_dir, measurement, progress=lambda stage: None):
    run_dir, image_path = Path(run_dir), Path(image_path)
    if not re.fullmatch(r"[a-f0-9]{32}", run_dir.name):
        raise ValueError("Generation requires a measurement job UUID")
    selected = [(index, record, dimensions_for(record)) for index, record in enumerate(measurement.get("objects", []))]
    handoff = {"provider": "stub-no-api", "image_path": str(image_path),
        "image_sha256": hashlib.sha256(image_path.read_bytes()).hexdigest(),
        "objects": [{"object_index": index, "label": record.get("label"), "dimensions_m": dimensions}
                    for index, record, dimensions in selected if dimensions]}
    (run_dir / "gpt_input.json").write_text(json.dumps(handoff, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    progress("gpt_stub")
    source = provide_blender_code(handoff)
    outcome = {"status": "skipped", "provider": "stub-no-api", "template": "demo-table-v1", "assets": [], "errors": [],
        "message": "고정 테스트 테이블입니다. 사진을 재현한 모델이나 GPT 생성 결과가 아닙니다."}
    if not handoff["objects"]:
        outcome["message"] = "정상적인 측정 치수가 없어 모델을 생성하지 않았습니다."
        return outcome
    if not settings.blender_executable.is_file() or not os.access(settings.blender_executable, os.X_OK):
        raise RuntimeError("Blender가 없습니다. bash services/furniture_pipeline/scripts/setup_blender.sh를 실행하세요.")
    deadline = time.monotonic() + settings.blender_timeout
    progress("blender_export")
    for index, record, dimensions in selected:
        if not dimensions:
            continue
        if index >= 1000 or len(outcome["assets"]) + len(outcome["errors"]) >= MAX_ASSETS or time.monotonic() >= deadline:
            outcome["errors"].append({"object_index": index, "error": "모델 생성 개수 또는 전체 실행 시간 제한에 도달했습니다."})
            continue
        asset_id = f"{run_dir.name}-{index:03d}"
        directory = run_dir / "assets" / f"{index:03d}"
        directory.mkdir(parents=True, exist_ok=False)
        script, inputs, model, report = (directory / name for name in ("generated_model.py", "generation_input.json", "model.glb", "export_report.json"))
        script.write_text(source, encoding="utf-8")
        inputs.write_text(json.dumps({"dimensions_m": dimensions}), encoding="utf-8")
        try:
            run_worker([str(settings.blender_executable), "--background", "--factory-startup", "--disable-autoexec", "--python-exit-code", "1",
                "--python", str(SERVICE_ROOT / "pipeline/blender_runner.py"), "--", "--script", str(script),
                "--input", str(inputs), "--output", str(model), "--report", str(report)], settings,
                timeout=max(0.1, deadline - time.monotonic()))
            sha256 = validate_glb(model)
            export = json.loads(report.read_text(encoding="utf-8"))
            asset = {"schema_version": "cortex.furniture.v0", "asset_id": asset_id, "revision": "stub-blender-v1", "units": "m",
                "coordinate_space": "gltf-y-up", "front_axis": "+Z", "pivot": "bottom-center", "dimensions_m": dimensions,
                "dimension_basis": "estimated", "scale_status": "metric-estimated", "confidence": None,
                "geometry_kind": "glb", "model_uri": f"/api/furniture/assets/{asset_id}/model.glb", "model_sha256": sha256,
                "manifest_uri": f"/api/furniture/assets/{asset_id}/asset.json", "object_index": index,
                "title": f"테스트 테이블 · {record.get('label') or '가구'}", "generation_provider": "stub-no-api",
                "provenance": {"sample_id": run_dir.name, "method": "SAM3+MoGe-3 dimensions / fixed Blender test table (GPT not called)",
                    "implementation_revision": "stub-blender-v1", "weights_id": "SAM3 + MoGe-3 (dimensions only)",
                    "scale_reference_used": False, "scale_reference_description": None}, "export": export}
            (directory / "asset.json").write_text(json.dumps(asset, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
            outcome["assets"].append(asset)
            print(f"[asset ready] {asset_id} {asset['model_uri']}", flush=True)
        except Exception as error:
            print(f"[Blender failed] object {index}: {error}", flush=True)
            outcome["errors"].append({"object_index": index, "error": str(error)})
    outcome["status"] = "partial" if outcome["assets"] and outcome["errors"] else "completed" if outcome["assets"] else "failed"
    return outcome
