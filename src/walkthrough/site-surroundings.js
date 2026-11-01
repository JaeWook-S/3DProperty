import * as THREE from 'three';
import {mergeGeometries,mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';

export const surroundingsSourceUrl = new URL('../../assets/location/acro-river-park/surroundings-context.json', import.meta.url).href;
const MAX_TREES = 1350;
function random(seed=8731){return ()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};}
function inside([x,z],poly){let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
function bounds(poly){return {minX:Math.min(...poly.map(p=>p[0])),maxX:Math.max(...poly.map(p=>p[0])),minZ:Math.min(...poly.map(p=>p[1])),maxZ:Math.max(...poly.map(p=>p[1]))};}
function path(poly){const p=new THREE.Shape();poly.forEach(([x,z],i)=>i?p.lineTo(x,-z):p.moveTo(x,-z));p.closePath();return p;}
function shapeGeometry(poly,holes=[]){const shape=path(poly);shape.holes=holes.map(path);const g=new THREE.ShapeGeometry(shape);g.rotateX(-Math.PI/2);return g;}
function worldUV(g,metres){const p=g.attributes.position,uv=g.attributes.uv;for(let i=0;i<p.count;i++)uv.setXY(i,p.getX(i)/metres,p.getZ(i)/metres);return g;}
function grainMap(base,seed){const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const c=canvas.getContext('2d'),r=random(seed);c.fillStyle=base;c.fillRect(0,0,256,256);for(let i=0;i<9000;i++){const shade=r()>.5?'255,255,226':'34,45,27';c.fillStyle=`rgba(${shade},${.03+r()*.11})`;c.fillRect(r()*256,r()*256,1+r()*3,1+r()*3);}const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=2;return t;}
function waterNormal(){const size=128,data=new Uint8Array(size*size*4);for(let y=0;y<size;y++)for(let x=0;x<size;x++){const a=x/size*Math.PI*2,b=y/size*Math.PI*2;const nx=.18*Math.cos(a*6+b*2)+.08*Math.cos(a*13-b*3),ny=.12*Math.cos(a*3+b*7);const n=new THREE.Vector3(nx,ny,1).normalize(),i=(y*size+x)*4;data[i]=(n.x*.5+.5)*255;data[i+1]=(n.y*.5+.5)*255;data[i+2]=(n.z*.5+.5)*255;data[i+3]=255;}const t=new THREE.DataTexture(data,size,size);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;}
function facadeMap(){const canvas=document.createElement('canvas');canvas.width=64;canvas.height=96;const c=canvas.getContext('2d');c.fillStyle='#b9bab2';c.fillRect(0,0,64,96);c.fillStyle='#788c90';c.fillRect(13,20,37,43);c.fillStyle='#a4b7bb';c.fillRect(15,22,17,39);c.fillStyle='#d4d1c5';c.fillRect(11,64,42,4);c.fillStyle='#d8d8ce';c.fillRect(32,20,2,43);c.fillStyle='#9d9f98';c.fillRect(0,92,64,4);const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(1/3.5,1/3.1);return t;}
function merge(group,name,geometries,material,shadows=false){if(!geometries.length)return null;const plain=geometries.map(g=>g.index?g.toNonIndexed():g);const g=mergeGeometries(plain);geometries.forEach(g=>g.dispose());plain.forEach(g=>g.dispose());if(!g)throw Error(`Surroundings merge failed: ${name}`);const mesh=new THREE.Mesh(g,material);mesh.name=name;mesh.receiveShadow=true;mesh.castShadow=shadows;group.add(mesh);return mesh;}
function strip(a,b,width,y){const dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);const g=new THREE.PlaneGeometry(len+.2,width);g.rotateX(-Math.PI/2);g.rotateY(-Math.atan2(dz,dx));g.translate((a[0]+b[0])/2,y,(a[1]+b[1])/2);return worldUV(g,5);}
function distanceToSegment(x,z,a,b){const dx=b[0]-a[0],dz=b[1]-a[1];const t=THREE.MathUtils.clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz),0,1);return Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t);}

