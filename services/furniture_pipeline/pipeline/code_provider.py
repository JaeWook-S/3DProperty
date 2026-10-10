"""The future GPT boundary. Today ONLY the checked-in, trusted test code is used."""
import json
from pathlib import Path

TEMPLATE = Path(__file__).with_name("generated_model.py")


def provide_blender_code(handoff):
    print("이미지 + 치수 받았습니다. 나중엔 GPT API를 연결하세요", flush=True)
    print(json.dumps(handoff, ensure_ascii=False, indent=2, allow_nan=False), flush=True)
    # No network, OpenAI SDK, API key or arbitrary user-supplied Python execution.
    return TEMPLATE.read_text(encoding="utf-8")
