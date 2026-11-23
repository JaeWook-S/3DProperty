# 도면 3D 모델 공통 채점기

도면 이미지로 만든 3D 모델(GLB)을 아키스케치 정답과 비교해 cm 단위로 채점한다.
1~4단계 실험, 각자 시험하는 개선 방법(CRITIC, Dream-RSI 등), 경쟁 서비스 결과를 모두 이 코드 하나로 채점해서 같은 표에 넣는다.
도면만 보는 검사기(예: stage4의 plan_check.py, Dream-RSI의 checks.json)는 각 방법의 일부라 서로 달라도 된다. **정답 기준 숫자만은 이 채점기로 낸다.**

## 파일

| 파일 | 역할 |
|---|---|
| `score_glb.py` | GLB 하나를 정답과 비교해 `score.json`, 벽별 CSV, 겹쳐 보기 그림을 만든다 |
| `summarize_scores.py` | 여러 `score.json`을 정해진 열의 표(마크다운, CSV)로 모은다 |
| `requirements.txt` | 필요한 Python 패키지 |
| `examples/168c_expanded_stage1.glb` | 설치 확인용 모델 (168C 확장형 1단계 결과) |
| `run_baseline.py`, `build_stage2_input.py`, `exp0_source_wall_audit.py` | 1~3단계 실행기와 보조 도구 (채점에는 필요 없음) |

## 준비

```bash
pip install -r tools/floorplan_eval/requirements.txt
```

정답 데이터는 공유한 `archisketch-floorplans10-20261120.zip`을 쓴다. 평형별 정답 파일은 `data/<평형>/mcp_get-floorplan-structure.json`이다.
다른 경로에 있는 같은 평형 파일(예: MCP를 다시 받은 파일)은 쓰지 않는다. 168C 확장형 정답 파일의 sha256은 `0089a162ef1a76a5bec1c66b170e8f533178cf43979fe118786bcd5dc41277e7`이다.

## 설치 확인

```bash
python tools/floorplan_eval/score_glb.py \
  --glb tools/floorplan_eval/examples/168c_expanded_stage1.glb \
  --gt <압축 푼 폴더>/data/168C_expanded/mcp_get-floorplan-structure.json \
  --out /tmp/score_check
python tools/floorplan_eval/summarize_scores.py /tmp/score_check
```

벽 F1@10cm 0.6459, Precision 0.7008, Recall 0.599, 벽 IoU 0.4342가 나오면 설치가 맞다.
embreex가 있으면 약 20초, 없으면 약 2분 걸리고, 숫자는 같다.

## 모델(GLB) 조건

- 단위는 m, glTF Y-up, 바닥 높이 0.
- 벽 메시는 노드 이름이 `wall`로 시작해야 한다(`wall_1`, `wall_2` ...). 이름이 다른 노드는 벽 채점에서 빠진다.
- 문과 창은 벽 메시에 실제로 뚫린 구멍을 잰다. 문짝 객체의 크기나 `elements.json`, 생성 코드의 수치는 쓰지 않는다.
- 좌표 원점과 방향은 자유다. 채점기가 정답에 맞춘다.
- 모델 크기가 정답과 6% 넘게 다르면 배율 맞춤이 잘 안 될 수 있다. 단위(m)부터 확인한다.
- 벽이 따로 나뉘지 않은 통짜 메시(스캔, 일부 경쟁 서비스 출력)는 지금 그대로는 채점할 수 없다. 벽만 분리해서 `wall_` 이름을 붙인 뒤 채점한다.

## 실행

```bash
python tools/floorplan_eval/score_glb.py --glb <model.glb> --gt <data/<평형>/mcp_get-floorplan-structure.json> --out <결과 폴더>
python tools/floorplan_eval/summarize_scores.py <결과 폴더1> <결과 폴더2> --label R0 --label A2 --csv table.csv
```

## 채점 방식

1. **정렬.** 위에서 본 벽 영역이 가장 많이 겹치도록 모델을 정답에 맞춘다. 두 가지로 한다.
   - 크기 고정: 회전과 이동만.
   - 배율 맞춤: 회전, 이동, 크기 배율. 맞춘 배율이 크기 오차다.
2. **벽 F1@τ (주 지표).** 정답 벽 중심선에서 2cm 간격으로 점을 찍고(문창 구간 제외), 모델 벽 영역의 골격선(1cm 격자)과 비교한다.
   Precision은 모델 중심선 중 정답에서 τ 안에 있는 비율, Recall은 정답 중심선 중 모델에서 τ 안에 있는 비율, F1은 둘의 조화평균이다. τ는 5, 10, 30cm이고 10cm를 주 지표로 쓴다.
