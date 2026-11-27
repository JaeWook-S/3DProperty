// Furniture sets made for one 집들이: the GLBs in assets/house-tours/<tour>/ and how they
// replace the kit pieces of that tour's concept. A set only applies to its own tour, so the
// shared concepts (and every other 집들이 that uses them) keep the kit furniture.
//
// Bounds are the supplied GLBs in meters after removing any photography floor (w = local X,
// d = local Z, front = +Z). Dining and TV footprints include the chairs / TV added around them.
const L = 'Living front', M = 'Master bedroom';

export const TOUR_FURNITURE_SPECS = {
  // 창밖이 액자가 되는 집 (mountain-white)
  mwSofa: { set: 'mountain-white', title: '화이트 오크 · 패브릭 소파', label: '소파', w: 2.33, d: 1.03, h: 0.8635, seats: 3, baseKind: 'sofa3' },
  mwRug: { set: 'mountain-white', title: '화이트 오크 · 사각 러그', label: '', w: 1.7, d: 2.4, h: 0.01, flat: true, baseKind: 'rugRect' },
  mwCoffeeTable: { set: 'mountain-white', title: '화이트 오크 · 타원 테이블', label: '테이블', w: 1.1, d: 0.68, h: 0.35, baseKind: 'coffeeRound' },
  mwTvConsole: { set: 'mountain-white', title: '화이트 오크 · TV장과 TV', label: 'TV', w: 1.788, d: 0.42, h: 1.407, baseKind: 'tvConsole' },
  mwFloorLamp: { set: 'mountain-white', title: '화이트 오크 · 플로어 조명', label: '조명', w: 0.6446, d: 0.4947, h: 1.2015, decor: true, baseKind: 'floorLamp' },
  mwDiningTable: { set: 'mountain-white', title: '화이트 오크 · 원목 식탁과 블랙 의자', label: '식탁', w: 2.2, d: 1.39, h: 0.8, dining: 6, baseKind: 'dining6' },
  mwBed: { set: 'mountain-white', title: '화이트 오크 · 패브릭 침대', label: '침대', w: 1.94, d: 2.1, h: 1, sleeps: 2, baseKind: 'queenBed' },
  mwArmchair: { set: 'mountain-white', title: '화이트 오크 · 부클레 라운지 체어', label: '체어', w: 0.7, d: 0.79, h: 0.71, seats: 1, baseKind: 'armchair' },
  mwPlant: { set: 'mountain-white', title: '화이트 오크 · 몬스테라 화분', label: '화분', w: 0.6991, d: 0.3506, h: 0.9001, decor: true, baseKind: 'plant' },
  // 호텔 같은 고급스러움, 1인 가구의 13평 (stone-walnut)
  swSofa: { set: 'stone-walnut', title: '다크 스톤 · 코냑 가죽 소파', label: '소파', w: 2.04, d: 0.89, h: 0.788, seats: 3, baseKind: 'sofaLow' },
  swRug: { set: 'stone-walnut', title: '다크 스톤 · 화이트 장모 러그', label: '', w: 1.33, d: 1.95, h: 0.029, flat: true, baseKind: 'rugRect' },
  swCoffeeTable: { set: 'stone-walnut', title: '다크 스톤 · 블랙 커피 테이블', label: '테이블', w: 1.18, d: 0.78, h: 0.45, baseKind: 'coffeeRect' },
  swSideTable: { set: 'stone-walnut', title: '다크 스톤 · 원형 보조 테이블', label: '보조', w: 0.55, d: 0.55, h: 0.48, baseKind: 'coffeeRound' },
  swSideboard: { set: 'stone-walnut', title: '다크 스톤 · 월넛 수납장', label: '수납장', w: 1.764, d: 0.482, h: 0.661, storage: true, baseKind: 'sideboard' },
  swFloorLamp: { set: 'stone-walnut', title: '다크 스톤 · 블랙 플로어 조명', label: '조명', w: 0.69, d: 0.44, h: 1.63, decor: true, baseKind: 'floorLamp' },
  swDining: { set: 'stone-walnut', title: '다크 스톤 · 월넛 식탁과 메탈 의자', label: '식탁', w: 1.4, d: 1.85, h: 1.02, dining: 4, baseKind: 'dining4' },
  swBed: { set: 'stone-walnut', title: '다크 스톤 · 다크 브라운 침대', label: '침대', w: 1.91, d: 2.07, h: 1.12, sleeps: 2, baseKind: 'queenBed' },
  swNightstand: { set: 'stone-walnut', title: '다크 스톤 · 다크 브라운 협탁', label: '협탁', w: 0.46, d: 0.36, h: 0.63 },
};

