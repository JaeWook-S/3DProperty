import test from 'node:test';
import assert from 'node:assert/strict';
import { corners, overlap, placementError } from '../src/walkthrough/layout.js';
test('meter footprints rotate without resizing and reject wall crossing',()=>{
 const box={id:'a',x:2,z:2,width:2,depth:1,angle:Math.PI/2};
 const c=corners(box);assert.ok(Math.abs(Math.max(...c.map(p=>p[0]))-2.5)<1e-9);
 assert.equal(placementError(box,{bounds_m:[0,0,4,4]},[],[]),null);
 assert.match(placementError({...box,x:.1},{bounds_m:[0,0,4,4]},[],[]),/공간 안/);
 assert.ok(overlap(box,{...box,id:'b',z:2.5}));
 assert.equal(overlap(box,{...box,id:'b',x:3.5}),false);
});
