import test from 'node:test';
import assert from 'node:assert/strict';
import {floorInteriorAvailability,floorInteriorPlacement} from '../src/walkthrough/floor-interior-contract.js';
test('100동 verified same-floor types, not verified adjacency',()=>{
 for(let floor=3;floor<=21;floor++){
  const result=floorInteriorAvailability('100',floor);assert.equal(result.available,true);assert.deepEqual(result.units.map(u=>u.unit),[`${floor}04`,`${floor}05`]);assert.equal(result.layoutVerified,false);assert.equal(result.scale,1);assert.ok(result.totalUnits>=2);
 }
 for(const floor of [null,0,1,2,22,3.1])assert.equal(floorInteriorAvailability('100',floor).available,false);
 for(const building of ['101','104','107','fake'])assert.equal(floorInteriorAvailability(building,10).available,false);
});
test('inline floor preserves world-meter poses, exact storey and a separate surface offset',()=>{
 const building={x:10,z:20,height_m:74,floors:21};
 const low=floorInteriorPlacement(building,3),high=floorInteriorPlacement(building,11);
 assert.equal(low.position[0],0);assert.equal(low.position[2],0);assert.equal(low.scale,1);assert.equal(low.liftMeters,0);
 assert.ok(Math.abs(low.position[1]-2*74/21-.06)<1e-12);
 assert.ok(Math.abs(high.position[1]-low.position[1]-8*74/21)<1e-12);
 assert.equal(floorInteriorAvailability('100',10).display,'inline-floor-section');
});

test('five-unit source review is limited to exact 100dong10F catalog composition',()=>{
 const result=floorInteriorAvailability('100',10);assert.equal(result.fiveUnits,true);assert.equal(result.displayUnits.length,5);assert.deepEqual(result.displayUnits.map(u=>u.type).sort(),['145.95F','145.95F','168.66D','168.95C','211.99A']);
 for(const floor of [3,9,11,17,21])assert.equal(floorInteriorAvailability('100',floor).fiveUnits,false);
 assert.equal(floorInteriorAvailability('101',10).fiveUnits,false);assert.equal(result.layoutVerified,false);
});
