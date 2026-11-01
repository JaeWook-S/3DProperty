import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PointLight } from 'three';
import { collisionTree, combinedWorld, MovingDoor } from './doors.js';
import { pointInRoom } from './minimap-geometry.js';

// An optional illustrative landing. Source apartments, their transforms and
// their metadata are never changed. All added dimensions are in world meters.
export function entryCommonAreaLayout(info) {
  const opening = info.openings?.find(o => o.id === 'door-00' && o.kind === 'door');
  if (!opening) return null;
  const tangent = opening.axis === 'x' ? [1, 0] : [0, 1];
  const normal = opening.axis === 'x' ? [0, 1] : [1, 0];
  const [x, z] = opening.center_m;
  const occupied = side => info.rooms.some(room => pointInRoom(room, x + normal[0] * side * .32, z + normal[1] * side * .32));
  if (occupied(1) === occupied(-1)) return null;
  const side = occupied(1) ? -1 : 1;
  const outward = normal.map(n => n ? n * side : 0);
  const point = (t, s) => [x + tangent[0] * t + outward[0] * s, z + tangent[1] * t + outward[1] * s];
  const local = (px, pz) => [(px - x) * tangent[0] + (pz - z) * tangent[1], (px - x) * outward[0] + (pz - z) * outward[1]];
  // The offset leaves the source apartment's return wall beside the entrance
  // untouched, including the short north-side recess in the 168C plans.
  const hall = { minT: -1, maxT: .5, minS: .1, maxS: 3.1 };
  const car = { minT: -1.15, maxT: .45, minS: 3.2, maxS: 5.3 };
  const elevator = { t: -.35, s: 3.15, width: .9, height: 2.1 };
  const polygon = b => [[b.minT,b.minS],[b.maxT,b.minS],[b.maxT,b.maxS],[b.minT,b.maxS]].map(([t,s]) => point(t,s));
  return { opening, tangent, outward, point, local, hall, car, elevator,
    footprints: [polygon(hall), polygon(car), polygon({minT:-.8,maxT:.1,minS:3.1,maxS:3.2})],
    basis: 'illustrative_common_area_not_actual_building_or_floor', floorTravel: false };
}

