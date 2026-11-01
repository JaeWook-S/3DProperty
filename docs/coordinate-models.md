# 112A·168C 치수 기반 모델 갱신

## 2026-10-23 치수 적용 기준

현재 구조의 기준은 아키스케치 방 경계 좌표와 배치된 문·창의 치수다. 네이버 부동산·호갱노노의 원근이 있는 평면 이미지는 가구 위치와 마감 참고이며, 여기서 벽 간격을 추정해 수치 원본을 덮어쓰지 않는다. 실제 해당 세대의 독립 실측이나 공식 치수 도면을 확보하면 출처·대응 지점·이전 값·새 값을 대조한 부분만 갱신한다.

아키스케치 좌표를 모델에 정확히 옮겼다는 사실과 실제 준공 치수와의 일치는 별도다. 벽 중심선·두께가 없는 구간은 방 경계 사이 간격으로 벽체를 구성하며, 문틀 여유·개폐 철물·알 수 없는 가구 치수는 설계 가정으로 남긴다. 공급·전용면적에 맞추기 위한 전체 확대·축소는 하지 않는다. 오목한 방의 최대 폭·깊이는 어느 위치에서나 확보되는 통로 폭이 아니다. `space-measurements.js`는 선택 지점을 지나는 방 경계 구간을 계산하며, 가구를 제외한 실제 통행 폭을 계산했다고 표시하지 않는다.

최신 MCP 저장본 대조에서 기존 방 좌표는 유지되지만, 112A 기본형에는 집에서 떨어진 욕실이 추가되어 있어 자동 수입을 막았다. 현재 168C 기본형 프로젝트는 확장형과 동일한 방·문·가구 내용을 갖고 있으므로, 보관된 기본형 원본을 유지한다.

### 개구부 폭 교정

기존의 인접 폴리곤 꼭짓점 추정보다 **배치 인스턴스의 배율 적용 후 치수**를 우선한다. 카탈로그 원형 크기만 알 수 있으면 잠정값으로 표시한다.

| 모델 | 원본 연결 ID | 이전 폭 | 보정 폭 |
| --- | --- | --- | --- |
| 112A 기본형 | window-17 | 1.023m | 1.995m |
| 112A 확장형 | door-07 | 1.047m | 0.900m |
| 168C 확장형 | sliding-11 | 1.958m | 1.795m |
| 168C 확장형 | window-20 | 2.189m | 1.995m |

위 표는 개구부 외곽 폭이며 손잡이·문틀을 제외한 통과 폭과 같지 않다. door-07 문짝은 기존 프레임 여유 40mm를 반영해 0.860m다. 이를 맞추기 위해 방·가구나 보행 몸체를 축소하지 않았다.

세 후보는 `assets/models/acro-river-park/{112a,168c}/archisketch-metric-v1/`에 따로 저장했다. 독립 검증에서 46개 방과 비변경 노드 1,550개의 좌표·UV·재질 연결, 부모 PBR·이미지 바이트를 보존했고 변경·추가 벽 20개 및 벽 샘플 162개를 통과했다. 2026-10-23 S1이 세 모델의 GLB·metadata 경로와 서비스 2D 출처를 함께 활성화했다. 168C 기본형은 details-v2를 유지한다. 실제 경로의 네 모델·재질 원복 검사 4/4와 빌드가 통과했고 dataset `2026-10-23-metric-v1`에 보관했다. [활성화 검증](../runtime/interior/2026-10-23-metric-activation/verification.json)을 현재 상태의 근거로 사용한다.

근거: [치수 독립 검증](../../AisideProject/realestate-spatial-ai/experiments/service-readiness/2026-10-23/metric-audit/independent-candidate-verification.json), [자료 우선순위](../../AisideProject/realestate-spatial-ai/docs/session-handoffs/service-readiness-20261023/source-authority.json), [사용자 확인 사항](../../AisideProject/realestate-spatial-ai/docs/session-handoffs/service-readiness-20261023/USER-ACTIONS.md).

## 아래는 2026-10-12 구현 당시 기록

아래의 ‘현재’ 경로와 검사 수치는 당시 버전의 기록이다. 이후 활성 경로와 최신 치수 기준은 위 설명 및 `variants.js`를 따른다. 개구부 꼭짓점 우선 규칙은 2026-10-23에 배치 인스턴스 치수 우선으로 변경했다.

