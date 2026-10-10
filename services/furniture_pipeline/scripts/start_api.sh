#!/usr/bin/env bash
set -euo pipefail
TASK_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$TASK_ROOT"
TASK_API="$TASK_ROOT/.envs/furniture-api/bin/python"
[[ -x "$TASK_API" ]] || { echo "먼저 setup_gpu_envs.sh를 실행하세요." >&2; exit 1; }
"$TASK_API" -m services.furniture_pipeline.scripts.doctor
TASK_ADDRESS=()
while IFS= read -r TASK_LINE; do TASK_ADDRESS+=("$TASK_LINE"); done < <("$TASK_API" -m services.furniture_pipeline.scripts.doctor --print-api-address)
[[ "${#TASK_ADDRESS[@]}" == 2 ]] || { echo "API host/port 설정을 확인하세요." >&2; exit 1; }
# One worker is mandatory: admission control is process-local.
exec "$TASK_API" -m uvicorn services.furniture_pipeline.api.main:app \
  --host "${TASK_ADDRESS[0]}" --port "${TASK_ADDRESS[1]}" --workers 1 --timeout-graceful-shutdown 10
