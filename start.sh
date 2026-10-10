#!/usr/bin/env bash
# Mac launcher. The GPU machine and start_api.sh are managed separately.
# Compatible with macOS /bin/bash 3.2; no GNU utilities are required.
set -euo pipefail

TASK_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$TASK_ROOT"

if [[ "${1:-}" == --help ]]; then
  echo '사용법: bash start.sh'
  echo 'GPU 서버 API를 확인해 SSH 터널(선택) + 3D(5173) + 웹(5185)을 실행합니다.'
  echo '서버 API가 없으면 이미지 미리보기·JSON·3D는 유지하고 모델 측정만 건너뜁니다.'
  echo '설정: services/furniture_pipeline/runyour.env / 종료: Ctrl+C'
  exit 0
fi
[[ "$#" == 0 ]] || { echo '사용법: bash start.sh' >&2; exit 1; }

for TASK_COMMAND in node npm curl lsof; do
  command -v "$TASK_COMMAND" >/dev/null || { echo "$TASK_COMMAND 명령이 필요합니다." >&2; exit 1; }
done
for TASK_DIRECTORY in "$TASK_ROOT" "$TASK_ROOT/apps/web"; do
  [[ -x "$TASK_DIRECTORY/node_modules/.bin/vite" ]] || {
    echo "먼저 $TASK_DIRECTORY 에서 npm ci를 실행하세요." >&2
    exit 1
  }
done

# Each background service gets its own process group, including npm's Vite child.
# Cleanup never touches processes that were already running before this script.
set -m
TASK_OWNED_PIDS=''
TASK_TUNNEL_PID=''
TASK_VIEWER_PID=''
TASK_WEB_PID=''

