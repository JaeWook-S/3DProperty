import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CONCEPTS} from '../src/concepts/catalog.js';
import {archisketchWebData} from '../src/walkthrough/archisketch-model.js';
import {tourPlanInput} from '../src/house-tours/plan-input.js';
import {compareFit} from '../src/house-tours/fit.js';
import {homePlan} from '../src/walkthrough/my-home.js';

const definitions=Object.fromEntries(['basic','expanded'].map(variant=>{
  const source=JSON.parse(readFileSync(new URL(`../assets/models/acro-river-park/112a/archisketch-metric-v1/${variant}/model-info.json`,import.meta.url)));
  return [variant,{...archisketchWebData(source),coordinateBased:true}];
}));
test('home identifiers accept metric aliases without assigning other unit types to the 112A home',()=>{
  assert.equal(homePlan('112a-basic-archisketch'),'basic');
  assert.equal(homePlan('112a-expanded-archisketch'),'expanded');
  assert.equal(homePlan('168c-expanded-archisketch'),null);
});
for(const concept of CONCEPTS)test(`${concept.id}: house-tour fitting uses the active metric plans and their real fixed fixtures`,()=>{
  const inputs=Object.fromEntries(Object.entries(definitions).map(([variant,d])=>[variant,tourPlanInput(concept,d)]));
  for(const variant of ['basic','expanded']){
    const fixture=definitions[variant].info.fixtures.find(f=>f.id==='primary-king');
    const kept=inputs[variant].existing.find(i=>i.kind==='king');
    assert.equal(kept.x,(fixture.bounds_m[0]+fixture.bounds_m[2])/2);
    assert.equal(kept.width,fixture.bounds_m[2]-fixture.bounds_m[0]);
    assert.ok(inputs[variant].obstacles.length>0);
  }
  const same=compareFit(concept,inputs.expanded,inputs.expanded);
  assert.equal(same.verdict,'same');
  assert.ok(same.from.placements.length>=5);
  const fit=compareFit(concept,inputs.expanded,inputs.basic);
  assert.ok(fit.to.placements.some(p=>p.kind.startsWith('dining')));
  assert.equal(fit.items.length,same.from.placements.length);
  assert.ok(fit.items.every(item=>Number.isInteger(item.index)));
});
