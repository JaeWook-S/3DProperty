#!/usr/bin/env bash
set -euo pipefail
TASK_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$TASK_ROOT"
TASK_API="$TASK_ROOT/.envs/furniture-api/bin/python"
[[ -x "$TASK_API" ]] || { echo "먼저 setup_gpu_envs.sh를 실행하세요." >&2; exit 1; }
exec "$TASK_API" -m services.furniture_pipeline.scripts.login_hf
