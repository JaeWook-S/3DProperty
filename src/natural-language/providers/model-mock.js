// 연습용 가짜 모델.
// 실제 LLM 없이 고정 규칙으로 한국어 지시를 명령(JSON)으로 바꾼다.
// 파이프라인(검사 -> 적용 -> 되돌리기)을 GPU/AI 없이 테스트하는 용도.
// 진짜 모델은 providers/model-local.js가 담당한다.

const WORDS = ['소파', '침대', '책상', '의자', '식탁', '옷장', '수납장', '티비', 'tv', '러그', '조명'];

function firstTarget(text, context) {
  const hit = WORDS.find((w) => text.includes(w));
  if (hit) return hit;
  // 대명사면 대상을 비워 코드가 직전 대상(lastTarget)으로 해석하게 한다(B2).
  if (/그거|그걸|그것|이거|이걸|저거|방금|아까/.test(text)) return null;
  return (context.furniture ?? [])[0]?.title ?? null;
}

const HELP = '가구를 옮기거나 돌리고, 추가·제거하고, 벽/바닥 마감을 바꾸거나 되돌릴 수 있어요. 예: "소파를 90도 돌려줘", "거실 벽을 밝은 회색으로".';

export function createMockProvider() {
  return {
    name: 'mock',
    // 반환: {commands:[...], reply, mode:'mock', raw}
    async propose(utterance, context) {
      const text = String(utterance || '');
      const commands = [];

      // 인사·도움말엔 어시스턴트처럼 대답(실제 편집은 아래 규칙 매칭).
      if (/^\s*(안녕|하이|헬로|반가|ㅎㅇ|hi|hello|hey)/i.test(text)) {
        return { commands: [], reply: `안녕하세요! ${HELP} 무엇을 바꿔드릴까요?`, mode: 'mock', raw: text };
      }
      if (/(뭐.*할 수|무엇.*할 수|할 수 있|기능|도움|사용법|어떻게 (써|쓰|해)|help)/i.test(text)) {
        return { commands: [], reply: HELP, mode: 'mock', raw: text };
      }

      if (/되돌려|되돌리기|취소/.test(text)) {
        commands.push({ op: 'undo' });
      } else if (/다시( 해| 적용)?|리두/.test(text)) {
        commands.push({ op: 'redo' });
      } else if (/견적|비용|가격|얼마|금액/.test(text)) {
        commands.push({ op: 'query_estimate' });
      } else if (/몇\s*개|개수/.test(text)) {
        commands.push({ op: 'query_count', kind: WORDS.find((w) => text.includes(w)) ?? null });
      } else if (/허물|철거/.test(text)) {
        const ROOMS = ['거실', '주방', '안방', '침실', '작은 방', '욕실', '현관', '방'];
        commands.push({ op: 'demolish_wall', rooms: ROOMS.filter((r) => text.includes(r)) });
      } else if (/(돌려|회전)/.test(text)) {
        commands.push({ op: 'rotate_furniture', target: firstTarget(text, context), deg: 90 });
      } else if (/(빼|제거|치워|삭제)/.test(text)) {
        commands.push({ op: 'remove_furniture', target: firstTarget(text, context) });
      } else if (/(놔|놓아|추가|넣어)/.test(text)) {
        commands.push({ op: 'add_furniture', kind: firstTarget(text, context) });
      } else if (/(벽|바닥)/.test(text) && /(색|마감|바꿔|벽지|타일)/.test(text)) {
        const scope = /바닥/.test(text) ? 'floor' : 'wall';
        const finish = (context.finishes ?? [])[0]?.label ?? '';
        commands.push({ op: 'set_finish', scope, finish });
      } else if (/(옮겨|이동|로 가|쪽으로|중앙|가운데|옆)/.test(text)) {
        const target = firstTarget(text, context);
        if (/중앙|가운데/.test(text)) {
          commands.push({ op: 'move_furniture', target, anchor: { type: 'room_center' } });
        } else if (/옆/.test(text)) {
          const ref = WORDS.filter((w) => text.includes(w)).find((w) => w !== target) ?? null;
          commands.push({ op: 'move_furniture', target, anchor: { type: 'beside', ref } });
        } else {
          const dir = /왼/.test(text) ? 'left' : /오른/.test(text) ? 'right' : /앞/.test(text) ? 'front' : /뒤/.test(text) ? 'back' : 'right';
          commands.push({ op: 'move_furniture', target, anchor: { type: 'direction', dir } });
        }
      }

      // 아무 규칙도 안 맞으면 어시스턴트답게 되묻는다.
      const reply = commands.length ? '' : `무슨 말인지 잘 모르겠어요. ${HELP}`;
      return { commands, reply, mode: 'mock', raw: text };
    },
  };
}
