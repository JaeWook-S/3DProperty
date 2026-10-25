"""Build the future GPT handoff prompt using the bundled SuperMat summarizer.

Run in the SuperMat environment so its Pillow/NumPy dependencies stay isolated
from the web service and SAM3/MoGe3 environments. No model or API is invoked.
"""
import argparse
import importlib.util
import json
import math
from pathlib import Path


SUPERMAT_SUMMARIZER = Path(__file__).resolve().parents[3] / "SuperMat" / "supermat_to_prompt.py"


def _load_summarizer():
    spec = importlib.util.spec_from_file_location("furniture_supermat_to_prompt", SUPERMAT_SUMMARIZER)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load bundled SuperMat summarizer: {SUPERMAT_SUMMARIZER}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_dimensions(dimensions_m):
    """Use the same finite, positive, maximum-50-meter bounds as the runner."""
    values = {}
    for name in ("width", "depth", "height"):
        value = dimensions_m[name]
        if type(value) not in (int, float) or not math.isfinite(value) or not 0 < value <= 50:
            raise ValueError("Dimensions must be finite positive meters, at most 50 m")
        values[name] = float(value)
    return values


def blender_contract(dimensions_m):
    """The authoritative contract shared by stub and future API providers."""
    dimensions_m = validate_dimensions(dimensions_m)
    return """[Blender 파이프라인 통합 계약 — 위 일반 요청보다 우선]
- 응답은 실행 가능한 Blender Python 소스 코드만 반환해. Markdown 코드 블록과 별도 설명은 넣지 마. 가정은 코드 주석으로 남겨.
- 모듈 최상위에 def create_model(dimensions): 함수를 정확히 하나 정의해. 인수 dimensions는 width, depth, height 키를 가진 미터 단위 dict이며 런타임에 전달돼.
- 아래 dimensions_m는 SAM3 + MoGe3의 치수 추정 결과야. 재질 JSON의 dimensions_cm는 같은 값의 센티미터 표현이야. 모델은 전달된 dimensions 값을 사용해 생성해.
- Blender X축 전체 너비는 dimensions['width'], Y축 전체 깊이는 dimensions['depth'], Z축 전체 높이는 dimensions['height']와 정확히 일치해야 해.
- 가구 전체의 월드 바운딩 박스는 X=[-width/2, width/2], Y=[-depth/2, depth/2], Z=[0, height]가 되게 해. 원점은 바닥 중앙(bottom-center pivot)이야.
- 모델 생성은 create_model(dimensions) 안에서만 실행해. 모듈 최상위에서 이 함수를 호출하거나 가구를 생성하지 마.
- 씬 삭제/초기화, 파일 입출력, 외부 명령 실행, GLB 내보내기를 하지 마. 파이프라인의 blender_runner.py가 씬 초기화, 함수 호출, 치수 검증, GLB export를 담당해.
- 위 일반 요청의 조명과 카메라 설정은 생략해. 가구 메시와 해당 재질만 생성해.

[런타임 치수 dimensions_m — meters]
""" + json.dumps(dimensions_m, ensure_ascii=False, indent=2, allow_nan=False) + "\n"


def generate_prompt(maps, image, dimensions_m):
    """Return (material summary dict, prompt text) for aligned SuperMat PNGs."""
    dimensions_m = validate_dimensions(dimensions_m)
    summarizer = _load_summarizer()
    args = argparse.Namespace(
        maps=Path(maps), image=Path(image), mask=None, roi=None, grid=4,
        width_cm=dimensions_m["width"] * 100,
        depth_cm=dimensions_m["depth"] * 100,
        height_cm=dimensions_m["height"] * 100,
    )
    summary = summarizer.summarize(args)
    prompt = summarizer.make_prompt(summary) + "\n" + blender_contract(dimensions_m)
    return summary, prompt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--maps", required=True, type=Path)
    parser.add_argument("--image", required=True, type=Path, help="Aligned RGBA image used for SuperMat")
    parser.add_argument("--width-m", required=True, type=float)
    parser.add_argument("--depth-m", required=True, type=float)
    parser.add_argument("--height-m", required=True, type=float)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--summary-out", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        summary, prompt = generate_prompt(args.maps, args.image, {
            "width": args.width_m, "depth": args.depth_m, "height": args.height_m,
        })
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.summary_out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(prompt, encoding="utf-8")
        args.summary_out.write_text(
            json.dumps(summary, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8",
        )
    except (OSError, ValueError, ImportError) as exc:
        parser.exit(1, f"SuperMat prompt error: {exc}\n")
    print(f"[SuperMat prompt] {args.out.resolve()}", flush=True)


if __name__ == "__main__":
    main()
