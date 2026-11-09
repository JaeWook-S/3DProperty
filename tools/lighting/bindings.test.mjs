import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {compileBindings} from './build-bindings.mjs';
import {finalizeModel,rebuildManifest} from './finalize-lightmaps.mjs';
const root=path.resolve('runtime/web-quality/2026-11-09-lightmaps/bindings/test-fixtures');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const jsonWrite=async(p,x)=>fs.writeFile(p,JSON.stringify(x));

async function fixture(name,{existingUV1=false,coincidentCorners=false,ambiguousCoincidentUV=false}={}){
 const dir=path.join(root,name);await fs.mkdir(dir,{recursive:true});
 const positions=new Float32Array([0,0,0,1,0,0,1,1,0,0,1,0]);
 const normals=new Float32Array([0,0,1,0,0,1,0,0,1,0,0,1]);
 const uv0=new Float32Array([0,0,2,0,2,3,0,3]);const ia=new Uint16Array(coincidentCorners?[0,0,2]:[0,1,2]),ib=new Uint16Array([0,2,3]);
 const arrays=[positions,normals,uv0,ia,ib],views=[],chunks=[];let offset=0;
 for(const a of arrays){const b=Buffer.from(a.buffer);const pad=(4-b.length%4)%4;views.push({buffer:0,byteOffset:offset,byteLength:b.length});chunks.push(b,Buffer.alloc(pad));offset+=b.length+pad;}
 const matrix=new THREE.Matrix4().compose(new THREE.Vector3(4.3,1.2,-6.1),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),0.37),new THREE.Vector3(1,1,1));
 const attrs={POSITION:0,NORMAL:1,TEXCOORD_0:2};if(existingUV1)attrs.TEXCOORD_1=2;
 const doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'Wall/fixture',mesh:0,matrix:matrix.toArray()}],meshes:[{name:'Fixture',primitives:[{attributes:attrs,indices:3,mode:4},{attributes:attrs,indices:4,mode:4}]}],buffers:[{byteLength:offset}],bufferViews:views,accessors:[{bufferView:0,componentType:5126,count:4,type:'VEC3',min:[0,0,0],max:[1,1,0]},{bufferView:1,componentType:5126,count:4,type:'VEC3'},{bufferView:2,componentType:5126,count:4,type:'VEC2'},{bufferView:3,componentType:5123,count:3,type:'SCALAR'},{bufferView:4,componentType:5123,count:3,type:'SCALAR'}]};
 const j0=Buffer.from(JSON.stringify(doc)),j=Buffer.concat([j0,Buffer.alloc((4-j0.length%4)%4,32)]),bin=Buffer.concat(chunks);
 const head=Buffer.alloc(12);head.writeUInt32LE(0x46546c67);head.writeUInt32LE(2,4);head.writeUInt32LE(12+8+j.length+8+bin.length,8);const jh=Buffer.alloc(8);jh.writeUInt32LE(j.length);jh.writeUInt32LE(0x4e4f534a,4);const bh=Buffer.alloc(8);bh.writeUInt32LE(bin.length);bh.writeUInt32LE(0x004e4942,4);
 const glb=Buffer.concat([head,jh,j,bh,bin]);const glbPath=path.join(dir,'source.glb');await fs.writeFile(glbPath,glb);
 const world=i=>new THREE.Vector3().fromArray(positions,i*3).applyMatrix4(matrix).toArray();
 const n=new THREE.Vector3(0,0,1).transformDirection(matrix).toArray();
 const sidecar={coordinate_system:'Three X/Y/Z meters',models:[{name:'Wall/fixture',component:'wall',source_id:'fixture-wall',room_id:null,triangles:[{p:Array.from(ia,world),n:coincidentCorners?[0,0,0]:n,uv:coincidentCorners?[[.1,.1],ambiguousCoincidentUV?[.2,.1]:[.1,.1],[.3,.3]]:[[.1,.1],[.3,.1],[.3,.3]]},{p:Array.from(ib,world),n,uv:[[.6,.6],[.8,.8],[.6,.8]]}]}]};
 const sidecarPath=path.join(dir,'uv1-sidecar.json');await jsonWrite(sidecarPath,sidecar);return {dir,glb,glbPath,sidecar,sidecarPath,outputDir:path.join(dir,'out'),modelId:'fixture-basic',reportPath:path.join(dir,'report.json')};
}

test('canonical indexed primitives, world transform, UV seams and original UV0 are preserved',async()=>{
 const f=await fixture('success');const before=sha(await fs.readFile(f.glbPath));const result=await compileBindings(f);assert.equal(result.passed,true);assert.equal(result.matchedTriangles,2);assert.equal(result.primitiveCount,2);assert.equal(result.maxVertexErrorM,0);assert.equal(result.allSourceAttributesExactAfterIndexExpansion,true);
 const bindings=JSON.parse(await fs.readFile(path.join(f.outputDir,'bindings.json')));assert.deepEqual(bindings.primitives.map(x=>[x.nodeIndex,x.meshIndex,x.primitiveIndex,x.byteOffset,x.vertexCount]),[[0,0,0,0,3],[0,0,1,24,3]]);assert.equal(sha(await fs.readFile(f.glbPath)),before);
 const uv=await fs.readFile(path.join(f.outputDir,'uv1.bin'));assert.equal(uv.length,48);assert.ok(Math.abs(uv.readFloatLE(0)-.1)<1e-7);assert.ok(Math.abs(uv.readFloatLE(24)-.6)<1e-7);
});

