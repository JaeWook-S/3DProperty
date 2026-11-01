import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createPairedDetails } from './details.js';
import { createTransportView } from './transport-view.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { archisketchWebData, bindArchisketchModel } from '../walkthrough/archisketch-model.js';
import { collisionTree, combinedWorld, createDoors, MovingDoor } from '../walkthrough/doors.js';
import { BODY_RADIUS, DEFAULT_EYE_HEIGHT, bodyAt, canStand, movementVector, moveWithCollisions } from '../walkthrough/movement.js';
import { batchStaticMeshes } from '../walkthrough/static-batches.js';
import { floorSlabs, pointOnFloor, staticCollisionMesh, transformPoint } from './geometry.js';

const modelSources = {
  '168c': {
    basic: {info: new URL('../../assets/models/acro-river-park/168c/archisketch-details-v2/basic/model-info.json', import.meta.url).href, glb: new URL('../../assets/models/acro-river-park/168c/archisketch-details-v2/basic/acro168c-basic.glb', import.meta.url).href},
    expanded: {info: new URL('../../assets/models/acro-river-park/168c/archisketch-metric-v1/expanded/model-info.json', import.meta.url).href, glb: new URL('../../assets/models/acro-river-park/168c/archisketch-metric-v1/expanded/acro168c-expanded.glb', import.meta.url).href},
  },
  '211a': {
    basic: {info: new URL('../../assets/models/acro-river-park/211a/archisketch-structure-v1/basic/model-info.json', import.meta.url).href, glb: new URL('../../assets/models/acro-river-park/211a/archisketch-structure-v1/basic/acro211a-basic-archisketch.glb', import.meta.url).href},
    expanded: {info: new URL('../../assets/models/acro-river-park/211a/archisketch-structure-v1/expanded/model-info.json', import.meta.url).href, glb: new URL('../../assets/models/acro-river-park/211a/archisketch-structure-v1/expanded/acro211a-expanded-archisketch.glb', import.meta.url).href},
  },
};
async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw Error(`파일을 불러올 수 없습니다 (${response.status}): ${url}`);
  return response.json();
}
function makeCommonArea(layout) {
  const group = new THREE.Group(); group.name = 'Illustrative shared floor';
  const materials = {
    wall: new THREE.MeshStandardMaterial({color:0xdde4d6,roughness:.85}),
    floor: new THREE.MeshStandardMaterial({color:0xbac8b4,roughness:.9}),
    metal: new THREE.MeshStandardMaterial({color:0x80928a,metalness:.35,roughness:.52}),
    trim: new THREE.MeshStandardMaterial({color:0x34564a,roughness:.6}),
    button: new THREE.MeshStandardMaterial({color:0xd4a35b,emissive:0x634212,roughness:.6}),
  };
  function box(id, center, size, height, bottom=0, material=materials.wall, component='wall', parent=group) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], height, size[1]), material);
    mesh.position.set(center[0], bottom + height/2, center[1]); mesh.name=id;
    mesh.userData.component=component; parent.add(mesh); return mesh;
  }
  for (const [i, slab] of floorSlabs(layout).entries()) box(`Common slab ${i}`, slab.center, slab.size, .12, -.12, materials.floor, 'floor');
  for (const wall of layout.walls) box(wall.id, wall.center, wall.size, wall.height ?? 2.5, wall.bottom ?? 0, materials.wall, wall.component ?? 'wall');
  const elevator=layout.elevator;
  const [nx,nz]=elevator.doorNormal, tangent=[nz,-nx], [dx,dz]=elevator.doorCenter;
  const doorWidth=elevator.doorWidth, height=elevator.doorHeight ?? 2.1;
  const pivot=new THREE.Group(); group.add(pivot);
  const panels=[-1,1].map(side=> {
    const mesh=box(`Elevator leaf ${side}`, [dx+tangent[0]*side*doorWidth/4,dz+tangent[1]*side*doorWidth/4],
      [Math.abs(tangent[0])*doorWidth/2+Math.abs(nx)*.04,Math.abs(tangent[1])*doorWidth/2+Math.abs(nz)*.04],height,0,materials.metal,'door',pivot);
    return {side,mesh};
  });
  const elevatorDoor=new MovingDoor({id:'paired-floor:elevator',name:'예시 엘리베이터 문',type:'sliding'},pivot,pivot,progress=>{
    for (const {side,mesh} of panels) {
      const t=side*(doorWidth/4+progress*(doorWidth/2+.035));
      mesh.position.x=dx+tangent[0]*t;mesh.position.z=dz+tangent[1]*t;
    }
  });
  for(const side of [-1,1]) {
    const offset=doorWidth/2+.18;
    const button=box(`Elevator button ${side}`, [dx+tangent[0]*offset+nx*.12*side,dz+tangent[1]*offset+nz*.12*side], [.10,.10],.16,1.08,materials.button,'decoration');
    button.userData.doorId=elevatorDoor.definition.id; button.userData.collisionDisabled=true;
  }
  const seam=box('Elevator closed-door interaction surface',elevator.doorCenter,
    [Math.abs(tangent[0])*doorWidth+Math.abs(nx)*.045,Math.abs(tangent[1])*doorWidth+Math.abs(nz)*.045],height,0,materials.metal,'decoration');
  seam.visible=false;seam.userData.collisionDisabled=true;seam.userData.doorId=elevatorDoor.definition.id;
  // A colored threshold remains visible in the overhead view.
  box('Elevator threshold', elevator.doorCenter,[Math.abs(tangent[0])*doorWidth+Math.abs(nx)*.24,Math.abs(tangent[1])*doorWidth+Math.abs(nz)*.24],.015,.001,materials.trim,'decoration').userData.collisionDisabled=true;
  return {group,door:elevatorDoor,seam};
}

