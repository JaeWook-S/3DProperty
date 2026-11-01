// Semantic catalog rooms mapped onto the current coordinate model. Planning zones
// only: no wall, room polygon or furniture dimensions are rescaled.
const aliases={'Living front':'living-kitchen-hall','Kitchen':'living-kitchen-hall','Bedroom west':'bedroom-1','Bedroom center':'bedroom-2','Master bedroom':'primary'};
export function conceptRoomId(id,info){
  return info.unitType==='112A' && info.wallSlice ? aliases[id] || id : id;
}
export function coordinateConceptInput(concept,info){
  const get=id=>info.rooms.find(r=>r.id===id),shared=get('living-kitchen-hall');
  if(!shared)return {concept,rooms:info.rooms,variant:info.variant,search:false};
  const study=get('bedroom-2'),primary=get('primary'),table=info.fixtures.find(f=>f.id==='dining-table');
  const zone=(id,bounds)=>{
    const source=get(aliases[id]);
    return {...source,id,sourceRoomId:source.id,bounds_m:bounds || source.bounds_m,validationRoom:source};
  };
  const rooms=[
    zone('Living front',[study.bounds_m[2]+.32,primary.bounds_m[1]+.6,shared.bounds_m[2],shared.bounds_m[3]]),
    zone('Kitchen',[study.bounds_m[2]+.32,2.9,shared.bounds_m[2]-.8,primary.bounds_m[1]+.6]),
    zone('Bedroom west'),zone('Bedroom center'),zone('Master bedroom'),
  ];
  const items=concept.items.map(item=>{
    if(item.room!=='Kitchen')return item;
    const b=table?.bounds_m,center=b?[(b[0]+b[2])/2,(b[1]+b[3])/2]:[7.2,4];
    return {...item,x:['at',center[0]],z:['at',center[1]],variants:undefined,
      candidates:[{kind:'dining4',x:['at',center[0]],z:['at',center[1]]},{kind:'dining2',x:['at',center[0]],z:['at',center[1]]}]};
  });
  return {concept:{...concept,items},rooms,variant:info.variant,search:true};
}
