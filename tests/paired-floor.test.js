import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transformPoint, inversePoint, pointOnFloor } from '../src/paired-floor/geometry.js';

const fixture=JSON.parse(fs.readFileSync(new URL('../src/paired-floor/layout.json',import.meta.url)));
for(const [variant,layout] of Object.entries(fixture.variants))test(`paired floor ${variant}: rigid placements preserve unit lengths and connect both entries`,()=>{
  assert.equal(layout.units.length,2);assert.deepEqual(layout.units.map(unit=>unit.id).sort(),['168c','211a']);
  for(const unit of layout.units){
    assert.equal(unit.translation[1],0);assert.ok(Number.isFinite(unit.rotationYRadians));
    const entry=transformPoint(unit.entryLocal,unit),offset=transformPoint([unit.entryLocal[0]+1,unit.entryLocal[1]],unit);
    assert.ok(Math.abs(Math.hypot(entry[0]-offset[0],entry[1]-offset[1])-1)<1e-8);
    const original=inversePoint(entry,unit);assert.ok(Math.hypot(...original.map((v,i)=>v-unit.entryLocal[i]))<1e-8);
    assert.ok(pointOnFloor(...entry,[],layout.commonArea),`${unit.id} threshold must touch the shared slab`);
  }
  for(const spawn of Object.values(layout.spawns))assert.ok(pointOnFloor(...spawn,[],layout.commonArea));
  const elevator=layout.commonArea.elevator;assert.ok(elevator.doorWidth>.44);assert.equal(Math.hypot(...elevator.doorNormal),1);
  assert.ok(pointOnFloor(...elevator.doorCenter,[],layout.commonArea));
  assert.equal(pointOnFloor(1000,1000,[],layout.commonArea),false);
});
