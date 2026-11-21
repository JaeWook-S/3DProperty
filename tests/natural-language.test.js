import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret, resolveTarget } from '../src/natural-language/command-format.js';
import { runCommands } from '../src/natural-language/command-runner.js';
import { createMockProvider } from '../src/natural-language/providers/model-mock.js';

// 테스트용 가짜 집과 가짜 편집 API. interior.api와 같은 모양만 흉내 낸다.
function makeScene() {
  const furniture = [
    { id: 'sofa-1', kind: 'sofa', title: '거실 소파', x: 1, z: 1, angle: 0, room: 'living' },
    { id: 'bed-1', kind: 'bed', title: '안방 침대', x: 3, z: 2, angle: 0, room: 'bedroom' },
  ];
  const faces = [
    { key: 'living-wall-1', kind: 'wall', roomId: 'living', label: '거실 벽' },
    { key: 'living-floor-1', kind: 'floor', roomId: 'living', label: '거실 바닥' },
  ];
  const calls = [];
  const api = {
    furniture: () => furniture.map((f) => ({ ...f })),
    faces: () => faces.map((f) => ({ ...f })),
    moveFurniture: (id, x, z) => { calls.push(['move', id, x, z]); const f = furniture.find((i) => i.id === id); f.x = x; f.z = z; },
    rotateFurniture: (id) => { calls.push(['rotate', id]); const f = furniture.find((i) => i.id === id); f.angle += Math.PI / 2; },
    addFurniture: (kind) => { calls.push(['add', kind]); furniture.push({ id: `added-${furniture.length}`, kind, title: kind, x: 0, z: 0, angle: 0, room: 'living' }); },
    removeFurniture: (id) => { calls.push(['remove', id]); const i = furniture.findIndex((x) => x.id === id); if (i >= 0) furniture.splice(i, 1); },
    applyFinish: (keys, finishId) => { calls.push(['finish', keys, finishId]); },
    undo: () => { calls.push(['undo']); },
    redo: () => { calls.push(['redo']); },
  };
  const context = {
    furniture: api.furniture(), faces: api.faces(),
    rooms: [{ id: 'living', name: '거실' }, { id: 'bedroom', name: '안방' }],
    finishes: [{ id: 'grey-soft', label: '밝은 회색' }],
    kinds: [{ kind: 'chair', title: '의자' }],
  };
  return { api, context, calls, furniture };
}

test('잘못된 동작과 불완전한 명령은 거절한다', () => {
  const { context } = makeScene();
  assert.equal(interpret({ op: 'teleport' }, context).ok, false);
  assert.equal(interpret({ op: 'move_furniture', target: '소파' }, context).ok, false); // 좌표 없음
});

test('대상 찾기: 하나면 찾고, 없거나 비면 알려준다', () => {
  const { context } = makeScene();
  assert.equal(resolveTarget('소파', context).id, 'sofa-1');
  assert.ok(resolveTarget('없는가구', context).error);
  assert.ok(resolveTarget('', context).error);
});

test('이동 명령을 적용하면 좌표가 바뀐다', async () => {
  const { api, context, furniture } = makeScene();
  const r = await runCommands([{ op: 'move_furniture', target: '소파', to: { x: 2.5, z: 1.0 } }], { api, context });
  assert.equal(r.applied, true);
  assert.equal(furniture.find((f) => f.id === 'sofa-1').x, 2.5);
});

test('대상이 모호하면 적용하지 않고 후보를 준다', async () => {
  const { api, context, calls } = makeScene();
  context.furniture.push({ id: 'sofa-2', kind: 'sofa', title: '서재 소파', x: 5, z: 5, room: 'study' });
  const r = await runCommands([{ op: 'move_furniture', target: '소파', to: { x: 0, z: 0 } }], { api, context });
  assert.equal(r.applied, false);
  assert.equal(r.ambiguous.length, 2);
  assert.equal(calls.length, 0);
});

test('마감 변경: 거실 벽에 적용된다', async () => {
  const { api, context, calls } = makeScene();
  const r = await runCommands([{ op: 'set_finish', scope: 'wall', room: '거실', finish: '밝은 회색' }], { api, context });
  assert.equal(r.applied, true);
  const finishCall = calls.find((c) => c[0] === 'finish');
  assert.deepEqual(finishCall[1], ['living-wall-1']);
  assert.equal(finishCall[2], 'grey-soft');
});

test('가짜 모델: 되돌리기 지시 -> 명령 -> 적용', async () => {
  const { api, context, calls } = makeScene();
  const { commands } = await createMockProvider().propose('방금 거 되돌려', context);
  assert.deepEqual(commands, [{ op: 'undo' }]);
  const r = await runCommands(commands, { api, context });
  assert.equal(r.applied, true);
  assert.deepEqual(calls.at(-1), ['undo']);
});

test('가짜 모델: 회전 지시 -> 소파 회전', async () => {
  const { api, context, calls } = makeScene();
  const { commands } = await createMockProvider().propose('소파 돌려줘', context);
  const r = await runCommands(commands, { api, context });
  assert.equal(r.applied, true);
  assert.ok(calls.some((c) => c[0] === 'rotate' && c[1] === 'sofa-1'));
});
