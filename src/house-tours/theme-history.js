// 최근 적용한 테마: the themes applied to 우리 집 (kept by src/walkthrough/my-home.js), shown in the
// studio sidebar while looking around 우리 집 and on the home page, each with 다시 적용.
import { CONCEPTS, PALETTES } from '../concepts/catalog.js';
import { readThemes } from '../walkthrough/my-home.js';
import { TOURS, PLANS, tourById } from './tours.js';
import { element, icon, image } from './ui.js';

const MINUTE = 60e3, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const planShort = (plan) => PLANS[plan].replace('112A ', '');

/** Saved themes that still exist in the catalog, newest first. */
export function themeHistory() {
  return readThemes().filter((entry) => {
    const concept = CONCEPTS.find((c) => c.id === entry.concept);
    return concept && PALETTES[entry.palette] && (!entry.tour || tourById(entry.tour));
  });
}

/** 방금 · 12분 전 · 3시간 전 · 어제 · 4일 전 · 10월 2일 */
export function ago(at, now = Date.now()) {
  const gap = now - at;
  if (gap < MINUTE) return '방금';
  if (gap < HOUR) return `${Math.floor(gap / MINUTE)}분 전`;
  if (gap < DAY) return `${Math.floor(gap / HOUR)}시간 전`;
  if (gap < 2 * DAY) return '어제';
  if (gap < 7 * DAY) return `${Math.floor(gap / DAY)}일 전`;
  const date = new Date(at);
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

// The theme rendered in 우리 집: its own 집들이, one with the same concept (same colors first),
// or the concept's own render when no 집들이 uses it.
function render(entry) {
  const tour = (entry.tour && tourById(entry.tour))
    ?? TOURS.find((t) => t.concept === entry.concept && t.palette === entry.palette)
    ?? TOURS.find((t) => t.concept === entry.concept);
  return tour ? image(tour.id, `${entry.plan}-living`) : image('_concepts', `${entry.concept}-${entry.plan}`);
}

/** A saved theme with its render, colors and 다시 적용; `current` marks the one on 우리 집 now. */
export function themeCard(entry, { current = false, onApply }) {
  const concept = CONCEPTS.find((c) => c.id === entry.concept);
  const palette = PALETTES[entry.palette];
  const tour = entry.tour && tourById(entry.tour);
  const { fabric, wood, accent } = palette.colors;
  const src = render(entry);
  return element('li', { class: `th-item${current ? ' is-current' : ''}`, 'data-concept': entry.concept, 'data-palette': entry.palette, 'data-plan': entry.plan, 'data-tour': entry.tour ?? null },
    element('div', { class: 'th-picture', style: `--a:${fabric};--b:${wood};--c:${accent}` },
      src ? element('img', { src, alt: '', loading: 'lazy', decoding: 'async' }) : null,
      element('span', { class: 'th-swatches', 'aria-hidden': 'true' }, [fabric, wood, accent].map((color) => element('i', { style: `background:${color}` })))),
    element('div', { class: 'th-body' },
      element('strong', { text: tour ? tour.title : concept.title }),
      element('small', { text: tour ? `${concept.short} · ${palette.name}` : palette.name }),
      element('small', { class: 'th-when', text: `${planShort(entry.plan)} · ${ago(entry.at)}` })),
    current ? element('span', { class: 'th-current' }, icon('check', 14), '적용 중')
      : element('button', { type: 'button', class: 'th-apply', 'aria-label': `${tour ? tour.title : concept.title} 다시 적용`, onclick: () => onApply(entry), text: '다시 적용' }));
}