// How each set adapts its concept. `replace` swaps kit kinds for set kinds (with extra spec
// fields per set kind), `add` inserts set pieces before the item at `before` (an index from
// the end when negative), and `dropKeep` stops keeping model furniture the set replaces.
const SETS = {
  'mountain-white': {
    concept: 'family-lounge',
    replace: { sofa4: 'mwSofa', rugRound: 'mwRug', coffeeRound: 'mwCoffeeTable', tvConsole: 'mwTvConsole', floorLamp: 'mwFloorLamp', dining6: 'mwDiningTable', plant: 'mwPlant' },
    tweak: { mwCoffeeTable: { face: 'west' }, mwFloorLamp: { allowClose: true }, mwPlant: { allowClose: true } },
    add: [
      // The window chair: beside the sofa, looking at the room like the photo.
      // Placed after the dining table so the table keeps its spot by the kitchen.
      { after: 'mwDiningTable', item: { kind: 'mwArmchair', room: L, face: 'west', x: ['max', 0.12], z: ['max', 0.2], allowClose: true, candidates: [{ z: ['min', 0.2] }] } },
      { before: -1, item: { kind: 'mwBed', room: M, face: 'east', x: ['min', 0.06], z: ['mid', 0] } },
    ],
    dropKeep: ['king'],
  },
  'stone-walnut': {
    concept: 'hotel-minimal',
    replace: { rugRect: 'swRug', sofaLow: 'swSofa', coffeeRect: 'swCoffeeTable', sideboard: 'swSideboard', floorLamp: 'swFloorLamp', dining4: 'swDining' },
    // The photo: a low sofa on the window wall, a white shag rug and a black table close
    // in front of it, a walnut cabinet across, and a small round table at the sofa's end.
    tweak: {
      swRug: { face: 'south', x: ['max', 1.2] },
      swCoffeeTable: { x: ['max', 1.5], allowClose: true },
      swFloorLamp: { allowClose: true },
    },
    add: [
      { after: 'swSofa', item: { kind: 'swSideTable', room: L, face: 'west', x: ['max', 0.12], z: ['mid', 1.4], allowClose: true, candidates: [{ z: ['mid', -1.4] }] } },
      { before: -1, item: { kind: 'swBed', room: M, face: 'east', x: ['min', 0.06], z: ['mid', 0] } },
      { before: -1, item: { kind: 'swNightstand', room: M, face: 'east', x: ['min', 0.08], z: ['mid', 1.24], allowClose: true, candidates: [{ z: ['mid', -1.24] }] } },
    ],
    dropKeep: ['king'],
  },
};

/** The 집들이 that have their own furniture set, in loading order. */
export const TOUR_FURNITURE_SETS = Object.keys(SETS);
export const setOfKind = (kind) => TOUR_FURNITURE_SPECS[kind]?.set ?? null;

function adapt(concept, tour, set) {
  const items = concept.items.map((item) => {
    const kind = set.replace[item.kind];
    if (!kind) return item;
    return { ...item, kind, optional: false, candidates: undefined, variants: undefined, ...(set.tweak[kind] ?? {}) };
  });
  for (const { after, before, item } of set.add) {
    const at = after ? items.findIndex((p) => p.kind === after) + 1 : before < 0 ? items.length + before : before;
    items.splice(at, 0, item);
  }
  return { ...concept, furnitureSet: tour, keep: concept.keep.filter((kind) => !set.dropKeep.includes(kind)), items };
}

const adapted = new Map(TOUR_FURNITURE_SETS.map((tour) => [tour, new WeakMap()]));
// Keep the public concept IDs stable. The tour identity selects a separate layout and
// separate template kinds, including on restore.
export function conceptForTour(concept, tour) {
  const set = SETS[tour];
  if (!concept || !set || concept.id !== set.concept) return concept;
  const cache = adapted.get(tour);
  if (!cache.has(concept)) cache.set(concept, adapt(concept, tour, set));
  return cache.get(concept);
}
