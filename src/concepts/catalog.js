// Recommended staging concepts for the ACRO River Park 112A demo unit (W7-06).
// Pure data: households, moods, color palettes and concept layouts. Layout specs
// are relative to the room bounds of the loaded plan, so one concept adapts to the
// basic and expanded variants; src/concepts/planner.js resolves and validates them.
//
// Placement spec: { kind, room, face, x, z, optional?, allowClose?, candidates?, variants? }
//   face  : direction the piece's front looks at (plan directions: north = plan top, -Z)
//   x / z : ['min', gap] | ['max', gap] | ['mid', offset] | ['at', meters]
//   candidates: alternative partial specs tried in order when the first one does not fit
//   variants  : per-plan overrides; null drops the piece on that plan with `note`

export const HOUSEHOLDS = [
  { id: 'solo', label: '1인 · 재택', people: 1, hint: '혼자 살며 집에서 일해요' },
  { id: 'couple', label: '신혼 2인', people: 2, hint: '둘이 쓰는 서재와 드레스룸' },
  { id: 'baby', label: '영유아 3인', people: 3, hint: '아기와 함께하는 놀이 중심' },
  { id: 'family4', label: '4인 가족', people: 4, hint: '자녀 둘, 방마다 쓰임이 분명하게' },
];

export const MOODS = [
  { id: 'warm', label: '따뜻한 우드', color: '#c69c6d' },
  { id: 'natural', label: '내추럴 그린', color: '#8fa483' },
  { id: 'soft', label: '밝은 파스텔', color: '#f0c3ae' },
  { id: 'modern', label: '모던 모노톤', color: '#4b4f52' },
  { id: 'classic', label: '클래식 네이비', color: '#32415a' },
];

// Material slots used by the furniture kit. `finish` reuses the viewer's floor presets.
export const PALETTES = {
  'oat-oak': {
    name: '오트밀 & 라이트 오크', mood: 'warm', finish: 'oak',
    note: '밝은 오크 마루에 오트밀 패브릭, 세이지 포인트',
    colors: { fabric: '#d6cab6', fabric2: '#c2ac8c', wood: '#c69c6d', woodDark: '#7d5a3f', metal: '#3b3833', accent: '#8a9a72', rug: '#e8dfcf', rugPattern: '#b8916a', bedding: '#f3eee5', white: '#f1ede4', pot: '#b97a55' },
  },
  'sage-white': {
    name: '세이지 & 화이트', mood: 'natural', finish: 'original',
    note: '화이트 가구에 세이지 그린 패브릭, 식물이 잘 어울려요',
    colors: { fabric: '#c8d1bf', fabric2: '#a5b597', wood: '#dcc8a8', woodDark: '#8f7a5c', metal: '#4a4f48', accent: '#6f8c68', rug: '#eef0e6', rugPattern: '#9fb08f', bedding: '#f6f5ef', white: '#f4f3ee', pot: '#d8d2c4' },
  },
  'cream-pastel': {
    name: '크림 & 파스텔', mood: 'soft', finish: 'oak',
    note: '부드러운 크림 바탕에 하늘·살구색, 아이 방에 편안해요',
    colors: { fabric: '#eee3d3', fabric2: '#f2c6b1', wood: '#e3cba5', woodDark: '#b39373', metal: '#8e8a83', accent: '#9cc6d9', rug: '#f6f1e7', rugPattern: '#f2c6b1', bedding: '#fbf8f2', white: '#f8f5ee', pot: '#f0d9c4' },
  },
  'greige-terracotta': {
    name: '그레이지 & 테라코타', mood: 'warm', finish: 'stone',
    note: '웜 스톤 바닥에 그레이지 소파, 테라코타 포인트',
    colors: { fabric: '#bcb2a6', fabric2: '#8f8378', wood: '#a47f5f', woodDark: '#5b4434', metal: '#2f2c2a', accent: '#b7643f', rug: '#d9cfc3', rugPattern: '#b7643f', bedding: '#efe9e1', white: '#ece8e1', pot: '#b7643f' },
  },
  'charcoal-green': {
    name: '차콜 & 딥그린', mood: 'modern', finish: 'original',
    note: '어두운 차콜 패브릭과 블랙 스틸, 딥그린 포인트',
    colors: { fabric: '#4b4f52', fabric2: '#6b7072', wood: '#4a3c33', woodDark: '#2a2421', metal: '#1d1d1d', accent: '#2f6150', rug: '#8d8f8b', rugPattern: '#2f6150', bedding: '#e7e6e2', white: '#d9d8d3', pot: '#2d2d2b' },
  },
  'walnut-navy': {
    name: '월넛 & 네이비', mood: 'classic', finish: 'stone',
    note: '월넛 원목과 네이비 패브릭, 황동 디테일',
    colors: { fabric: '#34435c', fabric2: '#c9b99d', wood: '#6e4b35', woodDark: '#3e2a1f', metal: '#b08d57', accent: '#c2924a', rug: '#d9d0c1', rugPattern: '#34435c', bedding: '#f0ece4', white: '#ebe6dc', pot: '#3e4a5e' },
  },
};

