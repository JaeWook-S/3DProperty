// 명령 형식과 검사.
// 자연어 모델이 내놓은 명령(JSON)이 규칙에 맞는지, 그리고 대상 가구/마감이
// 현재 집에 실제로 있는지 확인한다. 여기서는 "적용"하지 않는다. 적용은
// command-runner.js가 한다.
//
// context(현재 집 상태) 모양:
//   furniture: [{id, kind, title, x, z, angle, room}]
//   faces:     [{key, kind('wall'|'floor'|...), roomId, label}]
//   rooms:     [{id, name}]
//   finishes:  [{id, label}]   (마감 카탈로그)
//   kinds:     [{kind, title}] (놓을 수 있는 가구 종류)

// demolish_wall은 현재 LLM에서 비활성(OPS 제외). 통합 방/동일 방쌍 다중 세그먼트 평면에서 방 이름만으론 벽 구분이 안 됨 → 세그먼트 식별 보강 후 재활성.
export const OPS = ['move_furniture', 'rotate_furniture', 'add_furniture', 'remove_furniture', 'set_finish', 'query_estimate', 'query_count', 'undo', 'redo'];
// 조회 전용 동작(편집하지 않고 답만 돌려준다). command-runner가 이 집합으로 분기한다.
export const INFO_OPS = new Set(['query_estimate', 'query_count']);

// 한국어 낱말 → 가구 종류/이름에서 찾을 키워드
const ALIASES = {
  소파: ['sofa', '소파'], 침대: ['bed', '침대'], 책상: ['desk', '책상'],
  의자: ['chair', '의자'], 식탁: ['table', '식탁', 'dining'], 옷장: ['wardrobe', '옷장', 'closet'],
  수납장: ['cabinet', '수납'], 티비: ['tv'], tv: ['tv'], 러그: ['rug', '러그'], 조명: ['lamp', 'light', '조명'],
};

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const lower = (s) => String(s ?? '').toLowerCase();

function textMatches(item, ref) {
  const r = lower(ref).trim();
  if (!r) return false;
  const hay = `${lower(item.title)} ${lower(item.kind)}`;
  if (hay.includes(r)) return true;
  const alias = ALIASES[r] || ALIASES[r.replace(/\s/g, '')];
  return Array.isArray(alias) && alias.some((a) => hay.includes(lower(a)));
}

// 방 이름/아이디로 후보를 좁힌다. 방을 못 찾으면 방 조건은 무시한다.
function inRoom(item, roomRef, rooms) {
  if (!roomRef) return true;
  const r = lower(roomRef);
  const room = (rooms || []).find((x) => lower(x.id) === r || lower(x.name) === r || lower(x.name).includes(r));
  if (!room) return true;
  return item.room === room.id;
}

// "그거/이거/방금 거/아까" 같은 대명사. 대상 생략 시와 함께 직전 대상으로 해석한다(B2 대화 맥락).
const PRONOUNS = new Set(['그거', '그걸', '그것', '그', '이거', '이걸', '이것', '저거', '저걸', '방금거', '방금', '아까거', '아까', '얘', '걔', 'it', 'that', 'this']);

// 대상 가구 하나를 찾는다. 못 찾거나 여러 개면 적용하지 말라고 알려준다.
// 대상이 비었거나 대명사면 context.lastTarget(직전에 다룬 가구)로 해석한다.
export function resolveTarget(ref, context, roomRef) {
  const items = context.furniture ?? [];
  const useLast = () => {
    const item = context.lastTarget?.id ? items.find((i) => i.id === context.lastTarget.id) : null;
    return item ? { id: item.id, item } : { error: '어떤 가구인지 알려주세요.' };
  };
  if (ref == null || ref === '') return useLast();
  const exact = items.find((i) => i.id === ref);
  if (exact) return { id: exact.id, item: exact };
  if (PRONOUNS.has(lower(ref).replace(/\s+/g, ''))) return useLast();
  const matches = items.filter((i) => textMatches(i, ref) && inRoom(i, roomRef, context.rooms));
  if (matches.length === 1) return { id: matches[0].id, item: matches[0] };
  if (matches.length === 0) return { error: `"${ref}"에 해당하는 가구를 찾지 못했어요.` };
  return {
    error: `"${ref}"가 ${matches.length}개 있어요. 어느 것인지 알려주세요.`,
    ambiguous: matches.map((m) => ({ id: m.id, title: m.title, room: m.room })),
  };
}

// 끝의 "(...)" 같은 부가 표기를 떼고 비교하기 좋게 다듬는다.
const clean = (s) => lower(s).replace(/\s*\([^)]*\)\s*$/, '').trim();

// 마감 이름 → 카탈로그의 마감 id. 모델이 라벨에 "(wall)" 등을 붙여 와도 맞춘다(양방향 부분일치).
export function resolveFinish(name, context) {
  const finishes = context.finishes ?? [];
  if (!name) return { error: '어떤 마감인지 알려주세요.' };
  const raw = lower(name).trim();
  const r = clean(name);
  const hit = finishes.find((f) => {
    const l = clean(f.label);
    return lower(f.id) === raw || l === r || (r && (l.includes(r) || r.includes(l)));
  });
  if (!hit) return { error: `"${name}" 마감을 카탈로그에서 찾지 못했어요.` };
  return { finishId: hit.id, label: hit.label };
}

