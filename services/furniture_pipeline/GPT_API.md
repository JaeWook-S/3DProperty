# GPT Astra 가구 코드 생성 연결

작업 브랜치: `feat/gpt-astra-furniture`

기존 SAM3·MoGe3·SuperMat·Blender 및 웹 연결을 유지하고, 코드 생성기만 OpenAI Responses API로 교체합니다.

```text
이미지 → SAM3 + MoGe3 → SuperMat → 치수·재질 프롬프트
→ GPT-6 Astra (xhigh) → Blender Python → 기존 Blender 실행기 → GLB → 웹
```

## 필요한 것

- 서버에서 사용할 **OpenAI API 키**: [API 키 관리](https://platform.openai.com/api-keys).
- 해당 API 프로젝트의 **`gpt-6-astra` 모델 접근 권한**, 사용 가능한 결제·크레딧 및 요청 한도.
- 서버에서 `https://api.openai.com`으로 연결할 수 있는 HTTPS 네트워크.
- 기존에 테스트한 SAM3·MoGe3·SuperMat·Blender 환경과 가중치.
- API 환경에 설치할 OpenAI Python SDK. 아래 명령으로 추가합니다.

API 키는 서버의 `services/furniture_pipeline/.env`에만 입력합니다. 웹이나 Mac의 `runyour.env`, Git에 올리는 `.env.example`에는 실제 키를 넣지 않습니다. `.env`는 기존 `.gitignore`에서 제외하고 있습니다.

## 기존 서버에 적용

모든 명령은 각 컴퓨터의 **`3DProperty` 루트**에서 실행합니다.

### 1. Mac 변경사항을 브랜치로 배포

현재 생성한 로컬 브랜치의 변경사항을 커밋·푸시한 뒤 서버에서 받습니다. 자동으로 커밋하거나 푸시하지는 않았습니다.

```bash
# Mac — 변경사항을 확인한 뒤 실행
git add services/furniture_pipeline
git commit -m "feat: connect GPT Astra furniture generation"
git push -u origin feat/gpt-astra-furniture
```

### 2. 서버에서 브랜치 전환 및 의존성 추가

실행 중인 서버 API는 `Ctrl+C`로 종료합니다. 이 브랜치를 서버에서 처음 받는 경우:

```bash
git fetch origin
git switch --track origin/feat/gpt-astra-furniture

.envs/furniture-api/bin/python -m pip install -r services/furniture_pipeline/requirements/api.txt
.envs/furniture-api/bin/python -m pip check
```

서버에 이미 브랜치가 있으면 `git switch feat/gpt-astra-furniture` 후 `git pull --ff-only`로 갱신합니다. 기존 모델 환경과 Blender를 다시 설치할 필요는 없습니다.

### 3. 서버 `.env` 설정

`services/furniture_pipeline/.env`에서 다음 항목을 추가하거나 수정합니다. **기존 파일에 `PIPELINE_CODE_PROVIDER=stub`가 남아 있으면 계속 임의 테이블을 생성합니다.** 동일한 설정 이름은 한 번만 둡니다.

```dotenv
PIPELINE_GENERATE_3D=true
PIPELINE_CODE_PROVIDER=services.furniture_pipeline.pipeline.gpt_provider:generate
OPENAI_API_KEY=YOUR_ACTUAL_API_KEY
PIPELINE_GPT_MODEL=gpt-6-astra
PIPELINE_GPT_REASONING_EFFORT=xhigh
PIPELINE_GPT_MAX_OUTPUT_TOKENS=32768
PIPELINE_GPT_TIMEOUT=900
```

`OPENAI_API_KEY`의 예시 값을 실제 키로 바꿉니다. 기존 SAM3·MoGe3·SuperMat·Blender·SSH 설정은 유지합니다. `.env.example`만 수정하거나 `cp -n`으로 복사하는 것으로는 기존 `.env`의 `stub` 값이 바뀌지 않습니다.

| 설정 | 의미 |
| --- | --- |
| `PIPELINE_CODE_PROVIDER` | 기존 코드 생성기 경계에서 실제 GPT 어댑터 선택 |
| `OPENAI_API_KEY` | 서버에서만 읽는 OpenAI API 키 |
| `PIPELINE_GPT_MODEL` | 모델 ID. 기본값 `gpt-6-astra` |
| `PIPELINE_GPT_REASONING_EFFORT` | 추론 수준. 요청한 extra high는 `xhigh` |
| `PIPELINE_GPT_MAX_OUTPUT_TOKENS` | 추론과 코드 출력을 합친 토큰 한도. 기본값 32,768 |
| `PIPELINE_GPT_TIMEOUT` | 한 번의 API 시도에 대한 SDK 제한 시간(초). 기본값 900 |

입력 이미지·텍스트, 추론, 코드 출력에는 API 사용 요금이 발생합니다. 자동 재시도나 다른 모델·임의 코드로의 자동 대체는 하지 않습니다. `xhigh`는 응답이 오래 걸릴 수 있습니다.

### 4. 기존 실행 명령 사용

서버:

```bash
bash services/furniture_pipeline/scripts/start_api.sh
```

Mac:

```bash
bash start.sh
```

[가구 등록 웹](http://127.0.0.1:5185/)에서 이미지를 등록합니다. 실행 스크립트와 웹 코드는 수정하지 않았습니다. `/health`는 기존 모델 환경을 확인하며, API 키·결제·모델 접근 권한은 실제 GPT 요청에서 확인됩니다.

## GPT에 전달하는 자료

- SAM3·MoGe3와 동일한 좌표계로 정렬한 참조 사진을 실제 이미지 바이트로 전송합니다.
- 선택된 가구의 SAM3 전경 RGBA 이미지도 함께 전송해 모델링 대상을 구분합니다.
- 기존 `supermat_to_prompt.py`로 생성한 재질 프롬프트와 미터 단위 `width/depth/height`를 전송합니다.
- 기존 Blender 규약을 명시합니다: `create_model(dimensions)`, X=너비/Y=깊이/Z=높이, 미터 단위, 바닥 중앙 원점, 씬 초기화와 GLB 내보내기는 기존 실행기가 담당.

반환된 코드는 기존 구문·함수 형식 검사를 통과해야 하며, 실제 Blender 모델의 치수·원점과 GLB 형식 검증이 끝난 후 기존 경로로 웹에 제공됩니다. 문법상 단일 Python 코드 블록으로 감싸진 응답도 처리합니다.

## 결과와 로그 확인

서버의 `runtime/furniture/<job-id>/`에 저장됩니다.

| 파일 | 내용 |
| --- | --- |
| `supermat/<index>/prompt.txt` | 기존 자동 생성 프롬프트 |
| `gpt_input.json` | 사진 경로·치수·프롬프트·코드 규약을 담은 기존 입력 자료 |
| `gpt_response.json` | 응답 ID, 실제 모델, 요청 추론 수준, 응답 상태, 토큰 사용량, 응답 텍스트 |
| `gpt_output.py` | 완료 응답에서 추출하고 함수 형식을 검증한 Blender 코드 |
| `assets/<index>/generated_model.py` | 실제 Blender에 전달한 코드 |
| `assets/<index>/model.glb` | 기존 실행기가 내보낸 가구 모델 |
| `result.json` | 기존 측정 결과와 생성 상태 |

정상 로그는 `stage=code_generation` → `[GPT request]` → `[GPT ready]` → `stage=blender_export` → `[asset ready]` 순서입니다. 실제 API 설정에서는 `stage=gpt_stub`를 사용하지 않습니다.

API가 응답한 경우 `gpt_response.json`을 저장합니다. 토큰 한도·거절·빈 응답·잘못된 함수 형식이면 실패 처리하고 그 코드를 Blender에서 실행하지 않습니다. HTTP 인증·연결 단계에서 실패하면 이 응답 파일은 생성되지 않을 수 있습니다. 실패해도 기존 측정 결과는 보존됩니다.

## 오류 확인 및 테스트 모드 복원

- 인증 실패: `OPENAI_API_KEY`와 해당 프로젝트 권한을 확인합니다.
- 모델 접근 실패: `gpt-6-astra` 접근 권한과 모델 ID를 확인합니다. 다른 모델로 자동 변경하지 않습니다.
- 사용량·요청 한도: API 결제·크레딧·요청 제한을 확인합니다.
- 토큰 한도: `gpt_response.json`의 `status`와 `incomplete_details`를 확인합니다. 필요하면 `PIPELINE_GPT_MAX_OUTPUT_TOKENS`를 올립니다. 상한은 128,000입니다.
- 요청 시간 초과: 서버 네트워크와 `PIPELINE_GPT_TIMEOUT`을 확인합니다.
- Blender 오류: `gpt_output.py` 및 서버의 Blender 로그를 확인합니다. API 호출 성공과 모델 내보내기 성공은 각각 검증합니다.

기존 임의 테이블 테스트를 다시 하려면 서버 `.env`를 다음과 같이 바꾸고 기존 서버 시작 명령으로 재시작합니다.

```dotenv
PIPELINE_CODE_PROVIDER=stub
```

## 검증 범위

실제 OpenAI Python SDK에 메모리 내 HTTP 전송기를 연결해 요청 JSON·이미지 바이트·모델·`xhigh`·오류 처리를 검증했습니다. API 업로드→실제 프롬프트 요약→모의 GPT 응답→실제 Blender GLB 내보내기→기존 API 제공도 확인했습니다. 백엔드 37개 테스트를 통과했으며, 실제 API 키를 사용한 유료 요청은 수행하지 않았습니다.

공식 문서: [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra), [이미지 입력](https://developers.openai.com/api/docs/guides/images-vision), [추론 및 토큰 한도](https://developers.openai.com/api/docs/guides/reasoning), [SDK 설치](https://developers.openai.com/api/docs/quickstart).
