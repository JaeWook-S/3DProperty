// 집들이 (house tours): real homes that other people styled, shown with real photographs, so
// a viewer sees a look they want and brings it to 우리 집 even though the floor plan differs.
// Pure data.
//
// Each tour has
//   home    주거형태, 평수 and rooms of that home, so viewers can find homes like their own
//   photos  real photographs of that one home, each with the space it shows; the first is the
//           cover. All are Unsplash License photos, credited by photographer; one shoot per home.
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
const BY = {
  tyson: { name: 'Alex Tyson', page: 'https://unsplash.com/@alextyson195' },
  lisa: { name: 'Lisa Anna', page: 'https://unsplash.com/@lisaanna195' },
  huy: { name: 'Huy Nguyen', page: 'https://unsplash.com/@huynguyen_pch' },
  bozica: { name: 'Bozica Uglesic', page: 'https://unsplash.com/@bozica24' },
  julia: { name: 'pure julia', page: 'https://unsplash.com/@purejulia' },
  caroline: { name: 'Caroline Badran', page: 'https://unsplash.com/@___atmos' },
  aquilion: { name: 'Aquilion Property', page: 'https://unsplash.com/@aquilionproperty' },
  alexey: { name: 'Alexey Aladashvili', page: 'https://unsplash.com/@alexeyaladashvili61' },
  kate: { name: 'Kate Darmody', page: 'https://unsplash.com/@kdarmody' },
  louis: { name: 'Louis Hansel', page: 'https://unsplash.com/@louishansel' },
};

