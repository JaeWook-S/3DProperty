"""Single-GPU upload API. One active measurement; no database or queue."""
import asyncio
from contextlib import asynccontextmanager
import io
import json
import logging
from pathlib import Path
import re
import shutil
import threading
import uuid

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError
from starlette.responses import JSONResponse

from services.furniture_pipeline.config import MAX_UPLOAD_BYTES, Settings
from services.furniture_pipeline.pipeline.run_measurement import run_measurement, stop_active_workers

LOG = logging.getLogger("uvicorn.error")
FORMATS = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}


def inspect_image(data):
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format not in FORMATS:
                raise HTTPException(415, "JPG, PNG, WebP 이미지만 사용할 수 있습니다.")
            if image.width * image.height > 24_000_000:
                raise HTTPException(413, "이미지 해상도는 2400만 픽셀 이하로 선택해 주세요.")
            info = {"format": image.format, "size_wh": list(image.size)}
            image.verify()
        # verify() checks structure; load() additionally verifies the pixels.
        with Image.open(io.BytesIO(data)) as image:
            image.load()
        return info
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as error:
        raise HTTPException(415, "이미지 내용을 읽지 못했습니다.") from error


def write_job(directory, payload):
    temporary = directory / "job.json.tmp"
    temporary.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    temporary.replace(directory / "job.json")


def create_app(settings=None, runner=None):
    settings = settings or Settings.from_env()
    runner = runner or run_measurement
    @asynccontextmanager
    async def lifespan(app):
        yield
        stop_active_workers()

    app = FastAPI(title="3DProperty furniture measurement", version="0.1.0", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins), allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
    busy = threading.Lock()
    active = {"job_id": None}

    @app.middleware("http")
    async def limit_body(request, call_next):
        if request.method == "POST":
            try:
                length = int(request.headers.get("content-length", "0"))
            except ValueError:
                return JSONResponse({"detail": "Invalid Content-Length"}, status_code=400)
            if length > MAX_UPLOAD_BYTES + 65536:
                return JSONResponse({"detail": "이미지는 20MB 이하로 선택해 주세요."}, status_code=413)
        return await call_next(request)

    @app.get("/health")
    def health():
        missing = settings.missing_environments()
        return {"status": "ok", "ready": not missing, "busy": busy.locked(), "missing_environments": missing}

    def execute(job, directory, image):
        def progress(stage):
            job.update(status="running", stage=stage)
            write_job(directory, job)
            LOG.info("[measurement %s] stage=%s", job["job_id"], stage)
        try:
            result = runner(settings, image, directory, progress=progress)
            job.update(status="completed", stage="completed", result=result)
        except Exception as error:
            LOG.exception("[measurement %s] failed", job["job_id"])
            job.update(status="failed", stage="failed", error=str(error))
        finally:
            try:
                write_job(directory, job)
            finally:
                active["job_id"] = None
                busy.release()

    @app.post("/api/furniture/measure", status_code=202)
    async def upload(background_tasks: BackgroundTasks, image: UploadFile = File(...)):
        directory = None
        retained = False
        try:
            if not busy.acquire(blocking=False):
                raise HTTPException(409, "다른 이미지를 측정하고 있습니다. 완료 후 다시 선택해 주세요.")
            retained = True
            if missing := settings.missing_environments():
                raise HTTPException(503, "서버 모델 환경 설치가 필요합니다: " + ", ".join(missing))
            data = bytearray()
            while chunk := await image.read(1024 * 1024):
                data.extend(chunk)
                if len(data) > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "이미지는 20MB 이하로 선택해 주세요.")
            if not data:
                raise HTTPException(400, "빈 이미지 파일입니다.")
            info = await asyncio.to_thread(inspect_image, data)
            job_id = uuid.uuid4().hex
            directory = settings.runtime_dir / job_id
            directory.mkdir(parents=True, exist_ok=False)
            # Never use a client-supplied name as a filesystem path.
            target = directory / ("upload" + FORMATS[info["format"]])
            target.write_bytes(data)
            job = {"job_id": job_id, "status": "accepted", "stage": "uploaded", "input": {
                "filename": Path((image.filename or "image").replace("\\", "/")).name,
                "mime_type": image.content_type, "bytes": len(data), **info,
            }}
            write_job(directory, job)
            active["job_id"] = job_id
            LOG.info("[upload %s] %s", job_id, json.dumps(job["input"], ensure_ascii=False))
            background_tasks.add_task(execute, job, directory, target)
            retained = False  # Background task now owns the GPU slot.
            return {**job, "status_url": f"/api/furniture/jobs/{job_id}"}
        except Exception:
            if directory is not None:
                shutil.rmtree(directory)
            raise
        finally:
            await image.close()
            if retained:
                busy.release()

    @app.get("/api/furniture/jobs/{job_id}")
    def job_status(job_id: str):
        if not re.fullmatch(r"[a-f0-9]{32}", job_id):
            raise HTTPException(404, "작업을 찾을 수 없습니다.")
        path = settings.runtime_dir / job_id / "job.json"
        if not path.is_file():
            raise HTTPException(404, "작업을 찾을 수 없습니다.")
        job = json.loads(path.read_text(encoding="utf-8"))
        # Saved results remain readable after restart. Unfinished work cannot resume.
        if job["status"] in {"accepted", "running"} and active["job_id"] != job_id:
            job.update(status="failed", stage="failed", error="서버 실행이 중단됐습니다. 이미지를 다시 선택해 주세요.")
        return job

    return app


app = create_app()
