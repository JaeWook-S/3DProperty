# 이미지 → 가구 3D 자동화 최소 계획

## 목표

이번 작업은 아래 두 구간만 먼저 구현한다.

```text
[구간 A]
웹 이미지 업로드 → SAM3 + MoGe-3 + 후처리 → 치수와 산출물을 서버 터미널에 출력

                         ↓ 나중에 GPT API 연결

[구간 B]
생성되었다고 가정한 Blender Python 코드 → Blender headless 실행 → GLB 변환 → 현재 웹에서 표시
```

GPT API는 호출 비용이 있으므로 처음에는 호출하지 않는다. 두 구간이 각각 동작하는지 확인한 뒤 가운데에 GPT API를 끼운다.

## 현재 상태

- 작업 브랜치: `feat/image-to-3d-automation`
- 웹의 `가구 등록` 버튼과 이미지 선택·미리보기는 구현되어 있다.
- 1번의 코드 구현 완료: 이미지 선택 → 업로드 API → SAM3/MoGe-3 순차 실행 → 후처리 → 서버 터미널 출력·파일 저장.
- 업로드·후처리는 Mac에서 테스트하며, 실제 CUDA 모델 추론은 Runyour 대여 후 검증한다.
- 2번 Blender/GLB 변환은 아직 구현하지 않았다.
- 대여 후 설정과 실행 명령은 [가구 측정 실행 안내](../services/furniture_pipeline/README.md)를 따른다.

## 단일 저장소 원칙

최종 실행 단위는 **`3DProperty` 저장소 하나**다. `../furniture_measurement`는 이전 실험 코드를 확인하는 참고 원본일 뿐이며, 운영 코드가 이 외부 경로를 import하거나 직접 실행하면 안 된다.

```text
3DProperty/
└── services/furniture_pipeline/
    ├── api/main.py
    ├── pipeline/
    │   ├── sam3_infer.py
    │   ├── moge3_infer.py
    │   ├── postprocess.py
    │   └── run_measurement.py
    ├── scripts/setup_gpu_envs.sh
    ├── requirements/
    │   ├── api.txt
    │   ├── sam3.txt
    │   └── moge3.txt
    ├── .env.example
    ├── runyour.env.example
    └── tests/
```

`SAM3_MoGe3.ipynb`에서 필요한 추론·후처리 코드는 위 Python 모듈과 CLI로 옮기고, 노트북의 설치 명령은 `setup_gpu_envs.sh`와 버전이 고정된 requirements 파일로 옮긴다. 새 Runyour 서버에서는 이 스크립트 하나로 API·SAM3·MoGe-3 환경을 다시 만들 수 있어야 한다.

가져올 것은 SAM3/MoGe-3 추론 코드, 치수 후처리, 설정값, 패키지 버전과 최소 테스트 이미지다. `.venv-*`, `.cache`, `outputs`, `.DS_Store`, 기존 Omni3D 실험과 대용량 체크포인트는 복사하지 않는다. 모델 가중치는 설치 또는 최초 실행 시 영구 저장소에 내려받고 Git에는 포함하지 않는다.

1번의 완료 기준은 `../furniture_measurement` 폴더가 없어도 `3DProperty`만 복제한 새 GPU 서버에서 환경 설치·이미지 측정이 동작하는 것이다. Blender export는 2번에서 추가한다.

## 구현 순서

### 1. 웹 이미지 → 터미널 출력

1. `가구 등록`에서 이미지를 선택한다.
2. 웹이 이미지를 `multipart/form-data`로 `POST /api/furniture/measure`에 전송하고 작업 ID를 받는다. 작업 상태는 `GET /api/furniture/jobs/<job-id>`로 조회한다.
3. 백엔드는 파일명, MIME, 크기를 터미널에 출력하고 작업 폴더에 저장한다.
4. `services/furniture_pipeline/pipeline/run_measurement.py`가 두 모델의 개별 Python 환경을 호출한다.
5. SAM3 → MoGe-3 → 후처리를 순서대로 실행한다.
6. 아래 결과를 서버 터미널에 출력한다.

