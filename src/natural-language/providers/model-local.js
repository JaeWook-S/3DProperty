// 로컬 모델 연결부.
// vLLM 또는 Ollama로 띄운 로컬 Qwen에 OpenAI 호환 방식으로 질문한다.
// 서버가 떠 있지 않으면 호출은 실패한다(2단계에서 사용).
// 서버 띄우는 법은 services/natural_language/README.md 참고.
import { OPS } from '../command-format.js';

// 모델에게 줄 지시문과 현재 상태. JSON만 뱉도록 강하게 유도한다.
export function buildMessages(utterance, context) {
  const furniture = (context.furniture ?? []).map((f) => ({ id: f.id, title: f.title, kind: f.kind, x: f.x, z: f.z, room: f.room }));
  const rooms = (context.rooms ?? []).map((r) => ({ id: r.id, name: r.name }));
  // 놓을 수 있는 가구 종류(title)와 마감(label). 모델이 실제 카탈로그에서 고르게 하려고 그대로 보여준다.
  const kindTitles = (context.kinds ?? []).map((k) => k.title);
  const finishLabels = (context.finishes ?? []).map((f) => `${f.label}${f.surfaces ? ` (${f.surfaces.join('/')})` : ''}`);
  const system = [
    '너는 이 집의 인테리어 3D 편집을 돕는 한국어 AI 어시스턴트 "Cortex AI"야.',
    '사용자의 말을 보고 JSON 하나만 출력한다(설명·코드블록 없이). 형식: {"commands":[...], "reply":"..."}',
    '- 편집 요청이면: commands에 동작을 채우고 reply는 "" 로 둔다.',
    '- 인사·감사·잡담, 네가 뭘 할 수 있냐는 질문, 또는 모호해서 바로 실행 못 할 때: commands는 [] 로 두고 reply에 한국어 1~2문장으로 친근하게 답한다. 단 항상 인테리어 편집(가구 이동·회전·추가·제거, 벽/바닥 마감, 되돌리기) 범위에서 안내하거나 되묻는다.',
    '- 인테리어와 무관한 요청(날씨·코딩 등)이면 commands []·reply로 "저는 이 집 인테리어 편집을 도와드려요"라고 정중히 선을 긋는다.',
    `가능한 동작(op): ${OPS.join(', ')}`,
    '각 동작의 인자:',
    '  move_furniture {target, to:{x,z}} 또는 {target, anchor:{...}}   좌표를 모르면 to 대신 anchor를 쓴다(좌표를 지어내지 마라).',
    '    anchor 종류: {"type":"room_center","room":"거실"} 방 중심 / {"type":"beside","ref":"식탁","side":"left|right|front|back"} 다른 가구 옆 / {"type":"direction","dir":"left|right|front|back","dist":0.5} 방향 이동',
    '  rotate_furniture {target, deg}      deg는 90의 배수',
    '  add_furniture {kind, room}          kind는 "놓을 수 있는 가구" 목록의 title 중 하나를 그대로 쓴다',
    '  remove_furniture {target}',
    '  set_finish {scope:"wall"|"floor", room, finish}   finish는 "마감 목록"의 label 중 하나를 그대로 쓴다',
    '  query_estimate {}   사용자가 견적·비용·가격·총액을 물을 때.',
    '  query_count {kind}   사용자가 특정 가구가 몇 개인지 물을 때(전체면 kind 생략).',
    '  undo {}   redo {}',
    '규칙: target은 "현재 가구" 목록에 있는 것만. kind/finish는 아래 목록에 있는 것만 쓴다(영어로 지어내지 마라).',
    '각 명령은 {"op":"동작명", ...인자} 꼴로 쓴다. 동작명을 키로 중첩하지 마라.',
    '"창가/창문 쪽"처럼 창문 기준 위치는 지원하지 않는다. 이때는 move를 실행하지 말고 commands를 비운 뒤 reply로 방 중심이나 다른 가구 기준을 제안하거나 어느 쪽인지 되묻는다(좌표를 지어내지 마라).',
    '"놓아줘/놔줘/추가해줘/하나 더"는 항상 add_furniture로 처리한다(같은 종류가 이미 있어도 새로 추가). move_furniture는 "옮겨/이동"처럼 기존 가구의 위치를 바꿀 때만 쓰고, 이때 to 좌표를 임의로 지어내지 않는다.',
    '"몇 개", "개수"처럼 수를 물으면 직접 세어 reply하지 말고 query_count를 쓴다. 특정 가구를 물으면 그 가구 이름을 kind에 넣는다(예: "소파 몇 개" -> {"op":"query_count","kind":"소파"}).',
    '대상(target)을 말하지 않거나 "그거/이거/방금 거/아까"라고 하면 "직전_대상"의 title을 target으로 쓴다. 직전_대상이 없으면 commands를 비우고 reply로 무엇을 할지 되묻는다.',
    '예) 편집: {"commands":[{"op":"rotate_furniture","target":"소파","deg":90}],"reply":""}',
    '예) 기준 배치: {"commands":[{"op":"move_furniture","target":"소파","anchor":{"type":"room_center","room":"거실"}}],"reply":""}',
    '예) 대명사(직전_대상이 소파일 때 "돌려줘"): {"commands":[{"op":"rotate_furniture","target":"소파","deg":90}],"reply":""}',
    '예) 견적: {"commands":[{"op":"query_estimate"}],"reply":""}',
    '예) 인사: {"commands":[],"reply":"안녕하세요! 소파를 옮기거나 벽·바닥 마감을 바꿔드릴 수 있어요. 무엇을 바꿔드릴까요?"}',
    '예) 모호: {"commands":[],"reply":"어떤 가구를 옮길까요? 예를 들어 \\"소파를 창가로\\"처럼 말씀해 주세요."}',
  ].join('\n');
  const state = JSON.stringify({
    현재_가구: furniture,
    방: rooms,
    놓을_수_있는_가구: kindTitles,
    마감_목록: finishLabels,
    직전_대상: context.lastTarget?.title ? { title: context.lastTarget.title } : null,
  }, null, 0);
  return [
    { role: 'system', content: system },
    { role: 'user', content: `현재 상태:\n${state}\n\n요청: ${utterance}` },
  ];
}

