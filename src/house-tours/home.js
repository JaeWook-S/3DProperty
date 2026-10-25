// The home page (the first screen at `/`): a featured 집들이 carousel, 우리 집 and 새로운 집 찾기
// beside it, shortcuts, the themes recently applied to 우리 집, then homes like 우리 집, recent 집들이, spaces and styles (photos from
// the 집들이) that open the matching 집들이, and the registered complexes. It reuses the studio's
// #location-hero (shown in complex mode before a building is picked) and keeps the studio's
// complex photo and #hero-building button. Also adds the header search.
import { TOURS, TAG_GROUPS, HOME_TYPES, MY_HOME, tagLabel, photoURL, homeLine } from './tours.js';
import { HOMES, readHome } from '../walkthrough/my-home.js';
import { VARIANTS } from '../walkthrough/variants.js';
import { navigationRooms } from '../walkthrough/minimap-geometry.js';
import { LOCATION } from '../walkthrough/location.js';
import { CONCEPTS, PALETTES } from '../concepts/catalog.js';
import { element, svg, icon, homeImage, photo as tourPhoto } from './ui.js';
import './home.css';

const $ = (id) => document.getElementById(id);
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const plain = (event) => !(event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1);
const countBy = (group, tag) => TOURS.filter((tour) => tour.tags[group].includes(tag)).length;
// Six spaces on the home page; the gallery's 공간 filter lists them all.
const HOME_SPACES = ['living', 'bedroom', 'kids', 'office', 'pet', 'storage'];
// Shortcut icons, 24px grid; the last path of each is drawn in the brand color.
const QUICK_ICONS = {
  home: ['M3.5 11 12 4l8.5 7', 'M5.5 9.5V19a1 1 0 0 0 1 1H10v-5.5h4V20h3.5a1 1 0 0 0 1-1V9.5', 'M10 20v-5.5h4V20'],
  find: ['M4 20.5V5.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1V9M3 20.5h8M7 8h3M7 11.5h3M7 15h2', 'M16 11.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM18.6 17.6 21 20'],
  tours: ['M7.5 4.5h11a1 1 0 0 1 1 1V15', 'M4.5 7.5h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z', 'M7 16.5v-3l3-2.5 3 2.5v3'],
  walk: ['M12 3.5 19.5 7.75v8.5L12 20.5l-7.5-4.25v-8.5z', 'M4.5 7.75 12 12l7.5-4.25M12 12v8.5'],
  edit: ['M6 11V8.5A2.5 2.5 0 0 1 8.5 6h7A2.5 2.5 0 0 1 18 8.5V11M6 18v1.5M18 18v1.5', 'M3.5 12.5a1.5 1.5 0 0 1 3 0V15h11v-2.5a1.5 1.5 0 0 1 3 0V18h-17z'],
  concepts: ['M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6z', 'M16.5 13.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6z'],
};
function quickIcon(name) {
  const node = svg('svg', { viewBox: '0 0 24 24', width: 28, height: 28, 'aria-hidden': 'true' });
  QUICK_ICONS[name].forEach((d, i, all) => node.append(svg('path', { d, fill: 'none', stroke: i === all.length - 1 ? 'var(--brand)' : 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })));
  return node;
}

// "방 3 · 욕실 2 · 거실 15.3㎡" from the plan's rooms.
function planFacts(plan) {
  const rooms = navigationRooms(VARIANTS[plan].info).filter((r) => r.kind === 'interior');
  const beds = rooms.filter((r) => /방$|방 \d$/.test(r.name_ko)).length;
  const baths = rooms.filter((r) => r.name_ko.includes('욕실')).length;
  const living = rooms.find((r) => r.name_ko === '거실');
  return `방 ${beds} · 욕실 ${baths}${living?.area_m2 ? ` · 거실 ${living.area_m2.toFixed(1)}㎡` : ''}`;
}

/**
 * tours: { card(tour), byPopularity(), byRecent(), bySimilarity(), themes(), historyCards(entries),
 * openGallery({ group, tag, sort, similar }), openDetail(id), complexes, findComplexes(query) } from house-tours.js.
 */
