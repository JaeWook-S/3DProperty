import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Phase 1: main building / forecourt / main gate. Source footprint stays immutable.
// Horizontal coordinates are OSM-derived. Recesses, heights and facade articulation
// are photo-informed approximations (2023 Inha Heritage / HanjinKal oblique photo).
export function mainBuildingFrame(building) {
 const p=building.polygons[0].outer,a=p[5],b=p[6],span=Math.hypot(b[0]-a[0],b[1]-a[1]);
 const u=[(b[0]-a[0])/span,(b[1]-a[1])/span],v=[-u[1],u[0]],origin=[(a[0]+b[0])/2,(a[1]+b[1])/2];
 const local=([x,z])=>[(x-origin[0])*u[0]+(z-origin[1])*u[1],(x-origin[0])*v[0]+(z-origin[1])*v[1]];
 const world=(x,z)=>[origin[0]+u[0]*x+v[0]*z,origin[1]+u[1]*x+v[1]*z];
 return {origin,u,v,span,local,world,angle:-Math.atan2(u[1],u[0]),ring:p.map(local)};
}
export function mainPrecinctLayout(data) {
 const building=data.buildings.find(b=>b.landmark==='main'),frame=mainBuildingFrame(building);
 const pool=data.surfaces.find(s=>s.id==='way/218220690').polygons[0].outer;
 const start=[(pool[0][0]+pool[1][0])/2,(pool[0][1]+pool[1][1])/2],end=[(pool[2][0]+pool[3][0])/2,(pool[2][1]+pool[3][1])/2];
 const project=([lon,lat])=>[(lon-data.origin_lon_lat[0])*111320*Math.cos(data.origin_lon_lat[1]*Math.PI/180),-(lat-data.origin_lon_lat[1])*111320];
 const gate=project([126.6530324,37.4476084]); // manually picked curb opening, NOT OSM named POI or survey
 return {building,frame,pool:{ring:pool,start,end,length:Math.hypot(end[0]-start[0],end[1]-start[1]),startLocal:frame.local(start),endLocal:frame.local(end)},gate:{position:gate,local:frame.local(gate),basis:'reference-image-manual-pick'},centralBays:10,windowTiersAssumed:5};
}
export function inMainForecourt(point,layout){const [x,z]=layout.frame.local(point);return Math.abs(x)<72&&z>8&&z<layout.gate.local[1]+5;}

