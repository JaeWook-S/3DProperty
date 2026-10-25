import { TOURS, TAG_GROUPS, LIGHTING, PLANS, MY_HOME, HOME_TYPES, tourById, tagLabel, matchTours, similarity, isSimilar, homeLine, photoPage } from './tours.js';
import { compareFit, verdictText, keptFor } from './fit.js';
import { CONCEPTS, PALETTES } from '../concepts/catalog.js';
import { FURNITURE } from '../concepts/furniture-spec.js';
import { VARIANTS } from '../walkthrough/variants.js';
import { navigationRooms } from '../walkthrough/minimap-geometry.js';
import { corners } from '../walkthrough/layout.js';
import { HOMES, readHome, saveHome } from '../walkthrough/my-home.js';
import { LOCATION } from '../walkthrough/location.js';
import { element, svg, icon, picture, photo } from './ui.js';
import { createHome } from './home.js';
import { themeHistory, themeCard } from './theme-history.js';
import './theme.css';
import './house-tours.css';

// 집들이: real homes other people styled, with a gallery filtered by tags and by how close a
// home is to 우리 집, a detail page with the home's photos, and its theme brought into 우리 집 —
// previewed in 3D on the viewer's own plan, then applied after a piece-by-piece fit check.
// Also builds the home page (home.js) and the header menu. Uses the studio hooks and the
// concept API; the viewer's own layout is snapshotted and restored around every preview.

const $ = (id) => document.getElementById(id);
const STATS_KEY = 'cortex-tour-stats';
// Complexes with 3D plans. 새로운 집 찾기 searches this list; more complexes and homes
// registered by viewers will join it.
const COMPLEXES = [
  { id: 'acro-river-park', name: '아크로 리버파크', region: '서울 서초구 반포동', address: LOCATION.address, map: LOCATION.map, units: '112A 기본형 · 확장형', keywords: ['아크로', 'acro', '리버파크', '반포', '서초', '서울', '한강'] },
];
const findComplexes = (text) => {
  const query = text.trim().toLowerCase();
  return COMPLEXES.filter((c) => !query || c.keywords.some((k) => k.includes(query) || query.includes(k)) || c.name.includes(query) || c.region.includes(query));
};
// A theme is laid out in full on the expanded plan; the fit check compares 우리 집 against that.
const THEME_PLAN = 'expanded';
const UNIT_BOUNDS = [-0.2, -0.2, 13.8, 10.3];
const params = () => new URLSearchParams(location.search);
const conceptOf = (tour) => CONCEPTS.find((c) => c.id === tour.concept);
const householdLabel = (id) => tagLabel('household', id);
const planShort = (plan) => PLANS[plan].replace('112A ', '');
const dateLabel = (iso) => iso.replaceAll('-', '.');
const STATUS = { same: '그대로', moved: '자리 맞춤', replaced: '바뀜', excluded: '제외' };
const plain = (event) => !(event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1);
// The rooms of the 112A plan a preview can walk, labelled by what the theme makes of them.
const WALK_ROOMS = ['Living front', 'Bedroom west', 'Bedroom center', 'Master bedroom'];

const PLAN_INPUTS = Object.fromEntries(Object.entries(VARIANTS).map(([key, v]) => [key, { variant: key, rooms: navigationRooms(v.info), doors: v.doors }]));
const fits = new Map();
/** The tour's theme, laid out in full, compared with the theme laid out in 우리 집. */
function fitFor(tour, home) {
  const key = `${tour.concept}>${home}`;
  if (!fits.has(key)) fits.set(key, compareFit(conceptOf(tour), PLAN_INPUTS[THEME_PLAN], PLAN_INPUTS[home]));
  return fits.get(key);
}

const PLAN_FILL = {
  rugRound: 'rug', rugRect: 'rug', rugSmall: 'rug', playMat: 'accent', sofa4: 'fabric', sofa3: 'fabric', loveseat: 'fabric', sofaLow: 'fabric',
  armchair: 'fabric', coffeeRound: 'wood', coffeeRect: 'wood', tvConsole: 'white', bookshelf: 'wood', bookshelfWide: 'wood', sideboard: 'wood',
  wardrobe2: 'white', toyShelf: 'white', teepee: 'fabric2', kidsTable: 'white', singleBed: 'bedding', queenBed: 'bedding', loftBed: 'wood',
  crib: 'white', deskSet: 'wood', deskWide: 'wood', deskPro: 'wood', dining6: 'wood', dining4: 'wood', dining2: 'wood', dresser: 'white',
  piano: 'woodDark', plant: 'leaf', floorLamp: 'metal', king: 'fabric2',
};
/** 2D plan with furniture in the tour's colors; `marks` maps placement index → status class. */
function planDrawing(tour, plan, placements, marks = new Map(), label) {
  const colors = { ...PALETTES[tour.palette].colors, leaf: '#6f8c5f' };
  const [x0, z0, x1, z1] = UNIT_BOUNDS;
  const node = svg('svg', { viewBox: `${x0} ${z0} ${x1 - x0} ${z1 - z0}`, class: 'tp-plan', role: 'img', 'aria-label': label });
  for (const room of PLAN_INPUTS[plan].rooms) {
    const [rx0, rz0, rx1, rz1] = room.bounds_m;
    const balcony = room.kind === 'balcony' || room.kind === 'open_balcony';
    node.append(svg('rect', { x: rx0, y: rz0, width: rx1 - rx0, height: rz1 - rz0, class: balcony ? 'pl-balcony' : 'pl-room' }));
  }
  for (const p of [...keptFor(conceptOf(tour)), ...placements]) {
    const flat = FURNITURE[p.kind]?.flat;
    const status = marks.get(p.index) ?? '';
    node.append(svg('polygon', { points: corners(p).map((c) => c.join(',')).join(' '), fill: colors[PLAN_FILL[p.kind] ?? 'wood'] ?? '#bbb', class: `pl-item ${flat ? 'pl-flat' : ''} ${status}` }));
  }
  return node;
}

