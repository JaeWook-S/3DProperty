# Cortex — 3D Remodeling GUI

`3DProperty` 레포지토리 안에 위치하지만 기존 패키지와는 분리된 정적 웹 UI 프로토타입입니다. 순수 HTML/CSS/JavaScript로 작성되어 루트 `package.json`, Three.js 뷰어, `apps/web`을 호출하거나 수정하지 않으며 다른 패키지 설치 없이 독립 실행할 수 있습니다.

## 로컬 실행

```bash
cd 3DProperty_GUI
python3 -m http.server 5186
```

브라우저에서 `http://localhost:5186` 주소를 엽니다. 5186을 사용하므로 기존 3D 뷰어(5173), `apps/web`(5185)과 동시에 실행할 수 있습니다.

## 주요 파일

- `index.html`: 시작 화면과 목록 A–D 페이지 구조
- `styles.css`: 반응형 디자인과 브랜드 색상 변수
- `app.js`: 페이지 전환, 파일 선택 표시, 가구 썸네일/링크 추가
- `image.png`: 제공된 3D 공간 참고 이미지
- `favicon.svg`: 브라우저 탭에 표시되는 Cortex 아이콘

## 브랜드 색상 변경

`styles.css` 상단의 세 변수만 수정하면 됩니다.

```css
--cortex-brown: #7f5539;
--cortex-sand: #e6ccb2;
--cortex-clay: #ddb892;
```

## 추후 3D 뷰어 연결에 필요한 파일

Blender에서는 가능하면 `.glb` 한 파일로 전달하는 방식을 권장합니다. `.gltf`를 쓰는 경우에는 다음을 같이 준비해야 합니다.

- `scene.gltf`
- `scene.bin`
- `textures/` 폴더 전체

웹 로드를 위해 메시는 glTF 2.0, 텍스처는 PNG/JPG 기반을 권장합니다. 압축을 적용하면 연결 단계에서 해당 Three.js 디코더가 필요합니다.

## 현재 범위

Three.js 렌더링, Blender 변환, `3DProperty` 호출, 서버 저장은 의도적으로 포함하지 않았습니다. 화면의 3D 파일 선택은 연결 위치를 확인하기 위한 UI이며 파일을 해석하거나 렌더링하지 않습니다.
