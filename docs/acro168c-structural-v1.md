# 168C 확장형 구조 보완 v1

2026-10-12 사용자 도면 피드백을 반영했다. `structural-v0` 결과 파일은 보존했으며 v1은 별도 폴더에 저장했다. 112A 및 웹 앱 소스는 변경하지 않았다.

## 반영한 구조

- **도면의 X 7곳:** 화장실 1 위, 복도 수납 좌우, 현관 위, 안방 욕실 옆, 주방·침실 3 사이, 주방 다용도실 모서리. 각각 폐쇄 볼륨으로 채우고 `occupiable=false`, `furniture_placeable=false`를 BLEND·GLB에 기록했다. 기둥·배관실 등 정확한 용도는 단정하지 않는다.
- **침실 2 앞 복도 팬트리·수납:** 양옆 X 구역과 분리하고 출입구·문짝·수납 선반을 추가했다. 주방 팬트리는 별도 공간으로 유지했다. 안으로 사람이 들어가는 실측 팬트리인지 수납장인지는 미확정이다.
- **화장실 1 샤워부스:** 서쪽 구역에 유리 고정판, 여닫이 유리문과 손잡이, 낮은 바닥 구획, 샤워 레일을 추가했다.
- **드레스룸 안쪽:** 기존 드레스룸 서쪽에 열린 통로와 L자 안쪽 구역을 만들고 얕은 선반을 배치했다. 이전의 막힌 벽을 개구부로 바꿨다.
- **안방 발코니:** 안방과 발코니 사이의 단일 고정 유리판을 두 패널의 슬라이딩 창호로 교체했다. 도면 위쪽 발코니 부속 구역으로 연결되는 여닫이문도 별도로 추가했다. 부속 구역의 정확한 용도는 미확정이다.

## 확인한 자료와 초안값

확장형 원본 평면도, 드레스룸·화장실 1·안방·복도 좌우·주방 팬트리 VR 캡처를 미니맵과 함께 비교했다. 참고 파일의 SHA256은 v1 명세의 `detail_evidence`에 기록했다. 원본 이미지는 공개 모델 텍스처에 포함하지 않았다.

기존 기준 치수와 천장고 2.50m, 일반 문짝 0.80×2.40m, 지정한 침실·거실 창 치수는 유지했다. 추가 구조의 위치는 도면을 읽은 초안이다. 선반 깊이/높이, 안쪽 통로 폭 1.10m, 샤워 유리문 0.70×2.10m 및 유리 구획 높이 2.12m는 **실측이 없는 가정값**이다. 샤워 유리문은 일반 실내문과 구분했다. 발코니 슬라이딩 창호는 기존 임시 외곽 1.70×2.20m를 유지했다. 현재 열린 패널 위치는 구조 검토용이며 유효 통행폭을 검증한 결과가 아니다.

## 파일과 재현

- 명세: `tools/blender/specs/acro168c-expanded-layout-v1.json`
- 결과: `assets/models/acro-river-park/168c/structural-v1/expanded/`
- 주요 파일: `acro168c-expanded-structure.blend`, `acro168c-expanded-structure.glb`, `top-view.png`, `isometric.png`
- 구조 정보: `excluded-zones.json`, `fixtures.json`, `openings.json`, `rooms.json`
- 검사: `geometry-checks.json`, `verification.json`

```sh
uv run --python 3.11 --with bpy==4.5.3 python tools/blender/build_acro168c_structure.py \
  --layout tools/blender/specs/acro168c-expanded-layout-v1.json \
  --output assets/models/acro-river-park/168c/structural-v1/expanded
uv run --python 3.11 --with bpy==4.5.3 python tools/blender/verify_acro168c_structure.py \
  --output assets/models/acro-river-park/168c/structural-v1/expanded
```

## 검증 결과와 범위

232개 구조·고정 설비 메쉬를 저장 후 다시 읽고 GLB에서도 위치·크기·분류를 비교했다. X 구역 7곳의 차단 형상과 사용 불가 속성, 복도 수납·샤워·발코니 출입구의 벽 제거, 드레스룸 안쪽으로 이어지는 표본 경로, 기존 지정 문·창·천장 치수를 검사했다. 모두 통과했으며 GLB 변환 최대 좌표 차이는 약 0.00000048m였다.

이 검사는 모델 구성과 저장·변환 일관성에 관한 것이다. 전체 보행 충돌, 문 회전 구간, 가구 반입 여유, 실제 현장 치수는 아직 검증하지 않았다. GLB는 생성했으나 기존 웹 서비스에 168C를 연결하거나 문 동작을 구현한 것은 아니다. X 흰색 표시는 BLEND 검토용 컬렉션에 있고, 차단 볼륨과 사용 불가 속성은 GLB에도 포함된다.
