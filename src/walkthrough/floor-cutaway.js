import * as THREE from 'three';

// Display offsets avoid a coplanar roof/floor. They never change source dimensions.
export const CUTAWAY_ROOF_OFFSET_M = .01;
export const CUTAWAY_PLATE_OFFSET_M = .02;
export function floorCutawayState(building, requestedFloor, {enabled=true, selected=true, interiorSection=false}={}) {
  const floor = requestedFloor === null ? null : Number(requestedFloor);
  const supported = Number.isInteger(floor) && floor >= 1 && floor <= building.floors;
  const active = Boolean(enabled && selected && supported);
  const bottom = supported ? (floor - 1) * building.height_m / building.floors : null;
  const top = supported ? floor * building.height_m / building.floors : null;
  return {enabled:Boolean(enabled), active, supported, buildingId:building.id, requestedFloor:floor,
    reason:!selected?'no-selection':!supported?'outside-envelope':!enabled?'disabled':'selected-floor',
    bottom_m:bottom, nominalTop_m:top, clipTop_m:active?(interiorSection?bottom+.14:top-CUTAWAY_ROOF_OFFSET_M):null,
    interiorSection:Boolean(interiorSection&&active), sectionRimHeight_m:interiorSection&&active ? .14 : null,
    plateY_m:active?bottom+CUTAWAY_PLATE_OFFSET_M:null, displayRoofOffset_m:CUTAWAY_ROOF_OFFSET_M,
    plateBasis:'OSM footprint only; interior layout unknown'};
}
function plateGeometry(points) {
  const shape=new THREE.Shape();
  points.forEach(([x,z],i)=>i?shape.lineTo(x,-z):shape.moveTo(x,-z));shape.closePath();
  return new THREE.ShapeGeometry(shape).rotateX(-Math.PI/2);
}

// Each building supplies exclusive material instances; their texture/geometry stay shared.
export function createFloorCutaway(buildings) {
  const records=buildings.map(building=>{
    const plane=new THREE.Plane(new THREE.Vector3(0,-1,0),0);
    const originals=building.cutawayMaterials.map(material=>({material,planes:material.clippingPlanes,
      shadows:material.clipShadows,intersection:material.clipIntersection}));
    const material=new THREE.MeshStandardMaterial({color:0xe6d4ab,roughness:.9,side:THREE.DoubleSide});
    const plates=building.parts.map(part=>{
      const mesh=new THREE.Mesh(plateGeometry(part.footprint_m),material);
      mesh.name='Selected floor / footprint reference only';mesh.visible=false;mesh.receiveShadow=true;
      building.tower.add(mesh);return {mesh,part};
    });
    return {building,plane,originals,plates,active:false};
  });
  let state=null;
  function update(selected, floor, options) {
    state=floorCutawayState(selected,floor,options);
    for(const record of records){
      const active=state.active&&record.building===selected;
      if(active)record.plane.constant=state.clipTop_m;
      if(active!==record.active){
        for(const original of record.originals){
          original.material.clippingPlanes=active?[...(original.planes||[]),record.plane]:original.planes;
          original.material.clipShadows=active?true:original.shadows;
          original.material.clipIntersection=active?false:original.intersection;
          original.material.needsUpdate=true;
        }
        record.active=active;
      }
      for(const {mesh,part} of record.plates){
        mesh.visible=active&&part.levels>=state.requestedFloor&&part.height_m>state.plateY_m;
        if(mesh.visible)mesh.position.y=state.plateY_m;
      }
      record.building.label.position.y=(active?state.clipTop_m:record.building.height_m)+8;
    }
    return state;
  }
  const acceptsHit=hit=>!state?.active||hit.object.userData.buildingId!==state.buildingId||hit.point.y<=state.clipTop_m+1e-6;
  function inspect(){return {...state,buildings:records.map(r=>({id:r.building.id,active:r.active,
    materialPlanes:r.originals.map(o=>({count:o.material.clippingPlanes?.length||0,clipShadows:o.material.clipShadows,
      planes:(o.material.clippingPlanes||[]).map(p=>({normal:p.normal.toArray(),constant:p.constant}))})),
    plates:r.plates.map(p=>({visible:p.mesh.visible,y:p.mesh.position.y})),labelY:r.building.label.position.y}))};}
  return {update,acceptsHit,inspect,get state(){return state;}};
}
