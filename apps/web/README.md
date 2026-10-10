# Cortex 서비스 웹

기존 서비스 시작 화면이다. 공간 선택·3D 뷰어 열기, 로컬 가구 JSON 확인, **이미지 등록 → SAM3/MoGe-3 측정 → 치수 표시**를 제공한다. 생성된 새 3D 가구의 배치는 아직 포함하지 않는다.

```bash
npm ci
npm run dev       # 127.0.0.1:5185
npm test
npm run build
npm run test:browser   # 기존 5173 뷰어 실행 필요
```

웹 시작 주소는 `http://127.0.0.1:5185/`다. 루트에서 `bash start.sh`로 웹·3D를 함께 실행할 수 있다. GPU 서버 API가 준비돼 있으면 터널과 측정을 연결하고, 없으면 모델 측정 없이 웹 기능을 유지한다. **내 가구 확인 → 가구 등록**에서 이미지를 선택한다. 전체 실행 순서는 [가구 측정 실행 안내](../../services/furniture_pipeline/README.md)를 따른다.

측정 API는 기본 `http://127.0.0.1:8000`으로 프록시된다. 루트 또는 앱의 `.env`에 `FURNITURE_API_TARGET`을 지정하면 해당 주소를 사용한다. 기존 JSON 파일 선택은 서버 전송 없이 브라우저에서 확인한다.

5185와 5173을 브라우저 기기에 포트 전달한다. 뷰어 주소 기본값은 같은 hostname의 5173이며 `.env.example`을 참고해 `VITE_VIEWER_BASE_URL`로 바꿀 수 있다. 5174/5175는 기존 다른 서비스가 사용 중이어서 사용하지 않는다.

구현 범위, 출처, S1/S2 요청과 검증 기록: [웹 연동 문서](../../docs/web-integration.md).


실제 S2 미정 결과를 포함해 검사하려면 `CORTEX_FURNITURE_ASSET=/절대경로/asset.json npm run test:browser`로 실행한다. 이 변수는 비공개 sofa2 결과 파일을 읽는 **검사 전용**이며, 생략하면 해당 한 검사를 skip한다. 기본 서비스는 계속 사용자가 선택한 로컬 JSON을 읽는다. 기하 처리 성공과 가구 치수 성공은 별도 상태로 표시하며, 치수 미정/실패는 단위 변환과 배치 규격 사용을 막는다.
