// X east, Z south. Preserve OSM rings and courtyards; render-only massing assumptions.
export function pointInRing([x,z], ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
export function inPolygon(p,poly){return pointInRing(p,poly.outer)&&!poly.holes.some(h=>pointInRing(p,h));}
export function bounds(ring){return {minX:Math.min(...ring.map(p=>p[0])),maxX:Math.max(...ring.map(p=>p[0])),minZ:Math.min(...ring.map(p=>p[1])),maxZ:Math.max(...ring.map(p=>p[1]))};}
export function clipRing(ring,normal,cut,keepHigh){const out=[];for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],da=a[0]*normal[0]+a[1]*normal[1]-cut,db=b[0]*normal[0]+b[1]*normal[1]-cut,ia=keepHigh?da>=0:da<=0,ib=keepHigh?db>=0:db<=0;if(ia)out.push(a);if(ia!==ib){const t=da/(da-db);out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}}return out;}
export function massingParts(building){
 if(building.landmark==='library')return building.polygons.map(p=>({...p,height:32}));
 if(!['hightech','anniversary'].includes(building.landmark))return building.polygons.map(p=>({...p,height:building.height_m}));
 const p=building.polygons[0],normal=building.landmark==='anniversary'?[0,-1]:[1,0],q=p.outer.map(x=>x[0]*normal[0]+x[1]*normal[1]),cut=Math.min(...q)+(Math.max(...q)-Math.min(...q))*(building.landmark==='anniversary'?.63:.72);
 return [{outer:clipRing(p.outer,normal,cut,false),holes:[],height:building.landmark==='anniversary'?10.8:18},{outer:clipRing(p.outer,normal,cut,true),holes:[],height:building.height_m}].filter(p=>p.outer.length>=3);
}
