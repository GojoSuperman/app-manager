// public/browse.js
// 파일 열기 경로 찾아보기 창 (수정 창 위에 하나 더). 고른 경로를 돌려주고, 취소하면 null.
import { api } from './api.js';
import { el } from './dom.js';

const KIND = [[/\.(mp4|mov|webm|mkv|avi|m4v)$/i, '🎬'], [/\.(pdf|hwp|hwpx|docx?|pptx?|xlsx?|md|txt)$/i, '📄'], [/\.(png|jpe?g|gif|webp|svg)$/i, '🖼'], [/\.(mp3|wav|m4a|flac)$/i, '🎵']];
const iconOf = (e) => (e.dir ? '📁' : KIND.find(([re]) => re.test(e.name))?.[1] || '📃');
const sizeOf = (n) => (n == null ? '' : n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)}GB` : n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(0)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
const join = (dir, name) => (dir.endsWith('/') ? dir + name : `${dir}/${name}`);
const toWin = (p) => { const m = /^\/mnt\/([a-z])(\/.*)?$/i.exec(p); return m ? `${m[1].toUpperCase()}:${(m[2] || '/').replace(/\//g, '\\')}` : p; };

// kind: 'file' | 'folder', project: 연결된 프로젝트 폴더(바로가기 맨 앞), start: 처음 열 폴더
export function browse({ kind, project, start }) {
  return new Promise((resolve) => {
    const box = el('dialog', { className: 'browse' });
    const rootsEl = el('div', { className: 'browse-roots' });
    const crumb = el('div', { className: 'browse-path' });
    const list = el('div', { className: 'browse-list', role: 'listbox' });
    const status = el('p', { className: 'status' });
    const okBtn = el('button', { type: 'button', className: 'primary', disabled: kind === 'file' }, kind === 'file' ? '선택' : '이 폴더 선택');
    let cur = null;
    let chosen = null;
    const done = (v) => { box.close(); box.remove(); resolve(v); };
    box.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });

    async function go(dir) {
      const q = new URLSearchParams();
      if (dir) q.set('path', dir);
      if (project) q.set('project', project);
      const r = await api('GET', `/api/browse?${q}`);
      if (!r.ok) { status.textContent = r.error; status.className = 'status bad'; return; }
      cur = r;
      chosen = null;
      status.textContent = '';
      okBtn.disabled = kind === 'file';
      rootsEl.replaceChildren(...r.roots.map((x) => el('button', {
        type: 'button', className: r.path === x.path || r.path.startsWith(`${x.path}/`) ? 'on' : '', 'data-tip': toWin(x.path), onclick: () => go(x.path),
      }, x.label)));
      crumb.replaceChildren(
        el('button', { type: 'button', disabled: !r.parent, 'data-tip': '상위 폴더로', onclick: () => go(r.parent) }, '⬆'),
        el('span', { 'data-tip': r.path }, r.winPath));
      const files = kind === 'file' ? r.entries : r.entries.filter((e) => e.dir);
      list.replaceChildren(...(files.length ? files.map(row) : [el('p', { className: 'hint' }, kind === 'file' ? '빈 폴더예요' : '하위 폴더가 없어요. "이 폴더 선택"을 누르면 지금 폴더가 들어가요')]));
      list.scrollTop = 0;
    }

    function row(e) {
      const p = join(cur.path, e.name);
      const item = el('div', {
        className: 'browse-item', role: 'option', tabIndex: 0, 'data-tip': !e.dir ? '클릭해서 고르고 "선택" (더블클릭은 바로 선택)'
          : kind === 'file' ? '클릭하면 들어가요' : '클릭하면 이 폴더를 고르고, 더블클릭하면 들어가요',
        onclick: () => {
          if (e.dir && kind === 'file') return go(p);
          for (const x of list.querySelectorAll('.on')) x.classList.remove('on');
          item.classList.add('on');
          chosen = p;
          okBtn.disabled = false;
        },
        ondblclick: () => (e.dir ? go(p) : done(toWin(p))),
      }, el('span', { className: 'ico' }, iconOf(e)), el('span', { className: 'name' }, e.name), el('span', { className: 'size' }, sizeOf(e.size)));
      return item;
    }

    okBtn.addEventListener('click', () => done(toWin(kind === 'file' ? chosen : chosen || cur.path)));
    box.append(
      el('h3', {}, kind === 'file' ? '📄 열 파일 고르기' : '📁 열 폴더 고르기'),
      rootsEl, crumb, list, status,
      el('div', { className: 'btns' }, el('button', { type: 'button', onclick: () => done(null) }, '취소'), okBtn));
    document.body.append(box);
    box.showModal();
    go(start || null);
  });
}
