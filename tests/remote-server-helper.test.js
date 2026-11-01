import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,existsSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const scratch=fileURLToPath(new URL('../runtime/service-map/2026-10-23/launcher/tmp/',import.meta.url));mkdirSync(scratch,{recursive:true});
function fixture(t,ready=[]){
 const dir=mkdtempSync(join(scratch,'server-')),bin=join(dir,'bin');mkdirSync(bin);mkdirSync(join(dir,'tools'));writeFileSync(join(dir,'package.json'),JSON.stringify({type:'commonjs'}));
 copyFileSync(fileURLToPath(new URL('../tools/start-remote-studio.sh',import.meta.url)),join(dir,'tools/start-remote-studio.sh'));
 for(const sub of ['', 'apps/web']){mkdirSync(join(dir,sub,'node_modules/.bin'),{recursive:true});writeFileSync(join(dir,sub,'node_modules/.bin/vite'),'#!/bin/sh\nexit 0\n',{mode:0o755});}
 for(const port of ready)writeFileSync(join(dir,'ready-'+port),'ready');
 writeFileSync(join(bin,'curl'),`#!/usr/bin/env node
const fs=require('node:fs');const p=Number(new URL(process.argv.at(-1)).port);if(!fs.existsSync(process.env.HELPER_TEST_ROOT+'/ready-'+p))process.exit(7);console.log(p===5173?'<div id="viewport"></div>':'<div id="map-service"></div>');
`,{mode:0o755});
 writeFileSync(join(bin,'npm'),`#!/usr/bin/env node
const fs=require('node:fs'),root=process.env.HELPER_TEST_ROOT,p=process.cwd().endsWith('/apps/web')?5185:5173;fs.writeFileSync(root+'/started-'+p,JSON.stringify({port:p,mode:process.env.VITE_FURNITURE_MEASUREMENT_ENABLED}));if(process.env.HELPER_FAIL_PORT===String(p))process.exit(1);fs.writeFileSync(root+'/ready-'+p,'ready');
`,{mode:0o755});
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 return{dir,run:fail=>spawnSync('/bin/bash',[join(dir,'tools/start-remote-studio.sh')],{env:{...process.env,PATH:bin+':'+process.env.PATH,HELPER_TEST_ROOT:dir,HELPER_FAIL_PORT:fail||''},encoding:'utf8',timeout:15000}),started:p=>existsSync(join(dir,'started-'+p)),data:p=>JSON.parse(readFileSync(join(dir,'started-'+p),'utf8'))};
}
test('remote helper leaves both running servers alone',t=>{const f=fixture(t,[5173,5185]),r=f.run();assert.equal(r.status,0,r.stderr);assert.equal(f.started(5173),false);assert.equal(f.started(5185),false);});
for(const missing of [5173,5185])test(`remote helper starts only missing ${missing} with inference disabled`,t=>{const other=missing===5173?5185:5173,f=fixture(t,[other]),r=f.run();assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(f.started(other),false);assert.deepEqual(f.data(missing),{port:missing,mode:'0'});});
test('failed map startup reports failure while retaining the running viewer',t=>{const f=fixture(t,[5173]),r=f.run('5185');assert.notEqual(r.status,0);assert.equal(f.started(5173),false);assert.equal(existsSync(join(f.dir,'ready-5173')),true);assert.match(r.stderr,/지도 서비스 시작 실패/);});