2026-10-12. 기존 112A·168C의 기본형·확장형을 각각 아키스케치 원본 좌표 기반 구조로 갱신했다. 웹 선택 항목은 네 가지이며 아키스케치를 별도 평면 종류로 노출하지 않는다. 이전 집기 모델 파일은 재현 자료로 보존하고, 현재 웹은 112A `archisketch-details-v2`, 168C `archisketch-interiors-v1`을 사용한다.

## 112A 최신 구조·참고 배치 갱신 (details-v2, 2026-10-12)

현재 112A 기본형·확장형은 `assets/models/acro-river-park/112a/archisketch-details-v2/{basic,expanded}/`를 사용한다. 구조는 같은 날짜에 읽은 아키스케치 저장본의 `archisketch-structure-v2`이다. 168C는 이전 interiors-v1을 유지한다. 기존 웹 variant 이름과 공유 링크는 동일하며 새 배치 저장 키를 사용한다.

입력은 기본형 프로젝트 `PC7cIyxQSWuZ0RsvBnyrfA` (원본 updatedAt 2026-10-12T11:28:51.870449), 확장형 `73t3V4I0QjmfUnXdw293jg` (2026-10-12T13:58:05.144318)의 `get_project_summary` / `get_furniture_layout`이다. 후자의 가구 치수는 편집기에서 배율이 적용된 값이다. 수집본은 데이터셋 `raw/archisketch/112A/*/detail-review-20261012T141111Z/`에 있다.

두 `아크로리버파크 112A_{기본형,확장형}_0.jpg`의 배치를 참고했다. 거실/침실은 밝은 원목, 현관/욕실/발코니는 회색 타일이며 문과 수납장은 중립색이다. 거실 동쪽 벽의 세로 방향 소파와 테이블, 주방 서쪽 4인 식탁, 침실 2 서쪽 창가 책상, 서쪽 헤드보드의 안방 킹 침대를 배치했다. 소파·테이블·의자·침대·책상 등 11개 이동 가구가 웹에서 편집된다. 기본형과 확장형의 C자 주방 깊이·반도형 아일랜드 위치는 각각 다르다. 욕실에는 원본 집기 치수와 위치를 참고한 욕조/샤워부스·세면대·변기, 드레스룸 양쪽과 현관에는 수납장을 배치했다.

| 현관 | 구획 폭 × 깊이 | 신발장 사이 통로 |
| --- | --- | --- |
| 기본형 | 1.982 × 1.727m | 약 1.527m |
| 확장형 | 1.923 × 1.762m | 약 1.139m |

현관 구획은 원본의 거실·복도 폴리곤 중 현관에 해당하는 부분에 타일을 덧댄 것이다. 복도 전체를 현관 면적으로 취급하거나 집을 축소하지 않았다. 가구 크기를 현장 실측으로 주장하지 않는다. 소파는 기존 제품 규격 2.79×1.17×0.73m, 킹 매트리스는 선택 규격 1.67×2.075m, 식탁 1.10×0.72m·책상 1.20×0.60m 등은 배치 설계값이다.

문은 이미지에서 보이는 경첩/개방 방향을 메타데이터와 웹에 반영했다. 현관은 외부로, 작은 방은 오른쪽 경첩에서 방 안으로 열린다. 2D에서도 회전 호를 표시한다. BLEND 문짝은 닫힌 상태로 저장하며 문짝 속성에 방향과 근거를 보존한다. 숨은 보조실 문의 방향은 잠정값이다.

### 원본 불일치 처리

- 확장형 최신 방 경계는 이전 버전과 다르다. 침실 2 경계 폭은 2.546m에서 2.426m로 변경된 저장본을 반영한다. 모델 전체를 비례 축소하지 않았다.
- 확장형 거실 폴리곤의 자기교차점 `(223, -5073)mm`을 정확한 선분 교차로 분리했다. 0.00096m² 조각은 비사용 영역으로 보존하고 주요 바닥 경계를 사용한다. 보정 전 좌표와 면적 차이는 명세의 `source_boundary_repairs`에 기록한다.
- 새 원본의 8–80mm 띠 모양 NONE 영역은 방 사이 벽으로 분류했다. 이를 독립 기둥처럼 남겨 문이 막히지 않도록 벽의 개구부 처리를 적용한다. 큰 비사용 공간은 그대로 유지한다. `structural_bands`에 원본 좌표와 분류 근거를 보존한다.
- 원본 일부 집기가 수정된 방 경계에 박혀 있어 치수 유지 후 이동했다. 확장형 침실 1의 1329mm 수납장은 현재 1212mm 벽감에 맞춘 약 1204mm 설계 폭으로 바꿨다. `model-info.json → detail_sources.fixture_adjustments`에 원본과 차이를 기록한다.
- 이미지의 식탁을 수용하기 위해 서쪽 주방의 하부 키큰장 열 전체를 복제하지 않고 위쪽 냉장고장과 식탁으로 구성했다. 주방 집기 자체는 사진 배치를 따르는 설계 모델이다.

