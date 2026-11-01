# 서비스 개선 — S1 검토 및 통합 기록

2026-10-23. 새 코드와 자료는 geonwoo 작업공간 안에 보관한다. 기존 S2는 재질·가구 후보, S3는 서비스·지도·웹 통합, S4는 서비스 비교·실제 단지 데이터, S1은 실내 구조·치수·모델 및 dataset을 담당한다.

## 치수 원본

현재 벽 간격과 공간 구조의 1차 자료는 **검토한 아키스케치 좌표·배치 치수**다. 네이버·호갱노노의 이미지 비율이나 등록 면적에 맞춰 집을 확대·축소하지 않는다. VR은 가구·마감·연결부를 확인하는 시각 자료다. 해당 세대의 실측 또는 공식 치수 도면이 실제 확보되면 대응되는 부분만 비교해서 갱신한다.

기존 방 경계와 GLB 바닥의 대조 오차는 최대 0.000000779m였다. 이는 원본→모델 전환 일치이며 현장 실측 정확도 판정이 아니다. 실제 발견한 문제는 문·창 배치 치수보다 주변 폴리곤 꼭짓점을 우선했던 추정 방식이다. 112A 기본형 창 1개, 112A 확장형 문 1개, 168C 확장형 창·미닫이 2개를 별도 metric-v1 후보에서 보정했다. 방·가구 크기, 천장 높이, 보행 몸체는 유지했다.

- [치수 보정 내용](../../coordinate-models.md)
- [클릭해서 확인하는 독립 도면 검토 파일](../../../runtime/service-readiness/2026-10-23/dimension-review.html)
- [검토 화면](../../../runtime/service-readiness/2026-10-23/dimension-review.png)
- [최종 후보·협업 상태](../../../../AisideProject/realestate-spatial-ai/docs/session-handoffs/service-readiness-20261023/metric-candidates.json)

도면 검토 파일은 외부 연결 없이 열린다. 방 안을 누르면 선택 지점을 지나는 가로·세로 간격을 표시한다. 168C 확장형 침실 2의 최대 폭 2.744m와 좁은 부분 2.310m를 구분한다. 가구를 제외한 방 경계 기준이며 실제 통행 여유는 별도다.

최신 112A 기본형 저장본의 집 외부 추가 욕실은 자동 수입하지 않는다. 최신 168C 기본형 프로젝트는 확장형과 동일한 내용으로 바뀌어 있어 검토된 이전 기본형을 유지한다. 기존 자료를 다시 제출할 필요는 없다.

## 구체적으로 구현한 것

| 범위 | 실제 결과 | 확인되지 않은 범위 |
| --- | --- | --- |
| 지도 서비스 | S3 지도→단지투어→동·층→2D/3D, 초기 지도 GLB 0, 실내 진입 후 로드 | 실제 호수·타입 대응, 실기기 FPS, 공개 배포 |
| 치수 보정 | 세 BLEND·GLB 후보, 네 개구부 폭 교정, 독립 형상·재질·벽 검증 | 세 모델 웹 활성화 및 2D 출처 정렬 완료; 실제 4모델·마감 검사 4/4 통과 |
| 가구 품질 | CC0 라운지 의자 실제 웹 렌더, 2.696MB, 원형 크기/재질 보존, 지연 로더 | 스테이징 UI 연결은 S3 후속; 제품 실측 규격 아님 |
| 재질 변환 | S2 PNG→표면 JSON→Blender→GLB CPU 연결 및 검증 | SuperMat 모델 추론은 실행하지 않음 |

[서비스 지도 검증](../../../runtime/service-map/2026-10-23/verification.json), [단지부터 시작하는 경로 검증](../../../runtime/service-map/2026-10-23/site-first/verification.json), [CC0 의자 실제 웹 검증](../../../runtime/service-readiness/2026-10-23/chair-web-verification.json).

의자 원본은 [Poly Haven Modern Arm Chair 01](https://polyhaven.com/a/modern_arm_chair_01), CC0다. [출처·해시·모델 치수](../../../assets/furniture/cc0/modern-arm-chair-01/manifest.json)를 보존했다. 폭 0.820m·깊이 0.987m·높이 1.023m는 파일의 형상 크기이며 제조사 실측으로 주장하지 않는다. 크기를 줄여 식탁 의자로 대체하지 않는다.

## 사용자 확인 사항과 남은 통합

사용자가 할 일은 [USER-ACTIONS](../../../../AisideProject/realestate-spatial-ai/docs/session-handoffs/service-readiness-20261023/USER-ACTIONS.md) 하나로 관리한다. 목적·필요한 이유·정확한 행동을 함께 기록했다. SuperMat은 H200 사전 승인, 실제 동호수 대응은 해당 화면이나 공식 배치 근거가 필요하다. 이미 제공한 도면과 사진은 재요청하지 않는다.

최종 browser 통과 후 활성 모델을 전환했으며 dataset을 `2026-10-23-metric-v1`로 정렬했다. 보관 파일 892개·기존 경로 링크 24개·현재 모델 네 가지 검증을 통과했다. 현재 후보 검증과 실제 활성화는 구분하며 이전 release는 보존한다. 이 작업에서 H200·유료 API·커밋·푸시·배포는 수행하지 않았다.

최종 활성화 근거: [검증 보고서](../../../runtime/interior/2026-10-23-metric-activation/verification.json). 실제 제공되는 GLB·metadata SHA 및 빌드 GLB 네 개가 일치한다.