export function createEntryCommonArea(info) {
  const layout = entryCommonAreaLayout(info);
  if (!layout) return null;
  const group = new Group(); group.name = 'Illustrative entrance landing';
  group.userData.illustrativeCommonArea = true;
  const geometry = new BoxGeometry(1, 1, 1);
  const materials = {
    wall: new MeshStandardMaterial({color:0xe8e5df, roughness:.88}),
    floor: new MeshStandardMaterial({color:0xb4b0a7, roughness:.85}),
    metal: new MeshStandardMaterial({color:0x8e9a9c, roughness:.43, metalness:.6}),
    trim: new MeshStandardMaterial({color:0x43585b, roughness:.6, metalness:.3}),
    button: new MeshStandardMaterial({color:0x83b99a, emissive:0x1d5038, roughness:.4}),
  };
  const {point, tangent, hall, car, elevator, opening} = layout;
  const pickMeshes = [];
  function box(name, t, s, width, depth, height, bottom, material, collision = true, parent = group) {
    const [x,z] = point(t,s), mesh = new Mesh(geometry, material);
    mesh.name = name; mesh.position.set(x, bottom + height/2, z);
    mesh.scale.set(opening.axis === 'x' ? width : depth, height, opening.axis === 'x' ? depth : width);
    mesh.userData.commonCollision = collision;
    mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh); pickMeshes.push(mesh); return mesh;
  }
  const thickness = .1, ceiling = 2.5, carHeight = 2.3;
  const slab = (name,b) => box(name,(b.minT+b.maxT)/2,(b.minS+b.maxS)/2,b.maxT-b.minT,b.maxS-b.minS,.1,-.1,materials.floor,false);
  slab('Illustrative corridor floor',hall);slab('Illustrative elevator floor',car);
  slab('Elevator threshold',{minT:-.8,maxT:.1,minS:3.1,maxS:3.2});
  // A short floor joins the unchanged source threshold; its width is the actual
  // source opening, without widening it or moving either original jamb.
  slab('Entrance threshold',{minT:-opening.width_m/2,maxT:opening.width_m/2,minS:0,maxS:.1});
  for (const t of [hall.minT-thickness/2,hall.maxT+thickness/2])
    box('Corridor wall',t,1.6,thickness,3,ceiling,0,materials.wall);
  for (const t of [car.minT-thickness/2,car.maxT+thickness/2])
    box('Elevator side',t,4.25,thickness,2.3,carHeight,0,materials.metal);
  box('Elevator back',-.35,5.35,1.8,thickness,carHeight,0,materials.metal);
  const gapMin=elevator.t-elevator.width/2,gapMax=elevator.t+elevator.width/2;
  for(const [a,b] of [[car.minT-thickness,gapMin],[gapMax,car.maxT+thickness]])
    box('Elevator front wall',(a+b)/2,elevator.s,b-a,thickness,ceiling,0,materials.wall);
  box('Elevator lintel',elevator.t,elevator.s,elevator.width,thickness,ceiling-elevator.height,elevator.height,materials.trim);
  // Close the extra left side at the source facade. The real doorway remains
  // the only return route; source walls and the animated leaf stay authoritative.
  const left=-opening.width_m/2;
  if(left>hall.minT)box('Landing return wall',(hall.minT+left)/2,.05,left-hall.minT,.1,ceiling,0,materials.wall);
  const right=opening.width_m/2;
  if(right<hall.maxT)box('Landing return wall',(right+hall.maxT)/2,.05,hall.maxT-right,.1,ceiling,0,materials.wall);
  box('Corridor ceiling',-.25,1.6,1.5,3,.1,ceiling,materials.wall);
  box('Elevator ceiling',-.35,4.25,1.6,2.1,.1,carHeight,materials.wall);
  box('Elevator header',-.35,3.08,.52,.035,.16,2.17,materials.trim,false);
  const pivot = new Group(); pivot.name = 'Illustrative elevator door';group.add(pivot);
  const leaves = [-1,1].map(side => ({side,mesh:box('Elevator moving leaf',elevator.t+side*elevator.width/4,elevator.s,elevator.width/2,.035,elevator.height,0,materials.metal,true,pivot)}));
  const door = new MovingDoor({id:'common-area:elevator',name:'예시 엘리베이터 문',type:'sliding'},pivot,pivot,progress => {
    for(const {side,mesh} of leaves){const [px,pz]=point(elevator.t+side*(elevator.width/4+progress*(elevator.width/2+.025)),elevator.s);mesh.position.x=px;mesh.position.z=pz;}
  });
  // A closed center seam can fall between the two leaf raycasts by a floating
  // point epsilon. One non-rendered, non-colliding interaction surface covers
  // exactly the closed doorway; remove it from picking as soon as it opens.
  const closedDoorPick=box('Closed elevator interaction surface',elevator.t,elevator.s,elevator.width,.035,elevator.height,0,materials.metal,false);
  closedDoorPick.visible=false;closedDoorPick.userData.doorId=door.definition.id;pickMeshes.pop();
  const call = box('Elevator call button',.28,3.08,.09,.04,.13,1.13,materials.button,false);
  call.userData.doorId=door.definition.id;
  const insideCall=box('Elevator inside button',.38,3.45,.04,.1,.13,1.13,materials.button,false);
  insideCall.userData.doorId=door.definition.id;
  const light = new PointLight(0xffefd7,9,7,2);const [lx,lz]=point(-.25,2);light.position.set(lx,2.25,lz);group.add(light);
  group.updateMatrixWorld(true);
  const staticTree=collisionTree(group,object=>object.userData.commonCollision&&!object.userData.doorId);
  const world=combinedWorld(staticTree,[door]);
  const contains=(x,z)=>{const [t,s]=layout.local(x,z);return s>=0&&s<=5.4&&t>=-1.25&&t<=.6;};
  return {group,layout,world,doors:[door],doorById:new Map([[door.definition.id,door]]),get pickMeshes(){return Math.abs(door.progress)<1e-4?[...pickMeshes,closedDoorPick]:pickMeshes;},contains,
    inspect:()=>({basis:layout.basis,floorTravel:false,scale:group.scale.toArray(),hallWidth_m:1.5,carSize_m:[1.6,2.1,carHeight],doorWidth_m:.9,sourceOpening:opening.id,center_m:opening.center_m,outward:layout.outward,footprints:layout.footprints,elevatorDoor:door.getState()}),
    dispose(){group.removeFromParent();geometry.dispose();for(const material of Object.values(materials))material.dispose();},
  };
}
