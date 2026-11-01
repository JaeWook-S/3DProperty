#!/usr/bin/env bash
# Server helper for open-studio.command; reuse both servers, start only a missing one.
set -euo pipefail
TASK_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$TASK_ROOT"
ready() {
  local page
  page="$(curl --fail --silent --noproxy '*' --max-time 2 "http://127.0.0.1:$1/" 2>/dev/null)" || return 1
  [[ "$page" == *"$2"* ]]
}
ready_pair() { ready 5173 'id="viewport"' && ready 5185 'id="map-service"'; }
if ready_pair; then echo '지도·뷰어 서버 실행 중 (5185/5173)'; exit 0; fi
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  TASK_NVM_SCRIPT="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if [[ -f "$TASK_NVM_SCRIPT" ]]; then
    source "$TASK_NVM_SCRIPT" --no-use
    nvm use --silent default
  fi
fi
for TASK_COMMAND in node npm curl flock setsid; do
  command -v "$TASK_COMMAND" >/dev/null || { echo "서버에 $TASK_COMMAND 명령이 필요합니다." >&2; exit 1; }
done
mkdir -p runtime/dev
exec 9>runtime/dev/remote-studio.lock
flock -w 20 9 || { echo '다른 실행이 진행 중입니다. 잠시 후 다시 실행하세요.' >&2; exit 1; }
start_one() {
  local port="$1" directory="$2" marker="$3" name="$4" log_name="$5" pid attempt log
  if ready "$port" "$marker"; then echo "$name 서버 실행 중 ($port)"; return; fi
  [[ -x "$directory/node_modules/.bin/vite" ]] || { echo "서버의 $directory 에서 npm ci가 필요합니다." >&2; return 1; }
  log="$TASK_ROOT/runtime/dev/$log_name.log"
  # No inference/API startup or GPU use. Existing server configuration is untouched.
  (cd "$directory"; exec nohup setsid env VITE_FURNITURE_MEASUREMENT_ENABLED=0 npm run dev) >"$log" 2>&1 < /dev/null 9>&- &
  pid=$!
  printf '%s\n' "$pid" > "$TASK_ROOT/runtime/dev/$log_name.pid"
  for attempt in {1..60}; do
    if ready "$port" "$marker"; then echo "$name 서버 시작 완료 ($port)"; return; fi
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.25
  done
  echo "$name 시작 실패. 로그: $log" >&2
  tail -n 15 "$log" >&2
  return 1
}
start_one 5173 "$TASK_ROOT" 'id="viewport"' '3D 뷰어' remote-studio
start_one 5185 "$TASK_ROOT/apps/web" 'id="map-service"' '지도 서비스' remote-service
