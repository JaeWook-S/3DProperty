# 168C 확장형 — VR 참고 마감과 웹 연결

2026-10-12. 기존 `structural-v2`의 벽·문·창·고정 수납장 치수를 유지하면서 마감 버전을 별도로 만들고, 112A와 같은 웹 뷰어에 연결했다.

## 화면에서 열기

기존 스튜디오에서 새로고침한 뒤 **평면 선택**에서 다음을 고른다.

- 112A · 확장형 (`expanded`)
- 112A · 기본형 (`basic`)
- 168C · 확장형 (`168c-expanded`)

5173 포트를 그대로 전달했다면 `http://127.0.0.1:5173/?studio=1&variant=168c-expanded`로 바로 열 수 있다. SSH에서 다른 로컬 포트를 사용한다면 주소의 포트만 바꾼다. 5185 서비스의 주택 선택에도 168C를 추가했고, 둘러보기·스튜디오 링크와 미리보기 이미지가 선택을 따른다. 168C 기본형은 아직 생성하지 않았다.

168C의 방 목록·다각형 평면·카메라·미니맵·조명·진입 위치를 별도 메타데이터로 연결했다. 기존 112A 좌표에 맞춰 축소하지 않는다. 원래 눈높이 1.60m, 몸체 반경 0.22m, 보행 속도 1.20m/s를 사용하며 설정 UI에서 눈높이와 몸체 폭·시야각을 바꿀 수 있다.

## 재질과 조명

사용자가 제공한 `naver/vr/168C/screenshots/expanded/`의 미니맵·시선 방향을 참고했다.

- 거실·복도: 밝은 석재 바닥, 얇은 타일 줄눈과 석재 계열 벽.
- 침실·드레스룸: 나무 바닥. 침실 2·3은 따뜻한 회색 벽.
- 주방: 짙은 회색 수납장, 석재 상판, 금속 냉장고·후드.
- 창호: 투명 유리와 밝은 프레임. 천장: 따뜻한 조명과 거실 간접조명 표현.

사진의 색·재료와 상대 배치를 참고한 **1차 마감 해석**이다. VR에서 텍스처나 3D 표면을 추출한 결과는 아니다. 프로젝트에 이미 있던 생성형 oak/limestone 이미지와 PBR 재질을 사용했으며, 두 이미지는 BLEND 안에 패킹하고 GLB에도 포함했다. 원본 VR 캡처는 모델·웹에 포함하지 않았다. 실사진과 같은 반사·노출·외부 조망은 아직 재현하지 않았다. 조명 형상·위치와 마감 줄눈은 미측정 초안이다.

## 상호작용

내보낸 실제 문 메쉬를 사용하는 어댑터로 여닫이문 11개와 발코니 미닫이문 2개를 연결했다. 주방 팬트리의 왼쪽 출입 방향, 안방 발코니의 거실 쪽 막힌 벽, 각각의 미닫이 출입구는 v2 구조를 따른다. 문이 닫히면 보행을 막고, 열리면 충돌 형상도 같이 이동한다. 창틀의 낮은 문턱은 현재 단층 보행 방식에 맞춰 처리한다.

꾸미기에서는 공용 수동 가구를 추가·이동하고 평면별 배치를 저장할 수 있다. 기존 112A 방 이름과 좌표에 의존하는 자동 추천 콘셉트는 168C에서 숨긴다. 112A의 발코니 외부 랜딩 예시도 168C에서는 숨긴다. 공용 창밖 사진은 실제 168C의 동·층·방향을 검증한 조망이 아니다.

## 파일

- 모델: `assets/models/acro-river-park/168c/finishes-v1/expanded/acro168c-expanded.blend`
- 웹: 같은 폴더의 `acro168c-expanded.glb`, `web-info.json`, `web-doors.json`
- 재질 생성기: `tools/blender/finish_acro168c.py`
- 단위·저장 파일 검사: `tools/blender/verify_acro168c_structure.py`
- 브라우저 검사: `tests/acro168c.browser.js`
- 웹·Mac 캡처와 검사 로그: 인접 AisideProject의 `realestate-spatial-ai/experiments/outputs/acro168c-finishes-v1/`

Mac Blender에는 `/Users/geonu/Downloads/Cortex-168C/acro168c-expanded-finishes-v1-9298779fa1.blend`를 열었다. 전송 후 서버 파일과 SHA256이 일치했다. 원본 v2는 별도로 보존했고, 열기 직전 장면도 `Cortex-168C/backups/`에 복사했다.

## 재현

```sh
uv run --offline --python 3.11 --with bpy==4.5.3 python tools/blender/finish_acro168c.py
uv run --offline --python 3.11 --with bpy==4.5.3 python tools/blender/verify_acro168c_structure.py --output assets/models/acro-river-park/168c/finishes-v1/expanded --stem acro168c-expanded
PLAYWRIGHT_BROWSERS_PATH=/tmp/cortex-playwright FONTCONFIG_FILE=/tmp/cortex-fonts.conf npx playwright test tests/acro168c.browser.js tests/studio.browser.js tests/walkthrough.browser.js tests/minimap.browser.js
```

첫 명령은 서버의 이전 구조 v2 파일을 입력으로 사용한다. `--skip-render`로 설명용 PNG 생성만 생략할 수 있다. Playwright 경로는 이 서버 환경의 캐시·글꼴 설정이며 다른 환경에서는 해당 환경의 설치 경로를 사용한다.

## 검증과 남은 범위

- 뷰어 단위 검사 56개와 서비스 단위 검사 20개 통과. 두 앱 빌드 통과(기존 500kB 이상 JS 청크 경고 유지).
- 기존 구조 299개 메쉬의 전역 경계 유지, 바닥 마감 높이 z=0 유지.
- 저장 BLEND의 지정 치수와 GLB 재가져오기 비교 **1,037개 검사 통과**. 336개 메쉬 비교의 최대 경계 차이는 약 0.00000048m.
- 168C의 거실·주방·침실·욕실·팬트리·발코니 등 11곳 진입, 112A 두 타입과 왕복 전환, 168C 가구 저장·복원, 휴대폰 크기 화면 검사 통과.
- 실제 이동으로 팬트리 여닫이문과 두 발코니 미닫이문의 닫힘 차단·열림 통과 검사 통과. 처음 검사에서 문짝 내부로 순간이동하는 좌표를 사용한 것은 삼각형 표면 충돌의 검증에 적합하지 않아 실제 보행 검사로 바꿨다.
- 기존 스튜디오·워크스루·미니맵 회귀 검사까지 총 11개 브라우저 시나리오 통과(10개 초기 통과 + 수정한 문 검사 1개 재실행 통과). Linux Chromium/SwiftShader이며 실제 iPhone·Mac Safari 성능 검증은 아니다.
- 기준 치수 보존은 현장 실측 정확도의 인증이 아니다. 미측정 주방장 깊이, 일부 창호 규격, 치수선 기준의 미해결점은 [구조 v2 기록](acro168c-structural-v2.md)을 따른다. 168C용 추천 배치, 실제 조망, 세부 재질 튜닝은 후속 작업이다.
