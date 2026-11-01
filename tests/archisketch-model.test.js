import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Box3, Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {archisketchWebData, bindArchisketchModel} from '../src/walkthrough/archisketch-model.js';
import {createDoors, collisionTree, combinedWorld} from '../src/walkthrough/doors.js';
import {canStand, moveWithCollisions} from '../src/walkthrough/movement.js';
import {wallSlicePath,wallSectionPath} from '../src/walkthrough/wall-slice.js';

for (const variant of ['basic', 'expanded']) {
  test(`${variant}: real Archisketch GLB preserves dimensions, room access and door collision`, async () => {
    const base = new URL(`../assets/models/acro-river-park/168c/archisketch-structure-v1/${variant}/`, import.meta.url);
    const source = JSON.parse(readFileSync(new URL('model-info.json', base)));
    const data = archisketchWebData(source);
    const bytes = readFileSync(new URL(`acro168c-${variant}-archisketch.glb`, base));
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    bindArchisketchModel(gltf, data.info);
    const meshes = new Map(); gltf.scene.traverse(o => {if (o.isMesh) meshes.set(o.userData.object_id, o);});
    assert.equal(meshes.size, source.mesh_count);
    assert.deepEqual(gltf.scene.scale.toArray(), [1, 1, 1]);
    for (const r of source.rooms) {
      const b = new Box3().setFromObject(meshes.get(`Floor/${r.id}`));
      [b.min.x, b.min.z, b.max.x, b.max.z].forEach((v,i) => assert.ok(Math.abs(v-r.bounds_m[i]) < .00001, r.id));
    }
    const doors = createDoors(gltf.scene, data.doors);
    const tree = collisionTree(gltf.scene, o => !o.userData.doorId && !o.userData.collisionDisabled && data.info.objects[o.userData.object_id]?.category !== 'Ceilings');
    const world = combinedWorld(tree, doors);
    for (const r of source.rooms) assert.ok(canStand(world, new Vector3(r.representative_point_m[0], 1.6, r.representative_point_m[1])), r.id);
    for (const openingId of ['door-05', 'primary-balcony-door', 'living-balcony-door']) {
      const o = source.openings.find(o => o.id === openingId);
      const door = doors.find(d => d.definition.sourceOpening === openingId);
      assert.ok(door, openingId);
      const alongX = o.axis === 'x', clear = o.clear_span_m?.[0] ?? o.width_m - .1;
      const offset = o.kind === 'sliding' ? -clear/4 : 0;
      const x = o.center_m[0] + (alongX ? offset : 0), z = o.center_m[1] + (alongX ? 0 : offset);
      const passage = new Vector3(x-(alongX?0:.1), 1.6, z-(alongX?.1:0));
      assert.equal(canStand(world, passage), false, openingId+' closed');
      const approach = new Vector3(x-(alongX?0:.75), 1.6, z-(alongX?.75:0));
      const delta = new Vector3(alongX?0:1.5, 0, alongX?1.5:0);
      const blocked = approach.clone(); moveWithCollisions(world, blocked, delta);
      assert.ok((alongX?blocked.z:blocked.x) < (alongX?z:x), openingId+' blocks');
      door.setProgress(1);
      assert.equal(canStand(world, passage), true, openingId+' open');
      moveWithCollisions(world, approach, delta);
      assert.ok((alongX?approach.z:approach.x) > (alongX?z:x)+.65, openingId+' traversable');
      door.setProgress(0);
    }
    if (variant === 'basic') assert.ok(!doors.some(d => d.definition.sourceOpening === 'sliding-18'), 'facade glazing stays fixed');
    const wall = [...meshes.values()].find(o => o.userData.component==='wall' && o.userData.layer_bottom_m < 1 && new Box3().setFromObject(o).max.y > 1);
    assert.match(wallSlicePath(wall), /^M/);
    // Filled contours must retain real wall thickness without covering room interiors.
    const path=wallSectionPath(wall);assert.match(path,/Z/);
    const contours=path.split(' ').map(p=>p.slice(1,-1).split('L').map(v=>v.split(',').map(Number)));
    const contains=(poly,x,y)=>{let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){
      const [xi,yi]=poly[i],[xj,yj]=poly[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;
    }return inside;};
    for(const r of source.rooms){const [x,z]=r.representative_point_m;assert.equal(contours.filter(c=>contains(c,x,z)).length%2,0,r.id+' is not filled as a wall');}
    assert.equal(wallSectionPath(meshes.get('Floor/bedroom-1')),'');
    assert.equal(wallSlicePath(meshes.get('Floor/bedroom-1')), '');
  });
}

for (const variant of ['basic', 'expanded']) {
  test(`112A ${variant}: source polygon bounds, GLB scale and navigable room spawns`, async () => {
    const base = new URL(`../assets/models/acro-river-park/112a/archisketch-structure-v1/${variant}/`, import.meta.url);
    const source = JSON.parse(readFileSync(new URL('model-info.json', base)));
    const data = archisketchWebData(source);
    const bytes = readFileSync(new URL(`acro112a-${variant}-archisketch.glb`, base));
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    bindArchisketchModel(gltf, data.info);
    const meshes = new Map(); gltf.scene.traverse(o => { if(o.isMesh) meshes.set(o.userData.object_id,o); });
    assert.equal(data.info.unitType,'112A'); assert.equal(data.info.ceilingHeight_m,2.6);
    assert.equal(meshes.size,source.mesh_count); assert.deepEqual(gltf.scene.scale.toArray(),[1,1,1]);
    for(const r of source.rooms) {
      const b = new Box3().setFromObject(meshes.get(`Floor/${r.id}`));
      [b.min.x,b.min.z,b.max.x,b.max.z].forEach((v,i)=>assert.ok(Math.abs(v-r.bounds_m[i])<.00001,r.id));
    }
    const doors=createDoors(gltf.scene,data.doors);
    const tree=collisionTree(gltf.scene,o=>!o.userData.doorId&&!o.userData.collisionDisabled&&data.info.objects[o.userData.object_id]?.category!=='Ceilings');
    const world=combinedWorld(tree,doors);
    for(const r of source.rooms.filter(r=>r.navigable!==false)) assert.ok(canStand(world,new Vector3(r.representative_point_m[0],1.6,r.representative_point_m[1])),r.id);
    // A bedroom: test crossing an actual closed/open source leaf with the viewer capsule.
    const openingId='door-01',o=source.openings.find(o=>o.id===openingId),door=doors.find(d=>d.definition.sourceOpening===openingId);
    const alongX=o.axis==='x',[x,z]=o.center_m;
    const start=new Vector3(x-(alongX?0:.7),1.6,z-(alongX?.7:0));
    const delta=new Vector3(alongX?0:1.4,0,alongX?1.4:0);
    const blocked=start.clone();moveWithCollisions(world,blocked,delta);
    assert.ok((alongX?blocked.z:blocked.x)<(alongX?z:x),'closed door blocks');
    door.setProgress(1);const passed=start.clone();moveWithCollisions(world,passed,delta);
    assert.ok((alongX?passed.z:passed.x)>(alongX?z:x)+.6,'open door permits walking');
  });
}
