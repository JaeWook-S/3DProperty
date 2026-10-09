import { HOUSEHOLDS, MOODS, PALETTES, CONCEPTS } from './catalog.js';
import { FURNITURE } from './furniture-spec.js';
import { planConcept, summarize, rankConcepts, checkNeeds, pickPalette, CLEARANCE_WARNING } from './planner.js';
import { buildFurniture, applyPalette, KIT_KINDS, MATERIALS } from './kit.js';
import { createWalkThemes } from './walk-themes.js';
import { corners } from '../walkthrough/layout.js';
import './concepts.css';

// Recommended concepts for the 112A unit (W7-06): the "컨셉 보기" tab ranks concepts by
// household and mood and applies one to the live 2D plan and 3D model; while walking, a
// theme bar switches concepts and colors in place. Uses only the studio hooks; furniture
// state lives in the studio's staging items as usual.

const $ = (id) => document.getElementById(id);
const UNIT_BOUNDS = [-0.2, -0.2, 13.8, 10.3];
const STORAGE_KEY = (variant) => `cortex-concept-v1:${variant}`;
const LIGHTING_LABELS = { day: '낮', sunset: '해질녘', night: '밤' };
const FIT_LABELS = { best: '가장 잘 맞아요', good: '함께 고려해 볼 만해요' };
// Model furniture tinted with the palette when a concept keeps it (material names from the GLB).
const MODEL_TINTS = [[/Oatmeal textile/, 'fabric2'], [/Warm greige panels/, 'fabric']];
const params = new URLSearchParams(location.search);

const templates = new Map();
function template(kind) {
  if (!templates.has(kind)) templates.set(kind, buildFurniture(kind));
  return templates.get(kind);
}

function element(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined) node.append(child);
  return node;
}