검증: 최신 좌표·문 개구부·BLEND/GLB 왕복 검사 기본형 286 / 확장형 247건 통과. 상세 추가 전후 구조 메쉬 404개의 월드 정점/면 목록 동일. 집기 방 경계 이탈 없음(검증 허용 여유 15mm). 웹 단위 66/66, 브라우저 5개 시나리오와 빌드 통과. 실제 두 작은 방은 닫힌 문에 막히고 열면 통과한다. Linux headless Chromium/SwiftShader 검사이며 실기기 검증은 아니다. 원본 아키스케치 좌표를 옮긴 정확도이며 현장 실측 정확도를 의미하지 않는다.

재생성(저장된 원본 자료가 있는 작업공간에서):

```bash
uv run --offline --python 3.11 --with bpy==4.5.3 --with shapely==2.1.2 python tools/blender/prepare_112a_details.py --sources tools/blender/specs/acro112a-detail-sources-v2.json
uv run --offline --python 3.11 --with bpy==4.5.3 --with shapely==2.1.2 python tools/blender/finish_coordinate_homes.py --unit-type 112A --detail-sources tools/blender/specs/acro112a-detail-sources-v2.json --render
uv run --offline --python 3.11 --with bpy==4.5.3 --with shapely==2.1.2 python tools/blender/verify_acro168c_archisketch.py --unit-type 112A --revision v2
```

## 이전 실내 마감 갱신 (interiors-v1, 2026-10-12)

- 112A 기본형/확장형: 주방 아일랜드·싱크·조리대·후드·냉장고, 욕실 설비, 안방 킹 침대와 작은 방 책상·의자. 다른 작은 방은 빈 공간을 유지한다.
- 168C 기본형/확장형: VR을 참고한 짙은 주방 수납장과 아일랜드·냉장고, 욕실 샤워부스/욕조·세면대·변기, 드레스룸/복도 수납, 침실 3 붙박이장, 거실 링 조명. 작은 방의 이동 가구는 VR처럼 비워두었다.
- 공통: 제품 규격 소파 2.79×1.17×0.73m와 이동 가능한 테이블. 거실 석재/침실 원목/욕실 타일 마감, 중립색 창호와 문손잡이. 파란 검토용 문 마감을 교체했다.
- 원본 구조 메쉬 849개의 월드 정점·면 인덱스 목록이 생성 전후 동일하다. 바닥 다각형·개구부·천장 높이는 그대로다. `preservation.json`은 변경 목록과 집기별 경계 이탈을 기록한다. 네 평면 모두 구조 변경 0, 집기 방 경계 이탈 0이다.
- VR은 168C **확장형**의 시각 참고다. 기본형에는 같은 마감 방식을 배치에 맞게 적용했다. 사진에서 집기 실측을 추출했다고 주장하지 않는다. 소파 제품 규격과 선택한 침대 규격 외 집기 크기·가구 배치는 설계 가정이다. 재질은 생성/절차적 재질이며 VR 사진 자체를 표면에 투영한 모델이 아니다.
- 2D는 실제 벽 삼각형을 높이 1m에서 잘라 닫힌 윤곽을 채운다. 오목한 벽의 외접 사각형으로 방 전체를 덮지 않는다. 창·문짝과 고정 집기, 이동 가구도 표시한다.
- 여러 재질이 있는 GLB의 primitive를 원래 노드에 연결하며, 문손잡이는 문짝과 같은 경첩으로 움직인다. 이전 구조 모델과 실내 버전의 저장 배치 키를 분리한다.

실내 결과: `assets/models/acro-river-park/{112a,168c}/archisketch-interiors-v1/{basic,expanded}/` (`acro{unit}-{variant}.blend`, `.glb`, `model-info.json`, `preservation.json`, 렌더 PNG). 원본 구조 모델은 기존 폴더에 보존한다.

