# Cortex 서비스 웹 연동 — S3

## 2026-10-23 — 현재 기본 진입과 SSH 주소 계약

기본 흐름은 **지도·검색 → 아크로리버파크 단지 3D → 동·층 → 2D 평면 측정 / 실내 3D**다. 다른 위치는 준비 중 목업이며 실제 층·호 타입과 체험 평면을 구분한다. 가구 추론 API는 현재 웹 전용 기본값에서 비활성이고 GPU 승인은 별도다.

- Mac은 최신 `open-studio.command` 하나를 실행한다. 기존 SSH master와 뷰어 로컬 포트를 재사용하고, 지도용 포워딩을 추가하여 지도를 연다. 기본 로컬 포트는 지도35185/뷰어35173, 충돌하면 각각 다른 포트를 기억한다.
- 원격 `tools/start-remote-studio.sh`는 기존5173/5185를 유지하며 꺼진 서버만 시작한다. 새 서버는 `VITE_FURNITURE_MEASUREMENT_ENABLED=0`; Blender/GPU/API를 시작하지 않는다.
- `viewerUrl` 쿼리 → `VITE_VIEWER_BASE_URL` → 해당 서비스 원점에서 기억한 주소 → 같은 호스트5173 순서로 뷰어 주소를 정한다. `serviceUrl`도 같은 우선순위로 지도 복귀 주소를 정하며 최후 기본값은 같은 호스트5185다. HTTP(S)만 허용하고 URL내 사용자명/암호는 거부한다.
- `buildViewerUrl`의 variant/entry/마감 계약은 유지한다. `?studio=1`, `?studio=0`, `?variant=...` 직접 링크는 계속 뷰어를 열며, 매개변수 없는 뷰어 주소는 지도로 간다. 새 런처로 한번 연결한 동일 브라우저 원점에서는 예전 직접 링크도 저장된 지도 복귀 주소를 사용한다.
- 위치·동·층·체험평면 URL/state와 별도로 두 앱의 주소를 전달한다. 앱 로고, 공유 링크, 단지뷰, 실내뷰 및 별도 창 복귀에서도 주소를 보존한다.

수동 SSH가 필요하면 두 로컬 포트를 원하는 값으로 지정한다. 다음은 예시이며 최신 런처를 쓰면 입력할 필요가 없다.

```bash
ssh -N -o ExitOnForwardFailure=yes -L 35185:127.0.0.1:5185 -L 35173:127.0.0.1:5173 yj1-H200-kinamkim
```

열 주소: `http://127.0.0.1:35185/?viewerUrl=http%3A%2F%2F127.0.0.1%3A35173%2F`. 뷰어 직접 링크는 `http://127.0.0.1:35173/?studio=1&serviceUrl=http%3A%2F%2F127.0.0.1%3A35185%2F`. 로컬 포트를 바꿨다면 URL에도 그 값을 사용한다. 단일 뷰어 포트만 전달한 첫 접속에서는 지도 포트를 추정할 수 없으므로 새 런처를 사용한다.

아래는 이전 단계의 구현·검증 기록이다. 현재 진입 주소는 위 계약을 우선한다.


당시 기록: 시작 화면은 **5185의 `apps/web`**이며 기존 공간 선택·JSON 확인을 유지한다. **가구 등록 → GPU 서버 측정 → GPT 대체 안내 로그 → 고정 Blender 테스트 테이블 → GLB 미리보기 → 5173 Studio 배치·편집·저장/복원**을 연결했다. GPT API와 사진 속 형태 재현은 아직 하지 않는다. 실행 순서는 [실행 안내](../services/furniture_pipeline/README.md)를 따른다. 아래 내용은 최초 S3 구현 당시의 기록이며, 당시의 미구현 항목과 현재 생성 GLB 기능을 구분한다.

## 2026-10-21 — 당시 실행·진입 계약

- `apps/web`의 **선택 공간 열기**는 `studio=1&entry=overview`로 선택 세대의 2D/3D 평면을 바로 연다. **단지에서 시작**은 `studio=1&entry=complex`로 단지 화면을 연다. 둘 다 새 탭이며 선택 variant를 유지한다. `entry`를 생략한 기존 Studio 링크는 단지 화면으로 시작한다.
- 지원 variant는 `112a-basic-archisketch`, `112a-expanded-archisketch`, `168c-basic-archisketch`, `168c-expanded-archisketch`의 네 개다. 112A 파일은 `archisketch-details-v2`, 168C는 `archisketch-interiors-v1` 아래의 `acro112a/168c-basic/expanded.glb`를 사용한다.
- 시작 설정은 원본 마감·낮·**균형 화질**이다. 서비스의 PC 전용 안내를 현재 휴대폰·태블릿 터치 조작 안내로 바꿨다. 실기기 성능 검증 완료를 뜻하지 않는다.
- 두 Vite 설정은 `tools/vite/furniture-api.js`를 공유한다. 수동 `npm run dev` 및 원격 Studio 실행도 시작 시 API `/health`를 최대 1.5초 확인한다. `status=ok`와 `ready=true`가 모두 있어야 자동 활성화한다. 연결 실패·잘못된 응답·준비 중이면 기존 미리보기 전용 UI를 사용하고 초기 가구 목록/이미지 추론 요청을 보내지 않는다.
- `start.sh`나 운영자가 지정한 `VITE_FURNITURE_MEASUREMENT_ENABLED=0/1`은 우선한다. API를 나중에 연결하면 Vite를 재시작해야 한다. 이 감지는 시작 시점의 검사이며 연결 유지나 실제 추론 성공을 보증하지 않는다. 빌드는 로컬 API에 접속하지 않고 명시한 플래그를 사용하며, 미지정 시 기존 활성 기본값을 유지한다.
- 브라우저 모의 추론 테스트는 실제 GPU 상태와 독립적으로 활성화한다. 실제 오프라인 분기 검사는 API가 없는 개발 서버에서 `CORTEX_EXPECT_API_OFFLINE=1`로 실행한다. 모의 결과를 실제 SAM3/MoGe 추론으로 기록하지 않는다.

검증: 루트 단위 86/86, 앱 단위 20/20, 두 앱 빌드 통과. 앱 브라우저의 서로 다른 19개 검사를 모두 통과했다. 첫 실행의 원본 자료 경로 미지정 skip 1건은 해당 경로를 넣어 그 검사만 별도 실행해 완료했다(18+1). 실제 API가 없는 상태에서 두 앱의 미리보기·무전송과 네 모델의 HTTP 200/ready·직접 진입·단지 진입·PC 이동·서비스 복귀를 확인했다. 실제 GPU 추론과 실기기 FPS 검증은 수행하지 않았다. 기존 Vite 두 프로세스는 유지됐으며 설정만 자동 재로딩했다. 검증 로그·캡처·JSON은 `runtime/web-recheck/2026-10-21/`에 보존한다.

아래 9월 기록의 고화질 기본값·모바일 미구현·두 가지 평면 설명은 당시 상태다. 현재 동작은 위 계약을 따른다.

2026-09-29. 기존 공간 뷰어를 사용하는 독립 서비스 앱을 `apps/web/`에 구현했다. **공간 선택 → 기본형/확장형 뷰어 열기 → 원래 서비스 탭으로 복귀**, 그리고 **로컬 가구 JSON 확인**이 이번 범위다. 기존 S1 뷰어 코드는 수정하지 않았다.

## 실행

```bash
cd /home/nas5/kinamkim/Repos/geonwoo/3DProperty/apps/web
npm ci
npm run dev
```

- 서비스: `http://127.0.0.1:5185` / 포트 전달한 PC에서는 `http://localhost:5185`.
- 기존 공간 뷰어: `http://127.0.0.1:5173` / PC `http://localhost:5173`.
- 권장안의 5174와 임시 검토한 5175는 다른 사용자의 InsertAnywhere 앱이 사용 중이었다. 중단하거나 설정을 변경하지 않고 **5185**를 사용했다. `--strictPort`로 자동 포트 변경을 막는다.
- 기존 5173 서버가 이미 실행 중이면 재시작하지 않는다. 없을 때만 저장소 루트에서 `npm run dev`를 실행한다.
- 5185 서버는 작업 중 시작했다. 로그 `/tmp/cortex-s3-web-5185.log`, 시작한 npm 부모 PID 기록 `/tmp/cortex-s3-web-5185.pid`. 서버 재부팅 후에는 다시 실행해야 한다.

Mac의 SSH 포트 전달(이미 전달한 포트는 중복 요청하지 않는다):

```bash
ssh -N -o ExitOnForwardFailure=yes -L 5185:127.0.0.1:5185 -L 5173:127.0.0.1:5173 yj1-H200-kinamkim
```

