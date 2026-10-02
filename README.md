# 3DProperty

사진·평면도와 치수 정보를 활용한 편집 가능한 3D 공간 모델링 프로젝트입니다.

## 팀 작업과 화면 구성

| 경로 | 현재 역할 | 실행 |
| --- | --- | --- |
| `3DProperty_GUI/` | 재욱의 새 서비스 UI 프로토타입. 3D 렌더러는 아직 연결 전 | 해당 폴더에서 `python3 -m http.server 5186` |
| `src/walkthrough/` | Three.js 공간 탐색·2D/3D 가구 편집 | 루트에서 `npm ci`, `npm run dev`; 5173의 `?studio=1` |
| `apps/web/` | 기존 공간 선택·가구 JSON 검증 앱, 스튜디오 링크 포함 | 해당 폴더에서 `npm ci`, `npm run dev`; 5185 |
| `assets/` | 공유 GLB·Blender 모델·텍스처·치수 근거 | 코드에서 상대 경로로 참조 |
| `tools/blender/` | 모델 수정·내보내기 재현 스크립트 | 각 스크립트의 실행 안내 참고 |

현재 세 화면은 자동으로 통합된 상태가 아닙니다. 이후에는 `3DProperty_GUI`를 제품 UI로 발전시키고, `src/walkthrough`의 렌더링·배치 기능과 `apps/web/src/furniture.js`의 결과 검증을 재사용하는 구성을 권장합니다. 화면마다 모델·배치 상태를 복사하지 말고, 하나의 자산 ID·미터 단위 위치·회전 상태를 공유하도록 연결합니다. 실제 통합과 기존 앱 정리는 별도 PR에서 진행합니다.

협업은 다음 순서를 권장합니다.

1. `main`은 팀원이 실행할 수 있는 통합 버전으로 유지합니다.
2. 작업 시작 시 최신 `origin/main`에서 `feat/<작업명>` 브랜치를 만듭니다. 미커밋 작업이 있는 폴더에서는 먼저 커밋하거나 별도 worktree를 사용합니다.
3. 자기 변경을 커밋하고 브랜치를 push한 뒤 PR로 합칩니다. PR에는 실행 방법, 검증 결과, 화면 캡처, 아직 연결하지 않은 기능을 적습니다.
4. `package.json`, 모델 메타데이터, 공통 JSON 규약처럼 여러 기능이 쓰는 파일은 PR에서 변경 영향을 함께 확인합니다. 공유 `main`에는 force push를 사용하지 않습니다.
5. 치수 근거가 달라지는 모델은 새 버전 폴더로 보관합니다. `node_modules`, 빌드 산출물, Blender 백업, 학습 가중치, 개인 자료는 커밋하지 않습니다.

로컬 Git 작성자는 본인 이름과 GitHub에 연결된 이메일을 사용합니다. 이 작업의 작성자는 `gxonu <kgw8803@gmail.com>`입니다. SSH/GitHub CLI 로그인 계정은 작성자 정보와 별개입니다.

## 웹 개발 시작하기

### 단지 → 세대 → 방 선택 및 인테리어 편집

`http://localhost:5173/?studio=1`에서 시작합니다. 예시 동 A → 112A 기본형/확장형 → 방 선택 → 둘러보기 또는 인테리어로 이동합니다. 실제 단지 배치·동호수 자료는 아직 연결하지 않았고 외관은 흐름을 보여주는 예시입니다. 서비스 앱(5185)의 ‘단지에서 시작 · 공간 꾸미기’ 링크에서도 열 수 있습니다.

인테리어 화면 왼쪽은 미터 좌표의 2D 평면, 오른쪽은 같은 상태를 사용하는 실시간 3D입니다. 소파·스툴·침대를 드래그/수치 이동하고 추가·회전·삭제할 수 있습니다. 벽/고정 집기/다른 가구와의 평면 겹침을 검사합니다. 조작 종료 후 보행 충돌 메시를 갱신합니다. 배치는 기본형/확장형별로 현재 브라우저에 저장·불러오기하며, 서버 저장이나 Blender로 편집 결과 역전송은 아직 없습니다. 1인칭 이동은 PC 키보드·마우스 기준입니다. 화장실 집기는 고정된 예시 형상입니다.