const L = 'Living front', W = 'Bedroom west', C = 'Bedroom center', M = 'Master bedroom', K = 'Kitchen';
// Decor tries the four corners and the middle of the window wall, keeping 60 cm from furniture.
const corners = (gap = 0.06) => [
  { x: ['min', gap], z: ['max', gap] }, { x: ['max', gap], z: ['max', gap] },
  { x: ['min', gap], z: ['min', gap] }, { x: ['max', gap], z: ['min', gap] },
  { x: ['mid', 0], z: ['max', gap] }, { x: ['mid', 0], z: ['min', gap] },
];
const decor = (kind, room) => ({ kind, room, face: 'south', optional: true, ...corners()[0], candidates: corners().slice(1) });
const dining = (expandedKind, expanded = [7.92, 2.32]) => ({
  kind: expandedKind, room: K, face: 'south', x: ['at', expanded[0]], z: ['at', expanded[1]],
  variants: { basic: { kind: 'dining2', x: ['at', 7.85], z: ['at', 2.78], note: '기본형은 주방 폭이 좁아 2인 식탁으로 바꿨어요.' } },
});

export const CONCEPTS = [
  {
    id: 'family-lounge', title: '패밀리 라운지', short: '패밀리 라운지', households: ['family4'], also: ['baby'],
    tagline: '넉넉한 4인 소파와 6인 식탁, 아이 방 두 개',
    story: 'TV와 소파를 마주 두고 거실 가운데를 비워 아이들이 뛰놀 수 있게 했어요. 작은 방 두 곳은 각자의 침대와 공부 자리를 갖춘 아이 방이에요.',
    palettes: ['oat-oak', 'sage-white', 'walnut-navy'], keep: ['king'],
    rooms: { [L]: '가족 거실', [W]: '첫째 방', [C]: '둘째 방', [M]: '부부 침실', [K]: '다이닝' },
    items: [
      { kind: 'rugRound', room: L, face: 'south', x: ['mid', 0.12], z: ['mid', 0] },
      { kind: 'sofa4', room: L, face: 'west', x: ['max', 0.04], z: ['mid', 0], candidates: [{ kind: 'sofa3' }] },
      { kind: 'coffeeRound', room: L, face: 'south', x: ['max', 1.65], z: ['mid', 0] },
      { kind: 'tvConsole', room: L, face: 'east', x: ['min', 0.04], z: ['mid', 0] },
      decor('plant', L), decor('floorLamp', L),
      dining('dining6'),
      { kind: 'singleBed', room: W, face: 'south', x: ['min', 0.04], z: ['min', 0.04] },
      { kind: 'deskSet', room: W, face: 'west', x: ['max', 0.03], z: ['mid', 0.35] },
      { kind: 'rugSmall', room: W, face: 'east', x: ['mid', 0.15], z: ['mid', 0.35] },
      { kind: 'loftBed', room: C, face: 'south', x: ['min', 0.04], z: ['min', 0.04] },
      { kind: 'bookshelf', room: C, face: 'west', x: ['max', 0.04], z: ['max', 0.04] },
      decor('plant', M),
    ],
  },
  {
    id: 'kids-play', title: '키즈 플레이 하우스', short: '키즈 플레이', households: ['baby'], also: ['family4'],
    tagline: '거실 놀이 매트와 놀이방, 부모 침대 곁 아기 침대',
    story: '모서리 있는 테이블 대신 넓은 놀이 매트를 깔고 서쪽 방을 놀이방으로 꾸몄어요. 아기 침대는 밤에 돌보기 쉽도록 부모 침대 옆에 두었어요.',
    palettes: ['cream-pastel', 'sage-white', 'oat-oak'], keep: ['king'],
    rooms: { [L]: '놀이 거실', [W]: '놀이방', [C]: '부모 서재', [M]: '부모·아기 침실', [K]: '다이닝' },
    items: [
      { kind: 'playMat', room: L, face: 'south', x: ['mid', -0.15], z: ['mid', 0] },
      { kind: 'loveseat', room: L, face: 'west', x: ['max', 0.04], z: ['mid', 0] },
      { kind: 'toyShelf', room: L, face: 'east', x: ['min', 0.04], z: ['mid', 0] },
      decor('plant', L),
      dining('dining4', [7.92, 2.35]),
      { kind: 'rugSmall', room: W, face: 'south', x: ['mid', -0.1], z: ['mid', 0.2] },
      { kind: 'teepee', room: W, face: 'north', x: ['min', 0.05], z: ['max', 0.05] },
      { kind: 'toyShelf', room: W, face: 'south', x: ['min', 0.05], z: ['min', 0.04] },
      { kind: 'kidsTable', room: W, face: 'south', x: ['max', 0.05], z: ['mid', 0], candidates: [{ z: ['mid', 0.25] }] },
      { kind: 'deskSet', room: C, face: 'south', x: ['min', 0.05], z: ['min', 0.04] },
      { kind: 'armchair', room: C, face: 'north', x: ['min', 0.1], z: ['max', 0.1] },
      { kind: 'bookshelf', room: C, face: 'west', x: ['max', 0.04], z: ['max', 0.04] },
      { kind: 'crib', room: M, face: 'south', x: ['max', 0.05], z: ['mid', 0], allowClose: true,
        why: '밤중 수유를 위해 부모 침대 옆에 두어 60cm 여유 안내가 표시돼요.' },
    ],
  },
  {
    id: 'newlywed', title: '신혼 갤러리 라운지', short: '신혼 갤러리', households: ['couple'], also: ['solo'],
    tagline: '러그 위 3인 소파, 함께 쓰는 서재와 드레스룸',
    story: '거실은 러그와 커피 테이블로 호텔 라운지처럼 꾸몄어요. 작은 방은 둘이 나란히 앉는 2인 책상 서재와, 큰 옷장과 독서 의자를 둔 드레스룸으로 나눴어요.',
    palettes: ['greige-terracotta', 'walnut-navy', 'sage-white'], keep: ['king'],
    rooms: { [L]: '라운지 거실', [W]: '드레스룸', [C]: '부부 서재', [M]: '침실', [K]: '다이닝' },
    items: [
      { kind: 'rugRect', room: L, face: 'west', x: ['mid', 0.15], z: ['mid', 0], candidates: [{ face: 'south' }] },
      { kind: 'sofa3', room: L, face: 'west', x: ['max', 0.04], z: ['mid', 0] },
      { kind: 'coffeeRect', room: L, face: 'west', x: ['max', 1.62], z: ['mid', 0] },
      { kind: 'tvConsole', room: L, face: 'east', x: ['min', 0.04], z: ['mid', 0] },
      decor('plant', L), decor('floorLamp', L),
      dining('dining4', [7.92, 2.35]),
      { kind: 'wardrobe2', room: W, face: 'east', x: ['min', 0.04], z: ['min', 0.04] },
      { kind: 'armchair', room: W, face: 'west', x: ['max', 0.1], z: ['max', 0.15] },
      { kind: 'rugSmall', room: W, face: 'east', x: ['mid', 0.3], z: ['mid', 0.4] },
      { kind: 'deskWide', room: C, face: 'east', x: ['min', 0.04], z: ['mid', 0.2] },
      { kind: 'bookshelf', room: C, face: 'west', x: ['max', 0.04], z: ['max', 0.04] },
      decor('plant', M),
    ],
  },
  {
    id: 'wfh-studio', title: '재택 라이브러리 스튜디오', short: '재택 스튜디오', households: ['solo'], also: ['couple'],
    tagline: '벽면 서가 라운지와 듀얼 모니터 홈오피스, 게스트룸',
    story: 'TV 자리에 벽면 서가를 세워 거실을 라이브러리처럼 쓰고, 가운데 방은 집중하는 홈오피스로 꾸몄어요. 서쪽 방은 손님이 머물 수 있는 게스트룸이에요.',
    palettes: ['charcoal-green', 'walnut-navy', 'oat-oak'], keep: ['king'],
    rooms: { [L]: '라이브러리 거실', [W]: '게스트룸', [C]: '홈오피스', [M]: '침실', [K]: '다이닝' },
    items: [
      { kind: 'rugRound', room: L, face: 'south', x: ['mid', 0.12], z: ['mid', 0] },
      { kind: 'sofa3', room: L, face: 'west', x: ['max', 0.04], z: ['mid', 0] },
      { kind: 'coffeeRound', room: L, face: 'south', x: ['max', 1.65], z: ['mid', 0] },
      { kind: 'bookshelfWide', room: L, face: 'east', x: ['min', 0.04], z: ['mid', 0], candidates: [{ kind: 'bookshelf' }] },
      decor('floorLamp', L), decor('plant', L),
      { kind: 'dining2', room: K, face: 'south', x: ['at', 7.85], z: ['at', 2.78] },
      { kind: 'singleBed', room: W, face: 'south', x: ['min', 0.04], z: ['min', 0.04] },
      decor('plant', W),
      { kind: 'deskPro', room: C, face: 'east', x: ['min', 0.04], z: ['mid', 0.2] },
      { kind: 'bookshelf', room: C, face: 'west', x: ['max', 0.04], z: ['max', 0.04] },
      decor('floorLamp', C),
    ],
  },
];

// What each household needs; checked against the furniture a concept actually places.
export const NEEDS = {
  solo: [
    { key: 'sleeps', min: 1, label: '잠자리' },
    { key: 'desks', min: 1, label: '업무 공간' },
    { key: 'dining', min: 1, label: '식사 공간' },
  ],
  couple: [
    { key: 'sleeps', min: 2, label: '2인 침대' },
    { key: 'desks', min: 1, label: '서재 · 업무' },
    { key: 'dining', min: 2, label: '2인 이상 식탁' },
  ],
  baby: [
    { key: 'sleeps', min: 2, label: '부부 침대' },
    { key: 'infant', min: 1, label: '아기 침대' },
    { key: 'play', min: 1, label: '놀이 공간' },
    { key: 'dining', min: 3, label: '3인 이상 식탁' },
  ],
  family4: [
    { key: 'sleeps', min: 4, label: '잠자리 4' },
    { key: 'desks', min: 2, label: '공부 자리 2' },
    { key: 'dining', min: 4, label: '4인 이상 식탁' },
  ],
};
