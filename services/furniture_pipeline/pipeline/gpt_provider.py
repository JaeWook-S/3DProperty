"""Photograph + measured dimensions + SuperMat prompt → GPT Blender source.

Selected through the existing code_provider module:function interface. This
adapter owns OpenAI settings and HTTP calls; the measurement, Blender export,
API routes and web application do not need to know about the SDK.
"""
import base64
from dataclasses import dataclass
import io
import json
import math
import os
from pathlib import Path
import re

from openai import (
    APIConnectionError, APIStatusError, APITimeoutError, AuthenticationError,
    NotFoundError, OpenAI, PermissionDeniedError, RateLimitError,
)
from PIL import Image

from services.furniture_pipeline.config import MAX_UPLOAD_BYTES
from services.furniture_pipeline.pipeline.code_provider import validate_blender_code
from services.furniture_pipeline.pipeline.supermat_prompt import blender_contract, validate_dimensions

INSTRUCTIONS = """Create one furniture model from the supplied photographs and material estimates.
Return only executable Blender 4.5 LTS Python source, with exactly one module-level
def create_model(dimensions): function. Follow the pipeline contract in the input.
Model only the selected foreground furniture, using the full photograph as context.
Use the estimated dimensions supplied at runtime; do not replace them with guesses.
Use built-in bpy/mathutils/math and procedural materials; no external assets,
downloads, file I/O, subprocesses, scene clearing, cameras, lights or export calls.
Create geometry only inside create_model; do not call it at module scope.
At the end of create_model, update transforms, calculate the entire furniture's
world-space mesh bounding box, and fit it to the specified width/depth/height with
the bottom-center at the origin. The existing runner checks these exact bounds.
Use material socket names available in Blender 4.5. Assumptions belong in comments.
"""


@dataclass(frozen=True)
class GPTOptions:
    model: str = "gpt-6-astra"
    reasoning_effort: str = "xhigh"
    max_output_tokens: int = 32768
    timeout: float = 900

    @classmethod
    def from_env(cls):
        options = cls(
            model=os.getenv("PIPELINE_GPT_MODEL", "gpt-6-astra").strip(),
            reasoning_effort=os.getenv("PIPELINE_GPT_REASONING_EFFORT", "xhigh").strip(),
            max_output_tokens=int(os.getenv("PIPELINE_GPT_MAX_OUTPUT_TOKENS", "32768")),
            timeout=float(os.getenv("PIPELINE_GPT_TIMEOUT", "900")),
        )
        if not options.model:
            raise ValueError("PIPELINE_GPT_MODEL must not be empty")
        if options.reasoning_effort not in {"low", "medium", "high", "xhigh", "max"}:
            raise ValueError("PIPELINE_GPT_REASONING_EFFORT must be low, medium, high, xhigh or max")
        if not 1 <= options.max_output_tokens <= 128000:
            raise ValueError("PIPELINE_GPT_MAX_OUTPUT_TOKENS must be between 1 and 128000")
        if not math.isfinite(options.timeout) or options.timeout <= 0:
            raise ValueError("PIPELINE_GPT_TIMEOUT must be finite and positive")
        return options


def image_content(path):
    """Send image bytes rather than an inaccessible server-local path."""
    data = Path(path).read_bytes()
    if not 0 < len(data) <= MAX_UPLOAD_BYTES:
        raise ValueError("GPT reference image must be nonempty and at most 20 MB")
    with Image.open(io.BytesIO(data)) as image:
        mime_type = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}.get(image.format)
        if not mime_type:
            raise ValueError("GPT reference images must be PNG, JPEG or WebP")
        image.verify()
    encoded = base64.b64encode(data).decode("ascii")
    return {"type": "input_image", "image_url": f"data:{mime_type};base64,{encoded}", "detail": "high"}


def build_request(handoff, options):
    dimensions = validate_dimensions(handoff["dimensions_m"])
    prompt = handoff.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("The GPT handoff requires a nonempty SuperMat prompt")
    objects = handoff.get("objects", [])
    if len(objects) != 1:
        raise ValueError("The GPT handoff must select exactly one furniture object")
    selected = objects[0]
    reference = Path(handoff["reference_image_path"])
    content = [{"type": "input_text", "text": prompt + "\n" +
        json.dumps({"object_index": selected["object_index"], "label": selected.get("label"),
                    "dimensions_m": dimensions}, ensure_ascii=False, allow_nan=False) +
        "\n" + blender_contract(dimensions)},
        {"type": "input_text", "text": "Image 1: full reference photo in the SAM3/SuperMat coordinate frame."},
        image_content(reference)]
    foreground = selected.get("material", {}).get("image_path")
    if foreground and Path(foreground).resolve() != reference.resolve():
        content.extend([
            {"type": "input_text", "text": "Image 2: SAM3 foreground selection. Model only this furniture."},
            image_content(foreground),
        ])
    return {"model": options.model, "reasoning": {"effort": options.reasoning_effort},
            "instructions": INSTRUCTIONS, "input": [{"role": "user", "content": content}],
            "max_output_tokens": options.max_output_tokens, "store": False}


