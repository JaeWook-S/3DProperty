// 집들이 (house tours): real homes that other people styled, shown with real photographs, so
// a viewer sees a look they want and brings it to 우리 집 even though the floor plan differs.
// Pure data.
//
// Each tour has
//   home    주거형태, 평수 and rooms of that home, so viewers can find homes like their own
//   photos  real photographs of that one home, each with the space it shows; the first is the
//           cover. One shoot per home, credited by its author. Photos are Unsplash License photos
//           unless the tour names another `source` (an 오늘의집 post, linked from every photo).
//   concept/palette/lighting  how CORTEX recreates the look in a 112A plan
//           (src/concepts/catalog.js); previews are renders of that (tools/house-tours/render-tours.mjs).
// Until viewers post their own homes, the home details (평수, 가족 구성) are example values chosen
// to fit the photos; the gallery says so. `popularity` is a starting value for 인기순 until a
// server collects everyone's views, previews and applications; `published` orders 최신순.

export const TAG_GROUPS = [
  { id: 'type', label: '주거형태', tags: [
    { id: 'apartment', label: '아파트' }, { id: 'villa', label: '빌라' }, { id: 'officetel', label: '오피스텔' },
  ] },
  { id: 'size', label: '평수', tags: [
    { id: '10s', label: '10평대' }, { id: '20s', label: '20평대' }, { id: '30s', label: '30평대' }, { id: '40s', label: '40평 이상' },
  ] },
  { id: 'household', label: '가족 구성', tags: [
    { id: 'solo', label: '1인 가구' }, { id: 'couple', label: '신혼부부' },
    { id: 'baby', label: '아기와 함께' }, { id: 'family4', label: '4인 가족' },
  ] },
  { id: 'style', label: '스타일', tags: [
    { id: 'natural', label: '내추럴' }, { id: 'modern', label: '모던' }, { id: 'minimal', label: '미니멀' },
    { id: 'classic', label: '클래식' }, { id: 'cozy', label: '포근한' },
  ] },
  { id: 'space', label: '공간', tags: [
    { id: 'living', label: '거실' }, { id: 'bedroom', label: '침실' }, { id: 'dining', label: '주방·다이닝' },
    { id: 'kids', label: '아이방' }, { id: 'office', label: '홈오피스' }, { id: 'storage', label: '수납·현관' },
    { id: 'pet', label: '반려동물' },
  ] },
  { id: 'color', label: '컬러', tags: [
    { id: 'wood', label: '우드', color: '#c69c6d' }, { id: 'white', label: '화이트', color: '#eeeae2' },
    { id: 'gray', label: '그레이', color: '#9a9ea2' }, { id: 'green', label: '그린', color: '#6f8c68' },
    { id: 'pink', label: '핑크', color: '#e9b9b4' }, { id: 'brown', label: '브라운', color: '#7a5a48' },
    { id: 'black', label: '블랙', color: '#2b2d2f' }, { id: 'red', label: '레드', color: '#b8453a' },
  ] },
];

export const LIGHTING = { day: '낮', sunset: '해질녘', night: '밤' };
export const PLANS = { expanded: '112A 확장형', basic: '112A 기본형' };
export const HOME_TYPES = { apartment: '아파트', villa: '빌라', officetel: '오피스텔' };
export const sizeBand = (pyeong) => (pyeong >= 40 ? '40s' : pyeong >= 30 ? '30s' : pyeong >= 20 ? '20s' : '10s');

// 우리 집 as the gallery compares it. 112A is read as 공급 112㎡, about 34평; both plans keep
// three bedrooms. Replace with the registered home's own record when homes can be added.
export const MY_HOME = { type: 'apartment', pyeong: 34, rooms: 3 };

const unsplash = (id, photo, space, text) => ({ id, photo, space, text });
// A photo from an 오늘의집 집들이 post, shown from 오늘의집's image server and linked to the post.
const OHOUSE_PHOTO = 'https://image.ohousecdn.com/i/bucketplace-v2-development/uploads/cards/projects/';
const ohouse = (post) => (file, space, text) => ({ id: file, src: `${OHOUSE_PHOTO}${file}.jpg`, page: post, space, text });
const BY = {
  tyson: { name: 'Alex Tyson', page: 'https://unsplash.com/@alextyson195' },
  lisa: { name: 'Lisa Anna', page: 'https://unsplash.com/@lisaanna195' },
  yong: { name: '용테리어 디자인', page: 'https://contents.ohou.se/projects/142083' },
};
const yong = ohouse(BY.yong.page);