export function createHome({ hooks, concepts, tours }) {
  const hero = $('location-hero');
  const photo = hero.querySelector('img'), credit = hero.querySelector('.photo-credit'), photoError = $('photo-error'), findButton = $('hero-building');
  hero.querySelector('.location-caption')?.remove();
  hero.classList.add('has-home');
  photo.classList.add('official-photo');
  photo.alt = `${LOCATION.name} 단지 전경 (ACRO 공식 사진)`;
  credit.textContent = '사진: ACRO 공식 소개';
  findButton.textContent = '동·층 골라 보기';
  findButton.className = 'btn btn-primary';

  const goHome = () => hooks.goHome();
  async function homeThen(action) { await hooks.goHome(); action(); }
  const walkHome = () => homeThen(() => { hooks.selectRoom('Living front'); $('room-walk').click(); });
  const editHome = () => homeThen(() => $('mode-edit')?.click());
  const conceptsHome = () => homeThen(() => $('mode-concepts')?.click());

  // --- featured 집들이 -------------------------------------------------------------------
  let slideTimer = null;
  function feature() {
    const list = tours.byPopularity().slice(0, 4);
    let index = 0, paused = false;
    const counter = element('span', { class: 'hf-count', 'aria-live': 'off' });
    const slides = list.map((tour, i) => element('li', { class: 'hf-slide', 'data-tour': tour.id, 'aria-roledescription': '슬라이드', 'aria-label': `${i + 1}/${list.length}` },
      element('a', { href: `?studio=1&tours=${tour.id}`, onclick: (event) => { if (!plain(event)) return; event.preventDefault(); tours.openDetail(tour.id); } },
        tourPhoto(tour.photos[0], tour.title, { eager: i === 0, sizes: '(max-width: 900px) 100vw, 760px' }),
        element('div', { class: 'hf-caption' },
          element('p', { class: 'hf-kicker', text: '오늘의 집들이' }),
          element('h2', { text: tour.title }),
          element('p', { class: 'hf-meta', text: `${homeLine(tour.home)} · ${tour.tags.household.map((h) => tagLabel('household', h)).join(', ')}` })))));
    function go(n) {
      index = (n + list.length) % list.length;
      slides.forEach((slide, i) => { slide.hidden = i !== index; slide.classList.toggle('is-current', i === index); });
      counter.textContent = `${index + 1} / ${list.length}`;
    }
    go(0);
    const root = element('section', { class: 'home-feature', 'aria-roledescription': '캐러셀', 'aria-label': '인기 집들이',
      onmouseenter: () => { paused = true; }, onmouseleave: () => { paused = false; }, onfocusin: () => { paused = true; }, onfocusout: () => { paused = false; } },
      element('ol', { class: 'hf-slides' }, slides),
      element('div', { class: 'hf-nav' },
        element('button', { type: 'button', class: 'hf-prev', 'aria-label': '이전 집들이', onclick: () => go(index - 1) }, icon('left', 18)),
        counter,
        element('button', { type: 'button', class: 'hf-next', 'aria-label': '다음 집들이', onclick: () => go(index + 1) }, icon('right', 18))));
    clearInterval(slideTimer);
    if (!reducedMotion()) slideTimer = setInterval(() => { if (!paused && !hero.hidden && !document.hidden) go(index + 1); }, 6000);
    return root;
  }

  // --- 우리 집 and 새로운 집 찾기 beside the carousel -------------------------------------------
  function myHome() {
    const plan = readHome(hooks.current()?.key);
    const applied = concepts.applied?.(plan);
    const concept = applied && CONCEPTS.find((c) => c.id === applied.concept);
    return element('article', { class: 'home-mine' },
      element('a', { class: 'hm-art', href: '?studio=1', 'aria-label': `${HOMES[plan].label} 열기`, onclick: (event) => { if (!plain(event)) return; event.preventDefault(); goHome(); },
        style: homeImage(plan) ? `background-image:url("${homeImage(plan)}")` : null }),
      element('div', { class: 'hm-body' },
        element('p', { class: 'hm-label', text: '우리 집' }),
        element('h2', { class: 'hm-name', text: HOMES[plan].label }),
        element('p', { class: 'hm-meta', text: concept ? `${concept.title} · ${PALETTES[applied.palette]?.name ?? ''}로 꾸미는 중` : planFacts(plan) }),
        element('div', { class: 'hm-actions' },
          element('button', { type: 'button', id: 'open-my-home', class: 'btn btn-primary', onclick: goHome, text: '우리 집 열기' }),
          element('button', { type: 'button', class: 'btn', onclick: walkHome, text: '3D로 걷기' }))));
  }
  const findInput = element('input', { id: 'home-find-search', type: 'search', placeholder: '단지명, 지역', autocomplete: 'off', 'aria-label': '단지 검색' });
  const findHint = element('p', { class: 'hfm-hint', 'aria-live': 'polite' });
  function findMini() {
    const form = element('form', { class: 'hfm-search', role: 'search', onsubmit: (event) => {
      event.preventDefault();
      const query = findInput.value.trim();
      const found = tours.findComplexes(query);
      if (query && !found.length) { findHint.textContent = `‘${query}’에 맞는 단지가 없어요.`; findHint.classList.add('is-empty'); return; }
      openFind(query);
    } }, icon('search', 18), findInput, element('button', { type: 'submit', class: 'btn btn-small', text: '찾기' }));
    findHint.classList.remove('is-empty');
    findHint.textContent = '';
    return element('article', { class: 'home-find' },
      element('h2', { text: '새로운 집 찾기' }),
      element('p', { class: 'hf-lede', text: '단지와 동·층을 고르면 그 집 안을 미리 걸어볼 수 있어요.' }),
      form, findHint);
  }
  function openFind(query = '') {
    findButton.click();
    const search = $('find-complex-search');
    if (search && query) { search.value = query; search.dispatchEvent(new Event('input')); }
  }

  // --- shortcuts ------------------------------------------------------------------------
  function quick() {
    const items = [
      { id: 'quick-home', icon: 'home', label: '우리 집', run: goHome },
      { id: 'quick-find', icon: 'find', label: '새로운 집 찾기', run: () => openFind() },
      { id: 'open-tours', icon: 'tours', label: '집들이', run: () => tours.openGallery({}) },
      { id: 'quick-walk', icon: 'walk', label: '3D로 걷기', run: walkHome },
      { id: 'quick-edit', icon: 'edit', label: '가구 배치', run: editHome },
      { id: 'quick-concepts', icon: 'concepts', label: '컨셉 추천', run: conceptsHome },
    ];
    return element('nav', { class: 'home-quick', 'aria-label': '바로 가기' }, items.map((item) => element('button', { type: 'button', id: item.id, class: 'hq-item', onclick: item.run },
      element('span', { class: 'hq-icon' }, quickIcon(item.icon)),
      element('span', { class: 'hq-label', text: item.label }))));
  }

  // --- sections -------------------------------------------------------------------------
  function section(title, { more, sub, id } = {}, ...content) {
    return element('section', { class: 'home-section', id },
      element('header', { class: 'hs-head' },
        element('div', {}, element('h2', { text: title }), sub ? element('p', { text: sub }) : null),
        more ? element('button', { type: 'button', class: 'hs-more', onclick: more, text: '더보기' }) : null),
      content);
  }
  const grid = (list) => element('ol', { class: 'tp-grid home-grid' }, list.map((tour) => tours.card(tour)));
  // A photo for each space or style, taken from the 집들이 themselves; no photo is used twice.
  function tileEntries(group, ids, used) {
    return ids.filter((tag) => countBy(group, tag)).map((tag) => {
      const candidates = tours.byPopularity().flatMap((tour) => (group === 'space' ? tour.photos.filter((item) => item.space === tag)
        : tour.tags[group].includes(tag) ? tour.photos : []).map((item) => ({ tour, item })));
      const pick = candidates.find(({ item }) => !used.has(item.id)) ?? candidates[0];
      used.add(pick.item.id);
      return { tag, ...pick };
    });
  }
  function photoTiles(entries, group) {
    return element('ul', { class: `home-photos photos-${group}` }, entries.map(({ tag, item }) => element('li', {},
      element('button', { type: 'button', class: 'hp-tile', 'data-group': group, 'data-tag': tag, onclick: () => tours.openGallery({ group, tag }) },
        element('span', { class: 'hp-photo' }, element('img', { src: photoURL(item, 480), srcset: `${photoURL(item, 480)} 480w, ${photoURL(item, 800)} 800w`, sizes: '(max-width: 650px) 45vw, 240px', alt: '', loading: 'lazy', decoding: 'async' })),
        element('strong', { text: tagLabel(group, tag) }),
        element('small', { text: `집들이 ${countBy(group, tag)}곳` })))));
  }
  function complexes() {
    const c = tours.complexes[0];
    return element('div', { class: 'home-complexes' },
      element('article', { class: 'hc-card' },
        element('figure', { class: 'hc-photo' }, photo, credit, photoError),
        element('div', { class: 'hc-body' },
          element('h3', { text: c.name }),
          element('p', { class: 'hc-meta', text: `${c.address}` }),
          element('p', { class: 'hc-meta', text: `3D 세대 ${c.units}` }),
          element('div', { class: 'hc-actions' }, findButton, element('a', { class: 'btn', href: c.map, target: '_blank', rel: 'noopener', text: '지도에서 보기' })))));
  }

  const page = element('div', { class: 'home' });
  hero.append(page);
  function render() {
    const near = tours.bySimilarity().slice(0, 4);
    const themes = tours.themes();
    const used = new Set();
    const spaces = tileEntries('space', HOME_SPACES, used);
    const styles = tileEntries('style', TAG_GROUPS.find((g) => g.id === 'style').tags.map((t) => t.id), used);
    page.replaceChildren(element('div', { class: 'home-wrap' },
      element('div', { class: 'home-top' }, feature(), element('div', { class: 'home-side' }, myHome(), findMini())),
      quick(),
      themes.length ? section('최근 적용한 테마', { id: 'home-themes' }, tours.historyCards(themes.slice(0, 4))) : null,
      near.length ? section('우리 집과 비슷한 집들이', { sub: `우리 집(${homeLine(MY_HOME)})과 주거형태·평수가 비슷한 집이에요. 마음에 드는 테마는 우리 집 평면에 맞춰 가져올 수 있어요.`, more: () => tours.openGallery({ similar: true, sort: 'similar' }) }, grid(near)) : null,
      section('새로 올라온 집들이', { more: () => tours.openGallery({ sort: 'recent' }) }, grid(tours.byRecent().slice(0, 4))),
      section('이런 공간 찾고 있나요?', { sub: '공간을 고르면 그 공간을 꾸민 집들이를 모아 보여드려요.' }, photoTiles(spaces, 'space')),
      section('취향으로 고르기', {}, photoTiles(styles, 'style')),
      section('새로운 집 찾기', { id: 'home-find', sub: '등록된 단지에서 동과 층을 고르면, 그 세대를 3D로 열어요.' }, complexes()),
      element('footer', { class: 'home-foot' }, element('strong', { text: 'CORTEX' }))));
  }
  render();
  // Personal parts (우리 집, what fits it, popularity) change while away: refresh on return.
  new MutationObserver(() => { if (!hero.hidden) render(); }).observe(hero, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('cortex:home', render);

  // --- header search: 집들이 and complexes --------------------------------------------------
  const searchInput = element('input', { id: 'header-search', type: 'search', placeholder: '집들이, 단지 검색', autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'header-search-results', 'aria-label': '집들이, 단지 검색' });
  const results = element('div', { id: 'header-search-results', class: 'hs-results', role: 'listbox', hidden: true });
  let options = [];
  function searchTours(query) {
    const q = query.toLowerCase();
    return TOURS.filter((tour) => {
      const concept = CONCEPTS.find((c) => c.id === tour.concept);
      const words = [tour.title, tour.summary, concept.title, PALETTES[tour.palette].name, HOME_TYPES[tour.home.type], `${tour.home.pyeong}평`, ...Object.entries(tour.tags).flatMap(([g, tags]) => tags.map((t) => tagLabel(g, t)))];
      return words.some((w) => w.toLowerCase().includes(q));
    });
  }
  function closeResults() { results.hidden = true; searchInput.setAttribute('aria-expanded', 'false'); }
  function choose(option) { closeResults(); searchInput.value = ''; searchInput.blur(); option.run(); }
  function renderResults() {
    const query = searchInput.value.trim();
    if (!query) { closeResults(); return; }
    const found = searchTours(query).slice(0, 5), places = tours.findComplexes(query);
    options = [...found.map((tour) => ({ label: tour.title, art: photoURL(tour.photos[0], 160), kind: '집들이', run: () => tours.openDetail(tour.id) })),
      ...places.map((c) => ({ label: c.name, sub: c.region, kind: '단지', run: () => openFind(query) }))];
    results.replaceChildren(...(options.length ? options.map((option, i) => element('button', { type: 'button', role: 'option', class: 'hs-option', id: `hs-option-${i}`, onmousedown: (event) => event.preventDefault(), onclick: () => choose(option) },
      option.art ? element('span', { class: 'hs-thumb', style: `background-image:url("${option.art}")` }) : element('span', { class: 'hs-thumb hs-thumb-place' }, icon('search', 16)),
      element('span', { class: 'hs-text' }, element('strong', { text: option.label }), element('small', { text: option.sub ? `${option.kind} · ${option.sub}` : option.kind }))))
      : [element('p', { class: 'hs-empty', text: `‘${query}’에 맞는 집들이나 단지가 없어요.` })]));
    results.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
  }
  searchInput.addEventListener('input', renderResults);
  searchInput.addEventListener('focus', () => { if (searchInput.value.trim()) renderResults(); });
  searchInput.addEventListener('blur', () => setTimeout(closeResults, 120));
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { closeResults(); searchInput.blur(); }
    if (event.key === 'Enter' && options.length && !results.hidden) { event.preventDefault(); choose(options[0]); }
  });
  const searchBox = element('div', { class: 'header-search' }, icon('search', 18), searchInput, results);
  hooks.ui.querySelector('.studio-header nav')?.after(searchBox);

  return { render };
}
