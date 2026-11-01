import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { furnitureApiConfig } from '../tools/vite/furniture-api.js';
const flag = result => JSON.parse(result.define['import.meta.env.VITE_FURNITURE_MEASUREMENT_ENABLED']);

test('manual dev enables only a ready API and respects the configured proxy target', async t => {
  let body={status:'ok',ready:true};
  const paths=[];
  const server=createServer((req,res)=>{paths.push(req.url);res.setHeader('content-type','application/json');res.end(JSON.stringify(body));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const target='http://127.0.0.1:'+server.address().port;
  const args={command:'serve',processEnv:{},env:{FURNITURE_API_TARGET:target}};
  const ready=await furnitureApiConfig(args);
  assert.equal(flag(ready),'1');assert.equal(ready.proxy['/api/furniture'].target,target);
  body={status:'ok',ready:false};assert.equal(flag(await furnitureApiConfig(args)),'0');
  body={status:'ok',ready:'true'};assert.equal(flag(await furnitureApiConfig(args)),'0');
  body={status:'error',ready:true};assert.equal(flag(await furnitureApiConfig(args)),'0');
  assert.deepEqual(paths,['/health','/health','/health','/health']);
});

test('unreachable, malformed and slow APIs preserve preview-only dev mode', async t => {
  for(const fetchImpl of [async()=>{throw Error('ECONNREFUSED');},async()=>({ok:false}),async()=>({ok:true,json:async()=>{throw Error('HTML');}})]) {
    assert.equal(flag(await furnitureApiConfig({command:'serve',processEnv:{},fetchImpl})),'0');
  }
  const server=createServer(()=>{});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const result=await furnitureApiConfig({command:'serve',processEnv:{FURNITURE_API_TARGET:'http://127.0.0.1:'+server.address().port},timeoutMs:40});
  assert.equal(flag(result),'0');
});

test('launcher flags override env and builds never probe a developer machine', async()=>{
  const fetchImpl=()=>{throw Error('must not probe');};
  for(const enabled of ['0','1']) {
    const result=await furnitureApiConfig({command:'serve',processEnv:{VITE_FURNITURE_MEASUREMENT_ENABLED:enabled},env:{VITE_FURNITURE_MEASUREMENT_ENABLED:enabled==='0'?'1':'0'},fetchImpl});
    assert.equal(flag(result),enabled);
  }
  assert.equal(flag(await furnitureApiConfig({command:'build',processEnv:{},fetchImpl})),'1');
  assert.equal(flag(await furnitureApiConfig({command:'build',processEnv:{},env:{VITE_FURNITURE_MEASUREMENT_ENABLED:'0'},fetchImpl})),'0');
  await assert.rejects(furnitureApiConfig({command:'serve',processEnv:{VITE_FURNITURE_MEASUREMENT_ENABLED:'false'}}),/must be 0 or 1/);
});
