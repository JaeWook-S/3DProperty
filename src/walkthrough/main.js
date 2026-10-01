import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { createDoors, collisionTree, combinedWorld } from './doors.js';
import { setupAppearance, refineMaterials, LIGHTING } from './appearance.js';
import { FinishLibrary, FINISHES } from './finishes.js';
import { VARIANTS } from './variants.js';
import { SPAWN, DEFAULT_EYE_HEIGHT, movementVector, moveWithCollisions, canStand, bodyAt } from './movement.js';
import './style.css';

const $ = (id) => document.getElementById(id);
const keys = new Set();
const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
const params = new URLSearchParams(location.search);
const catalogFurnitureURL = new URL('../../assets/furniture/catalog-sofa2790-stool980-v1/living-furniture.glb', import.meta.url).href;
const selected = {
  variant: Object.hasOwn(VARIANTS, params.get('variant')) ? params.get('variant') : 'expanded',
  lighting: Object.hasOwn(LIGHTING, params.get('lighting')) ? params.get('lighting') : 'day',
  finish: Object.hasOwn(FINISHES, params.get('finish')) ? params.get('finish') : 'original',
  quality: ['light', 'high', 'ultra'].includes(params.get('quality')) ? params.get('quality') : 'high',
};
let eyeHeight = DEFAULT_EYE_HEIGHT, active = null, ready = false, busy = false, toastTimer;
const position = new THREE.Vector3(SPAWN.x, eyeHeight, SPAWN.z);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.04, 80);
camera.rotation.order = 'YXZ';
camera.position.copy(position);
camera.rotation.set(0, Math.PI, 0);

function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}
function updateURL() {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(selected)) url.searchParams.set(key, value);
  history.replaceState(null, '', url);
}
function setEnabled() {
  for (const id of ['start', 'eye', 'fov', 'reset', 'grid', 'quality', 'lighting', 'finish']) $(id).disabled = !ready || busy;
  $('variant').disabled = busy;
  $('living-view').disabled = !ready || busy || active?.key !== 'expanded';
  $('catalog-furniture').hidden = active?.key !== 'expanded';
}
function showError(error) {
  console.error(error);
  ready = false; busy = false; setEnabled();
  $('status').textContent = '공간을 열지 못했습니다. 다른 평면을 선택하거나 새로고침해 주세요.';
  $('start').textContent = '불러오기 실패';
  document.body.dataset.loadState = 'error';
}

