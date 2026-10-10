#!/usr/bin/env bash
# Mac: edit runyour.env once, then leave this terminal open.
set -euo pipefail
TASK_SERVICE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TASK_CONFIG="$TASK_SERVICE/runyour.env"
[[ -f "$TASK_CONFIG" ]] || { echo "runyour.env.example을 runyour.env로 복사하고 SSH 정보를 입력하세요." >&2; exit 1; }
source "$TASK_CONFIG"
: "${RUNYOUR_HOST:?SSH 호스트를 입력하세요}"
: "${RUNYOUR_USER:?SSH 사용자를 입력하세요}"
: "${RUNYOUR_PEM:?PEM 키 경로를 입력하세요}"
[[ "$RUNYOUR_HOST" != YOUR_SSH_HOST ]] || { echo "실제 SSH 호스트를 입력하세요." >&2; exit 1; }
[[ -f "$RUNYOUR_PEM" ]] || { echo "PEM 키 파일을 찾을 수 없습니다." >&2; exit 1; }
for TASK_PORT in "${RUNYOUR_SSH_PORT:-22}" "${RUNYOUR_LOCAL_API_PORT:-8000}" "${RUNYOUR_REMOTE_API_PORT:-8000}"; do
  [[ "$TASK_PORT" =~ ^[0-9]+$ ]] && (( TASK_PORT > 0 && TASK_PORT <= 65535 )) || { echo "포트는 1~65535 범위여야 합니다." >&2; exit 1; }
done
chmod 400 "$RUNYOUR_PEM"
echo "SSH 터널 연결: localhost:${RUNYOUR_LOCAL_API_PORT:-8000} → 서버 API. 이 터미널을 유지하세요."
exec ssh -N -i "$RUNYOUR_PEM" -p "${RUNYOUR_SSH_PORT:-22}" \
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -L "127.0.0.1:${RUNYOUR_LOCAL_API_PORT:-8000}:127.0.0.1:${RUNYOUR_REMOTE_API_PORT:-8000}" \
  "$RUNYOUR_USER@$RUNYOUR_HOST"