뷰어 주소의 기본값은 **브라우저에서 보고 있는 서비스의 hostname + 5173 포트**다. 서버 파일 경로가 아니다. 다른 주소가 필요하면 `.env.example`을 `.env.local`로 복사해 `VITE_VIEWER_BASE_URL`을 설정하고 개발 서버를 재시작/빌드한다. Vite 변수이므로 비밀키를 넣지 않는다. 배포 주소는 아직 없다.

## 실제 기능과 경계

- 한 아파트(아크로리버파크 112A)의 기본형/확장형 선택.
- 기존 뷰어 URL query의 `variant`, `finish=original`, `lighting=day`, `quality=high`를 사용한다. 상세 화면은 **직접 링크로 새 탭**에서 연다. iframe이나 postMessage를 사용하지 않는다.
- 서비스 페이지를 원래 탭에 남겨 두므로 뷰어 오류/서버 부재에도 돌아올 수 있다. 서비스가 뷰어 내부 GLB 로딩 성공을 자동 감지한다고 표시하지 않는다.
- 사진은 실제 웹 뷰어 캡처다. 확장형 미리보기는 오크/해질녘, 기본형은 스톤/밤이다. 뷰어 시작은 두 형태 모두 원본/낮으로 통일하고 화면에도 명시했다.
- 도면 치수와 미터 단위를 유지하는 모델이며, 미표기 구간 등의 가정과 독립 실측 검증 미완료를 표시한다. Naver 도면을 이후 입력에 활용하고 출처/치수 유무를 기록한다는 안내를 넣었다.
- 로컬 JSON은 `File.text()`로 브라우저에서 읽는다. 업로드 API/서버 저장/추론 요청은 없다. 가구 결과는 새로고침 시 사라진다.
- 미터 길이를 내부에 유지하고 UI만 m/cm/mm로 바꾼다. confidence가 null이면 숫자를 만들지 않는다.
- 수동 형식 예제와 척도 미정 예제를 명시적으로 구분한다. 이는 S2 모델 실행 결과가 아니다.
- 모델 URI는 문자 검증·표시만 한다. GLB를 다운로드하거나 해시를 계산/검증한 것이 아니다. 실제 생성 모델의 품질·실측 정확도를 보증하지 않는다.
- 모바일 서비스 레이아웃은 제공하지만 **모바일 1인칭 이동은 미구현**이다. 공간 이동은 PC 키보드/마우스 지원 범위로 안내한다.
- 가구 import/이동/회전/저장/아일랜드 제거는 S1 연동 전이다. 가구 결과 확인만으로 배치 완료라고 표시하지 않는다.

## 가구 JSON v0 파서

기준: 비공개 인수인계 문서 `integration-contract-v0.md`의 C. 첫 S3 구현에서 받아들이는 값은 다음과 같이 고정했다. 이후 변경은 S1/S2와 버전 합의가 필요하다.

- schema: `cortex.furniture.v0`, asset_id/revision은 비어 있지 않은 문자열.
- units: `m`; coordinate_space=`gltf-y-up`, front_axis=`+Z`, pivot=`bottom-center`.
- dimensions_m.width/depth/height: 유한한 양수 또는 명시적 null. 필드 누락은 오류, null은 검토 상태, 0·음수·비수치도 오류다.
- dimension_basis: `measured`, `catalog`, `estimated`, `manual`.
- scale_status: `measured`, `catalog`, `metric-estimated`, `reference-calibrated`, `manual`, `unresolved`. 근거/척도의 모순을 검사한다.
- `unresolved` 또는 한 치수라도 null이면 전체를 **검토 상태**로 보여주고 실제 길이 변환/배치 규격으로 취급하지 않는다. 원본 숫자는 원본 JSON에만 남긴다.
- confidence: null 또는 0–1. 정의가 없는 모델 출력을 정확도 확률로 표시하지 않는다. 다른 범위의 raw score는 S2와 별도 필드 합의가 필요하다.
- geometry_kind: `box-proxy` 또는 `glb`. GLB가 없는 `model_uri=null` + box-proxy를 허용한다. glb에는 안전한 HTTP(S)/상대 경로가 필요하다.
- model_sha256: null 또는 SHA256 64자리 문자열. 이것은 형식 검사이며 파일 해시 검증은 아니다.
- provenance: sample_id, method, implementation_revision, weights_id, scale_reference_used, scale_reference_description을 확인한다. 추정에는 method가 필요하다. 기준 보정에는 실제 기준 설명이 필요하다. 구현 버전과 가중치 ID도 결과 카드에 표시한다.
- S2 실제 패키지의 선택 필드 `diagnostics`를 읽는다. 제공된 geometry_status/dimensions_status/code/message는 비어 있지 않은 문자열, missing은 문자열 배열, scene_point_cloud_is_furniture_asset은 boolean이어야 한다. 생략한 기존 v0 파일도 계속 허용한다.
- diagnostics가 있으면 `dimensions_status` 누락 및 `succeeded` 외 상태(미래의 알 수 없는 문자열 포함)는 검토 상태로 제한한다. 최상위 진단 6필드는 위치 오류로 거부하고, C.2의 dimensions 코드 5개와 상태가 모순이면 검토 상태로 제한한다. `succeeded`여도 null/척도 미정/형식 오류 판정을 덮어쓰지 않는다. 기하 처리 실패만으로 정상 치수 박스를 거부하지도 않는다.
- 기하 처리와 가구 치수를 별도 상태로 표시하고, 결과 코드·원문 사유·부족한 근거를 보존한다. 기하 성공을 치수 성공으로 바꾸지 않으며, 미정 box-proxy는 ‘박스 규격 미정 · 가구 모델 없음’으로 표시한다.
- 유효한 양수의 상태 문구는 ‘치수 형식 확인’이다. 실측 검증 완료를 뜻하지 않는다.
- JSON 파일 최대 1MiB. 입력 문자열은 textContent로 출력하므로 HTML로 실행하지 않는다. 파일 경로/모델 URL을 실행하거나 추론 서버에 보내지 않는다.

## 검증

```bash
cd /home/nas5/kinamkim/Repos/geonwoo/3DProperty/apps/web
npm test
npm run build
# 기존 5173 뷰어가 실행되어 있어야 두 실제 GLB 연결 검사를 수행할 수 있다.
npm run test:browser
```

- 단위 검사 12개 통과: 정상 박스·단위 변환·누락/0/음수/비수치/무한대·미정 치수·척도 근거·신뢰도·URI·잘못된 JSON·뷰어 URL·진단 상태와 치수 성공의 분리·진단 필드 형식.
- 독립 Vite 프로덕션 빌드 통과. 서비스 dist는 기존 루트 뷰어 dist와 별도다. 웹 배포/공유 URL은 생성하지 않았다.
- 서비스 브라우저 검사 **6개 통과, 실패/skip 0개**. 두 실제 GLB 연결, JSON 정상/오류/미정, 실제 S2 파일, 실패 진단의 숫자 사용 차단, 뷰어/GLB 실패 후 복귀, 모바일 레이아웃을 확인했다. 이번 환경은 Linux headless Chromium + SwiftShader다.
- 루트 package/lock/Vite, `src/walkthrough`, 모델 GLB, 기존 테스트를 변경하지 않았다. 물리 이동/충돌/문 상호작용의 전체 회귀 검사를 이번 앱 테스트로 대체한다고 주장하지 않는다.

## 다음 연동 요청

### S1

현재 직접 링크 흐름에는 bridge가 필요 없다. 가구 한 개를 실제 배치할 단계에 `staging.importAsset`이 필요하다. `protocol_version`, request_id, asset_id/revision, scene_id/revision/variant, units/좌표, 치수/근거/모델 경로를 검증하고 성공/실패 응답을 반환해야 한다. 뷰어 준비/오류 자동 상태를 연결하려면 실제 구현된 `viewer.ready/error` capability도 제공해야 한다. 해당 명령들은 아직 호출하거나 완료로 표시하지 않는다.

### S2

`public/examples/manual-table.json`을 형식 예제로 재사용할 수 있다. 실험 결과의 추정치와 평가 정답은 분리하고, method/weights/revision/scale_reference를 실제 값으로 제공해야 한다. 이미지의 모서리·잘림 제외는 입력 안내이며 자동 판별이 아니다. confidence 정의가 없으면 null로 둔다. GLB가 없어도 치수 박스로 전달 가능하다. 실패/미정은 숨기지 말고 null과 사유를 보존하되, 모델 실패 코드/메시지의 공통 필드는 다음 계약에서 합의해야 한다.

## 변경 파일

- `apps/web/`: 독립 package/lock/config, index.html, `src/{main,furniture,viewer-url}.js`, style.css, 단위/브라우저 테스트.
- `apps/web/public/examples/`: 수동·미정 형식 예제.
- `apps/web/public/previews/`: 기존 팀 뷰어 캡처 2장을 축소한 JPEG와 출처 README.
- `docs/web-integration.md`: 이 기록.
- 비공개 발표 근거: `AisideProject/submissions/week-05/assets/web-integration/`.


