#!/usr/bin/env bash
# 설치: Node 확인 → 의존성 → 데이터 폴더·config.json → 자동 등록 스킬 → 바탕화면 아이콘 → (선택) 바로가기 가져오기
# 다시 실행해도 안전하다 (config.json의 다른 설정은 유지, 스킬은 최신으로 덮어씀).
set -euo pipefail

PROJ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
SKILLS_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills"

echo "① Node 확인"
if ! command -v node >/dev/null 2>&1; then
  echo "오류: node가 없어요. nvm으로 Node 20 이상을 설치해 주세요." >&2
  exit 1
fi
major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 20 ]; then
  echo "오류: Node 20 이상이 필요해요 (지금 $(node -v))." >&2
  exit 1
fi

echo "② 의존성 설치"
if [ -z "${SKIP_NPM:-}" ]; then
  (cd "$PROJ" && npm install --no-audit --no-fund)
fi

echo "③ 데이터 폴더와 설정"
node --input-type=module -e "
  const { dataHome, ensureDataDirs, readConfig, writeConfig } = await import(process.argv[1] + '/server/paths.js');
  const home = dataHome();
  ensureDataDirs(home);
  writeConfig(home, { ...readConfig(home), launcherDir: process.argv[1] });
  console.log('   데이터 폴더: ' + home);
" "$PROJ"

echo "④ 자동 등록 스킬 설치 → ${SKILLS_DIR}/register-to-launcher"
if [ -z "${SKIP_SKILL:-}" ]; then
  mkdir -p "${SKILLS_DIR}/register-to-launcher"
  cp "$PROJ/skill/register-to-launcher/SKILL.md" "${SKILLS_DIR}/register-to-launcher/SKILL.md"
else
  echo "   스킬 설치 건너뜀 (SKIP_SKILL) — 나중에 SKIP_SKILL 없이 다시 실행하면 설치돼요"
fi

echo "⑤ 바탕화면 아이콘"
if [ -z "${SKIP_SHORTCUT:-}" ]; then
  node "$PROJ/scripts/install-shortcut.mjs"
fi

# 바로가기 가져오기는 사설판에만 있다 (공개판은 스크립트를 내보내지 않음)
if [ -f "$PROJ/scripts/import-shortcuts.mjs" ]; then
echo "⑥ 바탕화면 바로가기 가져오기"
if [ -t 0 ]; then
  read -r -p "   바탕화면 바로가기 폴더(import-shortcuts.mjs 기본 폴더)의 바로가기를 런처로 가져올까요? (바로가기는 지우지 않아요) [y/N] " ans
  if [ "${ans:-}" = "y" ] || [ "${ans:-}" = "Y" ]; then
    node "$PROJ/scripts/import-shortcuts.mjs"
  fi
fi
echo "   나중에 하려면: node scripts/import-shortcuts.mjs --dry-run 으로 미리 보고, 괜찮으면 --dry-run 없이 실행"
fi
echo "설치 끝. 바탕화면의 '앱 관리 프로젝트' 아이콘으로 여세요."
