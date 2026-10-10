"""Repository-relative settings shared by the API, CLI and doctor."""
from dataclasses import dataclass
import json
import math
import os
import shutil
from pathlib import Path

from dotenv import load_dotenv

SERVICE_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = SERVICE_ROOT.parents[1]
MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def project_path(value):
    path = Path(value).expanduser()
    # Preserve bin/python symlinks: resolving a venv Python would escape its venv.
    return Path(os.path.abspath(path if path.is_absolute() else PROJECT_ROOT / path))


def load_options(path):
    defaults = json.loads((SERVICE_ROOT / "settings.json").read_text(encoding="utf-8"))
    supplied = json.loads(Path(path).read_text(encoding="utf-8"))
    if unknown := supplied.keys() - defaults.keys():
        raise ValueError(f"Unknown measurement settings: {sorted(unknown)}")
    options = defaults | supplied
    prompts = options["prompts"]
    if not isinstance(prompts, list) or not prompts or any(not isinstance(p, str) or not p.strip() for p in prompts):
        raise ValueError("prompts must be a non-empty list of furniture names")
    ranges = {
        "sam_score_threshold": (0, 1), "mask_nms_iou": (0.000001, 1),
        "moge_resolution_level": (0, 9), "moge_refine_steps": (0, 20),
        "max_image_side": (32, 4096), "trim_percent": (0, 24.999),
        "ground_lower_image_fraction": (0, 1), "ground_ransac_iterations": (1, 10000),
        "erode_pixels": (0, 20), "min_mask_pixels": (1, 10000000), "min_points": (4, 10000000),
    }
    integers = {"moge_resolution_level", "moge_refine_steps", "max_image_side", "ground_ransac_iterations", "erode_pixels", "min_mask_pixels", "min_points"}
    for key, (low, high) in ranges.items():
        value = options[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f"{key} must be in [{low}, {high}]")
        if key in integers and not isinstance(value, int):
            raise ValueError(f"{key} must be an integer")
    for key in ("scale_multiplier", "ground_distance_ratio", "knn_outlier_std"):
        value = options[key]
        if value is None and key == "knn_outlier_std":
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
            raise ValueError(f"{key} must be positive")
    for key in ("up_vector_camera", "width_direction_camera"):
        value = options[key]
        if value is None and key == "width_direction_camera":
            continue
        if not isinstance(value, list) or len(value) != 3 or any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in value) or sum(v * v for v in value) < 1e-16:
            raise ValueError(f"{key} must be a nonzero finite 3D vector")
    for key in ("auto_estimate_up_from_ground", "swap_width_depth", "moge_use_fp16"):
        if not isinstance(options[key], bool):
            raise ValueError(f"{key} must be boolean")
    fov = options["fov_x_degrees"]
    if fov is not None and (not isinstance(fov, (int, float)) or not math.isfinite(fov) or not 0 < fov < 180):
        raise ValueError("fov_x_degrees must be between 0 and 180")
    return options


@dataclass(frozen=True)
class Settings:
    runtime_dir: Path
    hf_home: Path
    sam3_python: Path
    moge3_python: Path
    settings_file: Path
    sam3_checkpoint: str = ""
    moge_checkpoint: str = "Ruicheng/moge-3-vitl"
    worker_timeout: int = 1800
    cors_origins: tuple = ("http://localhost:5173", "http://127.0.0.1:5173")
    generate_3d: bool = True
    blender_executable: Path = PROJECT_ROOT / ".tooling/blender/blender"
    blender_timeout: int = 120

    @classmethod
    def from_env(cls):
        load_dotenv(SERVICE_ROOT / ".env", override=False)
        checkpoint = os.getenv("PIPELINE_SAM3_CHECKPOINT", "").strip()
        moge = os.getenv("PIPELINE_MOGE_CHECKPOINT", "Ruicheng/moge-3-vitl")
        if moge.endswith(".pt"):
            moge = str(project_path(moge))
        settings = cls(
            runtime_dir=project_path(os.getenv("PIPELINE_RUNTIME_DIR", "runtime/furniture")),
            hf_home=project_path(os.getenv("PIPELINE_HF_HOME", "runtime/model-cache")),
            sam3_python=project_path(os.getenv("PIPELINE_SAM3_PYTHON", ".envs/furniture-sam3/bin/python")),
            moge3_python=project_path(os.getenv("PIPELINE_MOGE3_PYTHON", ".envs/furniture-moge3/bin/python")),
            settings_file=project_path(os.getenv("PIPELINE_SETTINGS_FILE", "services/furniture_pipeline/settings.json")),
            sam3_checkpoint=str(project_path(checkpoint)) if checkpoint else "",
            moge_checkpoint=moge,
            worker_timeout=int(os.getenv("PIPELINE_WORKER_TIMEOUT", "1800")),
            cors_origins=tuple(v.strip() for v in os.getenv("PIPELINE_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if v.strip()),
            generate_3d=os.getenv("PIPELINE_GENERATE_3D", "true").lower() not in {"false", "0", "no"},
            blender_executable=project_path(os.getenv("PIPELINE_BLENDER_EXECUTABLE") or shutil.which("blender") or
                ("/Applications/Blender.app/Contents/MacOS/Blender" if Path("/Applications/Blender.app/Contents/MacOS/Blender").is_file() else ".tooling/blender/blender")),
            blender_timeout=int(os.getenv("PIPELINE_BLENDER_TIMEOUT", "120")),
        )
        if settings.worker_timeout <= 0:
            raise ValueError("PIPELINE_WORKER_TIMEOUT must be positive")
        if settings.blender_timeout <= 0:
            raise ValueError("PIPELINE_BLENDER_TIMEOUT must be positive")
        load_options(settings.settings_file)
        return settings

    def worker_environment(self):
        return os.environ | {"HF_HOME": str(self.hf_home), "PYTHONUNBUFFERED": "1", "MPLBACKEND": "Agg"}

    def missing_environments(self):
        return [str(p) for p in (self.sam3_python, self.moge3_python) if not p.is_file()]
