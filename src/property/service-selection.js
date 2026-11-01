import {lookupUnit,variantForUnit,UNIT_CATALOG_SOURCE} from './unit-catalog.js';
// URL labels cannot prove unit type or the household's actual expansion state.
export const SELECTION_FIELDS=['locationId','locationName','address','lat','lon','building','floor','unit','unitType','sampleVariant','serviceView','mapLat','mapLon','mapZoom','room','physicalRoom','buildingType','typeEvidence','typeScope','renovationState','previewMode'];
const text=(value,max=180)=>typeof value==='string'?value.slice(0,max):'';
export function normalizeSelection(value={}){
  const n=(key,min,max)=>{if(value[key]===null||value[key]===undefined||value[key]==='')return null;const x=Number(value[key]);return Number.isFinite(x)&&x>=min&&x<=max?x:null;};
  const result={locationId:text(value.locationId,100),locationName:text(value.locationName),address:text(value.address,250),lat:n('lat',-90,90),lon:n('lon',-180,180),building:text(value.building,40),floor:Number.isInteger(n('floor',1,100))?n('floor',1,100):null,unit:text(value.unit,40),unitType:'unknown',sampleVariant:text(value.sampleVariant,80)||'112a-expanded-archisketch',serviceView:['map','plan','3d','site'].includes(value.serviceView)?value.serviceView:'map',mapLat:n('mapLat',-90,90),mapLon:n('mapLon',-180,180),mapZoom:n('mapZoom',3,19),room:text(value.room,100),physicalRoom:text(value.physicalRoom,100),buildingType:text(value.buildingType,100),typeEvidence:text(value.typeEvidence,400),typeScope:value.typeScope==='building_type'?'building_type':'',renovationState:'unknown',previewMode:value.previewMode==='sample'?'sample':'unit'};
  const unit=result.locationId==='acro-river-park'?lookupUnit(result.building,result.floor,result.unit):null;
  if(unit){result.unitType=unit.type;result.sampleVariant=variantForUnit(unit,result.sampleVariant)||result.sampleVariant;result.typeScope='unit';result.typeEvidence=UNIT_CATALOG_SOURCE.csvSha256;result.previewMode='unit';}
  return result;
}
export function readSelection(url){const p=new URL(url).searchParams;return normalizeSelection(Object.fromEntries(SELECTION_FIELDS.map(k=>[k,p.get(k)])));}
export function writeSelection(url,value){const next=new URL(url),s=normalizeSelection(value);for(const k of SELECTION_FIELDS){if(s[k]===null||s[k]==='')next.searchParams.delete(k);else next.searchParams.set(k,String(s[k]));}return next;}
