// Interior finish catalog. Every entry is a procedural PBR recipe at physical
// scale plus a price-DB code. Names are generic sample finishes, not products.

export const FINISH_CATEGORIES = Object.freeze([
  { id: 'wallpaper', label: '벽지', surfaces: ['wall'] },
  { id: 'paint', label: '페인트·미장', surfaces: ['wall'] },
  { id: 'tile', label: '타일', surfaces: ['wall', 'floor'] },
  { id: 'floor', label: '바닥재', surfaces: ['floor'] },
]);

const wp = (id, name, color, extra = {}) => ({ id: `wp-${id}`, name, category: 'wallpaper', surfaces: ['wall'], priceCode: extra.priceCode ?? 'WP-SILK',
  detail: extra.detail ?? '실크 · 폭 1,060mm', tags: extra.tags ?? ['실크'], recipe: { kind: 'wallpaper', color, roll: extra.roll ?? 1.06, ...extra.recipe }, physical: { sheen: extra.sheen ?? 0.25 } });
const pa = (id, name, color, extra = {}) => ({ id: `pa-${id}`, name, category: 'paint', surfaces: ['wall'], priceCode: extra.priceCode ?? 'PA-WALL',
  detail: extra.detail ?? '친환경 수성 · 무광', tags: extra.tags ?? ['페인트'], recipe: { kind: 'paint', color, ...extra.recipe }, physical: {} });

