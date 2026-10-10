import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadGeneratedModel } from './generated-furniture.js';

export function previewGeneratedFurniture(host, asset) {
  let disposed = false, renderer, controls, observer;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#eff3eb');
  const camera = new THREE.PerspectiveCamera(40, 1, 0.001, 1000);
  const message = document.createElement('p');
  message.textContent = '테스트 GLB를 불러오는 중…';
  host.append(message);
  host.dataset.state = 'loading';
  const dispose = () => { disposed = true; observer?.disconnect(); controls?.dispose(); renderer?.dispose(); };
  (async () => {
    try {
      const model = await loadGeneratedModel(asset);
      if (disposed) return;
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.setAttribute('aria-label', '치수를 적용한 테스트 테이블 3D 미리보기');
      host.prepend(renderer.domElement);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enablePan = false;
      scene.add(model, new THREE.HemisphereLight(0xffffff, 0x6a6a56, 2));
      const light = new THREE.DirectionalLight(0xffffff, 3);
      light.position.set(3, 5, 4); scene.add(light);
      const { width, depth, height } = asset.dimensions_m;
      const span = Math.max(width, depth, height);
      controls.target.set(0, height / 2, 0);
      camera.position.set(span * 1.9, height / 2 + span * 1.4, span * 2.2);
      controls.minDistance = span * 0.6; controls.maxDistance = span * 8;
      const render = () => { if (!disposed) renderer.render(scene, camera); };
      controls.addEventListener('change', render);
      const resize = () => {
        const w = host.clientWidth;
        if (disposed || w <= 0) return;
        renderer.setSize(w, 240, false); camera.aspect = w / 240; camera.updateProjectionMatrix();
        controls.update(); render();
      };
      observer = new ResizeObserver(resize); observer.observe(host); resize();
      message.textContent = '고정 테스트 테이블 · 사진 재현/GPT 결과 아님 · 드래그 회전/휠 확대';
      host.dataset.state = 'ready';
    } catch (error) {
      if (!disposed) { message.textContent = error.message; host.dataset.state = 'error'; }
    }
  })();
  return dispose;
}