웹의 현재 모델은 `dimensioned-v2`입니다. 천장고 2.6m는 [ACRO 공식 안내](https://www.acro.co.kr/Posm_main.action?commonMap.CD_BIZ_LND=010366) 기준입니다. 문 개구부 높이 2.1m는 이번 모델의 설계 가정이며 실제 단지 문 규격으로 검증하지 않았습니다. [한샘 도어 카탈로그](https://image2.hanssem.com/event/doc/catalog/Hanssem_Door_2601.pdf)는 제품별로 제작 높이 범위를 안내하며 모든 문에 단일 높이가 적용되는 것은 아닙니다.

안방 매트리스는 킹 1670×2075mm([ACE K 규격](https://www.acebed.com/product/bed/mattress/view.do?detailsKey=24)), 작은 방 두 개는 선택한 싱글 규격 1000×2000mm입니다. 프레임·매트리스 두께·쿠션 형상은 예시입니다. 이전 17개 도면 치수 구간과 확장부 추정 범위는 유지합니다. 생성은 `uv run --python 3.11 --with bpy==4.5.3 python tools/blender/update_metric_revision.py`이며 결과와 검사 기록은 `assets/models/acro-river-park/112a/dimensioned-v2/`에 있습니다. `expanded/acro112a-expanded-staged.blend`에는 기존 소파·스툴도 들어 있습니다. v1은 당시 결과로 보존합니다.

Node.js 20.19 이상이 필요합니다. Blender나 MCP 없이 포함된 GLB로 실행할 수 있습니다.

```bash
git clone https://github.com/JaeWook-S/3DProperty.git
cd 3DProperty
npm ci
npm run dev
```

별도 터미널에서 서비스 화면도 실행합니다.

```bash
cd 3DProperty/apps/web
npm ci
npm run dev
```

- 서비스 화면: http://localhost:5185 — 공간 선택과 가구 JSON 확인. 웹 틀은 `apps/web/src/main.js`, `style.css`에서 이어 개발합니다.
- 공간 뷰어: http://localhost:5173 — Three.js 이동·문 상호작용·마감·조명. 코드는 `src/walkthrough/`에 있습니다.
- 거실 배치: http://localhost:5173/?variant=expanded&view=living — 확장형 거실에 상품 규격 소파·스툴을 고정 배치했습니다.

두 화면은 직접 링크로 연결됩니다. 스튜디오의 가구 드래그 배치는 구현했으며, 앱의 치수 추정 JSON에서 뷰어로 가구 전송, 추론 API와 서버 저장은 아직 구현하지 않았습니다. 주소 설정은 `apps/web/.env.example`, 인터페이스와 후속 작업은 [웹 연동 문서](docs/web-integration.md)를 참고하세요.

각 앱 폴더에서 `npm test`와 `npm run build`로 확인합니다. 브라우저 검사는 `npx playwright install chromium` 후 `npm run test:browser`로 실행합니다. 서비스 앱 브라우저 검사에는 5173 뷰어도 필요합니다. 비공개 S2 자료가 필요한 검사는 해당 환경 변수가 없으면 skip됩니다.

## 포함된 가구

`assets/furniture/catalog-sofa2790-stool980-v1/`에 개별 GLB, 거실 배치 GLB와 치수 manifest가 있습니다. 소파는 2790×1170×730mm, 스툴은 980×700×400mm입니다. 상품 이미지 표기 치수를 사용했으며 독립 실측은 아닙니다. 미표기 세부 형태는 근사했고 소파 높이 980mm 조절 상태는 구현하지 않았습니다.

## 웹 공간 체험 (PC)

기본형·확장형을 선택해 실제 미터 스케일로 불러와 1인칭으로 걸어볼 수 있습니다. 눈높이·시야각 조절, 벽·가구 충돌, 가까운 문 여닫기(E/클릭), 접촉 그림자를 적용했습니다. 낮·해질녘·밤 조명과 원본·오크·석재 마감, 울트라 화질을 선택할 수 있습니다.

```bash
npm ci
npm run dev
```

http://localhost:5173 에서 **공간에 들어가기** → WASD 이동·마우스 시선·Esc 해제. 서버 접속 방법, 설정 근거와 검증 범위는 [공간 체험 안내](docs/walkthrough.md)를 참고하세요.

## 현재 공유 모델

최신 편집용 파일은 [기본형 v2](assets/models/acro-river-park/112a/dimensioned-v2/basic/acro112a-basic.blend), [확장형 v2 + 소파·스툴](assets/models/acro-river-park/112a/dimensioned-v2/expanded/acro112a-expanded-staged.blend)이며, [치수 검증 기록](assets/models/acro-river-park/112a/dimensioned-v2/verification.json)을 함께 제공합니다. 아래 v1 자료는 이전 도면 보정과 미리보기 기록입니다.

**[아크로리버파크 112A · 기본형/확장형 · dimensioned-v1](assets/models/acro-river-park/112a/dimensioned-v1/README.md)**

치수 기반 Blender 파일 두 개와 조감도, 치수 도면, CSV, 검증 기록을 공유합니다. 원하는 `.blend` 파일을 내려받아 Blender에서 열면 됩니다. 텍스처는 파일에 포함되어 있습니다.

| 기본형 | 확장형 |
| --- | --- |
| ![기본형 조감도](assets/models/acro-river-park/112a/dimensioned-v1/basic/overview.png) | ![확장형 조감도](assets/models/acro-river-park/112a/dimensioned-v1/expanded/overview.png) |

## 폴더 구조

```text
assets/
  furniture/             # 규격 기반 가구와 거실 배치 GLB
  materials/             # 웹용 마감 텍스처
  models/
    acro-river-park/
      112a/
        dimensioned-v1/
          README.md
          manifest.json
          calibration.json
          comparison.json
          basic/       # 기본형 모델·미리보기·치수·검증
          expanded/    # 확장형 모델·미리보기·치수·검증
src/
  walkthrough/          # 미터 기반 PC 1인칭 웹 체험
apps/
  web/                  # 공간 선택·가구 결과 확인 서비스 화면
tests/                  # 이동·충돌·브라우저 검증
docs/
  repository-structure.md
  walkthrough.md        # 실행·조작·치수 기준
```

자세한 추가·수정 기준은 [레포 구조 안내](docs/repository-structure.md)를 참고하세요. 실제 건물 실측 정확도와 미표기 높이 등은 각 모델 README의 범위를 확인해야 합니다.