// 가구 종류(kind) 확인: add_furniture용
export function resolveKind(kind, context) {
  const kinds = context.kinds ?? [];
  if (!kind) return { error: '어떤 가구를 놓을지 알려주세요.' };
  const r = clean(kind);
  const alias = ALIASES[r] || [];
  const hit = kinds.find((k) => {
    const t = clean(k.title), kk = lower(k.kind);
    return kk === r || t === r || (r && (t.includes(r) || r.includes(t))) ||
      alias.some((a) => kk.includes(lower(a)) || t.includes(lower(a)));
  });
  if (!hit) return { error: `"${kind}" 종류의 가구를 찾지 못했어요.` };
  return { kind: hit.kind, title: hit.title };
}

// 마감 범위에 해당하는 표면(face) 키들을 모은다.
function finishKeys(scope, roomRef, context) {
  const wantWall = scope === 'wall';
  return (context.faces ?? []).filter((face) => {
    if (wantWall ? face.kind !== 'wall' : face.kind !== 'floor') return false;
    if (!roomRef) return true;
    const r = lower(roomRef);
    const room = (context.rooms ?? []).find((x) => lower(x.id) === r || lower(x.name).includes(r));
    return !room || face.roomId === room.id;
  }).map((f) => f.key);
}

// 방향 라벨 → 평면 단위 벡터(미터, x는 좌우 z는 앞뒤). 모델이 좌표를 못 내므로 코드가 해석한다.
const DIR_VECTORS = {
  left: [-1, 0], right: [1, 0], front: [0, -1], back: [0, 1], forward: [0, -1], backward: [0, 1],
  왼쪽: [-1, 0], 오른쪽: [1, 0], 왼: [-1, 0], 오른: [1, 0], 앞: [0, -1], 뒤: [0, 1],
};
const dirVec = (d) => DIR_VECTORS[lower(d).trim()] ?? null;

// 방 이름/아이디로 방 중심 좌표를 찾는다(context.rooms에 center가 있어야 함).
function roomCenterOf(roomRef, context) {
  if (!roomRef) return null;
  const r = lower(roomRef).trim();
  const room = (context.rooms ?? []).find((x) => lower(x.id) === r || lower(x.name) === r || (r && lower(x.name).includes(r)));
  return room && Array.isArray(room.center) ? { x: room.center[0], z: room.center[1] } : null;
}

// 기준점(anchor)을 실제 좌표로 바꾼다. 좌표는 코드가 계산하고, 모델은 기준만 고른다.
function resolveAnchor(anchor, item, context) {
  const type = lower(anchor?.type ?? anchor?.kind).trim();
  if (type === 'room_center' || type === 'center' || type === '중앙' || type === '가운데') {
    const c = roomCenterOf(anchor.room ?? item.room, context);
    return c ? { to: c } : { error: '방 중심 위치를 알 수 없어요.' };
  }
  if (type === 'beside' || type === 'near' || type === 'next_to' || type === '옆') {
    const ref = resolveTarget(anchor.ref ?? anchor.target, context);
    if (ref.error) return { error: ref.error };
    const dist = isNumber(anchor.dist) ? anchor.dist : 0.8;
    const [sx, sz] = dirVec(anchor.side) ?? [1, 0];
    return { to: { x: ref.item.x + sx * dist, z: ref.item.z + sz * dist } };
  }
  if (type === 'direction' || type === 'relative' || type === 'move') {
    const v = dirVec(anchor.dir ?? anchor.direction ?? anchor.side);
    if (!v) return { error: '어느 방향으로 옮길지 모르겠어요.' };
    const dist = isNumber(anchor.dist) ? anchor.dist : 0.5;
    return { to: { x: item.x + v[0] * dist, z: item.z + v[1] * dist } };
  }
  return { error: '어디로 옮길지 알려주세요 (예: 방 중심, 소파 옆, 왼쪽).' };
}

// 허물 수 있는 벽 하나를 방 이름으로 찾는다(두 방 사이, 또는 한 방에 접한 벽).
function resolveSegment(roomRefs, context) {
  const segs = (context.segments ?? []).filter((s) => !s.removed && Array.isArray(s.roomNames));
  const wants = (Array.isArray(roomRefs) ? roomRefs : [roomRefs]).filter(Boolean).map((x) => lower(x).trim());
  if (!wants.length) return { error: '어느 벽을 허물지 알려주세요 (예: 거실과 주방 사이).' };
  const touches = (seg, w) => seg.roomNames.some((n) => { const l = lower(n); return l === w || l.includes(w) || w.includes(l); });
  const matches = segs.filter((seg) => wants.every((w) => touches(seg, w)));
  if (matches.length === 1) return { id: matches[0].id, seg: matches[0] };
  if (matches.length === 0) return { error: `${wants.join(', ')} 사이의 허물 수 있는 벽을 찾지 못했어요.` };
  return { error: `해당하는 벽이 ${matches.length}개예요. 더 구체적으로 알려주세요.`, ambiguous: matches.map((m) => ({ id: m.id, title: m.roomNames.join(' - ') })) };
}