def extract_source(response):
    if response.status != "completed":
        reason = getattr(response.incomplete_details, "reason", None)
        if reason == "max_output_tokens":
            raise RuntimeError("GPT 출력 토큰 한도에 도달했습니다. PIPELINE_GPT_MAX_OUTPUT_TOKENS를 늘린 뒤 다시 시도하세요.")
        raise RuntimeError(f"GPT 응답이 완료되지 않았습니다 (status={response.status}). gpt_response.json을 확인하세요.")
    if any(part.type == "refusal" for item in response.output if item.type == "message" for part in item.content):
        raise RuntimeError("GPT가 코드 생성을 거절했습니다. gpt_response.json을 확인하세요.")
    source = response.output_text.strip()
    # Accept a single fenced code block, but never turn explanatory prose into code.
    fenced = re.fullmatch(r"```(?:python|py)?[ \t]*\n(.*?)\n```", source, flags=re.DOTALL | re.IGNORECASE)
    if fenced:
        source = fenced[1].strip()
    return validate_blender_code(source) + "\n"


def generate(handoff):
    """Existing provider contract: complete handoff dict in, Blender source out."""
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("서버 services/furniture_pipeline/.env에 OPENAI_API_KEY를 설정하세요.")
    options = GPTOptions.from_env()
    image = Path(handoff["image_path"])
    if not image.is_file():
        raise ValueError("The original uploaded image is missing")
    request = build_request(handoff, options)
    print(f"[GPT request] model={options.model} effort={options.reasoning_effort} max_output_tokens={options.max_output_tokens}", flush=True)
    try:
        # No automatic retries: one generation attempt per job. No stub fallback.
        with OpenAI(api_key=api_key, base_url="https://api.openai.com/v1",
                    timeout=options.timeout, max_retries=0) as client:
            response = client.responses.create(**request)
    except APITimeoutError:
        raise RuntimeError("GPT 요청 시간이 초과됐습니다. PIPELINE_GPT_TIMEOUT과 서버 로그를 확인하세요.") from None
    except AuthenticationError:
        raise RuntimeError("OpenAI API 인증에 실패했습니다. 서버 OPENAI_API_KEY를 확인하세요.") from None
    except (PermissionDeniedError, NotFoundError):
        raise RuntimeError(f"OpenAI 모델 접근에 실패했습니다. API 프로젝트의 {options.model} 사용 권한과 모델 ID를 확인하세요.") from None
    except RateLimitError:
        raise RuntimeError("OpenAI API 사용량 또는 요청 한도에 도달했습니다. 결제·크레딧·프로젝트 한도를 확인하세요.") from None
    except APIConnectionError:
        raise RuntimeError("OpenAI API에 연결하지 못했습니다. 서버의 api.openai.com HTTPS 연결을 확인하세요.") from None
    except APIStatusError as error:
        # API errors can contain credential fragments; don't propagate raw bodies.
        raise RuntimeError(f"OpenAI API 요청 실패 (HTTP {error.status_code}, request_id={error.request_id}).") from None

    report = {"response_id": response.id, "request_id": getattr(response, "_request_id", None),
              "model": response.model, "requested_model": options.model,
              "reasoning_effort": options.reasoning_effort, "status": response.status,
              "max_output_tokens": options.max_output_tokens,
              "usage": response.usage.model_dump(mode="json") if response.usage else None,
              "incomplete_details": response.incomplete_details.model_dump(mode="json") if response.incomplete_details else None,
              "refused": any(part.type == "refusal" for item in response.output if item.type == "message" for part in item.content),
              "output_text": response.output_text}
    report_path = image.parent / "gpt_response.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    source = extract_source(response)
    source_path = image.parent / "gpt_output.py"
    source_path.write_text(source, encoding="utf-8")
    print(f"[GPT ready] response_id={response.id} source={source_path} report={report_path}", flush=True)
    return source
