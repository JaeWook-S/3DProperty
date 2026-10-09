import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {bodyAt} from '../src/walkthrough/movement.js';
import {verticalFromHorizontal,horizontalFromVertical,screenHorizontalFov} from '../src/walkthrough/view-calibration.js';
test('horizontal coverage stays fixed when viewport shape changes',()=>{
 for(const aspect of [.6,1,16/9,2.5])assert.ok(Math.abs(horizontalFromVertical(verticalFromHorizontal(85,aspect),aspect)-85)<1e-10);
 assert.ok(verticalFromHorizontal(85,16/9)<verticalFromHorizontal(85,1));
});
test('screen matching uses physical width, distance and occupied screen fraction',()=>{
 assert.ok(Math.abs(screenHorizontalFov(60,30)-90)<1e-10);
 assert.equal(screenHorizontalFov(60,60,.5),screenHorizontalFov(30,60));
 assert.throws(()=>screenHorizontalFov(0,60));
});
test('body width changes collision independently of eye and top height',()=>{
 for(const radius of [.18,.22,.30]){
   const body=bodyAt(new Vector3(0,1.6,0),1.6,radius);
   assert.equal(body.radius,radius);
   assert.ok(Math.abs(body.start.y-radius-.06)<1e-12);
   assert.ok(Math.abs(body.end.y+radius-1.72)<1e-12);
 }
});
