import * as THREE from 'three';
import {createFloorCutaway, floorCutawayState} from './floor-cutaway.js';
import { createFacade, createStoneMap, createGlazingMaps } from './site-facade.js';
import { installSiteAppearance } from './site-appearance.js';
import site from '../../assets/location/acro-river-park/site-context.json';
import {createSiteSurroundings} from './site-surroundings.js';

const FLOOR_MARKER_COLOR = 0xf3be4d;

function shapeFrom(points) {
  const shape = new THREE.Shape();
  points.forEach(([x, z], index) => (index ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
  shape.closePath();
  return shape;
}

function horizontalShape(points) {
  const geometry = new THREE.ShapeGeometry(shapeFrom(points));
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function extrudedShape(points, height) {
  const geometry = new THREE.ExtrudeGeometry(shapeFrom(points), {
    depth: height,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function boundsOf(points) {
  const xs = points.map(([x]) => x), zs = points.map(([, z]) => z);
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minZ: Math.min(...zs), maxZ: Math.max(...zs),
  };
}

function labelSprite(text, highlighted = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 112;
  const context = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const setText = (value) => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = highlighted ? '#f3be4d' : 'rgba(249,248,240,.94)';
    context.beginPath(); context.roundRect(7, 7, 242, 98, 22); context.fill();
    context.strokeStyle = highlighted ? '#8a5817' : '#294c41'; context.lineWidth = 5; context.stroke();
    context.fillStyle = '#173d35'; context.font = '700 54px sans-serif';
    context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(value, 128, 58);
    texture.needsUpdate = true;
  };
  setText(text);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.scale.set(19, 8.3, 1); sprite.renderOrder = 10;
  sprite.userData.setText = setText;
  return sprite;
}

function floorDivisions(points, height, storeyHeight, material) {
  const vertices = [];
  for (let y = storeyHeight; y < height - .05; y += storeyHeight) {
    points.forEach(([x, z], index) => {
      const [nextX, nextZ] = points[(index + 1) % points.length];
      vertices.push(x, y, z, nextX, y, nextZ);
    });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return new THREE.LineSegments(geometry, material);
}

function roadMesh(record, material) {
  const group = new THREE.Group();
  const width = record.kind === 'trunk' ? 13 : record.kind === 'secondary' ? 10 : 6;
  for (let i = 1; i < record.path_m.length; i++) {
    const [ax, az] = record.path_m[i - 1], [bx, bz] = record.path_m[i];
    const length = Math.hypot(bx - ax, bz - az);
    const road = new THREE.Mesh(new THREE.BoxGeometry(length + .3, .035, width), material);
    road.rotation.y = -Math.atan2(bz - az, bx - ax); road.position.set((ax + bx) / 2, .01, (az + bz) / 2);
    road.receiveShadow = true; group.add(road);
  }
  return group;
}

// OSM supplies the footprint, part levels and overall height. The separate
// labelled site plan is used only to cross-check the 100–114 building labels.
export function createComplexContext(scene, invalidate) {
  const group = new THREE.Group(); group.name = 'ACRO site context · OSM derived'; scene.add(group);
  const stoneMap = createStoneMap();
  const ground = new THREE.MeshStandardMaterial({ color: 0xa3aca1, roughness: .95 });
  const road = new THREE.MeshStandardMaterial({ color: 0x565e60, roughness: .92 });
  const siteGround = new THREE.MeshStandardMaterial({ color: 0x95a484, roughness: .95 });
  const shellColor = 0xe8e5dd;
  const glazing = createGlazingMaps();
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x8aadc1, map: glazing.color, normalMap: glazing.normal, normalScale: new THREE.Vector2(.15, .15), metalness: .3, roughness: .12, clearcoat: 1, clearcoatRoughness: .08, envMapIntensity: 1.6 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x59696b, metalness: .55, roughness: .32 });
  const slab = new THREE.MeshStandardMaterial({ color: 0xe2ded5, roughness: .73, map: stoneMap });
  const edge = new THREE.LineBasicMaterial({ color: 0x78847f, transparent: true, opacity: .68 });
  const floorLine = new THREE.LineBasicMaterial({ color: 0x78847f, transparent: true, opacity: .55 });
  const bandMaterial = new THREE.MeshBasicMaterial({
    color: FLOOR_MARKER_COLOR, transparent: true, opacity: .27, depthWrite: false, depthTest: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const bandEdge = new THREE.LineBasicMaterial({ color: 0xe9ac30, transparent: true, opacity: .85, depthTest: true, depthWrite: false });

  const allBoundary = site.site_boundary_m;
  const siteBounds = boundsOf(allBoundary);
  const siteCenter = [(siteBounds.minX + siteBounds.maxX) / 2, (siteBounds.minZ + siteBounds.maxZ) / 2];
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(4200, 4000), ground);
  plane.rotation.x = -Math.PI / 2; plane.position.set(siteCenter[0], -.2, siteCenter[1] - 35); plane.receiveShadow = true; group.add(plane);
  const parcel = new THREE.Mesh(horizontalShape(allBoundary), siteGround); parcel.position.y = -.08; parcel.receiveShadow = true; group.add(parcel);

  // The mapped, cached neighbourhood replaces the former rectangular water plane.
  const surroundings=createSiteSurroundings(group,site,()=>{invalidate();});

  const buildings = [], pickMeshes = [];
  for (const record of site.buildings) {
    const building = new THREE.Group(); building.name = `${record.title} · OSM massing`; group.add(building);
    const material = new THREE.MeshStandardMaterial({ color: shellColor, map: stoneMap, roughness: .78, metalness: 0, emissive: 0x000000,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const edgeMaterial = edge.clone(), floorLineMaterial = floorLine.clone();
    edgeMaterial.depthWrite = floorLineMaterial.depthWrite = false;
    const markerParts = [], shells = [];
    const points = record.parts.flatMap((part) => part.footprint_m);
    const bounds = boundsOf(points);
    const center = [(bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2];
    for (const part of record.parts) {
      const geometry = extrudedShape(part.footprint_m, part.height_m);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.buildingId = record.id; mesh.userData.partLevels = part.levels;
      mesh.castShadow = mesh.receiveShadow = true;
      building.add(mesh); pickMeshes.push(mesh); shells.push(mesh);
      building.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 24), edgeMaterial));
      building.add(floorDivisions(part.footprint_m, part.height_m, record.height_m / record.levels, floorLineMaterial));
      // A full storey wraps the facade; a horizontal slice is hidden inside the shell.
      const marker = new THREE.Group(); marker.name = 'selected-floor-facade';
      const bandGeometry = extrudedShape(part.footprint_m, 1);
      const band = new THREE.Mesh(bandGeometry, bandMaterial); band.renderOrder = 5;
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(bandGeometry, 24), bandEdge); outline.renderOrder = 6;
      marker.add(band, outline);
      marker.visible = false; building.add(marker);
      markerParts.push({ mesh: marker, levels: part.levels, height_m: part.height_m });
    }
    const facade = createFacade(record, { glass:glass.clone(), frame:frame.clone(), slab:slab.clone() }); building.add(facade);
    const label = labelSprite(record.id); label.position.set(center[0], record.height_m + 8, center[1]);
    label.userData.buildingId = record.id; label.material.depthWrite = false; building.add(label);
    buildings.push({
      ...record, floors: record.levels, x: center[0], z: center[1], center,
      bounds, tower: building, material, edgeMaterial, floorLineMaterial, label, markerParts, facade, shells,
      cutawayMaterials:[material,edgeMaterial,floorLineMaterial,...facade.children.map(mesh=>mesh.material)],
    });
  }

  group.add(new THREE.HemisphereLight(0xdcecff, 0x7a806b, .65));
  const sun = new THREE.DirectionalLight(0xfff0db, 3.2);
  sun.position.set(siteCenter[0] - 180, 330, siteCenter[1] + 160);
  sun.target.position.set(siteCenter[0], 0, siteCenter[1]);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -280, right: 280, top: 280, bottom: -280, near: 10, far: 800 });
  sun.shadow.normalBias = .18; sun.shadow.bias = -.0002;
  group.add(sun, sun.target);
  const appearance = installSiteAppearance(scene, group, invalidate);

  const cutaway=createFloorCutaway(buildings);
  let cutawayEnabled=true, interiorSection=false;
  const floorLabel = labelSprite('1F', true); floorLabel.scale.set(16, 7, 1); group.add(floorLabel);
  let selected = buildings.find((building) => building.id === '109') || buildings[0], floor = 1, view = 'focus', selectionVisible = true;
  function floorHeight(building, number) { return Math.min(building.height_m, number * building.height_m / building.floors); }
  function updateSelection() {
    const supported=floorCutawayState(selected,floor,{selected:selectionVisible}).supported;
    cutaway.update(selected,floor,{enabled:cutawayEnabled,selected:selectionVisible,interiorSection});
    group.userData.floorCutawayActive=cutaway.state.active;
    for (const building of buildings) {
      const subdued = view === 'focus' && building !== selected;
      building.tower.visible = true;
      building.material.color.setHex(subdued ? 0xaebdb8 : shellColor);
      building.material.transparent = subdued;
      building.material.opacity = subdued ? .16 : 1;
      building.material.depthWrite = !subdued;
      building.edgeMaterial.opacity = subdued ? .14 : .07;
      building.floorLineMaterial.opacity = subdued ? .055 : .035;
      building.facade.visible = !subdued;
      building.shells.forEach(mesh => { mesh.castShadow = !subdued; });
      building.label.material.opacity = subdued ? .48 : 1;
      building.material.emissive.setHex(building === selected ? 0x3b3114 : 0x000000);
      building.material.emissiveIntensity = building === selected ? .05 : 0;
      for (const marker of building.markerParts) {
        marker.mesh.visible = !interiorSection && selectionVisible && supported && building === selected && marker.levels >= floor;
        const bottom = floorHeight(building, floor - 1) + .04;
        const top = Math.min(marker.height_m, floorHeight(building, floor)) - .04;
        marker.mesh.position.y = bottom;
        marker.mesh.scale.y = Math.max(.01, top - bottom);
      }
    }
    floorLabel.visible = !interiorSection && selectionVisible && supported;
    floorLabel.userData.setText(`${floor}F`);
    floorLabel.position.set(selected.bounds.maxX + 12, floorHeight(selected, floor - .5), selected.z);
  }
  function setFloor(number) { floor = number===null?null:Number(number); updateSelection(); }
  function selectBuilding(id) { selected = buildings.find((building) => building.id === String(id)) || buildings[0]; updateSelection(); return selected; }
  function setView(next) { view = next; updateSelection(); }
  function hitTest(raycaster) {
    const labelHit = raycaster.intersectObjects(buildings.map((building) => building.label), false)[0];
    if (labelHit) {
      const building = buildings.find((candidate) => candidate.id === labelHit.object.userData.buildingId);
      return { id: building.id, floor: Math.min(floor, building.floors) };
    }
    const hits = raycaster.intersectObjects(pickMeshes, false).filter(cutaway.acceptsHit);
    // A translucent neighbour must not intercept clicks on the focused facade.
    const hit = (view === 'focus' && hits.find((candidate) => candidate.object.userData.buildingId === selected.id)) || hits[0];
    if (!hit) return null;
    const building = buildings.find((candidate) => candidate.id === hit.object.userData.buildingId);
    const storeyHeight = building.height_m / building.floors;
    return { id: building.id, floor: Math.max(1, Math.min(building.floors, Math.ceil(hit.point.y / storeyHeight))) };
  }
  function viewpoint(view) {
    const y = floorHeight(selected, floor);
    if (view === 'site') return { target: [siteCenter[0], 38, siteCenter[1]], position: [siteCenter[0] + 295, 265, siteCenter[1] + 300] };
    if (view === 'river') return { target: [siteCenter[0], 42, siteCenter[1] - 25], position: [siteCenter[0] + 25, 145, siteBounds.minZ - 310] };
    if (view === 'street') return { target: [siteCenter[0], 36, siteCenter[1]], position: [siteCenter[0] - 235, 105, siteBounds.maxZ + 245] };
    return { target: [selected.x, y, selected.z], position: [selected.x + 105, y + 48, selected.z + 135] };
  }
  updateSelection(); group.visible = false;
  return { group, buildings, surroundings,
    setCutawayEnabled(value){cutawayEnabled=Boolean(value);updateSelection();},
    setInteriorSection(value){interiorSection=Boolean(value);updateSelection();},
    get cutawayEnabled(){return cutawayEnabled;},get cutawayState(){return cutaway.state;},
    inspectCutaway:()=>({...cutaway.inspect(),floorMarkerVisible:floorLabel.visible}),
    inspectRay(raycaster){group.updateMatrixWorld(true);return {raw:raycaster.intersectObjects(pickMeshes,false).map(h=>({id:h.object.userData.buildingId,y:h.point.y,accepted:cutaway.acceptsHit(h)})),hit:hitTest(raycaster)};},
    setSelectionVisible(value){selectionVisible=Boolean(value);updateSelection();}, setFloor, selectBuilding, setView, hitTest, viewpoint, floorHeight, site, appearance, get selected() { return selected; } };
}
