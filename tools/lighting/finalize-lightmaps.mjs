#!/usr/bin/env node
/** Publish immutable-source, independently validated bake assets; no GPU, GLB edits, or web activation. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileBindings } from './build-bindings.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const DEFAULT_WORK=path.join(ROOT,'runtime/web-quality/2026-11-09-lightmaps');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const readJson=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const required=(ok,message)=>{if(!ok)throw Error(message)};
const writeJson=async(p,x)=>{const temp=p+`.tmp-${process.pid}`;await fs.writeFile(temp,JSON.stringify(x,null,2)+'\n');await fs.rename(temp,p)};
const getId=m=>m.unit_type.toLowerCase()+'-'+m.variant;

export async function finalizeModel({id,inputsPath=path.join(DEFAULT_WORK,'model-inputs.json'),bakesDir=path.join(DEFAULT_WORK,'bakes'),assetsDir=path.join(ROOT,'assets/lighting/indirect-v1'),reportsDir=path.join(DEFAULT_WORK,'bindings')}){
 const models=await readJson(inputsPath);const model=models.find(m=>getId(m)===id);required(model,`Unknown model ${id}`);
 const bakeDir=path.join(bakesDir,id),out=path.join(assetsDir,id),reportPath=path.join(reportsDir,id+'.json');
 const [bake,codec]=await Promise.all([readJson(path.join(bakeDir,'verification.json')),readJson(path.join(bakeDir,'rgbm-verification.json'))]);
 required(bake.passed===true && bake.source_unchanged===true && bake.positions_unchanged===true,`${id}: bake geometry verification not passed`);
 required(bake.samples===4096 && bake.id===id,`${id}: wrong samples/model`);
 required(codec.passed===true && codec.encoding==='RGBM8' && Number.isFinite(codec.range) && codec.range>0,`${id}: codec verification not passed`);
 required(codec.shader_decode?.includes('BEFORE bilinear') && codec.mipmaps===false,`${id}: decoder contract mismatch`);
 const glbPath=path.resolve(ROOT,'..',model.glb_path),blendPath=path.resolve(ROOT,'..',model.blend_path);
 const [glb,blend,png,sidecar,exr]=await Promise.all([fs.readFile(glbPath),fs.readFile(blendPath),fs.readFile(path.join(bakeDir,'indirect-4096-rgbm.png')),fs.readFile(path.join(bakeDir,'uv1-sidecar.json')),fs.readFile(path.join(bakeDir,'indirect-4096.exr'))]);
 required(sha(glb)===model.glb_sha256 && sha(glb)===bake.source_glb_sha256,`${id}: source GLB mismatch`);
 required(sha(blend)===model.blend_sha256 && sha(blend)===bake.source_sha256,`${id}: source BLEND mismatch`);
 required(sha(png)===codec.png_sha256 && png.length===codec.rgbm_png_bytes,`${id}: RGBM hash/size mismatch`);
 required(sha(sidecar)===bake.sidecar_sha256 && sha(exr)===bake.exr_sha256,`${id}: bake artifact hash mismatch`);
 // PNG IHDR independently confirms the codec dimensions and RGBA8 representation.
 required(png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && png.subarray(12,16).toString()==='IHDR',`${id}: invalid PNG`);
 required(png.readUInt32BE(16)===codec.dimensions[0] && png.readUInt32BE(20)===codec.dimensions[1] && png[24]===8 && png[25]===6,`${id}: PNG dimensions/RGBA8 mismatch`);
 const bindingsReport=await compileBindings({glbPath,sidecarPath:path.join(bakeDir,'uv1-sidecar.json'),outputDir:out,modelId:id,reportPath});
 required(bindingsReport.matchedTriangles===bake.triangle_count && bindingsReport.matchedOwnerCount===bake.receivers,`${id}: receiver counts differ from bake`);
 const bindings=await readJson(path.join(out,'bindings.json'));
 const components=[...new Set(bindings.primitives.map(x=>x.component))].sort();
 required(components.every(x=>['floor','wall','ceiling'].includes(x)),`${id}: movable/nonarchitecture receiver`);
 // Write atlas before publishing the manifest so a reader never sees a manifest for an absent texture.
 await fs.writeFile(path.join(out,'indirect-4096-rgbm.png'),png);
 const entry={schemaVersion:1,id,sourceGlbSha256:model.glb_sha256,sourceBlendSha256:model.blend_sha256,bindings:'bindings.json',atlas:'indirect-4096-rgbm.png',range:codec.range,samples:bake.samples,lightingPreset:'day',irradianceFactor:Math.PI,uvChannel:1,encoding:'RGBM8',colorSpace:'NoColorSpace',flipY:true,mipmaps:false,filtering:'decode-before-bilinear',dimensions:codec.dimensions,textureMemoryBytes:codec.texture_memory_bytes,receiverComponents:components,receiverObjects:bake.receivers,receiverTriangles:bake.triangle_count,sha256:{bindings:bindingsReport.output.bindingsSha256,uv1:bindingsReport.output.uvSha256,atlas:codec.png_sha256},bytes:{bindings:bindingsReport.output.bindingsBytes,uv1:bindingsReport.output.uvBytes,atlas:png.length}};
 await writeJson(path.join(out,'manifest.json'),entry);
 const report={schemaVersion:1,id,passed:true,createdAt:new Date().toISOString(),status:'validated_assets_runtime_activation_separate',sourceGlbSha256:model.glb_sha256,sourceBlendSha256:model.blend_sha256,bakeVerificationSha256:sha(await fs.readFile(path.join(bakeDir,'verification.json'))),codecVerificationSha256:sha(await fs.readFile(path.join(bakeDir,'rgbm-verification.json'))),bindingsVerificationSha256:sha(await fs.readFile(reportPath)),bakeSamples:bake.samples,sourceAndReceiverGeometryPreserved:true,dynamicReceiversExcluded:true,receiverComponents:components,receivers:bake.receivers,triangles:bake.triangle_count,atlasBytes:png.length,assetBytes:Object.values(entry.bytes).reduce((a,b)=>a+b,0),entry};
 await writeJson(path.join(reportsDir,id+'-finalization.json'),report);
 return report;
}

export async function rebuildManifest({assetsDir=path.join(ROOT,'assets/lighting/indirect-v1')}={}){
 await fs.mkdir(assetsDir,{recursive:true});const lock=path.join(assetsDir,'.manifest-lock');
 let locked=false;for(let i=0;i<100;i++){try{await fs.mkdir(lock);locked=true;break;}catch(e){if(e.code!=='EEXIST')throw e;await new Promise(r=>setTimeout(r,100));}}
 required(locked,'Manifest lock busy; retry after active finalizer completes');
 try{
  const models={};
  for(const d of (await fs.readdir(assetsDir,{withFileTypes:true})).filter(d=>d.isDirectory()&&!d.name.startsWith('.')).sort((a,b)=>a.name.localeCompare(b.name))){
   let entry;try{entry=await readJson(path.join(assetsDir,d.name,'manifest.json'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
   required(entry.id===d.name&&entry.schemaVersion===1,`Unexpected per-model manifest ${d.name}`);
   const files=[['bindings',entry.bindings],['uv1','uv1.bin'],['atlas',entry.atlas]];
   for(const [key,file]of files){const data=await fs.readFile(path.join(assetsDir,d.name,file));required(sha(data)===entry.sha256[key]&&data.length===entry.bytes[key],`Invalid finalized ${d.name}/${file}`);}
   models[d.name]={...entry,bindings:`${d.name}/${entry.bindings}`,atlas:`${d.name}/${entry.atlas}`};
  }
  const manifest={schemaVersion:1,kind:'cortex-indirect-lightmaps',lightingPreset:'day',models};
  await writeJson(path.join(assetsDir,'manifest.json'),manifest);return manifest;
 }finally{await fs.rmdir(lock);}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const args={};for(let i=2;i<process.argv.length;i++){const k=process.argv[i];if(k==='--all'||k==='--manifest-only')args[k.slice(2)]=true;else{required(k.startsWith('--')&&process.argv[i+1],`Bad argument ${k}`);args[k.slice(2)]=process.argv[++i];}}
 const options={};if(args.inputs)options.inputsPath=path.resolve(args.inputs);if(args.bakes)options.bakesDir=path.resolve(args.bakes);if(args.assets)options.assetsDir=path.resolve(args.assets);if(args.reports)options.reportsDir=path.resolve(args.reports);
 required(args.id||args.all||args['manifest-only'],'Usage: --id MODEL | --all | --manifest-only [--inputs FILE --bakes DIR --assets DIR --reports DIR]');
 const ids=args.all?(await readJson(options.inputsPath||path.join(DEFAULT_WORK,'model-inputs.json'))).map(getId):args.id?[args.id]:[];
 for(const id of ids){const r=await finalizeModel({...options,id});console.log(JSON.stringify({id,passed:r.passed,receivers:r.receivers,triangles:r.triangles,assetBytes:r.assetBytes}));}
 const manifest=await rebuildManifest(options);console.log(JSON.stringify({manifestModels:Object.keys(manifest.models),totalAssetBytes:Object.values(manifest.models).reduce((s,m)=>s+Object.values(m.bytes).reduce((a,b)=>a+b,0),0)}));
}
