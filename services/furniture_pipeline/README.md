# 이미지 → 측정 → Blender → 웹 실행

모든 명령은 **`3DProperty` 루트**에서 실행합니다. GPT API는 호출하지 않고, 측정 치수로 **고정 테스트 테이블**을 생성합니다. 사진을 재현한 모델은 아닙니다.

## 1. GPU 서버

**이미 측정이 되는 서버:** Mac 변경사항을 커밋·푸시한 뒤, 서버의 같은 `feat/image-to-3d-automation` 브랜치에서 반영합니다. 측정 중이 아닐 때 기존 API를 `Ctrl+C`로 종료합니다.

```bash
git pull --ff-only
bash services/furniture_pipeline/scripts/setup_blender.sh  # 최초 1회
bash services/furniture_pipeline/scripts/start_api.sh
```

SAM3/MoGe-3 환경 재설치·HF 재로그인은 필요 없습니다. Blender는 GUI 없이 실행합니다. API 터미널은 켜둡니다.

**새 서버라면** 위 실행 전에 환경 설치와 SAM3 접근 권한이 있는 Hugging Face 계정 로그인을 합니다.

```bash
cp -n services/furniture_pipeline/.env.example services/furniture_pipeline/.env
bash services/furniture_pipeline/scripts/setup_gpu_envs.sh
bash services/furniture_pipeline/scripts/login_hf.sh
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

이번 변경에는 웹 의존성이 추가됐으므로 다음을 실행합니다.

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

자동으로 **SAM3 → MoGe-3 → 후처리 → 테스트 코드 생성기 → Blender → GLB**를 실행합니다. 서버 터미널에는 치수와 다음 문구가 출력됩니다.

```text
이미지 + 치수 받았습니다. 나중엔 GPT API를 연결하세요
```

웹에 치수·테스트 테이블 미리보기·GLB/JSON 다운로드가 나타납니다. **3D 공간에서 배치**를 누르면 Studio에서 이동·회전·삭제·브라우저 저장/복원이 가능합니다. Studio의 꾸미기에서 직접 가구를 등록해도 측정 후 현재 방에 배치합니다.

파일은 서버의 `runtime/furniture/<job-id>/`에 저장합니다.

- `gpt_input.json`: 원본 이미지 경로·해시와 치수; GPT 호출 없음
- `assets/000/`: `generated_model.py`, `generation_input.json`, `model.glb`, `asset.json`, `export_report.json`
- `result.json`: 측정 결과와 `generation` 상태

Blender 실패 시에도 측정 결과는 남습니다. 측정 치수가 없는 가구는 모델을 만들지 않습니다. 서버 디스크가 사라지면 GLB도 사라지므로 저장한 배치의 생성 가구를 다시 불러오려면 원래 서버 파일과 API가 필요합니다.

## 4. 기존 측정 결과로 2번만 테스트 (선택)

서버에서 아래 `JOB_ID`를 실제 기존 작업 ID로 바꾸고 업로드 확장자를 맞춥니다. SAM3/MoGe-3를 다시 실행하지 않고 새 작업 폴더에 GLB를 생성합니다. API는 켜둡니다.

```bash
.envs/furniture-api/bin/python -m services.furniture_pipeline.scripts.export_saved_measurement \
  --image runtime/furniture/JOB_ID/upload.png \
  --measurements runtime/furniture/JOB_ID/result.json
```

출력된 `3D:` 주소를 Mac 브라우저에서 엽니다. 기존 측정 파일은 덮어쓰지 않습니다.

## 연결·변환 오류

- Mac: `curl http://127.0.0.1:8000/health` → `ready: true`, `generate_3d: true`, `blender_ready: true` 확인.
- Blender 없음: `setup_blender.sh` 실행 후 API 재시작. 별도 설치를 쓰면 서버 `.env`의 `PIPELINE_BLENDER_EXECUTABLE`에 실행 파일 경로를 지정합니다. `PIPELINE_GENERATE_3D=false`는 측정만 실행합니다.
- 로그: 서버 API 터미널과 Mac `runtime/dev/run.*/` 확인. 없는 작업 ID를 조회한 404는 생성 실패가 아닙니다.
- 첫 요청은 모델 다운로드로 오래 걸릴 수 있습니다. 공유 라이브러리 누락은 위 **Blender 설치 중 공유 라이브러리 오류**의 설치 명령을 따릅니다.