const RAW = [
  {
    id: 'mountain-white', by: BY.lisa, concept: 'family-lounge', palette: 'white-oak', lighting: 'day',
    home: { type: 'apartment', pyeong: 33, rooms: 3 }, popularity: 96, published: '2026-10-20',
    title: '창밖이 액자가 되는 집, 하얀 벽과 오크 마루의 33평',
    summary: '벽과 천장은 모두 하얀색으로 두고 바닥과 식탁만 밝은 오크로 맞췄어요. 가구를 낮게 두어 큰 창 너머 풍경이 거실의 주인공이 돼요.',
    points: ['하얀 벽 + 오크 마루, 두 가지 색만', '낮은 소파와 둥근 식탁으로 넓어 보이게', '창가에는 의자 하나만 두고 비우기'],
    tags: { household: ['family4', 'couple'], style: ['natural', 'minimal'], space: ['living', 'dining'], color: ['white', 'wood'] },
    photos: [
      unsplash('PJPd8Wh4rxs', 'photo-1733839208151-4c53a694a57d', 'living', '패브릭 소파와 원목 테이블만 둔 거실이에요. 하얀 벽이 빛을 받아 집 전체가 환해요.'),
      unsplash('NCBt_DWPx7w', 'photo-1733839206899-21bad759dca4', 'dining', '거실 한쪽에 둥근 식탁을 두었어요. 모서리가 없어 지나다니기 편해요.'),
      unsplash('xM2jVxui-5M', 'photo-1733839205624-d395439a3785', 'living', '창가에는 라운지 체어 하나만 두고 풍경을 보는 자리로 비웠어요.'),
      unsplash('tmOH5yCnE0Q', 'photo-1733839206340-14fac5d07d37', 'living', '발코니는 가구 없이 비워 두고 창을 크게 열었어요.'),
    ],
  },
  {
    id: 'olive-piano', by: BY.tyson, concept: 'music-library', palette: 'oat-oak', lighting: 'day',
    home: { type: 'apartment', pyeong: 24, rooms: 2 }, popularity: 88, published: '2026-10-18',
    title: '올리브 소파 옆 업라이트 피아노, 음악이 흐르는 24평',
    summary: '회색 벽에 올리브 소파와 검은 가구로 차분하게 맞추고, 창가에는 업라이트 피아노를 두었어요. 식탁은 거실 끝에 붙여 하나의 큰 공간처럼 써요.',
    points: ['창가 업라이트 피아노와 라운지 체어', '회색 벽 + 올리브 소파 + 블랙 포인트', '거실과 이어지는 둥근 다이닝'],
    tags: { household: ['couple', 'solo'], style: ['modern', 'cozy'], space: ['living', 'dining', 'bedroom'], color: ['green', 'gray', 'black'] },
    photos: [
      unsplash('IpCFYcW_4gA', 'photo-1729606312138-6ed6681dcf0b', 'living', '올리브색 소파와 검은 커피 테이블, 그 뒤로 이어지는 다이닝이에요.'),
      unsplash('idET572i7To', 'photo-1729606312213-cfdf3c8f7311', 'living', '창가에 업라이트 피아노와 검은 라운지 체어를 두었어요. 큰 시계가 포인트예요.'),
      unsplash('pjzqrqt1yBU', 'photo-1729606312336-63d202c090b1', 'dining', '둥근 식탁에 검은 의자, 라탄 펜던트로 다이닝을 꾸몄어요.'),
      unsplash('G_68-4rsMdU', 'photo-1729606312913-d61622818485', 'bedroom', '침실은 짙은 회색 침구에 초록 쿠션 하나로 색을 이어 갔어요.'),
    ],
  },
  {
    id: 'stone-walnut', by: BY.yong, source: '오늘의집', concept: 'hotel-minimal', palette: 'stone-walnut', lighting: 'sunset',
    home: { type: 'apartment', pyeong: 18, rooms: 1 }, popularity: 84, published: '2026-11-27',
    title: '호텔 같은 고급스러움, 1인 가구의 13평 올리모델링',
    summary: '벽은 다크 스톤 그레이 타일로, 바닥과 문은 월넛으로 맞춰 호텔처럼 묵직하게 꾸몄어요. 가구는 코냑색 가죽 소파와 검은 낮은 테이블만 두고, 우물천장 간접조명으로 분위기를 바꿔요.',
    points: ['다크 스톤 그레이 벽 + 월넛 마루와 문', '코냑 가죽 소파와 검은 낮은 테이블만 두기', '우물천장과 커튼 박스의 간접조명'],
    tags: { household: ['solo'], style: ['modern', 'classic'], space: ['living', 'dining', 'bedroom'], color: ['black', 'gray', 'brown'] },
    photos: [
      yong('168567407731095248', 'living', '스톤 타일 벽 앞에 코냑색 가죽 소파와 흰 러그, 검은 낮은 테이블만 두었어요.'),
      yong('168567404047258641', 'living', 'TV 벽에는 수납장을 숨겨 넣고, 거실과 주방을 같은 스톤 그레이로 이었어요.'),
      yong('168567410351970099', 'living', '소파 뒤 벽도 타일로 마감했어요. 월넛 마루와 가죽 소파가 같은 갈색 톤이에요.'),
      yong('168713693776312113', 'dining', 'ㄱ자로 줄인 주방은 다크 그레이와 월넛 장으로 짜서 식기가 보이지 않게 했어요.'),
      yong('168713889211169618', 'bedroom', '침실은 라이트 그레이 벽지에 러그 하나만 두고 조명은 어둡게 맞췄어요.'),
    ],
  },
];

