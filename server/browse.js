// server/browse.js
// 파일 열기 경로를 화면 안에서 고르는 찾아보기: 폴더 목록과 바로가기.
// (Windows 선택 창은 WSL에서 띄우면 다른 창 뒤에 깔려 보이지 않아 쓰지 않는다 — 2026-10-03 실측)
import fs from 'node:fs';
import path from 'node:path';

const SKIP_USERS = new Set(['Public', 'Default', 'Default User', 'All Users']);

// 폴더 안 목록: 폴더 먼저, 이름순(한국어), 숨김(.으로 시작) 제외.
// Windows 폴더 중엔 WSL이 못 읽는 곳이 있다(다운로드 폴더가 EIO — 클라우드 파일 등, 2026-10-03 실측) → winList로 Windows에서 대신 읽기
export async function listDir(dir, { winList = null } = {}) {
  if (typeof dir !== 'string' || !dir.startsWith('/')) return { ok: false, error: '/로 시작하는 경로여야 해요' };
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).map((d) => {
      let isDir = d.isDirectory();
      let size = null;
      try {
        const st = fs.statSync(path.join(dir, d.name)); // 링크도 따라가서 판단
        isDir = st.isDirectory();
        size = isDir ? null : st.size;
      } catch { /* 깨진 링크 등은 이름만 */ }
      return { name: d.name, dir: isDir, size };
    });
  } catch (e) {
    if (!(winList && /^\/mnt\/[a-z](\/|$)/i.test(dir))) return { ok: false, error: `폴더를 열지 못했어요 (${e.code || e.message})` };
    try {
      entries = await winList(toWinPath(dir));
    } catch (e2) {
      return { ok: false, error: `폴더를 열지 못했어요 (${e2.message})` };
    }
  }
  entries = entries.filter((x) => !x.name.startsWith('.'));
  entries.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, 'ko'));
  const parent = dir === '/' ? null : path.dirname(dir);
  return { ok: true, path: dir, parent, entries };
}

// /mnt/c/Users/… → C:\Users\… (Windows 쪽 파일은 Windows 경로로 열어야 빠르다)
export function toWinPath(p) {
  const m = /^\/mnt\/([a-z])(\/.*)?$/i.exec(p);
  return m ? `${m[1].toUpperCase()}:${(m[2] || '/').replace(/\//g, '\\')}` : p;
}

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// 바로가기: 이 프로젝트 · ~/projects · Windows 사용자 폴더(다운로드·바탕화면·문서) 중 있는 것
export function browseRoots({ project, projectsRoot, usersDir = '/mnt/c/Users' }) {
  const roots = [];
  if (project && isDir(project)) roots.push({ label: '이 프로젝트', path: project });
  if (isDir(projectsRoot)) roots.push({ label: '~/projects', path: projectsRoot });
  let users = [];
  try {
    users = fs.readdirSync(usersDir).filter((u) => !SKIP_USERS.has(u) && !u.startsWith('defaultuser') && isDir(path.join(usersDir, u, 'Downloads')));
  } catch { /* Windows 드라이브가 없으면 건너뜀 */ }
  for (const u of users) {
    const base = path.join(usersDir, u);
    const pick = (...cands) => cands.map((c) => path.join(base, c)).find(isDir);
    const many = users.length > 1 ? ` (${u})` : '';
    for (const [label, p] of [['다운로드', pick('Downloads')], ['바탕화면', pick('OneDrive/Desktop', 'OneDrive/바탕 화면', 'Desktop')], ['문서', pick('Documents', 'OneDrive/문서', 'OneDrive/Documents')]]) {
      if (p) roots.push({ label: label + many, path: p });
    }
  }
  return roots;
}
