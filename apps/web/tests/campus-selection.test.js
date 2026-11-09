import test from 'node:test';
import assert from 'node:assert/strict';
import {ACRO,INHA,PREPARED_PLACES,createPlaceSearch,photonPlaces} from '../src/place-search.js';
import {normalizeSelection,readSelection,writeSelection} from '../../../src/property/service-selection.js';

test('prepared campus has official location and exterior-only identity',()=>{
 assert.deepEqual(PREPARED_PLACES.map(p=>p.id),['acro-river-park','inha-university']);
 assert.equal(INHA.name,'인하대학교');assert.equal(INHA.address,'인천 미추홀구 인하로 100');
 assert.deepEqual([INHA.lat,INHA.lon],[37.4501371,126.6537133]);assert.equal(INHA.kind,'campus');assert.equal(INHA.ready,true);
 assert.match(INHA.basis,/외관.*실내 준비 중/);
});
test('prepared aliases bypass provider, local storage and throttling',async t=>{
 let network=0,cache=0;
 t.mock.method(globalThis,'fetch',async()=>{network++;throw Error('provider unavailable');});
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem(){cache++;throw Error('storage disabled');}}});
 t.after(()=>descriptor?Object.defineProperty(globalThis,'localStorage',descriptor):delete globalThis.localStorage);
 const search=createPlaceSearch({searchUrl:'not-a-network-url'});
 for(const q of ['인하대','인하대학교',' 인하 대학교 ','인하대학교 본캠퍼스','Inha University'])assert.deepEqual(await search(q),[INHA]);
 assert.deepEqual(await search('아크로 리버파크'),[ACRO]);assert.equal(network,0);assert.equal(cache,0);
});
test('Inha Technical College stays an unregistered result and does not throttle a prepared alias',async t=>{
 let network=0;
 t.mock.method(globalThis,'fetch',async()=>{network++;return {ok:true,json:async()=>({features:[{geometry:{coordinates:[126.655,37.45]},properties:{name:'인하공업전문대학',osm_type:'W',osm_id:2}}]})};});
 const search=createPlaceSearch({searchUrl:'https://search.example/api'}),found=await search('인하공전');
 assert.equal(found[0].ready,false);assert.equal(found[0].id,'osm:way:2');
 assert.deepEqual(await search('인하대'),[INHA]);assert.equal(network,1);
});
test('a matching name away from campus cannot become a prepared campus',()=>{
 const f=(id,name,xy)=>({geometry:{coordinates:xy},properties:{name,osm_type:'W',osm_id:id}});
 const found=photonPlaces({features:[f(1,'인하대학교',[128,36]),f(2,'인하대학교',[INHA.lon,INHA.lat]),f(3,'인하공업전문대학',[INHA.lon,INHA.lat])]});
 assert.equal(found.length,3);assert.equal(found[0].ready,false);assert.equal(found[1],INHA);assert.equal(found[2].ready,false);
});
test('campus state drops household, interior preview and room evidence even from a stale Acro URL',()=>{
 const state=normalizeSelection({locationId:INHA.id,building:'100',floor:3,unit:'305',unitType:'168C',sampleVariant:'168c-expanded-archisketch',previewMode:'sample',serviceView:'3d',room:'kitchen',physicalRoom:'kitchen',buildingType:'168C',typeScope:'building_type',typeEvidence:'not campus evidence',renovationState:'expanded'});
 assert.equal(state.serviceView,'site');assert.equal(state.unitType,'unknown');assert.equal(state.renovationState,'unknown');assert.equal(state.previewMode,'unit');
 for(const key of ['building','unit','sampleVariant','room','physicalRoom','buildingType','typeEvidence','typeScope'])assert.equal(state[key],'');
 assert.equal(state.floor,null);assert.deepEqual(normalizeSelection(state),state);
});
test('campus map/site roundtrips preserve forwarded endpoints and map position without interior fallback',()=>{
 for(const serviceView of ['map','site','plan','3d']){
  const url=writeSelection('http://localhost:15785/service/?viewerUrl=http%3A%2F%2Flocalhost%3A15739%2Fviewer%2F',{locationId:INHA.id,serviceView,mapLat:37.45,mapLon:126.65,mapZoom:16});
  const state=readSelection(url);assert.equal(state.serviceView,['map','site'].includes(serviceView)?serviceView:'site');assert.equal(state.sampleVariant,'');
  assert.equal(url.searchParams.has('sampleVariant'),false);assert.equal(url.searchParams.get('viewerUrl'),'http://localhost:15739/viewer/');assert.equal(state.mapZoom,16);
 }
});