// Popularity: the catalog's starting value plus this browser's own visits, 3D previews and
// applications. A server will replace the local counts with everyone's.
function readStats() { try { return JSON.parse(localStorage.getItem(STATS_KEY)) ?? {}; } catch { return {}; } }
function count(id, kind) {
  const stats = readStats();
  stats[id] = { views: 0, walks: 0, applies: 0, ...stats[id] };
  stats[id][kind] += 1;
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch { /* storage unavailable */ }
}
function popularity(tour, stats = readStats()) {
  const s = stats[tour.id] ?? {};
  return tour.popularity + (s.views ?? 0) + 3 * (s.walks ?? 0) + 8 * (s.applies ?? 0);
}
const SORTS = { popular: '인기순', recent: '최신순', similar: '우리 집과 비슷한 순' };
/** Tours (or gallery matches with `.tour`) in the chosen order; ties fall back to popularity, then catalog order. */
function rank(list, sort) {
  const stats = readStats();
  const tourOf = (entry) => entry.tour ?? entry;
  const keys = {
    popular: (t) => [popularity(t, stats)],
    recent: (t) => [Date.parse(t.published)],
    similar: (t) => [similarity(t.home).score, popularity(t, stats)],
  }[sort];
  return [...list].sort((a, b) => {
    const ka = keys(tourOf(a)), kb = keys(tourOf(b));
    for (let i = 0; i < ka.length; i++) if (kb[i] !== ka[i]) return kb[i] - ka[i];
    return TOURS.indexOf(tourOf(a)) - TOURS.indexOf(tourOf(b));
  });
}

