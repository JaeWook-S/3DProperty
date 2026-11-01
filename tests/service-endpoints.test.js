import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveViewerBase,resolveServiceBase} from '../src/property/service-endpoints.js';
import {writeSelection} from '../src/property/service-selection.js';
test('arbitrary service/viewer ports survive explicit links and a standalone return',()=>{
 const page='http://127.0.0.1:39801/?viewerUrl='+encodeURIComponent('http://127.0.0.1:42611/');
 const viewer=resolveViewerBase(page);assert.equal(viewer.port,'42611');const service=resolveServiceBase(viewer);assert.equal(service.port,'39801');assert.equal(new URL(service.searchParams.get('viewerUrl')).port,'42611');
 const selected=writeSelection(viewer,{building:'100',floor:7,room:'bedroom-2'});assert.equal(resolveServiceBase(selected).port,'39801');
});
test('query endpoint overrides configured/default ports; custom path and HTTPS remain intact',()=>{
 const page='https://demo.example/service/?viewerUrl='+encodeURIComponent('https://demo.example/viewer/');const viewer=resolveViewerBase(page,'http://localhost:5173/');assert.equal(viewer.origin,'https://demo.example');assert.equal(viewer.pathname,'/viewer/');assert.equal(resolveServiceBase(viewer).pathname,'/service/');
});
test('unsafe endpoint schemes and credentials never become navigation targets',()=>{
 for(const value of ['javascript:alert(1)','data:text/html,test','https://user:secret@example.com/','http://[bad']){
  const p='http://localhost:35185/?viewerUrl='+encodeURIComponent(value);assert.equal(resolveViewerBase(p,'http://localhost:35173/').port,'35173');
  assert.equal(resolveServiceBase('http://localhost:35173/?serviceUrl='+encodeURIComponent(value),'http://localhost:35185/').port,'35185');
 }
});
test('standard development defaults work; remembered origins support old direct links',()=>{
 assert.equal(resolveViewerBase('http://localhost:5185/').port,'5173');assert.equal(resolveServiceBase('http://localhost:5173/').port,'5185');
 assert.equal(resolveServiceBase('http://localhost:35173/?studio=1','','http://localhost:35185/').port,'35185');assert.equal(resolveViewerBase('http://localhost:35185/','','http://localhost:35173/').port,'35173');
});
test('repeated returns do not nest endpoint URLs or carry stale viewer selection into the home URL',()=>{
 let page='http://localhost:35185/?viewerUrl='+encodeURIComponent('http://localhost:35173/');
 for(let i=0;i<20;i++){const viewer=resolveViewerBase(page);viewer.searchParams.set('variant','168c-expanded-archisketch');viewer.searchParams.set('studio','1');page=resolveServiceBase(viewer).href;}
 assert.ok(page.length<180);assert.equal(new URL(page).searchParams.has('variant'),false);assert.equal(new URL(page).searchParams.has('studio'),false);
});
