import * as THREE from 'three';
import { inspectPose } from '../floor-access/transport.js';

// Review envelope only: no effect on the pedestrian or original model collision.
export function createTransportView(scene, invalidate) {
  const group = new THREE.Group(); group.name = 'Furniture transport review overlay'; scene.add(group);
  let report = null, progress = 0, pose = null, check = null;
  const disposeChildren = () => {
    for (const child of [...group.children]) { child.geometry?.dispose(); child.material?.dispose(); group.remove(child); }
  };
  function draw() {
    disposeChildren();
    const path = report?.route?.selectedCandidate?.poses ?? report?.route?.poses;
    if (!report?.valid || !path?.length) { invalidate(); return; }
    const lengths = path.slice(1).map((p, i) => Math.hypot(p.x-path[i].x,p.z-path[i].z) + Math.abs(p.yaw-path[i].yaw)*.5);
    let distance=progress*lengths.reduce((a,b)=>a+b,0), index=0;
    while (index<lengths.length-1 && distance>lengths[index]) distance-=lengths[index++];
    const a=path[index], b=path[Math.min(index+1,path.length-1)], t=lengths[index]>0?distance/lengths[index]:0;
    pose={x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,yaw:a.yaw+(b.yaw-a.yaw)*t,bottomY:(a.bottomY??0)+((b.bottomY??0)-(a.bottomY??0))*t};
    check=inspectPose({...report.cargo,...pose},report.environment.obstacles,{clearance:report.clearance});
    const color=check.clear?0x2b856d:0xcc713e;
    const geometry=new THREE.BoxGeometry(report.cargo.width,report.cargo.height,report.cargo.depth);
    const box=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color,transparent:true,opacity:.23,depthWrite:false}));
    box.position.set(pose.x,pose.bottomY+report.cargo.height/2,pose.z);box.rotation.y=pose.yaw;group.add(box);
    const outline=new THREE.LineSegments(new THREE.EdgesGeometry(geometry),new THREE.LineBasicMaterial({color}));outline.position.copy(box.position);outline.rotation.copy(box.rotation);group.add(outline);
    const route=new THREE.Line(new THREE.BufferGeometry().setFromPoints(path.map(p=>new THREE.Vector3(p.x,.035,p.z))),new THREE.LineDashedMaterial({color:0x416d80,dashSize:.12,gapSize:.09}));route.computeLineDistances();group.add(route);
    for(const child of group.children){child.userData.component='decoration';child.userData.collisionDisabled=true;}
    invalidate();
  }
  return {
    set(next,fraction=0){report=next;progress=THREE.MathUtils.clamp(fraction,0,1);draw();},
    progress(fraction){progress=THREE.MathUtils.clamp(fraction,0,1);draw();},
    clear(){report=null;pose=null;check=null;disposeChildren();invalidate();},
    inspect(){return {visible:Boolean(report),progress,pose,poseCheck:check};},
    dispose(){disposeChildren();scene.remove(group);},
  };
}
