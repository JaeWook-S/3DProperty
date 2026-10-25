// Theme switcher shown while walking (W7-06): try the recommended concepts and their
// colors from inside the unit. A small bar shows the current theme and color; number
// keys switch themes and C the color without opening anything, and T (or a click) opens
// the full list. Walking by touch, the bar sits top-left and the list opens below it.

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

const dots = (colors) => element('span', { class: 'wt-dots', 'aria-hidden': 'true' },
  ['fabric', 'wood', 'accent'].map((slot) => element('i', { style: `background:${colors[slot]}` })));

export function createWalkThemes({ hooks, concepts, palettes, applied, recommended, choose, choosePalette }) {
  let open = false, flashTimer;
  const root = element('section', { id: 'walk-themes', 'aria-label': '추천 테마', hidden: true });
  const toggle = element('button', { type: 'button', class: 'wt-toggle', 'aria-expanded': 'false', 'aria-controls': 'wt-body', onclick: () => setOpen(!open) });
  const cycle = element('button', { type: 'button', class: 'wt-cycle', onclick: () => cyclePalette() });
  const hint = element('span', { class: 'wt-hint' });
  const bar = element('div', { class: 'wt-bar' }, toggle, cycle, hint);
  const body = element('div', { id: 'wt-body', class: 'wt-body' });
  const flash = element('p', { class: 'wt-flash', role: 'status', 'aria-live': 'polite' });
  root.append(flash, body, bar);
  // Above the touch-walking layer (z-index 30) and the minimap so taps reach the buttons.
  document.body.append(root);

  const name = (id) => (id ? concepts.find((c) => c.id === id).short : '기본 배치');

  function setOpen(next) {
    open = next;
    root.dataset.open = String(open);
    toggle.setAttribute('aria-expanded', String(open));
  }

  function select(conceptId) {
    if ((applied()?.concept ?? null) === conceptId) return;
    choose(conceptId);
    say();
  }
  function cyclePalette() {
    const now = applied();
    if (!now) return;
    const list = concepts.find((c) => c.id === now.concept).palettes;
    choosePalette(list[(list.indexOf(now.palette) + 1) % list.length]);
    say();
  }
  function say() {
    const now = applied();
    flash.textContent = now ? `${name(now.concept)} · ${palettes[now.palette].name}` : '기본 배치로 돌아왔어요';
    flash.classList.add('show');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => flash.classList.remove('show'), 1800);
  }

  function render() {
    const now = applied(), best = recommended();
    const current = now?.concept ?? null;
    toggle.replaceChildren(element('span', { class: 'wt-label', text: '테마' }), element('strong', { text: name(current) }));
    cycle.disabled = !now;
    cycle.setAttribute('aria-label', now ? `색감 바꾸기 (지금 ${palettes[now.palette].name})` : '색감');
    cycle.replaceChildren(...(now ? [dots(palettes[now.palette].colors), element('kbd', { text: 'C' })] : []));
    hint.replaceChildren(element('kbd', { text: '1' }), '–', element('kbd', { text: String(concepts.length + 1) }), ' 테마  ', element('kbd', { text: 'T' }), ' 목록');
    const options = [null, ...concepts.map((c) => c.id)].map((id, index) => element('button', {
      type: 'button', role: 'radio', class: 'wt-theme', 'data-theme': id ?? 'base', 'aria-checked': String(id === current),
      onclick: () => select(id) },
    element('kbd', { text: String(index + 1) }), element('span', { text: name(id) }),
    id && id === best ? element('em', { text: '추천' }) : null));
    const list = now ? concepts.find((c) => c.id === now.concept).palettes : [];
    body.replaceChildren(
      element('div', { class: 'wt-head' },
        element('strong', { text: '추천 테마' }),
        element('span', { class: 'wt-keys', text: `숫자키 1–${concepts.length + 1} · C 색감 · T 닫기` }),
        element('button', { type: 'button', class: 'wt-close', 'aria-label': '테마 닫기', onclick: () => setOpen(false), text: '✕' })),
      element('div', { class: 'wt-themes', role: 'radiogroup', 'aria-label': '테마' }, options),
      element('div', { class: 'wt-palettes', role: 'radiogroup', 'aria-label': '색감' },
        element('span', { class: 'wt-label' }, '색감 ', element('kbd', { text: 'C' })),
        list.length ? list.map((id) => element('button', {
          type: 'button', role: 'radio', class: 'wt-palette', 'aria-checked': String(id === now.palette), title: palettes[id].name,
          'aria-label': palettes[id].name, 'data-palette': id, onclick: () => { choosePalette(id); say(); } }, dots(palettes[id].colors)))
          : element('span', { class: 'wt-none', text: '테마를 고르면 바꿀 수 있어요' })),
      element('button', { type: 'button', class: 'wt-resume', onclick: () => hooks.resume(), text: '이어서 걷기' }));
  }

  document.addEventListener('keydown', (event) => {
    if (root.hidden || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest?.('input, select, textarea')) return;
    const digit = /^Digit(\d)$/.exec(event.code)?.[1];
    if (digit && Number(digit) >= 1 && Number(digit) <= concepts.length + 1) {
      event.preventDefault();
      select(digit === '1' ? null : concepts[Number(digit) - 2].id);
    } else if (event.code === 'KeyC') {
      event.preventDefault();
      cyclePalette();
    } else if (event.code === 'KeyT') {
      event.preventDefault();
      setOpen(!open);
    }
  });

  return {
    render,
    onMode(mode) {
      root.hidden = mode !== 'tour';
      setOpen(false);
      if (!root.hidden) render();
    },
  };
}