cleanup() {
  TASK_EXIT_CODE=$?
  trap - EXIT INT TERM
  for TASK_PID in $TASK_OWNED_PIDS; do
    kill -TERM -- "-$TASK_PID" 2>/dev/null || true
  done
  # Bound shutdown even if a child ignores SIGTERM.
  for TASK_ATTEMPT in {1..20}; do
    TASK_REMAINING=0
    for TASK_PID in $TASK_OWNED_PIDS; do
      if kill -0 -- "-$TASK_PID" 2>/dev/null; then TASK_REMAINING=1; fi
    done
    [[ "$TASK_REMAINING" == 1 ]] || break
    sleep 0.1
  done
  for TASK_PID in $TASK_OWNED_PIDS; do
    kill -KILL -- "-$TASK_PID" 2>/dev/null || true
    wait "$TASK_PID" 2>/dev/null || true
  done
  exit "$TASK_EXIT_CODE"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$TASK_ROOT/runtime/dev"
TASK_LOG_DIR="$(mktemp -d "$TASK_ROOT/runtime/dev/run.XXXXXX")"
TASK_MEASUREMENT_ENABLED=0
TASK_LOCAL_API_PORT=8000

listening() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

health_ready() {
  node -e 'try { const h = JSON.parse(process.argv[1]); process.exit(h.status === "ok" && h.ready === true ? 0 : 1); } catch { process.exit(1); }' "$1"
}

local_api_ready() {
  TASK_HEALTH="$(curl --fail --silent --show-error --noproxy '*' --max-time 2 \
    "http://127.0.0.1:$TASK_LOCAL_API_PORT/health" 2>/dev/null)" || return 1
  health_ready "$TASK_HEALTH"
}

valid_port() {
  [[ "$1" =~ ^[0-9]{1,5}$ ]] && (( 10#$1 > 0 && 10#$1 <= 65535 ))
}

retire_tunnel() {
  # Do not retain an exited PID for hours: the OS could reuse its process group.
  kill -TERM -- "-$TASK_TUNNEL_PID" 2>/dev/null || true
  for TASK_ATTEMPT in {1..20}; do
    kill -0 -- "-$TASK_TUNNEL_PID" 2>/dev/null || break
    sleep 0.1
  done
  kill -KILL -- "-$TASK_TUNNEL_PID" 2>/dev/null || true
  wait "$TASK_TUNNEL_PID" 2>/dev/null || true
  TASK_RETAINED_PIDS=''
  for TASK_PID in $TASK_OWNED_PIDS; do
    if [[ "$TASK_PID" != "$TASK_TUNNEL_PID" ]]; then TASK_RETAINED_PIDS="$TASK_RETAINED_PIDS $TASK_PID"; fi
  done
  TASK_OWNED_PIDS="$TASK_RETAINED_PIDS"
  TASK_TUNNEL_PID=''
}

connect_measurement() {
  TASK_CONFIG="$TASK_ROOT/services/furniture_pipeline/runyour.env"
  if [[ ! -f "$TASK_CONFIG" ]] || ! command -v ssh >/dev/null; then
    echo '[웹 전용] SSH 설정이 없어 가구 모델 측정을 건너뜁니다.'
    return
  fi
  # This is the same user-owned shell configuration used by furniture:tunnel.
  source "$TASK_CONFIG"
  if [[ -z "${RUNYOUR_HOST:-}" || "${RUNYOUR_HOST:-}" == YOUR_SSH_HOST || \
        -z "${RUNYOUR_USER:-}" || ! -f "${RUNYOUR_PEM:-}" ]]; then
    echo '[웹 전용] runyour.env의 호스트·사용자·PEM 경로를 확인하세요.'
    return
  fi
  for TASK_PORT in "${RUNYOUR_SSH_PORT:-22}" "${RUNYOUR_LOCAL_API_PORT:-8000}" "${RUNYOUR_REMOTE_API_PORT:-8000}"; do
    if ! valid_port "$TASK_PORT"; then
      echo '[웹 전용] runyour.env의 포트는 1~65535여야 합니다.'
      return
    fi
  done
  TASK_LOCAL_API_PORT="$((10#${RUNYOUR_LOCAL_API_PORT:-8000}))"
  TASK_REMOTE_API_PORT="$((10#${RUNYOUR_REMOTE_API_PORT:-8000}))"
  TASK_SSH_PORT="$((10#${RUNYOUR_SSH_PORT:-22}))"
  if [[ "$TASK_LOCAL_API_PORT" == 5173 || "$TASK_LOCAL_API_PORT" == 5185 ]]; then
    echo '[웹 전용] API 터널 포트는 웹 포트(5173·5185)와 달라야 합니다.'
    TASK_LOCAL_API_PORT=8000
    return
  fi
  chmod 400 "$RUNYOUR_PEM"
  TASK_SSH_OPTIONS=(-i "$RUNYOUR_PEM" -p "$TASK_SSH_PORT"
    -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes
    -o ConnectTimeout=4 -o ConnectionAttempts=1
    -o ServerAliveInterval=3 -o ServerAliveCountMax=2)
  TASK_SSH_TARGET="$RUNYOUR_USER@$RUNYOUR_HOST"

  echo '[확인] GPU 서버 접속과 측정 API를 확인합니다…'
  if ! TASK_REMOTE_HEALTH="$(ssh "${TASK_SSH_OPTIONS[@]}" "$TASK_SSH_TARGET" \
    "curl --fail --silent --show-error --noproxy '*' --max-time 5 http://127.0.0.1:$TASK_REMOTE_API_PORT/health" \
    2>"$TASK_LOG_DIR/gpu-check.log")"; then
    echo '[웹 전용] GPU 서버에 접속할 수 없거나 API가 응답하지 않습니다. 터널을 켜지 않습니다.'
    return
  fi
  if ! health_ready "$TASK_REMOTE_HEALTH"; then
    echo '[웹 전용] GPU 서버의 모델 환경이 준비되지 않았습니다. 터널을 켜지 않습니다.'
    return
  fi

  if listening "$TASK_LOCAL_API_PORT"; then
    if local_api_ready; then
      echo "[측정 연결] 기존 터널/API(포트 $TASK_LOCAL_API_PORT)를 재사용합니다."
      TASK_MEASUREMENT_ENABLED=1
    else
      echo "[웹 전용] API 포트 $TASK_LOCAL_API_PORT 를 다른 프로세스가 사용 중입니다. 기존 프로세스는 종료하지 않습니다."
    fi
    return
  fi

  ssh -N "${TASK_SSH_OPTIONS[@]}" -o ExitOnForwardFailure=yes \
    -L "127.0.0.1:$TASK_LOCAL_API_PORT:127.0.0.1:$TASK_REMOTE_API_PORT" \
    "$TASK_SSH_TARGET" >"$TASK_LOG_DIR/tunnel.log" 2>&1 &
  TASK_TUNNEL_PID=$!
  TASK_OWNED_PIDS="$TASK_OWNED_PIDS $TASK_TUNNEL_PID"
  for TASK_ATTEMPT in {1..20}; do
    if local_api_ready; then
      TASK_MEASUREMENT_ENABLED=1
      echo '[측정 연결] SSH 터널이 연결됐습니다. 가구 모델 측정을 사용할 수 있습니다.'
      return
    fi
    kill -0 "$TASK_TUNNEL_PID" 2>/dev/null || break
    sleep 0.25
  done
  retire_tunnel
  echo '[웹 전용] 터널 연결에 실패했습니다. 웹과 3D만 실행합니다.'
}

web_ready() {
  TASK_PAGE="$(curl --fail --silent --noproxy '*' --max-time 2 "http://127.0.0.1:$1/" 2>/dev/null)" || return 1
  [[ "$TASK_PAGE" == *"$2"* ]]
}

start_web() {
  TASK_NAME="$1" TASK_PORT="$2" TASK_DIRECTORY="$3" TASK_MARKER="$4" TASK_LOG_NAME="$5"
  TASK_LATEST_PID=''
  if listening "$TASK_PORT"; then
    if web_ready "$TASK_PORT" "$TASK_MARKER"; then
      echo "[$TASK_NAME] 기존 서버(포트 $TASK_PORT)를 재사용합니다."
      echo '  실행 모드·프록시 설정까지 반영하려면 기존 npm run dev를 종료한 뒤 이 스크립트를 다시 실행하세요.'
      return
    fi
    echo "포트 $TASK_PORT 를 다른 서버가 사용 중입니다. 해당 포트를 확인해 주세요." >&2
    exit 1
  fi
  npm --prefix "$TASK_DIRECTORY" run dev >"$TASK_LOG_DIR/$TASK_LOG_NAME.log" 2>&1 &
  TASK_LATEST_PID=$!
  TASK_OWNED_PIDS="$TASK_OWNED_PIDS $TASK_LATEST_PID"
  for TASK_ATTEMPT in {1..40}; do
    if web_ready "$TASK_PORT" "$TASK_MARKER"; then
      echo "[$TASK_NAME] http://127.0.0.1:$TASK_PORT/"
      return
    fi
    kill -0 "$TASK_LATEST_PID" 2>/dev/null || break
    sleep 0.25
  done
  echo "$TASK_NAME 시작에 실패했습니다. 로그: $TASK_LOG_DIR/$TASK_LOG_NAME.log" >&2
  tail -n 12 "$TASK_LOG_DIR/$TASK_LOG_NAME.log" >&2
  exit 1
}

connect_measurement
export FURNITURE_API_TARGET="http://127.0.0.1:$TASK_LOCAL_API_PORT"
export VITE_FURNITURE_MEASUREMENT_ENABLED="$TASK_MEASUREMENT_ENABLED"
start_web '3D 뷰어' 5173 "$TASK_ROOT" 'id="viewport"' viewer
TASK_VIEWER_PID="$TASK_LATEST_PID"
start_web '기존 웹' 5185 "$TASK_ROOT/apps/web" 'id="space-tab"' web
TASK_WEB_PID="$TASK_LATEST_PID"

echo
echo '시작 완료: http://127.0.0.1:5185/'
if [[ "$TASK_MEASUREMENT_ENABLED" == 0 ]]; then
  echo '웹 전용 모드: 공간·3D·JSON·이미지 미리보기 사용 가능 / 모델 측정 불가'
fi
echo "로그: $TASK_LOG_DIR"
echo '이 터미널을 켜두세요. Ctrl+C로 이번에 실행한 웹·3D·터널만 종료합니다.'

while true; do
  for TASK_PID in "$TASK_VIEWER_PID" "$TASK_WEB_PID"; do
    if [[ -n "$TASK_PID" ]] && ! kill -0 "$TASK_PID" 2>/dev/null; then
      echo "웹 서버가 종료됐습니다. 로그를 확인하세요: $TASK_LOG_DIR" >&2
      exit 1
    fi
  done
  if [[ -n "$TASK_TUNNEL_PID" ]] && ! kill -0 "$TASK_TUNNEL_PID" 2>/dev/null; then
    echo '[연결 해제] SSH 터널이 종료됐습니다. 웹은 유지하지만 모델 측정은 불가능합니다.'
    retire_tunnel
  fi
  sleep 1
done
