#!/usr/bin/env bash
# Run on the Runyour Linux GPU server, from any working directory.
set -euo pipefail
TASK_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
TASK_SERVICE="$TASK_ROOT/services/furniture_pipeline"
if [[ "$(uname -s)" != Linux ]]; then
  echo "Linux NVIDIA GPU 서버에서 실행하세요." >&2
  exit 1
fi
command -v nvidia-smi >/dev/null || { echo "NVIDIA 드라이버가 필요합니다." >&2; exit 1; }
command -v git >/dev/null || { echo "git이 필요합니다." >&2; exit 1; }
TASK_CONDA="${CONDA_EXE:-$(command -v conda || true)}"
if [[ -z "$TASK_CONDA" ]]; then
  TASK_MINIFORGE="$TASK_ROOT/.tooling/miniforge"
  if [[ ! -x "$TASK_MINIFORGE/bin/conda" ]]; then
    command -v curl >/dev/null || { echo "curl 또는 기존 Conda 설치가 필요합니다." >&2; exit 1; }
    TASK_ARCH="$(uname -m)"
    [[ "$TASK_ARCH" == x86_64 || "$TASK_ARCH" == aarch64 ]] || { echo "지원되지 않는 CPU 아키텍처: $TASK_ARCH" >&2; exit 1; }
    TASK_INSTALLER="Miniforge3-26.7.2-0-Linux-$TASK_ARCH.sh"
    TASK_DOWNLOAD="$(mktemp -d)"
    curl -fsSL --retry 3 "https://github.com/conda-forge/miniforge/releases/download/26.7.2-0/$TASK_INSTALLER" -o "$TASK_DOWNLOAD/$TASK_INSTALLER"
    curl -fsSL --retry 3 "https://github.com/conda-forge/miniforge/releases/download/26.7.2-0/$TASK_INSTALLER.sha256" -o "$TASK_DOWNLOAD/$TASK_INSTALLER.sha256"
    (cd "$TASK_DOWNLOAD" && sha256sum -c "$TASK_INSTALLER.sha256")
    mkdir -p "$TASK_ROOT/.tooling"
    bash "$TASK_DOWNLOAD/$TASK_INSTALLER" -b -p "$TASK_MINIFORGE"
  fi
  TASK_CONDA="$TASK_MINIFORGE/bin/conda"
fi
nvidia-smi
for TASK_ENV in furniture-api furniture-sam3 furniture-moge3; do
  TASK_PREFIX="$TASK_ROOT/.envs/$TASK_ENV"
  if [[ ! -x "$TASK_PREFIX/bin/python" ]]; then
    "$TASK_CONDA" create --prefix "$TASK_PREFIX" --channel conda-forge --override-channels python=3.12 pip -y
  fi
  "$TASK_PREFIX/bin/python" -c 'import sys; assert sys.version_info[:2] == (3, 12), "Python 3.12 required"'
done
TASK_API="$TASK_ROOT/.envs/furniture-api/bin/python"
"$TASK_API" -m pip install -r "$TASK_SERVICE/requirements/api.txt"
for TASK_MODEL in sam3 moge3; do
  TASK_PYTHON="$TASK_ROOT/.envs/furniture-$TASK_MODEL/bin/python"
  "$TASK_PYTHON" -m pip install 'setuptools>=77.0.3,<81' wheel
  "$TASK_PYTHON" -m pip install torch==2.10.0 torchvision==0.25.0 --index-url https://download.pytorch.org/whl/cu128
  "$TASK_PYTHON" -m pip install -r "$TASK_SERVICE/requirements/$TASK_MODEL.txt"
  "$TASK_PYTHON" -m pip check
done
"$TASK_API" -m pip check
cd "$TASK_ROOT"
echo "설치 완료. .env 설정 → bash services/furniture_pipeline/scripts/login_hf.sh → bash services/furniture_pipeline/scripts/start_api.sh"
