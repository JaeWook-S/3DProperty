"""No-download GPU/import/auth checks before starting the real API."""
import argparse
import platform
import subprocess

from services.furniture_pipeline.config import Settings


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--print-api-address", action="store_true")
    args = parser.parse_args()
    settings = Settings.from_env()
    if args.print_api_address:
        import os
        print(os.getenv("PIPELINE_API_HOST", "127.0.0.1"))
        print(int(os.getenv("PIPELINE_API_PORT", "8000")))
        return
    if platform.system() != "Linux":
        raise SystemExit("GPU 모델 실행에는 Linux + NVIDIA CUDA 서버가 필요합니다.")
    if missing := settings.missing_environments():
        raise SystemExit("먼저 setup_gpu_envs.sh를 실행하세요: " + ", ".join(missing))
    if settings.sam3_checkpoint:
        from pathlib import Path
        if not Path(settings.sam3_checkpoint).is_file():
            raise SystemExit("SAM3 체크포인트 경로가 없습니다: " + settings.sam3_checkpoint)
    if settings.generate_3d and not settings.blender_executable.is_file():
        print("Blender 미설치: 측정은 가능하지만 GLB 생성은 불가합니다. setup_blender.sh를 실행하세요.")
    for name, executable, module, numpy_major in (
        ("SAM3", settings.sam3_python, "sam3", 1),
        ("MoGe-3", settings.moge3_python, "moge.model.v3", 2),
    ):
        script = f"""
import importlib, sys, numpy, torch
importlib.import_module({module!r})
assert sys.version_info[:2] == (3, 12), 'Use Python 3.12'
assert int(numpy.__version__.split('.')[0]) == {numpy_major}, 'Wrong NumPy environment'
assert torch.cuda.is_available(), 'CUDA GPU unavailable'
assert torch.__version__.split('+')[0] == '2.10.0', 'Expected PyTorch 2.10.0'
assert torch.version.cuda == '12.8', 'Expected cu128 PyTorch runtime'
print({name!r}, 'Python:', sys.version.split()[0], 'NumPy:', numpy.__version__, 'torch:', torch.__version__)
print('GPU:', torch.cuda.get_device_name(0))
"""
        if name == "SAM3" and not settings.sam3_checkpoint:
            script += "\nfrom huggingface_hub import get_token\nassert get_token(), 'Run login_hf.sh after SAM3 model access approval'\n"
        subprocess.run([str(executable), "-c", script], env=settings.worker_environment(), check=True)
    print("Environment checks passed. First inference will download model weights if not cached.")


if __name__ == "__main__":
    main()