재생성: `uv run --offline --python 3.11 --with bpy==4.5.3 --with shapely==2.1.2 python tools/blender/finish_coordinate_homes.py --render`. 원본 구조 BLEND, 기존 가죽 소파 GLB와 `assets/materials/generated-v1` 재질이 필요하다.

## 현재 진입점

`http://127.0.0.1:5173/?studio=1`에서 A동을 선택한 뒤 평면을 고른다. 5185 서비스 첫 화면에도 같은 네 가지를 표시한다.

| 평면 | URL의 variant | 천장 아래면 |
| --- | --- | --- |
| 112A 기본형 | `112a-basic-archisketch` | 2.60m |
| 112A 확장형 | `112a-expanded-archisketch` | 2.60m |
| 168C 기본형 | `168c-basic-archisketch` | 2.50m |
| 168C 확장형 | `168c-expanded-archisketch` | 2.50m |

기존 `variant=basic`, `expanded`, `168c-basic`, `168c-expanded` 링크도 해당 최신 모델로 연결한다. 기본 선택은 112A 확장형이다. 좌표가 달라진 이전 가구 배치 저장값은 자동으로 적용하지 않는다. 최신 모델별로 저장 키를 분리한다.

구조 단계의 좌표를 유지하고 아일랜드·냉장고·욕실 집기·붙박이장과 마감을 추가했다. 고정 설비와 편집 가능한 가구를 구분한다. 웹의 기존 추천 컨셉 자동 배치는 이전 방 좌표를 사용하므로 현재 구조에서는 비활성화한다. 사용자가 가구를 추가하고 배치하는 기능은 유지한다.

## 수치 출처

112A 기본형은 프로젝트 `PC7cIyxQSWuZ0RsvBnyrfA`, 확장형은 `73t3V4I0QjmfUnXdw293jg`의 2026-10-12 MCP 요약을 사용했다. 168C의 현재 확장형 및 최초 기본형 보관본 출처와 해석은 [168C 구조 기록](acro168c-archisketch-structure.md)에 있다. 이름이 기본형이지만 내용이 확장형으로 바뀐 클라우드 프로젝트를 기본형 원본으로 사용하지 않았다.

각 명세의 `source_private_snapshot`, `source_summary_sha256`, `source_project_updated_at`에 원본 경로·해시·시각을 보존한다. 원본은 AisideProject의 `references/week-07/acro-river-park/archisketch/{112A,168C}/{basic,expanded}/modeling-source-*/project-summary.json`에 있다.

원본 방 다각형의 mm 좌표를 m로 변환하고 원점만 옮겼다. 면적을 맞추기 위한 전체 확대·축소나 방 모양의 직사각형 단순화는 하지 않았다. 웹 GLB도 스케일 `[1,1,1]`이다. 방 선택 시 표시하는 폭·깊이는 최대 경계 범위이며 안쪽 요철을 제외한 가구 배치 유효 직사각형을 뜻하지 않는다.

112A 침실 2의 새 경계 크기는 기본형 **2.504×2.594m**, 확장형 **2.546×3.015m**다. 이전 이미지 기반 모델의 2.458×2.593m, 약 2.458×3.08345m와 다르다. 이번 갱신에서는 아키스케치 좌표를 기준으로 삼고, 서로 다른 출처를 평균하거나 눈대중으로 맞추지 않았다. 등록 공급·전용면적은 별도 메타데이터이며 방 바닥 면적 합계로 대체하지 않는다.

## 확정 수치와 가정의 경계

- 방 경계와 문·창 중심 위치는 원본 좌표를 따른다. 이는 독립적으로 현장 실측한 수치라는 의미는 아니다.
- 112A 천장은 기존 선택 2.60m, 168C는 사용자 지정 2.50m를 유지한다. 원본 라이브러리 기본 천장고를 그대로 사용하지 않는다.
- 112A 문·창 폭은 원본 경계의 개구부 끝점으로 확인되는 구간을 우선 사용한다. 그렇지 않은 구간과 높이는 제품 카탈로그 규격이며 실제 설치 치수로 검증되지 않았다. 동일 위치·제품·방향의 중복 개구부 두 개는 기본형에서 한 번씩만 만든다.
- 168C 지정 문·창 규격은 기존 구조 기록을 따른다. 보류 개구부와 중복 창은 계속 별도 기록한다.
- 벽 중심선과 원본 벽 두께는 MCP 요약에 없으므로 방 사이 간격 및 외측 0.20m 띠로 추론한다. 경첩·개폐 방향, 창턱 높이와 창틀 여유 중 확인되지 않은 값도 가정이다.
- 112A 기본형의 좁은 창가 발코니 띠와 연결부는 형상을 보존한다. 기본 보행 몸체를 놓을 수 없는 세 영역은 단독 둘러보기 시작 지점에서 제외한다.