## 2026-09-29 기존 S3 세션의 후속 인수

기존 앱/서버를 이어받아 진단 사유 표시를 보완했다. 첫 재검사의 브라우저 3개 중 JSON·모바일 2개는 통과했지만 첫 화면의 `Page.captureScreenshot` 오류로 공간 연결 검사는 실행되지 않았다. 따라서 앞선 ‘단위 검사/빌드 통과’ 보고를 실제 GLB 연결 성공의 근거로 사용하지 않는다. 앱의 이미지·폰트·레이아웃 준비 뒤 캡처하도록 검사 순서를 보완했다.

실제 S2 입력은 다음 파일을 브라우저 파일 선택으로 읽는다. 앱 public이나 배포 dist에 연구 원본을 복사하지 않는다.

```text
AisideProject/realestate-spatial-ai/experiments/furniture-dimensions/runs/2026-09-29-moge3-sofa2-geometry/furniture-package/asset.json
SHA256: d1fe1b2edf17866b07b76f58278a66acc8c6d5cb2719e80b6fb339c3b6ba49a7
```

- asset_id: `sofa2-moge3-geometry-20260929`
- geometry: `succeeded`; dimensions: `unresolved`; W/D/H: `null`; scale: `unresolved`; confidence: `null`; model_uri: `null`.
- 파서 판정: `review`, `metricReady=false`, 형식 오류 0개. cm/mm 선택을 비활성화하고 세 치수는 미정으로 표시한다.
- diagnostics의 객체 마스크·가구 로컬 축·전체 크기 검증·독립 정답 부재를 카드에 표시한다. geometry 출력은 배치용 가구 자산이 아니다.

실제 파일을 포함한 재현 명령(해당 비공개 파일이 있는 서버에서 실행):

```bash
cd /home/nas5/kinamkim/Repos/geonwoo/3DProperty/apps/web
CORTEX_FURNITURE_ASSET=/home/nas5/kinamkim/Repos/geonwoo/AisideProject/realestate-spatial-ai/experiments/furniture-dimensions/runs/2026-09-29-moge3-sofa2-geometry/furniture-package/asset.json \
CORTEX_CAPTURE_DIR=/home/nas5/kinamkim/Repos/geonwoo/AisideProject/submissions/week-05/assets/web-integration/s3-20260929 \
CORTEX_FONTCONFIG_FILE=/tmp/cortex-s3-fonts.conf \
npm run test:browser
```

`CORTEX_FURNITURE_ASSET`를 생략하면 비공개 S2 파일 검사는 명시적으로 skip한다. 같은 snapshot을 검사하는 테스트이므로 S2의 다음 결과 파일은 해당 테스트 기대값을 검토한 뒤 연결한다. `CORTEX_FONTCONFIG_FILE`은 이번 서버의 한국어 캡처용 로컬 폰트 설정이며 다른 환경은 설치된 한국어 폰트를 사용하고 이 변수를 생략할 수 있다. 환경 변수/비공개 경로는 테스트 전용이며 앱 번들에 포함되지 않는다.

### S1 요청: 다음 실제 배치 단위의 최소 bridge

아래는 요청안이며 현재 서비스에서 송수신하지 않는다. 첫 구현 대상은 미터 규격이 확정된 수동 박스 한 개의 import와 명시적 성공/실패 응답이다. 미정 sofa2 패키지는 import 대상에서 제외한다.

| 방향/명령 | 필요한 내용 | 완료로 인정할 응답 |
| --- | --- | --- |
| 뷰어 → 서비스 `viewer.ready` | protocol_version, scene_id, scene_revision, variant, units=`m`, coordinate_space=`gltf-y-up`, 실제 지원 capabilities | 요청한 장면의 GLB 및 필수 자산 로딩 완료 후 발행 |
| 뷰어 → 서비스 `viewer.error` | protocol_version, scene 식별/variant, stage, code, message, recoverable | 최초 로딩/자산/변경 실패 구분; 이전 장면 유지 여부 포함 |
| 서비스 → 뷰어 `staging.importAsset` | protocol_version, request_id, scene_id/revision/variant, 검증한 v0 asset 전체(asset_id/revision 포함), position_m, rotation_xyzw, scale=[1,1,1] | 같은 request_id에 ok=true와 instance_id, 적용 scene/asset revision, 실제 dimensions_m/transform; 또는 ok=false와 error.code/message |

미지원 capability, 장면/revision 불일치, 미정 치수, 모델 누락, 충돌/배치 불가, 중복 request_id의 처리를 명시해 달라는 요청이다. 실패를 받으면 성공 UI를 만들지 않고 사유를 보존한다. collision과 메시의 실제 갱신, 해시/모델 로딩, 단위와 로컬 축 유지 판정은 S1 책임이다. URL 프리셋을 가구 배치 저장으로 취급하지 않는다.

현재 링크는 `target=_blank` + `rel=noopener noreferrer`이므로 opener 메시지 채널이 없다. postMessage를 선택하면 별도 iframe/명시적 연결 방식 및 양쪽 허용 origin/source, protocol_version 검증을 합의해야 한다. 기존 직접 링크의 rel을 임의 제거하지 않았다. iframe은 사용자 클릭 기반 Pointer Lock과 포커스/복귀를 별도 검증해야 한다.

### S2 요청: diagnostics의 후속 합의

이번 실제 파일에 있는 선택 확장을 그대로 읽되 공통 계약 C를 임의 개정하지 않았다. 후속 결과는 `dimensions_status`와 `code/message`, 부족한 근거 배열을 유지하고, 미정/실패 시 W/D/H=null을 보존해 달라는 요청이다. 현재 표시 라벨은 succeeded/failed/unresolved/pending/not_run이며 새 상태 문자열은 원문을 표시하고 치수 사용을 보류한다. 결과 코드의 공식 목록, 상태 전이, geometry_kind=box-proxy의 미정 placeholder 의미는 다음 계약에서 합의할 대상이다.


### 서비스 브라우저 검증 결과

- Node `v20.20.2`, Playwright `1.58.2`, Linux x86_64, Chromium headless, SwiftShader 소프트웨어 WebGL. 데스크톱 viewport 1440×1000, 모바일 레이아웃 390×844. Mac/iPhone 실기기 검사나 FPS 측정은 아니다.
- 두 직접 링크에서 각각 `acro112a-basic.glb` / `acro112a-expanded.glb`의 HTTP 200, 뷰어 `data-load-state=ready`, 해당 variant와 초기 original/day/high를 확인했다. 서비스 페이지는 테스트 hook을 사용하지 않으며, 연결된 일반 뷰어에도 `window.__walkthrough`가 없다.
- 클릭으로 Pointer Lock 진입, W 키 입력, `document.exitPointerLock()`로 해제, 원래 탭 복귀를 확인했다. 물리 Esc 키는 headless 검사에서 확인하지 않았다. 반복 탐색/캡처 시 화질은 light로 바꿨으므로 캡처를 high 화질 비교 자료로 사용하지 않는다.
- 서버를 중단하지 않고 Playwright route로 GLB 404/문서 접속 실패를 주입했다. 실패한 뷰어 탭을 닫고 원래 서비스에서 평면 선택과 JSON 결과 확인을 계속할 수 있다. 서비스가 내부 오류를 자동 감지하는 기능은 아니다.
- 실제 sofa2 결과에서 geometry 성공과 dimensions 미정을 나눠 표시했고, 세 치수 미정/단위 선택 비활성화/가구 모델 없음/진단 사유 4개/모델 confidence 제공 안 됨을 확인했다. 파일 선택 후 모델 요청이나 GET 이외 요청이 발생하지 않았다.
- 숫자가 남아 있는 치수 실패 결과도 검토 상태가 되며, 외부 문자열은 HTML로 실행되지 않는다. 실제 S2 입력은 변경하지 않았고 private 캡처/검증 해시만 추가했다.
- 증거: `AisideProject/submissions/week-05/assets/web-integration/s3-20260929/`의 PNG 7장과 `verification.json`, `protected-files-before.json`. 이번 브라우저 검사 결과는 6/6, 약 2분이다.

재현 순서: 서비스에서 기본형/확장형을 선택 → 공간 열기 → 기존 뷰어에서 시작 → 해제 후 탭 닫기 → 내 가구 확인 → 실제 S2 asset.json을 선택. 수동 예제는 형식 예제라고 표시되며 실제 S2 파일에는 예제 배너가 없다.


### 기존 뷰어 회귀 검사 완료

