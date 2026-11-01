import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { bindArchisketchModel } from '../walkthrough/archisketch-model.js';
import { batchStaticMeshes } from '../walkthrough/static-batches.js';
import { UNIT_MODEL_URL, UNIT_SOURCE } from './fixture.js';

// The source stays shared and unchanged. Only an explicit context request starts
// this fetch; failed requests are evicted so a later request can retry.
let unitSourcePromise = null;
let modelFetches = 0;
function loadUnitSource() {
  if (!unitSourcePromise) {
    modelFetches++;
    unitSourcePromise = (async () => {
      const response = await fetch(UNIT_MODEL_URL, { redirect: 'error' });
      if (!response.ok) throw new Error('세대 모델을 불러오지 못했습니다. 다시 시도해 주세요.');
      const buffer = await response.arrayBuffer();
      const gltf = await new GLTFLoader().parseAsync(buffer, '');
      bindArchisketchModel(gltf, { objects: {} });
      return gltf.scene;
    })().catch(error => { unitSourcePromise = null; throw error; });
  }
  return unitSourcePromise;
}

const positive = value => Number.isFinite(value) && value > 0;
const finite = value => Number.isFinite(value);

export function createFloorScene(container, { onReady, onError } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
  } catch (error) {
    queueMicrotask(() => onError?.(error));
    const noop = () => {};
    return { setFloor: noop, setCargo: noop, setRoute: noop, frame: noop, resize: noop,
      render: noop, dispose: noop, setCeilingsVisible: noop,
      setUnitContext: async () => false,
      inspect: () => ({ ready: false, error: error.message, renderCount: 0, drawcalls: 0,
        modelFetches, unitsLoaded: false, unitContext: false, unitTransforms: [] }) };
  }

  let disposed = false, ready = false, frameRequest = null, renderCount = 0;
  let floor = null, cargo = null, cargoModel = null, cargoColliding = false;
  let requestedContext = false, unitsLoaded = false, contextSequence = 0, contextError = null;
  let template = null, batchStats = null, ceilingsVisible = false, viewMode = 'core';
  let routeCount = 0, routeStatus = null, lastError = null;
  const ownedGeometries = new Set(), ownedMaterials = new Set();
  const geometry = value => { ownedGeometries.add(value); return value; };
  const material = value => { ownedMaterials.add(value); return value; };
  const boxGeometry = geometry(new THREE.BoxGeometry(1, 1, 1));
  const edgeGeometry = geometry(new THREE.EdgesGeometry(boxGeometry));
  const sphereGeometry = geometry(new THREE.SphereGeometry(.065, 12, 8));
  const colors = { floor: 0xc4bdb0, car: 0x707b79, wall: 0xece5d9, metal: 0x8c9694,
    timber: 0xb19477, ink: 0x655e53, cargo: 0x418879, collision: 0xc35d4d };
  const standard = (color, options = {}) => material(new THREE.MeshStandardMaterial({
    color, roughness: .82, metalness: 0, ...options,
  }));
  const floorMaterial = standard(colors.floor);
  const carMaterial = standard(colors.car, { roughness: .64, metalness: .15,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const wallMaterial = standard(colors.wall);
  const upperWallMaterial = standard(colors.wall, { transparent: true, opacity: .28, depthWrite: false });
  const carWallMaterial = standard(0x8f9b9a, { roughness: .56, metalness: .48 });
  const upperCarWallMaterial = standard(0x8f9b9a, { roughness: .56, metalness: .48,
    transparent: true, opacity: .32, depthWrite: false });
  const ceilingMaterial = standard(colors.wall, { side: THREE.DoubleSide });
  const doorMaterial = standard(colors.metal, { roughness: .46, metalness: .45 });
  const upperDoorMaterial = standard(colors.metal, { roughness: .46, metalness: .45,
    transparent: true, opacity: .36, depthWrite: false });
  const unitDoorMaterial = standard(colors.timber);
  const upperUnitDoorMaterial = standard(colors.timber, { transparent: true, opacity: .3, depthWrite: false });
  const cargoMaterial = standard(colors.cargo, { roughness: .62 });
  const cargoEdgesMaterial = material(new THREE.LineBasicMaterial({ color: colors.cargo, transparent: true, opacity: .78 }));
  const wallEdgesMaterial = material(new THREE.LineBasicMaterial({ color: colors.ink, transparent: true, opacity: .17 }));
  const seamsMaterial = material(new THREE.LineBasicMaterial({ color: 0x9c968a, transparent: true, opacity: .2 }));
  const routeMaterial = material(new THREE.MeshBasicMaterial({ color: 0x327965, side: THREE.DoubleSide, depthWrite: false }));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf0ede6);
  const camera = new THREE.PerspectiveCamera(40, 1, .05, 250);
  camera.position.set(9, 10, 11);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.domElement.className = 'floor-access-canvas';
  renderer.domElement.setAttribute('aria-label', '공용 홀과 엘리베이터 3D 검토');
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
  container.append(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.maxPolarAngle = Math.PI * .485;
  controls.minDistance = 1.5;
  controls.maxDistance = 110;
  controls.target.set(0, .7, -1);
  controls.update();

  const architecture = new THREE.Group(), context = new THREE.Group();
  const cargoRoot = new THREE.Group(), cargoVisual = new THREE.Group(), routeRoot = new THREE.Group();
  architecture.name = 'Illustrative common area';
  context.name = '168C rigid unit copies';
  cargoRoot.name = 'Cargo placement';
  routeRoot.name = 'Reviewed floor route';
  context.visible = false;
  cargoRoot.visible = false;
  scene.add(architecture, context, cargoRoot, routeRoot);
  cargoRoot.add(cargoVisual);
  const cargoEdges = new THREE.LineSegments(edgeGeometry, cargoEdgesMaterial);
  cargoRoot.add(cargoEdges);

  scene.add(new THREE.HemisphereLight(0xfffaf0, 0xb6b5b0, 1.8));
  const sun = new THREE.DirectionalLight(0xfff3dc, 2.3);
  sun.position.set(7, 14, 8);
  sun.target.position.set(0, 0, -1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.normalBias = .018;
  sun.shadow.bias = -.0001;
  sun.shadow.radius = 3;
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: .5, far: 45 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target);
  let environment = null;
  const room = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(renderer);
  try {
    environment = pmrem.fromScene(room, .04);
    scene.environment = environment.texture;
    scene.environmentIntensity = .55;
  } catch (error) {
    lastError = `Environment: ${error.message}`;
  } finally {
    room.dispose(); pmrem.dispose();
  }

  function renderNow() {
    frameRequest = null;
    if (disposed || renderer.domElement.width === 0 || renderer.domElement.height === 0) return;
    try {
      renderer.render(scene, camera);
      renderCount++;
      if (!ready) { ready = true; onReady?.(); }
    } catch (error) {
      lastError = error.message;
      onError?.(error);
    }
  }
  // A render schedules no successor. OrbitControls has no damping or auto-rotate.
  function render(shadows = false) {
    if (disposed) return;
    if (shadows) renderer.shadowMap.needsUpdate = true;
    if (frameRequest === null) frameRequest = requestAnimationFrame(renderNow);
  }
  const controlsChanged = () => render();
  controls.addEventListener('change', controlsChanged);
  const contextLost = event => {
    event.preventDefault(); ready = false;
    lastError = '3D 화면 연결이 중단되었습니다.';
    onError?.(new Error(lastError));
  };
  const contextRestored = () => { lastError = null; render(true); };
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  renderer.domElement.addEventListener('webglcontextrestored', contextRestored);

  function box(parent, name, x, y, z, width, height, depth, mat, yaw = 0) {
    const mesh = new THREE.Mesh(boxGeometry, mat);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    mesh.scale.set(width, height, depth);
    mesh.castShadow = !mat.transparent;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function outline(parent, obstacle) {
    const line = new THREE.LineSegments(edgeGeometry, wallEdgesMaterial);
    line.position.set(obstacle.x, (obstacle.bottomY || 0) + obstacle.height / 2, obstacle.z);
    line.rotation.y = obstacle.yaw || 0;
    line.scale.set(obstacle.width, obstacle.height, obstacle.depth);
    parent.add(line);
  }
  function cutaway(parent, obstacle, lowerMaterial, upperMaterial) {
    const { id, x, z, width, depth, height } = obstacle;
    const bottom = obstacle.bottomY || 0, yaw = obstacle.yaw || 0;
    // Full dimensions remain represented; the transparent upper portion changes
    // visibility only, never the fixture or its collision volume.
    const lower = Math.min(height, Math.max(0, .48 - bottom));
    if (lower > 0) box(parent, `${id}/base`, x, bottom + lower / 2, z, width, lower, depth, lowerMaterial, yaw);
    if (height > lower) box(parent, `${id}/upper`, x, bottom + lower + (height - lower) / 2, z,
      width, height - lower, depth, upperMaterial, yaw);
    outline(parent, obstacle);
  }
  function clearOwnedLines(parent) {
    parent.traverse(object => {
      if (object.userData.ownedGeometry && object.geometry) {
        object.geometry.dispose(); ownedGeometries.delete(object.geometry);
      }
    });
    parent.clear();
  }
  function updateUnitTransforms() {
    if (!template || !floor) return;
    const present = new Map(context.children.map(child => [child.userData.unitId, child]));
    for (const unit of floor.units) {
      let root = present.get(unit.id);
      if (!root) {
        root = new THREE.Group();
        root.name = unit.id;
        root.userData = { unitId: unit.id, instanceId: unit.id, sourceEntrance: unit.sourceEntrance };
        const copy = template.clone(true);
        copy.traverse(object => {
          if (object.userData.object_id) {
            object.userData.source_object_id = object.userData.object_id;
            object.userData.object_id = `${unit.id}/${object.userData.object_id}`;
          }
          object.userData.instanceId = unit.id;
          if (object.userData.component === 'ceiling') object.visible = ceilingsVisible;
        });
        root.add(copy); context.add(root);
      }
      root.position.set(unit.x, 0, unit.z);
      root.rotation.y = unit.yaw;
      root.scale.setScalar(1);
      root.updateMatrixWorld(true);
      present.delete(unit.id);
    }
    for (const root of present.values()) context.remove(root);
  }

  function setFloor(value) {
    if (disposed) return;
    const first = !floor;
    floor = value;
    clearOwnedLines(architecture);
    if (!floor) { render(true); return; }
    const seamPoints = [];
    const carBox = floor.car ? { minX: floor.car.x - floor.car.width / 2 - .2,
      maxX: floor.car.x + floor.car.width / 2 + .2, minZ: floor.car.z - floor.car.depth / 2 - .2,
      maxZ: floor.car.z + floor.car.depth / 2 + .2 } : null;
    const seam = (ax, az, bx, bz) => {
      const add = (x1, z1, x2, z2) => {
        if (Math.hypot(x2 - x1, z2 - z1) > 1e-6) seamPoints.push(
          new THREE.Vector3(x1, .003, z1), new THREE.Vector3(x2, .003, z2));
      };
      if (carBox && ax === bx && ax > carBox.minX && ax < carBox.maxX && az < carBox.maxZ && bz > carBox.minZ) {
        if (az < carBox.minZ) add(ax, az, bx, Math.min(bz, carBox.minZ));
        if (bz > carBox.maxZ) add(ax, Math.max(az, carBox.maxZ), bx, bz);
      } else if (carBox && az === bz && az > carBox.minZ && az < carBox.maxZ && ax < carBox.maxX && bx > carBox.minX) {
        if (ax < carBox.minX) add(ax, az, Math.min(bx, carBox.minX), bz);
        if (bx > carBox.maxX) add(Math.max(ax, carBox.maxX), az, bx, bz);
      } else add(ax, az, bx, bz);
    };
    for (const zone of floor.zones) {
      box(architecture, `${zone.id}/floor`, zone.x, -.065, zone.z, zone.width, .13, zone.depth,
        zone.id === 'car' ? carMaterial : floorMaterial, zone.yaw || 0);
      if (zone.id !== 'hall') continue;
      for (let x = -.6 * Math.floor(zone.width / 1.2); x < zone.width / 2; x += .6) {
        seam(zone.x + x, zone.z - zone.depth / 2, zone.x + x, zone.z + zone.depth / 2);
      }
      for (let z = -.6 * Math.floor(zone.depth / 1.2); z < zone.depth / 2; z += .6) {
        seam(zone.x - zone.width / 2, zone.z + z, zone.x + zone.width / 2, zone.z + z);
      }
    }
    if (seamPoints.length) {
      const seams = new THREE.LineSegments(geometry(new THREE.BufferGeometry().setFromPoints(seamPoints)), seamsMaterial);
      seams.userData.ownedGeometry = true;
      architecture.add(seams);
    }
    for (const obstacle of floor.obstacles) {
      if (obstacle.kind === 'lift-door') continue; // Draw the two leaves below.
      if (obstacle.kind === 'ceiling') {
        const ceiling = box(architecture, obstacle.id, obstacle.x, obstacle.bottomY + obstacle.height / 2,
          obstacle.z, obstacle.width, obstacle.height, obstacle.depth, ceilingMaterial, obstacle.yaw || 0);
        ceiling.userData.component = 'ceiling'; ceiling.visible = ceilingsVisible;
      } else {
        const isEntry = obstacle.kind === 'unit-door';
        const isCarWall = obstacle.id === 'car-back' || obstacle.id.startsWith('car-side-');
        cutaway(architecture, obstacle, isEntry ? unitDoorMaterial : isCarWall ? carWallMaterial : wallMaterial,
          isEntry ? upperUnitDoorMaterial : isCarWall ? upperCarWallMaterial : upperWallMaterial);
      }
    }
    const panelWidth = floor.config.doorWidth / 2;
    for (const side of [-1, 1]) {
      cutaway(architecture, { id: `lift-door/leaf-${side}`, x: side * panelWidth * (floor.config.doorOpen ? 1.5 : .5),
        z: floor.doorZ, width: panelWidth, depth: .04, height: floor.config.doorHeight, bottomY: 0, yaw: 0 },
      doorMaterial, upperDoorMaterial);
    }
    updateUnitTransforms();
    if (first) frame('core');
    render(true);
  }

  function setCargo(value, { colliding = false, model = null } = {}) {
    if (disposed) return;
    if (!value || ![value.width, value.depth, value.height].every(positive) ||
        ![value.x, value.z, value.yaw ?? 0, value.bottomY ?? 0].every(finite)) {
      cargo = null; cargoRoot.visible = false; render(true); return;
    }
    const changedModel = model !== cargoModel || !cargoVisual.children.length;
    cargo = { ...value, yaw: value.yaw || 0, bottomY: value.bottomY || 0 };
    cargoModel = model; cargoColliding = Boolean(colliding);
    cargoRoot.visible = true;
    cargoRoot.position.set(cargo.x, cargo.bottomY, cargo.z);
    cargoRoot.rotation.y = cargo.yaw;
    if (changedModel) {
      cargoVisual.clear();
      if (model) cargoVisual.add(model.clone(true));
      else box(cargoVisual, 'Cargo bounds', 0, cargo.height / 2, 0,
        cargo.width, cargo.height, cargo.depth, cargoMaterial);
    }
    if (!model) {
      cargoVisual.children[0].position.y = cargo.height / 2;
      cargoVisual.children[0].scale.set(cargo.width, cargo.height, cargo.depth);
    }
    // Authored catalog geometry, UVs and materials remain at their original scale.
    cargoEdges.position.y = cargo.height / 2;
    cargoEdges.scale.set(cargo.width, cargo.height, cargo.depth);
    cargoEdgesMaterial.color.setHex(colliding ? colors.collision : colors.cargo);
    cargoMaterial.color.setHex(colliding ? colors.collision : colors.cargo);
    render(true);
  }

  function setRoute(poses = [], status = null) {
    if (disposed) return;
    clearOwnedLines(routeRoot);
    const points = Array.isArray(poses) ? poses.filter(p => finite(p?.x) && finite(p?.z)) : [];
    routeCount = points.length;
    routeStatus = typeof status === 'string' ? status : status?.status ?? null;
    const good = ['pass', 'clear', 'valid', 'ok', 'success', 'safe', 'found'].includes(routeStatus);
    const bad = ['fail', 'blocked', 'collision', 'invalid', 'no-path'].includes(routeStatus);
    routeMaterial.color.setHex(good ? 0x327965 : bad ? colors.collision : 0xb08b44);
    const vertices = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], dx = b.x - a.x, dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length < 1e-7) continue;
      const nx = -.025 * dz / length, nz = .025 * dx / length, y = .022;
      vertices.push(a.x + nx, y, a.z + nz, b.x + nx, y, b.z + nz, a.x - nx, y, a.z - nz,
        a.x - nx, y, a.z - nz, b.x + nx, y, b.z + nz, b.x - nx, y, b.z - nz);
    }
    if (vertices.length) {
      const ribbonGeometry = geometry(new THREE.BufferGeometry());
      ribbonGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      const ribbon = new THREE.Mesh(ribbonGeometry, routeMaterial);
      ribbon.userData.ownedGeometry = true; routeRoot.add(ribbon);
    }
    if (points.length) for (const p of [points[0], points[points.length - 1]]) {
      const marker = new THREE.Mesh(sphereGeometry, routeMaterial);
      marker.position.set(p.x, .03, p.z); marker.scale.y = .15; routeRoot.add(marker);
    }
    render();
  }

  async function setUnitContext(enabled) {
    if (disposed) return false;
    requestedContext = Boolean(enabled);
    const sequence = ++contextSequence;
    context.visible = requestedContext && unitsLoaded;
    render(true);
    if (!requestedContext) return false;
    if (!template) {
      try {
        const source = await loadUnitSource();
        if (disposed || sequence !== contextSequence || !requestedContext) return false;
        template = source.clone(true);
        template.traverse(object => {
          if (object.userData.component === 'ceiling') object.visible = false;
          if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; }
        });
        batchStats = batchStaticMeshes(template);
        batchStats.batches.forEach(batch => ownedGeometries.add(batch.geometry));
        unitsLoaded = true;
        contextError = null;
      } catch (error) {
        if (disposed || sequence !== contextSequence) return false;
        template = null; unitsLoaded = false; context.visible = false;
        contextError = error.message; onError?.(error);
        throw error;
      }
    }
    if (disposed || sequence !== contextSequence) return false;
    updateUnitTransforms();
    context.visible = true;
    if (viewMode === 'overview') frame('overview');
    render(true);
    return true;
  }

  function setCeilingsVisible(enabled) {
    if (disposed) return;
    ceilingsVisible = Boolean(enabled);
    for (const group of [architecture, context]) group.traverse(object => {
      if (object.userData.component === 'ceiling') object.visible = ceilingsVisible;
    });
    render(true);
  }

  function frame(mode = 'core') {
    if (disposed) return;
    if (mode === 'all') mode = 'overview';
    viewMode = mode;
    const bounds = new THREE.Box3();
    if (floor) for (const zone of floor.zones) {
      bounds.expandByPoint(new THREE.Vector3(zone.x - zone.width / 2 - .3, 0, zone.z - zone.depth / 2 - .3));
      bounds.expandByPoint(new THREE.Vector3(zone.x + zone.width / 2 + .3, 2.5, zone.z + zone.depth / 2 + .3));
    }
    if (mode === 'overview' && context.visible && unitsLoaded) bounds.expandByObject(context);
    if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-3, 0, -6), new THREE.Vector3(3, 2.5, 3));
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    center.y = mode === 'overview' ? .5 : .7;
    const direction = mode === 'top' ? new THREE.Vector3(.001, 1, .001) : new THREE.Vector3(9, 10, 11).normalize();
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
    const radius = size.length() / 2;
    const distance = Math.max(9, radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2) * 1.04);
    camera.position.copy(center).addScaledVector(direction, distance);
    camera.far = Math.max(150, distance * 4);
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.maxDistance = Math.max(110, distance * 2);
    controls.update(); render();
  }

  function resize() {
    if (disposed) return;
    const bounds = container.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width)), height = Math.max(1, Math.round(bounds.height));
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 1.5, 2200 / Math.max(width, height));
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix(); render();
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(container);
  globalThis.addEventListener?.('resize', resize);

  function inspect() {
    return { ready, disposed, error: lastError, renderCount, drawcalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles, modelFetches, unitsLoaded,
      unitContext: context.visible, unitContextRequested: requestedContext, unitError: contextError,
      unitTransforms: context.children.map(root => ({ id: root.userData.unitId,
        x: root.position.x, z: root.position.z, yaw: root.rotation.y, scale: root.scale.toArray() })),
      unitSourceRevision: UNIT_SOURCE.finish_revision, unitsSourceCount: template ? 1 : 0,
      batchSavedDraws: batchStats?.savedDraws ?? 0, ceilingVisible: ceilingsVisible,
      collisionCeilings: floor?.obstacles.filter(o => o.kind === 'ceiling').length ?? 0,
      obstacleCount: floor?.obstacles.length ?? 0, doorOpen: floor?.config.doorOpen ?? null,
      cargo: cargo ? { ...cargo, colliding: cargoColliding, catalogModel: Boolean(cargoModel) } : null,
      routeCount, routeStatus, viewMode, demandRendering: true,
      camera: { position: camera.position.toArray(), target: controls.target.toArray() } };
  }
  function dispose() {
    if (disposed) return;
    disposed = true; contextSequence++;
    if (frameRequest !== null) cancelAnimationFrame(frameRequest);
    observer?.disconnect();
    globalThis.removeEventListener?.('resize', resize);
    controls.removeEventListener('change', controlsChanged); controls.dispose();
    renderer.domElement.removeEventListener('webglcontextlost', contextLost);
    renderer.domElement.removeEventListener('webglcontextrestored', contextRestored);
    scene.clear();
    ownedGeometries.forEach(value => value.dispose());
    ownedMaterials.forEach(value => value.dispose());
    environment?.dispose(); sun.shadow.dispose(); renderer.dispose();
    renderer.domElement.remove();
  }
  resize(); render(true);
  return { setFloor, setCargo, setRoute, setUnitContext, setCeilingsVisible, frame, resize, render, dispose, inspect };
}
