import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TOURS, TAG_GROUPS, MY_HOME, matchTours, similarity, isSimilar, sizeBand, homeLine } from '../src/house-tours/tours.js';
import { compareFit, verdictText, josa, roomChange, fitsAsIs } from '../src/house-tours/fit.js';
import { CONCEPTS, PALETTES } from '../src/concepts/catalog.js';
import { navigationRooms } from '../src/walkthrough/minimap-geometry.js';
import { readThemes, rememberTheme, THEMES_KEPT } from '../src/walkthrough/my-home.js';

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const PLANS = {
  expanded: { variant: 'expanded', rooms: navigationRooms(json('../src/walkthrough/model-info.json')), doors: json('../src/walkthrough/doors.json') },
  basic: { variant: 'basic', rooms: navigationRooms(json('../src/walkthrough/basic-info.json')), doors: json('../src/walkthrough/basic-doors.json') },
};
const concept = (id) => CONCEPTS.find((c) => c.id === id);
const known = (group, tag) => TAG_GROUPS.find((g) => g.id === group)?.tags.some((t) => t.id === tag);

test('every 집들이 is a real home: credited photos of known spaces, a home record and a theme CORTEX can lay out', () => {
  const ids = new Set(), photos = new Set();
  for (const tour of TOURS) {
    assert.ok(!ids.has(tour.id), tour.id); ids.add(tour.id);
    assert.ok(concept(tour.concept), tour.concept);
    assert.ok(concept(tour.concept).palettes.includes(tour.palette), `${tour.id}: palette ${tour.palette}`);
    assert.ok(PALETTES[tour.palette]);
    assert.equal(tour.points.length, 3);
    assert.ok(tour.by.name && tour.by.page.startsWith('https://unsplash.com/@'), tour.id);
    assert.ok(tour.photos.length >= 3, `${tour.id}: at least a cover and two rooms`);
    for (const item of tour.photos) {
      assert.match(item.photo, /^photo-\d{10,13}-[0-9a-f]{12}$/, `${tour.id}: ${item.photo}`);
      assert.ok(!photos.has(item.photo), `${item.photo} is used twice`); photos.add(item.photo);
      assert.ok(known('space', item.space), `${tour.id}: ${item.space}`);
      assert.ok(item.text.length > 10);
    }
    assert.ok(['apartment', 'villa', 'officetel'].includes(tour.home.type));
    assert.ok(tour.home.pyeong >= 8 && tour.home.pyeong <= 80 && tour.home.rooms >= 0);
    // 주거형태 and 평수 tags come from the home record.
    assert.deepEqual(tour.tags.type, [tour.home.type]);
    assert.deepEqual(tour.tags.size, [sizeBand(tour.home.pyeong)]);
    for (const [group, tags] of Object.entries(tour.tags)) for (const tag of tags) assert.ok(known(group, tag), `${tour.id}: ${group}:${tag}`);
    // The cover's space and every photographed space are in the tour's 공간 tags.
    for (const item of tour.photos) assert.ok(tour.tags.space.includes(item.space), `${tour.id}: ${item.space} photo without the tag`);
  }
  assert.equal(homeLine({ type: 'apartment', pyeong: 33, rooms: 3 }), '아파트 · 33평 · 방 3');
  assert.equal(homeLine({ type: 'officetel', pyeong: 12, rooms: 0 }), '오피스텔 · 12평 · 원룸');
  assert.equal(homeLine({ type: 'apartment', pyeong: 21, rooms: 1 }), '아파트 · 21평 · 방 1');
});

test('tags filter with AND across groups and OR within a group, most matches first', () => {
  assert.equal(matchTours({}).length, TOURS.length);
  const villas = matchTours({ type: new Set(['villa']) }).map((m) => m.tour.id);
  assert.deepEqual(villas.sort(), ['cat-gray', 'pink-small', 'plant-jungle', 'terrazzo-red']);
  const couple = matchTours({ household: new Set(['couple']) }).map((m) => m.tour.id);
  assert.ok(couple.includes('hotel-condo') && couple.includes('golden-dog') && !couple.includes('pink-nursery'));
  const both = matchTours({ household: new Set(['couple']), style: new Set(['minimal']) }).map((m) => m.tour.id);
  assert.deepEqual(both, ['mountain-white', 'hotel-condo', 'gray-orange', 'green-marble']);
  assert.deepEqual(matchTours({ household: new Set(['baby']), color: new Set(['black']) }), []);
  assert.deepEqual(matchTours({ type: new Set(['villa']), size: new Set(['40s']) }), []);
  const ranked = matchTours({ space: new Set(['dining', 'storage']) });
  assert.equal(ranked[0].matched.length, 2);
});

test('homes like 우리 집 are found by 주거형태, 평수 and rooms', () => {
  assert.deepEqual(MY_HOME, { type: 'apartment', pyeong: 34, rooms: 3 });
  const same = similarity({ type: 'apartment', pyeong: 33, rooms: 3 });
  assert.equal(same.score, 5);
  assert.deepEqual(same.same, ['아파트', '30평대', '방 3']);
  assert.equal(similarity({ type: 'apartment', pyeong: 45, rooms: 4 }).score, 3); // next band up
  assert.equal(similarity({ type: 'villa', pyeong: 15, rooms: 1 }).score, 0);
  const near = TOURS.filter((t) => isSimilar(t.home)).map((t) => t.id);
  assert.deepEqual(near.sort(), ['golden-dog', 'gray-orange', 'green-marble', 'hotel-condo', 'mountain-white', 'olive-piano', 'pink-nursery', 'river-view']);
  // A different home changes the answer.
  assert.equal(isSimilar(TOURS.find((t) => t.id === 'oak-officetel').home, { type: 'officetel', pyeong: 14, rooms: 0 }), true);
});

