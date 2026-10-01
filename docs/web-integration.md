# Cortex 서비스 웹 연동 — S3

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
