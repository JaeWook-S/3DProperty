// 자연어 편집 모듈 엔트리.
// interior.api와 UI 마운트 지점을 받아 대화창을 조립한다.
// 기본 모델은 가짜 모델(mock). 환경변수로 로컬 모델(Qwen)로 바꿀 수 있다.
//
// 환경변수(.env 또는 빌드 설정):
//   VITE_NL_PROVIDER = mock | local   (기본 mock)
//   VITE_NL_BASE_URL = http://127.0.0.1:8000/v1   (local일 때)
//   VITE_NL_MODEL    = Qwen/Qwen2.5-7B-Instruct
//
// hooks로 받는 것:
//   hooks.ui         : 패널을 붙일 DOM 요소 (없으면 document.body)
//   hooks.interior   : createInteriorStudio가 돌려준 객체 (interior.api 사용)
//   hooks.getContext : (선택) 현재 상태를 돌려주는 함수. 없으면 api에서 모은다.
import { createChatPanel } from './chat-panel.js';
import { createMockProvider } from './providers/model-mock.js';
import { createLocalProvider } from './providers/model-local.js';

function pickProvider(env) {
  if (String(env.VITE_NL_PROVIDER ?? 'mock') === 'local') {
    return createLocalProvider({ baseUrl: env.VITE_NL_BASE_URL, model: env.VITE_NL_MODEL });
  }
  return createMockProvider();
}

export function createNaturalLanguageStudio(hooks = {}) {
  const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
  const provider = pickProvider(env);
  const api = hooks.interior?.api ?? hooks.api;
  if (!api) throw new Error('자연어 편집 모듈에는 interior.api가 필요해요.');

  const getContext = hooks.getContext ?? (() => ({
    furniture: api.furniture?.() ?? [],
    faces: api.faces?.() ?? [],
    rooms: hooks.rooms?.() ?? [],
    finishes: hooks.finishes?.() ?? [],
    kinds: hooks.kinds?.() ?? [],
  }));

  const chat = createChatPanel({ mount: hooks.ui, provider, api, getContext });
  return {
    provider,
    chat,
    // 떠 있는 패널 열고/닫기 (studio 헤더의 'Cortex AI' 버튼이 호출).
    open: chat.open,
    close: chat.close,
    toggle: chat.toggle,
    isOpen: chat.isOpen,
    // 테스트/자동화용: UI 없이 한 줄 요청을 처리한다.
    api: { propose: (text) => provider.propose(text, getContext()) },
  };
}
