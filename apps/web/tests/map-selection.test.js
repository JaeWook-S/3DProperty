import test from 'node:test';import assert from 'node:assert/strict';
import {readSelection,writeSelection} from '../../../src/property/service-selection.js';
import {photonPlaces} from '../src/place-search.js';import {buildViewerUrl} from '../src/viewer-url.js';
test('catalog unit type roundtrips while expansion remains an explicit preview choice',()=>{
 const state={locationId:'acro-river-park',locationName:'아크로리버파크',building:'100',floor:3,unit:'305',unitType:'112A',renovationState:'expanded',sampleVariant:'112a-basic-archisketch',room:'kitchen',serviceView:'plan'};
 const u=writeSelection('http://localhost:5185/?test=1',state),result=readSelection(u);
 assert.equal(result.unitType,'168.95C');assert.equal(result.renovationState,'unknown');assert.equal(result.typeScope,'unit');assert.equal(result.sampleVariant,'168c-basic-archisketch');
 const v=new URL(buildViewerUrl('http://localhost:5173/',state.sampleVariant,{selection:result,embedded:true}));
 assert.equal(v.searchParams.get('variant'),'168c-basic-archisketch');assert.equal(v.searchParams.get('unit'),'305');assert.equal(v.searchParams.get('room'),'kitchen');assert.equal(u.searchParams.get('test'),'1');assert.equal(v.searchParams.get('embedded'),'1');
});
test('unsupported and fabricated households cannot open an unrelated interior',()=>{
 const state={locationId:'acro-river-park',building:'101',floor:7,unit:'701',sampleVariant:'168c-expanded-archisketch'};
 const result=readSelection(writeSelection('http://localhost',state));assert.equal(result.unitType,'79.24E');
 assert.throws(()=>buildViewerUrl('http://localhost:5173/',state.sampleVariant,{selection:result}),/준비 중/);
 assert.doesNotThrow(()=>buildViewerUrl('http://localhost:5173/',state.sampleVariant,{selection:result,entry:'complex'}));
 const wrong=readSelection(writeSelection('http://localhost',{...state,unit:'9999',unitType:'168C'}));assert.equal(wrong.unitType,'unknown');assert.throws(()=>buildViewerUrl('http://localhost',state.sampleVariant,{selection:wrong}),/준비 중/);
});
test('a deliberate sample preview has no household assignment',()=>{
 const s=readSelection('http://localhost/?locationId=acro-river-park&previewMode=sample&sampleVariant=112a-basic-archisketch');
 assert.equal(s.unit,'');assert.equal(s.unitType,'unknown');assert.equal(s.previewMode,'sample');assert.doesNotThrow(()=>buildViewerUrl('http://localhost',s.sampleVariant,{selection:s}));
});
test('invalid numeric selection is not used as a coordinate or floor',()=>{const s=readSelection('http://localhost/?lat=999&lon=no&floor=-1&mapZoom=50&serviceView=script');assert.equal(s.lat,null);assert.equal(s.floor,null);assert.equal(s.mapZoom,null);assert.equal(s.serviceView,'map');assert.equal(readSelection('http://localhost/?unitType=168C').unitType,'unknown');assert.equal(readSelection('http://localhost/?floor=3.5').floor,null);});
test('search results never acquire a model merely by matching a name',()=>{const input={features:[{geometry:{coordinates:[127.3,38]},properties:{osm_type:'N',osm_id:1,name:'아크로리버파크'}},{geometry:{coordinates:[999,2]},properties:{osm_type:'N',osm_id:2,name:'invalid'}}]};const result=photonPlaces(input);assert.equal(result.length,1);assert.equal(result[0].ready,false);assert.equal(result[0].source,'https://www.openstreetmap.org/node/1');});
