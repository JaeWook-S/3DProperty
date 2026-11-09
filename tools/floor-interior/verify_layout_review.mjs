import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const out=path.resolve('runtime/floor-interior/2026-11-02-user-models/layout/browser');await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const errors=[],failures=[],states=[],glb=[];
page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failures.push({url:r.url(),error:r.failure()}));
page.on('response',r=>{if(r.url().endsWith('.glb'))glb.push({url:r.url(),status:r.status()});});
try{
 await page.goto('http://127.0.0.1:5173/floor-layout-review.html',{waitUntil:'domcontentloaded',timeout:60000});
 await page.locator('body[data-load-state="ready"]').waitFor({state:'attached',timeout:150000});
 await page.screenshot({path:path.join(out,'five-expanded.png')});states.push(await page.evaluate(()=>window.__floorReview));
 await page.locator('#top').click();await page.screenshot({path:path.join(out,'five-expanded-top.png')});
 await page.locator('#basic').click();await page.locator('body[data-variant="basic"][data-load-state="ready"]').waitFor({state:'attached',timeout:150000});
 await page.screenshot({path:path.join(out,'five-basic-top.png')});states.push(await page.evaluate(()=>window.__floorReview));
 for(const target of ['145f','168d'])for(const variant of ['basic','expanded']){
  await page.locator('#target').selectOption(target);await page.locator(`body[data-target="${target}"][data-load-state="ready"]`).waitFor({state:'attached',timeout:120000});
  await page.locator('#'+variant).click();await page.locator(`body[data-variant="${variant}"][data-load-state="ready"]`).waitFor({state:'attached',timeout:120000});
  const s=await page.evaluate(()=>window.__floorReview);states.push(s);await page.screenshot({path:path.join(out,`${target}-${variant}.png`)});
 }
 await page.setViewportSize({width:390,height:844});await page.locator('#target').selectOption('floor');await page.locator('body[data-target="floor"][data-load-state="ready"]').waitFor({state:'attached',timeout:150000});
 await page.screenshot({path:path.join(out,'five-mobile.png')});states.push(await page.evaluate(()=>window.__floorReview));
 const renderer=await page.locator('canvas').evaluate(c=>{const gl=c.getContext('webgl2');return gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL);});
 const passed=!errors.length&&!failures.length&&states.every(s=>s.scale.every(a=>a.every(v=>v===1)))&&glb.every(r=>r.status===200);
 await fs.writeFile(path.join(out,'verification.json'),JSON.stringify({passed,renderer,states,errors,failures,glb,scope:'Standalone review UI only; not public service activation or walkability certification.',gpu:'SwiftShader CPU; no H200'},null,2));
 if(!passed)throw Error('Review failed');console.log(JSON.stringify({passed,states:states.length,glb:glb.length,renderer}));
}catch(e){await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({message:e.stack,errors,failures,states},null,2));throw e;}finally{await browser.close();}
