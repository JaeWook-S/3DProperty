const NS='http://www.w3.org/2000/svg';
function shape(tag,attributes){const n=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attributes))n.setAttribute(k,v);return n;}
// Display-only section of the active model. The source coordinates stay in metres.
export function appendPlanArchitecture(svg,architecture){
 if(!architecture)return;
 const layer=shape('g',{class:'plan-architecture','aria-hidden':'true','pointer-events':'none'});
 for(const wall of architecture.walls||[]){
  const common={'data-wall':wall.id,class:`plan-wall${wall.component==='excluded_volume'?' excluded':''}`};
  if(wall.path)layer.append(shape('path',{...common,d:wall.path,'fill-rule':'evenodd'}));
  if(wall.outline)layer.append(shape('path',{...common,class:'plan-wall-outline',d:wall.outline,fill:'none','vector-effect':'non-scaling-stroke'}));
 }
 const line=(points,className,id)=>{if(!points?.length)return;layer.append(shape('polyline',{points:points.map(p=>p.join(',')).join(' '),class:className,'data-opening':id,fill:'none','vector-effect':'non-scaling-stroke'}));};
 for(const o of architecture.openings||[]){
  if(o.kind==='window')line(o.segment,'plan-window',o.id);
  else if(o.kind==='sliding')line(o.segment,'plan-sliding',o.id);
  else {line(o.leaf||o.segment,'plan-door',o.id);line(o.swing,'plan-door-swing',o.id);}
 }
 svg.append(layer);
}
