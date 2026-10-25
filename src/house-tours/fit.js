// "우리 집에 적용하기" check: plans a tour's concept on the tour's plan and on the
// viewer's plan with the same planner the studio uses, then explains piece by piece what
// carries over unchanged, what moves or is swapped, and what cannot come along.
// Pure functions; plan inputs (rooms, doors) are passed in.
import { planConcept } from '../concepts/planner.js';
import { FURNITURE } from '../concepts/furniture-spec.js';

// Model furniture every concept keeps, at its staging footprint in the v3 GLBs
// (identical in both plans; checked against the live model by the browser tests).
export const KEPT = { king: { id: 'king-bed', kind: 'king', x: 11.34, z: 6.32, width: 2.158, depth: 1.7953, height: 1.14, angle: 0 } };
export const keptFor = (concept) => concept.keep.map((kind) => KEPT[kind]).filter(Boolean);

const SAME = 0.05; // m: closer than this counts as the same spot

/** Korean particle after a word: josa('거실', '이', '가') → '거실이'. */
export function josa(word, withFinal, withoutFinal) {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0) - 0xac00;
  const final = code >= 0 && code <= 11171 ? code % 28 !== 0 : /[013678lmnr]$/i.test(last);
  // 로/으로: a final ㄹ takes 로.
  if (withoutFinal === '로' && code >= 0 && code % 28 === 8) return word + '로';
  return word + (final ? withFinal : withoutFinal);
}

const meters = (value) => `${value.toFixed(2)}m`;
const sizeOf = (room) => room && { x: room.bounds_m[2] - room.bounds_m[0], z: room.bounds_m[3] - room.bounds_m[1] };

/** How a room's size differs between plans, e.g. "세로 3.63m → 2.28m". */
export function roomChange(from, to) {
  if (!from || !to) return null;
  const a = sizeOf(from), b = sizeOf(to), parts = [];
  if (Math.abs(a.x - b.x) > 0.02) parts.push(`가로 ${meters(a.x)} → ${meters(b.x)}`);
  if (Math.abs(a.z - b.z) > 0.02) parts.push(`세로 ${meters(a.z)} → ${meters(b.z)}`);
  return parts.length ? { text: parts.join(' · '), smaller: b.x * b.z < a.x * a.z - 0.01 } : null;
}

/**
 * Compares one concept laid out on two plans.
 * source / target: { variant, rooms, doors } (rooms from navigationRooms).
 * Returns per-piece entries, per-room groups, counts and an overall verdict.
 */