test('a theme laid out in full on the expanded plan carries over unchanged there', () => {
  for (const id of new Set(TOURS.map((t) => t.concept))) {
    const fit = compareFit(concept(id), PLANS.expanded, PLANS.expanded);
    assert.equal(fit.verdict, 'same', id);
    assert.ok(fit.items.length > 5);
    assert.ok(fit.items.every((i) => i.status === 'same'));
    assert.equal(verdictText(fit).badge, '우리 집에 그대로');
  }
});

test('moving a theme to the basic plan explains every change with the room size or the plan note', () => {
  const fit = compareFit(concept('family-lounge'), PLANS.expanded, PLANS.basic);
  assert.notEqual(fit.verdict, 'same');
  const dining = fit.items.find((i) => i.kind === 'dining6');
  assert.equal(dining.status, 'replaced');
  assert.equal(dining.to.kind, 'dining2');
  assert.match(dining.reason, /2인 식탁/);
  const sofa = fit.items.find((i) => i.kind === 'sofa4');
  assert.equal(sofa.status, 'replaced'); // 2.6 m sofa does not fit the 2.28 m basic living room
  assert.match(sofa.reason, /세로 3\.63m → 2\.28m/);
  for (const item of fit.items.filter((i) => i.status !== 'same')) assert.ok(item.reason && item.short, `${item.kind} needs a reason`);
  const living = fit.rooms.find((r) => r.id === 'Living front');
  assert.equal(living.change, '세로 3.63m → 2.28m');
  // Going the other way only gains space; the basic plan's 2-seat table becomes the concept's 4-seat one.
  const reverse = compareFit(concept('kids-play'), PLANS.basic, PLANS.expanded);
  assert.equal(reverse.blocking, 0);
  const table = reverse.items.find((i) => i.kind === 'dining2');
  assert.equal(table.to.kind, 'dining4');
  assert.match(table.reason, /원래 구성인 4인 식탁이 들어가요/);
});

test('pieces that cannot come along are excluded with a reason, and decor never blocks', () => {
  for (const id of new Set(TOURS.map((t) => t.concept))) {
    const fit = compareFit(concept(id), PLANS.expanded, PLANS.basic);
    for (const item of fit.items.filter((i) => i.status === 'excluded')) {
      assert.ok(item.reason.length > 10, `${id}: ${item.kind}`);
      if (item.decor) assert.match(item.reason, /소품/);
    }
    assert.equal(fit.blocking, fit.items.filter((i) => i.status === 'excluded' && !i.decor).length);
    assert.ok(['same', 'fitted', 'adjusted', 'partial'].includes(fit.verdict));
    assert.equal(fitsAsIs(fit), fit.changed === 0 && fit.blocking === 0);
  }
  const piano = compareFit(concept('music-library'), PLANS.expanded, PLANS.basic);
  const chair = piano.items.find((i) => i.kind === 'armchair' && i.room === 'Bedroom center');
  assert.equal(chair.status, 'excluded'); // the 2.59 m basic room has no 60 cm left beside the piano
  assert.match(chair.reason, /세로 3\.08m → 2\.59m/);
});

test('themes applied to 우리 집 are kept newest first, one per concept, plan and 집들이', () => {
  const store = new Map();
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) } });
  globalThis.document = new EventTarget();
  let events = 0;
  document.addEventListener('cortex:themes', () => { events += 1; });
  try {
    rememberTheme({ concept: 'hotel-minimal', palette: 'greige-terracotta', plan: 'expanded', tour: 'hotel-condo' });
    rememberTheme({ concept: 'hotel-minimal', palette: 'greige-terracotta', plan: 'expanded' }); // the concept on its own
    rememberTheme({ concept: 'hotel-minimal', palette: 'ivory-charcoal', plan: 'expanded', tour: 'hotel-condo' }); // new colors
    rememberTheme({ concept: 'kids-play', palette: 'cream-pastel', plan: 'basic' });
    rememberTheme({ concept: 'kids-play', palette: 'cream-pastel', plan: 'penthouse' }); // not a plan of 우리 집
    assert.deepEqual(readThemes().map((e) => [e.concept, e.palette, e.plan, e.tour]), [
      ['kids-play', 'cream-pastel', 'basic', null],
      ['hotel-minimal', 'ivory-charcoal', 'expanded', 'hotel-condo'],
      ['hotel-minimal', 'greige-terracotta', 'expanded', null],
    ]);
    assert.equal(events, 4);
    for (let i = 0; i < 20; i++) rememberTheme({ concept: `concept-${i}`, palette: 'oat-oak', plan: 'expanded' });
    assert.equal(readThemes().length, THEMES_KEPT);
    assert.equal(readThemes()[0].concept, 'concept-19');
    store.set('cortex-theme-history', '{broken');
    assert.deepEqual(readThemes(), []);
  } finally {
    delete globalThis.document;
    if (storage) Object.defineProperty(globalThis, 'localStorage', storage); else delete globalThis.localStorage;
  }
});

test('Korean particles follow the final consonant', () => {
  assert.equal(josa('거실', '이', '가'), '거실이');
  assert.equal(josa('드레스룸', '이', '가'), '드레스룸이');
  assert.equal(josa('다이닝', '이', '가'), '다이닝이');
  assert.equal(josa('게스트룸', '으로', '로'), '게스트룸으로');
  assert.equal(josa('3인 소파', '으로', '로'), '3인 소파로');
  assert.equal(josa('2인 식탁', '으로', '로'), '2인 식탁으로');
  assert.equal(josa('아이 방', '이', '가'), '아이 방이');
  assert.equal(roomChange(PLANS.expanded.rooms[0], PLANS.expanded.rooms[0]), null);
});