```json
{
  "width_m": 0.8,
  "depth_m": 0.6,
  "height_m": 0.75,
  "mask_path": ".../mask.png",
  "overlay_path": ".../measurement_overlay.png"
}
```

완료 기준:

- 웹에서 선택한 이미지가 서버에 도착한다.
- 터미널에서 파일 정보와 SAM3·MoGe-3 최종 치수를 확인할 수 있다.
- 이 단계에서는 결과 화면, DB, 작업 큐를 만들지 않는다.

### 2. Blender 코드 → GLB → 웹

처음에는 GPT 대신 테스트용 `generated_model.py`를 사용한다.

1. `generated_model.py`가 가구 모델을 생성한다.
2. 서버가 Blender를 GUI 없이 실행한다.

```bash
blender --background --python blender_runner.py -- \
  --script generated_model.py \
  --output runtime-assets/<asset-id>/model.glb
```

3. `blender_runner.py`가 생성 코드를 실행하고 GLB를 export한다.
4. 치수와 GLB 경로를 담은 `asset.json`을 만든다.
5. 현재 웹의 Three.js `GLTFLoader`가 `model.glb`를 불러와 기존 가구처럼 배치한다.

완료 기준:

- Blender GUI 없이 `model.glb`가 생성된다.
- 웹에서 새 가구가 보이고 이동·회전·배치할 수 있다.
- 모델마다 별도 JS를 생성하지 않고 기존 로더를 재사용한다. 필요한 것은 `GLB + asset.json`이다.

## 개발 환경

- 웹은 Mac에서 실행해도 된다.
- SAM3·MoGe-3·Blender는 GPU 서버에서 실행해도 된다.
- 개발 중에는 SSH 포트 포워딩으로 Mac의 웹이 서버 API를 `localhost`처럼 호출할 수 있다.
- 초기 검증에는 HTTPS, DNS, Redis, DB가 필요 없다.
- Blender MCP는 Codex와 Blender를 대화형으로 연결할 때 쓰는 개발 도구다. 이 자동화의 필수 요소는 아니며, 실제 파이프라인은 `blender --background` 실행으로 구성한다.

## Runyour AI 대여·설정 체크리스트

### 무엇을 대여할지

- 우선 **On-Demand GPU Cloud 1대**로 검증한다.
- 저비용 시작: NVIDIA RTX 3090/4090급, VRAM 24GB, RAM 64GB 이상, 여유 디스크 100GB 이상.
- 메모리 부족이 발생하면 A40/A6000급 VRAM 48GB로 올린다. SAM3와 MoGe-3를 순차 실행하므로 MVP에서는 H100보다 24/48GB 장비부터 검증한다.
- Ubuntu 기반이며 **SSH를 지원하는 템플릿**을 선택한다.
- 현재 노트북 기준 PyTorch `2.10.0 + cu128`을 사용하므로 CUDA 12.8 런타임을 지원하는 드라이버인지 확인한다.
- 머신 반환 시 기본 디스크가 초기화될 수 있으므로 Runyour 저장소를 연결하거나 결과를 Mac/별도 저장소에 백업한다.

### 대여 후 기록할 정보

- SSH 호스트, 사용자명, 포트, 내려받은 PEM 키 경로
- GPU 모델과 VRAM
- 영구 저장소 마운트 경로와 남은 용량
- 외부 HTTP 포트를 열었다면 Runyour가 발급한 접속 URL

### 서버에서 먼저 확인

```bash
nvidia-smi
free -h
df -h
python3 --version
```

그다음 아래 세 실행 환경을 분리해 설치한다.

1. `furniture-api`: FastAPI, Uvicorn, `python-multipart`
2. `furniture-sam3`: Python 3.12, NumPy 1.26.4, SAM3, PyTorch cu128
3. `furniture-moge3`: Python 3.12, MoGe-3, PyTorch cu128

프로젝트 코드, 모델 가중치 캐시와 `runtime/furniture`는 영구 저장소 아래에 둔다. SAM3 사용 승인 후 `login_hf.sh`로 로그인한다. 토큰과 PEM 키는 Git에 올리지 않는다. 설치 버전은 `services/furniture_pipeline/scripts/setup_gpu_envs.sh`와 requirements 파일을 기준으로 한다.

