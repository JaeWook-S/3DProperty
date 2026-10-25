# 이미지 → 측정·SuperMat → 프롬프트 → Blender → 웹

모든 명령은 **`3DProperty` 루트**에서 실행합니다. SAM3+MoGe-3의 **깊이·높이·너비**와 SuperMat의 **재질 프롬프트**를 자동으로 준비하고, GPT API 호출 대신 측정 치수로 **고정 테스트 테이블 1개**를 생성합니다. 사진을 재현한 모델은 아닙니다. 측정에 성공한 첫 가구를 사용하며, 다른 가구의 측정 결과도 그대로 보존합니다.

기존 `start.sh`, 서버 `start_api.sh`, SSH 터널 및 웹 코드는 수정하지 않았습니다. 새 SuperMat 환경만 최초 1회 설치합니다.

## 1. GPU 서버

**이미 측정이 되는 서버:** Mac 변경사항을 커밋·푸시한 뒤, 서버의 같은 `feat/image-to-3d-automation` 브랜치에서 반영합니다. 측정 중이 아닐 때 기존 API를 `Ctrl+C`로 종료합니다.

```bash
git pull --ff-only
bash services/furniture_pipeline/scripts/setup_blender.sh  # 최초 1회
bash services/furniture_pipeline/scripts/setup_supermat.sh # 이번 추가 환경, 최초 1회
bash services/furniture_pipeline/scripts/start_api.sh
```

SAM3/MoGe-3 환경 재설치·HF 재로그인은 필요 없습니다. Blender는 GUI 없이 실행합니다. API 터미널은 켜둡니다. 기존 `.env`에 SuperMat 설정이 없어도 새 기본값이 적용됩니다.

**SuperMat 패키지와 가중치:** 원본 `../SuperMat`은 보존하고 코드·예제·체크포인트를 `3DProperty/SuperMat`에 실제 파일로 복사했습니다. 실행 중 상위 폴더를 참조하지 않습니다. 약 3.54GB인 `SuperMat/checkpoints/supermat.pth`는 Git에서 제외했으므로 **Git으로 배포하면 이 파일을 서버의 같은 경로에 별도로 복사해야 합니다.** 패키지 폴더 전체를 전송하면 포함된 가중치를 그대로 사용합니다.

`setup_supermat.sh`는 Python 3.12 기반 `.envs/furniture-supermat`에 전용 의존성을 설치합니다. 기본적으로 기존 API 환경의 Python 3.12를 사용하며, 필요하면 `PYTHON_BIN`으로 지정할 수 있습니다. SuperMat의 기반 모델은 첫 요청 때 `runtime/model-cache`에 다운로드합니다. 기본값은 `sd2-community/stable-diffusion-2-1`이며, 서버 `.env`의 `PIPELINE_SUPERMAT_BASE_MODEL`에 패키지 내부 로컬 모델 디렉터리를 지정할 수도 있습니다.

**새 서버라면** 위 실행 전에 환경 설치와 SAM3 접근 권한이 있는 Hugging Face 계정 로그인을 합니다.

```bash
cp -n services/furniture_pipeline/.env.example services/furniture_pipeline/.env
bash services/furniture_pipeline/scripts/setup_gpu_envs.sh
bash services/furniture_pipeline/scripts/login_hf.sh
bash services/furniture_pipeline/scripts/setup_supermat.sh
```

### Blender 설치 중 공유 라이브러리 오류

아래 명령은 **Mac이 아니라 GPU 서버에서** 실행합니다. 테스트 중 `libXrender.so.1`과 `libSM.so.6` 누락 오류가 발생했습니다. 각각 `libxrender1`, `libsm6`가 필요하며, GUI 없이 실행해도 이 라이브러리들은 설치해야 합니다.

필요 패키지를 한 번에 설치한 뒤 Blender 설치 확인을 다시 실행합니다. `setup_blender.sh`는 이미 받은 Blender를 다시 다운로드하지 않습니다.

```bash
sudo apt-get update
sudo apt-get install -y \
  libx11-6 libxi6 libxrender1 libxfixes3 \
  libxxf86vm1 libxkbcommon0 libgl1 libsm6

bash services/furniture_pipeline/scripts/setup_blender.sh
```

`sudo` 권한이 없으면 서버 관리자에게 위 패키지 설치를 요청합니다. 다른 라이브러리 오류가 남으면 다음으로 누락 목록을 확인합니다. 출력이 없으면 `ldd` 기준으로 누락된 공유 라이브러리는 없습니다.

```bash
ldd .tooling/blender/blender | grep 'not found'
```

`Blender 설치 완료`가 나오면 `bash services/furniture_pipeline/scripts/start_api.sh`를 실행합니다.

## 2. Mac

최초 1회 연결 설정 파일을 만듭니다.

```bash
cp -n services/furniture_pipeline/runyour.env.example services/furniture_pipeline/runyour.env
```

