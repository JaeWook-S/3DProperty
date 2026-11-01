import {test, expect} from '@playwright/test';
import net from 'node:net';
import fs from 'node:fs';
import {readSelection, writeSelection} from '../src/property/service-selection.js';
const out = new URL('../runtime/service-readiness/2026-10-25/floor-access-link/', import.meta.url);
const font = '/home/nas5/kinamkim/Repos/geonwoo/3D-To-Video/blender-5.1.0-linux-x64/5.1/datafiles/fonts/Noto Sans CJK Regular.woff2';
async function capture(page, name, locator) {
  if (fs.existsSync(font)) {
    await page.addStyleTag({content: '@font-face{font-family:ReviewKorean;src:url(data:font/woff2;base64,'+fs.readFileSync(font).toString('base64')+')}body,button,input,select,text{font-family:ReviewKorean,sans-serif!important}'});
    await page.evaluate(() => document.fonts.ready);
  }
  await (locator ?? page).screenshot({path: new URL(name, out).pathname});
}
async function forward(port) {
  const sockets = new Set();
  const server = net.createServer(client => {
    const upstream = net.connect({host:'127.0.0.1', port});
    for (const socket of [client, upstream]) {
      sockets.add(socket); socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => {client.destroy(); upstream.destroy();});
    }
    client.pipe(upstream); upstream.pipe(client);
    client.on('close', () => upstream.destroy()); upstream.on('close', () => client.destroy());
  });
  await new Promise((resolve,reject) => {server.once('error',reject); server.listen(0,'127.0.0.1',resolve);});
  return {base:'http://127.0.0.1:'+server.address().port+'/', close:() => new Promise(resolve => {for (const socket of sockets) socket.destroy(); server.close(resolve);})};
}
let service, viewer;
test.beforeAll(async () => {viewer=await forward(5173); service=await forward(5185);});
test.afterAll(async () => {await service?.close(); await viewer?.close();});
test('assumed floor review returns to the selected service plan across forwarded ports', async ({page}) => {
  const report={at:new Date().toISOString(),passed:false,service:service.base,viewer:viewer.base,requests:[],errors:[],httpErrors:[],cases:[]};
  page.on('pageerror',e => report.errors.push(e.message));
  page.on('request',r => report.requests.push(r.url()));
  page.on('response',r => {if(r.status()>=400) report.httpErrors.push({url:r.url(),status:r.status()});});
  await page.route('https://tile.openstreetmap.org/**',r => r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e4e9df"/></svg>'}));
  // Wrong defaults fail instead of silently reaching the real developer ports.
  await page.route('http://127.0.0.1:5173/**',r => r.abort());
  await page.route('http://127.0.0.1:5185/**',r => r.abort());
  try {
    for (const mobile of [false,true]) {
      await page.setViewportSize(mobile?{width:390,height:844}:{width:1440,height:1000});
      const home=writeSelection(service.base,{locationId:'acro-river-park',building:mobile?'100':'112',floor:mobile?19:7,sampleVariant:mobile?'168c-expanded-archisketch':'112a-basic-archisketch',serviceView:'plan'});
      home.searchParams.set('viewerUrl',viewer.base);
      await page.goto(home.href);
      await expect(page.locator('#service-plan polygon').first()).toBeVisible();
      await expect(page.locator('#source-plan-catalog summary')).toContainText('63');
      const link=page.getByRole('link',{name:'가구 반입 검토 · 가정 배치',exact:true});
      await expect(link).toHaveCount(1); await expect(link).toBeVisible();
      await expect(page.locator('#floor-access-basis')).toContainText('선택한 동·층의 실제 배치가 아닙니다.');
      const before=readSelection(page.url()),entry=new URL(await link.getAttribute('href'));
      expect(entry.origin).toBe(new URL(viewer.base).origin);
      expect(entry.pathname).toBe('/floor-access-review.html');
      expect([...entry.searchParams.keys()].sort()).toEqual(['serviceUrl','viewerUrl']);
      expect(readSelection(entry.searchParams.get('serviceUrl'))).toEqual(before);
      expect(new URL(entry.searchParams.get('serviceUrl')).searchParams.get('viewerUrl')).toBe(viewer.base);
      await capture(page,mobile?'service-link-mobile.png':'service-link-desktop.png',page.locator('#sample-models'));
      if(mobile){await link.focus();await page.keyboard.press('Enter');}else await link.click();
      await expect(page.locator('body')).toHaveAttribute('data-load-state','ready');
      await expect(page.locator('.source-note')).toContainText('실제 아크로리버파크 공용층 도면이 아닙니다.');
      await expect(page.locator('.source-note')).toContainText('168C 확장형 두 세대');
      await expect(page.locator('#unit-context')).not.toBeChecked();
      const renderer=await page.evaluate(() => {
        const gl=document.querySelector('#floor-viewport canvas').getContext('webgl2');
        return gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL);
      });
      expect(renderer).toContain('SwiftShader');
      expect(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const back=page.getByRole('link',{name:'지도 서비스로 돌아가기',exact:true});
      const returnTo=new URL(await back.getAttribute('href'));
      expect(returnTo.origin).toBe(new URL(service.base).origin);
      expect(returnTo.searchParams.get('viewerUrl')).toBe(viewer.base);
      expect(readSelection(returnTo)).toEqual(before);
      await capture(page,mobile?'floor-entry-mobile.png':'floor-entry-desktop.png');
      await back.click();
      await expect(page.locator('#plan-stage')).toBeVisible();
      await expect(page.locator('#service-plan polygon').first()).toBeVisible();
      await expect(page.locator('#source-plan-catalog summary')).toContainText('63');
      expect(readSelection(page.url())).toEqual(before);
      expect(new URL(page.url()).searchParams.get('viewerUrl')).toBe(viewer.base);
      await expect(page.locator('#unit-mapping')).toHaveText('미확인');
      report.cases.push({viewport:mobile?'390px':'1440px',entry:entry.href,returnTo:returnTo.href,selection:before,renderer});
    }
    report.heavyRequests=report.requests.filter(u => /\.(glb|hdr)(?:\?|$)/.test(u)&&!u.includes('?import'));
    report.apiRequests=report.requests.filter(u => /\/api\//.test(u));
    report.defaultPortRequests=report.requests.filter(u => ['5173','5185'].includes(new URL(u).port));
    expect(report.heavyRequests).toEqual([]);expect(report.apiRequests).toEqual([]);
    expect(report.defaultPortRequests).toEqual([]);expect(report.errors).toEqual([]);expect(report.httpErrors).toEqual([]);
    report.passed=true;
  } finally {
    report.finishedAt=new Date().toISOString();
    fs.writeFileSync(new URL('browser.json',out),JSON.stringify(report,null,2));
  }
});