export function createPairedScene(container, callbacks={}) {
  const renderer=new THREE.WebGLRenderer({antialias:false,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.25));renderer.setClearColor(0xe5ebe3);
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  container.append(renderer.domElement);
  const scene=new THREE.Scene();
  const environmentRoom=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer);
  const environmentTarget=pmrem.fromScene(environmentRoom,.04);scene.environment=environmentTarget.texture;
  scene.environmentIntensity=.7;environmentRoom.dispose();pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xfffaf2,0x7d827a,.9));
  const sunlight=new THREE.DirectionalLight(0xfff4df,2.3);sunlight.position.set(-10,30,15);scene.add(sunlight);scene.add(sunlight.target);sunlight.castShadow=true;sunlight.shadow.mapSize.set(1024,1024);sunlight.shadow.bias=-.0002;sunlight.shadow.normalBias=.025;
  const walkCamera=new THREE.PerspectiveCamera(67,1,.035,180);walkCamera.rotation.order='YXZ';
  const planCamera=new THREE.OrthographicCamera(-20,20,20,-20,.05,240);
  const orbit=new OrbitControls(planCamera,renderer.domElement);orbit.enableDamping=false;orbit.maxPolarAngle=Math.PI/2-.04;
  const pointer=new PointerLockControls(walkCamera,renderer.domElement);pointer.pointerSpeed=.65;pointer.minPolarAngle=.15;pointer.maxPolarAngle=Math.PI-.15;
  let active=null,mode='overview',busy=false,sequence=0,frame=0,needsRender=true,disposed=false,previousTime=0,viewSpan=25;
  const keys=new Set(),position=new THREE.Vector3(0,DEFAULT_EYE_HEIGHT,0),raycaster=new THREE.Raycaster();
  let drag=null,touchMovement=[0,0];
  const mark=()=>{needsRender=true;};const transportView=createTransportView(scene,mark);orbit.addEventListener('change',mark);pointer.addEventListener('change',mark);
  pointer.addEventListener('unlock',()=>{keys.clear();callbacks.onChange?.();mark();});pointer.addEventListener('lock',()=>callbacks.onChange?.());
  function resize() {
    const width=container.clientWidth,height=container.clientHeight;
    renderer.setSize(width,height,false);walkCamera.aspect=width/height;walkCamera.updateProjectionMatrix();
    planCamera.left=-viewSpan*width/height/2;planCamera.right=-planCamera.left;planCamera.top=viewSpan/2;planCamera.bottom=-viewSpan/2;planCamera.updateProjectionMatrix();mark();
  }
  const observer=new ResizeObserver(resize);observer.observe(container);
  function currentWorld() {return active?.world;}
  function safePosition(point) {
    const candidate=new THREE.Vector3(point[0],DEFAULT_EYE_HEIGHT,point[1]);
    return active && pointOnFloor(...point,active.units,active.layout.commonArea) && canStand(currentWorld(),candidate);
  }
  function place(point,target=null) {
    if (!safePosition(point)) return false;
    keys.clear();position.set(point[0],DEFAULT_EYE_HEIGHT,point[1]);walkCamera.position.copy(position);
    if(target)walkCamera.lookAt(target[0],DEFAULT_EYE_HEIGHT,target[1]);
    mark();callbacks.onChange?.();return true;
  }
  function nearestSafe(point) {
    if(safePosition(point))return point;
    for(const radius of [.1,.2,.35,.5,.75,1])for(let i=0;i<16;i++) {
      const candidate=[point[0]+Math.cos(i*Math.PI/8)*radius,point[1]+Math.sin(i*Math.PI/8)*radius];
      if(safePosition(candidate))return candidate;
    }
    return null;
  }
  function goTo(destination,roomId) {
    if(!active||busy)return false;
    transportView.clear();
    let point,target;
    if(destination==='hall'||destination==='elevator') {
      point=active.layout.spawns[destination];target=destination==='hall'?active.layout.commonArea.elevator.doorCenter:active.layout.spawns.hall;
    } else {
      const unit=active.units.find(unit=>unit.id===destination);if(!unit)return false;
      const room=unit.info.rooms.find(room=>room.id===roomId);
      point=transformPoint(room?.representative_point_m??unit.placement.spawnLocal,unit.placement);
      target=transformPoint(unit.placement.entryLocal,unit.placement);
    }
    const safe=nearestSafe(point);
    if(!safe)return false;
    setMode('walk');return place(safe,target);
  }
  function move(dx,dz) {
    if(!active||busy)return;
    // Subdivide the floor-domain guard too, preventing an off-slab shortcut.
    const delta=new THREE.Vector3(dx,0,dz),steps=Math.max(1,Math.ceil(delta.length()/.035)),step=delta.divideScalar(steps);
    for(let i=0;i<steps;i++) {
      const previous=position.clone();moveWithCollisions(currentWorld(),position,step);
      if(!pointOnFloor(position.x,position.z,active.units,active.layout.commonArea))position.copy(previous);
    }
    walkCamera.position.copy(position);mark();
  }
  function pickDoor() {
    if(!active||mode!=='walk')return null;
    raycaster.setFromCamera(new THREE.Vector2(),walkCamera);
    const meshes=[];
    active.group.traverse(object=>{if(object.userData.renderBatch)return;if(object.isMesh&&(object.visible||object.userData.renderBatched)&&!['ceiling','base','lighting','decoration'].includes(object.userData.component))meshes.push(object);else if(object.isMesh&&object.visible&&object.userData.doorId)meshes.push(object);});
    if(active.common.door.progress<1e-4)meshes.push(active.common.seam);
    for(const hit of raycaster.intersectObjects(meshes,false)) {
      if(hit.distance>2.6)return null;
      let owner=hit.object;while(owner&&!owner.userData.doorId)owner=owner.parent;
      return owner?active.doorById.get(owner.userData.doorId)??null:null;
    }
    return null;
  }
  function interact() {
    const door=pickDoor();if(!door)return false;door.toggle();mark();return true;
  }
  function setMode(next) {
    mode=next;orbit.enabled=mode==='overview';keys.clear();
    if(mode==='overview'&&document.pointerLockElement)document.exitPointerLock();
    if(active)active.group.traverse(object=>{if(object.isMesh&&object.userData.component==='ceiling')object.visible=mode==='walk';});
    mark();callbacks.onMode?.(mode);callbacks.onChange?.();
  }
  function frameAll(top=false) {
    if(!active)return;setMode('overview');
    const bounds=new THREE.Box3().setFromObject(active.group),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
    const aspect=container.clientWidth/container.clientHeight;
    viewSpan=Math.max(size.z*1.24,size.x/aspect*1.24,12);
    planCamera.position.set(center.x+(top?.001:size.x*.14),top?75:50,center.z+(top?.001:size.z*.57));
    orbit.target.set(center.x,0,center.z);planCamera.lookAt(orbit.target);planCamera.zoom=1;orbit.update();resize();
  }
  function focusArea(area='common') {
    if(!active)return;
    setMode('overview');
    const unit=active.units.find(unit=>unit.id===area);
    const bounds=new THREE.Box3().setFromObject(unit?.model??active.common.group);
    const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
    viewSpan=Math.max(size.z*1.25,size.x/(container.clientWidth/container.clientHeight)*1.35,5);
    planCamera.position.set(center.x-6,18,center.z+7);orbit.target.set(center.x,.1,center.z);
    planCamera.lookAt(orbit.target);planCamera.zoom=1;orbit.update();resize();
  }
  function transportGeometry() {
    if(!active)return null;
    const obstacles=[],openings=[];
    const boundsOf=object=>new THREE.Box3().setFromObject(object);
    const addBox=(id,title,bounds)=>{
      if(bounds.isEmpty())return;
      const c=bounds.getCenter(new THREE.Vector3()),s=bounds.getSize(new THREE.Vector3());
      obstacles.push({id,title,x:c.x,z:c.z,width:Math.max(s.x,.00001),depth:Math.max(s.z,.00001),height:Math.max(s.y,.00001),bottomY:bounds.min.y,yaw:0});
    };
    for(const door of active.doors.filter(d=>d.definition.id==='paired-floor:elevator'||d.definition.id.endsWith(':door-00'))) {
      const progress=door.progress,target=door.target;
      try {
        door.setProgress(1);let index=0;
        door.moving.traverse(object=>{if(object.isMesh&&!object.userData.renderBatch)addBox(`${door.definition.id}:open:${index++}`,`${door.definition.name??door.definition.id} 열린 문짝`,boundsOf(object));});
      } finally {door.setProgress(progress);door.target=target;}
    }
    for(const unit of active.units) {
      const frames=[];
      unit.model.traverse(object=>{
        if(object.isMesh&&object.userData.opening_id==='door-00'&&object.userData.component==='opening_frame') {
          const bounds=boundsOf(object);frames.push({name:object.name,bounds});
          addBox(`${unit.id}:entry-frame:${object.name}`,`${unit.id.toUpperCase()} 현관 문틀`,bounds);
        }
      });
      const jambs=frames.filter(f=>/jamb/.test(f.name)).sort((a,b)=>a.bounds.min.z-b.bounds.min.z);
      const head=frames.find(f=>/head/.test(f.name));
      if(jambs.length===2&&head)openings.push({id:unit.id,width:jambs[1].bounds.min.z-jambs[0].bounds.max.z,height:head.bounds.min.y,basis:'runtime-model-frame-clear-gap-not-field-measurement'});
    }
    return {doorObstacles:obstacles,openings,basis:'fully-open-model-per-mesh-axis-aligned-bounds-including-entry-frames'};
  }
  function showTransport(report,fraction=0) {
    if(!active)return;
    if(!report){transportView.clear();return;}
    for(const door of active.doors)if(door.definition.id==='paired-floor:elevator'||door.definition.id.endsWith(':door-00')){door.target=1;door.setProgress(1);}
    transportView.set(report,fraction);mark();
  }
  async function load(variant,fixture) {
    const token=++sequence;busy=true;keys.clear();transportView.clear();callbacks.onLoading?.(true);if(document.pointerLockElement)document.exitPointerLock();
    let group=null;
    try {
      const layout=fixture.variants[variant];if(!layout)throw Error('공용층 배치 정의가 없습니다.');
      const units=await Promise.all(layout.units.map(async placement=>{
        const source=modelSources[placement.id][variant];const [metadata,gltf]=await Promise.all([json(source.info),new GLTFLoader().loadAsync(source.glb)]);
        metadata.unit_type??=placement.id.toUpperCase();
        const data=archisketchWebData(metadata);bindArchisketchModel(gltf,data.info);
        const definitions=data.doors.map(door=>({...door,id:`paired-floor:${placement.id}:${variant}:${door.sourceOpening}`}));
        const model=gltf.scene;const doors=createDoors(model,definitions);
        model.position.set(...placement.translation);model.rotation.y=placement.rotationYRadians;model.scale.set(1,1,1);model.updateMatrixWorld(true);
        for(const door of doors)door.setProgress(0);
        model.traverse(object=>{if(!object.isMesh)return;if(['base','decoration'].includes(object.userData.component))object.visible=false;});
        return {id:placement.id,placement,info:data.info,model,doors,source};
      }));
      group=new THREE.Group();group.name=`168C + 211A ${variant}`;
      for(const unit of units)group.add(unit.model);
      const common=makeCommonArea(layout.commonArea);group.add(common.group);
      const details=createPairedDetails({layout,units,commonGroup:common.group});group.add(details.group);group.updateMatrixWorld(true);
      group.traverse(object=>{if(!object.isMesh)return;object.receiveShadow=true;object.castShadow=!['ceiling','floor','base','decoration','lighting'].includes(object.userData.component)&&!object.material.transparent;});
      const lightBounds=new THREE.Box3().setFromObject(group),lightCenter=lightBounds.getCenter(new THREE.Vector3()),lightSize=lightBounds.getSize(new THREE.Vector3());
      sunlight.position.set(lightCenter.x-15,30,lightCenter.z+10);sunlight.target.position.set(lightCenter.x,0,lightCenter.z);
      const shadowSpan=Math.max(lightSize.x,lightSize.z)*.66;Object.assign(sunlight.shadow.camera,{left:-shadowSpan,right:shadowSpan,top:shadowSpan,bottom:-shadowSpan,near:1,far:90});sunlight.shadow.camera.updateProjectionMatrix();
      const doors=[...units.flatMap(unit=>unit.doors),common.door];
      for(const door of doors)door.setProgress(0);
      const staticTree=collisionTree(group,object=> {
        if(!staticCollisionMesh(object))return false;
        // Low window rails and thresholds are part of the original geometry;
        // like the source walkthrough, they do not become ankle-high barriers.
        if(/frame-bottom|\/sill$|rail|sill cap/.test(object.userData.object_id??'')&&new THREE.Box3().setFromObject(object).max.y<.15)return false;
        return true;
      });
      if(token!==sequence){disposeGroup(group);return false;}
      // Keep ceilings outside batches because they change visibility by view.
      // Static originals remain authoritative for picking and the already-built collision tree.
      group.traverse(object=>{if(object.isMesh&&object.userData.component==='ceiling')object.visible=false;});
      const batches=[...units.map(unit=>batchStaticMeshes(unit.model)),batchStaticMeshes(common.group),batchStaticMeshes(details.group)];
      const batching={sourceMeshes:batches.reduce((n,b)=>n+b.sourceMeshes,0),drawMeshes:batches.reduce((n,b)=>n+b.drawMeshes,0),savedDraws:batches.reduce((n,b)=>n+b.savedDraws,0)};
      if(active){scene.remove(active.group);disposeGroup(active.group);}
      active={group,units,doors,common,layout,variant,batching,detailStats:details.stats,world:combinedWorld(staticTree,doors),doorById:new Map(doors.map(door=>[door.definition.id,door]))};
      scene.add(group);busy=false;
      const start=nearestSafe(layout.spawns.hall);if(!start)throw Error('공용 홀 시작 위치에 충돌이 있습니다.');
      place(start,layout.commonArea.elevator.doorCenter);frameAll();callbacks.onReady?.(active);callbacks.onLoading?.(false);return true;
    } catch(error) {
      if(token!==sequence)return false;busy=false;callbacks.onError?.(error);throw error;
    }
  }
  function disposeGroup(group) {
    const geometries=new Set(),materials=new Set();group.traverse(object=>{if(!object.isMesh)return;geometries.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);});
    for(const geometry of geometries)geometry.dispose();for(const material of materials){for(const value of Object.values(material))if(value?.isTexture)value.dispose();material.dispose();}
  }
  const onKeyDown=event=>{
    if(mode!=='walk'||busy||/INPUT|SELECT|TEXTAREA/.test(event.target.tagName))return;
    if(event.code==='KeyE'&&!event.repeat){event.preventDefault();interact();return;}
    if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code)){event.preventDefault();keys.add(event.code);}
  };
  const onKeyUp=event=>keys.delete(event.code);document.addEventListener('keydown',onKeyDown);document.addEventListener('keyup',onKeyUp);
  const onBlur=()=>{keys.clear();touchMovement=[0,0];};window.addEventListener('blur',onBlur);
  renderer.domElement.addEventListener('click',()=>{if(mode==='walk'&&pointer.isLocked)interact();});
  renderer.domElement.addEventListener('pointerdown',event=>{if(mode!=='walk'||pointer.isLocked)return;drag={x:event.clientX,y:event.clientY,id:event.pointerId};renderer.domElement.setPointerCapture(event.pointerId);});
  renderer.domElement.addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId)return;walkCamera.rotation.y-=(event.clientX-drag.x)*.004;walkCamera.rotation.x=THREE.MathUtils.clamp(walkCamera.rotation.x-(event.clientY-drag.y)*.004,-1.4,1.4);drag.x=event.clientX;drag.y=event.clientY;mark();});
  renderer.domElement.addEventListener('pointerup',()=>{drag=null;});renderer.domElement.addEventListener('pointercancel',()=>{drag=null;});
  renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();callbacks.onError?.(Error('3D 화면 연결이 끊겼습니다. 새로고침해 주세요.'));});
  function animate(time) {
    if(disposed)return;requestAnimationFrame(animate);
    // Door motion already sweeps in <=0.02 progress increments; preserve time
    // on slower devices without skipping collision checks.
    const dt=Math.min((time-previousTime)/1000,.25);previousTime=time;
    if(active&&!busy) {
      if(mode==='walk') {
        const forward=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0)+touchMovement[0];
        const right=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)+touchMovement[1];
        if(forward||right){const delta=movementVector(forward,right,walkCamera.rotation.y,dt);move(delta.x,delta.z);}
      }
      for(const door of active.doors){const result=door.update(dt,bodyAt(position));if(result.changed)mark();if(result.blocked)callbacks.onDoorBlocked?.(door.getState());}
    }
    if(needsRender) {
      renderer.render(scene,mode==='overview'?planCamera:walkCamera);needsRender=false;frame++;
      const nearby=pickDoor();callbacks.onFrame?.({position:position.toArray(),door:nearby?.getState()??null,mode});
    }
  }
  requestAnimationFrame(animate);resize();
  return {load,goTo,frameAll,focusArea,showTransport,transportGeometry,transportProgress:fraction=>transportView.progress(fraction),interact,setMode,place,move,
    look(yaw,pitch=0){walkCamera.rotation.set(pitch,yaw,0);mark();},
    turn(radians){walkCamera.rotation.y+=radians;mark();},
    startPointer(){if(mode!=='walk')goTo('hall');if(renderer.domElement.requestPointerLock)pointer.lock();},
    release(){if(document.pointerLockElement)document.exitPointerLock();},
    setTouchMovement(forward,right){touchMovement=[forward,right];},
    setDoor(id,open){const door=active?.doorById.get(id);if(!door)return false;door.target=open?1:0;mark();return true;},
    pickDoor(){return pickDoor()?.definition.id??null;},
    inspect(){return {ready:Boolean(active)&&!busy,variant:active?.variant,mode,locked:pointer.isLocked,position:position.toArray(),eyeHeight:DEFAULT_EYE_HEIGHT,bodyRadius:BODY_RADIUS,bodyWidth:BODY_RADIUS*2,standing:active?canStand(currentWorld(),position):false,frames:frame,renderStats:{drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles},batching:active?.batching,details:active?.detailStats,transport:transportView.inspect(),renderer:renderer.getContext().getParameter(renderer.getContext().RENDERER),doors:active?.doors.map(door=>door.getState())??[],units:active?.units.map(unit=>({id:unit.id,scale:unit.model.scale.toArray(),translation:unit.model.position.toArray(),rotationYRadians:unit.model.rotation.y,model:unit.source.glb,entryWorld:transformPoint(unit.placement.entryLocal,unit.placement),rooms:unit.info.rooms.map(room=>({id:room.id,label:room.name_ko,point:transformPoint(room.representative_point_m,unit.placement)}))}))??[],layout:active?.layout};},
    dispose(){disposed=true;sequence++;observer.disconnect();pointer.dispose();orbit.dispose();document.removeEventListener('keydown',onKeyDown);document.removeEventListener('keyup',onKeyUp);window.removeEventListener('blur',onBlur);if(active)disposeGroup(active.group);transportView.dispose();environmentTarget.dispose();renderer.dispose();renderer.domElement.remove();},
  };
}
