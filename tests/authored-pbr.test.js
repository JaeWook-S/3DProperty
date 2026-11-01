import test from 'node:test';
import assert from 'node:assert/strict';
import {Group,Mesh,BoxGeometry,MeshStandardMaterial,MeshPhysicalMaterial,Texture,SRGBColorSpace,RepeatWrapping} from 'three';
import {refineMaterials} from '../src/walkthrough/appearance.js';
import {FinishLibrary} from '../src/walkthrough/finishes.js';
const renderer={capabilities:{getMaxAnisotropy:()=>16}};
function fixture(name,policy){
 const material=new MeshStandardMaterial({name,roughness:.31,metalness:.07,emissive:0xffeedd,emissiveIntensity:2.3});
 material.normalScale.set(.12,-.19);
 for(const slot of ['map','normalMap','roughnessMap']){
  const texture=new Texture();texture.flipY=false;texture.wrapS=texture.wrapT=RepeatWrapping;
  texture.repeat.set(1.7,2.1);texture.rotation=.14;texture.updateMatrix();
  material[slot]=texture;
 }
 material.map.colorSpace=SRGBColorSpace;
 material.metalnessMap=material.aoMap=material.roughnessMap;material.aoMapIntensity=.73;
 if(policy!==undefined)material.userData.appearance_policy=policy;
 const root=new Group();root.add(new Mesh(new BoxGeometry(),[material,material]));
 return {material,root};
}
function signature(m){return{
 roughness:m.roughness,metalness:m.metalness,color:m.color.toArray(),normalScale:m.normalScale.toArray(),emissive:m.emissive.toArray(),emissiveIntensity:m.emissiveIntensity,aoMapIntensity:m.aoMapIntensity,
 maps:['map','normalMap','roughnessMap','metalnessMap','aoMap'].map(k=>m[k]&&({uuid:m[k].uuid,colorSpace:m[k].colorSpace,flipY:m[k].flipY,repeat:m[k].repeat.toArray(),rotation:m[k].rotation,matrix:m[k].matrix.toArray(),channel:m[k].channel})),
};}
test('authored glTF material policy preserves exported channels, strengths and UVs despite legacy name matches',()=>{
 for(const name of ['168C / Warm ivory plaster','168C / Lacquer warm white','limestone','Calacatta','brushed nickel']){
  const {material,root}=fixture(name,'authored-pbr-v1'),before=signature(material);
  refineMaterials(root,renderer);assert.deepEqual(signature(material),before);assert.equal(material.map.anisotropy,8);
 }
});
test('unmarked and unknown policies retain legacy appearance adjustments',()=>{
 for(const policy of [undefined,'authored-pbr-v2',true]){
  const {material,root}=fixture('168C / Warm ivory plaster',policy);
  refineMaterials(root,renderer);assert.equal(material.roughness,.92);assert.deepEqual(material.normalScale.toArray(),[.45,.45]);assert.equal(material.emissiveIntensity,1.4);
 }
 const {material,root}=fixture('168C / VR polished stone floor');refineMaterials(root,renderer);assert.equal(material.roughness,.31);
});
test('authored PBR survives refine then original/oak/stone/original with shared packed maps intact',async()=>{
 const {material,root}=fixture('168C / VR polished stone floor','authored-pbr-v1');
 refineMaterials(root,renderer);const original=signature(material),library=new FinishLibrary(renderer);
 library.preload=async()=>({oak:new Texture(),limestone:new Texture()});
 await library.apply(root,'original');await library.apply(root,'oak');
 assert.equal(material.normalMap,null);assert.equal(material.roughnessMap,null);
 await library.apply(root,'stone');await library.apply(root,'original');
 assert.deepEqual(signature(material),original);assert.equal(material.roughnessMap,material.metalnessMap);assert.equal(material.roughnessMap,material.aoMap);
 assert.equal(material.userData.appearance_policy,'authored-pbr-v1');
});


test('legacy window panes receive the clear-glass fix while authored glass keeps transmission and signed normals',()=>{
 for(const authored of [false,true]){
  const material=new MeshPhysicalMaterial({name:'Window glass',roughness:.08,transmission:.7,opacity:.84,transparent:false,depthWrite:true,specularIntensity:.6});
  material.normalMap=new Texture();material.normalScale.set(.12,-.19);
  if(authored)material.userData.appearance_policy='authored-pbr-v1';
  const root=new Group();root.add(new Mesh(new BoxGeometry(),material));
  refineMaterials(root,renderer);
  assert.equal(material.transmission,authored ? .7 : 0);
  assert.equal(material.opacity,authored ? .84 : .06);
  assert.equal(material.roughness,authored ? .08 : .35);
  assert.equal(material.transparent,!authored);
  assert.equal(material.depthWrite,authored);
  assert.equal(material.specularIntensity,authored ? .6 : .04);
  assert.deepEqual(material.normalScale.toArray(),authored ? [.12,-.19] : [.45,.45]);
 }
});
