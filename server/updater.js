// server/updater.js
// 화면 위 [⟳ 업데이트] — 런처 자신을 GitHub의 최신 판으로 (프로젝트 런처의 updater와 같은 원칙).
// 안전 원칙: 실패하면 아무것도 건드리지 않는다. pull은 --ff-only라 로컬 변경·갈라진 기록이 있으면 거부되고 이유를 돌려준다.
// 받은 뒤엔 서버를 다시 켜야 새 코드가 돈다 → 화면이 '다시 켜기'까지 이어서 안내한다.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function defaultRun(cmd, args, { cwd, timeout = 60000 } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (e, stdout = '', stderr = '') => {
      resolve(e ? { ok: false, stdout: String(stdout), stderr: String(stderr || e.message) } : { ok: true, stdout: String(stdout) });
    });
  });
}

export function classifyPullError(stderr) {
  const s = String(stderr || '');
  if (/local changes|would be overwritten|Please commit your changes|stash/i.test(s)) return 'local-changes';
  if (/fast-forward|divergent|diverged/i.test(s)) return 'diverged';
  if (/Could not resolve host|unable to access|Network is unreachable|Connection timed out|no such host/i.test(s)) return 'network';
  if (/no upstream|no tracking/i.test(s)) return 'no-upstream';
  return null;
}

const fail = (step, r) => ({ ok: false, step, code: classifyPullError(r.stderr), error: (r.stderr || '').trim() });

// 원격에 새 판이 있는지: fetch → 받을 커밋 수·목록. 절대 throw 안 함.
export async function checkUpdate(dir, { run = defaultRun } = {}) {
  if (!fs.existsSync(path.join(dir, '.git'))) return { ok: false, code: 'no-git', error: 'git clone으로 받은 경우에만 업데이트할 수 있어요' };
  const f = await run('git', ['fetch', '--quiet'], { cwd: dir, timeout: 30000 });
  if (!f.ok) return fail('fetch', f);
  const c = await run('git', ['rev-list', '--count', 'HEAD..@{u}'], { cwd: dir });
  if (!c.ok) return { ...fail('check', c), code: classifyPullError(c.stderr) || 'no-upstream' };
  const behind = Number(c.stdout.trim()) || 0;
  if (!behind) return { ok: true, behind: 0, commits: [] };
  const log = await run('git', ['log', '--format=%h %s', '-n', '20', 'HEAD..@{u}'], { cwd: dir });
  return { ok: true, behind, commits: log.ok ? log.stdout.split('\n').filter(Boolean) : [] };
}

// 실제 업데이트: 확인 → pull --ff-only → npm install. 어느 단계에서 멈췄는지 step으로 알려 준다.
export async function runUpdate(dir, { run = defaultRun } = {}) {
  const c = await checkUpdate(dir, { run });
  if (!c.ok) return c;
  if (!c.behind) return { ok: true, changed: false };
  const p = await run('git', ['pull', '--ff-only'], { cwd: dir });
  if (!p.ok) return fail('pull', p);
  // 코드는 이미 새것 — npm이 실패해도 되돌리지 않고, 다시 켜기 전에 알 수 있게 실패로 알린다
  const n = await run('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, timeout: 180000 });
  if (!n.ok) return fail('npm', n);
  return { ok: true, changed: true, behind: c.behind };
}
