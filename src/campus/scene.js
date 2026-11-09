import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {inPolygon,pointInRing,bounds,massingParts} from './geometry.js';
import {createMainPrecinct,inMainForecourt} from './main-building-detail.js';
const mat=(color,roughness=.8)=>new THREE.MeshStandardMaterial({color,roughness});
function shape(poly){const s=new THREE.Shape(poly.outer.map(([x,z])=>new THREE.Vector2(x,-z)));for(const h of poly.holes||[])s.holes.push(new THREE.Path(h.map(([x,z])=>new THREE.Vector2(x,-z))));return s;}
function flat(poly,y){const g=new THREE.ShapeGeometry(shape(poly));g.rotateX(-Math.PI/2);g.translate(0,y,0);return g;}
function solid(poly,height,y=0){const g=new THREE.ExtrudeGeometry(shape(poly),{depth:height,bevelEnabled:false,steps:1,curveSegments:1});g.rotateX(-Math.PI/2);g.translate(0,y,0);return g;}
function grain(){const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d'),im=x.createImageData(128,128);let seed=17;for(let i=0;i<im.data.length;i+=4){seed=(seed*1664525+1013904223)>>>0;const v=226+(seed%25);im.data.set([v,v,v,255],i);}x.putImageData(im,0,0);const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(.4,.4);t.colorSpace=THREE.SRGBColorSpace;return t;}
export function createCampusScene(scene,data){
 const root=new THREE.Group();root.name='Inha main campus — OSM geometry';scene.add(root);
 const stone=mat('#c9c5b6'),warm=mat('#bcae96'),white=mat('#d9dbd3'),roof=mat('#a4aaa3'),asphalt=mat('#626b6b'),paving=mat('#b4b6a7'),grass=mat('#74875c'),woodland=mat('#6d855a'),water=new THREE.MeshPhysicalMaterial({color:'#517e78',roughness:.24,metalness:.27,clearcoat:1,clearcoatRoughness:.14}),pitch=mat('#5f8c63'),clay=mat('#a57159'),glass=new THREE.MeshStandardMaterial({color:'#597b84',roughness:.2,metalness:.65}),glass2=new THREE.MeshStandardMaterial({color:'#8ca4a4',roughness:.28,metalness:.38}),frame=mat('#c4c7bc',.5),dark=mat('#505a5b'),context=mat('#92978f');
 stone.map=grain();white.map=stone.map;warm.map=stone.map;grass.map=stone.map;asphalt.map=stone.map;
 const batch=new Map();function put(g,m){if(!batch.has(m))batch.set(m,[]);batch.get(m).push(g);}
 function mesh(g,m){const obj=new THREE.Mesh(g,m);obj.castShadow=true;obj.receiveShadow=true;root.add(obj);return obj;}
 const instances=new Map();const tmp=new THREE.Object3D();function box(x,y,z,w,h,d,m,angle=0){if(!instances.has(m))instances.set(m,[]);tmp.position.set(x,y,z);tmp.scale.set(w,h,d);tmp.rotation.set(0,angle,0);tmp.updateMatrix();instances.get(m).push(tmp.matrix.clone());}
 function strip(a,b,width,y,m){const dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<.05)return;const g=new THREE.PlaneGeometry(len,width);g.rotateX(-Math.PI/2);g.rotateY(-Math.atan2(dz,dx));g.translate((a[0]+b[0])/2,y,(a[1]+b[1])/2);put(g,m);}
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(10000,10000),mat('#a1a393'));ground.rotation.x=-Math.PI/2;ground.position.y=-.22;ground.receiveShadow=true;root.add(ground);
 put(flat({outer:data.boundary},-.08),grass);
 for(const s of data.surfaces)for(const p of s.polygons){put(flat(p,s.kind==='water'?.12:s.kind==='pitch'?.12:.01),s.kind==='water'?water:s.kind==='pitch'?(s.sport==='basketball'||s.sport==='tennis'?clay:pitch):s.wood?woodland:grass);if(s.kind==='water')for(let i=0;i<p.outer.length;i++)strip(p.outer[i],p.outer[(i+1)%p.outer.length],1.1,.14,paving);if(s.kind==='pitch'){
  const b=bounds(p.outer);const cx=(b.minX+b.maxX)/2,cz=(b.minZ+b.maxZ)/2;const longX=b.maxX-b.minX>b.maxZ-b.minZ;
  for(let i=0;i<p.outer.length;i++)strip(p.outer[i],p.outer[(i+1)%p.outer.length],.14,.15,white);
  // Pitch outline is OSM; field markings are illustrative.
  const circle=new THREE.RingGeometry(s.sport==='soccer'?8.9:1.8,s.sport==='soccer'?9.05:1.95,48);circle.rotateX(-Math.PI/2);circle.translate(cx,.15,cz);put(circle,white);
  strip(longX?[cx,b.minZ+1]:[b.minX+1,cz],longX?[cx,b.maxZ-1]:[b.maxX-1,cz],.14,.15,white);
 }}
 for(const r of data.roads){const foot=['footway','path','steps','pedestrian','cycleway'].includes(r.kind);for(let i=1;i<r.points.length;i++){const a=r.points[i-1],b=r.points[i];if(!foot)strip(a,b,r.width_m+1.8,.16,paving);strip(a,b,r.width_m,foot?.32:.3,foot?paving:asphalt);if(['primary','secondary','tertiary'].includes(r.kind)){const len=Math.hypot(b[0]-a[0],b[1]-a[1]);for(let k=2;k<len-2;k+=10){const t=k/len,u=Math.min(k+4,len)/len;strip([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],[a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u],.17,.34,white);}}}}
 const precinct=createMainPrecinct(data);root.add(precinct.root);
 const buildings=[];
 for(const b of data.buildings){if(b.id==='way/1098539003'){if(b.campus)buildings.push({...b,group:precinct.guardGroup,bounds:bounds(b.polygons[0].outer)});continue;}if(b.landmark==='main'){buildings.push({...b,group:precinct.buildingGroup,bounds:bounds(b.polygons[0].outer)});continue;}const group=new THREE.Group();group.name=b.name||b.id;group.userData.building=b;root.add(group);const parts=massingParts(b),bm=b.landmark==='anniversary'?dark:b.landmark==='main'?warm:b.landmark==='library'?white:b.landmark==='hightech'?white:b.campus?stone:context;
  for(const p of parts){if(b.campus){const obj=new THREE.Mesh(solid(p,p.height,.12),bm);obj.castShadow=obj.receiveShadow=true;obj.userData.building=b;group.add(obj);}else put(solid(p,p.height,.12),bm);
   put(flat(p,p.height+.14),roof);
   if(!b.campus)continue;
   const storey=b.height_m/Math.max(1,b.facade_rows_assumed),rows=Math.max(1,Math.round(p.height/storey));
   for(const ring of [p.outer,...p.holes]){
    const signed=ring.reduce((v,a,i)=>{const z=ring[(i+1)%ring.length];return v+a[0]*z[1]-z[0]*a[1];},0);const hole=p.holes.includes(ring);const outward=(signed>0?1:-1)*(hole?-1:1);
    for(let i=0;i<ring.length;i++){const a=ring[i],c=ring[(i+1)%ring.length],dx=c[0]-a[0],dz=c[1]-a[1],len=Math.hypot(dx,dz);if(len<2)continue;const nx=dz/len*outward,nz=-dx/len*outward,angle=-Math.atan2(dz,dx),middle=[(a[0]+c[0])/2,(a[1]+c[1])/2];
     // Parapets and thin horizontal lintels create depth without image textures.
     box(middle[0]+nx*.12,p.height+.36,middle[1]+nz*.12,len,.45,.35,frame,angle);
     const curtain=b.landmark==='anniversary',bay=curtain?2.25:3.2,count=Math.floor((len-.8)/bay);if(count<1)continue;const step=(len-.8)/count;
     for(let row=0;row<rows;row++){
      const y=.8+row*(p.height/rows)+(p.height/rows)*.5,wh=(p.height/rows)*(curtain?.76:.54);if(y+wh/2>p.height-.3)continue;
      for(let j=0;j<count;j++){const t=(.4+step*(j+.5))/len,x=a[0]+dx*t+nx*.18,z=a[1]+dz*t+nz*.18,ww=step*(curtain?.9:.69);box(x,y,z,ww+.22,wh+.23,.16,frame,angle);box(x+nx*.11,y,z+nz*.11,ww,wh,.07,(j+row)%5===0?glass2:glass,angle);}
     }
     if(b.landmark==='main'&&len>18)for(let j=1;j<len/4;j++)box(a[0]+dx*(j*4/len)+nx*.6,p.height/2,a[1]+dz*(j*4/len)+nz*.6,.45,p.height-.7,1.15,white,angle);
    }
   }
   // Roof plant stays below the parapet silhouette; unmeasured decorative detail.
   const q=bounds(p.outer),cx=(q.minX+q.maxX)/2,cz=(q.minZ+q.maxZ)/2;if(inPolygon([cx,cz],p))box(cx,p.height+.7,cz,4.4,1.1,2.4,dark);
  }
  if(b.landmark==='library'){
   const cx=b.center[0]+8,cz=b.center[1]+4,theta=Math.atan2(.87,.49);
   const curved=new THREE.CylinderGeometry(15,15,33,32,1,true,theta-Math.PI/2,Math.PI);curved.translate(cx,21.5,cz);put(curved,glass);
   for(let k=0;k<=8;k++){const arc=new THREE.CylinderGeometry(15.22,15.22,.3,32,1,true,theta-Math.PI/2,Math.PI);arc.translate(cx,5+k*4.1,cz);put(arc,frame);}
   for(let k=0;k<=14;k++){const a=theta-Math.PI/2+k*Math.PI/14;box(cx+Math.sin(a)*15.15,21.5,cz+Math.cos(a)*15.15,.16,33,.16,frame);}
   box(cx,39.5,cz,31,1,30,white,-.51);
  }
  if(b.campus)buildings.push({...b,group,bounds:bounds(b.polygons[0].outer)});
 }
 // Decorative tree locations are sampled deterministically from mapped green space,
 // excluding every mapped footprint, water and road. Not a tree survey.
 let seed=331;const rand=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
 const treePos=[],greens=data.surfaces.filter(s=>s.kind==='green');
 const intersectsRoad=p=>data.roads.some(r=>r.points.slice(1).some((b,i)=>{const a=r.points[i],dx=b[0]-a[0],dz=b[1]-a[1],d=dx*dx+dz*dz,t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(d||1)));return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t)<r.width_m/2+2;}));
 for(const s of greens)for(const p of s.polygons){const q=bounds(p.outer),target=Math.min(s.wood?200:70,Math.round((q.maxX-q.minX)*(q.maxZ-q.minZ)/(s.wood?90:170)));for(let i=0,n=0;i<target*12&&n<target;i++){const x=q.minX+rand()*(q.maxX-q.minX),z=q.minZ+rand()*(q.maxZ-q.minZ);if(inMainForecourt([x,z],precinct.layout)||!inPolygon([x,z],p)||data.buildings.some(b=>b.polygons.some(poly=>inPolygon([x,z],poly)))||data.surfaces.some(s=>s.kind!=='green'&&s.polygons.some(poly=>inPolygon([x,z],poly)))||intersectsRoad([x,z]))continue;treePos.push([x,z,4.8+rand()*3.8]);n++;}}
 const treeGeometry=new THREE.IcosahedronGeometry(1,1),trunks=new THREE.CylinderGeometry(.3,.46,1,5),leafMats=['#526b47','#6f8054','#819363'].map(c=>mat(c));
 for(let colour=0;colour<3;colour++){const rows=treePos.filter((_,i)=>i%3===colour),leaf=new THREE.InstancedMesh(treeGeometry,leafMats[colour],rows.length*2),trunk=new THREE.InstancedMesh(trunks,mat('#716654'),rows.length);rows.forEach(([x,z,h],i)=>{tmp.position.set(x,h*.27,z);tmp.scale.set(1,h*.54,1);tmp.rotation.set(0,0,0);tmp.updateMatrix();trunk.setMatrixAt(i,tmp.matrix);for(let k=0;k<2;k++){tmp.position.set(x+(k?1.1:0),h*(k?.72:.57),z+(k?-.5:0));tmp.scale.set(h*(k?.27:.34),h*.32,h*.33);tmp.rotation.set(.2,rand()*6.28,.1);tmp.updateMatrix();leaf.setMatrixAt(i*2+k,tmp.matrix);}});leaf.castShadow=true;leaf.receiveShadow=true;trunk.castShadow=true;root.add(leaf,trunk);}
 for(const [m,rows] of instances){const o=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),m,rows.length);rows.forEach((matrix,i)=>o.setMatrixAt(i,matrix));o.castShadow=true;o.receiveShadow=true;root.add(o);}
 for(const [m,geometries] of batch){if(!geometries.length)continue;const merged=mergeGeometries(geometries.map(g=>g.index?g.toNonIndexed():g),false);if(merged){const o=mesh(merged,m);if([asphalt,paving,grass,woodland,pitch,clay,water].includes(m))o.castShadow=false;}geometries.forEach(g=>g.dispose());}
 const sun=new THREE.DirectionalLight('#fff3dd',2.6);sun.position.set(-320,520,230);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-520;sun.shadow.camera.right=520;sun.shadow.camera.top=520;sun.shadow.camera.bottom=-520;sun.shadow.camera.near=5;sun.shadow.camera.far=1400;sun.shadow.normalBias=.22;sun.shadow.bias=-.00008;scene.add(sun,sun.target);scene.add(new THREE.HemisphereLight('#c7dfe8','#6a775b',.95));
 return{root,buildings,stats:{...data.stats,trees:treePos.length,instances:[...instances.values()].reduce((n,r)=>n+r.length,0)},water,precinct,focusShadows(active){const c=active?precinct.layout.frame.origin:[0,0],span=active?185:520;sun.position.set(c[0]-320,520,c[1]+230);sun.target.position.set(c[0],0,c[1]);Object.assign(sun.shadow.camera,{left:-span,right:span,top:span,bottom:-span});sun.shadow.camera.updateProjectionMatrix();sun.target.updateMatrixWorld();}};
}
