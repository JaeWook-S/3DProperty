import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {containsLabelBox, findLabelAnchor, layoutRoomLabel} from '../src/plan-room-labels.js';

// Deterministic metrics for geometry tests; browser tests separately cover the
// actual Korean font, glyph bbox, responsive viewport and zoom behavior.
const measureText = (lines, fontSize) => ({
  width: Math.max(...lines.map(line => [...line].reduce((width, char) => width + (/\s/.test(char) ? .35 : /[\x00-\x7f]/.test(char) ? .62 : 1), 0))) * fontSize,
  height: (1.1 + (lines.length - 1) * 1.25) * fontSize,
});

test('a concave room uses interior space even when its bounding-box center is outside', () => {
  const polygon = [[0,0],[6,0],[6,1.5],[1.5,1.5],[1.5,6],[0,6]];
  assert.equal(containsLabelBox(polygon, {x:2.5,y:2.5,width:1,height:1}), false);
  const anchor = findLabelAnchor(polygon, 1, .7, .04);
  assert.ok(anchor);
  assert.ok(containsLabelBox(polygon, {x:anchor[0]-.5,y:anchor[1]-.35,width:1,height:.7}, .04));
});

test('all four corners inside is insufficient when a concave notch crosses the text', () => {
  const polygon = [[0,0],[6,0],[6,6],[4,6],[4,2],[2,2],[2,6],[0,6]];
  assert.equal(containsLabelBox(polygon, {x:1,y:1,width:4,height:4}), false);
  assert.equal(containsLabelBox(polygon, {x:.2,y:.2,width:5.6,height:1.5}, .02), true);
});

test('long labels use full-height horizontal space instead of requiring an inscribed circle', () => {
  const polygon = [[0,0],[8,0],[8,.6],[2,.6],[2,3],[0,3]];
  const anchor = findLabelAnchor(polygon, 6, .35, .04);
  assert.ok(anchor);
  assert.ok(containsLabelBox(polygon, {x:anchor[0]-3,y:anchor[1]-.175,width:6,height:.35}, .04));
});

test('long room names wrap; a narrow room uses a readable number before hiding', () => {
  const room = {name:'안방 발코니 보조실',polygon_m:[[0,0],[1.6,0],[1.6,2],[0,2]]};
  const wrapped = layoutRoomLabel({room,pixelsPerMeter:30,measureText});
  assert.equal(wrapped.mode, 'name');
  assert.ok(wrapped.lines.length > 1);
  const strip = {name:'침실 1 창가 발코니',polygon_m:[[0,0],[1.5,0],[1.5,.4],[0,.4]]};
  const numbered = layoutRoomLabel({room:strip,index:11,pixelsPerMeter:35,measureText});
  assert.equal(numbered.mode, 'number');
  assert.equal(numbered.text, '12');
  assert.ok(numbered.fontSize * 35 >= 10);
  const hidden = layoutRoomLabel({room:strip,index:11,pixelsPerMeter:15,measureText});
  assert.equal(hidden.mode, 'hidden');
  assert.equal(hidden.bounds, null);
});

test('invalid geometry and unavailable viewport metrics safely omit text', () => {
  for (const polygon of [[], [[0,0],[1,1]], [[0,0],[1,0],[2,0]], [[0,0],[NaN,1],[2,2]]]) assert.equal(findLabelAnchor(polygon,1,.2),null);
  const room = {name:'방',polygon_m:[[0,0],[2,0],[2,2],[0,2]]};
  assert.equal(layoutRoomLabel({room,pixelsPerMeter:0,measureText}).mode,'hidden');
  assert.equal(layoutRoomLabel({room,pixelsPerMeter:40,measureText:()=>({width:0,height:0})}).mode,'hidden');
});

test('every visible label stays wholly within all 63 source rooms across mobile, desktop and zoom scales', () => {
  const variants = ['112a-basic','112a-expanded','168c-basic','168c-expanded'];
  let count = 0, wrapped = 0, numbered = 0;
  for (const variant of variants) {
    const data = JSON.parse(readFileSync(new URL(`../public/floorplans/${variant}-archisketch.json`, import.meta.url)));
    const original = JSON.stringify(data);
    count += data.rooms.length;
    const planWidth = data.bounds[2] - data.bounds[0] + .9;
    for (const viewportWidth of [300, 620, 1100]) for (const zoom of [.7, 1, 1.6, 3]) {
      const scale = viewportWidth / planWidth * zoom;
      data.rooms.forEach((room,index) => {
        const label = layoutRoomLabel({room,index,pixelsPerMeter:scale,measureText});
        if (label.mode === 'hidden') { assert.equal(label.bounds,null); return; }
        assert.ok(containsLabelBox(room.polygon_m,label.bounds,label.padding),`${variant}/${room.id} at ${viewportWidth}px, zoom ${zoom}`);
        assert.ok(label.fontSize * scale >= 10 - 1e-9);
        if (label.lines.length > 1) wrapped++;
        if (label.mode === 'number') numbered++;
      });
    }
    assert.equal(JSON.stringify(data),original,'layout never changes source polygons or dimensions');
  }
  assert.equal(count,63);
  assert.ok(wrapped > 0);
  assert.ok(numbered > 0);
});