3. **벽 IoU.** 위에서 본 벽 영역의 교집합 넓이를 합집합 넓이로 나눈 값. 벽 두께까지 반영된다.
4. **벽별 오차.** 정답 벽 중심선을 따라 수직으로 탐침을 쏴서 모델 벽의 중심 위치, 두께, 높이를 잰다. 벽마다 중앙값을 내고 전체 벽을 평균한다. 탐침의 절반 넘게 모델 벽을 못 만나면 빠진 벽으로 센다.
5. **문창.** 정답 벽을 따라 세로 단면을 잘라 구멍을 찾고 폭, 중심, 창대, 높이를 잰다. 정답에 없는 구멍은 "없는 문창"으로 센다.

## 보고 규칙

결과를 공유할 때는 `summarize_scores.py`의 표를 그대로 쓴다. 열은 아래와 같다.

| 열 | score.json 위치 | 구분 |
|---|---|---|
| 벽 F1@10cm, Precision, Recall | `scale_fitted.wall_f1.10cm` | 주 지표 |
| 벽 IoU | `scale_fitted.footprint.iou` | 보조 |
| 벽 중심, 두께, 높이 오차 (cm) | `scale_fitted.walls_all` | 보조 |
| 빠진 벽 / 채점 벽 | `scale_fitted.walls_all.missing`, `scored` | 보조 |
| 문창 검출, 없는 문창, 폭 오차, 중심 오차 | `scale_fitted.openings` | 보조 |
| 정답 대비 크기 (%) | `1 / alignment.scale_fitted.scale - 1` | 따로 보고 |
| 크기 고정 벽 F1@10cm | `rigid.wall_f1.10cm.f1` | 참고 |

지킬 것

- 평균 오차는 정답 전체를 기준으로 내고, 빠진 벽 수와 문창 검출 수를 함께 적는다. 두 모델에 공통으로 대응된 일부만 골라 평균하지 않는다. 그러면 벽이나 문을 빼먹은 모델이 더 좋아 보일 수 있다.
- 정답 파일은 고치지 않는다.
- 같은 조건을 여러 번 돌렸으면 회차별 행을 모두 남기고 평균을 따로 적는다.
- 채점기를 바꾸면 `scorer_version`을 올리고, 비교하는 결과를 모두 다시 채점한다.

## 알려진 정답 이상값

- **168C 확장형은 정답이 도면 인쇄 치수보다 약 4% 크게 등록돼 있다.** 도면을 완벽하게 따른 모델도 크기 고정 벽 F1@10cm는 0.46 근처가 상한이다. 그래서 배율 맞춘 벽 F1을 주 지표로 쓰고 크기 오차는 따로 적는다. 나머지 9개 평형은 1% 안팎에서 맞는다.
- 168C 확장형의 높이 230mm 벽 3개는 낮은 벽으로 따로 집계한다(벽별 오차에서 제외, 벽 F1에는 포함).
- 폭 5mm 문 1개는 제외하고, 같은 자리에 겹친 창 2개는 하나로 합쳐 정답 문창은 23개다.

## 채점하지 않는 것

- 문 열림 방향과 경첩 위치 (정답의 표현 방식을 아직 확인하지 못함)
- 가구, 마감

## 기준 결과 (168C 확장형, 각 1회, scorer v2-f1)

| 모델 | 벽 F1@10cm (P / R) | 벽 IoU | 벽 중심 오차 | 두께 오차 | 문창 검출 | 정답 대비 크기 |
|---|---|---|---|---|---|---|
| 1단계 (도면만) | 0.646 (0.701 / 0.599) | 0.434 | 13.3 cm | 10.6 cm | 23/23 | -3.3% |
| 3단계 (도면 + 파노라마) | 0.715 (0.762 / 0.673) | 0.520 | 7.7 cm | 3.9 cm | 20/23 | -3.5% |
| 4단계 CRITIC 최종 | 0.901 (0.941 / 0.865) | 0.645 | 7.8 cm | 13.0 cm | 23/23 | -4.2% |
| 2단계 (정답 수치 입력) | 1.000 (1.000 / 1.000) | 0.985 | 0.0 cm | 0.0 cm | 23/23 | 0.0% |
