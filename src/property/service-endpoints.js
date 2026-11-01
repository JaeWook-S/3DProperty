// Transport endpoints are separate from the bounded location/unit selection state.
function endpoint(value, page) {
  if (typeof value !== 'string' || !value || value.length > 4096) return null;
  try {
    const url = new URL(value, page);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = ''; return url;
  } catch { return null; }
}
function base(page) { const url = new URL(page); url.search = ''; url.hash = ''; return url; }
function fallback(page, port) { const url = new URL('/', page); url.port = port; return url; }

export function resolveViewerBase(page, configured = '', remembered = '') {
  const viewer = endpoint(new URL(page).searchParams.get('viewerUrl'), page) || endpoint(configured, page) || endpoint(remembered, page) || fallback(page, '5173');
  viewer.searchParams.delete('serviceUrl'); viewer.searchParams.delete('viewerUrl');
  const service = base(page); service.searchParams.set('viewerUrl', viewer.href);
  viewer.searchParams.set('serviceUrl', service.href);
  return viewer;
}
export function resolveServiceBase(page, configured = '', remembered = '') {
  const service = endpoint(new URL(page).searchParams.get('serviceUrl'), page) || endpoint(configured, page) || endpoint(remembered, page) || fallback(page, '5185');
  service.searchParams.delete('serviceUrl');
  service.searchParams.set('viewerUrl', base(page).href);
  return service;
}
function rememberedEndpoint(key, resolve, page, configured) {
  let stored = '';
  try { stored = localStorage.getItem(key) || ''; } catch {}
  const url = resolve(page, configured, stored);
  // Remember per browser origin: an old bookmark on the same forwarded viewer port
  // can return to the service after the new launcher has connected it once.
  try { localStorage.setItem(key, url.href); } catch {}
  return url;
}
export const viewerBaseForPage = (page, configured) => rememberedEndpoint('cortex-viewer-endpoint', resolveViewerBase, page, configured);
export const serviceBaseForPage = (page, configured) => rememberedEndpoint('cortex-service-endpoint', resolveServiceBase, page, configured);
