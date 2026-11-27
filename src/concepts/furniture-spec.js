// Furniture kit dimensions in meters (pure data, shared by the 3D kit and the planner).
// w = local X, d = local Z, h = height. Local front faces +Z: seats and screens face +Z,
// beds put the headboard at -Z, desks and shelves stand with their back at -Z.
// Sizes follow common Korean retail ranges; they are representative examples, not
// measurements of a particular product. Heights exclude small decor on top (lamps, vases).
import { TOUR_FURNITURE_SPECS, TOUR_PIECES } from './tour-furniture-spec.js';

export const FURNITURE = {
  ...TOUR_FURNITURE_SPECS,
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
  loftBed: { title: '벙커 침대 · 하부 책상', label: '벙커', w: 1.1, d: 2.15, h: 1.65, sleeps: 1, desks: 1, table: true },
  crib: { title: '아기 침대', label: '아기침대', w: 0.7, d: 1.3, h: 0.95, infant: 1 },
  deskSet: { title: '책상 세트', label: '책상', w: 1.0, d: 0.95, h: 0.95, desks: 1 },
  deskWide: { title: '2인 책상', label: '책상', w: 1.8, d: 1.2, h: 1.15, desks: 2 },
  deskPro: { title: '재택 데스크 · 듀얼 모니터', label: '책상', w: 1.6, d: 1.2, h: 1.15, desks: 1 },
  dining6: { title: '6인 식탁', label: '식탁', w: 1.8, d: 1.8, h: 0.95, dining: 6 },
  dining4: { title: '4인 식탁', label: '식탁', w: 1.4, d: 1.64, h: 0.95, dining: 4 },
  dining2: { title: '2인 식탁', label: '식탁', w: 1.6, d: 0.8, h: 0.95, dining: 2 },
  sofaLow: { title: '모듈 로우 소파', label: '소파', w: 2.6, d: 1.02, h: 0.68, seats: 3 },
  sideboard: { title: '낮은 수납장', label: '수납장', w: 1.8, d: 0.45, h: 0.62, storage: true },
  queenBed: { title: '퀸 침대', label: '퀸', w: 1.65, d: 2.15, h: 1.0, sleeps: 2 },
  dresser: { title: '화장대 세트', label: '화장대', w: 1.0, d: 0.85, h: 1.45 },
  piano: { title: '업라이트 피아노', label: '피아노', w: 1.5, d: 0.95, h: 1.25 },
  catTower: { title: '캣타워', label: '캣타워', w: 0.6, d: 0.5, h: 1.6, pet: true },
  petBed: { title: '반려동물 쿠션', label: '쿠션', w: 0.8, d: 0.8, h: 0.22, pet: true },
  yogaMat: { title: '요가 매트', label: '', w: 0.65, d: 1.85, h: 0.006, flat: true, workout: true },
  exerciseBike: { title: '실내 자전거', label: '자전거', w: 0.55, d: 1.05, h: 1.25, workout: true },
  dumbbellRack: { title: '덤벨 랙', label: '덤벨', w: 0.75, d: 0.37, h: 0.8, workout: true },
  floorMirror: { title: '전신 거울', label: '거울', w: 0.6, d: 0.39, h: 1.75 },
  plant: { title: '대형 화분', label: '화분', w: 0.5, d: 0.5, h: 1.4, decor: true },
  floorLamp: { title: '플로어 조명', label: '조명', w: 0.4, d: 0.4, h: 1.6, decor: true },
  // Pieces of the sets in PIECES: each table, desk and chair is its own staging item.
  // `table` pieces let `chair` pieces stand under and beside them (src/walkthrough/layout.js).
  diningTable6: { title: '6인 식탁', label: '식탁', w: 1.8, d: 0.9, h: 0.8, table: true },
  diningTable4: { title: '4인 식탁', label: '식탁', w: 1.4, d: 0.8, h: 0.8, table: true },
  roundTable2: { title: '2인 원형 식탁', label: '식탁', w: 0.8, d: 0.8, h: 0.75, table: true },
  sideChair: { title: '다이닝 의자', label: '의자', w: 0.44, d: 0.43, h: 0.88, chair: true },
  studyDesk: { title: '책상', label: '책상', w: 1.0, d: 0.56, h: 0.95, table: true },
  deskDouble: { title: '2인 책상', label: '책상', w: 1.8, d: 0.7, h: 1.15, table: true },
  deskDual: { title: '재택 데스크 · 듀얼 모니터', label: '책상', w: 1.6, d: 0.7, h: 1.15, table: true },
  officeChair: { title: '사무용 의자', label: '의자', w: 0.52, d: 0.52, h: 0.92, chair: true },
  playTable: { title: '유아 테이블', label: '유아책상', w: 0.6, d: 0.5, h: 0.5, table: true },
  kidsChairBlue: { title: '유아 의자 · 블루', label: '의자', w: 0.3, d: 0.19, h: 0.48, chair: true },
  kidsChairPink: { title: '유아 의자 · 핑크', label: '의자', w: 0.3, d: 0.19, h: 0.48, chair: true },
  vanityDresser: { title: '화장대', label: '화장대', w: 1.0, d: 0.6, h: 1.44, table: true },
  vanityStool: { title: '화장대 스툴', label: '스툴', w: 0.4, d: 0.4, h: 0.48, chair: true },
};

