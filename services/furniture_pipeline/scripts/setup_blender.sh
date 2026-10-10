#!/usr/bin/env bash
# Install a pinned official Blender archive, without sudo or GUI.
set -euo pipefail
TASK_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || { echo 'Runyour Linux x86_64 서버에서 실행하세요.' >&2; exit 1; }
for TASK_COMMAND in curl tar sha256sum; do
  command -v "$TASK_COMMAND" >/dev/null || { echo "$TASK_COMMAND 명령이 필요합니다." >&2; exit 1; }
done
TASK_VERSION=4.5.3
TASK_ARCHIVE="blender-$TASK_VERSION-linux-x64.tar.xz"
TASK_BASE=https://download.blender.org/release/Blender4.5
TASK_DESTINATION="$TASK_ROOT/.tooling/blender"
TASK_BINARY="$TASK_DESTINATION/blender-$TASK_VERSION-linux-x64/blender"
if [[ ! -x "$TASK_BINARY" ]]; then
  TASK_DOWNLOAD="$(mktemp -d)"
  curl -fsSL --retry 3 "$TASK_BASE/$TASK_ARCHIVE" -o "$TASK_DOWNLOAD/$TASK_ARCHIVE"
  curl -fsSL --retry 3 "$TASK_BASE/blender-$TASK_VERSION.sha256" -o "$TASK_DOWNLOAD/checksums.sha256"
  TASK_CHECKSUM="$(awk -v archive="$TASK_ARCHIVE" '$2 == archive { print; found=1 } END { if (!found) exit 1 }' "$TASK_DOWNLOAD/checksums.sha256")"
  (cd "$TASK_DOWNLOAD" && sha256sum -c - <<< "$TASK_CHECKSUM")
  mkdir -p "$TASK_DESTINATION"
  tar -xJf "$TASK_DOWNLOAD/$TASK_ARCHIVE" -C "$TASK_DESTINATION"
fi
if [[ ! -e "$TASK_DESTINATION/blender" && ! -L "$TASK_DESTINATION/blender" ]]; then
  ln -s "blender-$TASK_VERSION-linux-x64/blender" "$TASK_DESTINATION/blender"
fi
"$TASK_DESTINATION/blender" --background --factory-startup --python-expr 'import bpy; print("Blender GLB export ready:", bpy.app.version_string)' \
  || { echo '공유 라이브러리가 없으면 관리자에게 libx11-6 libxi6 libxrender1 libxfixes3 libxxf86vm1 libxkbcommon0 libgl1 설치를 요청하세요.' >&2; exit 1; }
echo 'Blender 설치 완료. 서버 API를 재시작하세요.'