// 모델이 {"add_furniture":{kind,room}}처럼 동작명을 키로 쓴 경우 {op,...인자}로 바꾼다.
// (작은 모델이 가끔 이 형태로 뱉는다.) 이미 op가 있으면 그대로 둔다.
export function normalizeCommand(command) {
  if (!command || typeof command !== 'object' || command.op) return command;
  const key = Object.keys(command).find((k) => OPS.includes(k));
  if (!key) return command;
  const payload = command[key];
  return { op: key, ...(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}) };
}

// 명령 하나를 해석해 실행 가능한 action으로 바꾼다.
// 반환: {ok:true, action, label} 또는 {ok:false, error, ambiguous?}
export function interpret(command, context) {
  command = normalizeCommand(command);
  if (!command || typeof command !== 'object') return { ok: false, error: '명령 형식이 올바르지 않아요.' };
  const op = command.op;
  if (!OPS.includes(op)) return { ok: false, error: `알 수 없는 동작이에요: ${op}` };

  if (op === 'undo' || op === 'redo') return { ok: true, action: { op }, label: op === 'undo' ? '되돌리기' : '다시 하기' };

  if (op === 'move_furniture') {
    const t = resolveTarget(command.target, context, command.room);
    if (t.error) return { ok: false, error: t.error, ambiguous: t.ambiguous };
    let x, z;
    if (command.to && isNumber(command.to.x) && isNumber(command.to.z)) { x = command.to.x; z = command.to.z; }
    else if (command.by && isNumber(command.by.dx) && isNumber(command.by.dz)) { x = t.item.x + command.by.dx; z = t.item.z + command.by.dz; }
    else if (command.anchor) { const a = resolveAnchor(command.anchor, t.item, context); if (a.error) return { ok: false, error: a.error }; x = a.to.x; z = a.to.z; }
    else return { ok: false, error: '옮길 위치(미터 좌표)나 기준점(방 중심, 소파 옆 등)이 필요해요.' };
    return { ok: true, action: { op, id: t.id, x: +x.toFixed(3), z: +z.toFixed(3) }, label: `${t.item.title} 이동` };
  }

  if (op === 'rotate_furniture') {
    const t = resolveTarget(command.target, context, command.room);
    if (t.error) return { ok: false, error: t.error, ambiguous: t.ambiguous };
    const deg = isNumber(command.deg) ? command.deg : 90;
    return { ok: true, action: { op, id: t.id, deg }, label: `${t.item.title} 회전` };
  }

  if (op === 'remove_furniture') {
    const t = resolveTarget(command.target, context, command.room);
    if (t.error) return { ok: false, error: t.error, ambiguous: t.ambiguous };
    return { ok: true, action: { op, id: t.id }, label: `${t.item.title} 빼기` };
  }

  if (op === 'add_furniture') {
    const k = resolveKind(command.kind, context);
    if (k.error) return { ok: false, error: k.error };
    return { ok: true, action: { op, kind: k.kind, room: command.room ?? null }, label: `${k.title} 추가` };
  }

  if (op === 'set_finish') {
    if (command.scope !== 'wall' && command.scope !== 'floor') return { ok: false, error: '마감 범위는 벽 또는 바닥이어야 해요.' };
    const f = resolveFinish(command.finish, context);
    if (f.error) return { ok: false, error: f.error };
    const keys = finishKeys(command.scope, command.room, context);
    if (!keys.length) return { ok: false, error: '바꿀 표면을 찾지 못했어요.' };
    return { ok: true, action: { op, keys, finishId: f.finishId }, label: `${command.scope === 'wall' ? '벽' : '바닥'} ${f.label}` };
  }

  // 비활성(OPS에서 제외됨). 세그먼트 식별 보강 후 OPS에 되살리면 동작. 아래는 보존된 구현.
  if (op === 'demolish_wall') {
    const s = resolveSegment(command.rooms ?? command.between ?? command.room ?? command.target, context);
    if (s.error) return { ok: false, error: s.error, ambiguous: s.ambiguous };
    return { ok: true, action: { op, id: s.id }, label: `${s.seg.roomNames.join(' - ')} 벽 허물기` };
  }

  if (op === 'query_estimate') return { ok: true, action: { op }, label: '견적 조회' };

  if (op === 'query_count') {
    const ref = command.kind ?? command.target ?? command.furniture;
    const items = context.furniture ?? [];
    const matched = ref ? items.filter((i) => textMatches(i, ref)) : items;
    const name = ref ? (matched[0]?.title ?? String(ref)) : '가구';
    return { ok: true, action: { op, text: ref ? `지금 ${name} ${matched.length}개 있어요.` : `지금 가구가 ${matched.length}개 있어요.` }, label: '개수 조회' };
  }

  return { ok: false, error: `처리할 수 없는 동작이에요: ${op}` };
}