async function boot() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  $('viewport').appendChild(renderer.domElement);
  const controls = new PointerLockControls(camera, renderer.domElement);
  let needsRender = true;
  controls.addEventListener('change', () => { needsRender = true; });
  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault(); controls.unlock();
    renderer.setAnimationLoop(null);
    showError(new Error('WebGL context lost. Reload to recover.'));
  });
  controls.pointerSpeed = 0.6;
  controls.minPolarAngle = 0.2;
  controls.maxPolarAngle = Math.PI - 0.2;
  controls.addEventListener('lock', () => {
    keys.clear(); document.body.classList.add('walking'); $('pause').hidden = false;
  });
  controls.addEventListener('unlock', () => {
    keys.clear(); document.body.classList.remove('walking');
    $('pause').hidden = true; $('interaction').hidden = true;
    $('start').innerHTML = '이어서 둘러보기 <span>↗</span>';
  });
  document.addEventListener('pointerlockerror', () => toast('마우스 잠금에 실패했습니다. 잠시 후 다시 눌러 주세요.'));
  $('start').addEventListener('click', () => {
    if (!ready || busy) return;
    if (!renderer.domElement.requestPointerLock || matchMedia('(pointer: coarse)').matches) {
      toast('이동은 키보드와 마우스를 사용하는 PC에서 이용해 주세요.'); return;
    }
    controls.lock();
  });
  $('pause').addEventListener('click', () => controls.unlock());
  document.addEventListener('keydown', (event) => {
    if (!controls.isLocked || busy) return;
    if (event.code === 'KeyE' && !event.repeat) { event.preventDefault(); interact(); return; }
    if (!movementKeys.has(event.code)) return;
    event.preventDefault(); keys.add(event.code);
  });
  document.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => { keys.clear(); controls.unlock(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { keys.clear(); controls.unlock(); } });

  const appearance = setupAppearance(renderer, scene, camera);
  appearance.setQuality(selected.quality); appearance.setLighting(selected.lighting);
  const finishes = new FinishLibrary(renderer);
  for (const [key, value] of Object.entries(selected)) $(key).value = value;
  $('quality').addEventListener('change', (event) => {
    selected.quality = event.target.value; appearance.setQuality(selected.quality); needsRender = true; updateURL();
  });
  $('lighting').addEventListener('change', (event) => {
    selected.lighting = event.target.value; appearance.setLighting(selected.lighting); needsRender = true; updateURL();
  });
  $('finish').addEventListener('change', async (event) => {
    const requested = event.target.value;
    busy = true; keys.clear(); setEnabled();
    document.body.dataset.finishState = 'loading';
    $('status').textContent = '선택한 마감을 적용하는 중…';
    try {
      await finishes.apply(active.model, requested);
      selected.finish = requested; needsRender = true; updateURL();
      $('status').textContent = '마감이 적용됐어요. 공간 치수는 그대로입니다.';
      document.body.dataset.finishState = 'ready';
    } catch (error) {
      console.error(error); $('finish').value = selected.finish;
      $('status').textContent = '재질을 불러오지 못해 이전 마감을 유지했어요. 다시 선택해 주세요.';
      document.body.dataset.finishState = 'error';
    } finally { busy = false; setEnabled(); }
  });

  const grid = new THREE.GridHelper(24, 24, 0x365447, 0x739078);
  grid.position.set(6, 0.027, 5); grid.material.transparent = true; grid.material.opacity = 0.65; grid.visible = false;
  scene.add(grid);
  $('grid').addEventListener('click', () => {
    grid.visible = !grid.visible; needsRender = true;
    $('grid').setAttribute('aria-pressed', String(grid.visible));
  });

  // Cache at most these two models; a failed load never replaces the active world.
  const cache = new Map();
  let loadingStage = 'idle';
  function showLivingFurniture() {
    if (active?.key !== 'expanded') return;
    const next = new THREE.Vector3(6.35, eyeHeight, 6.4);
    if (!canStand(active.world, next, eyeHeight)) {
      toast('이 위치로 이동할 수 없어요. 시작 위치에서 거실로 걸어가 주세요.'); return;
    }
    keys.clear(); controls.unlock();
    position.copy(next); camera.position.copy(next); camera.lookAt(9.05, 0.55, 7.52);
    needsRender = true; updateRoom();
    const url = new URL(location.href); url.searchParams.set('view', 'living'); history.replaceState(null, '', url);
  }
  $('living-view').addEventListener('click', showLivingFurniture);
  async function prepareVariant(key) {
    const definition = VARIANTS[key];
    loadingStage = `fetch:${key}`;
    const gltf = await new GLTFLoader().loadAsync(definition.url);
    loadingStage = `prepare:${key}`;
    const model = gltf.scene;
    model.userData.variant = key;
    let catalogFurniture = null;
    if (key === 'expanded') {
      loadingStage = 'furniture:expanded';
      const furniture = await new GLTFLoader().loadAsync(catalogFurnitureURL);
      catalogFurniture = furniture.scene;
      catalogFurniture.name = 'Catalog living furniture';
      // Exported world coordinates are already in glTF meters/Y-up.
      // Add before collision and picking preparation so furniture blocks walking.
      model.add(catalogFurniture);
    }
    model.updateMatrixWorld(true);
    let meshCount = 0;
    model.traverse((object) => {
      if (!object.isMesh) return;
      meshCount++;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      object.castShadow = !materials.some((m) => m.transmission > 0 || m.transparent);
      object.receiveShadow = true;
    });
    refineMaterials(model, renderer);
    const doors = createDoors(model, definition.doors);
    const staticTree = collisionTree(model, (object) => {
      let owner = object;
      while (owner) {
        if (owner.userData.doorId || owner.userData.collisionDisabled) return false;
        owner = owner.parent;
      }
      let source = object;
      while (source && !source.userData.object_id) source = source.parent;
      const info = definition.info.objects[source?.userData.object_id];
      if (['Lighting', 'Ceilings', 'Reference'].includes(info?.category)) return false;
      if (info?.category === 'Doors_Windows' && /rail|sill cap/.test(info.name)) {
        if (new THREE.Box3().setFromObject(object).max.y < 0.1) return false;
      }
      return true;
    });
    const pickMeshes = [];
    model.traverse((object) => {
      if (!object.isMesh) return;
      let parent = object;
      while (parent) { if (!parent.visible) return; parent = parent.parent; }
      pickMeshes.push(object);
    });
    return { key, model, doors, pickMeshes, definition, meshCount, catalogFurniture,
      world: combinedWorld(staticTree, doors), doorById: new Map(doors.map((d) => [d.definition.id, d])) };
  }
  let loadSequence = 0;
  async function loadVariant(key) {
    const sequence = ++loadSequence;
    busy = true; keys.clear(); controls.unlock(); setEnabled();
    document.body.dataset.loadState = 'loading';
    $('status').textContent = `${VARIANTS[key].label} 공간을 불러오는 중…`;
    try {
      if (!cache.has(key)) cache.set(key, prepareVariant(key).catch((error) => { cache.delete(key); throw error; }));
      const next = await cache.get(key);
      if (sequence !== loadSequence) return;
      loadingStage = `finish:${key}`;
      await finishes.apply(next.model, selected.finish);
      loadingStage = `activate:${key}`;
      if (sequence !== loadSequence) return;
      for (const door of next.doors) { door.setProgress(0); door.target = 0; }
      const spawn = new THREE.Vector3(SPAWN.x, eyeHeight, SPAWN.z);
      if (!canStand(next.world, spawn, eyeHeight)) throw new Error('Spawn intersects selected model');
      if (active) scene.remove(active.model);
      active = next; selected.variant = key;
      scene.add(active.model); appearance.invalidateShadows();
      position.copy(spawn); camera.position.copy(position); camera.rotation.set(0, Math.PI, 0);
      if (params.get('view') === 'living' && key === 'expanded') showLivingFurniture();
      ready = true; needsRender = true;
      $('variant').value = key;
      $('project-variant').textContent = `112A · ${VARIANTS[key].label}`;
      const bedroom = active.definition.info.rooms.find((r) => r.id === 'Bedroom center');
      $('reference-size').textContent = `가운데 침실 기준 ${bedroom.width_m.toFixed(3)} × ${bedroom.depth_m.toFixed(3)} m`;
      $('variant-note').textContent = VARIANTS[key].note;
      $('start').innerHTML = '공간에 들어가기 <span>↗</span>';
      $('status').textContent = key === 'expanded'
        ? '거실에 표기 치수로 만든 소파와 스툴을 배치했어요.'
        : '문 가까이에서 E 또는 클릭으로 여닫을 수 있어요';
      document.body.dataset.loadState = 'ready'; document.body.dataset.finishState = 'ready';
      loadingStage = 'idle'; updateRoom(); updateURL();
    } catch (error) {
      if (sequence !== loadSequence) return;
      console.error(error);
      if (active) {
        $('variant').value = active.key;
        $('status').textContent = '선택한 평면을 불러오지 못해 이전 공간을 유지했어요. 다시 선택해 주세요.';
        document.body.dataset.loadState = 'ready';
      } else showError(error);
    } finally {
      if (sequence === loadSequence) { busy = false; setEnabled(); }
    }
  }
  $('variant').addEventListener('change', (event) => loadVariant(event.target.value));

  const raycaster = new THREE.Raycaster(); raycaster.far = 2.2;
  function pickDoor(pointer = new THREE.Vector2()) {
    if (!active || busy) return;
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(active.pickMeshes, false)[0];
    let object = hit?.object;
    while (object && !object.userData.doorId) object = object.parent;
    return active.doorById.get(object?.userData.doorId);
  }
  function interact(pointer) { const door = pickDoor(pointer); if (door) { door.toggle(); updateInteraction(); } }
  function updateInteraction() {
    const door = controls.isLocked && pickDoor();
    $('interaction').hidden = !door;
    if (door) $('interaction').textContent = `E / 클릭 · ${door.definition.name} ${door.target >= 0.5 ? '닫기' : '열기'}`;
  }
  renderer.domElement.addEventListener('pointerdown', (event) => {
    if (!ready || busy || event.button !== 0) return;
    const rect = renderer.domElement.getBoundingClientRect();
    interact(controls.isLocked ? undefined : new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1));
  });
  $('eye').addEventListener('input', (event) => {
    const proposed = Number(event.target.value);
    if (!canStand(active.world, position, proposed)) { event.target.value = String(eyeHeight); toast('머리 위 장애물 때문에 더 높일 수 없어요.'); return; }
    eyeHeight = proposed; position.y = eyeHeight; camera.position.copy(position); needsRender = true;
    $('eye-value').textContent = $('hud-eye').textContent = `${eyeHeight.toFixed(2)} m`;
  });
  $('fov').addEventListener('input', (event) => {
    camera.fov = Number(event.target.value); camera.updateProjectionMatrix(); needsRender = true;
    $('fov-value').textContent = `${camera.fov}°`;
  });
  $('reset').addEventListener('click', () => {
    keys.clear(); position.set(SPAWN.x, eyeHeight, SPAWN.z); camera.position.copy(position);
    camera.rotation.set(0, Math.PI, 0); needsRender = true;
  });
  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    appearance.resize(); needsRender = true;
  });
  function updateRoom() {
    if (!active) return;
    const room = active.definition.info.rooms.find(({ bounds_m: [x1, z1, x2, z2] }) => position.x > x1 && position.x < x2 && position.z > z1 && position.z < z2);
    $('room').textContent = room?.name_ko ?? '복도 · 주방 연결 공간';
  }
  let previous = performance.now(), frame = 0;
  renderer.setAnimationLoop((now) => {
    const elapsed = Math.max((now - previous) / 1000, 0), dt = Math.min(elapsed, 0.05); previous = now;
    if (controls.isLocked && ready && !busy) {
      const forward = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
      const right = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
      if (forward || right) {
        moveWithCollisions(active.world, position, movementVector(forward, right, camera.rotation.y, dt), eyeHeight);
        camera.position.copy(position); needsRender = true;
      }
    }
    if (active && !busy) for (const door of active.doors) {
      const result = door.update(Math.min(elapsed, 0.25), bodyAt(position, eyeHeight));
      if (result.changed) { appearance.invalidateShadows(); needsRender = true; }
      if (result.blocked) toast('문이 몸에 닿아 멈췄어요. 조금 물러나 다시 여닫아 주세요.');
    }
    if (++frame % 6 === 0) { updateRoom(); updateInteraction(); }
    if (needsRender && active) { appearance.render(dt); needsRender = false; }
  });
  if (import.meta.env.DEV && params.has('test')) {
    window.__walkthrough = {
      getState: () => ({ position: position.toArray(), eyeHeight, fov: camera.fov,
        scale: active?.model.scale.toArray(), meshCount: active?.meshCount, locked: controls.isLocked,
        standing: active ? canStand(active.world, position, eyeHeight) : false,
        loadingStage, variant: active?.key, finish: active?.model.userData.finish, lighting: appearance.lighting,
        quality: appearance.quality, resolution: appearance.resolution,
        doors: active?.doors.map((d) => d.getState()), triangles: renderer.info.render.triangles,
        visibleVariants: scene.children.filter((o) => o.userData.variant).length }),
      inspectFurniture: () => {
        const items = [];
        active?.catalogFurniture?.traverse((object) => {
          if (!object.userData.asset_id) return;
          const bounds = new THREE.Box3().setFromObject(object);
          items.push({ asset_id: object.userData.asset_id, basis: object.userData.dimension_basis,
            sizeWorld: bounds.getSize(new THREE.Vector3()).toArray(),
            min: bounds.min.toArray(), max: bounds.max.toArray(), scale: object.scale.toArray() });
        });
        return items;
      },
      textureInfo: () => {
        const found = new Map();
        active.model.traverse((object) => {
          if (!object.isMesh) return;
          for (const m of Array.isArray(object.material) ? object.material : [object.material]) {
            if (m.map?.name.startsWith('generated-')) found.set(m.map.name, { name: m.map.name, width: m.map.image.width, height: m.map.image.height });
          }
        });
        return [...found.values()];
      },
      inspectRoom: (id) => {
        const info = active.definition.info;
        const room = info.rooms.find((item) => item.id === id);
        const [objectId] = Object.entries(info.objects).find(([, o]) => o.name === room.floor_object);
        let object; active.model.traverse((item) => { if (item.userData.object_id === objectId) object = item; });
        return new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3()).toArray();
      },
      move: (dx, dz) => { moveWithCollisions(active.world, position, new THREE.Vector3(dx, 0, dz), eyeHeight); camera.position.copy(position); needsRender = true; },
      look: (yaw) => { camera.rotation.set(0, yaw, 0); needsRender = true; },
      place: (x, z, targetX, targetZ) => {
        const next = new THREE.Vector3(x, eyeHeight, z);
        if (!canStand(active.world, next, eyeHeight)) throw new Error('Test position intersects geometry');
        position.copy(next); camera.position.copy(next); camera.lookAt(targetX, 1.1, targetZ); needsRender = true;
      },
      pickDoor: () => pickDoor()?.definition.id, interact: () => interact(),
    };
  }
  await loadVariant(selected.variant);
}
boot().catch(showError);
