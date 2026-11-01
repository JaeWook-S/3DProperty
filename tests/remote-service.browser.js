import {test,expect} from '@playwright/test';
import net from 'node:net';
import fs from 'node:fs';
import {mockMap} from '../apps/web/tests/map-fixtures.js';
const out=new URL('../runtime/service-map/2026-10-23/launcher/browser/',import.meta.url);fs.mkdirSync(out,{recursive:true});
async function forward(remote){
 const sockets=new Set();const server=net.createServer(client=>{const upstream=net.connect({host:'127.0.0.1',port:remote});for(const s of [client,upstream]){sockets.add(s);s.on('close',()=>sockets.delete(s));s.on('error',()=>{client.destroy();upstream.destroy();});}client.pipe(upstream);upstream.pipe(client);client.on('close',()=>upstream.destroy());upstream.on('close',()=>client.destroy());});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {base:`http://127.0.0.1:${server.address().port}/`,close:()=>new Promise(resolve=>{for(const s of sockets)s.destroy();server.close(resolve);})};
}
let service,viewer;
test.beforeAll(async()=>{viewer=await forward(5173);service=await forward(5185);});
test.afterAll(async()=>{await service?.close();await viewer?.close();});
test('map-first launcher endpoints work across arbitrary forwarded ports and preserve direct viewer links',async({page})=>{
 test.setTimeout(240000);await mockMap(page);
 const errors=[],requests=[],defaultPortRequests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{requests.push(r.url());if(['5173','5185'].includes(new URL(r.url()).port))defaultPortRequests.push(r.url());});
 await page.route('http://127.0.0.1:5173/**',r=>r.abort());await page.route('http://127.0.0.1:5185/**',r=>r.abort());
 const home=new URL(service.base);home.searchParams.set('viewerUrl',viewer.base);home.searchParams.set('test','1');
 await page.goto(home.href);await expect(page.locator('#location-map')).toBeVisible();expect(requests.filter(u=>/\.(glb|hdr)(\?|$)/.test(u))).toEqual([]);
 expect(new URL(await page.locator('.brand').getAttribute('href')).searchParams.get('viewerUrl')).toBe(viewer.base);
 await page.locator('[data-place-id="acro-river-park"]').click();const site=page.frameLocator('#site-tour-frame');await expect(site.locator('#tour-building')).toBeEnabled({timeout:90000});await expect(page.locator('#site-load-status')).toBeHidden({timeout:90000});
 const siteUrl=new URL(await page.locator('#site-tour-frame').getAttribute('src'));expect(siteUrl.origin).toBe(new URL(viewer.base).origin);expect(new URL(siteUrl.searchParams.get('serviceUrl')).origin).toBe(new URL(service.base).origin);
 await page.locator('#selected-building').selectOption('100');await page.locator('#selected-floor').selectOption('7');await page.locator('#selected-floor').press('Tab');await page.locator('#open-plan').click();await expect(page.locator('#service-plan polygon').first()).toBeVisible();
 await page.locator('#open-3d').click();const indoor=page.frameLocator('#service-viewer');await expect(indoor.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:90000});await expect(page.locator('#viewer-load-status')).toBeHidden();
 expect(new URL(await page.locator('#service-viewer').getAttribute('src')).origin).toBe(new URL(viewer.base).origin);
 await indoor.locator('#service-map-link').click();await expect(page.locator('#map-stage')).toBeVisible();expect(new URL(page.url()).origin).toBe(new URL(service.base).origin);expect(new URL(page.url()).searchParams.get('viewerUrl')).toBe(viewer.base);
 // Old explicit studio bookmark remains a viewer; its remembered return points to
 // the new map port after this launcher has paired the origins once.
 await page.goto(viewer.base+'?studio=1&variant=expanded&test=1');await expect(page.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:90000});await expect(page.locator('body')).toHaveAttribute('data-studio-mode','complex');
 const back=new URL(await page.locator('#service-map-link').getAttribute('href'));expect(back.origin).toBe(new URL(service.base).origin);expect(back.searchParams.get('viewerUrl')).toBe(viewer.base);
 await page.locator('#service-map-link').click();await expect(page.locator('#location-map')).toBeVisible();expect(new URL(page.url()).origin).toBe(new URL(service.base).origin);
 await page.locator('.brand').click();await expect(page.locator('#location-map')).toBeVisible();expect(new URL(page.url()).searchParams.get('viewerUrl')).toBe(viewer.base);
 // Bare viewer home uses the remembered service endpoint; no fixed-port fallback.
 await page.goto(viewer.base);await expect(page).toHaveURL(new RegExp(':'+new URL(service.base).port+'/'));await expect(page.locator('#location-map')).toBeVisible();
 expect(defaultPortRequests).toEqual([]);expect(errors).toEqual([]);
 await page.evaluate(()=>window.__testFontReady);await page.screenshot({path:new URL('forwarded-map.png',out).pathname});
 fs.writeFileSync(new URL('verification.json',out),JSON.stringify({passed:true,viewer:viewer.base,service:service.base,siteUrl:siteUrl.href,directViewerPreserved:true,oldBookmarkReturnsToMap:true,defaultPortRequests,errors,glbs:requests.filter(u=>/\.glb(\?|$)/.test(u))},null,2));
});
