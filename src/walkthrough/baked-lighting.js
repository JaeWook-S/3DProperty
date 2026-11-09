import { BufferAttribute, NearestFilter, NoColorSpace, TextureLoader } from 'three';
import { applyBakedLightingPolicy, syncBakedLightingPolicy } from './baked-lighting-policy.js';
import { setBakedRenderData, clearBakedRenderData } from './baked-lighting-geometry.js';

// Vite emits only reviewed lighting artifacts. glob is URL-only: no network work
// occurs on HOME, map, or a unit that has not been explicitly opened.
const emitted = (() => { try { return import.meta.glob('../../assets/lighting/indirect-v1/*/*.{png,json,bin}', { query: '?url', import: 'default' }); } catch { return {}; } })();
const manifestURL = new URL('../../assets/lighting/indirect-v1/manifest.json', import.meta.url).href;
const pending = new Map(); let manifestPromise;
const sha256 = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
const url = (id, file) => emitted[`../../assets/lighting/indirect-v1/${id}/${file.split("/").at(-1)}`]?.();
async function json(resource) { const response=await fetch(resource);if(!response.ok)throw Error(`Lighting data ${response.status}`);return response.json(); }
async function assets(id) {
  if (!pending.has(id)) pending.set(id, (async () => {
    manifestPromise ??= json(manifestURL).catch(error=>{manifestPromise=null;throw error;});
    const manifest=await manifestPromise,entry=manifest.models?.[id] ?? manifest[id];
    if (!entry) return null;
    const [bindingsURL,atlasURL]=await Promise.all([url(id,entry.bindings ?? 'bindings.json'),url(id,entry.atlas ?? 'indirect-rgbm.png')]);
    if(!bindingsURL||!atlasURL)throw Error('Lighting bundle missing');
    const [bindings, image]=await Promise.all([json(bindingsURL),new TextureLoader().loadAsync(atlasURL)]);
    if(bindings.sourceGlbSha256!==entry.sourceGlbSha256)throw Error('Lighting source revision mismatch');
    const response=await fetch(await url(id,bindings.uvFile));if(!response.ok)throw Error(`Lighting UV ${response.status}`);
    const buffer=await response.arrayBuffer();
    if(buffer.byteLength!==bindings.byteLength || (bindings.uvSha256 && await sha256(buffer)!==bindings.uvSha256))throw Error('Lighting UV integrity mismatch');
    return {entry,bindings,buffer,image};
  })().catch(error=>{pending.delete(id);throw error;}));
  return pending.get(id);
}
const fingerprint = m => [m.version,m.color?.getHexString(),m.emissive?.getHexString(),m.roughness,m.metalness,m.normalScale?.toArray().join(','),m.emissiveIntensity,m.aoMapIntensity,
  ...['map','normalMap','roughnessMap','metalnessMap','aoMap'].map(k=>`${m[k]?.uuid}:${m[k]?.version}`)].join('|');

export function lightingModelId(type, variant) { return `${String(type).toLowerCase()}-${variant === 'basic' ? 'basic' : 'expanded'}`; }
export function createBakedLighting(gltf, id, { model=gltf.scene, invalidate=()=>{}, rebuild=()=>{} }={}) {
  const originalMeshes=[], meshes=[];gltf.scene.traverse(o=>{if(o.isMesh)originalMeshes.push(o);});model.traverse(o=>{if(o.isMesh)meshes.push(o);});
  const byPrimitive=new Map();
  originalMeshes.forEach((object,i)=>{
    const association=gltf.parser.associations.get(object);if(association?.meshes===undefined)return;
    let owner=object,node;while(owner&&(node=gltf.parser.associations.get(owner)?.nodes)===undefined)owner=owner.parent;
    const key=`${node}:${association.meshes}:${association.primitives??0}`;
    if(byPrimitive.has(key))throw Error('Ambiguous lightmap primitive');byPrimitive.set(key,meshes[i]);
  });
  let status='idle',error='',enabled=false,work=null,state=null;const prepared=[],copies=new Map();
  function sync() {
    for(const [source,entry] of copies){const hash=fingerprint(source);if(hash!==entry.hash){entry.material.copy(source);entry.hash=hash;applyBakedLightingPolicy(entry.material,state);entry.material.needsUpdate=true;}}
    if(state){state.enabled=enabled;for(const material of state.materials)syncBakedLightingPolicy(material);}
  }
  async function ensure() {
    if(work)return work;
    work=(async()=>{
      status='loading';invalidate();const data=await assets(id);
      if(!data){status='unavailable';return false;}
      const atlas=data.image.clone();atlas.channel=1;atlas.colorSpace=NoColorSpace;atlas.flipY=true;atlas.generateMipmaps=false;atlas.minFilter=atlas.magFilter=NearestFilter;atlas.needsUpdate=true;
      state={atlas,range:data.entry.range??8,enabled,materials:new Set()};
      try {
        for(const record of data.bindings.primitives){
          const object=byPrimitive.get(`${record.nodeIndex}:${record.meshIndex}:${record.primitiveIndex}`);
          if(!object||Array.isArray(object.material))throw Error('Lighting primitive missing');
          const count=object.geometry.index?.count??object.geometry.attributes.position.count;
          if(count!==record.vertexCount||record.byteLength!==count*8||record.byteOffset+record.byteLength>data.buffer.byteLength)throw Error('Lighting UV span mismatch');
          const uv=new Float32Array(data.buffer,record.byteOffset,count*2);if(uv.some(n=>!Number.isFinite(n)||n<0||n>1))throw Error('Invalid lighting UV');
          const geometry=object.geometry.index?object.geometry.toNonIndexed():object.geometry.clone();
          if(record.expandedPositionSha256 && await sha256(geometry.attributes.position.array)!==record.expandedPositionSha256){geometry.dispose();throw Error('Lighting source geometry mismatch');}
          geometry.setAttribute('uv1',new BufferAttribute(uv,2));
          let entry=copies.get(object.material);if(!entry){entry={material:object.material.clone(),hash:fingerprint(object.material)};copies.set(object.material,entry);applyBakedLightingPolicy(entry.material,state);}
          prepared.push({object,geometry,material:entry.material});
        }
        for(const item of prepared)setBakedRenderData(item.object,item);
        rebuild();status='ready';sync();invalidate();return true;
      }catch(cause){for(const item of prepared){clearBakedRenderData(item.object);item.geometry.dispose();}prepared.length=0;for(const entry of copies.values())entry.material.dispose();copies.clear();atlas.dispose();state=null;throw cause;}
    })().catch(cause=>{status='fallback';error=cause?.message||'Lighting asset unavailable';work=null;invalidate();return false;});
    return work;
  }
  return {ensure,sync,setEnabled(value){const before=enabled;enabled=Boolean(value);sync();if(before&&!enabled)state?.atlas.dispose();invalidate();},
    inspect:()=>({id,status,error,enabled:enabled&&status==='ready',receivers:prepared.length,materials:copies.size,samples:state?4096:null,uvChannel:1,sourceGeometryUnchanged:true,atlasBytes:state?state.atlas.image.width*state.atlas.image.height*4:0}),
    dispose(){enabled=false;for(const item of prepared){clearBakedRenderData(item.object);item.geometry.dispose();}for(const entry of copies.values())entry.material.dispose();state?.atlas.dispose();prepared.length=0;copies.clear();},
  };
}
