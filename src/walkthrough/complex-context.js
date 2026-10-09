import * as THREE from 'three';

// Visual neighborhood for exploring the demo. Positions, heights and waterways
// are illustrative, not a surveyed reconstruction or an actual view analysis.
export function createComplexContext(scene) {
  const group=new THREE.Group();group.name='Illustrative neighborhood context';scene.add(group);
  const boxGeometry=new THREE.BoxGeometry(1,1,1);
  const shell=new THREE.MeshStandardMaterial({color:0xe6e2d9,roughness:.75});
  const stone=new THREE.MeshStandardMaterial({color:0x6c797c,roughness:.6});
  const glass=new THREE.MeshStandardMaterial({color:0x527580,roughness:.3,metalness:.35});
  const concrete=new THREE.MeshStandardMaterial({color:0xc8c8b9,roughness:.9});
  function box(parent,size,position,material){const mesh=new THREE.Mesh(boxGeometry,material);mesh.scale.set(...size);mesh.position.set(...position);parent.add(mesh);return mesh;}
  function instances(parent,material,transforms){const mesh=new THREE.InstancedMesh(boxGeometry,material,transforms.length),dummy=new THREE.Object3D();transforms.forEach((t,i)=>{dummy.position.set(...t.p);dummy.scale.set(...t.s);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);});mesh.computeBoundingSphere();parent.add(mesh);return mesh;}

  const sky=new THREE.Mesh(new THREE.SphereGeometry(650,32,16),new THREE.ShaderMaterial({
    side:THREE.BackSide,depthWrite:false,
    vertexShader:'varying vec3 vDirection; void main(){vDirection=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'varying vec3 vDirection; void main(){float h=normalize(vDirection).y; vec3 horizon=vec3(.53,.74,.87); vec3 zenith=vec3(.18,.42,.68); gl_FragColor=vec4(mix(horizon,zenith,smoothstep(-.08,.75,h)),1.0);}',
  }));group.add(sky);
  group.add(new THREE.HemisphereLight(0xe5f2ff,0x8f9477,1.5));
  const sun=new THREE.DirectionalLight(0xfff4db,1.6);sun.position.set(-80,160,100);group.add(sun);
  box(group,[700,.3,600],[0,-.35,-50],new THREE.MeshStandardMaterial({color:0x8d9f8a,roughness:1}));
  box(group,[350,.2,205],[0,-.08,-32],new THREE.MeshStandardMaterial({color:0xb4be9d,roughness:1}));
  box(group,[700,.15,120],[0,-.05,-205],new THREE.MeshStandardMaterial({color:0x668f9e,metalness:.35,roughness:.3}));
  box(group,[700,.15,12],[0,.05,-137],concrete);
  const road=new THREE.MeshStandardMaterial({color:0x697773,roughness:1});
  for(const z of [85,-115]){
    box(group,[700,.12,14],[0,.02,z],road);
    instances(group,concrete,Array.from({length:60},(_,i)=>({s:[5,.03,.22],p:[i*12-350,.1,z]})));
  }
  for(const x of [-155,155])box(group,[10,.12,200],[x,.03,-18],road);
  const buildings=[],pickMeshes=[];
  const positions=[[0,0,38],[-34,-25,32],[35,-28,29],[-70,-56,36],[0,-65,31],[72,-62,35],[-108,-10,28],[105,-15,33],[-64,30,26],[66,30,30],[-118,-80,24],[-36,-96,34],[39,-96,28],[120,-90,32],[117,49,25]];
  for(const [index,[x,z,floors]] of positions.entries()){
    const id=String.fromCharCode(65+index),tower=new THREE.Group();tower.position.set(x,0,z);tower.rotation.y=index%3===1?-.15:index%3===2?.16:0;group.add(tower);
    const height=floors*2;
    const body=box(tower,[12,height,8],[0,height/2,0],shell);body.userData.buildingId=id;pickMeshes.push(body);
    box(tower,[2.1,height+2,8.3],[0,(height+2)/2,0],stone);
    box(tower,[13.2,.7,9.2],[0,height+.35,0],concrete);
    box(tower,[6,1.8,4.5],[0,height+1.6,0],stone);
    box(tower,[15,1,11],[0,.5,0],stone);
    const windows=[],bands=[];
    for(let floor=1;floor<=floors;floor++){
      for(const wx of [-4.4,-2.2,2.2,4.4])for(const side of [-1,1])windows.push({s:[1.72,1.48,.12],p:[wx,(floor-.5)*2,side*4.06]});
      for(const wx of [-6.06,6.06])for(const wz of [-2.5,0,2.5])windows.push({s:[.12,1.48,1.7],p:[wx,(floor-.5)*2,wz]});
      bands.push({s:[12.15,.1,8.15],p:[0,floor*2,0]});
    }
    instances(tower,glass,windows);instances(tower,concrete,bands);
    box(group,[21,.08,18],[x,.06,z],concrete);
    buildings.push({id,title:`${id}동`,floors,x,z,tower});
  }
  // Instancing keeps the landscaped context inexpensive while orbiting.
  const treePositions=[];
  for(let i=0;i<130;i++){
    const x=((i*53)%300)-150,z=((i*71)%178)-97;
    if(buildings.some(b=>Math.abs(x-b.x)<14&&Math.abs(z-b.z)<12))continue;
    treePositions.push([x,z]);
  }
  const crowns=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),new THREE.MeshStandardMaterial({color:0x5d795c,roughness:1}),treePositions.length);
  const dummy=new THREE.Object3D();treePositions.forEach(([x,z],i)=>{dummy.position.set(x,3.1,z);dummy.scale.set(2.1,2.6,2.1);dummy.updateMatrix();crowns.setMatrixAt(i,dummy.matrix);});crowns.computeBoundingSphere();group.add(crowns);
  instances(group,stone,treePositions.map(([x,z])=>({s:[.3,2,.3],p:[x,1,z]})));
  const marker=box(group,[13,1.9,9],[0,43,0],new THREE.MeshBasicMaterial({color:0xe6b75c,transparent:true,opacity:.48,depthWrite:false}));
  let selected=buildings[0],floor=22;
  function setFloor(n){floor=n;marker.position.set(selected.x,(n-.5)*2,selected.z);marker.rotation.y=selected.tower.rotation.y;}
  function selectBuilding(id){selected=buildings.find(b=>b.id===id)||buildings[0];setFloor(Math.min(floor,selected.floors));return selected;}
  function hitTest(raycaster){const hit=raycaster.intersectObjects(pickMeshes,false)[0];return hit?{id:hit.object.userData.buildingId,floor:Math.max(1,Math.ceil(hit.point.y/2))}:null;}
  function viewpoint(view){
    if(view==='site')return {target:[0,24,-35],position:[190,175,210]};
    if(view==='river')return {target:[0,28,-30],position:[130,100,-270]};
    if(view==='street')return {target:[0,28,-20],position:[-155,50,145]};
    return {target:[selected.x,(floor-.5)*2,selected.z],position:[selected.x+26,(floor-.5)*2+10,selected.z+63]};
  }
  group.visible=false;
  return {group,buildings,setFloor,selectBuilding,hitTest,viewpoint,get selected(){return selected;}};
}