export const FINISHES = Object.freeze([
  wp('silk-white', '실크 · 스노우 화이트', '#efede7'),
  wp('silk-ivory', '실크 · 크림 아이보리', '#ece3d3'),
  wp('silk-greige', '실크 · 웜 그레이지', '#d3cbbf'),
  wp('silk-sage', '실크 · 세이지 그린', '#bcc5b0'),
  wp('silk-blue', '실크 · 더스티 블루', '#b8c3cd'),
  wp('silk-linen', '실크 · 린넨 질감', '#e2d8c6', { detail: '실크 · 린넨 엠보', tags: ['실크', '질감'], recipe: { pattern: 'linen' } }),
  wp('silk-stripe', '실크 · 톤온톤 스트라이프', '#d9d1c4', { priceCode: 'WP-SILK-PATTERN', detail: '실크 · 53mm 스트라이프', tags: ['실크', '패턴'], recipe: { pattern: 'stripe', accent: '#cec5b6' } }),
  wp('silk-geo', '실크 · 다이아 엠보', '#e8e2d7', { priceCode: 'WP-SILK-PATTERN', detail: '실크 · 기하 패턴', tags: ['실크', '패턴'], recipe: { pattern: 'geometric', accent: '#dad1c1' } }),
  wp('paper-white', '합지 · 화이트', '#f0eee9', { priceCode: 'WP-PAPER', detail: '합지 · 폭 930mm', tags: ['합지'], roll: 0.93, sheen: 0, recipe: { kind: 'wallpaper', paper: true } }),
  { id: 'wp-fabric-oat', name: '패브릭 · 오트밀', category: 'wallpaper', surfaces: ['wall'], priceCode: 'WP-FABRIC', detail: '직물 벽지 · 바스켓 위브', tags: ['패브릭'],
    recipe: { kind: 'fabric', color: '#d8ccb6' }, physical: { sheen: 0.6, sheenColor: '#efe6d6' } },

  pa('white', '페인트 · 퓨어 화이트', '#f2f1ec'),
  pa('warm', '페인트 · 웜 화이트', '#eee7da'),
  pa('greige', '페인트 · 그레이지', '#cbc3b7'),
  pa('terracotta', '페인트 · 테라코타', '#b9785a'),
  pa('green', '페인트 · 딥 포레스트', '#3f5446'),
  pa('navy', '페인트 · 미드나잇 네이비', '#2f3a4b'),
  { id: 'pa-micro', name: '마이크로시멘트 · 라이트 그레이', category: 'paint', surfaces: ['wall', 'floor'], priceCode: 'PA-MICRO', detail: '미장 질감 · 매트 코팅', tags: ['미장'],
    recipe: { kind: 'tile', tile: [1.2, 1.2], cols: 1, rows: 1, grout: 0, groutDepth: 0, bevel: 0, color: '#bdb8b0', alt: '#a9a49c', body: 'concrete', finish: 'honed', variation: 0 }, physical: {} },

  { id: 'tl-porcelain-warm', name: '포세린 600각 · 웜 그레이', category: 'tile', surfaces: ['wall', 'floor'], priceCode: { wall: 'TL-WALL-600', floor: 'TL-FLOOR-600' }, detail: '600×600 · 무광 · 줄눈 3mm', tags: ['포세린'],
    recipe: { kind: 'tile', tile: [0.6, 0.6], color: '#b8b1a6', alt: '#a9a297', body: 'concrete', finish: 'matte', grout: 0.003, groutColor: '#c9c3b9' }, physical: {} },
  { id: 'tl-concrete', name: '포세린 600각 · 콘크리트', category: 'tile', surfaces: ['wall', 'floor'], priceCode: { wall: 'TL-WALL-600', floor: 'TL-FLOOR-600' }, detail: '600×600 · 무광 · 시멘트 질감', tags: ['포세린'],
    recipe: { kind: 'tile', tile: [0.6, 0.6], color: '#9d9a94', alt: '#8d8a84', body: 'concrete', finish: 'matte', grout: 0.003, groutColor: '#8f8b85' }, physical: {} },
  { id: 'tl-marble-bianco', name: '대리석 패턴 · 비앙코', category: 'tile', surfaces: ['wall', 'floor'], priceCode: { wall: 'TL-WALL-SLAB', floor: 'TL-FLOOR-SLAB' }, detail: '600×1200 · 폴리싱 · 줄눈 1.5mm', tags: ['대리석', '대형'],
    recipe: { kind: 'tile', tile: [0.6, 1.2], cols: 2, rows: 1, color: '#f2efea', alt: '#e4e0d8', vein: '#8a857d', body: 'marble', finish: 'polished', grout: 0.0015, groutColor: '#e9e5de', veins: 2 }, physical: { clearcoat: 0.6 } },
  { id: 'tl-calacatta', name: '대리석 패턴 · 칼라카타', category: 'tile', surfaces: ['wall', 'floor'], priceCode: { wall: 'TL-WALL-SLAB', floor: 'TL-FLOOR-SLAB' }, detail: '800×800 · 폴리싱 · 골드 베인', tags: ['대리석'],
    recipe: { kind: 'tile', tile: [0.8, 0.8], color: '#f4f1eb', alt: '#ebe5da', vein: '#a88d63', body: 'marble', finish: 'polished', grout: 0.0015, groutColor: '#ece6dc', veins: 1.5, veinStrength: 0.95 }, physical: { clearcoat: 0.7 } },
  { id: 'tl-travertine', name: '트래버틴 패턴 · 베이지', category: 'tile', surfaces: ['wall', 'floor'], priceCode: { wall: 'TL-WALL-SLAB', floor: 'TL-FLOOR-SLAB' }, detail: '600×1200 · 혼드 · 기공 질감', tags: ['석재', '대형'],
    recipe: { kind: 'tile', tile: [0.6, 1.2], cols: 2, rows: 1, color: '#dccab0', alt: '#c7b293', body: 'travertine', finish: 'honed', grout: 0.002, groutColor: '#d2c2a8' }, physical: {} },
  { id: 'tl-subway-white', name: '서브웨이 · 글로시 화이트', category: 'tile', surfaces: ['wall'], priceCode: 'TL-WALL-SUBWAY', detail: '75×150 · 유광 · 엇갈림', tags: ['서브웨이'],
    recipe: { kind: 'tile', tile: [0.15, 0.075], cols: 4, rows: 8, pattern: 'running', color: '#f5f3ee', finish: 'gloss', bevel: 0.004, grout: 0.002, groutColor: '#e2ded6', variation: 0.02 }, physical: { clearcoat: 0.4 } },
  { id: 'tl-zellige-green', name: '수제 질감 · 세이지 그린', category: 'tile', surfaces: ['wall'], priceCode: 'TL-WALL-ZELLIGE', detail: '65×200 · 유광 · 색 편차', tags: ['젤리주'],
    recipe: { kind: 'tile', tile: [0.2, 0.065], cols: 3, rows: 9, pattern: 'running', color: '#6f8e7c', body: 'zellige', finish: 'gloss', variation: 0.13, grout: 0.002, groutColor: '#d6d2c8' }, physical: { clearcoat: 0.8 } },
  { id: 'tl-zellige-white', name: '수제 질감 · 크림 화이트', category: 'tile', surfaces: ['wall'], priceCode: 'TL-WALL-ZELLIGE', detail: '65×200 · 유광 · 색 편차', tags: ['젤리주'],
    recipe: { kind: 'tile', tile: [0.2, 0.065], cols: 3, rows: 9, pattern: 'running', color: '#ede6d8', body: 'zellige', finish: 'gloss', variation: 0.06, grout: 0.002, groutColor: '#e0dacd' }, physical: { clearcoat: 0.8 } },
  { id: 'tl-hex-marble', name: '헥사곤 모자이크 · 화이트 마블', category: 'tile', surfaces: ['wall', 'floor'], priceCode: 'TL-MOSAIC', detail: '50mm 헥사곤 · 새틴', tags: ['모자이크'],
    recipe: { kind: 'tile', tile: [0.05, 0.05], pattern: 'hex', cols: 10, rows: 6, color: '#efedea', alt: '#e2dfda', vein: '#9a958e', body: 'marble', finish: 'satin', grout: 0.002, groutColor: '#d9d6d0' }, physical: {} },
  { id: 'tl-herringbone-sage', name: '헤링본 · 세이지', category: 'tile', surfaces: ['wall', 'floor'], priceCode: 'TL-HERRINGBONE', detail: '75×300 · 유광 헤링본', tags: ['헤링본'],
    recipe: { kind: 'tile', tile: [0.3, 0.075], pattern: 'herringbone', color: '#a8b49f', finish: 'gloss', variation: 0.07, grout: 0.002, groutColor: '#dcd9d0' }, physical: { clearcoat: 0.5 } },
  { id: 'tl-terrazzo', name: '테라조 · 웜 베이지', category: 'tile', surfaces: ['wall', 'floor'], priceCode: 'TL-TERRAZZO', detail: '600×600 · 혼드', tags: ['테라조'],
    recipe: { kind: 'tile', tile: [0.6, 0.6], color: '#e6ded2', body: 'terrazzo', finish: 'honed', grout: 0.002, groutColor: '#d9d1c4' }, physical: {} },

  { id: 'fl-oak-natural', name: '강마루 · 내추럴 오크', category: 'floor', surfaces: ['floor'], priceCode: 'FL-LAMINATE', detail: '165×1200 · 무광 · 마이크로 베벨', tags: ['강마루'],
    recipe: { kind: 'wood', color: '#c9a678', dark: '#8b6642', width: 0.165, length: 1.2, rows: 6 }, physical: {} },
  { id: 'fl-oak-white', name: '강마루 · 화이트 오크', category: 'floor', surfaces: ['floor'], priceCode: 'FL-LAMINATE', detail: '165×1200 · 무광', tags: ['강마루'],
    recipe: { kind: 'wood', color: '#dcc7a6', dark: '#a68a65', width: 0.165, length: 1.2, rows: 6, contrast: 0.42 }, physical: {} },
  { id: 'fl-oak-gray', name: '강마루 · 스모크 그레이', category: 'floor', surfaces: ['floor'], priceCode: 'FL-LAMINATE', detail: '165×1200 · 무광', tags: ['강마루'],
    recipe: { kind: 'wood', color: '#a9a197', dark: '#6f685f', width: 0.165, length: 1.2, rows: 6, contrast: 0.45 }, physical: {} },
  { id: 'fl-walnut', name: '원목마루 · 월넛', category: 'floor', surfaces: ['floor'], priceCode: 'FL-ENGINEERED', detail: '190×1200 · 오일 마감', tags: ['원목'],
    recipe: { kind: 'wood', color: '#7d5839', dark: '#3f2a1b', width: 0.19, length: 1.2, rows: 6, contrast: 0.6, roughness: 0.5 }, physical: {} },
  { id: 'fl-herringbone-oak', name: '헤링본 마루 · 라이트 오크', category: 'floor', surfaces: ['floor'], priceCode: 'FL-HERRINGBONE', detail: '90×540 · 헤링본', tags: ['헤링본'],
    recipe: { kind: 'wood', color: '#d1b088', dark: '#96714b', width: 0.09, length: 0.54, pattern: 'herringbone' }, physical: {} },
  { id: 'fl-vinyl-oak', name: '장판 · 오크 패턴', category: 'floor', surfaces: ['floor'], priceCode: 'FL-VINYL', detail: '2.2T · 엠보 우드', tags: ['장판'],
    recipe: { kind: 'wood', color: '#c4a17a', dark: '#93714f', width: 0.15, length: 0.9, rows: 6, flat: true, gap: 0.0002, roughness: 0.55, contrast: 0.4 }, physical: {} },
]);

export const finishById = id => FINISHES.find(f => f.id === id) ?? null;
export function finishPriceCode(finish, surface) {
  return typeof finish.priceCode === 'string' ? finish.priceCode : finish.priceCode[surface] ?? Object.values(finish.priceCode)[0];
}
export function finishesFor(surface, category = null, query = '') {
  const q = query.trim().toLowerCase();
  return FINISHES.filter(f => f.surfaces.includes(surface) && (!category || f.category === category)
    && (!q || f.name.toLowerCase().includes(q) || f.detail.toLowerCase().includes(q) || f.tags.some(t => t.includes(q))));
}
// Existing finish of the original model per surface, for the removal line.
export function originalFinishKind(materialName = '', surface = 'wall') {
  const name = materialName.toLowerCase();
  if (/tile|travertine|porcelain|stone|marble/.test(name)) return 'tile';
  if (surface === 'floor') return /oak|wood|walnut/.test(name) ? 'wood' : 'tile';
  return 'wallpaper';
}