export function createSiteSurroundings(parent,site,invalidate=()=>{}) {
 const group=new THREE.Group();group.name='Mapped neighbourhood · OSM / decorative surfaces';parent.add(group);
 const status={state:'loading',source:surroundingsSourceUrl,treePositionsSurveyed:false,continuousAnimation:false,counts:{}};
 const ready=fetch(surroundingsSourceUrl).then(r=>{if(!r.ok)throw Error(`Surroundings HTTP ${r.status}`);return r.json();}).then(data=>{
  const grass=new THREE.MeshStandardMaterial({color:0xb7c3a7,map:grainMap('#819073',9),roughness:1});
  const asphalt=new THREE.MeshStandardMaterial({color:0xa2a5a3,map:grainMap('#636a6b',24),roughness:.94});
  const pavement=new THREE.MeshStandardMaterial({color:0xb9b8a8,roughness:.92});
  const pathMat=new THREE.MeshStandardMaterial({color:0xc6bca6,map:grainMap('#c7c2b1',83),roughness:1});
  const water=new THREE.MeshPhysicalMaterial({color:0x597e87,roughness:.21,metalness:.23,clearcoat:.65,clearcoatRoughness:.17,normalMap:waterNormal(),normalScale:new THREE.Vector2(.55,.55),envMapIntensity:1.15});
  const waters=data.water.map(w=>{const g=worldUV(shapeGeometry(w.outer,w.holes),28);g.translate(0,.045,0);return g;});merge(group,'Han River / mapped water and island holes',waters,water);
  const lawns=data.green.map(p=>{const g=worldUV(shapeGeometry(p.polygon),22);g.translate(0,-.035,0);return g;});
  const parcel=worldUV(shapeGeometry(site.site_boundary_m),22);parcel.translate(0,-.025,0);lawns.push(parcel);merge(group,'Mapped park lawns and site parcel',lawns,grass);
  const roads=[],walks=[],curbs=[],lanes=[],piers=[];
  for(const r of data.roads){const walk=['footway','path','cycleway','pedestrian'].includes(r.kind),y=r.bridge?6:.065;
   for(const [a,b] of r.segments){(walk?walks:roads).push(strip(a,b,r.width_m,y));
    if(!walk&&!r.bridge)curbs.push(strip(a,b,r.width_m+1.5,.015));
    if(!walk&&r.width_m>=10){const len=Math.hypot(b[0]-a[0],b[1]-a[1]);for(let t=3;t<len-3;t+=14){const end=Math.min(t+4,len-2);lanes.push(strip([a[0]+(b[0]-a[0])*t/len,a[1]+(b[1]-a[1])*t/len],[a[0]+(b[0]-a[0])*end/len,a[1]+(b[1]-a[1])*end/len],.14,y+.015));}}
    if(r.bridge&&Math.hypot(b[0]-a[0],b[1]-a[1])>25){const g=new THREE.BoxGeometry(Math.max(1,r.width_m*.12),6,1.2);g.translate((a[0]+b[0])/2,3,(a[1]+b[1])/2);piers.push(g);}
   }
  }
  merge(group,'Road shoulders',curbs,pavement);merge(group,'Mapped roads',roads,asphalt);merge(group,'Mapped walking and cycling paths',walks,pathMat);merge(group,'Indicative road markings',lanes,new THREE.MeshStandardMaterial({color:0xe6dbc0,roughness:.9}));merge(group,'Indicative bridge supports',piers,pavement);
  const roofs=[],walls=[];
  for(const b of data.buildings){const g=new THREE.ExtrudeGeometry(path(b.polygon),{depth:b.height_m,bevelEnabled:false,curveSegments:1});g.rotateX(-Math.PI/2);
   for(const part of g.groups){const section=new THREE.BufferGeometry();for(const [name,a] of Object.entries(g.attributes))section.setAttribute(name,new THREE.BufferAttribute(a.array.slice(part.start*a.itemSize,(part.start+part.count)*a.itemSize),a.itemSize));(part.materialIndex===0?roofs:walls).push(section);}g.dispose();
  }
  merge(group,'Neighbour building walls · approximate heights',walls,new THREE.MeshStandardMaterial({color:0xdfdfd3,map:facadeMap(),roughness:.88}));merge(group,'Neighbour building roofs',roofs,new THREE.MeshStandardMaterial({color:0x9ea5a0,roughness:.9}));
  const occupied=[...data.buildings.map(b=>b.polygon),...site.buildings.flatMap(b=>b.parts.map(p=>p.footprint_m))].map(p=>({polygon:p,...bounds(p)}));
  const land=[{polygon:site.site_boundary_m,kind:'site'},...data.green.filter(p=>p.kind!=='pitch')];const positions=[],used=new Set(),rand=random(20261025);
  const waterAt=(x,z)=>data.water.some(w=>inside([x,z],w.outer)&&!w.holes.some(h=>inside([x,z],h)));
  const roadSegments=data.roads.filter(r=>!r.bridge).flatMap(r=>r.segments.map(([a,b])=>({a,b,width:r.width_m/2+2,minX:Math.min(a[0],b[0])-r.width_m/2-2,maxX:Math.max(a[0],b[0])+r.width_m/2+2,minZ:Math.min(a[1],b[1])-r.width_m/2-2,maxZ:Math.max(a[1],b[1])+r.width_m/2+2})));
  for(const zone of land){const b=bounds(zone.polygon),step=zone.kind==='site'?13:19;
   for(let x0=b.minX+step/2;x0<b.maxX;x0+=step)for(let z0=b.minZ+step/2;z0<b.maxZ;z0+=step){
    const x=x0+(rand()-.5)*step*.65,z=z0+(rand()-.5)*step*.65,key=`${Math.floor(x/9)},${Math.floor(z/9)}`;
    if(positions.length>=MAX_TREES||used.has(key)||!inside([x,z],zone.polygon)||waterAt(x,z))continue;
    if(occupied.some(b=>x>b.minX-3&&x<b.maxX+3&&z>b.minZ-3&&z<b.maxZ+3))continue;
    if(roadSegments.some(r=>x>r.minX&&x<r.maxX&&z>r.minZ&&z<r.maxZ&&distanceToSegment(x,z,r.a,r.b)<r.width))continue;
    used.add(key);positions.push([x,z,zone.kind==='site'?2.3+rand()*1.5:2.8+rand()*2.4]);
   }
  }
  let crownGeometry=new THREE.IcosahedronGeometry(1,1);const pos=crownGeometry.attributes.position;
  // Coordinate-based perturbation retains coincident seams and smooth canopy normals.
  for(let i=0;i<pos.count;i++){const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i),scale=1+.13*Math.sin(x*17+y*13+z*19);pos.setXYZ(i,x*scale,y*scale,z*scale);}crownGeometry.deleteAttribute('uv');crownGeometry.deleteAttribute('normal');const smoothCrown=mergeVertices(crownGeometry,1e-5);crownGeometry.dispose();crownGeometry=smoothCrown;crownGeometry.computeVertexNormals();
  const crowns=new THREE.InstancedMesh(crownGeometry,new THREE.MeshStandardMaterial({color:0xffffff,roughness:1}),positions.length);
  const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.22,.32,2.6,5),new THREE.MeshStandardMaterial({color:0x665a45,roughness:1}),positions.length);
  const dummy=new THREE.Object3D(),color=new THREE.Color();positions.forEach(([x,z,size],i)=>{dummy.position.set(x,size*.84+2.1,z);dummy.rotation.y=rand()*Math.PI;dummy.scale.set(size,size*(.9+rand()*.45),size*(.8+rand()*.4));dummy.updateMatrix();crowns.setMatrixAt(i,dummy.matrix);color.setHSL(.235+rand()*.055,.23+rand()*.17,.25+rand()*.13).convertSRGBToLinear();crowns.setColorAt(i,color);dummy.position.set(x,1.3,z);dummy.scale.setScalar(1);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);});
  crowns.name='Decorative park trees · not surveyed';trunks.name='Tree trunks';crowns.castShadow=crowns.receiveShadow=true;trunks.castShadow=false;crowns.computeBoundingSphere();trunks.computeBoundingSphere();group.add(crowns,trunks);
  status.state='ready';status.counts={water:data.water.length,green:data.green.length,buildings:data.buildings.length,roads:data.roads.length,trees:positions.length,drawObjects:group.children.length};status.geometryTriangles=group.children.reduce((n,o)=>n+((o.geometry?.index?.count||o.geometry?.attributes.position?.count||0)/3)*(o.isInstancedMesh?o.count:1),0);status.waterHoleCount=data.water.reduce((n,w)=>n+w.holes.length,0);status.treeBoundsChecked=true;
  parent.userData.surroundingsShadowsDirty=true;invalidate();return status;
 }).catch(error=>{status.state='fallback';status.error=error.message;invalidate();return status;});
 return {group,ready,inspect:()=>({...status})};
}
