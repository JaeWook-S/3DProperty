"""SAM3 foreground → isolated SuperMat inference → dimensioned Blender prompt.

The API environment needs only Pillow. Model inference and NumPy-based map
statistics run in the dedicated SuperMat environment, after MoGe has exited.
"""
import json
from pathlib import Path

from PIL import Image

from services.furniture_pipeline.config import PROJECT_ROOT, SERVICE_ROOT
from services.furniture_pipeline.pipeline.run_measurement import run_worker


def prepare_material_prompt(settings, image_path, run_dir, record, index, dimensions,
                            measurement, progress=lambda stage: None):
    run_dir = Path(run_dir).resolve()
    if not settings.supermat_python.is_file():
        raise RuntimeError("SuperMat 환경이 없습니다. GPU 서버에서 bash services/furniture_pipeline/scripts/setup_supermat.sh를 실행하세요.")
    if not settings.supermat_checkpoint.is_file():
        raise RuntimeError(f"SuperMat 체크포인트가 없습니다: {settings.supermat_checkpoint}")

    # SAM3 masks belong to the EXIF-normalized, resized measurement frame.
    # Saved-measurement exports can refer to the original job's canonical image.
    mask_path = Path(record.get("mask_path") or run_dir / f"mask_{index:03d}.png")
    candidates = [run_dir / "input_rgb.png"]
    canonical = measurement.get("artifacts", {}).get("input")
    if canonical:
        candidates.append(Path(canonical))
    candidates.append(mask_path.parent / "input_rgb.png")
    canonical = next((path for path in candidates if path.is_file()), None)
    if canonical is None or not mask_path.is_file():
        raise RuntimeError("SuperMat에 필요한 input_rgb.png와 SAM3 mask_###.png가 없습니다. 이미지를 다시 측정하세요.")

    directory = run_dir / "supermat" / f"{index:03d}"
    directory.mkdir(parents=True, exist_ok=False)
    reference, foreground, mask_file = (directory / name for name in ("reference.png", "foreground.png", "mask.png"))
    with Image.open(canonical) as source, Image.open(mask_path) as supplied_mask:
        rgb = source.convert("RGB")
        mask = supplied_mask.convert("L").point(lambda value: 255 if value > 127 else 0)
        if mask.size != rgb.size:
            raise ValueError("SAM3 mask and canonical image must have identical dimensions")
        if mask.getbbox() is None:
            raise ValueError("SAM3 foreground mask is empty")
        rgb.save(reference)
        rgba = rgb.convert("RGBA")
        rgba.putalpha(mask)
        rgba.save(foreground)
        mask.save(mask_file)

    progress("supermat")
    output_root = directory / "maps"
    run_worker([str(settings.supermat_python), str(PROJECT_ROOT / "SuperMat/inference_supermat.py"),
                "--input", str(foreground), "--output-dir", str(output_root),
                "--checkpoint", str(settings.supermat_checkpoint),
                "--base-model", settings.supermat_base_model, "--device", settings.supermat_device,
                "--image-size", str(settings.supermat_image_size), "--seed", "0"], settings)
    maps_dir = output_root / foreground.stem
    maps = {name: str(maps_dir / f"{name}.png") for name in ("albedo", "roughness", "metallic")}
    if not all(Path(path).is_file() for path in maps.values()):
        raise RuntimeError("SuperMat did not save albedo.png, roughness.png and metallic.png")

    progress("material_prompt")
    prompt_path, summary_path = directory / "prompt.txt", directory / "material_summary.json"
    run_worker([str(settings.supermat_python), str(SERVICE_ROOT / "pipeline/supermat_prompt.py"),
                "--maps", str(maps_dir), "--image", str(foreground),
                "--width-m", str(dimensions["width"]), "--depth-m", str(dimensions["depth"]),
                "--height-m", str(dimensions["height"]),
                "--out", str(prompt_path), "--summary-out", str(summary_path)], settings)
    prompt = prompt_path.read_text(encoding="utf-8")
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    if not prompt.strip() or not summary.get("regions"):
        raise ValueError("SuperMat prompt or material summary is empty")
    print(f"[SuperMat {run_dir.name}] object={index} dimensions_m={json.dumps(dimensions)} prompt={prompt_path}", flush=True)
    return {"image_path": str(foreground), "reference_image_path": str(reference),
            "mask_path": str(mask_file), "maps": maps,
            "summary_path": str(summary_path), "prompt_path": str(prompt_path), "prompt": prompt}
