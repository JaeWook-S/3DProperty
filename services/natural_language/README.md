# 자연어 편집용 로컬 모델 서버

웹의 `src/natural-language/providers/model-local.js`가 호출하는 로컬 LLM 서버를 띄우는 방법.
OpenAI 호환 `/v1/chat/completions`를 쓰므로, 아래 둘 중 아무 방식이나 주소만 맞추면 된다.

> 주의: 아래 명령은 GPU와 수 GB 다운로드가 필요하다. 실행 전 `gpustat`으로 빈 GPU를 확인하고,
> GPU 번호를 직접 지정한다. 같은 GPU에 동시 CUDA 프로세스는 최대 4개. base conda 환경은 건드리지 않는다.

## 모델 선택
- 기본값 `Qwen/Qwen3-4B-Instruct-2507` (가벼운 instruct, 이 작업엔 충분·로딩/VRAM 가벼움).
- 더 정확하게: `Qwen/Qwen3-8B` 또는 `Qwen/Qwen3-14B`.
- 참고: 더 최신인 Qwen3.5/3.6/3.8은 비전(image-text-to-text) 모델이라 이 텍스트 작업엔 쓰지 않는다.
- Qwen3는 생각(thinking) 모드가 있어, 구조화 출력을 위해 요청에서 `enable_thinking=false`로 끈다(web의 model-local.js가 이미 처리).

## 방식 A. Ollama (간단, 빠른 시작)
설치되어 있다면:
```bash
# 모델 받기 (양자화본)
ollama pull qwen3:4b
# 서버는 보통 자동 실행(http://127.0.0.1:11434). 수동이면:
ollama serve
```
웹 환경변수:
```
VITE_NL_PROVIDER=local
VITE_NL_BASE_URL=http://127.0.0.1:11434/v1
VITE_NL_MODEL=qwen3:4b-instruct
```

## 방식 B. vLLM (더 빠름, 서버 권장)
named conda 환경에서(절대 base 아님. env 이름엔 intern_ prefix):
```bash
conda create -n intern_nl-serve python=3.11 -y
conda activate intern_nl-serve
# 이 서버 드라이버는 575(CUDA 12.9)라 cu12 빌드로 고정한다. 최신 vllm 기본(0.33+)은 CUDA 13 빌드라 드라이버 too old로 실패.
pip install "vllm==0.11.0"
# 빈 GPU 번호를 직접 지정 (예: 7번). 이 서버는 8000이 이미 쓰여 포트 8001 사용.
bash services/natural_language/serve_qwen.sh 7 Qwen/Qwen3-4B-Instruct-2507 8001
```
웹 실행(Vite 프록시 사용 — 노트북에서 **5173 하나만** SSH 포워딩하면 됨):
```
VITE_NL_PROVIDER=local npm run dev
# 브라우저는 같은 출처의 /nl-llm/v1 로 호출 → Vite가 로컬 vLLM(8001)으로 프록시(vite.config.js).
# 노트북 터널:  ssh -L 5173:localhost:5173 yj1-H200-kinamkim   (8001 터널 불필요)
# 프록시 대상 변경: VITE_NL_PROXY_TARGET=http://127.0.0.1:8001 (기본)
# 8001에 직접 붙으려면(프록시 우회): VITE_NL_BASE_URL=http://127.0.0.1:8001/v1 + 8001도 포워딩
```

## 연결 확인
서버가 뜬 뒤:
```bash
curl http://127.0.0.1:8001/v1/models    # vLLM
curl http://127.0.0.1:11434/v1/models   # Ollama
```
그다음 웹을 `VITE_NL_PROVIDER=local`로 띄우면 대화창이 로컬 모델을 쓴다.
서버가 없으면 기본값 `mock`(가짜 모델)로 동작하므로, 코드와 흐름은 모델 없이도 테스트된다.
