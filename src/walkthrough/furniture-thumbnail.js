import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Render the selected model itself; geometry, materials and the walking renderer stay unchanged.
export function createFurnitureThumbnail() {
  let renderer, environment;
  return group => {
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
      renderer.setSize(480, 320);
      renderer.setPixelRatio(1);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      const room = new RoomEnvironment();
      const pmrem = new THREE.PMREMGenerator(renderer);
      environment = pmrem.fromScene(room);
      room.dispose(); pmrem.dispose();
    }
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#edf0e9');
    scene.environment = environment.texture;
    const model = group.clone(true);
    model.position.set(0, 0, 0);
    model.rotation.set(0, 0, 0);
    scene.add(model);
    model.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(model);
    if (bounds.isEmpty()) throw new Error('가구 모델의 경계가 없습니다.');
    const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z, .1);
    const camera = new THREE.PerspectiveCamera(35, 1.5, span / 100, span * 20);
    const radius = size.length() / 2;
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(35 / 2)) * 1.12;
    camera.position.copy(center).add(new THREE.Vector3(1, .72, 1.2).normalize().multiplyScalar(distance));
    camera.lookAt(center);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x7f8b76, 2));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.copy(center).add(new THREE.Vector3(span, span * 2, span));
    light.target.position.copy(center); scene.add(light, light.target);
    renderer.render(scene, camera);
    const image = renderer.domElement.toDataURL('image/png');
    scene.remove(model);
    return image;
  };
}