export function compareFit(concept, source, target) {
  const existing = keptFor(concept);
  const from = planConcept(concept, { ...source, existing });
  const to = planConcept(concept, { ...target, existing });
  const roomName = (id, rooms) => concept.rooms?.[id] ?? rooms.find((r) => r.id === id)?.name_ko ?? id;
  const items = [];
  for (const s of from.placements) {
    const t = to.placements.find((p) => p.index === s.index);
    const sourceRoom = source.rooms.find((r) => r.id === s.room);
    const targetRoom = target.rooms.find((r) => r.id === (t?.room ?? s.room));
    const name = roomName(s.room, source.rooms);
    const change = roomChange(sourceRoom, targetRoom);
    const decor = Boolean(FURNITURE[s.kind].decor);
    const entry = { index: s.index, kind: s.kind, title: s.title, room: s.room, roomName: name, decor, from: s, to: t ?? null };
    if (!t) {
      const skip = to.skipped.find((k) => k.index === s.index);
      entry.status = 'excluded';
      entry.reason = !targetRoom
        ? `우리 집에는 ${josa(name, '이', '가')} 없어요.`
        : change?.smaller
          ? `${josa(name, '이', '가')} 작아져(${change.text}) 다른 가구·문과 겹치지 않는 자리가 없어요.`
          : skip?.reason === '이 평면에서는 생략해요.' ? '이 평면에서는 빼도록 정해 둔 가구예요.' : '다른 가구·문과 겹치지 않는 자리가 없어요.';
      entry.short = change?.smaller ? '방이 작아져 놓을 자리가 없어요.' : entry.reason;
      if (decor) { entry.reason += ' 소품이라 빼도 생활에는 지장이 없어요.'; entry.short += ' 소품이라 빼도 괜찮아요.'; }
    } else if (t.kind !== s.kind) {
      entry.status = 'replaced';
      // Back to the concept's first choice when the home has room for it, else a smaller fallback.
      const original = (s.overridden && !t.overridden) || t.option < s.option;
      entry.reason = t.note ?? (original
        ? `우리 집에는 원래 구성인 ${josa(t.title, '이', '가')} 들어가요.`
        : `${change ? `${name} ${change.text}에 맞춰 ` : ''}${josa(t.title, '으로', '로')} 바꿨어요.`);
      entry.short = t.note ?? (original ? entry.reason : `방 크기에 맞춰 ${josa(t.title, '으로', '로')} 바꿨어요.`);
    } else if (t.room !== s.room) {
      entry.status = 'moved';
      entry.reason = entry.short = `${josa(roomName(t.room, target.rooms), '으로', '로')} 옮겨요.`;
    } else {
      const moved = Math.hypot(t.x - s.x, t.z - s.z), turned = Math.abs(t.angle - s.angle) > 1e-3;
      if (moved < SAME && !turned) entry.status = 'same';
      else {
        // Same rule, different room size: the arrangement carries over, only the spot shifts.
        entry.status = 'moved';
        entry.distance = moved;
        entry.reason = turned ? '방향을 돌려 자리를 맞췄어요.'
          : change ? `${name} 크기(${change.text})에 맞춰 ${meters(moved)} 옮겨요.`
            : '다른 가구를 피해 자리를 조금 옮겨요.';
        entry.short = turned ? entry.reason : change ? `배치는 그대로, 자리만 ${meters(moved)} 옮겨요.` : entry.reason;
      }
    }
    items.push(entry);
  }
  const counts = { same: 0, moved: 0, replaced: 0, excluded: 0 };
  for (const item of items) counts[item.status] += 1;
  const blocking = items.filter((i) => i.status === 'excluded' && !i.decor).length;
  // Swapped pieces and dropped decor change what the home looks like; shifted spots do not.
  const changed = counts.replaced + (counts.excluded - blocking);
  const verdict = blocking ? 'partial' : changed ? 'adjusted' : counts.moved ? 'fitted' : 'same';
  // Room groups in the source layout's order, with the room size change if any.
  const rooms = [];
  for (const item of items) {
    let group = rooms.find((g) => g.id === item.room);
    if (!group) {
      const change = roomChange(source.rooms.find((r) => r.id === item.room), target.rooms.find((r) => r.id === item.room));
      group = { id: item.room, name: item.roomName, change: change?.text ?? null, items: [] };
      rooms.push(group);
    }
    group.items.push(item);
  }
  return { verdict, counts, changed, blocking, items, rooms, notes: to.notes, from, to };
}

/** Wording for a verdict: gallery badge, sheet title and a one-line explanation. */
export function verdictText(fit) {
  const { moved } = fit.counts;
  const shift = moved ? `나머지는 방 크기에 맞춰 ${moved}개 자리만 옮겨요.` : '';
  if (fit.verdict === 'same') return { badge: '우리 집에 그대로', title: '그대로 가져갈 수 있어요', detail: '가구 종류와 자리가 모두 같아요.' };
  if (fit.verdict === 'fitted') return { badge: '자리만 맞춤', title: '배치 그대로 가져갈 수 있어요', detail: `가구는 모두 같고, 방 크기에 맞춰 ${moved}개 자리만 옮겨요.` };
  if (fit.verdict === 'adjusted') return { badge: `${fit.changed}개 바뀜`, title: `${fit.changed}개를 우리 집에 맞게 바꿔요`, detail: shift || '나머지는 그대로예요.' };
  return { badge: `${fit.blocking}개 제외`, title: `${fit.blocking}개는 우리 집에 가져갈 수 없어요`, detail: shift || '나머지는 그대로 가져가요.' };
}

/** True when a tour comes over without swapping or dropping furniture. */
export const fitsAsIs = (fit) => fit.verdict === 'same' || fit.verdict === 'fitted';