// Tables and desks with their chairs. The planner lays a set out as one footprint (its spec
// above, chairs included); staging places each piece as its own item, so a chair and its table
// have separate product cards and move, turn and delete apart. [kind, x, z, facing]: the
// piece's footprint center from the set's center (set front = +Z) and its turn within the set.
const HALF_TURN = Math.PI;
export const PIECES = {
  ...TOUR_PIECES,
  dining6: [['diningTable6', 0, 0, 0], ...[-0.6, 0, 0.6].flatMap((x) => [['sideChair', x, -0.684, 0], ['sideChair', x, 0.684, HALF_TURN]])],
  dining4: [['diningTable4', 0, 0, 0], ...[-0.35, 0.35].flatMap((x) => [['sideChair', x, -0.604, 0], ['sideChair', x, 0.604, HALF_TURN]])],
  dining2: [['roundTable2', 0, 0, 0], ['sideChair', -0.584, 0, HALF_TURN / 2], ['sideChair', 0.584, 0, -HALF_TURN / 2]],
  deskSet: [['studyDesk', 0, -0.197, 0], ['officeChair', 0, 0.218, HALF_TURN]],
  deskWide: [['deskDouble', 0, -0.255, 0], ['officeChair', -0.45, 0.345, HALF_TURN], ['officeChair', 0.45, 0.345, HALF_TURN]],
  deskPro: [['deskDual', 0, -0.255, 0], ['officeChair', 0, 0.345, HALF_TURN]],
  kidsTable: [['playTable', 0, 0, 0], ['kidsChairBlue', 0, 0.362, HALF_TURN], ['kidsChairPink', 0, -0.362, 0]],
  dresser: [['vanityDresser', 0, -0.112, 0], ['vanityStool', 0, 0.213, 0]],
  // The loft bed stays its own piece; its desk chair stands under it, inside the same footprint.
  loftBed: [['loftBed', 0, 0, 0], ['officeChair', 0.18, -0.2, -HALF_TURN / 2]],
};
/** The staging pieces of a planned kind: the kind itself unless it is a set. */
export const piecesOf = (kind) => PIECES[kind] ?? [[kind, 0, 0, 0]];
/** A kind that only exists in plans: staging holds its pieces instead. */
export const isSetKind = (kind) => Boolean(PIECES[kind]) && PIECES[kind][0][0] !== kind;

const TURN = Math.PI * 2;
const turn = (angle) => { const a = ((angle % TURN) + TURN) % TURN; return TURN - a < 1e-9 ? 0 : a; };
/**
 * A planned placement { kind, x, z, angle } as the staging items it becomes. The first piece
 * keeps `id`; the others get `${id}-1`, `${id}-2`, ...
 */
export function expandPlacement({ kind, x, z, angle = 0 }, id) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return piecesOf(kind).map(([piece, dx, dz, facing], n) => ({
    kind: piece, id: n ? `${id}-${n}` : id, x: x + c * dx + s * dz, z: z - s * dx + c * dz, angle: turn(angle + facing),
  }));
}
// Set kinds renamed when the sets were split.
const RENAMED = { swDining: 'swDiningSet' };
/** Saved layouts from before the split: a saved set item comes back as its pieces. */
export function expandSaved(items) {
  return items.flatMap((p) => {
    const kind = RENAMED[p?.kind] ?? p?.kind;
    if (!isSetKind(kind) || typeof p.id !== 'string') return [p];
    return expandPlacement({ ...p, kind }, p.id).map((piece) => ({ ...p, ...piece, title: FURNITURE[piece.kind].title }));
  });
}

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
