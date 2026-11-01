import {test,expect} from '@playwright/test';
import fs from 'node:fs';

const variants=['112a-basic-archisketch','112a-expanded-archisketch','168c-basic-archisketch','168c-expanded-archisketch'];
const output=new URL('../runtime/entry-common-area/2026-10-26/',import.meta.url);
const state=page=>page.evaluate(()=>window.__walkthrough.getState());
const localMove=(page,t,s)=>page.evaluate(([t,s])=>{const w=window.__walkthrough,p=w.commonPoint(t,s),current=w.getState();w.move(p[0]-current.position[0],p[1]-current.position[2]);return {target:p,state:w.getState()};},[t,s]);
const reached=result=>{expect(result.state.position[0]).toBeCloseTo(result.target[0],2);expect(result.state.position[2]).toBeCloseTo(result.target[1],2);expect(result.state.standing).toBe(true);};
async function release(page){await page.evaluate(()=>document.exitPointerLock?.());await expect.poll(async()=>(await state(page)).locked).toBe(false);}
async function aimAt(page,t,s,y=1.6){const frame=await page.evaluate(([t,s,y])=>{const w=window.__walkthrough,p=w.commonPoint(t,s),current=w.getState(),dx=current.position[0]-p[0],dz=current.position[2]-p[1];w.look(Math.atan2(dx,dz),Math.atan2(y-current.eyeHeight,Math.hypot(dx,dz)));return current.renderStats.frames;},[t,s,y]);await page.waitForFunction(frame=>window.__walkthrough.getState().renderStats.frames>frame,frame);}

for(const variant of variants)test(`${variant}: optional real entrance walk to illustrative elevator and back`,async({page})=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
 await page.goto(`/?studio=1&entry=overview&variant=${variant}&quality=light&test=1`);
 await expect(page.locator('body')).toHaveAttribute('data-studio-mode','overview',{timeout:90000});
 console.log(variant,'loaded');
 const before=await state(page);expect(before.commonArea).toBeNull();expect(before.bodyRadius).toBe(.22);expect(before.eyeHeight).toBe(1.6);expect(before.scale).toEqual([1,1,1]);
 const beforeItems=await page.evaluate(()=>window.__studio.inspect().items);
 await page.locator('#mode-tour').click();await expect.poll(async()=>(await state(page)).locked).toBe(true);await release(page);
 await page.locator('#common-area-start').click();
 await expect.poll(async()=>Boolean((await state(page)).commonArea)).toBe(true);
 const entrance=(await state(page)).doors.find(d=>d.name==='현관문');expect(entrance).toBeTruthy();
 await expect.poll(async()=>(await state(page)).doors.find(d=>d.id===entrance.id).progress,{timeout:20000}).toBeCloseTo(1,3);
 await expect(page.locator('#common-area-badge')).toBeVisible();
 await expect(page.locator('#studio-title')).toHaveText('현관 · 공용부 둘러보기');
 if(variant.startsWith('112a'))await expect(page.locator('#studio-room')).toHaveValue('entrance');
 console.log(variant,'enabled');await page.screenshot({timeout:60000,path:new URL(`${variant}-from-entrance.png`,output).pathname});reached(await localMove(page,0,.7)); // The original entrance must actually pass.
 reached(await localMove(page,-.35,2.6));
 const closed=await localMove(page,-.35,4.3);expect(Math.hypot(closed.state.position[0]-closed.target[0],closed.state.position[2]-closed.target[1])).toBeGreaterThan(.8);expect(closed.state.standing).toBe(true);
 await localMove(page,-.35,2.5);await aimAt(page,-.35,3.15);
 expect(await page.evaluate(()=>window.__walkthrough.pickDoor())).toBe('common-area:elevator');
 await page.evaluate(()=>window.__walkthrough.interact());
 await expect.poll(async()=>(await state(page)).commonArea.elevatorDoor.progress,{timeout:20000}).toBeCloseTo(1,3);
 reached(await localMove(page,-.35,4.3));
 console.log(variant,'inside car');await release(page);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const captureFrame=(await state(page)).renderStats.frames;
 await page.evaluate(()=>{const w=window.__walkthrough,p=w.commonPoint(-.35,4.3),target=w.commonPoint(0,1.5);w.place(p[0],p[1],target[0],target[1]);});
 await aimAt(page,0,1.5);
 await expect.poll(async()=>(await state(page)).renderStats.frames).toBeGreaterThan(captureFrame);
 fs.writeFileSync(new URL(`${variant}-capture-state.json`,output),JSON.stringify({state:await state(page),studio:await page.evaluate(()=>window.__studio.inspect()),captureFrame},null,2)+'\n');
 await page.screenshot({timeout:60000,path:new URL(`${variant}-inside-elevator.png`,output).pathname});
 // Close from inside, confirm the same physical door blocks the return, reopen.
 await aimAt(page,-.35,3.15);await page.evaluate(()=>window.__walkthrough.interact());
 // Open leaves are beside the opening; use the real inside call button to close.
 if((await state(page)).commonArea.elevatorDoor.target===1){await aimAt(page,.38,3.45,1.195);await page.evaluate(()=>window.__walkthrough.interact());}
 await expect.poll(async()=>(await state(page)).commonArea.elevatorDoor.progress,{timeout:20000}).toBeCloseTo(0,3);
 const returnBlocked=await localMove(page,-.35,2.5);expect(Math.hypot(returnBlocked.state.position[0]-returnBlocked.target[0],returnBlocked.state.position[2]-returnBlocked.target[1])).toBeGreaterThan(.6);
 await aimAt(page,-.35,3.15);const seamPick=await page.evaluate(()=>window.__walkthrough.pickDoor());
 await aimAt(page,-.55,3.15);const leafPick=await page.evaluate(()=>window.__walkthrough.pickDoor());
 console.log(variant,'return door aim',JSON.stringify({seamPick,leafPick,position:(await state(page)).position}));
 expect(leafPick).toBe('common-area:elevator');expect(seamPick).toBe('common-area:elevator');await aimAt(page,-.35,3.15);await page.evaluate(()=>window.__walkthrough.interact());
 await expect.poll(async()=>(await state(page)).commonArea.elevatorDoor.progress,{timeout:20000}).toBeCloseTo(1,3);
 reached(await localMove(page,-.35,2.5));reached(await localMove(page,0,.7));reached(await localMove(page,0,-1.2));
 const returned=await state(page);expect(returned.variant).toBe(variant);expect(returned.bodyRadius).toBe(.22);expect(returned.eyeHeight).toBe(1.6);expect(await page.evaluate(()=>window.__studio.inspect().items)).toEqual(beforeItems);
 await release(page);await page.locator('#back-plan').click();await expect(page.locator('body')).toHaveAttribute('data-studio-mode','overview');expect((await state(page)).commonArea).toBeNull();await expect(page.locator('#common-area-badge')).toBeHidden();
 const glbs=requests.filter(url=>/\.glb(?:\?|$)/.test(url)&&!url.includes('?import'));expect(new Set(glbs).size).toBe(1);expect(errors).toEqual([]);
 fs.writeFileSync(new URL(`${variant}.json`,output),JSON.stringify({pass:true,variant,before,returned,commonArea:returned.commonArea,modelDownloads:[...new Set(glbs)],errors},null,2)+'\n');
});
