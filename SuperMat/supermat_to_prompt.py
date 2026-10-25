#!/usr/bin/env python3
"""Summarize SuperMat PNGs for a Blender-code prompt. No AI inference.

Requires Pillow and NumPy (already present in the SuperMat environment).
Example: python supermat_to_prompt.py outputs/test --image inputs/test.jpg
Use --mask with a foreground mask in the same image frame when available.
Use repeated --roi NAME X0 Y0 X1 Y1 for known material interiors, in 0..1.
"""

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image


def scalar_stats(values):
    return {
        key: round(float(value), 3)
        for key, value in zip(
            ("p10", "median", "p90"), np.percentile(values, (10, 50, 90))
        )
    }


def summarize(args):
    maps = {}
    for name in ("albedo", "roughness", "metallic"):
        with Image.open(args.maps / f"{name}.png") as im:
            if im.mode not in ("L", "RGB", "RGBA"):
                raise ValueError(f"{name}.png: expected an 8-bit L/RGB/RGBA image")
            maps[name] = np.asarray(im.convert("RGB"))
    shape = maps["albedo"].shape
    if any(im.shape != shape for im in maps.values()):
        raise ValueError("The three maps must have identical dimensions")
    for name in ("roughness", "metallic"):
        im = maps[name].astype(np.int16)
        if np.max(np.abs(im - im[:, :, :1])) > 1:
            raise ValueError(f"{name}.png must be a grayscale map, not a packed ORM map")
    height, width = shape[:2]
    keep = np.ones((height, width), dtype=bool)
    mask_sources = []
    if args.image:
        with Image.open(args.image) as im:
            if "A" in im.getbands():
                alpha = im.getchannel("A").resize(
                    (width, height), Image.Resampling.NEAREST
                )
                keep &= np.asarray(alpha) > 127
                mask_sources.append("original_image_alpha")
    if args.mask:
        with Image.open(args.mask) as im:
            mask = im.convert("L").resize((width, height), Image.Resampling.NEAREST)
        keep &= np.asarray(mask) > 127
        mask_sources.append("supplied_foreground_mask")
    if not keep.any():
        raise ValueError("The mask contains no selected foreground pixels")

    if args.roi:
        boxes = []
        for name, *coords in args.roi:
            x0, y0, x1, y1 = map(float, coords)
            if not (0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1):
                raise ValueError(f"Invalid normalized ROI: {name}")
            boxes.append((name, x0, y0, x1, y1))
    else:
        n = args.grid
        boxes = [
            (f"row_{r + 1}_col_{c + 1}", c / n, r / n, (c + 1) / n, (r + 1) / n)
            for r in range(n) for c in range(n)
        ]

    regions = []
    for name, x0, y0, x1, y1 in boxes:
        left, top = math.floor(x0 * width), math.floor(y0 * height)
        right, bottom = math.ceil(x1 * width), math.ceil(y1 * height)
        selected = keep[top:bottom, left:right]
        if not selected.any():
            continue
        colors = maps["albedo"][top:bottom, left:right][selected]
        region = {
            "region_hint": name,
            "xyxy_normalized": [round(v, 4) for v in (x0, y0, x1, y1)],
            "selected_pixels": int(selected.sum()),
            "albedo_rgb_8bit_median": np.rint(np.median(colors, axis=0)).astype(int).tolist(),
        }
        for prop in ("roughness", "metallic"):
            values = maps[prop][top:bottom, left:right, 0][selected] / 255.0
            region[prop] = scalar_stats(values)
        regions.append(region)
    if not regions:
        raise ValueError("No selected pixels in the requested regions")

    dimensions = {"width": args.width_cm, "height": args.height_cm, "depth": args.depth_cm}
    return {
        "source": "SuperMat exported PNG statistics; predictions, not measurements",
        "map_size_px": [width, height],
        "dimensions_cm": dimensions,
        "coordinates": "normalized original image frame; origin top-left; x right, y down",
        "selection": "caller_defined_ROIs" if args.roi else "uniform_grid",
        "foreground_mask_sources": mask_sources,
        "background_warning": None if mask_sources else (
            "No foreground mask. Background pixels are included wherever a region overlaps them."
        ),
        "color_encoding": "raw exported 8-bit PNG RGB; linear/sRGB encoding not verified",
        "regions": regions,
    }


