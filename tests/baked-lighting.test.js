import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, BufferAttribute, Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import { applyBakedLightingPolicy, inheritBakedLightingPolicy, syncBakedLightingPolicy, bakedLightingPolicy } from '../src/walkthrough/baked-lighting-policy.js';
import { setBakedRenderData } from '../src/walkthrough/baked-lighting-geometry.js';
import { batchStaticMeshes } from '../src/walkthrough/static-batches.js';
import { createSurfaceTargets, surfaceRenderParts } from '../src/walkthrough/surface-targets.js';
import { SurfaceMaterialLibrary } from '../src/walkthrough/surface-material-library.js';
import { FinishLibrary } from '../src/walkthrough/finishes.js';
const state = () => ({atlas:new Texture(),range:8,enabled:true,materials:new Set()});
function fixture() {
 const root=new Group(),source=new MeshStandardMaterial(),g=new BoxGeometry(3,2,.2),mesh=new Mesh(g,source);
 source.name='Warm ivory plaster';mesh.userData={component:'wall',object_id:'Wall/fixture'};root.add(mesh);
 const render=g.toNonIndexed();render.setAttribute('uv1',new BufferAttribute(new Float32Array(render.attributes.position.count*2).fill(.3),2));
 const policy=state(),material=source.clone();applyBakedLightingPolicy(material,policy);setBakedRenderData(mesh,{geometry:render,material});return{root,source,mesh,g,render,material,policy};
}
test('RGBM shader decodes four neighbours before filtering, replacing only indirect diffuse',()=>{
 const m=new MeshStandardMaterial();applyBakedLightingPolicy(m,state());const shader={fragmentShader:'#include <lights_fragment_maps>'};m.onBeforeCompile(shader);
 assert(shader.fragmentShader.includes('texelFetch'));assert(shader.fragmentShader.includes('lmA.rgb*lmA.a'));assert(shader.fragmentShader.includes('getIBLRadiance'));assert(shader.fragmentShader.includes('#else'));assert(shader.fragmentShader.includes('irradiance=vec3(0.0)'));
 assert.equal(m.lightMapIntensity,Math.PI);assert.equal(m.lightMap.channel,0); // Texture channel assigned by loader, not policy.
});
test('day fallback and manually cloned surface preserve shader policy and loader normal sign',async()=>{
 const f=fixture(),library=new SurfaceMaterialLibrary({loadTexture:async()=>new Texture()});const asset=await library.load('greige-plaster-v1');
 const owned=library.material(asset,f.material,f.render);assert.equal(bakedLightingPolicy(owned.material),f.policy);assert.equal(owned.material.lightMap,f.policy.atlas);assert.deepEqual(owned.material.normalScale.toArray(),[1,-1]);
 f.policy.enabled=false;syncBakedLightingPolicy(owned.material);assert.equal(owned.material.lightMap,null);f.policy.enabled=true;syncBakedLightingPolicy(owned.material);assert.equal(owned.material.lightMap,f.policy.atlas);
 owned.dispose();assert(!f.policy.materials.has(owned.material));
});
test('lightmapped render batches preserve source position/index/UV identity and can safely rebuild',()=>{
 const f=fixture(),index=f.g.index,p=f.g.attributes.position,uv=f.g.attributes.uv;const bytes=Buffer.from(p.array.buffer).toString('hex');
 const result=batchStaticMeshes(f.root);assert.equal(result.drawMeshes,1);assert.equal(f.mesh.geometry,f.g);assert.equal(f.g.index,index);assert.equal(f.g.attributes.position,p);assert.equal(f.g.attributes.uv,uv);assert.equal(f.g.getAttribute('uv1'),undefined);assert.equal(result.batches[0].material,f.material);assert(result.batches[0].geometry.hasAttribute('uv1'));assert.equal(Buffer.from(p.array.buffer).toString('hex'),bytes);
 result.restore();assert.equal(f.mesh.visible,true);assert.equal(f.mesh.userData.renderBatched,undefined);assert.equal(f.root.children.length,1);assert.equal(batchStaticMeshes(f.root).drawMeshes,1);
});
test('clicked structural surface receives per-corner UV1 while source surface IDs remain stable',()=>{
 const f=fixture(),before=createSurfaceTargets(f.root),target=[...before.targets.values()].find(x=>x.normal.z>.99),parts=surfaceRenderParts(target);
 assert(parts.length);assert(parts.every(x=>x.geometry.hasAttribute('uv1')&&x.material===f.material));assert(parts.every(x=>Array.from(x.geometry.attributes.uv1.array).every(v=>Math.abs(v-.3)<1e-6)));
 batchStaticMeshes(f.root);assert.deepEqual([...createSurfaceTargets(f.root).targets.keys()],[...before.targets.keys()]);assert.equal(f.mesh.geometry,f.g);parts.forEach(p=>p.geometry.dispose());
});
test('global finish resets skip owned lightmap batches and leave source lightMap unset',async()=>{
 const f=fixture();batchStaticMeshes(f.root);const atlas=f.material.lightMap;
 await new FinishLibrary({capabilities:{getMaxAnisotropy:()=>1}}).apply(f.root,'original');
 assert.equal(f.material.lightMap,atlas);assert.equal(f.source.lightMap,null);assert.equal(f.material.customProgramCacheKey(),'cortex-indirect-rgbm-v1:8');
});
test('inheriting an unbaked material does not install shader or texture',()=>{const a=new MeshStandardMaterial(),b=a.clone();const callback=b.onBeforeCompile;inheritBakedLightingPolicy(a,b);assert.equal(b.onBeforeCompile,callback);assert.equal(b.lightMap,null);});
