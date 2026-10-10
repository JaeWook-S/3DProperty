"""Stage-2-only test using a real image and an existing SAM3/MoGe-3 result."""
import argparse
import json
from pathlib import Path
import shutil
import uuid

from services.furniture_pipeline.config import Settings
from services.furniture_pipeline.pipeline.build_assets import build_assets


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--measurements", required=True, help="Existing measurements.json or result.json")
    args = parser.parse_args()
    settings = Settings.from_env()
    image = Path(args.image).expanduser().resolve()
    measurement = json.loads(Path(args.measurements).expanduser().read_text(encoding="utf-8"))
    if not image.is_file() or not isinstance(measurement.get("objects"), list):
        raise SystemExit("실제 이미지 파일과 objects를 담은 측정 결과 JSON이 필요합니다.")
    job_id = uuid.uuid4().hex
    directory = settings.runtime_dir / job_id
    directory.mkdir(parents=True, exist_ok=False)
    stored_image = directory / ("upload" + image.suffix.lower())
    shutil.copyfile(image, stored_image)
    measurement.pop("generation", None)
    measurement["generation"] = build_assets(settings, stored_image, directory, measurement,
        progress=lambda stage: print(f"[stage] {stage}", flush=True))
    (directory / "result.json").write_text(json.dumps(measurement, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    (directory / "job.json").write_text(json.dumps({"job_id": job_id, "status": "completed", "stage": "completed",
        "input": {"filename": image.name}, "result": measurement}, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(f"[stage 2 complete] job={job_id} · {directory}", flush=True)
    for asset in measurement["generation"]["assets"]:
        print(f"3D: http://127.0.0.1:5173/?studio=1&furnitureAsset={asset['asset_id']}", flush=True)
    if measurement["generation"]["status"] not in {"completed", "partial"}:
        raise SystemExit("GLB가 생성되지 않았습니다. 치수·Blender 로그를 확인하세요.")


if __name__ == "__main__":
    main()
