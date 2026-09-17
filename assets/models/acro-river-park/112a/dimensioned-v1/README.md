# 아크로리버파크 112A · 치수 기반 v1

2026-09-15 생성한 기본형·확장형의 최신 치수 기반 모델입니다. Blender 4.5.3 LTS에서 생성하고 저장 파일을 다시 열어 검사했습니다. 기존의 가정 스케일 모델과 구분하기 위해 `dimensioned-v1`으로 보관합니다.

| 자료 | 기본형 | 확장형 |
| --- | --- | --- |
| Blender 파일 | [acro112a-basic.blend](basic/acro112a-basic.blend) | [acro112a-expanded.blend](expanded/acro112a-expanded.blend) |
| 조감도 | [보기](basic/overview.png) | [보기](expanded/overview.png) |
| 치수 도면 | [SVG](basic/dimensioned-plan.svg) | [SVG](expanded/dimensioned-plan.svg) |
| 구간별 치수 | [CSV](basic/room-dimensions.csv) | [CSV](expanded/room-dimensions.csv) |
| 저장 파일 검증 | [JSON](basic/saved-file-check.json) | [JSON](expanded/saved-file-check.json) |

## 열기

GitHub 파일 화면에서 다운로드하거나 레포를 clone한 뒤 Blender의 `File → Open`으로 원하는 `.blend`를 엽니다. 기본형과 확장형은 서로 독립된 파일입니다. MCP·SSH 연결 없이 볼 수 있고 재질 텍스처 12장이 파일에 포함되어 있습니다.

Material Preview가 기본 설정입니다. 실제 조명·반사는 3D 화면에서 `Z → Rendered`로 확인합니다. 천장은 내부를 보기 편하게 뷰포트에서 숨겼으며, `Ceilings` 컬렉션의 오브젝트 숨김을 해제하면 다시 표시됩니다. 저장 모델의 벽은 전체 높이이며, 조감도 이미지만 천장을 숨기고 벽을 낮춰 렌더했습니다.

## 치수 기준과 범위

기본형 도면의 가로 8개·세로 9개, 총 17개 치수 구간을 고정하고 창호 폭을 반영했습니다. 예를 들어 가운데 침실 내부는 기본형 기준 2458×2593mm, 안방 깊이는 3623mm, 거실 전면 창 폭은 2957mm입니다. 나머지 좌표는 도면 비율을 보간했습니다. [calibration.json](calibration.json)에 채택한 치수와 원본 픽셀 끝점이 있습니다.

높이 2700mm, 문 높이 2150mm와 대부분의 문 폭·창 높이는 가정값입니다. 가구·재질·조명은 스테이징입니다. 실제 건물과의 실측 오차는 검증하지 않았습니다. 치수 CSV의 면적은 개별 직사각형 구간이며 합계를 전용면적으로 해석하면 안 됩니다.

확장형은 기본형의 치수와 별도의 무치수 확장형 이미지를 결합한 구성안입니다. 작은 침실 앞의 좁은 실내 발코니, 거실·주방·드레스룸 발코니를 편입했습니다. 개방형 발코니와 안방 앞 발코니는 별도 공간으로 유지했습니다. 확장 참고 이미지에서 생략된 서쪽 개방형 발코니 외곽은 기본형 기준으로 보존했으므로 추가 확인이 필요합니다. 실제 확장 시공 상태나 구조체 철거 가능 여부를 검증한 모델은 아닙니다.

[comparison.json](comparison.json)은 일부 구간의 변화량, [manifest.json](manifest.json)은 모델 버전·크기·SHA-256을 기록합니다. 저장 파일의 전체 벽 높이·텍스처 내장·창호 폭을 다시 읽어 확인한 기록도 각 버전에 포함했습니다.