export function createHouseTours(hooks, concepts) {
  const filters = () => Object.fromEntries(TAG_GROUPS.map((g) => [g.id, null]));
  const state = { view: null, tourId: null, filters: filters(), sort: 'popular', onlySimilar: false, openFilter: null, focus: null, home: readHome(hooks.current()?.key), session: null, busy: false };
  document.addEventListener('cortex:home', (event) => { state.home = event.detail ?? readHome(); });

  // --- header: 우리 집 · 새로운 집 찾기 · 집들이 -----------------------------------------------
  const navTours = element('button', { type: 'button', id: 'nav-tours', onclick: () => show('gallery'), text: '집들이' });
  hooks.ui.querySelector('.studio-header nav')?.append(navTours);
  // Studio navigation closes the tours page.
  hooks.ui.querySelector('.studio-header').addEventListener('click', (event) => {
    if (event.target.closest('#nav-tours,#tour-session,.header-search')) return;
    if (event.target.closest('button,a') && state.view) hide({ push: true });
  }, true);

  // 새로운 집 찾기: search the registered complexes above the building and floor picker.
  const search = element('input', { id: 'find-complex-search', type: 'search', placeholder: '단지명이나 지역으로 찾기', autocomplete: 'off' });
  const results = element('ul', { class: 'find-results' });
  function renderComplexes() {
    const found = findComplexes(search.value);
    results.replaceChildren(...(found.length ? found.map((c) => element('li', {}, element('button', { type: 'button', 'aria-pressed': 'true', onclick: () => $('select-building').click() },
      element('strong', { text: c.name }), element('small', { text: `${c.address} · ${c.units}` })),
      element('a', { class: 'find-map', href: c.map, target: '_blank', rel: 'noopener', text: '지도에서 위치 보기' })))
      : [element('li', { class: 'find-empty', text: `‘${search.value.trim()}’에 맞는 단지가 없어요.` })]));
  }
  search.addEventListener('input', renderComplexes);
  $('unit-picker').prepend(element('section', { class: 'find-complex', 'aria-label': '단지 찾기' },
    element('label', { for: 'find-complex-search', text: '단지 찾기' }), search, results));
  renderComplexes();

  // --- page shell -------------------------------------------------------------------
  const page = element('section', { id: 'tours-page', hidden: true, 'aria-live': 'polite' });
  hooks.ui.append(page);
  const toast = element('div', { id: 'tour-toast', hidden: true, role: 'status' });
  hooks.ui.append(toast);
  const session = element('div', { id: 'tour-session', hidden: true });
  hooks.ui.querySelector('.studio-header').append(session);
  const floatBar = element('div', { id: 'tour-float', hidden: true });
  document.body.append(floatBar);

  function homeSwitch(onPick, label = '우리 집') {
    return element('div', { class: 'tp-home', role: 'radiogroup', 'aria-label': `${label} 평면` },
      element('span', { class: 'tp-home-label', text: label }),
      element('div', { class: 'tp-seg' }, Object.keys(PLANS).map((key) => element('button', {
        type: 'button', role: 'radio', 'aria-checked': String(state.home === key), 'data-home': key,
        onclick: () => { state.home = key; saveHome(key); onPick(); }, text: planShort(key) }))));
  }
  const myHomeLine = () => `${HOMES[state.home].label} · ${homeLine({ ...MY_HOME })}`;

  function card(tour) {
    const near = similarity(tour.home);
    return element('li', {}, element('a', { class: 'tp-card', href: `?studio=1&tours=${tour.id}`, 'data-tour': tour.id, onclick: (event) => {
      if (!plain(event)) return;
      event.preventDefault(); show('detail', tour.id);
    } },
    element('figure', { class: 'tp-cover' }, photo(tour.photos[0], tour.title),
      near.score >= 4 ? element('span', { class: 'tp-near', text: '우리 집과 비슷해요' }) : null),
    element('h3', { text: tour.title }),
    element('p', { class: 'tp-meta', text: `${homeLine(tour.home)} · ${tour.tags.household.map(householdLabel).join(', ')}` }),
    isSimilar(tour.home) ? element('p', { class: 'tp-similar', text: `같은 조건: ${near.same.join(' · ')}` }) : null));
  }

  // Re-rendering replaces the controls; put focus back on the one that was used.
  function keepFocus(render) {
    const active = document.activeElement;
    const key = state.focus ?? (active && page.contains(active) && (active.id ? `#${active.id}`
      : active.dataset.tag ? `.tp-chip[data-group="${active.dataset.group}"][data-tag="${active.dataset.tag}"]`
        : active.dataset.group ? `.tp-filter[data-group="${active.dataset.group}"]`
          : active.dataset.home ? `[data-home="${active.dataset.home}"]`
            : active.dataset.sort ? `[data-sort="${active.dataset.sort}"]` : null));
    state.focus = null;
    render();
    if (key) page.querySelector(key)?.focus({ preventScroll: true });
  }

  // --- gallery ----------------------------------------------------------------------
  // One tag per group (up to six), picked from each group's dropdown; with none picked the
  // gallery lists the most popular first. "우리 집과 비슷한 집" keeps homes close to 우리 집.
  function clearFilters() { state.filters = filters(); }
  function renderGallery() { keepFocus(drawGallery); }
  function pickTag(group, tag) {
    state.filters[group] = tag;
    state.openFilter = null;
    state.focus = `.tp-filter[data-group="${group}"]`;
    renderGallery();
  }
  function filter(group) {
    const picked = state.filters[group.id], open = state.openFilter === group.id;
    return element('div', { class: 'tp-filter-wrap' },
      element('button', { type: 'button', class: `tp-filter${picked ? ' is-set' : ''}`, 'data-group': group.id, 'aria-expanded': String(open), 'aria-controls': `tp-pop-${group.id}`,
        onclick: () => { state.openFilter = open ? null : group.id; renderGallery(); } },
      picked ? tagLabel(group.id, picked) : group.label, icon('down', 16)),
      element('div', { class: 'tp-pop', id: `tp-pop-${group.id}`, role: 'radiogroup', 'aria-label': group.label, hidden: open ? null : true },
        group.tags.map((tag) => {
          const on = picked === tag.id;
          const n = TOURS.filter((tour) => tour.tags[group.id].includes(tag.id)).length;
          return element('button', { type: 'button', class: 'tp-chip', role: 'radio', 'aria-checked': String(on), 'data-group': group.id, 'data-tag': tag.id,
            onclick: () => pickTag(group.id, on ? null : tag.id) },
          tag.color ? element('i', { class: 'tp-dot', style: `background:${tag.color}` }) : null, tag.label, element('small', { text: String(n) }));
        })));
  }
  function drawGallery() {
    const selected = Object.fromEntries(Object.entries(state.filters).filter(([, tag]) => tag).map(([group, tag]) => [group, new Set([tag])]));
    const found = rank(matchTours(selected).filter(({ tour }) => !state.onlySimilar || isSimilar(tour.home)), state.sort);
    const picked = Object.entries(state.filters).filter(([, tag]) => tag);
    const empty = element('div', { class: 'tp-empty' },
      element('strong', { text: '조건에 맞는 집들이가 없어요' }),
      element('p', { text: state.onlySimilar ? '‘우리 집과 비슷한 집’을 끄거나 태그를 하나 줄여 보세요.' : '태그를 하나 줄여 보세요.' }),
      element('button', { type: 'button', class: 'tp-ghost', onclick: () => { clearFilters(); state.onlySimilar = false; renderGallery(); }, text: '조건 모두 지우기' }));
    page.replaceChildren(element('div', { class: 'tp-wrap' },
      element('header', { class: 'tp-head' },
        element('div', {},
          element('h1', { id: 'tours-title', tabindex: '-1', text: '집들이' }),
          element('p', { class: 'tp-lede', text: '다른 집이 꾸민 모습을 보고, 마음에 드는 테마를 우리 집 평면에 맞춰 가져와요.' })),
        element('div', { class: 'tp-mine' }, element('p', {}, '우리 집 ', element('strong', { text: homeLine(MY_HOME) })), homeSwitch(renderGallery))),
      element('div', { class: 'tp-filterbar' },
        TAG_GROUPS.map(filter),
        element('label', { class: `tp-toggle${state.onlySimilar ? ' is-set' : ''}` },
          element('input', { type: 'checkbox', id: 'tours-similar', checked: state.onlySimilar || undefined, onchange: (event) => { state.onlySimilar = event.target.checked; renderGallery(); } }),
          '우리 집과 비슷한 집')),
      picked.length ? element('div', { class: 'tp-selected' },
        picked.map(([group, tag]) => element('button', { type: 'button', class: 'tp-tag', 'aria-label': `${tagLabel(group, tag)} 빼기`, onclick: () => { state.filters[group] = null; renderGallery(); } },
          tagLabel(group, tag), icon('close', 14))),
        element('button', { type: 'button', class: 'tp-reset', onclick: () => { clearFilters(); renderGallery(); }, text: '초기화' })) : null,
      element('div', { class: 'tp-bar' },
        element('p', { class: 'tp-count' }, '전체 ', element('strong', { text: String(found.length) })),
        element('div', { class: 'tp-sort', role: 'radiogroup', 'aria-label': '정렬' }, Object.entries(SORTS).map(([key, label]) => element('button', {
          type: 'button', role: 'radio', 'aria-checked': String(state.sort === key), 'data-sort': key, onclick: () => { state.sort = key; renderGallery(); }, text: label })))),
      found.length ? element('ol', { class: 'tp-grid' }, found.map(({ tour }) => card(tour))) : empty));
  }
  // A click outside the open dropdown, or Escape, closes it.
  page.addEventListener('click', (event) => {
    if (state.view !== 'gallery' || !state.openFilter || event.target.closest('.tp-filter-wrap')) return;
    state.openFilter = null; renderGallery();
  });
  page.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !state.openFilter) return;
    state.focus = `.tp-filter[data-group="${state.openFilter}"]`;
    state.openFilter = null; renderGallery();
  });

  // --- detail -----------------------------------------------------------------------
  function verdictBox(fit) {
    const text = verdictText(fit);
    return element('div', { class: `fit-verdict v-${fit.verdict}` }, element('strong', { text: text.title }), element('p', { text: text.detail }));
  }
  function fitCard(tour) {
    const fit = fitFor(tour, state.home);
    const preview = fit.items.filter((i) => i.status === 'replaced' || i.status === 'excluded').slice(0, 3);
    return element('div', { class: 'fit-card' },
      element('p', { class: 'fit-title', text: '이 테마를 우리 집에' }),
      element('p', { class: 'fit-lede', text: `${conceptOf(tour).title} · ${PALETTES[tour.palette].name}` }),
      homeSwitch(() => renderDetail(tour)),
      verdictBox(fit),
      element('ul', { class: 'fit-counts' }, Object.entries(STATUS).map(([key, label]) => element('li', { class: `c-${key}` }, label, element('b', { text: String(fit.counts[key]) })))),
      preview.length ? element('ul', { class: 'fit-preview' }, preview.map((item) => element('li', { class: `s-${item.status}` },
        element('strong', { text: item.to && item.to.kind !== item.kind ? `${item.title} → ${item.to.title}` : item.title }), element('small', { text: item.reason })))) : null,
      element('button', { type: 'button', class: 'btn btn-primary btn-block', id: 'tour-apply-open', onclick: () => openSheet(tour), text: '우리 집에 적용하기' }),
      element('button', { type: 'button', class: 'btn btn-block', id: 'tour-walk', onclick: () => startTour(tour), text: '우리 집에서 3D로 보기' }));
  }

  function fitLine(tour) {
    const fit = fitFor(tour, state.home), text = verdictText(fit);
    return element('button', { type: 'button', class: `td-fit-line v-${fit.verdict}`, onclick: () => openSheet(tour) },
      element('span', {}, element('small', { text: `이 테마를 우리 집(${planShort(state.home)})에 가져오면` }), element('strong', { text: text.title })),
      icon('right', 18));
  }

  function renderDetail(tour) { keepFocus(() => drawDetail(tour)); }
  function drawDetail(tour) {
    const concept = conceptOf(tour), fit = fitFor(tour, state.home), mine = fit.to;
    const palette = PALETTES[tour.palette];
    const near = similarity(tour.home);
    const byRoom = new Map();
    for (const p of mine.placements) { if (!byRoom.has(p.room)) byRoom.set(p.room, []); byRoom.get(p.room).push(p); }
    const roomName = (room) => concept.rooms[room] ?? PLAN_INPUTS[state.home].rooms.find((r) => r.id === room)?.name_ko ?? room;
    const list = [...byRoom.entries()].map(([room, pieces]) => element('tr', {},
      element('th', { scope: 'row', text: roomName(room) }), element('td', { text: pieces.map((p) => p.title).join(', ') })));
    const photos = tour.photos.map((item, index) => element('figure', { class: 'td-photo' },
      photo(item, `${tour.title} — ${tagLabel('space', item.space)}`, { eager: index === 0, sizes: '(max-width: 1100px) 100vw, 720px' }),
      element('figcaption', {}, element('span', { class: 'td-space', text: tagLabel('space', item.space) }), item.text)));
    const others = rank(TOURS.filter((t) => t.id !== tour.id), 'popular')
      .map((t) => ({ t, shared: Object.keys(t.tags).reduce((n, g) => n + t.tags[g].filter((x) => tour.tags[g].includes(x)).length, 0) }))
      .sort((a, b) => b.shared - a.shared).slice(0, 3).map(({ t }) => card(t));
    const credit = element('a', { href: tour.by.page, target: '_blank', rel: 'noopener', text: tour.by.name });
    page.replaceChildren(element('div', { class: 'td' },
      element('figure', { class: 'td-cover' }, photo(tour.photos[0], tour.title, { eager: true, sizes: '100vw' })),
      element('div', { class: 'td-layout' },
        element('article', { class: 'td-main' },
          element('a', { class: 'tp-back', href: '?studio=1&tours=all', onclick: (event) => { if (!plain(event)) return; event.preventDefault(); show('gallery'); } }, icon('left', 16), '집들이'),
          element('h1', { id: 'tours-title', tabindex: '-1', text: tour.title }),
          element('p', { class: 'td-byline' }, '사진 ', credit, ` · Unsplash · ${dateLabel(tour.published)}`),
          element('div', { class: 'td-info' },
            element('dl', { class: 'td-facts' },
              [['주거형태', HOME_TYPES[tour.home.type]], ['평수', `${tour.home.pyeong}평`], ['방', tour.home.rooms ? `${tour.home.rooms}개` : '원룸'], ['가족', tour.tags.household.map(householdLabel).join(', ')]]
                .map(([k, v]) => element('div', {}, element('dt', { text: k }), element('dd', { text: v })))),
            element('p', { class: 'td-keys' },
              element('span', {}, '스타일 ', element('b', { text: tour.tags.style.map((s) => tagLabel('style', s)).join(', ') })),
              element('span', {}, '컬러 ', element('b', { text: tour.tags.color.map((c) => tagLabel('color', c)).join(', ') })),
              element('span', { class: 'td-near' }, '우리 집과 ', element('b', { text: near.same.length ? `${near.same.join(' · ')} 같아요` : '조건이 달라요' })))),
          fitLine(tour),
          element('p', { class: 'td-summary', text: tour.summary }),
          element('section', { class: 'td-points' }, element('h2', { text: '이 집의 포인트' }),
            element('ul', {}, tour.points.map((point) => element('li', { text: point })))),
          element('section', { class: 'td-photos' }, element('h2', { text: '집 구경' }), photos),
          element('section', { class: 'td-theme', id: 'td-theme' },
            element('h2', { text: '이 테마를 우리 집에' }),
            element('p', { class: 'td-theme-lede', text: `이 집의 분위기를 ${concept.title} 배치와 ${palette.name} 색감으로 우리 집(${PLANS[state.home]}) 평면에 다시 꾸몄어요. 방 크기가 달라 바뀌는 가구는 오른쪽에서 확인할 수 있어요.` }),
            element('div', { class: 'td-overview-grid' },
              element('figure', {}, picture(tour, `${state.home}-living`, `우리 집 거실에 적용한 모습 (${planShort(state.home)})`), element('figcaption', { text: `우리 집 거실 · ${planShort(state.home)} · CORTEX 3D` })),
              element('figure', {}, picture(tour, `${state.home}-overview`, `우리 집 전체에 적용한 모습 (${planShort(state.home)})`), element('figcaption', { text: '천장을 걷어낸 3D 단면' }))),
            element('div', { class: 'td-theme-actions' },
              element('button', { type: 'button', class: 'btn btn-primary', onclick: () => startTour(tour), text: '우리 집에서 3D로 보기' }),
              element('button', { type: 'button', class: 'btn', onclick: () => openSheet(tour), text: '바뀌는 가구 보기' })),
            element('div', { class: 'td-palette' },
              element('div', { class: 'td-swatches' }, ['fabric', 'fabric2', 'wood', 'accent', 'rug', 'white'].map((slot) => element('i', { style: `background:${palette.colors[slot]}` }))),
              element('p', {}, element('strong', { text: palette.name }), ` — ${palette.note}`)),
            element('figure', { class: 'td-plan' }, planDrawing(tour, state.home, mine.placements, new Map(), `우리 집 평면에 놓은 가구`), element('figcaption', { text: `평면 배치 · ${PLANS[state.home]}` })),
            element('table', { class: 'td-list' }, element('tbody', {}, list))),
          element('section', { class: 'td-more' }, element('h2', { text: '비슷한 집들이' }), element('ol', { class: 'tp-grid small' }, others))),
        element('aside', { class: 'td-aside' }, fitCard(tour))),
      element('div', { class: 'td-mobile-bar' },
        element('button', { type: 'button', class: 'btn', onclick: () => startTour(tour), text: '3D로 보기' }),
        element('button', { type: 'button', class: 'btn btn-primary', onclick: () => openSheet(tour), text: '우리 집에 적용' }))));
  }

  // --- apply sheet ------------------------------------------------------------------
  const sheet = element('dialog', { id: 'tour-apply', class: 'tp-sheet', 'aria-labelledby': 'tour-apply-title' });
  document.body.append(sheet);
  sheet.addEventListener('click', (event) => { if (event.target === sheet) sheet.close(); });
  function openSheet(tour) {
    renderSheet(tour);
    if (!sheet.open) sheet.showModal();
  }
  function renderSheet(tour) {
    const fit = fitFor(tour, state.home);
    const sourceMarks = new Map(fit.items.filter((i) => i.status === 'excluded').map((i) => [i.index, 'pl-excluded']));
    const targetMarks = new Map(fit.items.filter((i) => i.status === 'moved' || i.status === 'replaced').map((i) => [i.index, `pl-${i.status}`]));
    const groups = fit.rooms.map((room) => ({ ...room, changes: room.items.filter((i) => i.status !== 'same') })).filter((room) => room.changes.length);
    const same = fit.items.filter((i) => i.status === 'same');
    const full = state.home === THEME_PLAN;
    sheet.replaceChildren(element('div', { class: 'tp-sheet-body' },
      element('header', { class: 'tp-sheet-head' },
        element('div', {}, element('p', { class: 'tp-sheet-label', text: '우리 집에 적용하기' }), element('h2', { id: 'tour-apply-title', text: `${conceptOf(tour).title} · ${PALETTES[tour.palette].name}` })),
        element('button', { type: 'button', class: 'tp-close', 'aria-label': '닫기', onclick: () => sheet.close() }, icon('close', 18))),
      homeSwitch(() => renderSheet(tour)),
      verdictBox(fit),
      element('div', { class: 'tp-compare' },
        element('figure', {}, planDrawing(tour, THEME_PLAN, fit.from.placements, sourceMarks, '테마 기본 배치'), element('figcaption', { text: `테마 기본 배치 · ${planShort(THEME_PLAN)}` })),
        element('figure', {}, planDrawing(tour, state.home, fit.to.placements, targetMarks, '우리 집에 맞춘 평면'), element('figcaption', { text: `우리 집 · ${planShort(state.home)}` }))),
      element('ul', { class: 'tp-legend', 'aria-label': '평면 표시' },
        element('li', { class: 'l-moved', text: '자리 맞춤' }), element('li', { class: 'l-replaced', text: '바뀜' }), element('li', { class: 'l-excluded', text: '가져갈 수 없음' })),
      groups.length ? element('section', { class: 'tp-changes' }, element('h3', { text: '바뀌는 점' }), groups.map((room) => element('div', { class: 'tp-change-room' },
        element('p', { class: 'tp-change-head' }, element('strong', { text: room.name }), room.change ? element('span', { text: room.change }) : null),
        element('ul', {}, room.changes.map((item) => element('li', { class: `s-${item.status}` },
          element('span', { class: 'tp-change-text' },
            element('strong', { text: item.to && item.to.kind !== item.kind ? `${item.title} → ${item.to.title}` : item.title }),
            element('small', { text: item.short ?? item.reason })),
          element('em', { text: item.decor && item.status === 'excluded' ? '소품' : STATUS[item.status] }))))))) : null,
      same.length ? element('details', { class: 'tp-same' }, element('summary', { text: `${full ? '모든' : '그대로 가져가는'} 가구 ${same.length}개` }),
        element('p', { text: same.map((i) => i.title).join(', ') })) : null,
      element('p', { class: 'tp-warning', text: '지금 우리 집 배치가 이 테마로 바뀌어요. 적용한 뒤 알림의 ‘되돌리기’로 원래 배치로 돌아갈 수 있어요.' }),
      element('footer', { class: 'tp-sheet-foot' },
        element('button', { type: 'button', class: 'btn', onclick: () => sheet.close(), text: '취소' }),
        element('button', { type: 'button', class: 'btn btn-primary', id: 'tour-apply-confirm', onclick: () => applyToHome(tour, state.home), text: `우리 집(${planShort(state.home)})에 적용하기` }))));
  }

  // --- routing ----------------------------------------------------------------------
  function writeRoute(view, tourId, push) {
    const url = new URL(location.href);
    if (view === 'gallery') url.searchParams.set('tours', 'all');
    else if (view === 'detail') url.searchParams.set('tours', tourId);
    else url.searchParams.delete('tours');
    if (url.href !== location.href) history[push ? 'pushState' : 'replaceState']({ tours: view }, '', url);
  }
  async function show(view, tourId = null, { push = true } = {}) {
    if (state.session) await endTour({ route: false });
    if (sheet.open) sheet.close();
    if (hooks.mode === 'tour') hooks.setMode('overview');
    state.view = view; state.tourId = tourId; state.openFilter = null;
    page.hidden = false;
    document.body.dataset.tours = view;
    if (view === 'detail') { renderDetail(tourById(tourId)); if (push) count(tourId, 'views'); } else renderGallery();
    page.scrollTop = 0;
    writeRoute(view, tourId, push);
    page.querySelector('#tours-title')?.focus({ preventScroll: true });
  }
  function hide({ push = false } = {}) {
    if (!state.view) return;
    state.view = null; state.tourId = null;
    page.hidden = true;
    delete document.body.dataset.tours;
    writeRoute(null, null, push);
  }
  function syncFromURL() {
    const value = params().get('tours');
    if (value === 'all') show('gallery', null, { push: false });
    else if (tourById(value)) show('detail', value, { push: false });
    else hide();
  }
  window.addEventListener('popstate', syncFromURL);

  // --- previewing a theme in 우리 집, in 3D ------------------------------------------------
  const VIEWS = {
    // From the window corner across the sofa toward the kitchen and dining table.
    'Living front': ([x1, z1, x2, z2]) => [[x1 + 0.45, z2 - 0.42, x2 - 0.7, z1 - 0.2], [x1 + 0.85, z1 + 0.45, x2 - 0.6, (z1 + z2) / 2 + 0.6]],
    // Small rooms: from the window side toward the door, else from the door toward the window.
    'Bedroom west': ([x1, z1, x2, z2]) => [[x1 + 0.9, z2 - 0.36, x2 - 0.17, z1 + 0.27], [x2 - 0.5, z1 + 0.55, x1 + 0.5, z2 - 0.35]],
    'Bedroom center': ([x1, z1, x2, z2]) => [[x2 - 0.46, z1 + 0.77, x1 + 0.1, z2 - 0.2], [x1 + 0.6, z2 - 0.3, x2 - 0.3, z1 + 0.3]],
    'Master bedroom': ([x1, z1, x2, z2]) => [[x1 + 0.36, z1 + 0.31, x2 - 0.53, z2 - 0.31], [x2 - 0.48, z2 - 0.41, x1 + 0.51, z1 + 0.41]],
  };
  // `view` ([x, z, targetX, targetZ, drop] as room fractions) tries a spot first; used while tuning renders.
  function walkRoom(roomId, view = null, drop = 0.5) {
    hooks.selectRoom(roomId);
    $('room-walk').click();
    const room = hooks.rooms().find((r) => r.id === roomId);
    const [x1, z1, x2, z2] = room.bounds_m;
    const views = [view && [x1 + view[0] * (x2 - x1), z1 + view[1] * (z2 - z1), x1 + view[2] * (x2 - x1), z1 + view[3] * (z2 - z1), view[4] ?? drop],
      ...(VIEWS[roomId]?.(room.bounds_m) ?? []).map((v) => [...v, drop])];
    for (const spot of views.filter(Boolean)) if (hooks.standAt(...spot)) return true;
    return false;
  }
  function setLighting(value) {
    const select = $('lighting');
    if (!select || !value || select.value === value) return;
    select.value = value;
    select.dispatchEvent(new Event('change'));
  }
  async function stage(tour, plan = state.home) {
    const prev = { variant: hooks.current().key, mode: hooks.mode, lighting: $('lighting')?.value };
    if (!(await hooks.loadVariant(plan))) return null;
    const snap = concepts.snapshot();
    concepts.apply(tour.concept, tour.palette, { url: false, frame: false });
    setLighting(tour.lighting);
    return { tour, prev, snap };
  }
  async function startTour(tour, roomId = 'Living front') {
    if (state.busy) return;
    state.busy = true;
    try {
      if (state.session) await endTour({ route: false });
      if (sheet.open) sheet.close();
      const staged = await stage(tour);
      if (!staged) { hooks.status('우리 집 평면을 불러오지 못했어요.'); return; }
      state.session = staged;
      count(tour.id, 'walks');
      document.body.dataset.houseTour = tour.id;
      hide({ push: false });
      walkRoom(roomId);
      renderSession();
    } finally { state.busy = false; }
  }
  async function endTour({ route = true, keepMode = false } = {}) {
    const current = state.session;
    if (!current) return;
    state.session = null;
    delete document.body.dataset.houseTour;
    session.hidden = floatBar.hidden = true;
    if (!keepMode) hooks.setMode(current.prev.mode === 'tour' ? 'overview' : current.prev.mode);
    concepts.restore(current.snap, { url: false });
    setLighting(current.prev.lighting);
    if (current.prev.variant !== hooks.current().key) await hooks.loadVariant(current.prev.variant);
    if (route) show('detail', current.tour.id, { push: false });
  }
  function renderSession() {
    const { tour } = state.session;
    const concept = conceptOf(tour);
    const rooms = WALK_ROOMS.map((room) => element('button', { type: 'button', class: 'ts-room', onclick: () => walkRoom(room), text: concept.rooms[room] ?? room }));
    session.replaceChildren(
      element('span', { class: 'ts-label' }, element('i', { text: '미리보기' }), concept.short),
      element('div', { class: 'ts-rooms' }, rooms),
      element('button', { type: 'button', class: 'ts-apply', onclick: () => openSheet(tour), text: '우리 집에 적용' }),
      element('button', { type: 'button', class: 'ts-exit', onclick: () => endTour(), text: '나가기' }));
    floatBar.replaceChildren(
      element('button', { type: 'button', class: 'tf-exit', 'aria-label': '집들이로 돌아가기', onclick: () => endTour() }, icon('left', 16), '집들이'),
      element('button', { type: 'button', class: 'tf-apply', onclick: () => openSheet(tour), text: '우리 집에 적용' }));
    session.hidden = floatBar.hidden = false;
  }

  // --- applying to the viewer's home --------------------------------------------------
  // Opens the plan, applies the theme and saves the plan as 우리 집; `done(before)` gets the
  // layout from before for 되돌리기.
  async function applyTheme({ concept, palette, plan, tour = null }, done) {
    if (state.busy) return;
    state.busy = true;
    try {
      if (sheet.open) sheet.close();
      if (state.session) await endTour({ route: false });
      hide({ push: true });
      if (!(await hooks.loadVariant(plan))) { hooks.status('우리 집 평면을 불러오지 못했어요.'); return; }
      const before = concepts.snapshot();
      hooks.setMode('overview');
      concepts.apply(concept, palette, { tour });
      saveHome(plan);
      done(before);
    } finally { state.busy = false; }
  }
  function applyToHome(tour, home) {
    return applyTheme({ concept: tour.concept, palette: tour.palette, plan: home, tour: tour.id }, (before) => {
      const fit = fitFor(tour, home);
      const changed = fit.counts.replaced + fit.counts.excluded;
      count(tour.id, 'applies');
      showToast(`우리 집(${planShort(home)})에 적용했어요`,
        `${conceptOf(tour).short} · ${changed ? `${changed}개 바뀜 · ` : ''}${fit.counts.moved ? `${fit.counts.moved}개 자리 맞춤` : '배치 그대로'}`, before);
    });
  }
  // 최근 적용한 테마 → 다시 적용, with the colors it had.
  function reapply(entry) {
    return applyTheme(entry, (before) => {
      const tour = entry.tour && tourById(entry.tour);
      showToast(`우리 집(${planShort(entry.plan)})에 다시 적용했어요`,
        `${tour ? tour.title : CONCEPTS.find((c) => c.id === entry.concept).title} · ${PALETTES[entry.palette].name}`, before);
    });
  }
  let toastTimer;
  function showToast(title, detail, before) {
    toast.replaceChildren(
      element('div', { class: 'tt-text' }, element('strong', { text: title }), element('small', { text: detail })),
      element('button', { type: 'button', class: 'tt-walk', onclick: () => { closeToast(); hooks.selectRoom('Living front'); $('room-walk').click(); }, text: '걸어보기' }),
      element('button', { type: 'button', class: 'tt-undo', onclick: () => { concepts.restore(before); hooks.setMode('overview'); closeToast(); renderHistory(); hooks.status('적용 전 배치로 되돌렸어요.'); }, text: '되돌리기' }),
      element('button', { type: 'button', class: 'tt-close', 'aria-label': '알림 닫기', onclick: closeToast }, icon('close', 16)));
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(closeToast, 12000);
  }
  function closeToast() { toast.hidden = true; clearTimeout(toastTimer); }

  // --- 최근 적용한 테마 in the 우리 집 sidebar ----------------------------------------------------
  const isCurrent = (entry) => {
    const applied = concepts.applied(entry.plan);
    return Boolean(applied) && applied.concept === entry.concept && applied.palette === entry.palette && (applied.tour ?? null) === (entry.tour ?? null);
  };
  const historyCards = (list) => element('ol', { class: 'th-list' }, list.map((entry) => themeCard(entry, { current: isCurrent(entry), onApply: reapply })));
  const themesPanel = element('section', { id: 'theme-history', class: 'theme-history', hidden: true, 'aria-labelledby': 'theme-history-title' });
  $('room-picker').after(themesPanel);
  let historyOpen = false;
  function renderHistory() {
    const list = themeHistory();
    themesPanel.hidden = !list.length || hooks.mode !== 'overview';
    if (themesPanel.hidden) return;
    const more = list.length > 3;
    themesPanel.replaceChildren(...[
      element('h2', { id: 'theme-history-title', text: '최근 적용한 테마' }),
      historyCards(historyOpen ? list : list.slice(0, 3)),
      more && element('button', { type: 'button', class: 'th-more', 'aria-expanded': String(historyOpen), onclick: () => { historyOpen = !historyOpen; renderHistory(); }, text: historyOpen ? '접기' : `${list.length - 3}개 더 보기` }),
    ].filter(Boolean));
  }
  document.addEventListener('cortex:themes', renderHistory);

  // --- home page ----------------------------------------------------------------------
  createHome({ hooks, concepts, tours: {
    card, complexes: COMPLEXES, findComplexes, myHomeLine,
    byPopularity: () => rank(TOURS, 'popular'),
    byRecent: () => rank(TOURS, 'recent'),
    themes: themeHistory, historyCards,
    bySimilarity: () => rank(TOURS.filter((tour) => isSimilar(tour.home)), 'similar'),
    openDetail: (id) => show('detail', id),
    openGallery({ group, tag, sort = 'popular', similar = false } = {}) {
      clearFilters();
      if (group) state.filters[group] = tag;
      state.sort = sort; state.onlySimilar = similar;
      show('gallery');
    },
  } });

  if (import.meta.env.DEV && params().has('test')) {
    window.__tours = {
      show, hide, startTour: (id, room) => startTour(tourById(id), room), endTour, applyToHome: (id, home) => applyToHome(tourById(id), home),
      reapply: (index) => reapply(themeHistory()[index]),
      fit: (id, home) => { const f = fitFor(tourById(id), home); return { verdict: f.verdict, counts: f.counts, changed: f.changed, blocking: f.blocking }; },
      state: () => ({ view: state.view, tourId: state.tourId, home: state.home, filters: { ...state.filters }, sort: state.sort, session: state.session?.tour.id ?? null }),
      // Render support (tools/house-tours/render-tours.mjs): stage a theme on a plan without walking, then look.
      stage: async (id, plan) => { const staged = await stage(tourById(id), plan); state.session = staged; return Boolean(staged); },
      stageConcept: async (concept, palette, plan) => { const staged = await stage({ concept, palette, lighting: 'day' }, plan); state.session = staged; return Boolean(staged); },
      // Renders look level from a lower eye, like an interior photo.
      look: (roomId, view) => walkRoom(roomId, view, 0.12),
      overview: () => { setLighting('day'); hooks.setMode('overview'); requestAnimationFrame(() => requestAnimationFrame(() => hooks.frame([2.8, 1.0, 10.8, 9.0], false))); },
    };
  }

  // Deep links (?tours=all, ?tours=<id>) open after the studio finishes its first render.
  if (params().get('tours')) queueMicrotask(syncFromURL);

  return {
    onMode(mode) {
      renderHistory();
      // Leaving the preview through the studio's own navigation ends it cleanly.
      if (state.session && mode !== 'tour' && mode !== 'overview') queueMicrotask(() => endTour({ route: false, keepMode: true }));
    },
  };
}
