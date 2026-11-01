# 168C 확장형 구조 v2 — 주방·발코니 연결 보정

사용자가 제공한 평면도와 VR 미니맵을 대조해 팬트리의 출입 방향, 안방 발코니의 막힌 경계, 두 발코니 미닫이 창호 및 주방의 고정 수납 공간을 반영했다. 기존 v0·v1 산출물은 보존했다.

## 반영한 구조

- 주방 팬트리 문을 **서쪽(도면 왼쪽) 벽**으로 이동했다. 기존 북쪽 문 자리는 전체 높이 벽으로 채웠다. 일반 문짝 0.80×2.40m를 유지하며, 정확한 힌지 위치는 임시 배치다.
- 안방 발코니 남쪽의 어두운 띠를 천장까지 막힌 벽으로 구성했다. 거실로 바로 나갈 수 없고 **안방의 미닫이 창호**로 연결된다. 발코니 안쪽 부속 공간의 별도 여닫이문은 유지했다.
- **거실→거실 발코니** 역시 별도 고정 창짝과 이동 창짝을 가진 미닫이 구조로 바꿨다. 두 미닫이문은 열린 상태로 저장했다. 웹 상호작용은 아직 연결하지 않았다.
- 주방은 **서쪽 벽의 조리대·쿡탑·상부장·후드 → 남쪽 창 아래 싱크대**의 ㄱ자 구조로 표현했다. 팬트리 북쪽에는 냉장고·키큰장을, 거실 쪽에는 독립 아일랜드를 배치했다. 팬트리 옆 출입 통로는 비워 두었다.
- 고정 가구에는 `fixture_id`, `collision=true`, `furniture_placeable=false`, `dimension_status=unmeasured_placeholder`를 기록했다. GLB에도 이 속성이 보존된다. 실제 웹 배치 경고/충돌 연결은 이후 단계다.

## 확정값과 임시값

천장고 2.50m, 일반 문짝 0.80×2.40m 및 이전에 지정한 창 치수는 유지했다. 벽 배치의 기존 치수 보간과 기준선 해석도 바꾸지 않았다.

사진은 주방의 상대 배치와 방향을 확인하는 데 사용했다. **수납장 실측은 아직 없다.** 하부장 높이 0.90m, 아일랜드 높이 0.92m, 키큰장 높이 2.32m, 조리대 깊이 0.65m 등은 공간 검토용 초안값이다. 재질도 검정 계열 수납장·금속·석재의 단순 색 표현이며 사진 텍스처 복원이 아니다. 싱크 볼과 쿡탑은 위치 표시 수준의 단순 형상이다.

안방 미닫이 프레임 1.70×2.20m와 거실 미닫이 프레임 3.20×2.20m는 기존 임시값이다. 거실 창 2의 VR 3.1/3.2m 차이는 미해결이다. 창틀 폭을 사람·가구의 유효 통과 폭으로 단정하지 않는다. 발코니 남쪽 막힌 띠 두께는 도면의 픽셀 범위 해석이며 현장 실측이 아니다.

## 파일과 재현

- 좌표·출입구·주방 설정: `tools/blender/specs/acro168c-expanded-layout-v2.json`
- 생성기: `tools/blender/build_acro168c_structure.py`
- 고정 가구: `tools/blender/acro168c_structure_details.py`, `tools/blender/acro168c_kitchen.py`
- 결과: `assets/models/acro-river-park/168c/structural-v2/expanded/`
- 내부 비교 HTML: 인접 AisideProject의 `realestate-spatial-ai/experiments/outputs/acro168c-structural-v2/comparison.html`

```sh
uv run --offline --python 3.11 --with bpy==4.5.3 python tools/blender/build_acro168c_structure.py --layout tools/blender/specs/acro168c-expanded-layout-v2.json --output assets/models/acro-river-park/168c/structural-v2/expanded
uv run --offline --python 3.11 --with bpy==4.5.3 python tools/blender/verify_acro168c_structure.py --output assets/models/acro-river-park/168c/structural-v2/expanded
```

## 확인 범위

저장된 BLEND의 문·창·천장 치수, 팬트리 문 이동 및 기존 문 자리 차단, 발코니 남쪽 차단, 두 미닫이 창호의 열린 부분, 주방 가구와 X 공간·천장의 비중첩, 임시 주방 통로의 표본점을 검사했다. BLEND↔GLB에서 **299개 메쉬**, 단위·경계·분류·고정 가구 속성을 비교했고 총 **1048개 검사**를 통과했다. 최대 경계 차이는 약 **0.00000048m**다. 이전 두 버전 **29개 파일**의 해시도 그대로다.

이 검사는 파일의 구조와 단위 보존에 관한 것이다. 현장 실측 정확도, 사람 반경을 포함한 전체 보행·가구 반입 여유 또는 웹 동작을 검증한 결과는 아니다. 기존 112A 및 실행 중인 웹 앱은 수정하지 않았다.