test('wrong geometry cannot silently receive matching-count lightmap',async()=>{
 const f=await fixture('wrong-position');f.sidecar.models[0].triangles[0].p[0][0]+=.01;await jsonWrite(f.sidecarPath,f.sidecar);await assert.rejects(compileBindings(f),/Binding validation failed/);await assert.rejects(fs.stat(path.join(f.outputDir,'bindings.json')),/ENOENT/);
});

test('partial sidecar mapping fails closed rather than dropping missing triangles',async()=>{
 const f=await fixture('missing-triangle');f.sidecar.models[0].triangles.pop();await jsonWrite(f.sidecarPath,f.sidecar);await assert.rejects(compileBindings(f),/Binding validation failed/);
});

test('duplicate sanitized owners and preexisting UV1 are rejected',async()=>{
 const f=await fixture('duplicate-owner');f.sidecar.models.push({...f.sidecar.models[0],name:'Wallfixture'});await jsonWrite(f.sidecarPath,f.sidecar);await assert.rejects(compileBindings(f),/Duplicate sanitized/);
 const uv=await fixture('existing-uv1',{existingUV1:true});await assert.rejects(compileBindings(uv),/already contains UV1/);
});

test('finalizer validates source/bake/image hashes, emits only complete packages, rejects stale source',async()=>{
 const f=await fixture('finalizer');const id=f.modelId,bakesDir=path.join(f.dir,'bakes'),b=path.join(bakesDir,id);await fs.mkdir(b,{recursive:true});
 const blend=Buffer.from('test fixture Blender source; not a render'),exr=Buffer.from('test fixture baked HDR; hash verification only');const blendPath=path.join(f.dir,'source.blend');await fs.writeFile(blendPath,blend);await fs.copyFile(f.sidecarPath,path.join(b,'uv1-sidecar.json'));await fs.writeFile(path.join(b,'indirect-4096.exr'),exr);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');await fs.writeFile(path.join(b,'indirect-4096-rgbm.png'),png);
 const bake={id,passed:true,source_unchanged:true,positions_unchanged:true,samples:4096,receivers:1,triangle_count:2,source_glb_sha256:sha(f.glb),source_sha256:sha(blend),sidecar_sha256:sha(await fs.readFile(f.sidecarPath)),exr_sha256:sha(exr)};
 await jsonWrite(path.join(b,'verification.json'),bake);const codec={passed:true,encoding:'RGBM8',range:8,shader_decode:'decode BEFORE bilinear',mipmaps:false,png_sha256:sha(png),rgbm_png_bytes:png.length,dimensions:[1,1],texture_memory_bytes:4};await jsonWrite(path.join(b,'rgbm-verification.json'),codec);
 const inputsPath=path.join(f.dir,'inputs.json');await jsonWrite(inputsPath,[{unit_type:'fixture',variant:'basic',glb_path:f.glbPath,blend_path:blendPath,glb_sha256:sha(f.glb),blend_sha256:sha(blend)}]);const assetsDir=path.join(f.dir,'assets'),reportsDir=path.join(f.dir,'reports');
 const options={id,inputsPath,bakesDir,assetsDir,reportsDir};const r=await finalizeModel(options);assert.equal(r.passed,true);assert.equal(r.sourceAndReceiverGeometryPreserved,true);
 const manifest=await rebuildManifest({assetsDir});assert.deepEqual(Object.keys(manifest.models),[id]);assert.equal(manifest.models[id].bindings,`${id}/bindings.json`);assert.equal(manifest.models[id].samples,4096);assert.equal(manifest.models[id].sha256.atlas,sha(png));
 await fs.appendFile(f.glbPath,'changed');await assert.rejects(finalizeModel(options),/source GLB mismatch/);
 await fs.writeFile(f.glbPath,f.glb);codec.passed=false;await jsonWrite(path.join(b,'rgbm-verification.json'),codec);await assert.rejects(finalizeModel(options),/codec verification not passed/);
});


test('exact coincident zero-area corners retain source order when UV assignment is unambiguous',async()=>{
 const f=await fixture('coincident-corners',{coincidentCorners:true});
 const before=sha(await fs.readFile(f.glbPath)); const r=await compileBindings(f);
 assert.equal(r.passed,true);assert.equal(r.matchedTriangles,2);assert.equal(r.coincidentCornersPreserved.length,1);assert.equal(r.maxVertexErrorM,0);
 assert.equal(sha(await fs.readFile(f.glbPath)),before);
 const b=await fs.readFile(path.join(f.outputDir,'uv1.bin'));assert.equal(b.length,48);assert.equal(b.readFloatLE(0),b.readFloatLE(8));assert.equal(b.readFloatLE(4),b.readFloatLE(12));
});

test('coincident source coordinates with differing UV identities remain rejected',async()=>{
 const f=await fixture('ambiguous-coincident-uv',{coincidentCorners:true,ambiguousCoincidentUV:true});
 await assert.rejects(compileBindings(f),/Binding validation failed/);
});