const RAW = [
  {
    id: 'mountain-white', by: BY.lisa, concept: 'family-lounge', palette: 'oat-oak', lighting: 'day',
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
    id: 'pink-nursery', by: BY.lisa, concept: 'kids-play', palette: 'cream-pastel', lighting: 'day',
    home: { type: 'apartment', pyeong: 32, rooms: 3 }, popularity: 91, published: '2026-10-21',
    title: '아기 방은 핑크, 첫째 방은 블루그레이로 나눈 32평 가족 집',
    summary: '방마다 벽 색을 달리해 아이마다 자기 방을 갖게 했어요. 가구는 흰색과 원목으로 통일해 색이 많아도 차분해요.',
    points: ['아기 방은 연한 핑크 벽과 흰 아기 침대', '첫째 방은 데이베드와 벽 선반 책상', '가구는 흰색·원목으로만 맞추기'],
    tags: { household: ['baby', 'family4'], style: ['cozy', 'natural'], space: ['kids', 'bedroom', 'dining'], color: ['pink', 'white'] },
    photos: [
      unsplash('5_OrHwAeo5Y', 'photo-1734965158037-972d2fbcd869', 'kids', '연한 핑크 벽에 흰 아기 침대와 검은 서랍장을 두었어요. 모빌과 작은 그림으로만 꾸몄어요.'),
      unsplash('wSS1-njcPgY', 'photo-1734965158035-5b255dec1ebb', 'kids', '첫째 방은 블루그레이 벽에 서랍형 데이베드를 놓아 낮에는 소파처럼 써요.'),
      unsplash('KwXrRwic-14', 'photo-1734965158337-9f78cda8032d', 'kids', '창가 벽에 선반형 책상을 달아 바닥을 넓게 남겼어요.'),
      unsplash('c9tuAoEyjh4', 'photo-1734965158024-d7419f9260b7', 'bedroom', '부부 침실은 원목 붙박이장과 흰 침구로 단정하게 두었어요.'),
      unsplash('UTjdmi0nklI', 'photo-1734965158375-630e397394da', 'dining', '원목 의자와 작은 샹들리에를 단 다이닝이에요.'),
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
    id: 'river-view', by: BY.huy, concept: 'family-lounge', palette: 'walnut-navy', lighting: 'sunset',
    home: { type: 'apartment', pyeong: 45, rooms: 4 }, popularity: 85, published: '2026-10-16',
    title: '강과 다리가 보이는 고층, 월넛과 대리석으로 맞춘 45평',
    summary: '거실 창으로 강이 보이는 고층 아파트예요. 짙은 월넛 수납장과 대리석 아일랜드로 무게를 주고, 선반에는 간접 조명을 넣었어요.',
    points: ['창을 가리지 않는 낮은 거실 가구', '월넛 수납장 속 간접 조명 선반', '대리석 아일랜드 주방'],
    tags: { household: ['family4'], style: ['classic', 'modern'], space: ['living', 'dining'], color: ['brown', 'wood'] },
    photos: [
      unsplash('ciHrgv7HKZE', 'photo-1776831234992-57ee0eaa9bbf', 'living', '아일랜드 너머로 강과 다리가 보이는 거실이에요. 가구를 낮게 두어 창을 가리지 않아요.'),
      unsplash('HdV8o72FhgU', 'photo-1776831185107-179b943aa16b', 'living', '월넛 수납장에 조명을 넣어 저녁에는 선반이 은은하게 빛나요.'),
      unsplash('kb_Q3CLOlzo', 'photo-1776831293955-f569f2f3a4b5', 'dining', '대리석 아일랜드와 짙은 상부장으로 맞춘 주방이에요.'),
      unsplash('yeiddImKtF0', 'photo-1776831308461-36a6725e1f98', 'dining', '조리대 아래에도 조명을 달아 작업 공간이 밝아요.'),
    ],
  },
  {
    id: 'golden-dog', by: BY.caroline, concept: 'pet-lounge', palette: 'sage-white', lighting: 'day',
    home: { type: 'apartment', pyeong: 26, rooms: 2 }, popularity: 83, published: '2026-10-23',
    title: '소파는 강아지 자리, 그레이와 세이지로 꾸민 26평',
    summary: '털이 덜 보이는 회색 소파에 세이지 니트 담요를 덮어 강아지와 함께 써요. 수납장은 낮게 두고 위쪽 선반에 책과 화분을 올렸어요.',
    points: ['털이 덜 보이는 회색 소파와 니트 담요', '손 닿지 않는 높이의 벽 선반', '하얀 벽에 초록 화분으로 포인트'],
    tags: { household: ['couple'], style: ['cozy', 'natural'], space: ['living', 'pet', 'storage'], color: ['gray', 'green', 'white'] },
    photos: [
      unsplash('OIQw5xjr6Bc', 'photo-1789916978486-d5a91067b509', 'pet', '회색 소파 위 세이지 담요는 강아지 자리예요. 쿠션은 줄무늬와 하늘색으로 맞췄어요.'),
      unsplash('NU56v6foDLs', 'photo-1789916978458-d07c22cc0987', 'living', '소파 옆에는 작은 테이블과 흰 램프를 두었어요.'),
      unsplash('Pek7STpLEvg', 'photo-1789916978401-429bca35ae92', 'storage', '낮은 수납장 위는 비우고, 선반에 조명을 넣었어요.'),
      unsplash('lIPgkPAb-zk', 'photo-1789916978445-e7af8cde80f5', 'storage', '하얀 벽 선반에 책과 레코드, 늘어지는 화분을 올렸어요.'),
    ],
  },
  {
    id: 'hotel-condo', by: BY.huy, concept: 'hotel-minimal', palette: 'greige-terracotta', lighting: 'sunset',
    home: { type: 'apartment', pyeong: 28, rooms: 2 }, popularity: 79, published: '2026-10-14',
    title: '호텔 같은 침실, 그레이지와 오렌지 쿠션으로 맞춘 28평',
    summary: '침실은 호텔처럼 침대와 협탁만 두고, 둥근 거울과 오렌지 쿠션으로 포인트를 줬어요. 거실은 낮은 소파와 유리 테이블로 가볍게 비웠어요.',
    points: ['침대·협탁·거울만 둔 호텔식 침실', '그레이지 톤에 오렌지 쿠션 하나', '창가까지 비운 거실'],
    tags: { household: ['couple'], style: ['modern', 'minimal'], space: ['bedroom', 'living', 'dining', 'office'], color: ['gray', 'brown'] },
    photos: [
      unsplash('i9Lp1hd5M-c', 'photo-1612320583049-eabe3c21bd94', 'bedroom', '패브릭 헤드보드 침대에 둥근 거울과 벽등을 달았어요. 쿠션은 오렌지로 맞췄어요.'),
      unsplash('QGxBeUDkeWk', 'photo-1612419299101-6c294dc2901d', 'living', '거실은 베이지 소파와 유리 테이블만 두고 창 쪽을 비웠어요.'),
      unsplash('mVLMZiILyxM', 'photo-1612320743558-020669ff20e8', 'bedroom', '다른 침실은 벽걸이 TV와 간접 조명으로 정리했어요.'),
      unsplash('9vvp_nuVaJk', 'photo-1612320648993-61c1cd604b71', 'dining', '주방 앞에는 둥근 원목 식탁과 검은 의자를 두었어요.'),
      unsplash('KlZ33F_Y3aI', 'photo-1612320583354-02dd0cf04612', 'office', '작은 방은 붉은 벽에 창가 데이베드와 책상을 둔 서재예요.'),
    ],
  },
  {
    id: 'mauve-gallery', by: BY.tyson, concept: 'newlywed', palette: 'greige-terracotta', lighting: 'sunset',
    home: { type: 'apartment', pyeong: 19, rooms: 1 }, popularity: 76, published: '2026-10-22',
    title: '모브 벽에 그림을 건 19평, 갤러리처럼 사는 1인 가구',
    summary: '벽을 짙은 모브 톤으로 칠하고 그림을 크게 걸었어요. 조명은 펜던트와 스탠드로 나눠 저녁이 더 아늑해요.',
    points: ['짙은 모브 벽 + 큰 그림 두 점', '식탁 위 돔 펜던트와 스탠드 조명', '현관은 오픈 행거와 거울로 수납'],
    tags: { household: ['solo', 'couple'], style: ['classic', 'cozy'], space: ['living', 'dining', 'storage'], color: ['brown', 'pink'] },
    photos: [
      unsplash('pWs45f1YDIg', 'photo-1734242693887-506df954637b', 'dining', '모브 벽에 색이 강한 그림 두 점을 걸고, 식탁 위에 흰 돔 펜던트를 달았어요.'),
      unsplash('BkNDNbz8aS8', 'photo-1734242693773-1a79a6f890f3', 'living', '거실 벽에는 흑백 그림을 걸고 소파는 밝은 패브릭으로 골랐어요.'),
      unsplash('TUi6J0I-LSE', 'photo-1734242693844-d6c3e1e5ba6e', 'dining', '창가 쪽에는 앰버 스탠드와 화병으로 따뜻한 빛을 더했어요.'),
      unsplash('TWWULN2wuJY', 'photo-1734242693810-77acdb8e12c7', 'storage', '현관은 오픈 행거와 서랍장, 긴 거울로 정리했어요.'),
    ],
  },
  {
    id: 'pink-small', by: BY.bozica, concept: 'newlywed', palette: 'sage-white', lighting: 'day',
    home: { type: 'villa', pyeong: 15, rooms: 0 }, popularity: 72, published: '2026-10-19',
    title: '하얀 가구에 핑크 한 스푼, 15평 빌라 원룸',
    summary: '가구는 모두 흰색으로 골라 작은 집이 답답하지 않게 했어요. 쿠션과 꽃, 머그컵만 핑크로 맞춰 포인트를 줬어요.',
    points: ['흰 소파·흰 식탁 의자로 넓어 보이게', '쿠션과 꽃만 핑크로', '침대 옆 작은 라운지 체어'],
    tags: { household: ['solo'], style: ['cozy', 'natural'], space: ['living', 'dining', 'bedroom'], color: ['pink', 'white'] },
    photos: [
      unsplash('7MGj75YLNTw', 'photo-1663756915301-2ba688e078cf', 'living', '흰 커튼과 흰 소파, 작은 TV장으로 거실을 가볍게 꾸몄어요.'),
      unsplash('e3qWTOOOzKs', 'photo-1663756915436-c6842b9d3eb0', 'living', '소파 벽만 짙은 색으로 두고 핑크 쿠션을 얹었어요.'),
      unsplash('mf3BJqfZSso', 'photo-1663756915302-437cd36f4cfd', 'dining', '창가에 둥근 식탁과 흰 의자를 두었어요.'),
      unsplash('RvZ2CLnc0nY', 'photo-1663756915302-78b3bc4be8f1', 'bedroom', '침대 옆에는 작은 체어와 사이드 테이블을 두었어요.'),
    ],
  },
  {
    id: 'cat-gray', by: BY.julia, concept: 'pet-lounge', palette: 'greige-terracotta', lighting: 'day',
    home: { type: 'villa', pyeong: 17, rooms: 0 }, popularity: 69, published: '2026-10-17',
    title: '고양이와 사는 17평, 그레이 의자와 하얀 선반',
    summary: '둥근 흰 식탁에 회색 의자를 두고, 벽에는 얇은 선반을 달아 책과 그림을 올렸어요. 고양이가 올라가도 넘어지지 않는 낮고 무거운 가구를 골랐어요.',
    points: ['모서리 없는 둥근 식탁', '고양이가 좋아하는 창가 의자', '벽 선반에 책·액자·바구니'],
    tags: { household: ['solo'], style: ['minimal', 'cozy'], space: ['pet', 'dining', 'storage'], color: ['gray', 'white'] },
    photos: [
      unsplash('A44l695RdC8', 'photo-1632489752105-4b2dc7d1c6b6', 'pet', '창가 식탁 의자는 고양이 자리예요. 회색 의자와 흰 식탁이 잘 어울려요.'),
      unsplash('O_4ZEWRLyl8', 'photo-1632489752865-28346e16cd85', 'dining', '둥근 흰 식탁에 회색 의자, 벽에는 작은 그림 하나만 걸었어요.'),
      unsplash('hhUkMLJUTTE', 'photo-1632489753406-52689c507a83', 'storage', '얇은 벽 선반에 액자와 소품을 올렸어요.'),
      unsplash('0KF67LFQbFs', 'photo-1632489752912-7e817fdcb64a', 'storage', '아래 선반에는 책과 라탄 바구니를 두었어요.'),
    ],
  },
  {
    id: 'oak-officetel', by: BY.aquilion, concept: 'wfh-studio', palette: 'oat-oak', lighting: 'day',
    home: { type: 'officetel', pyeong: 12, rooms: 0 }, popularity: 64, published: '2026-10-15',
    title: '일하고 쉬는 12평 오피스텔, 오크 칸막이로 나눈 원룸',
    summary: '원룸을 오크 프레임 칸막이로 침실과 작업 공간으로 나눴어요. 주방 옆 작은 식탁은 낮에는 책상, 저녁에는 식탁이 돼요.',
    points: ['오크 프레임 칸막이로 침대 가리기', '창가 책상과 벽걸이 TV', '식탁 겸 책상 하나로 두 가지'],
    tags: { household: ['solo'], style: ['natural', 'modern'], space: ['office', 'bedroom', 'dining'], color: ['wood', 'white'] },
    photos: [
      unsplash('NoPzk4m4jHc', 'photo-1702014862053-946a122b920d', 'office', '오크 칸막이 너머로 침대, 앞쪽에 식탁 겸 책상을 두었어요.'),
      unsplash('1EJXSLUfqU0', 'photo-1702014859878-5d4743176d28', 'office', '침대 맞은편 벽에 책상과 TV를 붙여 작업 자리를 만들었어요.'),
      unsplash('hrY-pZqFGyI', 'photo-1702014859908-d48b9b844240', 'dining', '초록 타일 주방 옆에 2인 식탁을 두었어요.'),
      unsplash('qbhF5gOzhVU', 'photo-1702014861736-d62834317c5e', 'bedroom', '침대는 창 사이에 두고 협탁 대신 벽등을 달았어요.'),
    ],
  },
  {
    id: 'plant-jungle', by: BY.kate, concept: 'newlywed', palette: 'sage-white', lighting: 'day',
    home: { type: 'villa', pyeong: 18, rooms: 1 }, popularity: 81, published: '2026-10-24',
    title: '창가를 식물로 채운 18평, 초록 정글 같은 거실',
    summary: '큰 창 앞에 선반을 달아 화분을 층층이 올리고, 거실 가운데는 회색 소파와 러그만 두었어요. 식물이 많아도 가구를 낮게 두어 답답하지 않아요.',
    points: ['창가 선반과 행잉 화분으로 만든 식물 벽', '회색 소파 + 패턴 러그로 차분하게', '침대 옆 작은 램프와 흑백 그림'],
    tags: { household: ['couple', 'solo'], style: ['cozy', 'natural'], space: ['living', 'bedroom'], color: ['green', 'wood'] },
    photos: [
      unsplash('kN-xa7kZKIw', 'photo-1649445006396-ba5435168009', 'living', '창 앞 선반과 바닥까지 화분을 채우고, 소파는 창을 등지게 두었어요.'),
      unsplash('2YmEjjGIUOs', 'photo-1649445006945-083a7299b4b4', 'living', '창틀 위 선반과 행잉 화분으로 식물이 창을 감싸요.'),
      unsplash('rf52O4FQkZk', 'photo-1649445006098-e1ab371a4aca', 'living', '둥근 종이 펜던트 아래 소파와 러그로 거실 가운데를 묶었어요.'),
      unsplash('5sXr9LM1MsA', 'photo-1649445005748-4d99c2de54a4', 'bedroom', '침실은 흰 침구에 작은 램프와 흑백 그림으로 단정하게 두었어요.'),
    ],
  },
  {
    id: 'gray-orange', by: BY.alexey, concept: 'hotel-minimal', palette: 'ivory-charcoal', lighting: 'day',
    home: { type: 'apartment', pyeong: 21, rooms: 1 }, popularity: 74, published: '2026-10-13',
    title: '그레이 톤에 오렌지 한 점, 유리 칸막이로 나눈 21평',
    summary: '벽·바닥·가구를 모두 회색으로 맞추고 둥근 오렌지 테이블과 파란 화병만 색으로 남겼어요. 침실은 유리 칸막이로 나눠 거실이 더 넓어 보여요.',
    points: ['회색 톤 위에 오렌지·블루 포인트 하나씩', '유리 칸막이 뒤 침실', '창가에 붙인 작은 책상'],
    tags: { household: ['solo', 'couple'], style: ['minimal', 'modern'], space: ['living', 'dining', 'bedroom', 'office'], color: ['gray', 'white'] },
    photos: [
      unsplash('G52knRZZO6I', 'photo-1750764611091-93ac9e7d4c92', 'living', '창가에 낮은 소파와 둥근 오렌지 테이블, 흰 라운지 체어를 두었어요.'),
      unsplash('5aJpyxXaCyA', 'photo-1750764515068-80d222d974bb', 'dining', '회색 아일랜드 주방과 오렌지 스툴, 파란 화병이 이어지는 열린 구조예요.'),
      unsplash('hIkG3rwaaQE', 'photo-1750764673942-11e683ec65b0', 'bedroom', '침실은 유리 칸막이 너머에 두고 회색 침구로 맞췄어요.'),
      unsplash('bx32PsiTym8', 'photo-1750764766618-0c47bb1802f1', 'office', '창가 벽에 작은 책상과 스탠드를 붙여 일하는 자리를 만들었어요.'),
      unsplash('gq1y5sBvNeE', 'photo-1750764634377-583a271553a1', 'living', '물결 모양 오렌지 테이블이 회색 거실의 포인트예요.'),
    ],
  },
  {
    id: 'green-marble', by: BY.alexey, concept: 'wfh-studio', palette: 'charcoal-green', lighting: 'sunset',
    home: { type: 'apartment', pyeong: 23, rooms: 1 }, popularity: 67, published: '2026-10-12',
    title: '콘크리트 벽과 초록 대리석, 차분한 23평',
    summary: '벽과 수납장을 금속·콘크리트 톤으로 맞추고, 주방 아일랜드만 초록 대리석으로 골랐어요. 침실은 타공 철판 칸막이로 가볍게 나눴어요.',
    points: ['초록 대리석 아일랜드 하나로 포인트', '타공 철판 칸막이로 나눈 침실', '낮고 넓은 회색 소파'],
    tags: { household: ['couple'], style: ['modern', 'minimal'], space: ['living', 'dining', 'bedroom'], color: ['gray', 'green', 'black'] },
    photos: [
      unsplash('-E2-jiwSthQ', 'photo-1738748444626-ed333be8afc7', 'living', '거실에서 초록 대리석 아일랜드 주방이 이어져 보여요.'),
      unsplash('fO94dDrbEgk', 'photo-1738748444602-8e95197f4dbd', 'dining', '금속 상부장과 초록 대리석 아일랜드, 원목 스툴로 맞춘 주방이에요.'),
      unsplash('etIFTz0LhFQ', 'photo-1738748444659-f8975b12ce57', 'bedroom', '침실은 타공 철판 칸막이 너머에 두어 빛은 들어오고 시선은 가려요.'),
      unsplash('sI_6arPyB1M', 'photo-1738748444676-113d30c9a25b', 'living', '창가에는 낮은 회색 소파와 작은 테이블만 두었어요.'),
    ],
  },
  {
    id: 'terrazzo-red', by: BY.louis, concept: 'newlywed', palette: 'greige-terracotta', lighting: 'day',
    home: { type: 'villa', pyeong: 25, rooms: 2 }, popularity: 62, published: '2026-10-11',
    title: '패턴 타일 바닥에 빨간 의자, 25평 빌라의 지중해 무드',
    summary: '오래된 패턴 타일 바닥을 그대로 살리고, 하얀 벽에 빨간 의자와 그림으로 색을 더했어요. 둥근 거울과 시계 같은 소품은 한쪽 벽에 모아 걸었어요.',
    points: ['패턴 타일 바닥은 그대로 살리기', '빨간 의자와 빨간 그림으로 색 맞추기', '시계·거울은 한 벽에 모아서'],
    tags: { household: ['couple'], style: ['classic', 'cozy'], space: ['living', 'dining', 'office'], color: ['white', 'red'] },
    photos: [
      unsplash('w1w7sQ8md0I', 'photo-1551806235-a05dd14a54c7', 'living', '패턴 타일 바닥 위에 체크 소파와 빨간 의자를 둔 거실이에요.'),
      unsplash('ANYshwAv224', 'photo-1551806136-0688c7552454', 'dining', '빨간 그림 아래 둥근 검은 식탁과 의자를 두었어요.'),
      unsplash('5YWiNuWgiMs', 'photo-1551806235-fa3578e4ec2c', 'dining', '창가에는 작은 식탁과 빨간 의자, 둥근 거울을 걸었어요.'),
      unsplash('gelCOOqEM64', 'photo-1551806136-5062b4d5f6a4', 'office', '시계 두 개를 건 벽 앞의 검은 테이블은 작업대로도 써요.'),
    ],
  },
];

// 주거형태 and 평수 come from the home record, so filters and the record never disagree.
export const TOURS = RAW.map((tour) => ({ ...tour, tags: { type: [tour.home.type], size: [sizeBand(tour.home.pyeong)], ...tour.tags } }));

export const tourById = (id) => TOURS.find((tour) => tour.id === id) ?? null;
export const tagLabel = (group, id) => TAG_GROUPS.find((g) => g.id === group)?.tags.find((t) => t.id === id)?.label ?? id;
export const photoURL = (photo, width) => `https://images.unsplash.com/${photo.photo}?w=${width}&q=78&auto=format&fit=crop`;
export const photoPage = (photo) => `https://unsplash.com/photos/${photo.id}`;
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