S1의 기존 테스트를 수정하지 않고 저장소 루트에서 `FONTCONFIG_FILE=/tmp/cortex-s3-fonts.conf npm run test:browser`를 실행해 **4개 모두 통과**했다(약 2분). 모델 루트 scale [1,1,1], 가운데 침실 기본형 2.458×2.593m / 확장형 2.458×약 3.08345m, PC 이동·벽 충돌·문 개폐/통과·13/17개 문, 형태 전환과 마감/조명/화질, GLB/재질 오류 복구를 기존 assertion으로 확인했다. 실측 정확도나 실기기 FPS 검증은 아니다.

작업 전후 S1 뷰어·모델·루트 설정·기존 검사 등 43개 파일의 SHA256이 모두 일치한다. 기존 5173/서비스 5185 서버를 유지했다. 최종 결과: 앱 단위 12/12, 앱 브라우저 6/6(실제 S2 검사 포함), 기존 뷰어 브라우저 4/4, 독립 앱 빌드 통과. `verification.json`, `service-last-run.json`, `viewer-last-run.json`에 완료 상태를 보존했다.


## 2026-09-29 — diagnostics 소비자 호환 보완 (C.2/C.3)

S1이 채택한 생산 규칙과 소비자 요청을 `apps/web/src/furniture.js`에 반영했다. 구현 변경은 파서에 한정하며 기존 오류/검토 UI가 사유와 원문을 표시한다. 자동 이동·성공 별칭 처리·FAILED 부분 문자열 추론은 추가하지 않았다.

| 입력 | 현재 판정 |
| --- | --- |
| 최상위 geometry_status/dimensions_status/code/message/missing/scene_point_cloud_is_furniture_asset | `diagnostics_location` 오류 + 정확한 `diagnostics.<필드>` 안내, invalid/false |
| 진단 없는 기존 v0 | 기존 규칙 적용, 원본 Cube6는 valid/true |
| 빈 diagnostics 또는 dimensions_status 누락(코드만 있는 경우 포함) | 치수 상태 누락 사유 표시, review/false, 원문 유지 |
| DIMENSIONS_SUCCEEDED / DIMENSIONS_UNRESOLVED / DIMENSIONS_INFERENCE_FAILED / INVALID_DIMENSIONS_OUTPUT / OBJECT_NOT_DETECTED와 해당 상태의 모순 | 코드별 정확한 succeeded/unresolved/failed 대응을 검사, review/false, 원문 유지 |
| geometry failed + 정상 manual dimensions succeeded | valid/true 유지 |
| 정상 추정 규격 + missing GT만 존재 | valid/true 유지; 실측 검증 완료라는 뜻은 아님 |
| 미지 상태 또는 success/대문자/공백 별칭 | 원문 유지, review/false |
| 미지 코드 | 코드 자체로 무효화하지 않음; 상태·치수 검증은 그대로 적용 |

실제 원본 7개(진단 없는 Cube6와 sofa2), S2 파생 예시 3개 및 기존 합성/주의 사례를 새 기록에서 다시 확인했다. **30/30 기대 동작 통과**, 실제 원본 호환 충돌 없음. 이전 기록과 status/metricReady 판정이 바뀐 사례는 `misplaced-root-diagnostics`(valid→invalid), `empty-diagnostics-accepted-as-legacy`(valid→review), `code-alone-does-not-block`(valid→review) 3개다. 새 단위 검사는 별도로 최상위 6필드, 코드 5개×상태 5개, 미지/별칭/다른 단계 실패 코드를 검사한다.

검증 결과:

- 앱 단위 검사 **17/17**, 독립 앱 빌드 통과.
- 새 `tests/diagnostics.browser.js`의 파일 가져오기 검사 **3/3**, skip 0, 약 6.5초. 기존 전체 GLB/뷰어 브라우저 검사는 이번에 반복하지 않았다.
- 잘못된 최상위 필드는 이전의 정상 숫자/단위 선택을 제거하고 위치 오류를 표시한다. 누락/모순은 세 숫자의 사용과 단위 선택을 막고 review 사유 및 원문 JSON을 보존한다. 실제 Cube6·sofa2도 파일 선택 경로로 확인했다.
- S1 소스·모델·루트 설정/기존 검사, S2 원본·이전 30개 결과 및 파생 예시, 앱 UI/style/config 등 **65개 보호 파일의 작업 전후 해시 일치**. S2의 기존 writer 스크립트는 실행하지 않았으며 이전 기록을 덮어쓰지 않았다.
- 명령 위치 착오로 루트 `npm test`(10개 통과)와 `npm run build`도 한 번 실행되었다. 루트 dist가 재생성되었으며 큰 chunk 경고는 기존과 같다. 루트 소스/설정 수정이나 배포는 없었고, 이 결과는 위 앱 검사 개수에 합산하지 않았다.

변경 파일: `apps/web/src/furniture.js`, `apps/web/tests/furniture.test.js`, 새 `apps/web/tests/diagnostics.browser.js`, 새 `apps/web/scripts/verify-diagnostics.mjs`, 이 S3 기록 및 웹 연동 문서.

새 근거 폴더: `AisideProject/submissions/week-05/assets/web-integration/s3-diagnostics-20260929/`. `compatibility-results.json`에 이전/현재 파서 해시·30개 판정·3개 변경·원본 해시, `verification.json`에 검사 결과와 범위를 남겼다. 기존 `s3-20260929`와 S2 contracts 폴더의 결과는 보존했다.

재현(저장소 `3DProperty/apps/web`에서):

```bash
npm test
npm run build
CORTEX_FURNITURE_ROOT=/home/nas5/kinamkim/Repos/geonwoo/AisideProject/realestate-spatial-ai/experiments/furniture-dimensions \
CORTEX_FONTCONFIG_FILE=/tmp/cortex-s3-fonts.conf \
npm run test:browser -- tests/diagnostics.browser.js --output=/tmp/cortex-s3-diagnostics-browser
node scripts/verify-diagnostics.mjs \
/home/nas5/kinamkim/Repos/geonwoo/AisideProject/realestate-spatial-ai/experiments/furniture-dimensions \
/tmp/cortex-s3-diagnostics-new-report.json
```

Node 재검증 스크립트는 지정한 새 JSON을 `wx`로 작성해 기존 파일 덮어쓰기를 거부한다. `CORTEX_FURNITURE_ROOT`를 생략하면 원본 7개 브라우저 검사만 skip되므로 이번과 같은 실제 호환 검증에는 해당 경로가 필요하다. 브라우저 fontconfig 변수는 이 서버의 캡처 환경 설정이며 다른 환경에서는 생략할 수 있다. 현재 서버 5173/5185는 유지하며, bridge·저장·배포·추론·학습은 추가하지 않았다.

## 2026-10-21 — 실제 단지 배치·동·층 선택

기존 임의 A–O동 직육면체와 고정 2m 층 간격을 실제 아크로 리버파크 100–114동 데이터로 교체했다. `assets/location/acro-river-park/site-context.json`은 OSM WGS84 원본을 단지 중심 기준 미터 좌표(x=동, z=남)로 변환한 파생 데이터다. `tools/site-context/derive_acro_site.py`로 다시 생성할 수 있으며, bbox 응답에서 빠진 111동 outer way는 같은 OSM API의 `way/543646531/full` 원본을 함께 읽는다.

