import { coordinateConceptInput } from '../concepts/coordinate-plan.js';
import { navigationRooms } from '../walkthrough/minimap-geometry.js';
import { keptFor } from './fit.js';

const footprint = (fixture, bounds = fixture.bounds_m) => {
  const [x1,z1,x2,z2] = bounds;
  return {id:fixture.id,kind:fixture.id==='primary-king'?'king':fixture.kind,x:(x1+x2)/2,z:(z1+z2)/2,
    width:x2-x1,depth:z2-z1,height:fixture.top_m,angle:0};
};

// Match the live studio's coordinate adapter and fixed-fixture bounds; never scale furniture.
export function tourPlanInput(concept, definition) {
  const {info, doors} = definition;
  if(!definition.coordinateBased)return {variant:info.variant,rooms:navigationRooms(info),doors,existing:keptFor(concept)};
  const adapted = coordinateConceptInput(concept,info);
  const fixtures = info.fixtures || [];
  const king = fixtures.find(f=>f.id==='primary-king');
  const existing = concept.keep.includes('king') && king ? [footprint(king)] : [];
  const obstacles = fixtures.filter(f=>!f.movable&&f.bottom_m<=1.4&&f.top_m>=.1)
    .flatMap(f=>(f.collision_footprints_m||[f.bounds_m]).map(bounds=>footprint(f,bounds)));
  return {...adapted,doors,existing,obstacles};
}
