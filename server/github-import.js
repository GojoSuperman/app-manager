// server/github-import.js
// GitHub에서 가져오기: 내 저장소 목록(gh) → 체크 목록 → 고른 것만 카드로.
// GitHub로는 "실행 방법"을 거의 알 수 없다(웹사이트 주소가 있는 저장소만 바로 실행 가능, 배포 기록은 믿을 수 없음 — 2026-10-06 실측)
// → 웹사이트 주소가 없으면 '확인 필요' 카드로 만들고 수정 창이나 등록 스킬로 채운다.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const FIELDS = 'name,description,homepageUrl,isPrivate,isFork,isArchived,url';

function runGh(args) {
  return new Promise((resolve) => {
    execFile('gh', args, { timeout: 30000, maxBuffer: 8 * 1024 * 1024 }, (e, stdout = '', stderr = '') => {
      if (!e) return resolve({ ok: true, stdout: String(stdout) });
      resolve({ ok: false, code: e.code, stderr: String(stderr) });
    });
  });
}

export async function listRepos({ run = runGh, limit = 200 } = {}) {
  const r = await run(['repo', 'list', '--limit', String(limit), '--json', FIELDS]);
  if (r.ok) {
    try {
      return { ok: true, repos: JSON.parse(r.stdout) };
    } catch {
      return { ok: false, error: 'gh가 돌려준 목록을 읽지 못했어요' };
    }
  }
  if (r.code === 'ENOENT') return { ok: false, error: 'GitHub CLI(gh)가 설치되어 있지 않아요. WSL에 gh를 설치하고 `gh auth login`으로 로그인해 주세요' };
  if (/auth login|not logged in/i.test(r.stderr || '')) return { ok: false, error: 'gh에 로그인되어 있지 않아요. WSL 터미널에서 `gh auth login`을 먼저 실행해 주세요' };
  return { ok: false, error: `gh 실행에 실패했어요 (${(r.stderr || '').trim().split('\n').pop() || r.code})` };
}

const norm = (u) => String(u || '').trim().toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '');

// 프로젝트 폴더 안 git 저장소들의 origin 주소 → 폴더 (폴더 이름이 저장소 이름과 달라도 찾기 위해)
function originMap(projectsRoot) {
  const map = new Map();
  let names = [];
  try { names = fs.readdirSync(projectsRoot); } catch { return map; }
  for (const n of names) {
    try {
      const conf = fs.readFileSync(path.join(projectsRoot, n, '.git', 'config'), 'utf8');
      const m = /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(conf);
      if (m) map.set(norm(m[1].replace(/^git@github\.com:/, 'https://github.com/')), path.join(projectsRoot, n));
    } catch { /* git 폴더 아님 */ }
  }
  return map;
}

export function buildCandidates(repos, { projectsRoot, apps }) {
  const origins = originMap(projectsRoot);
  return repos.map((r) => {
    const byName = path.join(projectsRoot, r.name);
    const localDir = origins.get(norm(r.url)) || (fs.existsSync(path.join(byName, '.git')) ? byName : null);
    const homepage = r.homepageUrl || '';
    const card = apps.find((a) => (localDir && a.sourceDir === localDir) || (homepage && a.launch?.url === homepage))?.name || null;
    return {
      name: r.name, description: r.description || '', homepageUrl: homepage, url: r.url,
      private: !!r.isPrivate, fork: !!r.isFork, archived: !!r.isArchived, localDir, card,
      checked: !!homepage && !card && !r.isArchived,
    };
  });
}

export function cardFromRepo(c) {
  return {
    name: c.name, description: c.description || '', category: '', sourceDir: c.localDir || null,
    launch: { type: 'url', url: c.homepageUrl || '' },
    needsReview: !c.homepageUrl, // 실행 방법을 모르면 '확인 필요' — 수정 창이나 등록 스킬로 채운다
  };
}
