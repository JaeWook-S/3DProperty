import subprocess

from services.furniture_pipeline.config import Settings

settings = Settings.from_env()
subprocess.run([str(settings.sam3_python), "-c", "from huggingface_hub import login; login(add_to_git_credential=False)"], env=settings.worker_environment(), check=True)