// 주거형태 and 평수 come from the home record, so filters and the record never disagree.
export const TOURS = RAW.map((tour) => ({ ...tour, tags: { type: [tour.home.type], size: [sizeBand(tour.home.pyeong)], ...tour.tags } }));

export const tourById = (id) => TOURS.find((tour) => tour.id === id) ?? null;
export const tagLabel = (group, id) => TAG_GROUPS.find((g) => g.id === group)?.tags.find((t) => t.id === id)?.label ?? id;
export const photoURL = (photo, width) => (photo.src ? `${photo.src}?w=${width}` : `https://images.unsplash.com/${photo.photo}?w=${width}&q=78&auto=format&fit=crop`);
export const photoPage = (photo) => photo.page ?? `https://unsplash.com/photos/${photo.id}`;
/** Where a tour's photos come from, for its byline. */
export const photoSource = (tour) => tour.source ?? 'Unsplash';
/** "아파트 · 33평 · 방 3"; a home without a separate bedroom (rooms 0) is a 원룸. */
export const homeLine = (home) => `${HOME_TYPES[home.type]} · ${home.pyeong}평 · ${home.rooms ? `방 ${home.rooms}` : '원룸'}`;

/**
 * How close a home is to 우리 집: the same 주거형태 counts 2, the same 평수 band 2 (the next
 * band 1), the same number of rooms 1. Returns the score and what matched, in words.
 */
export function similarity(home, mine = MY_HOME) {
  const same = [];
  let score = 0;
  if (home.type === mine.type) { score += 2; same.push(HOME_TYPES[home.type]); }
  const bands = TAG_GROUPS.find((g) => g.id === 'size').tags.map((t) => t.id);
  const gap = Math.abs(bands.indexOf(sizeBand(home.pyeong)) - bands.indexOf(sizeBand(mine.pyeong)));
  if (gap === 0) { score += 2; same.push(tagLabel('size', sizeBand(home.pyeong))); } else if (gap === 1) score += 1;
  if (home.rooms === mine.rooms) { score += 1; same.push(`방 ${home.rooms}`); }
  return { score, same };
}
/** Similar enough to list under "우리 집과 비슷한 집". */
export const isSimilar = (home, mine = MY_HOME) => similarity(home, mine).score >= 3;

/**
 * Tours matching the picked tags. `selected` maps a group id to a Set of tag ids; a tour
 * must match every group that has picks, any tag within a group. More matches rank first.
 */
export function matchTours(selected = {}, tours = TOURS) {
  const groups = Object.entries(selected).filter(([, tags]) => tags.size);
  return tours.map((tour, order) => {
    const matched = groups.flatMap(([group, tags]) => (tour.tags[group] ?? []).filter((tag) => tags.has(tag)).map((tag) => `${group}:${tag}`));
    const ok = groups.every(([group, tags]) => (tour.tags[group] ?? []).some((tag) => tags.has(tag)));
    return { tour, matched, ok, order };
  }).filter((entry) => entry.ok).sort((a, b) => b.matched.length - a.matched.length || a.order - b.order);
}