const SVG = 'http://www.w3.org/2000/svg';
function svgNode(tag, attrs = {}) {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

/** People pictogram sized to the household: adults as full figures, children smaller. */
function peopleIcon(household) {
  const figures = { solo: [1], couple: [1, 1], baby: [1, 1, 0.6], family4: [1, 1, 0.74, 0.74] }[household.id];
  const icon = svgNode('svg', { class: 'concept-people', 'aria-hidden': 'true' });
  let x = 0;
  for (const scale of figures) {
    const width = 9 * scale;
    icon.append(svgNode('circle', { cx: x + width / 2, cy: 18 - 12.6 * scale, r: 3 * scale }),
      svgNode('path', { d: `M${x + 0.5} 18 q${width / 2 - 0.5} ${-9 * scale} ${width - 1} 0 z` }));
    x += width + 1.4;
  }
  icon.setAttribute('viewBox', `0 0 ${x - 1.4} 18`);
  icon.style.width = `${((x - 1.4) * 16) / 18}px`;
  return icon;
}

function swatches(paletteId, keys = ['fabric', 'fabric2', 'wood', 'accent', 'rug']) {
  const colors = PALETTES[paletteId].colors;
  return element('span', { class: 'concept-swatches', 'aria-hidden': 'true' }, keys.map((key) => element('i', { style: `background:${colors[key]}` })));
}

const PLAN_FILL = {
  rugRound: 'rug', rugRect: 'rug', rugSmall: 'rug', playMat: 'accent', sofa4: 'fabric', sofa3: 'fabric', loveseat: 'fabric',
  armchair: 'fabric', coffeeRound: 'wood', coffeeRect: 'wood', tvConsole: 'white', bookshelf: 'wood', bookshelfWide: 'wood',
  wardrobe2: 'white', toyShelf: 'white', teepee: 'fabric2', kidsTable: 'white', singleBed: 'bedding', loftBed: 'wood',
  crib: 'white', deskSet: 'wood', deskWide: 'wood', deskPro: 'wood', dining6: 'wood', dining4: 'wood', dining2: 'wood',
  plant: 'leaf', floorLamp: 'metal', king: 'fabric2',
};

export function createConceptStudio(hooks) {
  const state = { open: false, view: 'list', household: null, mood: null, applied: new Map(), matchFloor: true };
  const variant = () => hooks.current().key;
  const appliedHere = () => state.applied.get(variant()) ?? null;
  const walking = () => hooks.mode === 'tour';

  // Shared kit pieces become addable templates on every loaded plan.
  function ensureTemplates() {
    const staging = hooks.current().staging;
    for (const kind of KIT_KINDS) {
      const spec = FURNITURE[kind];
      staging.addTemplate(kind, { title: spec.title, label: spec.label, group: template(kind), width: spec.w, depth: spec.d, height: spec.h });
    }
  }

  const planCache = new Map();
  function plan(concept) {
    const key = `${variant()}:${concept.id}`;
    if (!planCache.has(key)) {
      const active = hooks.current();
      // Kept model furniture returns to its initial transform when a concept is applied.
      const existing = active.staging.items.filter((item) => !item.id.startsWith('added-') && concept.keep.includes(item.kind))
        .map(({ id, kind, width, depth, height, initial }) => ({ id, kind, width, depth, height, ...initial }));
      planCache.set(key, planConcept(concept, { variant: variant(), rooms: hooks.rooms(), doors: active.definition.doors, existing }));
    }
    return planCache.get(key);
  }
  function summaries() {
    return new Map(CONCEPTS.map((concept) => [concept.id, summarize(plan(concept).placements, concept.keep)]));
  }
  const ranked = () => rankConcepts({ household: state.household, mood: state.mood }, summaries());

  // --- material tints for model furniture a concept keeps --------------------------------
  const originalTints = new Map();
  function tintModel(colors) {
    hooks.current().model.traverse((object) => {
      if (!object.isMesh) return;
      for (const material of [].concat(object.material)) {
        const match = MODEL_TINTS.find(([pattern]) => pattern.test(material.name));
        if (!match) continue;
        if (!originalTints.has(material)) originalTints.set(material, material.color.clone());
        if (colors) material.color.set(colors[match[1]]); else material.color.copy(originalTints.get(material));
      }
    });
  }
  function paint() {
    const applied = appliedHere();
    if (applied) applyPalette(PALETTES[applied.palette].colors);
    tintModel(applied ? PALETTES[applied.palette].colors : null);
    hooks.invalidate();
  }
  // The viewer's finish presets reset material colors; repaint once a finish settles.
  new MutationObserver(() => {
    if (['ready', 'error'].includes(document.body.dataset.finishState)) paint();
  }).observe(document.body, { attributes: true, attributeFilter: ['data-finish-state'] });

  function setFinish(finish) {
    const select = $('finish');
    if (!select || select.value === finish) return;
    select.value = finish;
    select.dispatchEvent(new Event('change'));
  }
  function setLighting(lighting) {
    const select = $('lighting');
    if (!select || select.value === lighting) return;
    select.value = lighting;
    select.dispatchEvent(new Event('change'));
    render();
  }

  // --- apply / clear -----------------------------------------------------------------
  function apply(conceptId, paletteId) {
    const concept = CONCEPTS.find((c) => c.id === conceptId);
    if (!concept) return false;
    const staging = hooks.current().staging;
    ensureTemplates();
    staging.reset();
    for (const item of staging.items) {
      if (concept.keep.includes(item.kind)) continue;
      item.deleted = true;
      item.group.visible = false;
    }
    const result = plan(concept);
    for (const [index, p] of result.placements.entries()) staging.place(p.kind, { id: `added-${concept.id}-${index}`, x: p.x, z: p.z, angle: p.angle });
    staging.rebuild();
    if (walking()) hooks.settle();
    const palette = paletteId ?? pickPalette(concept, state.mood);
    state.applied.set(variant(), { concept: concept.id, palette });
    applyPalette(PALETTES[palette].colors);
    if (state.matchFloor) setFinish(PALETTES[palette].finish);
    hooks.refreshLayout();
    paint();
    if (!walking()) frameUnit();
    hooks.status(`'${concept.title}' 컨셉을 적용했어요. 2D와 3D에 함께 반영됐어요.`);
    writeURL();
    if (state.open && compact.matches) setSheet('peek');
    render();
    revealCard(concept.id);
    return true;
  }

  function setPalette(paletteId) {
    const applied = appliedHere();
    if (!applied) return;
    applied.palette = paletteId;
    applyPalette(PALETTES[paletteId].colors);
    if (state.matchFloor) setFinish(PALETTES[paletteId].finish);
    paint();
    writeURL();
    hooks.status(`색감을 '${PALETTES[paletteId].name}'(으)로 바꿨어요.`);
    render();
    revealCard(applied.concept);
  }

  function clear({ resetLayout = true } = {}) {
    if (resetLayout) hooks.current().staging.reset();
    if (resetLayout && walking()) hooks.settle();
    const applied = appliedHere();
    state.applied.delete(variant());
    tintModel(null);
    if (applied && state.matchFloor) setFinish('original');
    if (resetLayout) hooks.refreshLayout();
    hooks.invalidate();
    writeURL();
    state.view = 'list';
    render();
  }

  function writeURL() {
    const url = new URL(location.href), applied = appliedHere();
    if (applied) { url.searchParams.set('concept', applied.concept); url.searchParams.set('palette', applied.palette); }
    else { url.searchParams.delete('concept'); url.searchParams.delete('palette'); }
    history.replaceState(null, '', url);
  }

  // --- DOM ---------------------------------------------------------------------------
  // Third studio tab next to 둘러보기 / 꾸미기.
  const tab = element('button', { id: 'mode-concepts', type: 'button', text: '컨셉 보기', onclick: () => open() });
  document.querySelector('.mode-switch')?.append(tab);
  const panel = element('section', { id: 'concept-panel', hidden: true, 'aria-labelledby': 'concept-heading' });
  $('studio-sidebar').append(panel);

  function chips(items, selected, onPick, { allowNone = false, icon } = {}) {
    return element('div', { class: 'concept-chips', role: 'group' }, items.map((item) => element('button', {
      type: 'button', class: 'concept-chip', 'aria-pressed': String(item.id === selected), 'data-value': item.id,
      onclick: () => onPick(allowNone && item.id === selected ? null : item.id),
    }, icon ? icon(item) : element('i', { class: 'concept-dot', style: `background:${item.color}` }), element('span', { text: item.label }))));
  }

  function thumbnail(concept, paletteId) {
    const colors = { ...PALETTES[paletteId].colors, leaf: '#6f8c5f' };
    const [x0, z0, x1, z1] = UNIT_BOUNDS;
    const svg = svgNode('svg', { viewBox: `${x0} ${z0} ${x1 - x0} ${z1 - z0}`, class: 'concept-thumb', role: 'img', 'aria-label': `${concept.title} 배치 미리보기` });
    for (const room of hooks.rooms()) {
      const [rx0, rz0, rx1, rz1] = room.bounds_m;
      const balcony = room.kind === 'balcony' || room.kind === 'open_balcony';
      svg.append(svgNode('rect', { x: rx0, y: rz0, width: rx1 - rx0, height: rz1 - rz0, class: balcony ? 'thumb-balcony' : 'thumb-room' }));
    }
    const kept = hooks.current().staging.items.filter((i) => !i.id.startsWith('added-') && concept.keep.includes(i.kind))
      .map((i) => ({ ...i, ...i.initial }));
    for (const p of [...kept, ...plan(concept).placements]) {
      const fill = colors[PLAN_FILL[p.kind] ?? 'wood'] ?? '#bbb';
      const flat = (FURNITURE[p.kind]?.flat) || p.height < 0.05;
      svg.append(svgNode('polygon', { points: corners(p).map((c) => c.join(',')).join(' '), fill, class: flat ? 'thumb-flat' : 'thumb-item' }));
    }
    return svg;
  }

  function renderList() {
    const variantLabel = variant() === 'expanded' ? '확장형' : '기본형';
    const header = element('header', { class: 'concept-header' },
      element('div', { class: 'concept-title-row' },
        element('h2', { id: 'concept-heading', tabindex: '-1', text: '우리 가족에 맞춘 배치' }),
        element('button', { type: 'button', class: 'concept-close', 'aria-label': '컨셉 보기 닫기', onclick: close, text: '✕' })),
      element('p', { class: 'concept-lede', text: `가족 구성과 분위기를 고르면 112A ${variantLabel}에 맞는 배치와 색감을 추천해요. 둘러보기 중에도 테마를 바꿀 수 있어요.` }));
    const household = element('fieldset', { class: 'concept-field' }, element('legend', { text: '가족 구성' }),
      chips(HOUSEHOLDS, state.household, (id) => { state.household = id; render(); }, { allowNone: true, icon: peopleIcon }));
    const mood = element('fieldset', { class: 'concept-field' }, element('legend', {}, '좋아하는 분위기 ', element('small', { text: '선택' })),
      chips(MOODS, state.mood, (id) => { state.mood = id; render(); }, { allowNone: true }));
    const hint = state.household ? HOUSEHOLDS.find((h) => h.id === state.household).hint : null;
    const results = element('ol', { class: 'concept-results', 'aria-label': '추천 컨셉' }, ranked().map((rank) => card(rank)));
    const count = element('p', { class: 'concept-count' },
      element('strong', { text: state.household ? `${HOUSEHOLDS.find((h) => h.id === state.household).label} 추천 순` : '전체 컨셉' }),
      hint ? element('span', { text: ` · ${hint}` }) : null);
    const footer = appliedHere()
      ? element('button', { type: 'button', class: 'concept-reset', onclick: () => { clear(); hooks.status('기본 배치로 되돌렸어요.'); }, text: '기본 배치로 되돌리기' })
      : null;
    listView.replaceChildren(header, household, mood, count, results, footer);
  }

  function card({ concept, fit, needs, palette }) {
    const applied = appliedHere()?.concept === concept.id ? appliedHere() : null;
    const shown = applied?.palette ?? palette;
    const met = needs.filter((n) => n.ok).length;
    const badge = fit === 'best' || fit === 'good' ? FIT_LABELS[fit] : null;
    const counts = summarize(plan(concept).placements, concept.keep);
    const facts = [`잠자리 ${counts.sleeps}${counts.infant ? ` + 아기 ${counts.infant}` : ''}`, `책상 ${counts.desks}`, `식탁 ${counts.dining}인`];
    // An applied card keeps its place in the list and offers its colors right there.
    const colors = applied
      ? element('div', { class: 'concept-card-palettes', role: 'radiogroup', 'aria-label': `${concept.title} 색감` },
        concept.palettes.map((id) => element('button', {
          type: 'button', role: 'radio', class: 'concept-card-palette', 'aria-checked': String(id === applied.palette), 'aria-label': PALETTES[id].name,
          title: PALETTES[id].name, 'data-palette': id, onclick: () => setPalette(id) }, swatches(id, ['fabric', 'wood', 'accent']))),
        element('span', { class: 'concept-card-palette-name', text: PALETTES[applied.palette].name }))
      : element('p', { class: 'concept-palette-line' }, swatches(palette), element('span', { text: `추천 색감 · ${PALETTES[palette].name}` }));
    const actions = applied
      ? element('div', { class: 'concept-card-actions' },
        element('button', { type: 'button', class: 'concept-walk studio-primary', onclick: walk, text: '이 집에서 걸어보기' }),
        element('button', { type: 'button', class: 'concept-more', onclick: () => { state.view = 'detail'; render(); }, text: '자세히' }))
      : element('button', { type: 'button', class: 'concept-apply', 'aria-label': `${concept.title} 적용`, onclick: () => apply(concept.id, palette), text: '이 컨셉 적용' });
    return element('li', {}, element('article', { class: `concept-card${applied ? ' is-applied' : ''}${fit === 'best' ? ' is-best' : ''}`, 'data-concept': concept.id },
      element('div', { class: 'concept-thumb-wrap' }, thumbnail(concept, shown), applied ? element('span', { class: 'concept-applied-tag', text: '적용됨' }) : null),
      element('div', { class: 'concept-card-body' },
        badge ? element('p', { class: `concept-fit fit-${fit}`, text: badge }) : null,
        element('h3', { text: concept.title }),
        element('p', { class: 'concept-tagline', text: concept.tagline }),
        colors,
        element('ul', { class: 'concept-facts' }, facts.map((fact) => element('li', { text: fact }))),
        needs.length ? element('p', { class: `concept-needs${met === needs.length ? ' all-met' : ''}`, text: `${HOUSEHOLDS.find((h) => h.id === state.household).label} 조건 ${met}/${needs.length} 충족` }) : null),
      actions));
  }

  // The studio frames the plan top-down one frame after a mode change; frame the angled
  // dollhouse view after that so the furniture reads in 3D.
  function frameUnit() { requestAnimationFrame(() => requestAnimationFrame(() => hooks.frame(UNIT_BOUNDS, compact.matches))); }

  function revealCard(conceptId) {
    if (!state.open || state.view !== 'list') return;
    // On a phone the folded sheet shows the card's colors and actions rather than its thumbnail.
    requestAnimationFrame(() => {
      const card = listView.querySelector(`[data-concept="${conceptId}"]`);
      (compact.matches ? card?.querySelector('.concept-card-palettes') : card)?.scrollIntoView({ block: compact.matches ? 'center' : 'nearest', inline: 'nearest' });
    });
  }

  function renderDetail() {
    const applied = appliedHere();
    const concept = CONCEPTS.find((c) => c.id === applied.concept);
    const result = plan(concept);
    const household = state.household ?? concept.households[0];
    const needs = checkNeeds(summarize(result.placements, concept.keep), household);
    const warnings = hooks.warnings().flatMap((w) => w.messages.map((message) => ({ ...w, message })));
    const hard = warnings.filter((w) => w.message !== CLEARANCE_WARNING);
    const close60 = warnings.filter((w) => w.message === CLEARANCE_WARNING);
    const lighting = $('lighting')?.value ?? 'day';
    const byRoom = new Map();
    for (const p of result.placements) {
      if (!byRoom.has(p.room)) byRoom.set(p.room, []);
      byRoom.get(p.room).push(p);
    }
    const keptTitles = concept.keep.map((kind) => hooks.current().staging.items.find((i) => i.kind === kind)).filter(Boolean);
    const roomList = element('ul', { class: 'concept-rooms' }, [...byRoom.entries()].map(([roomId, pieces]) => {
      const room = hooks.rooms().find((r) => r.id === roomId);
      const names = pieces.filter((p) => !FURNITURE[p.kind].decor).map((p) => p.title);
      if (roomId === 'Master bedroom') names.unshift(...keptTitles.map((i) => `${i.title}(기존)`));
      return element('li', {}, element('button', { type: 'button', onclick: () => { hooks.selectRoom(roomId); hooks.frame(room.bounds_m, false); } },
        element('strong', { text: concept.rooms[roomId] ?? room?.name_ko ?? roomId }),
        element('span', { class: 'concept-room-name', text: room?.name_ko ?? roomId }),
        element('span', { class: 'concept-room-items', text: names.join(' · ') || '소품' })));
    }));
    detailView.replaceChildren(
      element('button', { type: 'button', class: 'concept-back', onclick: () => { state.view = 'list'; render(); }, text: '← 컨셉 목록' }),
      element('p', { class: 'studio-eyebrow', text: `${HOUSEHOLDS.filter((h) => concept.households.includes(h.id)).map((h) => h.label).join(', ')} 추천` }),
      element('h2', { id: 'concept-heading', tabindex: '-1', text: concept.title }),
      element('p', { class: 'concept-story', text: concept.story }),
      element('section', { class: 'concept-section' }, element('h3', { text: '색감 추천' }),
        element('div', { class: 'concept-palettes', role: 'radiogroup', 'aria-label': '색감' }, concept.palettes.map((id, index) => element('button', {
          type: 'button', role: 'radio', class: 'concept-palette', 'aria-checked': String(id === applied.palette), onclick: () => setPalette(id) },
          swatches(id), element('span', { class: 'concept-palette-name' }, element('strong', { text: PALETTES[id].name }),
            element('small', { text: `${MOODS.find((m) => m.id === PALETTES[id].mood).label}${index === 0 ? ' · 추천' : ''}` })),
          element('span', { class: 'concept-palette-note', text: PALETTES[id].note })))),
        element('label', { class: 'concept-toggle' }, element('input', { type: 'checkbox', checked: state.matchFloor || undefined,
          onchange: (event) => { state.matchFloor = event.target.checked; setFinish(state.matchFloor ? PALETTES[applied.palette].finish : 'original'); } }),
        ' 바닥 마감도 색감에 맞추기')),
      element('section', { class: 'concept-section' }, element('h3', { text: '시간대' }),
        element('div', { class: 'concept-segment', role: 'group', 'aria-label': '시간대' }, Object.entries(LIGHTING_LABELS).map(([id, label]) =>
          element('button', { type: 'button', 'aria-pressed': String(lighting === id), onclick: () => setLighting(id), text: label })))),
      element('section', { class: 'concept-section' }, element('h3', { text: '공간별 구성' }), element('p', { class: 'concept-hint', text: '공간을 누르면 3D가 그 방으로 이동해요.' }), roomList),
      element('section', { class: 'concept-section' }, element('h3', { text: `${HOUSEHOLDS.find((h) => h.id === household).label} 체크` }),
        element('ul', { class: 'concept-checks' }, needs.map((n) => element('li', { class: n.ok ? 'ok' : 'short' },
          element('span', { 'aria-hidden': 'true', text: n.ok ? '✓' : '!' }), element('span', { text: `${n.label} · ${n.value}` }))))),
      element('section', { class: 'concept-section' }, element('h3', { text: '배치 점검' }),
        element('ul', { class: 'concept-checks' },
          element('li', { class: hard.length ? 'short' : 'ok' }, element('span', { 'aria-hidden': 'true', text: hard.length ? '!' : '✓' }),
            element('span', { text: hard.length ? `겹침·경계·문 개방 확인 ${hard.length}건` : '가구 겹침 · 방 경계 · 문 개방 간섭 없음' })),
          element('li', { class: close60.length ? 'note' : 'ok' }, element('span', { 'aria-hidden': 'true', text: close60.length ? 'i' : '✓' }),
            element('span', { text: close60.length ? `60cm 미만 여유 안내 ${close60.length}건${result.placements.some((p) => p.why) ? ` · ${result.placements.find((p) => p.why).why}` : ''}` : '가구 사이 60cm 여유 확보' }))),
        [...result.notes, ...result.skipped.map((s) => `${FURNITURE[s.kind]?.title ?? s.kind}: ${s.reason}`)].map((note) => element('p', { class: 'concept-note', text: note }))),
      element('div', { class: 'concept-actions' },
        element('button', { type: 'button', class: 'studio-primary', onclick: walk, text: '이 집에서 걸어보기' }),
        element('button', { type: 'button', onclick: edit, text: '가구 직접 다듬기' })),
      element('button', { type: 'button', class: 'concept-reset', onclick: () => { clear(); hooks.status('기본 배치로 되돌렸어요.'); }, text: '기본 배치로 되돌리기' }),
      element('p', { class: 'evidence-note', text: '가구는 일반적인 시판 규격 크기로 만들었어요. 색감은 화면 표시용이라 실제 제품과 다를 수 있어요.' }));
  }

  // Walk from the living room's north-west corner, looking across the rug toward the sofa and windows.
  function walk() {
    close();
    hooks.selectRoom('Living front');
    $('room-walk').click();
    const living = hooks.rooms().find((r) => r.id === 'Living front');
    if (!living) return;
    const [x1, z1, x2, z2] = living.bounds_m;
    hooks.standAt(x1 + 0.85, z1 + 0.45, x2 - 0.6, (z1 + z2) / 2 + 0.6);
  }
  function edit() { close(); hooks.selectRoom('Living front'); $('room-edit').click(); }

  const listView = element('div', { class: 'concept-view' });
  const detailView = element('div', { class: 'concept-view' });
  // Phones show the panel as a bottom sheet; after applying it folds down so the 3D shows.
  const compact = matchMedia('(max-width: 650px)');
  const grabber = element('button', { type: 'button', class: 'concept-grabber', 'aria-label': '패널 펼치기/접기',
    onclick: () => setSheet(panel.dataset.sheet === 'peek' ? 'full' : 'peek') });
  function setSheet(mode) {
    panel.dataset.sheet = mode;
    document.body.dataset.conceptSheet = mode;
    grabber.setAttribute('aria-expanded', String(mode === 'full'));
    if (compact.matches && state.open) frameUnit();
  }
  setSheet('full');
  panel.append(grabber, listView, detailView);

  function render() {
    themes.render();
    if (!state.open) return;
    const detail = state.view === 'detail' && appliedHere();
    listView.hidden = Boolean(detail);
    detailView.hidden = !detail;
    // Only the visible view keeps its content, so the panel has one #concept-heading.
    if (detail) { listView.replaceChildren(); renderDetail(); } else { detailView.replaceChildren(); renderList(); }
    if (state.renderedView !== state.view) { panel.scrollTop = 0; state.renderedView = state.view; }
  }

  // The tab always opens on the household list; details open only on request.
  function open() {
    if (hooks.mode === 'complex') return;
    if (hooks.mode !== 'overview') hooks.setMode('overview');
    ensureTemplates();
    state.open = true;
    state.view = 'list';
    setSheet('full');
    panel.hidden = false;
    document.body.dataset.concepts = 'open';
    tab.classList.add('selected');
    frameUnit();
    render();
    panel.querySelector('h2')?.focus({ preventScroll: true });
  }
  function close() {
    state.open = false;
    panel.hidden = true;
    tab.classList.remove('selected');
    delete document.body.dataset.concepts;
    delete document.body.dataset.conceptSheet;
  }
  panel.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });

  const themes = createWalkThemes({
    hooks, concepts: CONCEPTS, palettes: PALETTES, applied: appliedHere,
    recommended: () => (state.household ? ranked().find((r) => r.fit === 'best')?.concept.id ?? null : null),
    choose: (id) => (id ? apply(id) : clear()),
    choosePalette: setPalette,
  });

  // Saved layouts remember their concept and palette alongside the furniture.
  $('save-layout')?.addEventListener('click', () => {
    try { localStorage.setItem(STORAGE_KEY(variant()), JSON.stringify(appliedHere())); } catch { /* storage unavailable */ }
  });
  $('restore-layout')?.addEventListener('click', () => {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY(variant()))); } catch { /* storage unavailable */ }
    if (saved && CONCEPTS.some((c) => c.id === saved.concept) && PALETTES[saved.palette]) state.applied.set(variant(), saved);
    else state.applied.delete(variant());
    paint(); writeURL(); render();
  });
  $('reset-layout')?.addEventListener('click', () => clear({ resetLayout: false }));

  ensureTemplates();

  const hooksApi = {
    onMode(mode) {
      if (mode !== 'overview' && state.open) close();
      tab.disabled = mode === 'complex';
      themes.onMode(mode);
      // The phone sidebar keeps the complex screen's scroll; start the unit at its top.
      if (mode === 'overview' && compact.matches) $('studio-sidebar').scrollTop = 0;
    },
    onVariant() {
      ensureTemplates();
      paint();
      writeURL();
      render();
    },
  };

  // Shared links (?concept=…&palette=…) open the unit with that concept applied.
  const linked = CONCEPTS.find((c) => c.id === params.get('concept'));
  if (linked) queueMicrotask(() => {
    hooks.setMode('overview');
    open();
    apply(linked.id, PALETTES[params.get('palette')] && linked.palettes.includes(params.get('palette')) ? params.get('palette') : undefined);
  });

  if (import.meta.env.DEV && params.has('test')) {
    window.__concepts = {
      apply, setPalette, clear, open, close,
      state: () => ({ open: state.open, view: state.view, household: state.household, mood: state.mood, applied: appliedHere() }),
      plan: (id) => plan(CONCEPTS.find((c) => c.id === id)),
      ranked: () => ranked().map((r) => ({ id: r.concept.id, fit: r.fit, palette: r.palette })),
      colors: () => Object.fromEntries(Object.entries(MATERIALS).map(([slot, material]) => [slot, `#${material.color.getHexString()}`])),
    };
  }
  return hooksApi;
}
