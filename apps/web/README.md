# Cortex 서비스 웹

기존 5173 공간 뷰어를 재사용하는 독립 서비스 앱. 공간 선택과 로컬 가구 결과 JSON 확인을 구현했다. 배치/추론/서버 저장은 아직 연결하지 않았다.

```bash
npm ci
npm run dev       # 127.0.0.1:5185
npm test
npm run build
npm run test:browser   # 기존 5173 뷰어 실행 필요
```

5185와 5173을 브라우저 기기에 포트 전달한다. 뷰어 주소 기본값은 같은 hostname의 5173이며 `.env.example`을 참고해 `VITE_VIEWER_BASE_URL`로 바꿀 수 있다. 5174/5175는 기존 다른 서비스가 사용 중이어서 사용하지 않는다.

구현 범위, 출처, S1/S2 요청과 검증 기록: [웹 연동 문서](../../docs/web-integration.md).


실제 S2 미정 결과를 포함해 검사하려면 `CORTEX_FURNITURE_ASSET=/절대경로/asset.json npm run test:browser`로 실행한다. 이 변수는 비공개 sofa2 결과 파일을 읽는 **검사 전용**이며, 생략하면 해당 한 검사를 skip한다. 기본 서비스는 계속 사용자가 선택한 로컬 JSON을 읽는다. 기하 처리 성공과 가구 치수 성공은 별도 상태로 표시하며, 치수 미정/실패는 단위 변환과 배치 규격 사용을 막는다.
