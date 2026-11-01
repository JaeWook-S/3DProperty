import {readFileSync} from 'node:fs';
export const photon=JSON.parse(readFileSync(new URL('../../../runtime/service-map/2026-10-23/references/photon-search.json',import.meta.url))).data;
// Public OSM tiles must never be load-tested by automated pan/zoom.
export async function mockMap(page){
 // Reuse the workspace's Blender font for readable Linux evidence only.
 await page.route('**/__cortex_test_font.woff2',route=>route.fulfill({contentType:'font/woff2',body:readFileSync('/home/nas5/kinamkim/Repos/geonwoo/3D-To-Video/blender-5.1.0-linux-x64/5.1/datafiles/fonts/Noto Sans CJK Regular.woff2')}));
 await page.addInitScript(()=>{window.__testFontReady=(async()=>{const font=new FontFace('Noto Sans KR','url(/__cortex_test_font.woff2)');await font.load();document.fonts.add(font);})();});
 await page.route('https://tile.openstreetmap.org/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e4e9df"/><path d="M0 80H256M80 0V256M0 190H256M190 0V256" stroke="#fff" stroke-width="7"/><text x="9" y="240" font-size="10" fill="#70816f">TEST TILE · no public tile request</text></svg>'}));
 await page.route('https://photon.komoot.io/**',route=>route.fulfill({json:photon}));
}
