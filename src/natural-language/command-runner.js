// 명령 실행기.
// 해석된 명령을 실제 편집 기능(interior.api)으로 적용한다.
// 규칙: 여러 명령은 전부 먼저 검사하고, 다 통과할 때만 순서대로 적용한다.
// 적용 중 하나라도 실패하면 지금까지 한 것을 되돌린다(부분 적용 방지).
import { interpret, INFO_OPS, normalizeCommand } from './command-format.js';

// 견적 금액을 사람이 읽을 문장으로. api.estimate()의 totals를 그대로 쓴다.
const manwon = (n) => `${Math.round((n || 0) / 10000).toLocaleString('ko-KR')}만`;
function describeEstimate(api) {
  let e;
  try { e = api.estimate?.(); } catch (error) { return `견적을 계산하지 못했어요: ${error.message}`; }
  const t = e?.totals;
  if (!t || !t.grand) return '지금은 바꾼 게 없어 추가 견적이 0원이에요.';
  const parts = [`공사 ${manwon(t.total)}원`, t.furniture ? `가구 ${manwon(t.furniture)}원` : null].filter(Boolean).join(', ');
  const days = e.days ? ` 예상 공사 기간 약 ${Math.ceil(e.days)}일.` : '';
  return `견적은 약 ${manwon(t.grand)}원이에요 (${parts}).${days}`;
}

function apply(action, api) {
  switch (action.op) {
    case 'move_furniture': return api.moveFurniture(action.id, action.x, action.z);
    case 'rotate_furniture': {
      // 90도 단위로만 회전시킨다. deg가 180이면 두 번.
      let times = Math.round((action.deg || 90) / 90) % 4;
      if (times <= 0) times = 1;
      for (let i = 0; i < times; i++) api.rotateFurniture(action.id);
      return;
    }
    case 'add_furniture': return api.addFurniture(action.kind);
    case 'remove_furniture': return api.removeFurniture(action.id);
    case 'set_finish': return api.applyFinish(action.keys, action.finishId);
    case 'demolish_wall': return api.demolish(action.id);
    case 'undo': return api.undo();
    case 'redo': return api.redo();
    default: throw new Error(`적용할 수 없는 동작: ${action.op}`);
  }
}

// commands: 명령(JSON) 하나 또는 배열. context: 현재 집 상태. api: interior.api.
// 반환:
//   성공  {applied:true, steps:[{op,label}]}
//   실패  {applied:false, reason, ambiguous?, command?}
export async function runCommands(commands, { api, context }) {
  const list = Array.isArray(commands) ? commands : [commands];
  if (!list.length) return { applied: false, reason: '실행할 명령이 없어요.' };

  // 0) 조회 명령(견적·개수)은 편집하지 않고 답만 돌려준다.
  const norm = list.map((c) => normalizeCommand(c));
  if (norm.some((c) => c && INFO_OPS.has(c.op))) {
    if (!norm.every((c) => c && INFO_OPS.has(c.op))) return { applied: false, reason: '조회와 편집은 따로 말씀해 주세요.' };
    const info = [];
    for (const cmd of norm) {
      const r = interpret(cmd, context);
      if (!r.ok) return { applied: false, reason: r.error };
      info.push(r.action.op === 'query_estimate' ? describeEstimate(api) : r.action.text);
    }
    return { applied: true, info, steps: [] };
  }

  // 1) 전부 먼저 검사한다. 하나라도 안 되면 아무것도 적용하지 않는다.
  const actions = [];
  for (const cmd of list) {
    const r = interpret(cmd, context);
    if (!r.ok) return { applied: false, reason: r.error, ambiguous: r.ambiguous ?? null, command: cmd };
    actions.push(r);
  }

  // 2) 다 통과했으면 순서대로 적용한다. 중간에 실패하면 되돌린다.
  const done = [];
  try {
    for (const a of actions) { await apply(a.action, api); done.push(a); }
  } catch (error) {
    for (let i = 0; i < done.length; i++) { try { api.undo(); } catch { /* 되돌리기 실패는 무시 */ } }
    return { applied: false, reason: `적용 중 문제가 생겨 되돌렸어요: ${error.message}`, steps: done.map((d) => ({ op: d.action.op, label: d.label })) };
  }
  // 마지막으로 다룬 가구 id(대명사·대상 생략 해석용). 다음 턴의 context.lastTarget로 넘긴다.
  const targetId = [...actions].reverse().find((a) => ['move_furniture', 'rotate_furniture', 'remove_furniture'].includes(a.action.op))?.action.id ?? null;
  return { applied: true, steps: actions.map((a) => ({ op: a.action.op, label: a.label })), targetId };
}
