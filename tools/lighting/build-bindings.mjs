#!/usr/bin/env node
/** Compile a Blender triangle UV sidecar to immutable GLB-primitive UV buffers.
 * Uses the installed GLTFLoader for exact primitive/index expansion and node transforms.
 * Textures are deliberately not decoded: no image, material, geometry, or GLB is modified.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const bytes = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
const pointKey = p => p.map(x => Math.round(x * 1e5)).join(',');
const triangleKey = p => p.map(pointKey).sort().join('|');
const attributeHash = g => Object.fromEntries(Object.entries(g.attributes).map(([k,v]) => [k, sha(bytes(v.isInterleavedBufferAttribute ? v.data.array : v.array))]));
const identity = g => ({ index: g.index ? sha(bytes(g.index.array)) : null, attributes: attributeHash(g), drawRange: {...g.drawRange}, groups: g.groups.map(x => ({...x})) });
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const permutations = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
// A canonical zero-area triangle can legitimately repeat a vertex. Keep all of
// its original corners; only accept ambiguous indexing if every exact-coordinate
// bijection assigns identical UVs. Never delete/repair a source triangle here.
function coincidentCornerMapping(points, triangle) {
 const ab=new THREE.Vector3(...points[1]).sub(new THREE.Vector3(...points[0]));
 const ac=new THREE.Vector3(...points[2]).sub(new THREE.Vector3(...points[0]));
 if(ab.cross(ac).lengthSq()!==0) return null;
 const matches=permutations.filter(order=>order.every((k,j)=>points[j].every((v,c)=>v===triangle.p[k][c])));
 if(!matches.length) return null;
 const first=matches[0];
 if(!matches.every(order=>order.every((k,j)=>triangle.uv[k].every((v,c)=>v===triangle.uv[first[j]][c])))) return null;
 return first;
}

export async function compileBindings({ glbPath, sidecarPath, outputDir, modelId, reportPath }) {
 const [glbBytes, sidecarBytes] = await Promise.all([fs.readFile(glbPath), fs.readFile(sidecarPath)]);
 const sidecar = JSON.parse(sidecarBytes);
 if (!Array.isArray(sidecar.models) || sidecar.coordinate_system !== 'Three X/Y/Z meters') throw Error('Unsupported UV sidecar coordinates/schema');
 const records = new Map();
 const sourceTriangles = [];
 for (const r of sidecar.models) {
  const name = THREE.PropertyBinding.sanitizeNodeName(r.name);
  if (records.has(name)) throw Error(`Duplicate sanitized sidecar owner: ${name}`);
  const triangles = new Map();
  r.triangles.forEach((t,i) => {
   if (t.p?.length !== 3 || t.uv?.length !== 3 || t.uv.some(v => v.length !== 2 || v.some(x => !Number.isFinite(x) || x < -1e-6 || x > 1+1e-6))) throw Error(`Invalid UV triangle ${r.name}/${i}`);
   const x = { ...t, record: r, index: i, uses: 0 }; sourceTriangles.push(x);
   const k = triangleKey(t.p); const list = triangles.get(k) || []; list.push(x); triangles.set(k,list);
  });
  records.set(name, {record:r, triangles});
 }
 // GLTFLoader's extension dispatch lets us parse identical geometry without a DOM/image decoder.
 const loader = new GLTFLoader();
 loader.register(() => ({ name: 'CORTEX_BINDINGS_SKIP_TEXTURE_DECODE', loadTexture: () => Promise.resolve(null) }));
 const buffer = glbBytes.buffer.slice(glbBytes.byteOffset, glbBytes.byteOffset+glbBytes.byteLength);
 const gltf = await loader.parseAsync(buffer, '');
 gltf.scene.updateMatrixWorld(true);
 const originals = [];
 gltf.scene.traverse(o => { if(o.isMesh) originals.push({object:o, geometry:o.geometry, index:o.geometry.index, attributes:{...o.geometry.attributes}, state:identity(o.geometry)}); });
 const descriptors=[], chunks=[], unmatched=[]; let byteOffset=0, matched=0, maxVertexErrorM=0; const coincidentCornersPreserved=[];
 const matchedOwners = new Set();
 gltf.scene.traverse(o => {
  if(!o.isMesh) return;
  let owner=o; while(owner && !records.has(owner.name)) owner=owner.parent;
  const source=records.get(owner?.name); if(!source) return;
  const assoc=gltf.parser.associations.get(o);
  if(!Number.isInteger(assoc?.meshes)||!Number.isInteger(assoc?.primitives)) throw Error(`Missing stable GLTF association for ${o.name}`);
  let nodeOwner=o; while(nodeOwner && !Number.isInteger(gltf.parser.associations.get(nodeOwner)?.nodes)) nodeOwner=nodeOwner.parent;
  const nodeIndex=gltf.parser.associations.get(nodeOwner)?.nodes;
  if(!Number.isInteger(nodeIndex)) throw Error(`Missing node association for ${o.name}`);
  const sourceGeometry=o.geometry;
  const expanded=sourceGeometry.index ? sourceGeometry.toNonIndexed() : sourceGeometry.clone();
  const positions=expanded.getAttribute('position');
  if(positions.count%3) throw Error('Triangle list required');
  const uv=new Float32Array(positions.count*2);
  for(let i=0;i<positions.count;i+=3) {
   const points=[0,1,2].map(j => new THREE.Vector3().fromBufferAttribute(positions,i+j).applyMatrix4(o.matrixWorld).toArray());
   const candidates=source.triangles.get(triangleKey(points)) || [];
   const faceNormal=new THREE.Vector3().subVectors(new THREE.Vector3(...points[1]),new THREE.Vector3(...points[0])).cross(new THREE.Vector3().subVectors(new THREE.Vector3(...points[2]),new THREE.Vector3(...points[0]))).normalize();
   const compatible=candidates.filter(t => !t.uses && (candidates.length===1 || !t.n || faceNormal.dot(new THREE.Vector3(...t.n))>0.99));
   if(compatible.length!==1) { unmatched.push({name:o.name,meshIndex:assoc.meshes,primitiveIndex:assoc.primitives,triangle:i/3,candidates:candidates.length,compatible:compatible.length,points}); continue; }
   const t=compatible[0]; let cornerIndices=points.map(p => t.p.findIndex(q => pointKey(p)===pointKey(q)));
   if(new Set(cornerIndices).size!==3 || cornerIndices.some(j=>j<0)) {
    const exact=coincidentCornerMapping(points,t);
    if(!exact) {unmatched.push({name:o.name,triangle:i/3,error:'ambiguous corners'});continue;}
    cornerIndices=exact;coincidentCornersPreserved.push({name:o.name,triangle:i/3,sourceOwner:source.record.name,sourceTriangle:t.index,rule:'exact zero-area positions; every corner bijection has identical UV; source order retained'});
   }
   cornerIndices.forEach((k,j) => {uv.set(t.uv[k],(i+j)*2); maxVertexErrorM=Math.max(maxVertexErrorM,Math.hypot(...points[j].map((v,c)=>v-t.p[k][c])));});
   t.uses++; matched++;
  }
  expanded.setAttribute('uv1',new THREE.BufferAttribute(uv,2));
  // Ensure only UV1 was added, retaining the exact source index expansion for every attribute.
  for(const [name,attr] of Object.entries(sourceGeometry.attributes)) {
   if(name==='uv1') throw Error('Input already contains UV1; refusing to overwrite');
   const actual=expanded.getAttribute(name);
   for(let i=0;i<actual.count;i++) for(let c=0;c<actual.itemSize;c++) {
    const src=sourceGeometry.index ? sourceGeometry.index.getX(i) : i;
    if(!Object.is(actual.getComponent(i,c),attr.getComponent(src,c))) throw Error(`Attribute changed: ${o.name}/${name}/${i}/${c}`);
   }
  }
  const data=bytes(uv);
  descriptors.push({meshIndex:assoc.meshes,primitiveIndex:assoc.primitives,nodeIndex,nodeName:nodeOwner.name,meshName:o.name,sourceOwner:source.record.name,component:source.record.component,sourceId:source.record.source_id??null,roomId:source.record.room_id??null,vertexCount:positions.count,byteOffset,byteLength:data.length,uvSha256:sha(data),expandedPositionSha256:sha(bytes(positions.array))});
  chunks.push(data);byteOffset+=data.length;matchedOwners.add(source.record.name);expanded.dispose();
 });
 const unused=sourceTriangles.filter(t=>t.uses!==1).map(t=>({owner:t.record.name,triangle:t.index,uses:t.uses}));
 for(const x of originals) {
  if(x.object.geometry!==x.geometry || x.geometry.index!==x.index || Object.entries(x.attributes).some(([k,v])=>x.geometry.attributes[k]!==v) || !equal(x.state,identity(x.geometry))) throw Error(`Logical geometry changed: ${x.object.name}`);
 }
 const report={schemaVersion:1,modelId,createdAt:new Date().toISOString(),sourceGlbSha256:sha(glbBytes),sourceSidecarSha256:sha(sidecarBytes),sourceOwnerCount:sidecar.models.length,matchedOwnerCount:matchedOwners.size,sourceTriangleCount:sourceTriangles.length,matchedTriangles:matched,primitiveCount:descriptors.length,unmatched,unused,maxVertexErrorM,coincidentCornersPreserved,logicalGeometryUnchanged:true,allSourceAttributesExactAfterIndexExpansion:true,sourceIndexOrderRetained:true,texturesDecoded:false,gpuUsed:false};
 report.passed=unmatched.length===0 && unused.length===0 && matched===sourceTriangles.length && matchedOwners.size===sidecar.models.length && maxVertexErrorM<2e-5;
 if(!report.passed) {if(reportPath){await fs.mkdir(path.dirname(reportPath),{recursive:true});await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');}throw Error(`Binding validation failed: ${unmatched.length} unmatched, ${unused.length} unused, ${maxVertexErrorM}m error`);}
 const uvBytes=Buffer.concat(chunks);
 const descriptorKeys=new Set();for(const d of descriptors){const k=`${d.nodeIndex}:${d.meshIndex}:${d.primitiveIndex}`;if(descriptorKeys.has(k))throw Error(`Duplicate primitive binding ${k}`);descriptorKeys.add(k);}
 const bindings={schemaVersion:1,kind:'cortex-glb-primitive-uv1',modelId,sourceGlbSha256:report.sourceGlbSha256,sourceSidecarSha256:report.sourceSidecarSha256,coordinateSystem:'canonical glTF local geometry; world-space match at unmodified scene root',uvFile:'uv1.bin',uvSha256:sha(uvBytes),componentType:'Float32Array',byteOrder:'little-endian',uvChannel:1,triangleOrder:'GLTFLoader geometry.toNonIndexed() original index order',byteLength:uvBytes.length,primitives:descriptors};
 const json=JSON.stringify(bindings)+'\n';
 report.output={uvBytes:uvBytes.length,bindingsBytes:Buffer.byteLength(json),uvSha256:bindings.uvSha256,bindingsSha256:sha(json),sourceSidecarBytes:sidecarBytes.length,compactTotalBytes:uvBytes.length+Buffer.byteLength(json)};
 // Re-read the source files before publishing descriptors; inputs may be concurrently updated.
 if(sha(await fs.readFile(glbPath))!==report.sourceGlbSha256 || sha(await fs.readFile(sidecarPath))!==report.sourceSidecarSha256) throw Error('Input changed during conversion');
 await fs.mkdir(outputDir,{recursive:true});
 await fs.writeFile(path.join(outputDir,'uv1.bin'),uvBytes);await fs.writeFile(path.join(outputDir,'bindings.json'),json);
 if(reportPath){await fs.mkdir(path.dirname(reportPath),{recursive:true});await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');}
 return report;
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
 const options={};for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i];if(!key.startsWith('--')||!process.argv[i+1])throw Error('Usage: --glb PATH --sidecar PATH --out DIR --id ID [--report PATH]');options[key.slice(2)]=process.argv[i+1];}
 const {glb,sidecar,out,id,report}=options;if(!glb||!sidecar||!out||!id)throw Error('Missing --glb --sidecar --out --id');
 const result=await compileBindings({glbPath:glb,sidecarPath:sidecar,outputDir:out,modelId:id,reportPath:report});
 console.log(JSON.stringify({passed:result.passed,modelId:result.modelId,matchedTriangles:result.matchedTriangles,primitiveCount:result.primitiveCount,maxVertexErrorM:result.maxVertexErrorM,...result.output},null,2));
}
