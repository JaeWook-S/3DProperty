// Bounds of the supplied GLBs in meters, after removing the photography floor.
// TV and dining footprints also include the existing kit's TV / six chairs.
export const MOUNTAIN_WHITE_SPECS = {
  mwSofa: { title: '화이트 오크 · 패브릭 소파', label: '소파', w: 2.33, d: 1.03, h: 0.8635, seats: 3, baseKind: 'sofa3' },
  mwRug: { title: '화이트 오크 · 사각 러그', label: '', w: 1.7, d: 2.4, h: 0.01, flat: true, baseKind: 'rugRect' },
  mwCoffeeTable: { title: '화이트 오크 · 타원 테이블', label: '테이블', w: 1.1, d: 0.68, h: 0.35, baseKind: 'coffeeRound' },
  mwTvConsole: { title: '화이트 오크 · TV장과 TV', label: 'TV', w: 1.788, d: 0.42, h: 1.407, baseKind: 'tvConsole' },
  mwFloorLamp: { title: '화이트 오크 · 플로어 조명', label: '조명', w: 0.6446, d: 0.4947, h: 1.2015, decor: true, baseKind: 'floorLamp' },
  mwDiningTable: { title: '화이트 오크 · 원목 식탁과 의자', label: '식탁', w: 2.2, d: 1.395, h: 0.88, dining: 6, baseKind: 'dining6' },
  mwBed: { title: '화이트 오크 · 패브릭 침대', label: '침대', w: 1.94, d: 2.1, h: 1, sleeps: 2, baseKind: 'queenBed' },
};

const replacements = { sofa4: 'mwSofa', rugRound: 'mwRug', coffeeRound: 'mwCoffeeTable', tvConsole: 'mwTvConsole', floorLamp: 'mwFloorLamp', dining6: 'mwDiningTable' };
const adapted = new WeakMap();

// Keep the public concept IDs and eight recommendations stable. The tour identity
// selects a separate layout and separate template kinds, including on restore.
export function conceptForTour(concept, tour) {
  if (!concept || tour !== 'mountain-white' || concept.id !== 'family-lounge') return concept;
  if (!adapted.has(concept)) {
    const items = concept.items.map(item => {
      const kind = replacements[item.kind];
      if (!kind) return item;
      return { ...item, kind, optional: false, candidates: undefined, variants: undefined,
        ...(kind === 'mwCoffeeTable' ? { face: 'west' } : {}),
        ...(kind === 'mwFloorLamp' ? { allowClose: true } : {}) };
    });
    items.splice(items.length - 1, 0, { kind: 'mwBed', room: 'Master bedroom', face: 'east', x: ['min', 0.06], z: ['mid', 0] });
    adapted.set(concept, { ...concept, furnitureSet: 'mountain-white', keep: concept.keep.filter(kind => kind !== 'king'), items });
  }
  return adapted.get(concept);
}