- 각 동은 OSM multipolygon/way의 실제 외곽선과 part별 높이로 렌더링한다. 선택 강조, 숫자 라벨, 실제 동별 최대 층, `전체 높이÷층수`에 따른 층 표시와 3D 클릭 층 판정을 사용한다.
- UI는 100–114동 선택과 각 동의 OSM 층수·높이를 보여준다. 22층 시연 평면은 선택 동이 22층 이상이고 현재 층이 22층일 때만 연다. 실제 동·호수와 112A/168C 타입 대응은 확인되지 않았다고 화면에 명시한다.
- 111동은 relation이 21층·79m이고 한 outer part가 22층이다. 원문 part 층수는 보존하고 렌더 높이는 79m로 제한하며 UI에 `파트 층수 상충 있음`을 표시한다.
- 단지 경계, 올림픽대로·신반포로·신반포로15길, GATE 1–3도 OSM에서 파생했다. 나무와 강 평면은 방향 파악을 위한 경량 시각 요소이며 실측 조경·수변 모델이 아니다.
- OSM 출처: [OpenStreetMap bbox API](https://api.openstreetmap.org/api/0.6/map?bbox=126.9908,37.5032,126.9965,37.5074), © OpenStreetMap contributors, [ODbL 1.0](https://www.openstreetmap.org/copyright). 높이와 층수는 커뮤니티 지도 태그이며 건축 실측값이 아니다.
- 동 번호/상대 배치는 [네이버 블로그 게시 단지 배치도](https://blog.naver.com/k5342211/221343866905?viewType=pc)와 [112A 위치가 표시된 재게시 배치도](https://easyfasthand.com/entry/아크로리버파크-평면도-배치도-시세-매매-전세-실거래가-입지분석-총정리)로 교차 확인했다. 재배포 권리를 확인하지 못했으므로 이미지는 앱 번들에 넣지 않았다.
- Esri World Imagery 1800px 원본은 현장 방향·도로·한강 위치의 로컬 육안 확인에만 썼다. 촬영일이 확인되지 않았고 고층 건물이 기울어 보여 footprint 추출에는 쓰지 않았으며, 공개 웹 텍스처로 포함하지 않았다. 제공자: Esri, Vantor, Earthstar Geographics, and the GIS User Community.

변경 범위는 `src/walkthrough/{complex-context,location,studio}.js`, `location.css`, 새 파생 데이터/생성기/OSM 보완 원본, `tests/site-context.{test,browser}.js`다. S1의 내부 GLB·Blender 생성기·마감·가구 배치 로직은 이번 범위에서 수정하지 않았다. 5173/5185의 오프라인 기본과 API 자동 요청 0 계약도 유지했다.

검증:

```bash
cd /home/nas5/kinamkim/Repos/geonwoo/3DProperty
node --test tests/site-context.test.js
npx playwright test tests/site-context.browser.js --reporter=line
npm test
npm run build
```

단지 단위 4/4, 단지 브라우저 1/1, 전체 단위 90/90, Vite 프로덕션 빌드가 통과했다. 브라우저에서는 15개 동 ID, 기본 109동, 111동 상충 안내, 112동의 19층 제한과 22층 시연 차단, 102동 22층 시연 허용, 77m 높이 비례, 화면 오류 없음과 캡처를 확인했다. Linux headless Chromium/SwiftShader 호스트에는 한국어 글꼴이 없어 캡처 글자가 네모로 보였지만 접근성 DOM의 한국어 텍스트와 assertion은 정상이다.

기존 `tests/studio.browser.js`는 단지 화면과 내부 overview 진입까지 성공한 뒤 S1의 최신 통합 방 ID에 없는 과거 값 `Living front`를 240초 기다려 실패했다. 현재 UI의 첫 방은 `거실 · 주방 · 복도`이며, 이는 이번 단지 코드 실패가 아니라 기존 테스트와 S1 내부 평면 schema의 불일치다. S1 소유 내부 테스트를 이번 변경에서 수정하지 않았다.

## 2026-10-21 — 층 표시·드래그 감도·카메라 높이 추적 보완

사용자 피드백에 따라 건물 내부에 가려지던 수평면을 외벽을 감싸는 한 층 높이의 금색 띠로 바꾸고, 모든 동에 비례 층 구분선과 선택 층 번호를 추가했다. 층 경계는 기존 OSM 전체 높이/층수에서 계산한 표시용 비례이며 실제 층별 실측 높이가 아니다. 선택 동 보기에서는 해당 동을 따로 보여 앞 동의 가림을 없앤다. 단지 전체·강변·도로 보기는 모든 동을 유지한다.

층 선택은 마우스·터치 드래그 24 CSS px당 한 층이며 트랙을 누르는 순간 층이 점프하지 않는다. −/＋ 버튼과 키보드 방향키로 한 층씩 바꿀 수 있고 동별 최저/최고층에서 멈춘다. 오른쪽 목록은 스크롤로 이동하고 버튼으로 층을 선택한다. 22층 선택만으로 내부에 자동 진입하지 않으며 시연 세대 보기 버튼으로 연다.

추가 사용자 요청을 반영해 선택 층이 높아지면 카메라도 부드럽게 올라간다. 카메라와 OrbitControls target의 Y를 높이 차이만큼 함께 이동해 현재 회전 각도·확대 거리를 보존한다. 동 또는 시점 변경, 내부 진입 때는 남은 층 추적 애니메이션을 취소한다.

변경: `complex-context.js`, `studio.js`의 단지·층·카메라 부분, `location.css`, 새 `floor-control.js`, `tests/site-context.browser.js`. S1 실내 장소 선택과 현재 모델 경로는 유지했다.

검증: 단지 데이터 단위 4/4, 단지 브라우저 3/3(29.9초), 빌드 통과. 마우스/합성 터치 저감도 드래그, 키보드·버튼·층 상한, 카메라 높이 변화와 회전·거리 보존, 선택 동/전체 보기, 1·12·22층 캡처, 명시적 22층 내부 진입을 확인했다. Linux Chromium/SwiftShader이며 실기기 터치 검증은 아니다. 한글 폰트가 없는 캡처 환경 제한은 이전과 같다.

근거: `3DProperty/runtime/site-floor-ux/2026-10-21/verification.json`과 `browser/` 캡처 4장. 3DProperty 루트에서는 `runtime/site-floor-ux/2026-10-21/`로 접근한다.


## 2026-10-21 — 선택 동 주변 맥락 유지 후속

사용자가 말한 “하나밖에 없다”는 단지 데이터 개수가 아니라 선택 동 외의 건물이 사라지는 현상으로 확인됐다. 바로 위 단계의 선택 동 단독 표시를 교체했다. 현재 선택 동 보기에서도 100–114동 15개를 모두 장면에 유지한다. 선택 동은 불투명하게, 나머지 동은 옅은 회녹색 반투명(opacity 0.16)과 약한 윤곽·층선으로 보여 상대 위치를 읽을 수 있다. 카메라 확대 범위 밖의 동까지 한 화면에 담는다는 뜻은 아니며, 단지 전체 버튼으로 전체 배치를 본다.

주변 동 번호 라벨을 누르면 그 동을 선택하며 선택 강조가 옮겨 간다. 반투명 앞 동이 선택 동 외벽 클릭을 가로채지 않도록 focus에서 선택 동의 교차점을 우선한다. 전체·강변·도로 시점에서는 모든 동의 불투명도를 복원한다. 기존 금색 층 띠, 저감도 드래그와 층 높이 카메라 추적은 유지했다.

이번 변경은 `complex-context.js`, `studio.js`의 단지 안내/검사 상태, `tests/site-context.browser.js`다. 112A entry-v4 기본/확장 GLB 두 개의 해시가 재질 감사 시점과 동일함을 확인했다. S1 실내 장소/모델 및 오프라인 설정은 수정하지 않았다.

검증: 관련 브라우저 3/3(39.3초), 이후 동 번호 실제 클릭 assertion을 추가한 해당 검사 1/1(20.7초), 단지 단위 4/4, 빌드 및 diff 형식 검사 통과. 102동 12층 화면에서 앞 100동·뒤 103/104동의 반투명 표시를 육안 확인하고, 100 라벨 클릭→강조 전환→102 복귀와 전체 보기의 불투명도 복원을 검사했다. 브라우저/폰트·합성 터치 제한은 앞 기록과 같다. 근거: `3DProperty/runtime/site-context-shading/2026-10-21/verification.json` 및 캡처.

앞선 문서의 legacy `Living front` 검사 실패는 그 당시 기록이다. 이후 S1이 `tests/studio.browser.js`를 최신 내부 장소/가구에 맞춰 갱신하여 1/1 통과했다고 전달했다. S1 근거는 `3DProperty/runtime/studio-integration/2026-10-21/verification.json`이며 이번 단지 검사 수에 합산하지 않는다.


## 2026-10-21 — 실사감 개선 공동 조사 (적용 전)

S1의 수신 회신으로 역할을 확인했다. S1은 entry-v4 BLEND/GLB의 geometry·UV·가구 세부 형태 및 CC0 후보를 읽기 전용 감사한다. S3는 웹 재질·조명·외관과 관련 논문을 조사한다. 이 단계에서 활성 GLB/BLEND, appearance/finishes/variants 또는 실내 studio 기능을 수정하지 않는다. 위 단지 음영 UX 수정은 별개로 완료했다.

### 현재 파일에서 확인한 원인

- entry-v4 기본/확장 각각 27개 재질 중 baseColor 이미지 사용 6개, normal 이미지 2개, metallicRoughness 이미지 2개, AO 이미지 0개다. 이는 GLB JSON의 참조 수이며 AO 이미지가 없다는 사실만으로 실시간 AO가 없다고 판단하지 않는다. 원본 해시와 재질별 필드는 `runtime/rendering-research/2026-10-21/material-audit.json`에 저장했다.
- 벽의 Warm ivory plaster와 Ivory woven linen/Offwhite bed linen은 해당 GLB에서 색·거칠기 상수만 있다. 나무·돌 바닥에는 색 이미지만 있다. 반면 Catalog charcoal leather/PVC에는 normal/roughness 맵이 있으므로 모든 가구가 무텍스처인 것은 아니다.
- 웹은 Three.js 0.186.1 WebGLRenderer와 ACESFilmicToneMapping, RoomEnvironment 기반 환경광을 이미 사용한다. 실제 현장 HDRI는 아니다. high/ultra에 GTAO가 이미 있고 balanced 기본에는 해당 패스가 없다. 화질 버튼만 올려도 벽/직물의 미세 재질과 가구 형태가 생성되는 것은 아니다.
- `refineMaterials`는 기존 normal 강도를 0.45로 통일하고 이름별 거칠기를 덮어쓴다. `finishes.js`의 대체 마감은 generated-v1 색 PNG를 적용하면서 그 색과 맞지 않는 기존 normalMap을 제거한다. 새로운 PBR 묶음을 도입하면 preset 전환/복원에서 normal·roughness·AO까지 함께 관리해야 한다.
- 외관은 실제 OSM 윤곽을 높이로 돌출한 형태에 단색·윤곽선을 입힌 수준이다. 창호·발코니의 실제 형태/입면 자료가 없고 단지 메시와 단지 태양에 shadow 설정이 없다. 실사 외관을 만들려면 입면 자료와 조명 개선이 함께 필요하다. OSM 높이만으로 실제 창호를 확정할 수 없다.

### 관련 원문과 적용 판단

| 자료 | 이 프로젝트에서의 용도와 제한 |
| --- | --- |
| [Burley, Physically-Based Shading at Disney, SIGGRAPH 2012](https://disneyanimation.com/publications/physically-based-shading-at-disney/) | 재질의 반사·거칠기·직물 표현을 다루는 기반. 단순 색상 교체보다 일관된 물리 기반 파라미터와 맵을 정하는 기준으로 사용한다. |
| [Jimenez et al., Practical Realtime Strategies for Accurate Indirect Occlusion, 2016](https://www.iryoku.com/downloads/Practical-Realtime-Strategies-for-Accurate-Indirect-Occlusion.pdf) | 바닥·가구·벽 접점의 음영 개선. 기존 GTAO 반경/강도를 실제 미터 스케일과 화면 예제로 평가한다. AO는 전역 조명 전체의 대체가 아니다. 논문의 타 하드웨어 속도를 본 앱 성능으로 인용하지 않는다. |
| [Yeh et al., PhotoScene, CVPR 2022](https://openaccess.thecvf.com/content/CVPR2022/papers/Yeh_PhotoScene_Photorealistic_Material_and_Lighting_Transfer_for_Indoor_Scenes_CVPR_2022_paper.pdf) | 사진과 대략 정렬된 CAD 장면에서 재질·조명을 맞추는 연구. 이미 편집 가능한 구조 모델을 가진 본 프로젝트에 직접적인 연구 방향이다. 대응하는 실내 참고 사진과 정합이 필요하며 평면도만으로 실제 재질을 복원하지 않는다. |
| [Guo et al., MaterialGAN, SIGGRAPH Asia 2020](https://projects.shuangz.com/materialgan-sa20/) | 플래시를 사용한 소수 재질 사진에서 공간적으로 변하는 반사 특성 추정. 벽지·천·나무 표본을 직접 촬영할 때 후보이며 현재 임의 이미지 한 장에 바로 적용 가능한 결과로 주장하지 않는다. |
| [Liang et al., GS-IR, CVPR 2024](https://openaccess.thecvf.com/content/CVPR2024/html/Liang_GS-IR_3D_Gaussian_Splatting_for_Inverse_Rendering_CVPR_2024_paper.html) | 여러 시점 사진으로 형상·재질·조명을 추정하는 장기 연구 후보. 현재 치수 기반 편집 메시·문·충돌 체계를 곧바로 대체하는 기능은 아니다. |

### 적용 우선순위 제안

1. 거실/주방의 동일 카메라 한 장면에서 벽 미세결, 바닥 나뭇결/석재, 직물의 baseColor·normal·roughness를 일치하는 세트로 비교한다. UV 타일 크기를 미터로 고정하고 색맵은 sRGB, 데이터맵은 선형으로 관리한다. [Poly Haven](https://polyhaven.com/license) 또는 [ambientCG](https://docs.ambientcg.com/license/)의 CC0 다운로드 자산을 후보로 쓰되 실제 세대 자재와 같다고 표시하지 않는다. 아직 후보 자산을 다운로드하거나 제품에 반영하지 않았다.
2. 동일 카메라에서 환경광·창 방향 주광·접촉 음영을 조정한다. 간접광 베이크를 택한다면 이동 가구와 변경 벽에서 생기는 고정 그림자 문제를 별도 평가한다. 과도한 AO, 거울처럼 번쩍이는 바닥, 무작위 노이즈 확대를 피하고 실제 참고 사진과 비교한다.
3. S1은 침구/쿠션의 볼륨, 주름·봉제선, 가구 모서리·하부 공간을 검토한다. 치수·문·충돌·배치를 보존하기 위해 시각 메시와 충돌 표현을 분리한다. 기존 생성기에 일부 bevel이 이미 있으므로 전부 없는 기능이라고 판단하지 않는다. 직물 sheen/금속 anisotropy 등의 후보는 [Three MeshPhysicalMaterial 문서](https://threejs.org/docs/pages/MeshPhysicalMaterial.html)를 따르되 추가 GPU 비용을 측정한다.
4. 사진 기반 PhotoScene/MaterialGAN과 다중 시점 GS-IR은 자료를 확보한 뒤 별도 실험으로 평가한다. [three-gpu-pathtracer의 현재 main](https://github.com/gkjohnson/three-gpu-pathtracer/blob/main/README.md)은 WebGPU 기반이므로 현재 WebGL 앱에 즉시 꽂을 수 있는 개선으로 제안하지 않는다. 정지 고품질 뷰 후보라면 정확한 버전·브라우저 호환성·로딩 비용을 먼저 확인한다.

후속 구현은 같은 카메라/노출의 전후 캡처, 실제 데스크톱/모바일의 프레임 시간과 메모리·전송량, 마감 전환/복원, 문·가구 편집·충돌 회귀로 평가한다. 이 조사에서 실사감 개선 수치나 FPS 향상을 측정한 것은 아니다. S1의 재질·UV 중간 감사는 아래 후속 항목으로 수신했으며, CC0 후보와 우선순위를 포함한 최종 구체안은 전달 예정이다.


### S1 appearance 감사 중간 결과 수신

S1의 `runtime/interior/2026-10-21-appearance-audit/audit.json`을 읽어 기본형·확장형의 재질 수와 맵 참조 수가 S3 감사와 일치함을 확인했다. 소파 가죽/PVC 두 재질의 normal/roughness 맵은 존재하며 “PBR 맵 전무”라는 진단은 사용하지 않는다. S1은 나무·석재의 1254×1254 색 이미지를 AI 생성 자료로 확인했으며, 실측 PBR 자료로 취급하지 않는다.

두 GLB에서 `Entry wall correction/00`, `Entry wall correction/01`, `Sink detail/recessed bowl`의 UV0 누락과 curved faucet의 유효 형상 삼각형 16개에 대한 UV 퇴화가 보고됐다. 새 맵을 적용하기 전에 S1 모델 작업으로 좌표를 보완할 대상으로 인수한다. 모든 primitive에 NORMAL이 있고 비단위 법선은 0이다. TANGENT 부재만으로 렌더링 결함을 확정하지 않는다. UV1 참조도 0이며 별도 장면 AO/lightmap atlas가 없는 상태로 기록하되, 기존 실시간 GTAO와 구분한다.

S1 감사는 모델 관련 6개 파일 해시 불변을 기록한다. 이 수신 반영은 문서만 변경했으며 모델·웹 재질 수정이나 검사 재실행을 시작하지 않았다. 우선순위·CC0 후보·논문을 합친 S1의 최종 구체안은 후속 수신 예정이다.


## 2026-10-21 — 공동 연구 인수와 PBR 재질 복원 준비

S1의 최종 `runtime/interior/2026-10-21-appearance-audit/proposal.json` 및 `s1-appearance-research-20261021.json`을 수신했다. S1은 모델·UV·후보 BLEND/GLB, S3는 appearance/finishes와 웹 조명·AO를 맡는 분리안에 S3가 동의하여 기존 S1 세션으로 전달했다. 활성 variants 전환은 후보 검증 후 S3 한쪽에서 수행하는 안을 전달했으며 이번에는 경로를 바꾸지 않았다.

P0에서는 기존 재질 이름과 texture_repeat_m을 유지하고, 구조/메타데이터 해시 보존을 위해 role을 새 GLB extras에 강제로 넣지 않는다. 별도 manifest에 정확한 material.name→wall_plaster/floor_wood/floor_stone/fabric_upholstery/fabric_bedding 대응, 맵 경로·해시·색 공간·packed component·UV texCoord, OpenGL normal 규약, UV 변환과 미터 스케일의 근거, 출처·라이선스를 요청했다. 천장·옻칠·기존 소파는 첫 재질 실험에서 기본 제외한다. 상세: `AisideProject/realestate-spatial-ai/docs/session-handoffs/s3-material-runtime-contract-20261021.json`.

S3는 새 재질 적용 전 `finishes.js`의 복원을 보완했다. map/normalMap 외에 roughnessMap/metalnessMap/aoMap, roughness/metalness/normalMapType/normalScale/aoMapIntensity를 저장하고 원본 선택 때 복원한다. 텍스처 참조와 공유 ORM 관계를 보존하며 repeat/offset/center/rotation, 수동 matrix와 matrixAutoUpdate, UV channel, wrapping/flipY/colorSpace도 복원한다. GLTFLoader의 회전+비균일 스케일 수동 행렬을 단순 updateMatrix로 덮어쓰지 않는다. 기존 색 이미지 전용 오크/스톤 preset에는 다른 표면의 normal/roughness/metalness/AO 맵이 남지 않도록 함께 해제한다. 새 PBR preset·텍스처·조명 개선은 아직 적용하지 않았다.

검증은 재질 복원 단위 4/4, entry-v4 기본/확장 브라우저 2/2(21.6초), 빌드와 diff 형식 검사 통과다. 두 variant에서 원본→오크→스톤→원본 이후 카메라 위치·scale·문 상태·batch 수가 유지됐고, 상태 안내문만 가린 캔버스 캡처의 PNG 바이트가 이전과 동일했다. 첫 브라우저 검사는 안내문 708픽셀 차이로 두 건 실패했으며 차이 bbox가 상태 문구 영역인 것을 확인하고 그 문구만 가려 재검사했다. 제품 코드를 바꿔 실패를 숨긴 것이 아니다. 신규 문 통과/이동 충돌 회귀나 실기기 FPS를 측정한 결과는 아니다.

활성 모델 관련 6개 파일은 S1 감사 해시와 모두 일치한다. 단지·층 UX, appearance 조명, variants, 생성기와 활성 GLB는 이번 작업에서 수정하지 않았다. 근거: `3DProperty/runtime/material-restoration/2026-10-21/verification.json`, `protected-models.json`, `browser-final/`. 초기 캡처와 변경 전 finishes도 같은 폴더에 보존했다.

S1이 추가한 [EGSR 2025 SVBRDF 예측 평가](https://repo-sam.inria.fr/nerphys/svbrdf-evaluation/)의 공식 프로젝트 페이지를 S3도 확인했다. 고정 형상과 예시 이미지로 시점별 재질을 추정해 atlas로 합치는 접근이며, 여러 시점에서 재질이 일치하지 않는 문제를 평가한다. 본 프로젝트에서는 CC0 PBR 비교 기준을 먼저 만든 뒤 생성 재질을 다른 시점·조명에서도 비교하는 후속 후보로 기록한다. 현재 시공 자재의 실측 복원이나 웹 적용 완료로 해석하지 않는다.


## 2026-10-21 — 사용자 참고 이미지 기반 단지 외관 렌더링

사용자가 제공한 feedback_1.png의 건물 선택 화면을 시각 방향으로 삼아 실제 웹 단지 외관을 보완했다. 100–114동 OSM 윤곽·배치·높이와 층 상한은 유지하면서 창 유리, 얇은 프레임, 층 슬래브와 수직 기둥·옥상 가장자리를 반복 인스턴스로 추가했다. 서로 맞닿은 part의 내부 면에는 창을 배치하지 않고 최상단 디테일도 기존 지붕 높이를 넘지 않게 한다. 이는 실제 아크로 리버파크의 창호 도면을 복원한 결과가 아니며, 화면에 창호·외벽·조경은 시각화용 디자인임을 표시한다.

유리는 반사와 거칠기·clearcoat를 사용하는 재질에 절차적으로 만든 깊이감 색맵과 약한 normal을 적용한다. 외벽은 미세 광물 표면 색맵과 매트한 재질을 사용한다. 재질 수치는 실측 자료가 아닌 시각화 설정이다. 단지 전용 태양과 건물·나무 그림자, 평평한 아스팔트 도로, 대기 원근을 추가했고 기존 부풀어 보이던 도로 튜브를 제거했다.

하늘·반사는 [Poly Haven Kloofendal 48d Partly Cloudy (Pure Sky)](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky)의 1K HDRI를 로컬 번들로 사용한다. Greg Zaal/Jarod Guest, [CC0](https://polyhaven.com/license). 다운로드 크기 1,435,119 bytes이며 출처·SHA256은 `assets/location/environments/manifest.json`에 있다. 실제 반포의 하늘이나 특정 층 조망을 측정한 자료는 아니다. 웹 실행 시 Poly Haven API/CDN에 연결하지 않으며 HDRI 실패 시 기본 하늘과 조작 기능을 유지한다. 사용자가 제공한 SNS 캡처는 참고만 했고 제품 자산으로 복사하지 않았다.

선택 동 보기에서는 해당 동의 외관을 선명하게, 나머지 14개 동은 반투명 윤곽으로 유지한다. 단지 전체·강변·도로 보기는 모든 동의 디테일과 그림자를 표시한다. 선택 층 띠는 유리를 가리지 않도록 반투명 금색으로 조정했다. 동 번호 클릭, 24px당 한 층 드래그, 버튼/키보드, 카메라 높이 추적과 22층 시연 경계는 유지했다.

단지 환경이 실내에 남지 않게 `appearance.js`의 render 호출에만 contextAppearance/try-finally 복원 지점을 추가했다. `site-appearance.js`는 그 한 프레임에서 하늘·환경광·fog·노출과 root 실내 조명을 임시 전환하고 즉시 원복한다. 실내 조명 preset의 숫자나 finishes는 수정하지 않았다. S1의 circulation-v5를 현재 실내 기준으로 인수했으며 문·가구 변경을 되돌리지 않았다. S3 material-runtime-contract와 자체 마감 복원 검사의 revision 기대값도 v5로 갱신했다.

변경 범위: `complex-context.js`, 새 `site-facade.js`/`site-appearance.js`, `location.js` 전달 인자, `studio.js` 단지 안내·invalidate·검사 상태, `appearance.js` 렌더 구간, 로컬 HDRI/manifest 및 관련 검사. S1의 variants/doors/archisketch-model, finishes와 활성 v5 자산을 포함한 보호 대상 12개 파일은 작업 전후 SHA256이 같다. 근거는 `runtime/site-realism/2026-10-21/protected-files.json`이다.


최종 검증: 관련 단위 10/10, 관련 브라우저 5종 모두 통과(첫 통합 실행은 4통과/1실패, 전환 검사 수정 후 해당 1종 재실행 16.6초 통과), 프로덕션 빌드·diff 검사 통과. 초기 실패는 단지 첫 화면으로 돌아온 뒤 ‘동 선택 시작’을 누르는 단계가 검사에 빠져 숨겨진 시점 버튼을 기다린 것이며, 제품 코드를 변경하지 않고 실제 UI 경로를 보완했다. 단지 렌더 전후 실내 캔버스 PNG 바이트 동일, 기존 lighting·문 상태·scale 유지, 하늘 로딩 실패의 조작 가능, 외부 Poly Haven 런타임 요청 0을 확인했다. 마우스/합성 터치·층 선택·높이 카메라 추적·인접 동 선택도 통과했다.

근거: `runtime/site-realism/2026-10-21/verification.json`. 최종 캡처는 `browser-transition-fixed/site-appearance.browser.js-b5d66--restores-the-interior-look/`의 focused-building/whole-site/interior-before/interior-restored.png다. Linux Chromium/SwiftShader 검증이며 실기기 FPS를 측정하지 않았다. 전체 단지 보기에서는 약 117만 삼각형 규모로 실기기 성능 비교가 후속 항목이다. 캡처 호스트의 한글 폰트 부재 제한은 기존과 같다. 실제 건물 입면의 정밀 복원이나 참고 영상과 동등한 사실감을 검증했다는 뜻은 아니다.


## 2026-10-21 — S1 UV P0 검토 및 S3 웹 활성화

S1의 `archisketch-uv-p0-v1` 기본/확장 후보를 검토해 `variants.js`의 GLB URL 두 곳과 model-info import 두 곳을 함께 전환했다. 168C 경로는 유지했다. 원본/후보 BLEND·GLB·메타데이터 12파일 SHA256, manifest의 20맵 참조, 각 8개 embedded 이미지와 재질·텍스처 binding·node metadata/transforms를 직접 대조했다. model-info 변경은 finish_revision/blend_sha256/glb_sha256뿐이다. 형상/법선 보존과 수전 UV 퇴화 0은 S1 독립 검증 기록을 검토하고 같은 후보 해시임을 확인했으며, 원본 검증 기록을 덮어쓰지 않았다.

실제 활성 경로에서 관련 단위 7/7, 브라우저 7/7(4.1분), 빌드와 diff 검사 통과. 브라우저 route 주입 없이 P0 GLB의 실제 응답과 metadata revision을 확인했다. 양형 원본→오크→스톤→원본 화면 PNG 바이트 동일, 몸체 50cm의 양형 주방 진입 및 미닫이문 4곳 양방향 통과, 112A/168C 네 모델 전환, 단지 HDRI 왕복 후 실내 화면·조명 복원과 HDRI 실패 시 조작 가능을 확인했다. 빌드 GLB 두 개도 후보 SHA256과 같다. 단위검사의 동선 메타데이터 fixture는 기존 v5이며, 활성 P0와의 메타데이터 동일성은 별도 preflight에서 확인했다.

이번 제품 코드 변경은 variants 경로뿐이다. 모델·manifest·실내/단지 코드와 루트 설정을 포함한 보호 대상 61파일은 SHA256이 같다. 두 브라우저 파일의 revision 기대값을 갱신하고 마감 원복 검사에 실제 후보 GLB 응답 확인을 추가했다. Linux Chromium/SwiftShader 검증이며 실기기 FPS 검사는 아니다. 기존 번들 크기 경고는 남아 있다.

P0는 UV 보완이며 새 실내 PBR 재질·조명·UV1 AO atlas 적용 결과가 아니다. 단지에 앞서 적용한 HDRI·태양광·그림자는 유지한다. 웹은 P0, 별도 데이터셋 current_release와 Mac 장면은 v5로 유지하며 이 작업에서는 변경하지 않았다. 근거: `runtime/interior/2026-10-21-uv-p0-activation/verification.json`, `preflight.json`, `build-assets.json`, `protected-after.json`, `browser/`; 인계: `s3-uv-p0-activation-20261021.json`. 커밋·푸시·배포 없음.


## 2026-10-21 — 168C details-v2 웹 활성화

S1 `s1-168c-details-20261021.json` 후보의 기본/확장 BLEND·GLB·model-info 6파일 SHA256과 metadata 내 모델 해시를 확인한 뒤 `variants.js`의 168C GLB 2곳과 metadata import 2곳을 `archisketch-details-v2`로 함께 전환했다. 112A는 `archisketch-uv-p0-v1`을 유지한다. 168C 안내에 가구 치수·문 하드웨어·개폐 방식은 설계 가정/제안이며 실제 시공 상태가 확인되지 않았음을 명시했다.

S1의 저장 산출물 독립검사 기본867/확장862 통과 및 browser-final의 닫힘차단→열림→양방향 문32개, 왕복 동선32개 결과를 읽고 초기 후보 해시를 확인했다. S3가 형상·동선 전체 검사를 다시 수행한 것으로 집계하지 않는다.

S3 실제 활성 경로 검사: `tests/interior-finishes.browser.js` 1/1 통과(2.2분), 네 모델 모두 실제 GLB 응답·metadata revision·ready·overview→tour→overview, 안전한 시작 위치·몸체44cm·눈높이1.6m·scale1, 평면 윤곽·집기·문 손잡이 확인. route 주입 없이 실행했고 page error는 0이다. 빌드·diff 검사 통과, 빌드 GLB 네 개 SHA256이 활성 원본과 일치한다. 기존 JS chunk 크기 경고는 유지된다.

마무리 중 S1의 두 BLEND와 model-info 해시가 갱신됐다. 현재 파일은 갱신된 S1 인계 해시와 일치하며, model-info의 새 blend_sha256을 초기 값으로 치환하면 초기 model-info SHA256이 정확히 재현된다. 따라서 metadata 변화는 이 식별필드뿐이며 GLB 두 개 및 웹에서 쓰는 치수·문·가구 정보는 동일하다. 이 동시 변경을 `concurrent-source-update.json`에 별도 기록하고 웹 검사 반복은 하지 않았다. S3가 갱신된 BLEND 내부를 재검증한 것은 아니다.

제품 변경은 variants의 168C 경로와 설명뿐이며 검사 파일 하나를 보완했다. 보호66파일 중62파일 SHA256 불변, 나머지4개는 위 S1 소스 갱신으로 분리했다. 공용 appearance/finishes/단지/studio/doors·112A P0·웹 GLB와 루트 설정은 유지된다. 새 PBR·runtime 조명은 적용하지 않았다. 기존5173 서버 유지, 커밋·푸시·배포 없음. Linux Chromium/SwiftShader 검사이며 실기기 FPS나 시공 정확도 검증은 아니다.

근거: `runtime/interior/2026-10-21-168c-activation/verification.json`, `preflight.json`, `protected-after.json`, `build-assets.json`, `browser/`. 인계: `s3-168c-activation-20261021.json`. 네 모델의 overview/tour 캡처는 browser 하위에 보관한다.


### 168C 최종 조명 저장본 해시 확정

S1 최종 고정 통보 후 BLEND·GLB·model-info 6파일 SHA256과 metadata의 blend_sha256/glb_sha256이 최종 인계와 모두 일치함을 확인했다. 활성화 당시 GLB 바이트는 동일하고 metadata 차이도 blend_sha256 한 필드뿐이다. S1 `blender-lighting-verification.json`의 이전/최종 BLEND·GLB 해시가 실제 파일과 연결되며, 보고된 변경은 Blender area-light energy·exposure와 metadata 식별 해시다. 메시 불변은 S1 검증 결과를 인수했으며 S3가 Blender 감사를 재실행한 것은 아니다.

추가 `door-sweeps.json`은 여닫이16개 × 0~90도/5도 간격19표본=304표본 모두 가구·벽 투영 겹침0임을 파일에서 확인했다. 해당 결과는 기록된 2D 투영 범위이며 실제 철물 인증이나 연속 전 각도의 무간섭 증명으로 확대하지 않는다. 최종 근거 `runtime/interior/2026-10-21-168c-activation/final-artifact-confirmation.json`. 웹 소스·모델·dataset 변경 및 웹 검사 반복 없이 기존 활성화 결과를 유지했다.


### 168C 주방 캡처 수평 보정 및 초기 시점 구분

S1이 지적한 기존 `168c-expanded-kitchen.png`는 천장 위주 구도이므로 주방 형상 근거로 사용하지 않는다. 원본은 보존했다. `tests/interior-finishes.browser.js`에서 네 모델의 tour 진입 직후 pitch를 보정 전에 기록하고, 마지막 주방 촬영은 pointer lock 해제 확인 후 place + look(yaw)로 수평을 고정했다. 촬영 전후 pitch≈0 및 카메라 상태 동일성을 검사한다.

후속 브라우저1/1 통과(네 모델,2.2분). 112A 기본/확장의 living 및168C 기본/확장의 living-kitchen-hall 진입 pitch는 모두0rad, 마지막168C 재진입도0rad였다. 최종 촬영 전후 pitch0/locked=false/위치·yaw 동일이며 냉장고·아일랜드·조리대·상부장이 보이는 구도를 직접 확인했다. 이 경로에서 초기 시점 오류는 재현되지 않았다. 기존 촬영의 pitch/포인터 이벤트 기록이 없어 이전 상향 구도의 정확한 원인까지 확정하지는 않는다.

제품 코드·모델 등67파일 SHA256 불변, 검사 파일만 수정했고 빌드·단위검사는 반복하지 않았다. 근거와 새 캡처: `runtime/interior/2026-10-21-168c-camera-capture/verification.json`, `browser/*/camera-views.json`, `browser/*/168c-expanded-kitchen.png`. S3 인계: `s3-168c-camera-20261021.json`.


### 168C 최종 top-view 서비스 미리보기 반영

`apps/web/public/previews/168c-archisketch-basic.png`와 `168c-archisketch-expanded.png`를 details-v2 최종 top-view와 맞췄다. 기본형은 이미 원본과 SHA256이 같아 유지했고 확장형만 교체했다. 두112A 미리보기 및 legacy168c-expanded.png는 기존 해시를 유지한다. 두168C 이미지(1280×850)의5185 HTTP응답은200/image/png이며 응답 바이트·SHA256이 최종 원본과 일치한다.

확인 시5185가 꺼져 있어 기존dev script를 `VITE_FURNITURE_MEASUREMENT_ENABLED=0`으로127.0.0.1:5185에 다시 실행했다.5173은 기존PID3335270과HTTP200을 유지한다. source/model/dataset 변경이나 build·브라우저 검사 반복은 없다. 근거 `runtime/interior/2026-10-21-168c-previews/verification.json`, `files.json`, `http.json`, `server.json`; 인계 `s3-168c-previews-20261021.json`.
