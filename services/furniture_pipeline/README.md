# 가구 측정 실행 방법

명령은 **`3DProperty` 루트 기준**입니다. Mac에서는 `bash start.sh` 하나로 기존 웹·3D 뷰어·필요한 SSH 터널을 실행합니다. GPU 서버가 없어도 웹을 사용할 수 있습니다.

## 1. GPU 서버

최초 1회 설치하고 Hugging Face 토큰으로 로그인합니다. SAM3 접근 권한이 있는 계정의 토큰을 입력하세요.

```bash
cp -n services/furniture_pipeline/.env.example services/furniture_pipeline/.env
bash services/furniture_pipeline/scripts/setup_gpu_envs.sh
bash services/furniture_pipeline/scripts/login_hf.sh
```

서버 API를 실행하고 이 터미널을 켜둡니다.

```bash
bash services/furniture_pipeline/scripts/start_api.sh
```

## 2. Mac

최초 1회 연결 설정 파일을 만듭니다.

```bash
cp -n services/furniture_pipeline/runyour.env.example services/furniture_pipeline/runyour.env
```

`runyour.env`에 SSH 호스트(`RUNYOUR_HOST`), 사용자(`RUNYOUR_USER`), PEM 파일의 전체 경로(`RUNYOUR_PEM`)를 입력합니다. 기본 SSH 포트는 22, API 포트는 8000입니다. 새 서버는 먼저 일반 SSH로 접속해 호스트 키를 확인합니다.

처음 사용하기 전 루트와 `apps/web`에서 각각 `npm ci`를 실행합니다. 이후 Mac 터미널 하나에서:

```bash
bash start.sh
```

- **서버 접속 가능 + API `ready: true`:** 터널·웹(5185)·3D(5173)를 켜고 모델 측정까지 사용합니다. 서버의 `start_api.sh`는 미리 실행돼 있어야 합니다.
- **서버 꺼짐·API 미준비·SSH 설정 없음:** 터널 없이 웹·3D만 켭니다. 이미지 미리보기·가구 JSON 확인·공간 배치는 유지하고, 이미지 서버 전송·모델 측정만 건너뜁니다.
- 이 터미널을 유지하고 **`Ctrl+C`로 종료**합니다. 로그는 `runtime/dev/run.*/`에 저장됩니다. 기존 실행 중인 서버는 재사용하며 종료하지 않습니다. 실행 모드가 반영되도록 처음에는 기존 수동 실행 터미널을 종료하세요.
- GPU 서버를 나중에 켰다면 `Ctrl+C` 후 `bash start.sh`를 다시 실행합니다.

## 3. 이미지 업로드

[기존 웹 열기](http://127.0.0.1:5185/) → **내 가구 확인 → 가구 등록**에서 이미지를 선택합니다. 기존 JSON 파일 확인 기능도 그대로 사용할 수 있습니다.

3D 공간은 같은 웹의 **공간 둘러보기 → 공간 열기** 또는 **단지에서 시작 · 공간 꾸미기** 버튼으로 엽니다.

측정 연결 모드에서는 웹에 진행 상태와 치수가 표시되고, **서버 API 터미널**에도 이미지 수신, SAM3, MoGe-3, 너비·깊이·높이 결과가 출력됩니다. 결과 파일은 `runtime/furniture/<job-id>/`에 저장됩니다. 첫 요청은 모델 다운로드 때문에 오래 걸릴 수 있습니다.

현재는 이미지 측정까지 구현되어 있으며, 새 3D 가구 생성·배치는 아직 포함하지 않습니다.

## 4. 변경사항 반영·연결 오류

- 웹·실행 스크립트만 바꾼 경우 서버 `git pull`이나 환경 재설치는 필요 없습니다. Mac에서 `Ctrl+C` 후 `bash start.sh`로 재시작합니다.
- 서버 API·모델 코드를 바꾼 경우에만, 변경을 커밋·푸시한 뒤 서버의 같은 브랜치에서 반영합니다. 측정 중이 아닐 때 API를 `Ctrl+C`로 종료하고 `git pull --ff-only` 후 `start_api.sh`를 다시 실행합니다. 설치 스크립트는 의존성이 바뀐 경우에만 다시 실행합니다.
- **연결 오류:** `runtime/dev/run.*/gpu-check.log`와 `tunnel.log`, 서버 API 터미널을 확인합니다. `curl --fail --show-error --max-time 10 http://127.0.0.1:8000/health`로 기본 터널 연결을 확인할 수 있습니다. 별도 로컬 API 포트를 설정했다면 8000 대신 그 포트를 사용합니다.
- `GET /api/furniture/jobs/00000000000000000000000000000000`의 **404는 없는 작업 ID로 보낸 연결 확인 요청**이며 측정 실패가 아닙니다. 재시도 후에도 실패하면 Mac의 `web.log`·`viewer.log`와 서버의 실제 `POST /api/furniture/measure` 로그를 확인합니다.