### Mac 웹과 연결

초기에는 API 포트를 인터넷에 공개하지 않고 SSH 터널을 사용한다.

```bash
chmod 400 <pem-key>
ssh -i <pem-key> -p <ssh-port> \
  -L 8000:127.0.0.1:8000 <user>@<host>
```

서버에서는 FastAPI를 `127.0.0.1:8000`으로 실행한다. Mac의 웹은 같은 출처의 `/api/furniture`를 호출하며 Vite가 SSH 터널의 `127.0.0.1:8000`으로 전달한다. SSH 터널 대신 Runyour HTTP 주소를 사용할 경우에는 내부 포트 `8000`을 등록하고 API의 listen 주소·인증도 별도로 설정해야 한다.

설정 완료 기준:

- `nvidia-smi`에서 GPU가 보인다.
- SAM3와 MoGe-3가 각각 테스트 이미지 한 장을 처리한다.
- Mac에서 `http://localhost:8000/health` 호출이 성공한다.

Runyour 공식 안내: [SSH 접속](https://runyourai.gitbook.io/userguide/tutorial/ssh), [HTTP 포트 등록](https://runyourai.gitbook.io/userguide/eng-runyour-ai/tutorial/how-to-add-a-port-number), [저장소](https://runyourai.gitbook.io/userguide/eng-runyour-ai/utilize-storage/storage-list)

---

## 마지막에 GPT API 연결하기

최종 연결 위치는 다음 한 곳이다.

```text
SAM3·MoGe-3 결과(원본 이미지 + width/depth/height)
  → GPT API
  → generated_model.py
  → 기존 Blender/GLB/웹 구간
```

### 연결 원칙

- API 키는 브라우저에 넣지 않고 백엔드 환경변수 `OPENAI_API_KEY`로만 관리한다.
- 백엔드가 이미지와 치수를 GPT에 전달하고 Blender Python 소스를 받는다.
- 응답을 `generated_model.py`로 저장한 뒤 이미 완성된 구간 B에 넘긴다.
- 생성 코드는 신뢰하지 말고 격리된 컨테이너에서 실행하며 파일·네트워크·`subprocess` 접근을 제한한다.
- 처음에는 고정 테스트 코드로 개발하고, 마지막 통합 테스트에서만 실제 API를 호출한다.

### 최소 Python 예시

```bash
pip install openai
export OPENAI_API_KEY="..."
```

```python
import base64
import mimetypes
from pathlib import Path

from openai import OpenAI


def generate_blender_code(image_path: str, width: float, depth: float, height: float) -> str:
    path = Path(image_path)
    mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")

    prompt = f"""
Create one Blender bpy script for the furniture in the image.
Exact dimensions in meters: width={width}, depth={depth}, height={height}.
Use meters, +Z as up, and bottom-center as the object origin.
Create the furniture only; a separate runner will export GLB.
Do not use network, subprocess, or external files.
Return executable Python source only, without Markdown fences.
"""

    response = OpenAI().responses.create(
        model="gpt-6-astra",
        input=[{
            "role": "user",
            "content": [
                {"type": "input_text", "text": prompt},
                {
                    "type": "input_image",
                    "image_url": f"data:{mime};base64,{encoded}",
                    "detail": "low"
                }
            ]
        }]
    )
    return response.output_text
```

운영 단계에서는 응답 형식을 Structured Outputs로 고정하고, 저장 전 금지 모듈 검사와 Blender 실행 시간 제한을 추가한다. 비용을 줄이려면 초기 테스트는 `detail: "low"`로 실행하고 동일한 이미지·치수 요청은 해시로 캐시한다.

공식 문서:

- [GPT-6 Astra 모델](https://developers.openai.com/api/docs/models/gpt-6-astra)
- [이미지 입력 가이드](https://developers.openai.com/api/docs/guides/images-vision)
- [OpenAI Python SDK](https://developers.openai.com/api/reference/python)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)
