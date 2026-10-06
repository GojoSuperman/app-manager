// server/skill-install.js
// Claude Code 등록 스킬을 화면의 버튼으로 설치·갱신 (setup.sh ④단계와 같은 일).
// ~/.claude-* 중엔 설정 폴더가 아닌 것(백업·플러그인 데이터)도 있어서(2026-10-06 실측) 자동 설치하지 않고 목록에서 고르게 한다.
import fs from 'node:fs';
import path from 'node:path';

const SKILL_REL = path.join('skills', 'register-to-launcher', 'SKILL.md');

function candidateDirs(home, env) {
  const dirs = [];
  if (env.CLAUDE_CONFIG_DIR) dirs.push(path.resolve(env.CLAUDE_CONFIG_DIR));
  let names = [];
  try { names = fs.readdirSync(home); } catch { /* 홈을 못 읽으면 환경 변수 폴더만 */ }
  for (const n of names.filter((x) => x === '.claude' || x.startsWith('.claude-')).sort()) {
    const p = path.join(home, n);
    try { if (fs.statSync(p).isDirectory()) dirs.push(p); } catch { /* 깨진 링크 */ }
  }
  return [...new Set(dirs)];
}

function stateOf(dir, skill) {
  try {
    return fs.readFileSync(path.join(dir, SKILL_REL), 'utf8') === skill ? 'current' : 'outdated';
  } catch {
    return 'missing';
  }
}

// [{ dir, state: current|outdated|missing, checked }]
export function listTargets({ home, env, skillFile }) {
  const skill = fs.readFileSync(skillFile, 'utf8');
  return candidateDirs(home, env).map((dir) => {
    const state = stateOf(dir, skill);
    const base = path.basename(dir);
    const checked = !/backup/i.test(base) && (dir === path.resolve(env.CLAUDE_CONFIG_DIR || '\0') || base === '.claude' || state !== 'missing');
    return { dir, state, checked };
  });
}

// 하나라도 옛 판이면 outdated, 최신이 있으면 current, 하나도 없으면 missing
export function summarize(targets) {
  if (targets.some((t) => t.state === 'outdated')) return 'outdated';
  return targets.some((t) => t.state === 'current') ? 'current' : 'missing';
}

export function installSkill({ home, env, skillFile, dirs }) {
  const allowed = new Set(candidateDirs(home, env));
  if (!Array.isArray(dirs) || !dirs.length) return { ok: false, error: '설치할 폴더를 골라 주세요' };
  const bad = dirs.filter((d) => !allowed.has(d));
  if (bad.length) return { ok: false, error: `Claude 설정 폴더가 아니에요: ${bad.join(', ')}` };
  for (const d of dirs) {
    fs.mkdirSync(path.dirname(path.join(d, SKILL_REL)), { recursive: true });
    fs.copyFileSync(skillFile, path.join(d, SKILL_REL));
  }
  return { ok: true, installed: dirs };
}