`runyour.env`에 SSH 호스트(`RUNYOUR_HOST`), 사용자(`RUNYOUR_USER`), PEM 파일의 전체 경로(`RUNYOUR_PEM`)를 입력합니다. 기본 SSH 포트는 22, API 포트는 8000입니다. 새 서버는 먼저 일반 SSH로 접속해 호스트 키를 확인합니다.

웹 의존성이 이미 설치돼 있으면 기존과 같이 `bash start.sh`만 실행합니다. 새 설치에서는 다음을 실행합니다.

```bash
npm ci
npm --prefix apps/web ci
bash start.sh
```

- 서버 API 준비됨: SSH 터널 + 웹(5185) + 3D(5173), 측정·GLB 생성까지 사용합니다.
- 서버 미준비: 웹·3D만 실행합니다. 이미지 미리보기·기존 JSON 확인·공간 편집은 가능하고 서버 측정·새 GLB 생성은 불가합니다.
- 기존 수동 실행 웹은 먼저 종료해야 새 실행 모드가 반영됩니다. 종료는 `Ctrl+C`; GPU 서버를 나중에 켰으면 `start.sh`를 다시 실행합니다.

## 3. 웹에서 테스트

[기존 웹 열기](http://127.0.0.1:5185/) → **내 가구 확인 → 가구 등록**에서 이미지를 선택합니다. 기존 JSON 파일 확인 기능도 그대로 사용할 수 있습니다.

자동으로 **SAM3 → MoGe-3 → 후처리 → SuperMat → 치수·재질 프롬프트 → 테스트 코드 생성기 → Blender → GLB**를 실행합니다. 각 모델은 별도 프로세스로 순서대로 실행합니다. SuperMat 입력은 측정 단계의 EXIF 정렬·리사이즈가 끝난 `input_rgb.png`에 해당 가구의 SAM3 마스크를 알파로 적용한 RGBA 이미지입니다. 같은 좌표계의 알파 마스크로 재질 통계를 추출하므로 배경을 제외합니다.

서버 터미널에 미터 단위 치수, SuperMat 단계 및 생성된 `prompt.txt` 경로가 출력됩니다. 프롬프트는 패키지 내부 `SuperMat/supermat_to_prompt.py`의 요약·생성 함수를 사용하며, 미터 치수를 센티미터로 변환해 재질 JSON에 채우고 Blender 실행 규약을 추가합니다.

웹에 치수·테스트 테이블 미리보기·GLB/JSON 다운로드가 나타납니다. **3D 공간에서 배치**를 누르면 Studio에서 이동·회전·삭제·브라우저 저장/복원이 가능합니다. Studio의 꾸미기에서 직접 가구를 등록해도 측정 후 현재 방에 배치합니다.

파일은 서버의 `runtime/furniture/<job-id>/`에 저장합니다.

- `supermat/000/reference.png`: 원본 사진을 측정 좌표계로 정렬한 참조 이미지
- `supermat/000/foreground.png`, `mask.png`: 해당 가구의 RGBA 입력과 SAM3 마스크
- `supermat/000/maps/foreground/`: `albedo.png`, `roughness.png`, `metallic.png`
- `supermat/000/material_summary.json`: 배경을 제외한 재질 통계와 `dimensions_cm`
- `supermat/000/prompt.txt`: 치수·재질 자료와 Blender 함수·좌표 규약을 합친 자동 프롬프트
- `gpt_input.json`: 원본 이미지 경로·해시, 정렬된 참조 이미지, `dimensions_m`, 프롬프트·재질 파일 경로 및 코드 생성 규약; GPT 호출 없음
- `assets/000/`: `generated_model.py`, `generation_input.json`, `model.glb`, `asset.json`, `export_report.json`
- `result.json`: 측정 결과와 `generation` 상태

`000`은 선택된 가구의 원래 측정 인덱스입니다. 앞 가구의 측정에 실패했다면 `001` 등으로 저장됩니다. SuperMat 또는 Blender 실패 시에도 측정 결과는 남고 `generation.status=failed`와 오류가 반환됩니다. 측정 치수가 없는 가구는 모델을 만들지 않습니다. 서버 디스크가 사라지면 GLB도 사라지므로 저장한 배치의 생성 가구를 다시 불러오려면 원래 서버 파일과 API가 필요합니다.

## 향후 GPT API 연결 경계

`pipeline/code_provider.py`만 코드 생성기를 선택합니다. 기본 `.env` 설정은 다음과 같으며, 현재 네트워크/API 호출은 없습니다.

```dotenv
PIPELINE_CODE_PROVIDER=stub
```

향후 API 어댑터 모듈을 추가한 뒤 다음처럼 설정합니다. 예시 모듈은 아직 구현하지 않았습니다.

```dotenv
PIPELINE_CODE_PROVIDER=services.furniture_pipeline.pipeline.gpt_provider:generate
```

어댑터의 계약은 `generate(handoff: dict) -> str`입니다. `handoff`는 저장된 `gpt_input.json`과 같은 데이터이며, `prompt`, `dimensions_m`, `reference_image_path`와 원본 `image_path`를 제공합니다. 어댑터는 이미지 파일을 API가 요구하는 형식으로 전달하고, 응답에서 **Blender Python 소스 문자열**을 반환하면 됩니다. API 키 처리도 이 어댑터에서 담당합니다. 설정이 어댑터를 가리키면 임의 테이블 템플릿을 읽지 않습니다. 측정·SuperMat·Blender 실행·웹 코드는 수정할 필요가 없습니다.

반환 코드는 `def create_model(dimensions):`를 정의해야 합니다. 치수는 미터 단위 `width/depth/height`이며 Blender X/Y/Z에 대응하고, 바닥 중앙이 원점이어야 합니다. 초기화·함수 호출·GLB 내보내기는 기존 `blender_runner.py`가 담당합니다. 이 규약은 자동 프롬프트와 `gpt_input.json`의 `code_contract`에 포함되며, 코드 구문·함수 형식과 실제 내보낸 치수도 검증합니다. 현재 테스트로 외부 생성기로 교체했을 때 임의 코드 대신 반환 코드가 사용되는 것을 확인합니다.

## 4. 기존 측정 결과로 2번만 테스트 (선택)

서버에서 아래 `JOB_ID`를 실제 기존 작업 ID로 바꾸고 업로드 확장자를 맞춥니다. SAM3/MoGe-3를 다시 실행하지 않고 SuperMat·프롬프트 생성·Blender를 실행해 새 작업 폴더에 GLB를 생성합니다. 기존 작업의 `input_rgb.png`와 `mask_###.png`도 남아 있어야 합니다. API는 켜둡니다.

```bash
.envs/furniture-api/bin/python -m services.furniture_pipeline.scripts.export_saved_measurement \
  --image runtime/furniture/JOB_ID/upload.png \
  --measurements runtime/furniture/JOB_ID/result.json
```

출력된 `3D:` 주소를 Mac 브라우저에서 엽니다. 기존 측정 파일은 덮어쓰지 않습니다.

## 연결·변환 오류

- Mac: `curl http://127.0.0.1:8000/health` → `ready: true`, `generate_3d: true`, `blender_ready: true` 확인.
- Blender 없음: `setup_blender.sh` 실행 후 API 재시작. 별도 설치를 쓰면 서버 `.env`의 `PIPELINE_BLENDER_EXECUTABLE`에 실행 파일 경로를 지정합니다. `PIPELINE_GENERATE_3D=false`는 측정만 실행합니다.
- SuperMat 환경 없음: `setup_supermat.sh` 실행 후 기존 서버 시작 명령으로 재시작합니다. `/health.ready`는 기존처럼 SAM3/MoGe-3 환경을 확인하므로 SuperMat 준비 여부는 업로드 후 `generation.status`와 서버 로그에서 확인합니다.
- SuperMat 가중치 없음: 서버 패키지의 `SuperMat/checkpoints/supermat.pth`를 확인합니다. 별도 경로를 사용하면 `.env`의 `PIPELINE_SUPERMAT_CHECKPOINT`로 지정합니다.
- 로그: 서버 API 터미널과 Mac `runtime/dev/run.*/` 확인. 없는 작업 ID를 조회한 404는 생성 실패가 아닙니다.
- 첫 요청은 모델 다운로드로 오래 걸릴 수 있습니다. 공유 라이브러리 누락은 위 **Blender 설치 중 공유 라이브러리 오류**의 설치 명령을 따릅니다.

## 이번 변경 검증

- 백엔드 28개 테스트 통과: 합성 SuperMat 맵을 사용한 실제 프롬프트 요약, 단위 변환, API 업로드→모델 제공, 실패 시 치수 보존, 생성기 교체, 실제 Blender GLB 치수·원점·해시 검증 포함.
- 기존 JavaScript 테스트 76개와 웹 브라우저 테스트 5개 통과. 브라우저에서 치수·GLB 미리보기·다운로드·3D 배치 링크를 확인했습니다. 브라우저 테스트의 서버 응답과 모델 추론은 테스트 데이터로 대체합니다.
- 고정 의존성 설치, `inference_supermat` 및 프롬프트 모듈 import, `pip check`, 셸 구문 검사 통과. 실제 SAM3/MoGe-3/SuperMat CUDA 추론은 GPU 서버에서 확인해야 합니다.
- `apps/web` 빌드 통과. 루트 3D 빌드는 기존 `src/walkthrough/studio.js`가 참조하는 `src/house-tours/house-tours.js` 누락으로 실패했습니다. 변경 전 HEAD에도 같은 참조가 있고 해당 파일은 없었습니다. 요청 범위에 따라 이 부분은 수정하지 않았습니다.
