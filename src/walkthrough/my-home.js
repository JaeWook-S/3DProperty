// "우리 집": the home the viewer goes back to from the first screen and the header, and the
// themes applied to it.
// Until homes can be registered, it is one of the demo plans (112A 확장형/기본형), saved
// in this browser when a unit is opened or picked as the home for a 집들이.
export const HOMES = {
  expanded: { complex: '아크로리버파크', unit: '112A 확장형', label: '아크로리버파크 112A 확장형' },
  basic: { complex: '아크로리버파크', unit: '112A 기본형', label: '아크로리버파크 112A 기본형' },
};
const KEY = 'cortex-my-home';

export function readHome(fallback = 'expanded') {
  try { const saved = localStorage.getItem(KEY); if (HOMES[saved]) return saved; } catch { /* storage unavailable */ }
  return HOMES[fallback] ? fallback : 'expanded';
}
export function saveHome(home) {
  if (!HOMES[home]) return;
  try { localStorage.setItem(KEY, home); } catch { /* storage unavailable */ }
  document.dispatchEvent(new CustomEvent('cortex:home', { detail: home }));
}

// Themes applied to 우리 집, newest first, so they can be applied again: one entry per concept,
// plan and 집들이 it came from (changing the colors updates the entry).
const THEMES_KEY = 'cortex-theme-history';
export const THEMES_KEPT = 12;
export function readThemes() {
  try {
    const list = JSON.parse(localStorage.getItem(THEMES_KEY));
    return Array.isArray(list) ? list.filter((entry) => HOMES[entry?.plan]) : [];
  } catch { return []; }
}
export function rememberTheme({ concept, palette, plan, tour = null }) {
  if (!HOMES[plan]) return;
  const same = (entry) => entry.concept === concept && entry.plan === plan && (entry.tour ?? null) === tour;
  const list = [{ concept, palette, plan, tour, at: Date.now() }, ...readThemes().filter((entry) => !same(entry))];
  try { localStorage.setItem(THEMES_KEY, JSON.stringify(list.slice(0, THEMES_KEPT))); } catch { /* storage unavailable */ }
  document.dispatchEvent(new CustomEvent('cortex:themes'));
}
