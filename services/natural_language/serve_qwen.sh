#!/usr/bin/env bash
# 로컬 Qwen을 vLLM(OpenAI 호환)으로 띄운다.
# 사용법: bash services/natural_language/serve_qwen.sh <GPU번호> [모델ID] [포트]
# 예:    bash services/natural_language/serve_qwen.sh 3
#
# 주의: 실행 전 gpustat으로 빈 GPU를 확인하고 번호를 직접 넘긴다.
#       named conda 환경(intern_nl-serve)에서 실행한다. base 환경은 쓰지 않는다.
set -euo pipefail

GPU="${1:?빈 GPU 번호를 넘겨주세요. 예: bash serve_qwen.sh 4}"
MODEL="${2:-Qwen/Qwen3-4B-Instruct-2507}"
PORT="${3:-8001}"   # 이 서버는 8000이 이미 쓰여 기본 8001

echo "[serve_qwen] GPU=${GPU} MODEL=${MODEL} PORT=${PORT}"
echo "[serve_qwen] which python: $(which python)"

# enforce-eager: 커널 컴파일(ninja 필요)·CUDA 그래프 캡처를 생략. 저부하 단일 사용자엔 충분하고 기동이 빠르다.
CUDA_VISIBLE_DEVICES="${GPU}" python -m vllm.entrypoints.openai.api_server \
  --model "${MODEL}" \
  --served-model-name "${MODEL}" \
  --host 127.0.0.1 \
  --port "${PORT}" \
  --max-model-len 8192 \
  --gpu-memory-utilization 0.45 \
  --enforce-eager
