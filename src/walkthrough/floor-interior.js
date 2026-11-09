import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import fixture from '../../assets/location/acro-river-park/floor-interior-layout.json' with {type:'json'};
import {modelSources} from '../paired-floor/scene.js';
import {createPairedDetails} from '../paired-floor/details.js';
import {createPairedArchitecturalDetails} from '../paired-floor/architectural-details.js';
import {createFloorInteriorCommon} from './floor-interior-common.js';
import {archisketchWebData,bindArchisketchModel} from './archisketch-model.js';
import {createDoors} from './doors.js';
import {batchStaticMeshes} from './static-batches.js';
import {createBakedLighting,lightingModelId} from './baked-lighting.js';
import {floorInteriorAvailability,floorInteriorPlacement} from './floor-interior-contract.js';

async function readJSON(url){const response=await fetch(url);if(!response.ok)throw Error(`공간 자료 로딩 실패 (${response.status})`);return response.json();}
function label(text,position,width=7){
  const canvas=document.createElement('canvas');let ctx=canvas.getContext('2d');ctx.font='600 56px "Cortex Nanum", sans-serif';canvas.width=Math.ceil(ctx.measureText(text).width)+52;canvas.height=104;ctx=canvas.getContext('2d');const w=canvas.width;
  ctx.fillStyle='rgba(250,249,243,.94)';ctx.beginPath();ctx.roundRect(3,3,w-6,98,18);ctx.fill();
  ctx.strokeStyle='#adb7a1';ctx.lineWidth=3;ctx.stroke();ctx.fillStyle='#254737';ctx.font='600 56px "Cortex Nanum", sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,w/2,54,w-28);
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map,depthTest:false,depthWrite:false}));sprite.position.set(...position);sprite.scale.set(width,width*104/w,1);sprite.renderOrder=10;sprite.name=text;sprite.userData.collisionDisabled=true;return sprite;
}
export function createFloorInterior(scene,invalidate) {
  const cache=new Map();let sequence=0,active=null,status='idle',request=null,error='';
  function hide(){sequence++;status='idle';request=null;error='';if(active){active.root.visible=false;for(const unit of active.units)unit.bakedLighting?.setEnabled(false);}invalidate();}
  async function load(variant,fiveUnits=false) {
    const key=`${fiveUnits?'siteplan-five-v1':'legacy-pair'}:${variant}`;
    if(cache.has(key))return cache.get(key);
    const promise=(async()=>{
      if(fiveUnits){const {loadFiveUnitFloor}=await import('./floor-five-unit.js');const result=await loadFiveUnitFloor(variant);result.fiveUnits=true;result.root.visible=false;scene.add(result.root);return result;}
      const layout=fixture.variants[variant],root=new THREE.Group();root.name=`100 floor / inline assumed layout ${variant}`;
      const units=await Promise.all(layout.units.map(async placement=>{
        const source=modelSources[placement.id][variant];
        const [metadata,gltf]=await Promise.all([readJSON(source.info),new GLTFLoader().loadAsync(source.glb)]);
        metadata.unit_type??=placement.id.toUpperCase();
        const data=archisketchWebData(metadata);bindArchisketchModel(gltf,data.info);
        const bakedLighting=createBakedLighting(gltf,lightingModelId(placement.id,variant));bakedLighting.setEnabled(true);await bakedLighting.ensure();
        const model=gltf.scene,doors=createDoors(model,data.doors.map(door=>({...door,id:`floor-preview:${placement.id}:${variant}:${door.sourceOpening}`})));
        model.position.set(...placement.translation);model.rotation.y=placement.rotationYRadians;model.scale.set(1,1,1);model.updateMatrixWorld(true);
        for(const door of doors)door.setProgress(0);
        model.traverse(object=>{if(object.isMesh&&['base','decoration','ceiling'].includes(object.userData.component))object.visible=false;});
        root.add(model);return {id:placement.id,placement,info:data.info,model,doors,source,bakedLighting};
      }));
      const common=createFloorInteriorCommon(layout.common);root.add(common.group);
      const details=createPairedDetails({layout,units,includeCommon:false});root.add(details.group);
      const architecture=units.filter(u=>u.id==='211a').map(unit=>createPairedArchitecturalDetails(unit).stats);
      root.traverse(object=>{if(!object.isMesh)return;if(object.userData.component==='ceiling')object.visible=false;object.receiveShadow=true;object.castShadow=false;});
      root.updateMatrixWorld(true);
      const boundsByUnit=Object.fromEntries(units.map(unit=>[unit.id,new THREE.Box3().setFromObject(unit.model)]));
      boundsByUnit.common=common.bounds.clone();
      const bounds=new THREE.Box3();for(const part of fixture.footprintParts)for(const [x,z] of part.polygon)bounds.expandByPoint(new THREE.Vector3(x,0,z));bounds.max.y=2.7;
      for(const unit of units){const center=boundsByUnit[unit.id].getCenter(new THREE.Vector3());const sprite=label(unit.id==='211a'?'211A':'168C',[center.x,3.1,center.z],4.6);sprite.userData.focus=unit.id;root.add(sprite);}
      root.add(label('도면 미확보 영역',[5,1.2,60],10));
      for(const item of common.labels??[]){const sprite=label(item.text.startsWith('엘리베이터')?'엘리베이터':item.text,item.position,item.width??4);sprite.userData.focus='common';sprite.userData.maxFloor=item.maxFloor;root.add(sprite);}
      const batches=[...units.map(unit=>batchStaticMeshes(unit.model)),batchStaticMeshes(common.group.children[0]),batchStaticMeshes(details.group)];
      root.visible=false;scene.add(root);
      return {variant,root,units,bounds,boundsByUnit,common,details:details.stats,architecture,
        batching:{sourceMeshes:batches.reduce((n,b)=>n+b.sourceMeshes,0),drawMeshes:batches.reduce((n,b)=>n+b.drawMeshes,0)}};
    })();cache.set(key,promise);
    promise.catch(()=>{if(cache.get(key)===promise)cache.delete(key);});return promise;
  }
  async function show(building,floor,variant='expanded') {
    const availability=floorInteriorAvailability(building.id,floor);if(!availability.available){hide();return false;}
    const token=++sequence;request={building:building.id,floor,variant};status='loading';error='';if(active){active.root.visible=false;for(const unit of active.units)unit.bakedLighting?.setEnabled(false);}invalidate();
    try{
      const next=await load(variant,availability.fiveUnits);if(token!==sequence)return false;
      active=next;for(const unit of next.units){unit.bakedLighting?.setEnabled(true);unit.bakedLighting?.sync();}if(!next.fiveUnits){next.bounds.makeEmpty();for(const part of fixture.footprintParts.filter(part=>part.levels>=floor))for(const [x,z] of part.polygon)next.bounds.expandByPoint(new THREE.Vector3(x,0,z));next.bounds.max.y=2.7;}next.root.traverse(object=>{if(Number.isFinite(object.userData.maxFloor))object.visible=floor<=object.userData.maxFloor;});const placement=floorInteriorPlacement(building,floor);next.root.position.fromArray(placement.position);next.root.visible=true;next.root.updateMatrixWorld(true);
      next.placement=placement;next.availability=availability;status='ready';invalidate();return true;
    }catch(cause){if(token!==sequence)return false;status='error';error=cause.message;invalidate();return false;}
  }
  function bounds(part='all') {
    if(!active?.root.visible)return null;
    return (part==='all'?active.bounds:active.boundsByUnit[part]??active.bounds).clone().applyMatrix4(active.root.matrixWorld);
  }
  return {show,hide,bounds,setLabelFocus(part){if(!active)return;for(const object of active.root.children)if(object.isSprite)object.visible=(part==='all'||object.userData.focus===part||object.userData.unitType===part)&&(!Number.isFinite(object.userData.maxFloor)||active.availability.floor<=object.userData.maxFloor);},
    inspect:()=>({status,error,request,cachedVariants:[...cache.keys()],visible:Boolean(active?.root.visible),variant:active?.variant,placement:active?.placement,availability:active?.availability,batching:active?.batching,architecture:active?.architecture,common:active?.common.stats,
      labels:active?.root.children.filter(o=>o.isSprite).map(o=>({name:o.name,position:o.position.toArray(),visible:o.visible}))??[],unknownParts:active?.common.group.children[1]?.children.map(o=>({maxFloor:o.userData.maxFloor,visible:o.visible}))??[],layoutBasis:active?.fiveUnits?'Siteplan-relative five-unit review; metric scale1; actual outline and shared core unverified':fixture.basis,fiveUnits:active?.fiveUnits??false,units:active?.units.map(u=>({id:u.id,bakedLighting:u.bakedLighting?.inspect(),type:u.type??u.id,scale:u.model.scale.toArray(),position:u.model.position.toArray(),rotationY:u.model.rotation.y,source:u.source.glb,rooms:u.info?.rooms?.length??0}))??[]}),
    contains(object){let current=object;while(current){if(current===active?.root)return true;current=current.parent;}return false;}
  };
}
