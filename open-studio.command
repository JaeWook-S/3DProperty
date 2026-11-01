#!/bin/bash
# Standalone macOS launcher; compatible with system Bash 3.2.
set -euo pipefail
TASK_HOST="${CORTEX_SSH_HOST:-yj1-H200-kinamkim}"
TASK_REMOTE_ROOT="${CORTEX_REMOTE_ROOT:-/home/nas5/kinamkim/Repos/geonwoo/3DProperty}"
TASK_LOCKED=0
finish() {
  TASK_STATUS=$?
  trap - EXIT
  if [[ "$TASK_LOCKED" == 1 ]]; then rmdir "$TASK_STATE/launch.lock" 2>/dev/null || true; fi
  if [[ "$TASK_STATUS" != 0 && -t 0 ]]; then
    printf '\n위 오류를 확인하세요. Enter를 누르면 종료합니다. '
    read -r TASK_REPLY || true
  fi
  exit "$TASK_STATUS"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [[ "${1:-}" == --help ]]; then
  echo 'Mac에서 open-studio.command를 더블클릭하거나 bash open-studio.command를 실행하세요.'
  echo 'SSH 연결 → 지도·뷰어 서버 시작/재사용 → 지도에서 위치 선택'
  echo '종료: bash open-studio.command --stop (이 파일의 SSH 연결만 종료)'
  echo '설정: CORTEX_SSH_HOST, CORTEX_REMOTE_ROOT. 기존 ~/.ssh/config와 이전 뷰어 포트를 재사용합니다.'
  exit 0
fi
if [[ "$#" -gt 1 || ( "$#" == 1 && "$1" != --stop ) ]]; then
  echo '사용법: bash open-studio.command [--stop | --help]' >&2
  exit 1
fi
for TASK_COMMAND in ssh curl lsof open cksum; do
  command -v "$TASK_COMMAND" >/dev/null || { echo "$TASK_COMMAND 명령이 필요합니다." >&2; exit 1; }
done
# Short private path fits macOS's Unix socket pathname limit.
TASK_KEY="$(printf '%s\n%s' "$TASK_HOST" "$TASK_REMOTE_ROOT" | cksum)"
TASK_KEY="${TASK_KEY%% *}"
TASK_STATE="${CORTEX_LAUNCHER_STATE_ROOT:-/tmp}/cortex-studio-${UID}-${TASK_KEY}"
umask 077
if [[ -L "$TASK_STATE" || ( -e "$TASK_STATE" && ! -O "$TASK_STATE" ) ]]; then
  echo "연결 상태 폴더의 소유자를 확인하세요: $TASK_STATE" >&2
  exit 1
fi
mkdir -p "$TASK_STATE"
chmod 700 "$TASK_STATE"
if ! mkdir "$TASK_STATE/launch.lock" 2>/dev/null; then
  echo '다른 실행 창이 연결 중입니다. 그 창에서 비밀번호 입력을 완료해 주세요.' >&2
  exit 1
fi
TASK_LOCKED=1
TASK_SOCKET="$TASK_STATE/ssh"
connected() { ssh -S "$TASK_SOCKET" -O check "$TASK_HOST" >/dev/null 2>&1; }
ready() {
  local page
  page="$(curl --fail --silent --noproxy '*' --max-time 3 "http://127.0.0.1:$1/" 2>/dev/null)" || return 1
  [[ "$page" == *"$2"* ]]
}
valid_port() { [[ "$1" =~ ^[0-9]{4,5}$ ]] && (( 10#$1 >= 1024 && 10#$1 <= 65535 )); }
open_service() {
  local url="http://127.0.0.1:$TASK_SERVICE_PORT/?viewerUrl=http%3A%2F%2F127.0.0.1%3A$TASK_PORT%2F"
  echo "Cortex 지도: $url"
  echo "뷰어 직접 링크: http://127.0.0.1:$TASK_PORT/?studio=1&serviceUrl=http%3A%2F%2F127.0.0.1%3A$TASK_SERVICE_PORT%2F"
  open "$url"
  echo '이 창은 닫아도 됩니다. 다음에는 같은 파일을 다시 더블클릭하세요.'
}
if [[ "${1:-}" == --stop ]]; then
  if connected; then ssh -S "$TASK_SOCKET" -O exit "$TASK_HOST"; fi
  echo '지도·뷰어 SSH 접속을 종료했습니다. 서버와 별도 Blender MCP 연결은 유지합니다.'
  exit 0
fi
TASK_REUSED_CONNECTION=0
if connected; then
  TASK_REUSED_CONNECTION=1
  if [[ -f "$TASK_STATE/port" && -f "$TASK_STATE/service-port" ]]; then
    read -r TASK_PORT < "$TASK_STATE/port" || true
    read -r TASK_SERVICE_PORT < "$TASK_STATE/service-port" || true
    if valid_port "${TASK_PORT:-}" && valid_port "${TASK_SERVICE_PORT:-}" && \
        ready "$TASK_PORT" 'id="viewport"' && ready "$TASK_SERVICE_PORT" 'id="map-service"'; then
      echo '기존 지도·뷰어 연결을 사용합니다.'
      open_service
      exit 0
    fi
  fi
else
  echo '서버에 연결합니다. 요청되면 기존 SSH 비밀번호를 입력하세요.'
  rm -f "$TASK_SOCKET"
  ssh -M -S "$TASK_SOCKET" -fN \
    -o ControlMaster=yes -o ControlPersist=no \
    -o ConnectTimeout=15 -o ConnectionAttempts=1 \
    -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes "$TASK_HOST"
fi
echo '서버의 지도·뷰어 실행 상태를 확인합니다…'
printf -v TASK_HELPER '%q' "$TASK_REMOTE_ROOT/tools/start-remote-studio.sh"
printf -v TASK_REMOTE_COMMAND 'bash -lc %q' "bash $TASK_HELPER"
ssh -S "$TASK_SOCKET" -o ControlMaster=no -o BatchMode=yes "$TASK_HOST" "$TASK_REMOTE_COMMAND"

# Retain the old viewer origin (saved layouts) and independently allocate the map port.
forward_port() {
  local state_file="$1" remote_port="$2" port="$3" marker="$4" saved='' attempt
  if [[ -f "$TASK_STATE/$state_file" ]]; then
    read -r saved < "$TASK_STATE/$state_file" || true
    if valid_port "$saved"; then port="$saved"; fi
  fi
  for attempt in {1..30}; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      if [[ "$TASK_REUSED_CONNECTION" == 1 && "$port" == "$saved" ]] && ready "$port" "$marker"; then
        TASK_FORWARDED_PORT="$port"
        return 0
      fi
    elif ssh -S "$TASK_SOCKET" -O forward \
        -o ExitOnForwardFailure=yes \
        -L "127.0.0.1:$port:127.0.0.1:$remote_port" "$TASK_HOST" 2>"$TASK_STATE/$state_file-forward.log"; then
      TASK_FORWARDED_PORT="$port"
      printf '%s\n' "$port" > "$TASK_STATE/$state_file"
      return 0
    fi
    port=$((30000 + RANDOM % 20000))
  done
  echo "웹 접속 포트를 열지 못했습니다. 로그: $TASK_STATE/$state_file-forward.log" >&2
  return 1
}
forward_port port 5173 35173 'id="viewport"'
TASK_PORT="$TASK_FORWARDED_PORT"
forward_port service-port 5185 35185 'id="map-service"'
TASK_SERVICE_PORT="$TASK_FORWARDED_PORT"
for TASK_ATTEMPT in {1..20}; do
  if ready "$TASK_PORT" 'id="viewport"' && ready "$TASK_SERVICE_PORT" 'id="map-service"'; then open_service; exit 0; fi
  sleep 0.25
done
echo 'SSH는 연결됐지만 지도나 뷰어가 응답하지 않습니다. 잠시 후 이 파일을 다시 실행하세요.' >&2
exit 1
