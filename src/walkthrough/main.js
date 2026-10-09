import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { createDoors, collisionTree, combinedWorld } from './doors.js';
import { setupAppearance, refineMaterials, LIGHTING } from './appearance.js';
import { FinishLibrary, FINISHES } from './finishes.js';
import { VARIANTS } from './variants.js';
import { SPAWN, BODY_RADIUS, DEFAULT_EYE_HEIGHT, movementVector, moveWithCollisions, canStand, bodyAt } from './movement.js';
import { verticalFromHorizontal, horizontalFromVertical, screenHorizontalFov } from './view-calibration.js';
import './style.css';
import { stagingAssets } from './staging-assets.js';
import { createStudio } from './studio.js';
import { createMinimap } from './minimap.js';
// Phone/tablet walking (src/mobile). Imported last so its overrides follow the viewer styles.
import { TouchWalkControls } from '../mobile/touch-walk-controls.js';

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
let bodyRadius=BODY_RADIUS,horizontalFov=85;
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
  for (const id of ['start', 'eye', 'fov', 'body-width', 'reset', 'grid', 'quality', 'lighting', 'finish']) $(id).disabled = !ready || busy;
  if($('projection-mode').value==='screen')$('fov').disabled=true;
  $('variant').disabled = busy;
  $('living-view').disabled = !ready || busy || active?.key !== 'expanded';
  $('catalog-furniture').hidden = active?.key !== 'expanded';
}
function showError(error, stage) {
  console.error(error);
  ready = false; busy = false; setEnabled();
  // Name the cause on screen as well: a phone has no console to read it from.
  const cause = [stage, error?.message].filter(Boolean).join(' · ');
  $('status').textContent = `공간을 열지 못했습니다. 다른 평면을 선택하거나 새로고침해 주세요.${cause ? ` (원인: ${cause})` : ''}`;
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
  // iPhone Safari has no Pointer Lock API. unlock() runs before every load and on blur,
  // so make it a no-op there instead of throwing; walking then uses the touch controls.
  if (!document.exitPointerLock) controls.unlock = () => {};
  let needsRender = true, studio = null;
  const minimap = createMinimap();
  controls.addEventListener('change', () => { needsRender = true; });
  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault(); release();
    renderer.setAnimationLoop(null);
    showError(new Error('WebGL context lost. Reload to recover.'));
  });
  controls.pointerSpeed = 0.6;
  controls.minPolarAngle = 0.2;
  controls.maxPolarAngle = Math.PI - 0.2;
  // Touch walking: stick at bottom-left, drag elsewhere to look, tap or button for doors.
  const touch = new TouchWalkControls(camera, {
    surface: renderer.domElement, minPolarAngle: controls.minPolarAngle, maxPolarAngle: controls.maxPolarAngle,
    onTap: ({ x, y }) => interact(new THREE.Vector2(x, y)), onAction: () => interact(),
  });
  touch.addEventListener('change', () => { needsRender = true; });
  const walking = () => controls.isLocked || touch.isLocked;
  const release = () => { controls.unlock(); touch.unlock(); };
  // A touch (or a browser without Pointer Lock) walks with the on-screen controls; a mouse locks the pointer.
  const startWalking = () => (touch.preferred() || !renderer.domElement.requestPointerLock ? touch.lock() : controls.lock());
  const onLock = () => {
    keys.clear(); document.body.classList.add('walking'); $('pause').hidden = false;
    if (studio) requestAnimationFrame(resizeViewport);
  };
  const onUnlock = () => {
    keys.clear(); document.body.classList.remove('walking');
    $('pause').hidden = true; $('interaction').hidden = true;
    $('start').innerHTML = '이어서 둘러보기 <span>↗</span>';
    if (studio) requestAnimationFrame(resizeViewport);
  };
  for (const source of [controls, touch]) { source.addEventListener('lock', onLock); source.addEventListener('unlock', onUnlock); }
  document.addEventListener('pointerlockerror', () => toast('마우스 잠금에 실패했습니다. 잠시 후 다시 눌러 주세요.'));
  $('start').addEventListener('click', () => {
    if (!ready || busy) return;
    startWalking();
  });
  $('pause').addEventListener('click', release);
  document.addEventListener('keydown', (event) => {
    if (!walking() || busy) return;
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
    if (!canStand(active.world, next, eyeHeight, bodyRadius)) {
      toast('이 위치로 이동할 수 없어요. 시작 위치에서 거실로 걸어가 주세요.'); return;
    }
    keys.clear(); release();
    position.copy(next); camera.position.copy(next); camera.lookAt(9.05, eyeHeight, 7.52);
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
    const staging = stagingAssets(model, definition.info);
    const doors = createDoors(model, definition.doors);
    const staticTree = collisionTree(model, (object) => {
      let owner = object;
      while (owner) {
        if (owner.userData.doorId || owner.userData.collisionDisabled || owner.userData.stagingId) return false;
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
    const architectureWorld = combinedWorld(staticTree, doors);
    const world = { capsuleIntersect(body) {
      const a=architectureWorld.capsuleIntersect(body), b=staging.capsuleIntersect(body);
      return b && (!a || b.depth>a.depth) ? b : a;
    } };
    return { key, model, doors, pickMeshes, definition, meshCount, catalogFurniture, staging,
      world, doorById: new Map(doors.map((d) => [d.definition.id, d])) };
  }
  let loadSequence = 0;
  async function loadVariant(key) {
    const sequence = ++loadSequence;
    busy = true; keys.clear(); release(); setEnabled();
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
      if (!canStand(next.world, spawn, eyeHeight, bodyRadius)) throw new Error('Spawn intersects selected model');
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
      loadingStage = 'idle'; updateRoom(); updateURL(); studio?.onVariant();
    } catch (error) {
      if (sequence !== loadSequence) return;
      console.error(error);
      if (active) {
        $('variant').value = active.key;
        $('status').textContent = '선택한 평면을 불러오지 못해 이전 공간을 유지했어요. 다시 선택해 주세요.';
        document.body.dataset.loadState = 'ready';
      } else showError(error, loadingStage);
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
    const door = walking() && pickDoor();
    const label = door && `${door.definition.name} ${door.target >= 0.5 ? '닫기' : '열기'}`;
    $('interaction').hidden = !door;
    if (door) $('interaction').textContent = `E / 클릭 · ${label}`;
    touch.setAction(label);
  }
  renderer.domElement.addEventListener('pointerdown', (event) => {
    if (!ready || busy || event.button !== 0) return;
    if (studio && studio.mode !== 'tour') return;
    const rect = renderer.domElement.getBoundingClientRect();
    interact(controls.isLocked ? undefined : new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1));
  });
  $('eye').addEventListener('input', (event) => {
    const proposed = Number(event.target.value);
    if (!canStand(active.world, position, proposed, bodyRadius)) { event.target.value = String(eyeHeight); toast('머리 위 장애물 때문에 더 높일 수 없어요.'); return; }
    eyeHeight = proposed; position.y = eyeHeight;if(!studio||studio.mode==='tour')camera.position.copy(position); needsRender = true;
    $('eye-value').textContent = $('hud-eye').textContent = `${eyeHeight.toFixed(2)} m`;
    syncProjection();
  });
  $('fov').addEventListener('input', (event) => {
    horizontalFov=Number(event.target.value);syncProjection();
  });
  $('body-width').addEventListener('input',event=>{
    const proposed=Number(event.target.value)/200;
    if(!canStand(active.world,position,eyeHeight,proposed)){event.target.value=bodyRadius*200;toast('현재 위치에서는 이 몸체 폭이 주변 물체와 겹쳐요. 넓은 곳에서 바꿔 주세요.');return;}
    bodyRadius=proposed;$('body-width-value').textContent=`${Math.round(bodyRadius*200)} cm`;syncProjection();
  });
  function syncProjection(){
    const calibrated=$('projection-mode').value==='screen';$('screen-calibration').hidden=!calibrated;
    $('fov').disabled=calibrated||!ready||busy;
    let h=horizontalFov;
    if(calibrated){
      const width=Number($('display-width').value),distance=Number($('view-distance').value);
      if(width<10||width>200||distance<20||distance>200){$('perception-metrics').textContent='모니터 너비 10–200cm, 시청 거리 20–200cm 범위로 입력해 주세요.';return;}
      h=screenHorizontalFov(width,distance,$('viewport').getBoundingClientRect().width/window.screen.width);
    }
    const v=verticalFromHorizontal(h,camera.aspect);
    camera.fov=!studio||studio.mode==='tour'?v:60;camera.updateProjectionMatrix();
    $('fov').value=h;$('fov-value').textContent=`${h.toFixed(1)}°`;
    $('perception-metrics').textContent=`보행 시 가로 ${h.toFixed(1)}° / 세로 ${v.toFixed(1)}° · 몸체 폭 ${Math.round(bodyRadius*200)}cm · 머리 위 ${(eyeHeight+.12).toFixed(2)}m`;
    needsRender=true;
  }
  for(const id of ['projection-mode','display-width','view-distance'])$(id).addEventListener('input',syncProjection);
  $('reset').addEventListener('click', () => {
    keys.clear(); position.set(SPAWN.x, eyeHeight, SPAWN.z); camera.position.copy(position);
    camera.rotation.set(0, Math.PI, 0); needsRender = true;
  });
  function resizeViewport() {
    const rect=$('viewport').getBoundingClientRect();
    camera.aspect = rect.width / rect.height;syncProjection();
    appearance.resize(); needsRender = true;
  }
  window.addEventListener('resize', resizeViewport);
  new ResizeObserver(resizeViewport).observe($('viewport'));
  function enterRoom(room) {
    const [x1,z1,x2,z2]=room.bounds_m;
    const cx=(x1+x2)/2,cz=(z1+z2)/2,candidates=[];
    const margin=bodyRadius+.08;
    for(let z=z1+margin;z<z2-margin;z+=.12)for(let x=x1+margin;x<x2-margin;x+=.12)candidates.push(new THREE.Vector3(x,eyeHeight,z));
    candidates.sort((a,b)=>Math.hypot(a.x-cx,a.z-cz)-Math.hypot(b.x-cx,b.z-cz));
    const next=candidates.find(p=>canStand(active.world,p,eyeHeight,bodyRadius));if(!next)return false;
    keys.clear();position.copy(next);camera.position.copy(next);camera.lookAt(cx,eyeHeight,cz+.8);syncProjection();needsRender=true;updateRoom();
    startWalking();
    return true;
  }
  // Furniture can change while walking (concept themes): step out of anything that now
  // overlaps the body, preferring a spot in the same room so walls are never crossed.
  function settle() {
    if (!active || canStand(active.world, position, eyeHeight, bodyRadius)) return true;
    const here = active.definition.info.rooms.find(({ bounds_m: [x1, z1, x2, z2] }) => position.x > x1 && position.x < x2 && position.z > z1 && position.z < z2);
    const inRoom = (p) => !here || (p.x > here.bounds_m[0] && p.x < here.bounds_m[2] && p.z > here.bounds_m[1] && p.z < here.bounds_m[3]);
    for (const sameRoom of [true, false]) for (let r = 0.1; r <= 2.4; r += 0.1) for (let a = 0; a < 16; a++) {
      const p = new THREE.Vector3(position.x + Math.cos(a * Math.PI / 8) * r, eyeHeight, position.z + Math.sin(a * Math.PI / 8) * r);
      if ((sameRoom && !inRoom(p)) || !canStand(active.world, p, eyeHeight, bodyRadius)) continue;
      position.copy(p); camera.position.copy(p); needsRender = true; updateRoom();
      return true;
    }
    return false;
  }
  // Stand at a chosen viewpoint (e.g. a corner that shows the furniture); false if the body does not fit.
  function standAt(x, z, targetX, targetZ) {
    const next = new THREE.Vector3(x, eyeHeight, z);
    if (!active || !canStand(active.world, next, eyeHeight, bodyRadius)) return false;
    keys.clear(); position.copy(next); camera.position.copy(next); camera.lookAt(targetX, eyeHeight - 0.5, targetZ);
    needsRender = true; updateRoom();
    return true;
  }
  function updateRoom() {
    if (!active) return;
    const room = active.definition.info.rooms.find(({ bounds_m: [x1, z1, x2, z2] }) => position.x > x1 && position.x < x2 && position.z > z1 && position.z < z2);
    $('room').textContent = room?.name_ko ?? '복도 · 주방 연결 공간';
  }
  let previous = performance.now(), frame = 0;
  renderer.setAnimationLoop((now) => {
    const elapsed = Math.max((now - previous) / 1000, 0), dt = Math.min(elapsed, 0.05); previous = now;
    if (walking() && ready && !busy) {
      // The touch stick adds analog input (0 when idle); movementVector caps the sum at walking speed.
      const forward = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown')) + touch.forward;
      const right = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')) + touch.right;
      if (forward || right) {
        moveWithCollisions(active.world, position, movementVector(forward, right, camera.rotation.y, dt), eyeHeight, bodyRadius);
        camera.position.copy(position); needsRender = true;
      }
    }
    if (active && !busy) for (const door of active.doors) {
      const result = door.update(Math.min(elapsed, 0.25), bodyAt(position, eyeHeight, bodyRadius));
      if (result.changed) { appearance.invalidateShadows(); needsRender = true; }
      if (result.blocked) toast('문이 몸에 닿아 멈췄어요. 조금 물러나 다시 여닫아 주세요.');
    }
    minimap.update({active,position,yaw:camera.rotation.y,horizontalFov:horizontalFromVertical(camera.fov,camera.aspect),
      visible:ready&&!busy&&(studio?studio.mode==='tour':walking())});
    if (++frame % 6 === 0) { updateRoom(); updateInteraction(); }
    if (needsRender && active) { appearance.render(dt); needsRender = false; }
  });
  if (import.meta.env.DEV && params.has('test')) {
    window.__walkthrough = {
      getState: () => ({ position: position.toArray(), eyeHeight, fov: camera.fov,horizontalFov:horizontalFromVertical(camera.fov,camera.aspect),bodyRadius,headTop:eyeHeight+.12,pitch:camera.rotation.x,
        scale: active?.model.scale.toArray(), meshCount: active?.meshCount, locked: controls.isLocked,
        touchWalking: touch.isLocked, touchInput: [touch.forward, touch.right], yaw: camera.rotation.y,
        standing: active ? canStand(active.world, position, eyeHeight, bodyRadius) : false,
        loadingStage, variant: active?.key, finish: active?.model.userData.finish, lighting: appearance.lighting,
        quality: appearance.quality, resolution: appearance.resolution,
        doors: active?.doors.map((d) => d.getState()), triangles: renderer.info.render.triangles,
        visibleVariants: scene.children.filter((o) => o.userData.variant).length }),
      inspectFurniture: () => {
        const items = [];
        active?.model?.traverse((object) => {
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
      move: (dx, dz) => { moveWithCollisions(active.world, position, new THREE.Vector3(dx, 0, dz), eyeHeight, bodyRadius); camera.position.copy(position); needsRender = true; },
      look: (yaw) => { camera.rotation.set(0, yaw, 0); needsRender = true; },
      place: (x, z, targetX, targetZ) => {
        const next = new THREE.Vector3(x, eyeHeight, z);
        if (!canStand(active.world, next, eyeHeight, bodyRadius)) throw new Error('Test position intersects geometry');
        position.copy(next); camera.position.copy(next); camera.lookAt(targetX, 1.1, targetZ); needsRender = true;
      },
      pickDoor: () => pickDoor()?.definition.id, interact: () => interact(),
    };
  }
  await loadVariant(selected.variant);
  if (params.has('studio') && active) {
    studio=createStudio({scene,camera,renderer,getActive:()=>active,loadVariant,resize:resizeViewport,
      invalidate:()=>{appearance.invalidateShadows();needsRender=true;},enterRoom,unlock:()=>{keys.clear();release();},
      settle,standAt,resume:()=>{if(ready&&!busy&&!walking())startWalking();}});
    if(import.meta.env.DEV&&params.has('test'))window.__studio=studio;
  }
}
boot().catch(showError);
