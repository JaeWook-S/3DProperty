import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const launcher=fileURLToPath(new URL('../open-studio.command',import.meta.url));
const scratch=fileURLToPath(new URL('../runtime/service-map/2026-10-23/launcher/tmp/',import.meta.url));
mkdirSync(scratch,{recursive:true});
// Run the real Bash script; mock only OS/network/browser boundaries.
function fixture(t,initial={}) {
 const dir=mkdtempSync(join(scratch,'fixture-')),bin=join(dir,'bin');mkdirSync(bin);
 const stateFile=join(dir,'state.json'),save=s=>writeFileSync(stateFile,JSON.stringify(s)),state=()=>JSON.parse(readFileSync(stateFile,'utf8'));
 save({master:false,server:false,service:false,forwards:[],occupied:[],trace:[],...initial});
 const fake=join(bin,'command.cjs');writeFileSync(fake,`
const fs=require('node:fs'),path=require('node:path');
const file=process.env.LAUNCHER_TEST_STATE,s=JSON.parse(fs.readFileSync(file)),args=process.argv.slice(2),command=path.basename(process.argv[1]);
s.trace.push({command,args});let code=0,output='';
if(command==='ssh'){
 const op=args.includes('-O')?args[args.indexOf('-O')+1]:null;
 if(op==='check')code=s.master?0:1;
 else if(op==='exit'){s.master=false;s.forwards=[];}
 else if(op==='forward'){
  const parts=args[args.indexOf('-L')+1].split(':'),port=Number(parts[1]),remote=Number(parts[3]);
  if(s.occupied.includes(port)||s.forwards.some(f=>f.port===port)||!s.master)code=1;else s.forwards.push({port,remote});
 }else if(args.includes('-fN')){if(s.authFail)code=255;else s.master=true;}
 else{if(s.remoteFail)code=1;else{s.server=true;s.service=true;}}
}else if(command==='curl'){
 const port=Number(new URL(args.at(-1)).port),f=s.forwards.find(f=>f.port===port);
 if(s.master&&f&&f.remote===5173&&s.server)output='<div id="viewport"></div>';
 else if(s.master&&f&&f.remote===5185&&s.service)output='<div id="map-service"></div>';
 else if(s.foreignViewer&&s.occupied.includes(port))output='<div id="viewport"></div>';
 else code=7;
}else if(command==='lsof'){
 const port=Number(args.find(a=>a.startsWith('-iTCP:')).split(':')[1]);code=s.occupied.includes(port)||(s.master&&s.forwards.some(f=>f.port===port))?0:1;
}else if(command==='open')s.lastUrl=args[0];
fs.writeFileSync(file,JSON.stringify(s));process.stdout.write(output);process.exit(code);
`.trimStart(),{mode:0o755});
 // exec directly needs a shebang even for the mocked command.
 writeFileSync(fake,'#!/usr/bin/env node\n'+readFileSync(fake,'utf8'));
 for(const name of ['ssh','curl','lsof','open'])symlinkSync(fake,join(bin,name));
 const host='test-'+dir.split('/').at(-1)+'.invalid',root='/test/project with spaces';
 const key=spawnSync('cksum',[],{input:host+'\n'+root,encoding:'utf8'}).stdout.split(' ')[0];
 const session=join(dir,'cortex-studio-'+process.getuid()+'-'+key);
 if(initial.legacy){mkdirSync(session);writeFileSync(join(session,'port'),'35173\n');}
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 return {run:(...args)=>spawnSync('/bin/bash',[launcher,...args],{env:{...process.env,PATH:bin+':'+process.env.PATH,CORTEX_SSH_HOST:host,CORTEX_REMOTE_ROOT:root,CORTEX_LAUNCHER_STATE_ROOT:dir,LAUNCHER_TEST_STATE:stateFile},encoding:'utf8',timeout:20000,stdio:['ignore','pipe','pipe']}),state,mutate:update=>save({...state(),...update}),calls:fn=>state().trace.filter(fn)};
}
const masters=e=>e.command==='ssh'&&e.args.includes('-fN');
const forwards=e=>e.command==='ssh'&&e.args.includes('forward');
const helpers=e=>e.command==='ssh'&&!e.args.includes('-O')&&!e.args.includes('-fN');
const success=r=>assert.equal(r.status,0,r.stdout+r.stderr);
const endpoints=f=>{const service=new URL(f.state().lastUrl);return{service,viewer:new URL(service.searchParams.get('viewerUrl'))};};
test('fresh launch opens the map with actual viewerUrl and reuses both connections',t=>{
 const f=fixture(t);success(f.run());const {service,viewer}=endpoints(f);assert.equal(service.port,'35185');assert.equal(viewer.port,'35173');assert.equal(service.searchParams.has('studio'),false);success(f.run());assert.equal(f.calls(masters).length,1);assert.equal(f.calls(forwards).length,2);assert.equal(f.calls(helpers).length,1);assert.equal(endpoints(f).service.href,service.href);
});
test('both occupied default ports are avoided and their replacements remembered',t=>{
 const f=fixture(t,{occupied:[35173,35185]});success(f.run());const first=endpoints(f);assert.notEqual(first.service.port,'35185');assert.notEqual(first.viewer.port,'35173');assert.notEqual(first.service.port,first.viewer.port);success(f.run());assert.equal(endpoints(f).service.href,first.service.href);assert.deepEqual(f.state().occupied,[35173,35185]);assert.equal(f.calls(forwards).length,2);
});
test('upgrade from the old viewer-only launcher retains its origin and adds just the map tunnel',t=>{
 const f=fixture(t,{legacy:true,master:true,server:true,forwards:[{port:35173,remote:5173}]});success(f.run());assert.equal(endpoints(f).viewer.port,'35173');assert.equal(endpoints(f).service.port,'35185');assert.equal(f.calls(masters).length,0);assert.equal(f.calls(forwards).length,1);assert.equal(f.calls(helpers).length,1);assert.equal(f.state().service,true);
});
test('lost SSH does not adopt an unrelated viewer on the previously saved port',t=>{
 const f=fixture(t);success(f.run());f.mutate({master:false,forwards:[],occupied:[35173],foreignViewer:true});success(f.run());assert.equal(f.calls(masters).length,2);assert.notEqual(endpoints(f).viewer.port,'35173');assert.deepEqual(f.state().occupied,[35173]);
});
for(const name of ['server','service'])test(`stopped ${name} is restarted without changing either browser origin`,t=>{
 const f=fixture(t);success(f.run());const first=f.state().lastUrl;f.mutate({[name]:false});success(f.run());assert.equal(f.state().lastUrl,first);assert.equal(f.calls(helpers).length,2);assert.equal(f.calls(masters).length,1);assert.equal(f.calls(forwards).length,2);
});
test('authentication failure opens no browser and starts no remote command',t=>{
 const f=fixture(t,{authFail:true});assert.notEqual(f.run().status,0);assert.equal(f.state().lastUrl,undefined);assert.equal(f.calls(helpers).length,0);assert.equal(f.calls(forwards).length,0);
});
test('failed remote startup is reported; next launch retries through the same SSH master',t=>{
 const f=fixture(t,{remoteFail:true});assert.notEqual(f.run().status,0);assert.equal(f.state().lastUrl,undefined);f.mutate({remoteFail:false});success(f.run());assert.equal(f.calls(masters).length,1);assert.equal(f.state().service,true);
});
test('--stop closes both owned forwards, leaving servers and other ports intact',t=>{
 const f=fixture(t,{occupied:[9876,5173,5185]});success(f.run());success(f.run('--stop'));assert.equal(f.state().master,false);assert.equal(f.state().server,true);assert.equal(f.state().service,true);assert.deepEqual(f.state().occupied,[9876,5173,5185]);success(f.run());assert.equal(f.calls(masters).length,2);
});
