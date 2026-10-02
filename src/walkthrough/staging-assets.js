import * as THREE from 'three';
import { collisionTree } from './doors.js';
import { placementError } from './layout.js';

export function stagingAssets(model,info) {
  const items=[],templates=new Map(),obstacles=[];
  let serial=0,tree;
  function register(objects,id,title,kind) {
    const group=new THREE.Group();model.add(group);model.updateMatrixWorld(true);
    const box=new THREE.Box3();for(const o of objects)box.union(new THREE.Box3().setFromObject(o));
    const center=box.getCenter(new THREE.Vector3());group.position.set(center.x,0,center.z);group.updateMatrixWorld(true);
    for(const o of objects)group.attach(o);
    group.userData.stagingId=id;
    const size=box.getSize(new THREE.Vector3());
    const item={id,title,kind,width:size.x,depth:size.z,height:size.y,x:center.x,z:center.z,angle:0,deleted:false,group};
    item.initial={x:item.x,z:item.z,angle:0};items.push(item);
    if(!templates.has(kind))templates.set(kind,item);
    return item;
  }
  const catalog=[];model.traverse(o=>{if(o.userData.asset_id)catalog.push(o);});
  for(const o of catalog)register([o],o.userData.asset_id,o.userData.asset_id.includes('sofa')?'소파 2790':'스툴 980',o.userData.asset_id.includes('sofa')?'sofa':'stool');
  for(const [prefix,id,title,kind] of [['Master staged','king-bed','안방 킹 침대','king'],['West staged','single-west','서쪽 싱글 침대','single'],['Center staged','single-center','가운데 싱글 침대','single']]) {
    const objects=[];model.traverse(o=>{const name=info.objects[o.userData.object_id]?.name;if(name?.startsWith(prefix)&&!name.includes('nightstand'))objects.push(o);});
    if(objects.length)register(objects,id,title,kind);
  }
  model.updateMatrixWorld(true);
  model.traverse(o=>{
    if(!o.isMesh)return;
    let p=o;while(p){if(p.userData.stagingId)return;p=p.parent;}
    const meta=info.objects[o.userData.object_id];if(!meta)return;
    const fixed=['Kitchen','Bathrooms','Entry'].includes(meta.category)||meta.name.includes('nightstand')||meta.name.includes('wardrobe')||o.userData.wall_ref;
    if(!fixed)return;
    const b=new THREE.Box3().setFromObject(o),s=b.getSize(new THREE.Vector3()),c=b.getCenter(new THREE.Vector3());
    if(b.min.y>1.4||b.max.y<.10)return;
    obstacles.push({x:c.x,z:c.z,width:s.x,depth:s.z,angle:0});
  });
  function apply(item) {item.group.position.set(item.x,0,item.z);item.group.rotation.y=item.angle;item.group.visible=!item.deleted;model.updateMatrixWorld(true);}
  function rebuild(){tree=collisionTree(model,o=>{let p=o;while(p){if(p.userData.stagingId)return p.visible;p=p.parent;}return false;});}
  function snapshot(){return items.map(({id,title,kind,width,depth,height,x,z,angle,deleted})=>({id,title,kind,width,depth,height,x,z,angle,deleted}));}
  function add(kind,room) {
    const source=templates.get(kind);if(!source)return {error:'이 평면에서 사용할 수 없는 가구예요.'};
    const candidate={...source,id:`added-${++serial}`,deleted:false,angle:0};
    const [x1,z1,x2,z2]=room.bounds_m;let found=false;
    for(let z=z1+source.depth/2+.06;z<=z2-source.depth/2-.04&&!found;z+=.15)
      for(let x=x1+source.width/2+.06;x<=x2-source.width/2-.04;x+=.15){candidate.x=x;candidate.z=z;if(!placementError(candidate,room,items,obstacles)){found=true;break;}}
    if(!found)return {error:'이 방에는 겹치지 않게 배치할 공간이 부족해요.'};
    candidate.group=source.group.clone(true);candidate.group.userData.stagingId=candidate.id;
    candidate.group.traverse(o=>{delete o.userData.asset_id;});
    model.add(candidate.group);candidate.initial={x:candidate.x,z:candidate.z,angle:0};items.push(candidate);apply(candidate);rebuild();return {item:candidate};
  }
  function move(id,patch,room,commit=true) {
    const item=items.find(i=>i.id===id);if(!item)return '가구를 선택해 주세요.';
    const next={...item,...patch};const error=placementError(next,room,items,obstacles);if(error)return error;
    Object.assign(item,patch);apply(item);if(commit)rebuild();return null;
  }
  function reset(){for(const i of items){if(i.id.startsWith('added-')){model.remove(i.group);}else{Object.assign(i,i.initial,{deleted:false});apply(i);}}for(let n=items.length-1;n>=0;n--)if(items[n].id.startsWith('added-'))items.splice(n,1);rebuild();}
  rebuild();
  return {items,obstacles,templates,snapshot,rebuild,move,add,reset,
    remove(id){const i=items.find(i=>i.id===id);if(i){i.deleted=true;apply(i);rebuild();}},
    restore(saved,rooms){reset();for(const p of saved){if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.z)||!Number.isFinite(p.angle))continue;const room=rooms.find(r=>p.x>r.bounds_m[0]&&p.x<r.bounds_m[2]&&p.z>r.bounds_m[1]&&p.z<r.bounds_m[3]);let item=items.find(i=>i.id===p.id);if(!item&&p.id?.startsWith('added-')&&room)item=add(p.kind,room).item;if(!item)continue;if(p.deleted){item.deleted=true;apply(item);}else if(room)move(item.id,{x:p.x,z:p.z,angle:p.angle},room,false);}rebuild();},
    capsuleIntersect(body){return tree.capsuleIntersect(body);},
  };
}
