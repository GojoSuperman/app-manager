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
      if (m) {
        // 같은 저장소를 가리키는 폴더가 여럿일 수 있다 (예: 앱 폴더와 그 앱의 챗봇 폴더 — 2026-10-06 실측)
        const key = norm(m[1].replace(/^git@github\.com:/, 'https://github.com/'));
        map.set(key, [...(map.get(key) || []), path.join(projectsRoot, n)]);
      }
    } catch { /* git 폴더 아님 */ }
  }
  return map;
}

// 내려받은 폴더를 살펴 실행 방법 추측 (등록 스킬의 판단을 단순하게): { web, local } 또는 null
// web: README의 배포 주소·package.json homepage → 웹 주소 / local: npm start·dev → WSL 명령, 정적 index.html → 로컬 웹
// Godot·Windows 스크립트처럼 경로를 사람이 정해야 하는 것은 추측하지 않는다.
const DEPLOY_HOSTS = /https:\/\/[\w.-]+\.(vercel\.app|netlify\.app|onrender\.com|github\.io|pages\.dev|railway\.app|up\.railway\.app|fly\.dev|herokuapp\.com|web\.app|firebaseapp\.com|streamlit\.app|hf\.space)(\/[^\s)\]"'<>*]*)?/i;

const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };

export function guessLaunch(dir) {
  if (!dir) return null;
  let pkg = null;
  try { pkg = JSON.parse(readText(path.join(dir, 'package.json')) || 'null'); } catch { /* 깨진 package.json */ }
  let web = null;
  const readme = ['README.md', 'readme.md', 'README.en.md'].map((f) => readText(path.join(dir, f))).find(Boolean);
  const m = readme && DEPLOY_HOSTS.exec(readme);
  if (m) web = { launch: { type: 'url', url: m[0].replace(/[*_.,;:!?]+$/, '') }, how: 'README의 배포 주소' }; // **굵은 글씨**·문장부호 떼기
  else if (/^https?:\/\//.test(pkg?.homepage || '')) web = { launch: { type: 'url', url: pkg.homepage }, how: 'package.json homepage' };
  let local = null;
  const script = pkg?.scripts?.start ? 'npm start' : pkg?.scripts?.dev ? 'npm run dev' : null;
  if (script) local = { launch: { type: 'wsl', command: script, cwd: dir, window: 'new' }, how: script };
  else {
    const site = ['', 'public', 'dist'].find((sub) => fs.existsSync(path.join(dir, sub, 'index.html')));
    if (site !== undefined && !pkg) {
      local = { launch: { type: 'local-web', dir: site ? path.join(dir, site) : dir, entry: 'index.html' }, how: `정적 사이트 (${site ? `${site}/` : ''}index.html)` };
    }
  }
  return web || local ? { web, local } : null;
}

export function buildCandidates(repos, { projectsRoot, apps }) {
  const origins = originMap(projectsRoot);
  return repos.map((r) => {
    const byName = path.join(projectsRoot, r.name);
    const dirs = [...(origins.get(norm(r.url)) || [])];
    if (fs.existsSync(path.join(byName, '.git')) && !dirs.includes(byName)) dirs.push(byName);
    const localDir = dirs.find((d) => path.basename(d) === r.name) || dirs[0] || null; // 저장소 이름과 같은 폴더 우선
    const homepage = r.homepageUrl || '';
    const card = apps.find((a) => (a.sourceDir && dirs.includes(a.sourceDir)) || (homepage && a.launch?.url === homepage))?.name || null;
    return {
      name: r.name, description: r.description || '', homepageUrl: homepage, url: r.url,
      private: !!r.isPrivate, fork: !!r.isFork, archived: !!r.isArchived, localDir, card,
      guess: localDir ? guessLaunch(localDir) : null, // 추측한 실행은 미리 체크하지 않는다 (사람이 보고 고르게)
      checked: !!homepage && !card && !r.isArchived,
    };
  });
}

export function cardFromRepo(c) {
  const base = { name: c.name, description: c.description || '', category: '', sourceDir: c.localDir || null };
  // 배포 주소: GitHub 웹사이트 주소 우선, 없으면 README·homepage에서 찾은 것
  const web = c.homepageUrl ? { type: 'url', url: c.homepageUrl } : c.guess?.web?.launch || null;
  const local = c.guess?.local?.launch || null;
  if (web && local) return { ...base, launch: web, needsReview: false, launchLabel: '배포판', moreLaunches: [{ label: '로컬판', launch: local }] };
  if (web || local) return { ...base, launch: web || local, needsReview: false };
  // 실행 방법을 모르면 '확인 필요' — 수정 창이나 등록 스킬로 채운다
  return { ...base, launch: { type: 'url', url: '' }, needsReview: true };
}
