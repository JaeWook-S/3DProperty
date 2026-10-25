// Small DOM helpers, icons, renders and photos shared by the home page and 집들이.
import { PALETTES } from '../concepts/catalog.js';
import { photoURL } from './tours.js';

const IMAGES = import.meta.glob('../../assets/house-tours/*/*.webp', { eager: true, query: '?url', import: 'default' });
export const image = (id, name) => IMAGES[`../../assets/house-tours/${id}/${name}.webp`] ?? null;
export const homeImage = (plan) => image('_home', plan);

export function element(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

const SVG = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

// 1.6px line icons on a 20px grid.
const ICONS = {
  search: 'M8.6 3.2a5.4 5.4 0 1 1 0 10.8 5.4 5.4 0 0 1 0-10.8zM12.6 12.6l4.2 4.2',
  left: 'M12.5 4.5 7 10l5.5 5.5',
  right: 'M7.5 4.5 13 10l-5.5 5.5',
  down: 'M5 7.5l5 5 5-5',
  close: 'M5 5l10 10M15 5 5 15',
  check: 'M4.5 10.5l3.6 3.5 7.4-8',
};
export function icon(name, size = 20) {
  const node = svg('svg', { viewBox: '0 0 20 20', width: size, height: size, 'aria-hidden': 'true', class: `icon icon-${name}` });
  node.append(svg('path', { d: ICONS[name], fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return node;
}

/** A render of a tour's theme in 우리 집 (`<plan>-living`, `<plan>-overview`), or a calm palette gradient while it is missing. */
export function picture(tour, name, alt, { eager = false } = {}) {
  const src = image(tour.id, name);
  const colors = PALETTES[tour.palette].colors;
  const style = `--a:${colors.fabric};--b:${colors.wood};--c:${colors.accent}`;
  const frame = element('div', { class: 'tp-picture', style });
  if (src) frame.append(element('img', { src, alt, loading: eager ? 'eager' : 'lazy', decoding: 'async' }));
  else frame.append(element('span', { class: 'tp-picture-alt', text: alt }));
  return frame;
}

/** A real photograph (a 집들이 photo), sized for where it shows. */
export function photo(item, alt, { eager = false, sizes = '(max-width: 650px) 100vw, 380px' } = {}) {
  return element('div', { class: 'tp-picture is-photo' }, element('img', {
    src: photoURL(item, 800), srcset: [480, 800, 1200, 1800].map((w) => `${photoURL(item, w)} ${w}w`).join(', '), sizes,
    alt, loading: eager ? 'eager' : 'lazy', decoding: 'async' }));
}
