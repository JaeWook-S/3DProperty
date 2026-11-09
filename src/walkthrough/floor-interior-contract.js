import {getFloorUnits} from '../property/unit-catalog.js';

// Catalog evidence establishes types on this floor, never adjacency or orientation.
export function floorInteriorAvailability(building, floor) {
  const rows=getFloorUnits(String(building),floor);
  const a=rows.find(row=>row.type==='211.99A');
  const b=rows.find(row=>row.type==='168.95C');
  const available=String(building)==='100'&&Number.isInteger(floor)&&floor>=3&&floor<=21&&Boolean(a&&b);
  const fiveUnits=available&&floor===10&&rows.length===5&&['168.66D','145.95F','145.95F','211.99A','168.95C'].every((type,index)=>rows.find(row=>row.unit===`10${String(index+1).padStart(2,'0')}`)?.type===type);
  return {available,fiveUnits,displayUnits:fiveUnits?rows:available?[a,b]:[],building:String(building),floor,units:available?[a,b]:[],totalUnits:rows.length,
    layoutVerified:false,renovationState:'unknown',display:'inline-floor-section',scale:1};
}
export const INLINE_FLOOR_OFFSET_M=.06;
export function floorInteriorPlacement(building,floor) {
  const storey=building.height_m/building.floors;
  // Horizontal unit poses are in the site's meter coordinates. The only vertical
  // offset separates their floor surface from the existing OSM floor plate.
  return {position:[0,(floor-1)*storey+INLINE_FLOOR_OFFSET_M,0],
    floorBaseY:(floor-1)*storey,sourceFloorTopY:floor*storey,
    displayFloorOffset_m:INLINE_FLOOR_OFFSET_M,liftMeters:0,rotationY:0,scale:1};
}
