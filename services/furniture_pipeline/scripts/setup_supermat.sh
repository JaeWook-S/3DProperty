#!/usr/bin/env bash
# One-time setup on the existing Linux NVIDIA GPU server. Launch commands stay the same.
set -euo pipefail
TASK_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
TASK_SERVICE="$TASK_ROOT/services/furniture_pipeline"
TASK_PREFIX="$TASK_ROOT/.envs/furniture-supermat"
TASK_PYTHON="$TASK_PREFIX/bin/python"
if [[ "$(uname -s)" != Linux ]]; then
  echo "Linux NVIDIA GPU 서버에서 실행하세요." >&2
  exit 1
fi
command -v nvidia-smi >/dev/null || { echo "NVIDIA 드라이버가 필요합니다." >&2; exit 1; }
if [[ ! -f "$TASK_ROOT/SuperMat/checkpoints/supermat.pth" ]]; then
  echo "SuperMat/checkpoints/supermat.pth 체크포인트를 3DProperty 패키지에 복사하세요." >&2
  exit 1
fi
if [[ ! -x "$TASK_PYTHON" ]]; then
  if [[ -n "${PYTHON_BIN:-}" ]]; then
    TASK_BOOTSTRAP_PYTHON="$PYTHON_BIN"
  elif [[ -x "$TASK_ROOT/.envs/furniture-api/bin/python" ]]; then
    TASK_BOOTSTRAP_PYTHON="$TASK_ROOT/.envs/furniture-api/bin/python"
  else
    TASK_BOOTSTRAP_PYTHON="$(command -v python3.12 || command -v python3 || true)"
  fi
  [[ -n "$TASK_BOOTSTRAP_PYTHON" ]] || { echo "Python 3.12가 필요합니다. PYTHON_BIN으로 지정할 수 있습니다." >&2; exit 1; }
  "$TASK_BOOTSTRAP_PYTHON" -c 'import sys; assert sys.version_info[:2] == (3, 12), "Python 3.12 required (set PYTHON_BIN)"'
  "$TASK_BOOTSTRAP_PYTHON" -m venv "$TASK_PREFIX"
fi
"$TASK_PYTHON" -c 'import sys; assert sys.version_info[:2] == (3, 12), "Python 3.12 required"'
"$TASK_PYTHON" -m pip install --upgrade pip 'setuptools>=77.0.3,<81' wheel
# Match the existing GPU environments; override only the wheel index when needed.
"$TASK_PYTHON" -m pip install -r "$TASK_SERVICE/requirements/torch.txt" --index-url "${TORCH_INDEX_URL:-https://download.pytorch.org/whl/cu128}"
"$TASK_PYTHON" -m pip install -r "$TASK_SERVICE/requirements/supermat.txt"
"$TASK_PYTHON" -m pip check
PYTHONPATH="$TASK_ROOT/SuperMat${PYTHONPATH:+:$PYTHONPATH}" "$TASK_PYTHON" -c 'import inference_supermat, supermat_to_prompt; print("SuperMat single-image imports passed (no model download).")'
echo "SuperMat 설치 완료. 기존 start.sh 및 서버 시작 명령을 그대로 사용하세요."