def make_prompt(data):
    return """첨부한 원본 가구 사진과 아래 재질 추정 자료를 참고해 Blender Python 코드를 작성해 줘.

[가구 치수]
아래 dimensions_cm에 값이 없으면, 내가 함께 제공하는 MoGe3 추정 너비·높이·깊이를 사용해.
치수를 아직 제공하지 않았다면 임의의 실측값을 만들지 말고 코드 상단 변수로 남겨 줘.

[자료 해석]
- SuperMat의 albedo, roughness, metallic PNG를 Python으로 요약한 통계야.
- roughness와 metallic은 0~1 범위의 예측값이야. 검증된 실측값은 아니야.
- region_hint는 호출자가 붙인 위치 힌트이며 SuperMat이 판별한 재질명이 아니야.
- 좌표는 원본 사진의 왼쪽 위가 (0,0), 오른쪽 아래가 (1,1)이야. 입력과 맵이 같은 구도로 정렬되었다고 가정해.
- 사진을 보고 해당 영역이 어느 부품인지 연결해. 배경이 섞이거나 여러 재질이 섞인 영역은 가구의 대표값으로 쓰지 마.
- 격자는 통계 추출용이야. 격자마다 별도 재질을 만들거나 사진을 격자처럼 입히지 마.
- albedo_rgb_8bit_median은 PNG 색상값이야. 선형 RGB로 검증되지 않았어. sRGB를 가정한다면 그 가정을 주석으로 밝히고, 셰이더 입력에 맞게 색공간을 변환해.

[모델링과 재질 구현]
- 원본 사진의 부품 구성·비율·윤곽·모서리·쿠션 곡률·봉제선을 관찰해서 재현해.
- 부품별 Principled BSDF의 Base Color, Roughness, Metallic에 위 통계를 참고해 적용해.
- 천·목재·가죽 등의 재질 종류와 무늬는 원본 사진에서 판단해. 통계만으로 재질 종류가 확정된다고 가정하지 마.
- 원본에서 보이는 표면의 미세한 무늬와 방향성을 실제 셰이더 노드로 구현해. 필요하면 물리적 크기를 고려한 약한 Bump를 사용해.
- 무늬·요철·Sheen 같은 추가 설정은 원본을 참고한 추정임을 주석에 밝혀. 아래 자료에 normal/height/UV 또는 보이지 않는 뒷면 정보가 있다고 가정하지 마.
- 사진 전체를 가구 표면에 그대로 투영해서 원본의 조명과 그림자를 재질에 굳히지 마.
- 재질을 평가하기 쉽도록 중립적인 조명과 카메라도 설정해.
- 실행 가능한 전체 Blender Python 코드와 사용한 가정을 제공해.

[재질 추정 자료 JSON]
""" + json.dumps(data, ensure_ascii=False, indent=2) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("maps", type=Path, help="Folder containing the three SuperMat PNGs")
    parser.add_argument("--image", type=Path, help="Original image; its alpha is used if present")
    parser.add_argument("--mask", type=Path, help="Aligned mask: white furniture, black background")
    parser.add_argument("--grid", type=int, default=4, help="Grid size if no ROIs are given (default 4)")
    parser.add_argument("--roi", nargs=5, action="append", metavar=("NAME", "X0", "Y0", "X1", "Y1"))
    parser.add_argument("--width-cm", type=float)
    parser.add_argument("--height-cm", type=float)
    parser.add_argument("--depth-cm", type=float)
    parser.add_argument("--out", type=Path, help="Output TXT path (default: maps/astra_prompt.txt)")
    args = parser.parse_args()
    if not 1 <= args.grid <= 16:
        parser.error("--grid must be between 1 and 16")
    for value in (args.width_cm, args.height_cm, args.depth_cm):
        if value is not None and (not math.isfinite(value) or value <= 0):
            parser.error("Dimensions must be finite positive centimeter values")
    try:
        data = summarize(args)
        out = args.out or args.maps / "astra_prompt.txt"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(make_prompt(data), encoding="utf-8")
    except (OSError, ValueError) as exc:
        parser.exit(1, f"Error: {exc}\n")
    print(f"Created: {out.resolve()}")
    print("Attach the original furniture photo to Astra, then paste this TXT and supply dimensions.")
    if not data["foreground_mask_sources"]:
        print("Note: No foreground mask; ignore background-containing regions.")


if __name__ == "__main__":
    main()