// 모델 응답 텍스트에서 JSON 한 덩어리만 뽑아낸다.
export function extractJson(text) {
  const fenced = String(text || '').match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : String(text || '');
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < 0 || end < start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
}

// 기본 baseUrl은 '/nl-llm/v1' — Vite 프록시가 이 경로를 로컬 vLLM(8001)으로 넘긴다.
// 덕분에 브라우저는 같은 출처(5173)로만 호출하고, 노트북은 5173 하나만 SSH 포워딩하면 된다.
// 직접 붙일 땐 VITE_NL_BASE_URL로 절대주소(예: http://127.0.0.1:8001/v1) 지정 가능.
// 기본 모델은 가벼운 텍스트 instruct Qwen(Qwen3-4B-Instruct-2507). 이 작업엔 충분하고 로딩·VRAM이 가볍다.
export function createLocalProvider({
  baseUrl = '/nl-llm/v1',
  model = 'Qwen/Qwen3-4B-Instruct-2507',
  apiKey = 'local',
  timeoutMs = 20000,
} = {}) {
  return {
    name: `local:${model}`,
    async propose(utterance, context) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`${String(baseUrl).replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          // chat_template_kwargs.enable_thinking=false: Qwen3의 생각 과정 출력을 꺼서 JSON만 받는다(vLLM 전용, 다른 서버는 무시).
          body: JSON.stringify({ model, messages: buildMessages(utterance, context), temperature: 0, stream: false, chat_template_kwargs: { enable_thinking: false } }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`로컬 모델 서버 오류 (HTTP ${res.status})`);
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content ?? '';
        const parsed = extractJson(text);
        const commands = Array.isArray(parsed?.commands) ? parsed.commands : [];
        const reply = typeof parsed?.reply === 'string' ? parsed.reply.trim() : '';
        return { commands, reply, mode: 'local', raw: text };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