## 파일과 재생성

- 명세: `tools/blender/specs/acro{112a,168c}-{basic,expanded}-archisketch-v1.json`
- 결과: `assets/models/acro-river-park/{112a,168c}/archisketch-structure-v1/{basic,expanded}/`
- 각 결과: BLEND, GLB, `model-info.json`, `verification.json`, 상부·등각 렌더 PNG
- 112A 입력 변환: `tools/blender/prepare_acro112a_archisketch.py`
- 공통 생성·검증: 기존 168C 생성기에 `--unit-type 112A` 또는 `168C`를 지정한다.

```sh
uv run --offline --python 3.11 --with bpy==4.5.3 --with shapely==2.1.2 python tools/blender/build_acro168c_archisketch.py --unit-type 112A
uv run --offline --python 3.11 --with bpy==4.5.3 --with shapely==2.1.2 python tools/blender/verify_acro168c_archisketch.py --unit-type 112A
```

168C는 `--unit-type 168C`를 사용한다. 검증에는 명세에 기록된 비공개 원본 스냅샷이 필요하다. 원본 스냅샷은 공개 저장소에 포함하지 않는다.

저장 파일 검증은 112A 기본형 286개·확장형 245개, 168C 기본형 304개·확장형 282개를 통과했다. 방 다각형의 원본 일치, BLEND와 GLB의 경계·미터 단위, 개구부 규격을 검사한 결과이며 현장 치수 정확도 판정은 아니다.

이전 **구조 버전** 웹 검증: 관련 단위 검사 18/18, 실제 브라우저 검사 4/4, 뷰어·서비스 빌드 모두 통과했다. 네 모델 선택, 총 36개 방 진입, 문 충돌·개폐, 112A 표시 치수와 실제 GLB 경계, 빈 구조 배치, 168C 가구 추가·저장·복원, 서비스 링크와 미리보기를 확인했다. Linux headless Chromium/SwiftShader 결과이며 실기기 검증은 아니다. 새 캡처 8장·모델 해시·로그·verification.json은 AisideProject의 `realestate-spatial-ai/experiments/outputs/coordinate-models-20261012/`에 보관했다.

## 주차와 독립된 데이터셋 보관

2026-10-12 원본을 `AisideProject/datasets/acro-river-park/raw/`로 옮기고, 현재와 이전 모델·생성 명세·코드·검증 기록을 `releases/2026-10-12/`에 별도로 보관했다. 기존 week-07 원본 경로는 상대 심볼릭 링크로 유지한다. 웹은 저장소의 실행용 모델을 그대로 사용하며 데이터셋 보관본과 파일을 공유하지 않는다. 새 입력과 버전 보관 방법은 [데이터셋 안내](../../AisideProject/datasets/acro-river-park/README.md)를 따른다.

## 실내 버전 검증

뷰어 단위 60/60, 서비스 단위 20/20, 관련 브라우저 시나리오 5건 통과, 두 앱 빌드 통과. 실제 GLB 네 가지의 텍스처·가구·벽 윤곽, 총 36개 방 진입, 문 개폐·충돌, 가구 이동·저장·복원을 확인했다. 처음 검사한 168C 미니맵 전환은 소프트웨어 렌더러의 비동기 전환 대기 부족으로 1건 실패했고, 포인터 잠금 해제를 기다리도록 수정한 재검사에서 통과했다. 최종 재질 수정 후 네 모델 화면·텍스처·문손잡이 연결도 별도 통과했다. 기존 링크 검사 기대값도 현재 평면 키로 갱신했다.

기록: `AisideProject/realestate-spatial-ai/experiments/outputs/coordinate-interiors-20261012/`. Linux headless Chromium/SwiftShader 검증이며 실기기 성능 검증은 아니다. GLB는 모델당 약 9–10MB다.

새 보관본: `AisideProject/datasets/acro-river-park/releases/2026-10-12-interiors-v1/`. 원본과 이전 구조 버전 보관본은 유지한다.