function surfaceTexture(kind) {
 const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d');
 const base=kind==='brick'?[151,104,78]:kind==='paving'?[170,169,158]:[197,192,175];
 const im=ctx.createImageData(256,256);let seed=29;
 for(let i=0;i<im.data.length;i+=4){seed=(seed*1664525+1013904223)>>>0;const n=(seed%15)-7;im.data.set([...base.map(v=>v+n),255],i);}ctx.putImageData(im,0,0);
 ctx.strokeStyle=kind==='brick'?'#b9ad96':'#aaa89b';ctx.lineWidth=kind==='brick'?3:2.2;
 if(kind==='brick'){for(let y=0;y<=256;y+=32){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(256,y);ctx.stroke();for(let x=(y/32%2)*32;x<=256;x+=64){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y+32);ctx.stroke();}}}
 else{ctx.strokeRect(.5,.5,255,255);ctx.fillStyle='#ffffff18';ctx.fillRect(2,2,252,1);}
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=4;return t;
}
const standard=(color,roughness=.75,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
export function createMainPrecinct(data) {
 const l=mainPrecinctLayout(data),f=l.frame,root=new THREE.Group();root.name='본관–정문 · 사진 대조 1차';
 const buildingGroup=new THREE.Group(),guardGroup=new THREE.Group();buildingGroup.name='본관 · 열주와 유리 계단실';guardGroup.name='정문 주차관리실';root.add(buildingGroup,guardGroup);
 const stone=standard('#ffffff',.83),paving=standard('#ffffff',.92),brick=standard('#ffffff',.9);
 stone.map=surfaceTexture('stone');paving.map=surfaceTexture('paving');brick.map=surfaceTexture('brick');
 const roof=standard('#777d73',.94),edge=standard('#cbc9bb',.77),dark=standard('#293b39',.83),glass=standard('#639b9a',.21,.55),glassLight=standard('#8faea0',.3,.34),metal=standard('#b5bcb0',.44,.35),rubber=standard('#2a3030'),paint=standard('#e7e5cf',.88),wood=standard('#927351'),green=standard('#294322',.97),green2=standard('#3f5327',.97),trunk=standard('#756553');
 const batches=new Map(),labelJobs=[];let boxes=0;
 function put(g,m,role='site'){const key=role+'-'+m.uuid;if(!batches.has(key))batches.set(key,{m,role,geos:[]});batches.get(key).geos.push(g);}
 function box(x,y,z,w,h,d,m,role='building',angle=0){
  const g=new THREE.BoxGeometry(w,h,d);if(m.map){const uv=g.attributes.uv,n=g.attributes.normal;for(let i=0;i<uv.count;i++){const ax=Math.abs(n.getX(i)),ay=Math.abs(n.getY(i));uv.setXY(i,uv.getX(i)*(ax>.5?d:w)/(m===brick?2.4:.9),uv.getY(i)*(ay>.5?d:h)/(m===brick?2.4:.9));}}
  g.rotateY(angle);g.translate(x,y,z);put(g,m,role);boxes++;
 }
 function prism(ring,height,y,m,role='building') {const s=new THREE.Shape(ring.map(([x,z])=>new THREE.Vector2(x,-z)));const g=new THREE.ExtrudeGeometry(s,{depth:height,bevelEnabled:false,steps:1});g.rotateX(-Math.PI/2);g.translate(0,y,0);put(g,m,role);}
 function segment(a,b,y,width,height,m,role='site'){const dx=b[0]-a[0],dz=b[1]-a[1];box((a[0]+b[0])/2,y,(a[1]+b[1])/2,Math.hypot(dx,dz),height,width,m,role,-Math.atan2(dz,dx));}
 function cylinder(x,y,z,r,h,m,role='site'){const g=new THREE.CylinderGeometry(r,r,h,8);g.translate(x,y,z);put(g,m,role);}
 function shrub(x,z,scale=1){cylinder(x,1.5*scale,z,.14*scale,2.8*scale,trunk);for(let k=0;k<3;k++)for(let j=0;j<5;j++){const a=j*Math.PI*2/5+k*.7,g=new THREE.IcosahedronGeometry(1,1);const w=(1.2-k*.18)*scale;g.scale(w,.43*scale,w*.8);g.translate(x+Math.cos(a)*w*.55,1.0*scale+k*.8*scale+(j%2)*.08,z+Math.sin(a)*w*.45);put(g,(j+k)%3?green:green2,'planting');}}
 function lawnTree(x,z,h=7){cylinder(x,h*.33,z,.22,h*.65,trunk);for(let i=0;i<7;i++){const a=i*2.4,rad=i<2?.5:1.8;const g=new THREE.IcosahedronGeometry(1,1);g.scale(1.7+(i%3)*.2,1.3+(i%2)*.4,1.7);g.translate(x+Math.cos(a)*rad,h*.64+(i%3)*.65,z+Math.sin(a)*rad);put(g,i%2?green:green2,'planting');}}
 function window(x,y,z,w,h,role='building',angle=0){
  // Frame, inset glazing, paired operable sash and sill. No photograph baked into lighting.
  box(x,y,z,w+.18,h+.18,.15,metal,role,angle);const dx=Math.sin(angle)*.095,dz=Math.cos(angle)*.095;
  box(x+dx,y,z+dz,w,h,.05,glass,role,angle);
  box(x+dx*1.4,y,z+dz*1.4,.065,h,.06,metal,role,angle);
  box(x+dx*1.4,y-h*.19,z+dz*1.4,w,.055,.06,metal,role,angle);
  box(x+dx,y-h/2-.14,z+dz,w+.3,.12,.33,edge,role,angle);
 }
 const ring=f.ring.map(p=>[...p]);
 // Backing wall is recessed behind the photographed open colonnade, while roof
 // and columns retain the mapped central facade line.
 ring[5][1]-=2.5;ring[6][1]-=2.5;
 prism(ring,18.65,.12,stone);
 prism(f.ring,.34,18.77,roof);
 // Side wings, tall end cores and the 10-bay central portico.
 const left=(f.ring[3][0]+f.ring[4][0])/2,right=(f.ring[7][0]+f.ring[8][0])/2;
 for(const [cx,width,front] of [[left,f.ring[4][0]-f.ring[3][0],f.ring[3][1]],[right,f.ring[8][0]-f.ring[7][0],f.ring[7][1]]]){
  box(cx,20.0,front-9,width,3.0,18,stone);box(cx,21.6,front-9,width+.25,.25,18.3,edge);
  // Actual photo shows a deep, tall glazed strip framed by solid stone.
  box(cx,10.3,front+.12,width*.65,17.8,.18,glass);box(cx,19.65,front+.2,width*.67,2.1,.6,stone);
  for(let i=0;i<=4;i++)box(cx-width*.325+i*width*.65/4,10.3,front+.27,.09,17.8,.09,metal);
  for(let j=0;j<=12;j++)box(cx,1.4+j*1.39,front+.27,width*.65,.09,.09,metal);
 }
 const half=f.span/2,bay=f.span/l.centralBays;
 box(0,19.35,-.7,f.span+.4,1.7,3.8,stone);box(0,20.3,-1.0,f.span+.8,.22,4.4,edge);
 box(0,.8,-1,f.span,1.3,5.3,stone);
 for(let i=1;i<10;i++){const x=-half+i*bay;box(x,9.6,.05,.74,17.6,1.1,stone);box(x,18.4,.05,1.0,.45,1.25,edge);box(x,1.15,.05,1.05,.55,1.3,stone);}
 for(let col=0;col<10;col++)for(let row=0;row<5;row++){
  const x=-half+bay*(col+.5),y=2.55+row*3.28;
  window(x,y,-2.32,bay-.78,1.55);
  if(row===4)box(x,17.55,-2.2,bay-.78,.18,.35,dark);
 }
 // Wings and non-front edges have individually scaled bays; rear pattern is
 // explicitly approximate rather than claimed to be observed in the front photo.
 for(let i=0;i<f.ring.length;i++){
  const a=f.ring[i],b=f.ring[(i+1)%f.ring.length],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);
  if([2,3,4,5,6,7,8].includes(i)||len<4)continue;
  const nx=-dz/len,nz=dx/len,angle=-Math.atan2(dz,dx),count=Math.max(1,Math.round(len/4.4));
  if(i!==10)for(let c=0;c<count;c++)for(let row=0;row<5;row++)window(a[0]+dx*(c+.5)/count+nx*.12,2.25+row*3.27,a[1]+dz*(c+.5)/count+nz*.12,len/count-.9,1.65,'building',angle);
  segment(a,b,19.15,.32,.42,edge,'building');
 }
 // Central doors, landing and shallow flight (riser/tread dimensions assumed).
 box(0,2.9,-2.17,8.6,3,.2,dark);for(let i=0;i<6;i++)window(-3.5+i*1.4,2.9,-2.02,1.28,2.8);
 box(0,1.18,2.5,13,.4,5.6,paving,'building');
 for(let i=0;i<7;i++)box(0,.36+(7-i)*.075,5.0+i*.42,13,(7-i)*.15,.44,edge,'site');
 for(const x of [-6.2,6.2]){for(let i=0;i<4;i++)cylinder(x,1.05,5.2+i*.82,.045,1.45,metal);segment([x,5],[x,7.9],1.8,.06,.06,metal);}
 // Flat roof and observed rear projection are sourced; equipment layout remains assumed.
 for(const x of [-19,-9,1,11,21])box(x,19.7,-11,2.2,.8,2.0,roof);
 for(const x of [-2,0,2]){cylinder(x,23,-7,.055,6.2,metal,'building');box(x+.5,25.25,-7,1,.58,.035,x===0?paint:glass,'building');}
 // Forecourt path and terrace stop before the sourced transverse drive (~19m).
 box(0,.25,11.7,14,.12,8.5,paving,'site');
 for(const sign of [-1,1]){
  box(sign*22,.5,8.5,25,.6,4.5,stone,'site');
  for(let j=0;j<7;j++)shrub(sign*(11+j*4.4),10.4,.7+((j*7)%3)*.1);
 }
 // Existing water polygon remains exact; add material depth only to its perimeter.
 const pool=l.pool.ring.map(f.local);
 for(let i=0;i<pool.length;i++)segment(pool[i],pool[(i+1)%pool.length],.34,.36,.4,edge);
 const ps=l.pool.startLocal,pe=l.pool.endLocal;
 for(const sign of [-1,1]){
  for(let j=0;j<17;j++){
   const t=(j+.5)/17,z=ps[1]+(pe[1]-ps[1])*t,x=ps[0]+(pe[0]-ps[0])*t+sign*7.1;
   shrub(x,z,.68+(j%3)*.08);
  }
  // Diagonal bays seen in overhead imagery, relative position not surveyed.
  box(sign*18,.29,104,7,.08,118,paving,'site');
  for(let j=0;j<30;j++){const z=46+j*3.95;segment([sign*14.8,z],[sign*21.1,z+2.8],.36,.095,.015,paint);}
  for(let j=0;j<7;j++){
   const x=sign*8.0,z=46+j*19.4;cylinder(x,3.5,z,.065,6.3,metal);
   for(const s of [-1,1]){
    const curve=new THREE.QuadraticBezierCurve3(new THREE.Vector3(x,5.7,z),new THREE.Vector3(x+s*.9,7.4,z),new THREE.Vector3(x+s*1.25,5.95,z));put(new THREE.TubeGeometry(curve,8,.04,5,false),metal,'site');
    cylinder(x+s*1.25,5.75,z,.16,.42,paint);
   }
  }
 }
 for(const side of [-1,1])for(let row=0;row<5;row++)for(let col=0;col<3;col++){const x=side*(31+col*13+(row%2)*4),z=37+row*34+(col%2)*7;if(data.surfaces.some(s=>s.kind==='green'&&s.polygons.some(p=>{const q=f.world(x,z);let inside=false;for(let i=0,j=p.outer.length-1;i<p.outer.length;j=i++){const a=p.outer[i],b=p.outer[j];if((a[1]>q[1])!==(b[1]>q[1])&&q[0]<(b[0]-a[0])*(q[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;})))lawnTree(x,z,6.5+(row+col)%3);}
 // A few parked cars provide familiar scale, not a record of real parked vehicles.
 const carMats=[standard('#d8d9d4',.4,.12),standard('#5d6770',.4,.18),standard('#303b41',.45,.13)];
 for(let j=0;j<10;j++){
  const side=j%2?1:-1,x=side*18.2,z=57+Math.floor(j/2)*23,angle=side*.48;
  const carColor=carMats[j%3];
  const profile=[[2.18,.56],[2.12,.97],[1.26,1.13],[.58,1.67],[-.65,1.7],[-1.35,1.14],[-2.12,1.0],[-2.2,.55]];
  const shape=new THREE.Shape(profile.map(p=>new THREE.Vector2(...p))),g=new THREE.ExtrudeGeometry(shape,{depth:1.82,bevelEnabled:true,bevelSize:.07,bevelThickness:.07,bevelSegments:1,steps:1});
  const at=g.attributes.position;for(let i=0;i<at.count;i++){const oz=at.getX(i);at.setXYZ(i,at.getZ(i)-.91,at.getY(i),oz);}g.computeVertexNormals();g.rotateY(angle);g.translate(x,0,z);put(g,carColor,'site');
  // Sloped side glazing and windscreens follow the roofline.
  for(const side of [-1,1]){const verts=[];const win=[[-1.16,1.16],[-.61,1.62],[.51,1.60],[1.05,1.17]];for(const index of [0,1,2,0,2,3]){const [zz,yy]=win[index];verts.push(side*.93,yy,zz);}const wg=new THREE.BufferGeometry();wg.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));wg.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,0,1,1,1,0,0,1,1,1,0],2));wg.computeVertexNormals();wg.rotateY(angle);wg.translate(x,0,z);put(wg,glass,'site');}
  box(x,1.15,z,1.5,.05,2.2,glass,'site',angle);
  for(const s of [-1,1])for(const k of [-1,1]){const g=new THREE.CylinderGeometry(.32,.32,.22,10);g.rotateZ(Math.PI/2);g.translate(s*.91,.65,k*1.35);g.rotateY(angle);g.translate(x,0,z);put(g,rubber,'site');}
 }
 // Gate: an open entrance with LOW side walls, not a fictitious arch.
 const [gx,gz]=l.gate.local;
 box(gx,.28,gz-4,37,.08,14,paving,'site');
 for(const sign of [-1,1]){
  const x=gx+sign*31;box(x,1.3,gz,25,2,.65,brick,'site');box(x,2.35,gz,25.4,.16,.85,edge,'site');box(x,1.33,gz+.36,22.8,1.25,.08,paint,'site');
  labelJobs.push({x,y:1.33,z:gz+.415,width:21,height:1.1,text:'인 하 대 학 교   INHA UNIVERSITY'});
 }
 // Crosswalk is photo-informed; its offset/stripe dimensions are not surveyed.
 for(let j=0;j<15;j++)box(gx-14+j*2,.37,gz+7,.9,.025,4.0,paint,'site');
 for(const sign of [-1,1]){const x=gx+sign*19;cylinder(x,3.3,gz+2,.075,6,metal);box(x,5.3,gz+2,.4,1.0,.3,dark,'site');box(x,5.6,gz+2.17,.18,.18,.05,green2,'site');}
 // Add roof/lintels to the mapped parking office, leaving its surveyed status unchanged.
 const booth=data.buildings.find(b=>b.id==='way/1098539003');if(booth){const pts=booth.polygons[0].outer.map(f.local),xs=pts.map(p=>p[0]),zs=pts.map(p=>p[1]);const x=(Math.min(...xs)+Math.max(...xs))/2,z=(Math.min(...zs)+Math.max(...zs))/2,w=Math.max(...xs)-Math.min(...xs),d=Math.max(...zs)-Math.min(...zs);prism(pts,booth.height_m,.12,brick,'guard');box(x,booth.height_m+.25,z,w+.6,.35,d+.6,edge,'guard');window(x-.65,1.95,z+d/2+.1,w*.53,1.6,'guard');window(x+w/2+.1,1.9,z,Math.min(3,d*.6),1.6,'guard',Math.PI/2);box(x+w*.34,1.45,z+d/2+.15,.85,2.55,.08,dark,'guard');labelJobs.push({x,y:booth.height_m+.25,z:z+d/2+.34,width:w*.8,height:.25,text:'INHA UNIVERSITY'});}
 for(const {m,role,geos} of batches.values()){
  const merged=mergeGeometries(geos.map(g=>g.index?g.toNonIndexed():g));geos.forEach(g=>g.dispose());const o=new THREE.Mesh(merged,m);o.name='main-detail / '+role;o.castShadow=true;o.receiveShadow=true;
  if(role==='building'){o.userData.building=l.building;buildingGroup.add(o);}else if(role==='guard'){o.userData.building=booth;guardGroup.add(o);}else root.add(o);
 }
 // Text is drawn locally after the existing campus font is ready. No image fetch.
 for(const job of labelJobs){const c=document.createElement('canvas');c.width=2048;c.height=128;const ctx=c.getContext('2d'),t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;const draw=()=>{ctx.clearRect(0,0,c.width,c.height);ctx.fillStyle='#545d5c';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='62px CampusSans, sans-serif';ctx.fillText(job.text,1024,64);t.needsUpdate=true;};draw();document.fonts?.load('62px CampusSans').then(draw);const m=new THREE.MeshBasicMaterial({map:t,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1});const o=new THREE.Mesh(new THREE.PlaneGeometry(job.width,job.height),m);o.position.set(job.x,job.y,job.z);root.add(o);}
 root.rotation.y=f.angle;root.position.set(f.origin[0],0,f.origin[1]);root.updateMatrixWorld(true);
 return {root,buildingGroup,guardGroup,layout:l,stats:{revision:'main-precinct-detail-v1',centralBays:10,windowTiersAssumed:5,detailBoxes:boxes,detailDrawMeshes:batches.size+labelJobs.length,referencePhotosEmbedded:0},focusPoints:{mainFront:{position:f.world(0,105),target:f.world(0,0),height:13,targetHeight:9},mainEntry:{position:f.world(14,31),target:f.world(0,0),height:5.6,targetHeight:6},gate:{position:f.world(gx,gz+44),target:f.world(gx,gz-27),height:7,targetHeight:4}}};
}
