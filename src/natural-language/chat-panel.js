// Cortex AI 대화창 (떠 있는 토글 패널).
// 입력을 모델 연결부(provider)로 보내 명령을 받고, 명령 실행기(runner)로 적용한다.
// 프레임워크 없이 순수 DOM으로 만든다. 기본은 숨김 상태이고, open/close/toggle로 연다.
import { runCommands } from './command-runner.js';

// 패널 스타일은 한 번만 주입한다(공용 CSS 파일을 건드리지 않기 위해).
const STYLE_ID = 'cortex-ai-style';
function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.cortex-ai-panel{position:fixed;right:20px;bottom:20px;z-index:60;width:340px;max-width:calc(100vw - 32px);
  max-height:min(560px,70vh);display:flex;flex-direction:column;background:#fff;color:#1d2a24;
  border:1px solid #d8ded6;border-radius:12px;box-shadow:0 12px 32px rgba(20,40,30,.18);
  font:14px/1.5 "Pretendard Variable",Pretendard,system-ui,sans-serif;overflow:hidden}
.cortex-ai-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #e8ece7;background:#f4f7f2}
.cortex-ai-head strong{font-size:14px;letter-spacing:.3px}
.cortex-ai-head .cortex-ai-beta{font-size:11px;color:#6c7b72;border:1px solid #cfd8cf;border-radius:999px;padding:1px 7px}
.cortex-ai-clear{margin-left:auto;border:0;background:transparent;font-size:12px;color:#6c7b72;cursor:pointer;padding:3px 7px;border-radius:6px}
.cortex-ai-clear:hover{background:#e6ebe4;color:#1d2a24}
.cortex-ai-close{border:0;background:transparent;font-size:18px;line-height:1;color:#6c7b72;cursor:pointer;padding:2px 6px;border-radius:6px}
.cortex-ai-close:hover{background:#e6ebe4;color:#1d2a24}
.nl-log{list-style:none;margin:0;padding:12px 14px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:8px}
.nl-msg{padding:8px 11px;border-radius:10px;max-width:85%;white-space:pre-wrap;word-break:break-word}
.nl-user{align-self:flex-end;background:#315744;color:#fff;border-bottom-right-radius:3px}
.nl-ai{align-self:flex-start;background:#eef1ec;color:#1d2a24;border-bottom-left-radius:3px}
.nl-empty{color:#8a978e;text-align:center;font-size:13px;margin:auto 0}
.nl-help{margin:auto 0;padding:4px 2px;list-style:none}
.nl-help-title{font-size:13px;color:#6c7b72;text-align:center;margin:0 0 12px}
.nl-help-group{margin-bottom:10px}
.nl-help-label{font-size:11px;color:#8a978e;margin:0 0 5px}
.nl-chips{display:flex;flex-wrap:wrap;gap:6px}
.nl-chip{border:1px solid #cfd8cf;background:#f4f7f2;color:#2f5241;border-radius:999px;padding:5px 10px;font:inherit;font-size:12px;cursor:pointer;text-align:left}
.nl-chip:hover{background:#e6ebe4}
.nl-form{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #e8ece7;background:#fff}
.nl-input{flex:1;min-width:0;border:1px solid #cfd8cf;border-radius:8px;padding:9px 11px;font:inherit;color:inherit}
.nl-input:focus{outline:2px solid #9fb8a9;outline-offset:-1px}
.nl-send{border:0;background:#315744;color:#fff;border-radius:8px;padding:9px 14px;font:inherit;cursor:pointer}
.nl-send:disabled{opacity:.6;cursor:default}
`;
  document.head.append(style);
}

// 대화 기록을 브라우저(localStorage)에 남긴다. DB 없이 이 브라우저에서만 유지된다.
// storageKey로 집(평면)별로 따로 저장할 수 있다.
function loadHistory(key) {
  try { const raw = localStorage.getItem(key); const arr = raw ? JSON.parse(raw) : null; return Array.isArray(arr) ? arr : []; }
  catch { return []; }
}
function saveHistory(key, msgs) {
  try { localStorage.setItem(key, JSON.stringify(msgs.slice(-100))); } catch { /* 저장 실패는 무시 */ }
}

export function createChatPanel({ mount, provider, api, getContext, storageKey = 'cortex-ai-chat' }) {
  ensureStyle();
  const panel = document.createElement('aside');
  panel.className = 'cortex-ai-panel';
  panel.setAttribute('aria-label', 'Cortex AI 편집 도우미');
  panel.hidden = true;
  panel.innerHTML = `
    <header class="cortex-ai-head">
      <strong>Cortex AI</strong><span class="cortex-ai-beta">베타</span>
      <button class="cortex-ai-clear" type="button" aria-label="대화 지우기" title="대화 지우기">지우기</button>
      <button class="cortex-ai-close" type="button" aria-label="닫기">×</button>
    </header>
    <ul class="nl-log" aria-live="polite"></ul>
    <form class="nl-form">
      <input class="nl-input" type="text" autocomplete="off" placeholder="바꾸고 싶은 걸 말해 보세요" aria-label="편집 요청">
      <button class="nl-send" type="submit">보내기</button>
    </form>`;

  const log = panel.querySelector('.nl-log');
  const input = panel.querySelector('.nl-input');
  const form = panel.querySelector('.nl-form');
  // AI에 할 수 있는 말 예시. 칩을 누르면 바로 실행된다.
  const EXAMPLES = [
    { label: '옮기기', items: ['소파를 거실 중앙으로', '소파를 식탁 옆으로', '식탁을 왼쪽으로 옮겨줘'] },
    { label: '돌리기', items: ['소파를 90도 돌려줘'] },
    { label: '놓기 · 빼기', items: ['거실에 식탁 놔줘', '의자 빼줘'] },
    { label: '마감 바꾸기', items: ['거실 벽을 밝은 회색으로', '거실 바닥을 오크로'] },
    { label: '견적 · 개수', items: ['견적 얼마야?', '소파 몇 개야?'] },
    { label: '되돌리기', items: ['방금 거 되돌려', '다시 실행해줘'] },
  ];

  const msgs = loadHistory(storageKey);   // [{who, text}]
  const renderMsg = (m) => {
    const li = document.createElement('li');
    li.className = `nl-msg nl-${m.who}`;
    li.textContent = m.text;
    log.append(li);
  };
  // 대화가 없을 때 보여주는 예시 목록(칩 클릭 시 바로 실행).
  const showHelp = () => {
    const li = document.createElement('li');
    li.className = 'nl-help';
    const title = document.createElement('p');
    title.className = 'nl-help-title';
    title.textContent = '이렇게 말해보세요 (눌러도 돼요)';
    li.append(title);
    for (const group of EXAMPLES) {
      const box = document.createElement('div');
      box.className = 'nl-help-group';
      const label = document.createElement('p');
      label.className = 'nl-help-label';
      label.textContent = group.label;
      const chips = document.createElement('div');
      chips.className = 'nl-chips';
      for (const text of group.items) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'nl-chip';
        chip.textContent = text;
        chip.addEventListener('click', () => send(text));
        chips.append(chip);
      }
      box.append(label, chips);
      li.append(box);
    }
    log.replaceChildren(li);
  };

  // 저장된 대화 복원(없으면 예시 목록).
  if (msgs.length) { log.replaceChildren(); msgs.forEach(renderMsg); log.scrollTop = log.scrollHeight; }
  else showHelp();

  const say = (who, text) => {
    if (log.querySelector('.nl-help')) log.replaceChildren();   // 예시 목록 제거
    msgs.push({ who, text });
    saveHistory(storageKey, msgs);
    renderMsg({ who, text });
    log.scrollTop = log.scrollHeight;
  };
  panel.querySelector('.cortex-ai-clear').addEventListener('click', () => {
    msgs.length = 0; saveHistory(storageKey, msgs); showHelp();
  });

  // 직전에 다룬 가구(대명사·대상 생략 해석용). 이 브라우저 세션 동안만 기억한다(B2 대화 맥락).
  let lastTarget = null;

  async function send(text) {
    text = String(text || '').trim();
    if (!text || input.disabled) return;
    say('user', text);
    input.value = '';
    input.disabled = true;
    try {
      const context = { ...getContext(), lastTarget };
      const { commands, reply, mode } = await provider.propose(text, context);
      if (!commands?.length) {
        // 편집 명령이 아니면(인사·질문·모호) 어시스턴트 답변을 보여준다.
        say('ai', reply || '무슨 뜻인지 잘 모르겠어요. 다시 말해 줄래요?');
        return;
      }
      const result = await runCommands(commands, { api, context });
      if (result.info) { say('ai', result.info.join('\n')); return; }
      if (result.applied) {
        // 다음 턴에 "그거/돌려줘"로 이어 말할 수 있게 직전 대상을 갱신한다.
        if (result.targetId) { const it = (context.furniture ?? []).find((f) => f.id === result.targetId); if (it) lastTarget = { id: it.id, title: it.title }; }
        say('ai', `적용했어요 (${mode}): ${result.steps.map((s) => s.label ?? s.op).join(', ')}`);
      } else {
        const hint = result.ambiguous ? ` 후보: ${result.ambiguous.map((a) => a.title).join(', ')}` : '';
        say('ai', (result.reason ?? '적용하지 못했어요.') + hint);
      }
    } catch (error) {
      say('ai', `문제가 생겼어요: ${error.message}`);
    } finally {
      input.disabled = false;
      input.focus();
    }
  }
  form.addEventListener('submit', (event) => { event.preventDefault(); send(input.value); });

  const open = () => { panel.hidden = false; input.focus(); };
  const close = () => { panel.hidden = true; };
  const toggle = () => { panel.hidden ? open() : close(); };
  panel.querySelector('.cortex-ai-close').addEventListener('click', close);

  (mount ?? document.body).append(panel);
  return { panel, say, open, close, toggle, isOpen: () => !panel.hidden, destroy: () => panel.remove() };
}
