# 웹 이미지 → 서버 터미널 측정 결과

`3DProperty` 안의 코드만으로 SAM3 → MoGe-3 → 치수 후처리를 실행한다. GPT API와 Blender 단계는 아직 포함하지 않는다.

## 1. Runyour GPU 서버

SSH 지원 Linux/NVIDIA 머신을 대여하고, 현재 브랜치의 `3DProperty`를 **영구 저장소**에 복제/업로드한다. 서버에서 저장소 루트 기준:

```bash
cp services/furniture_pipeline/.env.example services/furniture_pipeline/.env
bash services/furniture_pipeline/scripts/setup_gpu_envs.sh
bash services/furniture_pipeline/scripts/login_hf.sh
npm run furniture:api
```

서버에 Node/npm이 없으면 마지막 명령 대신 `bash services/furniture_pipeline/scripts/start_api.sh`를 실행한다. 설치 스크립트는 Conda가 없으면 프로젝트 안에 Miniforge를 설치하고, `.envs/furniture-api`, `.envs/furniture-sam3`, `.envs/furniture-moge3`를 만든다. Python 3.12 / PyTorch 2.10.0 cu128 및 SAM3·MoGe-3의 Git 커밋을 고정한다.

`.env`는 기본값으로 실행할 수 있다. 저장소가 영구 디스크에 있으면 출력·가중치 캐시도 그 아래에 저장된다. 다른 위치를 쓰려면 `PIPELINE_RUNTIME_DIR`, `PIPELINE_HF_HOME`을 절대 경로로 바꾼다. 기존 환경을 재사용하려면 `PIPELINE_SAM3_PYTHON`, `PIPELINE_MOGE3_PYTHON`에 해당 환경 Python 경로를 지정한다.

Hugging Face에서 [facebook/sam3 사용 승인](https://huggingface.co/facebook/sam3)을 받은 계정의 읽기 토큰으로 로그인한다. 이미 `sam3.pt`가 있으면 `.env`의 `PIPELINE_SAM3_CHECKPOINT`에 경로를 입력하고 로그인 단계를 생략할 수 있다. API 실행 시 GPU·패키지·인증 설정을 먼저 검사한다. 실제 접근 승인과 가중치 다운로드는 첫 추론에서 확인되므로 첫 요청은 오래 걸릴 수 있다.

## 2. Mac에서 서버 연결

```bash
cp services/furniture_pipeline/runyour.env.example services/furniture_pipeline/runyour.env
```

`runyour.env`에 대시보드의 **SSH 호스트, 사용자, 포트, Mac의 PEM 경로**를 입력한다. 경로에 공백이 있으면 따옴표로 감싼다. 이어서 터미널 두 개를 유지한다.

```bash
# Mac 터미널 1: 서버 API로 이어지는 SSH 터널
npm run furniture:tunnel

# Mac 터미널 2: 웹
npm run dev
```

`http://localhost:8000/health`가 `ready: true`인지 확인하고, `http://localhost:5173/?studio=1`의 꾸미기 화면에서 **가구 등록**으로 이미지를 선택한다. 선택 즉시 업로드·추론이 시작된다. 원래 웹 실행 방법은 그대로다.

기본 포트는 8000이다. 바꾼다면 서버 `.env`의 `PIPELINE_API_PORT`, Mac `runyour.env`의 local/remote port와 루트 `.env`의 `FURNITURE_API_TARGET`을 맞춘 후 Vite를 재시작한다. DNS/HTTPS 설정은 필요 없다.

## 결과와 API

서버 API 터미널에 수신한 파일 정보, 실행 단계, 모델 로그, 최종 객체별 `width_m`, `depth_m`, `height_m`가 출력된다. 결과는 `runtime/furniture/<job-id>/`에 저장한다: 정규화 이미지, SAM 마스크, MoGe 점맵, 객체별 마스크·점군, `measurements.json`, CSV, `dimensions_dhw_m.npy`, overlay, `result.json`.

업로드는 `POST /api/furniture/measure`의 multipart 필드 `image`다. 응답은 `202 + job_id`; 웹은 `GET /api/furniture/jobs/<job-id>`로 완료/실패를 확인한다. 한 번에 한 이미지만 처리하며 추가 요청은 409로 거절한다. 재시작 후 완료 결과는 조회할 수 있지만 실행 중이던 작업은 다시 업로드해야 한다.

여러 가구가 검출되면 모든 객체를 출력한다. 가구가 없으면 `no_detection`, 점군이 부족하면 `insufficient_geometry`로 기록하며 가짜 치수를 반환하지 않는다. 치수는 **사진에서 보이는 표면의 추정치**이며 실측값이 아니다. 너비/깊이가 바뀌거나 GPU 메모리가 부족하면 `settings.json`에서 `swap_width_depth`, `max_image_side`, `moge_resolution_level`, `moge_use_fp16`을 조정한다.

웹 없이 서버에서 직접 실행할 수도 있다.

```bash
.envs/furniture-api/bin/python -m services.furniture_pipeline.pipeline.run_measurement --image /path/to/furniture.jpg
```

## 대여 전 Mac 검증

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r services/furniture_pipeline/requirements/test.txt
.venv/bin/python -m unittest discover -s services/furniture_pipeline/tests -v
npm test
npm run build
PLAYWRIGHT_CHANNEL=chrome npm run test:browser -- tests/furniture-registration.browser.js
```

로컬 검사는 실제 이미지 업로드 API·후처리·실패 처리를 테스트하고 GPU 추론은 테스트 대역/합성 점군으로 대체한다. 실제 SAM3·MoGe-3 CUDA 추론과 GPU 설치 스크립트 전체 실행은 대여 후 확인해야 한다.

원본 알고리즘과 모델 API: [SAM3](https://github.com/facebookresearch/sam3), [MoGe-3](https://github.com/microsoft/MoGe). 외부 `furniture_measurement` 폴더는 실행에 필요 없다.
