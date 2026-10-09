// Furniture kit dimensions in meters (pure data, shared by the 3D kit and the planner).
// w = local X, d = local Z, h = height. Local front faces +Z: seats and screens face +Z,
// beds put the headboard at -Z, desks and shelves stand with their back at -Z.
// Sizes follow common Korean retail ranges; they are representative examples, not
// measurements of a particular product. Heights exclude small decor on top (lamps, vases).
export const FURNITURE = {
  sofa4: { title: '4인 소파', label: '소파', w: 2.6, d: 0.98, h: 0.8, seats: 4 },
  sofa3: { title: '3인 소파', label: '소파', w: 2.2, d: 0.95, h: 0.8, seats: 3 },
  loveseat: { title: '2인 소파', label: '소파', w: 1.6, d: 0.88, h: 0.78, seats: 2 },
  armchair: { title: '라운지 체어', label: '체어', w: 0.8, d: 0.82, h: 0.78, seats: 1 },
  coffeeRound: { title: '원형 테이블', label: '테이블', w: 0.9, d: 0.9, h: 0.38 },
  coffeeRect: { title: '커피 테이블', label: '테이블', w: 1.1, d: 0.6, h: 0.38 },
  rugRound: { title: '원형 러그', label: '', w: 2.2, d: 2.2, h: 0.012, flat: true },
  rugRect: { title: '러그', label: '', w: 2.4, d: 1.7, h: 0.012, flat: true },
  rugSmall: { title: '작은 러그', label: '', w: 1.4, d: 0.9, h: 0.012, flat: true },
  playMat: { title: '놀이 매트', label: '매트', w: 2.0, d: 1.4, h: 0.04, flat: true, play: true },
  tvConsole: { title: 'TV장 · 65형 TV', label: 'TV', w: 1.8, d: 0.42, h: 1.33 },
  bookshelf: { title: '책장', label: '책장', w: 0.8, d: 0.33, h: 1.8, storage: true },
  bookshelfWide: { title: '서가 벽면장', label: '서가', w: 2.4, d: 0.35, h: 1.8, storage: true },
  wardrobe2: { title: '2400 옷장', label: '옷장', w: 2.4, d: 0.6, h: 2.1, storage: true },
  toyShelf: { title: '교구장', label: '교구장', w: 1.2, d: 0.35, h: 0.8, storage: true, play: true },
  teepee: { title: '놀이 텐트', label: '텐트', w: 1.1, d: 1.1, h: 1.5, play: true },
  kidsTable: { title: '유아 테이블 세트', label: '유아책상', w: 0.6, d: 0.9, h: 0.52, play: true },
  singleBed: { title: '싱글 침대', label: '싱글', w: 1.1, d: 2.15, h: 0.9, sleeps: 1 },
  loftBed: { title: '벙커 침대 · 하부 책상', label: '벙커', w: 1.1, d: 2.15, h: 1.65, sleeps: 1, desks: 1 },
  crib: { title: '아기 침대', label: '아기침대', w: 0.7, d: 1.3, h: 0.95, infant: 1 },
  deskSet: { title: '책상 세트', label: '책상', w: 1.0, d: 0.95, h: 0.95, desks: 1 },
  deskWide: { title: '2인 책상', label: '책상', w: 1.8, d: 1.2, h: 1.15, desks: 2 },
  deskPro: { title: '재택 데스크 · 듀얼 모니터', label: '책상', w: 1.6, d: 1.2, h: 1.15, desks: 1 },
  dining6: { title: '6인 식탁', label: '식탁', w: 1.8, d: 1.8, h: 0.95, dining: 6 },
  dining4: { title: '4인 식탁', label: '식탁', w: 1.4, d: 1.64, h: 0.95, dining: 4 },
  dining2: { title: '2인 식탁', label: '식탁', w: 1.6, d: 0.8, h: 0.95, dining: 2 },
  plant: { title: '대형 화분', label: '화분', w: 0.5, d: 0.5, h: 1.4, decor: true },
  floorLamp: { title: '플로어 조명', label: '조명', w: 0.4, d: 0.4, h: 1.6, decor: true },
};

// Furniture that already exists in the 112A model and that concepts may keep.
export const MODEL_FURNITURE = {
  king: { title: '안방 킹 침대', sleeps: 2 },
  desk: { title: '작은 방 2 책상', desks: 1 },
  chair: { title: '작은 방 2 의자' },
  sofa: { title: '소파 2790', seats: 3 },
  stool: { title: '스툴 980' },
};

export const FACING = { south: 0, east: Math.PI / 2, north: Math.PI, west: Math.PI * 1.5 };

/** Plan footprint (x and z extents) of a kit piece turned to face a direction. */
export function footprint(kind, face = 'south') {
  const spec = FURNITURE[kind];
  const turned = face === 'east' || face === 'west';
  return { x: turned ? spec.d : spec.w, z: turned ? spec.w : spec.d };
}
