#!/usr/bin/env bash
# 바탕화면 아이콘이 부르는 시작 스크립트.
# - 이미 켜져 있으면 브라우저만 열고 끝난다(이 창도 닫힘).
# - 아니면 서버를 창 없이 뒤에서 띄우고, 뜨면 브라우저를 연 뒤 끝난다(이 창도 닫힘).
#   서버 로그는 대시보드 하단 콘솔에 보이고, 대시보드 창을 닫으면 10초 뒤 서버가 스스로 꺼진다.
# - 못 뜨면 이 창에 로그를 보여 주고 기다린다.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJ="$(cd "$SCRIPT_DIR/.." && pwd -P)"
PORT="${MY_APP_LAUNCHER_PORT:-4790}"

# cmd.exe 경로 (비대화형 셸엔 PATH에 없을 수 있음 → 절대 경로 폴백). claude-wsl-launcher에서 가져옴.
resolve_cmd() {
  command -v cmd.exe >/dev/null 2>&1 && { echo "cmd.exe"; return 0; }
  local p="/mnt/c/Windows/System32/cmd.exe"
  [ -f "$p" ] && { echo "$p"; return 0; }
  return 1
}

# chrome.exe 찾기 (표준 2곳 → 사용자 AppData). claude-wsl-launcher에서 가져옴.
find_chrome() {
  local p winuser cmdexe
  for p in \
    "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" \
    "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"; do
    [ -f "$p" ] && { printf '%s' "$p"; return 0; }
  done
  cmdexe="$(resolve_cmd)" || return 1
  winuser="$("$cmdexe" /c 'echo %USERNAME%' 2>/dev/null | tr -d '\r')"
  if [ -n "$winuser" ]; then
    p="/mnt/c/Users/${winuser}/AppData/Local/Google/Chrome/Application/chrome.exe"
    [ -f "$p" ] && { printf '%s' "$p"; return 0; }
  fi
  return 1
}

# 크롬 앱 모드 창으로 열기. claude-wsl-launcher에서 가져옴 (실측 근거는 그 저장소 launch.sh 주석):
# - cmd /c start 로 Windows가 소유한 분리 프로세스로 띄워야 이 창이 닫혀도 크롬이 살아남는다
# - 크롬이 꺼져 있으면 cmd 호출이 돌아오지 않으므로 3초만 지켜보고 떠난다
# - 실패하면 explorer.exe(기본 브라우저)로
open_browser() {
  echo "브라우저를 엽니다: http://127.0.0.1:${PORT}/"
  [ -n "${LAUNCHER_NO_BROWSER:-}" ] && return 0
  local url="http://127.0.0.1:${PORT}/" chrome chrome_win cmdexe pid
  if chrome="$(find_chrome)" && cmdexe="$(resolve_cmd)"; then
    chrome_win="$(wslpath -w "$chrome")"
    setsid "$cmdexe" /c start "" "$chrome_win" "--app=${url}" >/dev/null 2>&1 </dev/null &
    pid=$!
    for _ in $(seq 1 30); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    if kill -0 "$pid" 2>/dev/null; then
      disown "$pid" 2>/dev/null || true
      return 0
    fi
    wait "$pid" && return 0
  fi
  explorer.exe "$url" >/dev/null 2>&1 || true
}

# 이 포트에 떠 있는 게 "이 런처"인지. 2초 제한 — mirrored 네트워킹에서 빈 포트 접속이 오래 멈추는 경우 대비.
# 응답을 먼저 다 받은 뒤 비교한다 (grep -q 파이프는 pipefail에서 SIGPIPE로 거짓이 될 수 있음)
is_ours() {
  local r
  r="$(timeout 2 bash -c 'exec 3<>"/dev/tcp/127.0.0.1/$1" || exit 1
    printf "GET /api/health HTTP/1.0\r\nHost: 127.0.0.1:%s\r\nConnection: close\r\n\r\n" "$1" >&3
    cat <&3' _ "$PORT" 2>/dev/null)"
  [[ "$r" == *'"app":"my-app-launcher"'* ]]
}

cd "$PROJ" || exit 1

if is_ours; then
  echo "이미 실행 중이에요 — 브라우저만 엽니다."
  open_browser
  exit 0
fi

HOME_DIR="${MY_APP_LAUNCHER_HOME:-$HOME/.config/my-app-launcher}"
OUT="${HOME_DIR}/logs/server.out"   # 서버의 표준 출력·오류 (시작 실패 원인 보기용)

# 실패하면 이 창에 이유를 보여 주고 Enter를 기다린다 (눈먼 채 창이 닫히지 않게)
fail() {
  echo "────────────────────────────────────────"
  echo "⚠️  $1"
  echo "    로그: ${OUT}"
  echo "────────────────────────────────────────"
  tail -n 40 "$OUT" 2>/dev/null
  echo "────────────────────────────────────────"
  echo "Enter를 누르면 창을 닫아요."
  read -r _ || true
  exit 1
}

command -v node >/dev/null 2>&1 || { mkdir -p "${HOME_DIR}/logs"; : > "$OUT"; fail "node를 찾지 못했어요. nvm으로 Node를 설치한 뒤 다시 시도해 주세요."; }

# 서버를 창 없이 뒤에서 띄운다. 창(wsl.exe 세션)이 닫혀도 살아남도록 setsid로 완전히 분리.
# (WSL 함정: 창이 끝나면 nohup만으론 자식이 함께 죽는다 — claude-wsl-launcher 실측)
# 서버는 대시보드 창(하단 콘솔 연결)이 모두 닫히면 10초 뒤 스스로 꺼진다.
mkdir -p "${HOME_DIR}/logs"
: > "$OUT"
setsid node server/index.js >>"$OUT" 2>&1 </dev/null &
pid=$!
disown 2>/dev/null || true

# 최대 12초 기다림. 서버 프로세스가 먼저 죽으면 바로 실패로 본다.
for _ in $(seq 1 48); do
  if is_ours; then
    echo "서버를 띄웠어요."
    open_browser
    exit 0
  fi
  kill -0 "$pid" 2>/dev/null || fail "서버를 띄우지 못했어요."
  sleep 0.25
done
fail "서버를 띄우지 못했어요 (12초 안에 응답 없음)."
