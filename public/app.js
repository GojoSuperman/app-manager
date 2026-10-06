// public/app.js
// 런처 첫 화면: 분류 칩 + 카드 격자. 목록 파일이 바뀌면(SSE) 다시 그린다.
import { api } from './api.js';
import { el } from './dom.js';
import { chipList, filterApps, mergeOrder, canReorder, categoryColors, labelOptions, thumbHue, initials, launchLabel, subtitle, thumbSrc } from './ui-logic.js';
import { openDialog } from './dialog.js';
import './tooltip.js';
import { openGithubImport } from './github-dialog.js';

const $ = (s) => document.querySelector(s);
const state = { apps: [], order: [], categories: [], tabOrder: [], labels: [], colors: {}, addingCategory: false, chip: 'all', query: '', errors: new Map(), busy: new Set() };
const enc = encodeURIComponent;

async function load() {
  const r = await api('GET', '/api/apps');
  if (!r.ok) return showWarning(r.error);
  state.apps = r.apps;
  state.order = r.order || [];
  state.categories = r.categories || [];
  state.tabOrder = r.tabOrder || [];
  state.labels = r.labels || [];
  showWarning(r.warning);
  render();
}

function showWarning(msg) {
  const w = $('#warning');
  w.hidden = !msg;
  w.textContent = msg ? `⚠️ ${msg}` : '';
}

let toastTimer;
function toast(text, action) {
  const t = $('#toast');
  t.replaceChildren(el('span', {}, text), ...(action ? [el('button', { onclick: () => { t.hidden = true; action.onClick(); } }, action.label)] : []));
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 8000);
}

export function thumbBox(app, className = 'thumb') {
  const box = el('div', { className });
  if (app.thumbnail) {
    box.append(el('img', { src: thumbSrc(app), alt: '', loading: 'lazy' }));
  } else {
    const h = thumbHue(app.name);
    box.style.background = `linear-gradient(135deg, hsl(${h} 45% 30%), hsl(${(h + 40) % 360} 55% 50%))`;
    box.append(el('span', { className: 'initial' }, initials(app.name)));
  }
  return box;
}

function render() {
  const chips = chipList(state.apps, state.categories, state.tabOrder);
  if (!chips.some((c) => c.key === state.chip)) state.chip = 'all';
  $('#chips').replaceChildren(...chips.map((c) => el('button', {
    className: c.key === state.chip ? 'chip on' : 'chip', 'data-key': c.key,
    draggable: c.key.startsWith('cat:'), 'data-tip': CHIP_TIPS[c.key] || (c.key.startsWith('cat:') ? `'${c.label}' 분류 카드만 보기 · 끌어서 탭 순서 바꾸기 · 카드를 여기 놓으면 이 분류로 이동` : ''),
    onclick: () => { state.chip = c.key; render(); },
  }, `${c.label} ${c.count}`, c.manual ? el('span', {
    className: 'chip-x', 'data-tip': '빈 분류 탭 지우기', 'aria-label': `${c.label} 탭 지우기`,
    onclick: (e) => { e.stopPropagation(); removeCategory(c.label); },
  }, '×') : null)), addCategoryChip());
  const list = filterApps(state.apps, state);
  state.colors = categoryColors(categories());
  $('#grid').replaceChildren(...list.map(card));
  const empty = $('#empty');
  empty.hidden = list.length > 0;
  empty.textContent = state.apps.length
    ? (state.chip.startsWith('cat:') && !state.query ? '이 분류에는 아직 카드가 없어요. 다른 탭에서 카드를 끌어 이 탭에 놓으세요' : '조건에 맞는 앱이 없어요')
    : '아직 카드가 없어요. ＋ 앱 추가로 직접 넣거나, ⬇ GitHub에서 가져오기로 내 저장소에서 고르거나, 프로젝트 폴더의 Claude Code에게 "앱 관리 프로젝트에 등록해줘"라고 말해 보세요.';
}

// 분류 탭 직접 추가: ＋를 누르면 그 자리에서 이름 입력 (Enter 추가 · Esc 취소)
function addCategoryChip() {
  if (!state.addingCategory) {
    return el('button', { className: 'chip chip-add', 'data-tip': '분류 탭 직접 추가 (이름 적고 Enter)', 'aria-label': '분류 탭 추가', onclick: () => { state.addingCategory = true; render(); } }, '＋');
  }
  const input = el('input', { className: 'chip-input', maxLength: 30, placeholder: '새 분류 이름', 'aria-label': '새 분류 이름' });
  const cancel = () => { state.addingCategory = false; render(); };
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') return cancel();
    if (e.key !== 'Enter' || e.isComposing) return; // 한글 조합 중 Enter는 무시
    const name = input.value.trim();
    if (!name) return cancel();
    const r = await api('POST', '/api/categories', { name });
    if (!r.ok) return toast(`⚠️ ${r.error}`);
    state.categories = r.categories;
    state.addingCategory = false;
    state.chip = `cat:${name}`;
    render();
    toast(`'${name}' 분류 탭을 만들었어요. 카드를 끌어다 놓으세요`);
  });
  input.addEventListener('blur', () => { if (!input.value.trim()) cancel(); });
  setTimeout(() => input.focus());
  return input;
}

async function removeCategory(name) {
  const r = await api('DELETE', `/api/categories/${enc(name)}`);
  if (!r.ok) return toast(`⚠️ ${r.error}`);
  state.categories = r.categories;
  render();
}

const stop = (fn) => (e) => { e.stopPropagation(); fn(); };

// 이모지(✏ 등)는 글꼴마다 모양이 달라 깨져 보여서 선 아이콘으로 통일 (고정 문자열이라 innerHTML 안전)
const ICONS = {
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
};
function icon(name) {
  const s = el('span', { className: 'ico' });
  s.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return s;
}

function card(a) {
  const thumb = thumbBox(a);
  thumb.append(el('span', { className: 'badge' }, launchLabel(a.launch)));
  if (a.needsReview) thumb.append(el('span', { className: 'badge review' }, '확인 필요'));
  const err = state.errors.get(a.id);
  const art = el('article', { className: 'card', title: '누르면 실행 · 끌어서 순서 바꾸기·분류 탭에 놓기', draggable: true, 'data-id': a.id, onclick: () => run(a) },
    thumb,
    el('div', { className: 'body' },
      el('b', {}, a.name),
      el('i', {}, subtitle(a)),
      el('div', { className: 'acts' },
        runButton(a),
        iconBtn('edit', '수정', () => edit(a)),
        a.sourceDir ? iconBtn('folder', '원본 폴더 열기', () => openFolder(a)) : null,
        iconBtn('trash', '런처에서 카드 삭제 (앱 원본은 그대로)', () => remove(a), 'danger')),
      err ? el('p', { className: 'err' }, `⚠️ ${err}`) : null));
  // 분류별 색 띠 (분류마다 겹치지 않는 색)
  if (state.colors[a.category]) art.style.setProperty('--cat', state.colors[a.category]);
  return art;
}

// 아이콘 버튼 + 마우스를 올리면 바로 뜨는 안내(data-tip). title은 늦게 떠서 안내는 CSS로 보여 준다.
function iconBtn(name, tip, fn, extra = '') {
  return el('button', { className: `icon-btn ${extra}`.trim(), 'data-tip': tip, 'aria-label': tip, onclick: stop(fn) }, icon(name));
}

const CHIP_TIPS = { all: '모든 카드 보기', recent: '최근에 실행한 카드 (실행 시간순)', review: '실행 정보를 채워야 하는 카드' };
// 실행 버튼 안내: 무엇을 여는지
const launchTip = (l) => ({
  url: () => `웹 주소 ${l.url}`, 'chrome-app': () => '크롬 앱 창으로 열기', windows: () => `Windows 실행 ${l.file}`,
  wsl: () => `WSL 명령 ${l.command}`, 'local-web': () => `로컬 웹 ${l.dir}`, file: () => `파일 열기 ${l.path}`,
}[l.type]?.() || '실행');

// ▶ 실행. 실행이 여러 개인 카드(배포판·로컬판 등)는 [▶ 기본 실행 │▾] 분할 버튼 — ▾로 다른 실행 고르기
function runButton(a) {
  const more = a.moreLaunches || [];
  const busy = state.busy.has(a.id);
  const main = el('button', { className: 'run', 'data-tip': `실행: ${launchTip(a.launch)}`, onclick: stop(() => run(a)) }, icon('play'), busy ? '실행 중…' : (more.length && a.launchLabel) || '실행');
  if (!more.length) return main;
  const item = (label, i) => el('button', { type: 'button', 'data-tip': launchTip(i ? more[i - 1].launch : a.launch), onclick: (e) => { e.stopPropagation(); e.target.closest('details').open = false; run(a, i); } }, icon('play'), label);
  return el('div', { className: 'run-split' }, main,
    el('details', { className: 'run-more', onclick: (e) => e.stopPropagation() },
      el('summary', { 'data-tip': '다른 실행 고르기', 'aria-label': '다른 실행 고르기' }, '▾'),
      el('div', { className: 'menu' }, item(a.launchLabel || '기본 실행', 0), ...more.map((m, i) => item(m.label, i + 1)))));
}

async function run(a, index = 0) {
  if (state.busy.has(a.id)) return;
  state.busy.add(a.id);
  state.errors.delete(a.id);
  render();
  const r = await api('POST', `/api/apps/${enc(a.id)}/launch`, { index });
  state.busy.delete(a.id);
  if (!r.ok) state.errors.set(a.id, r.error);
  render();
}

const categories = () => [...new Set([...state.apps.map((a) => a.category).filter(Boolean), ...state.categories])].sort((x, y) => x.localeCompare(y, 'ko'));
const afterSave = (note) => { if (note) toast(note); load(); };
const dialogOpts = () => ({ categories: categories(), labels: labelOptions(state.apps, state.labels), onSaved: afterSave });
const edit = (a) => openDialog({ app: a, ...dialogOpts() });

async function remove(a) {
  if (!confirm(`'${a.name}' 카드를 런처에서 삭제할까요?\n앱 원본 파일은 그대로 두고 런처 목록에서만 빠져요. 휴지통으로 옮겨져 되돌릴 수 있어요.`)) return;
  const r = await api('DELETE', `/api/apps/${enc(a.id)}`);
  if (!r.ok) return toast(`⚠️ ${r.error}`);
  toast(`'${a.name}' 카드를 런처에서 삭제했어요`, {
    label: '되돌리기',
    onClick: async () => { const b = await api('POST', `/api/trash/${enc(r.trashName)}/restore`); if (!b.ok) toast(`⚠️ ${b.error}`); },
  });
}

async function openFolder(a) {
  const r = await api('POST', `/api/apps/${enc(a.id)}/open-folder`);
  if (!r.ok) toast(`⚠️ ${r.error}`);
}

async function quit() {
  if (!confirm('런처를 끌까요? 다시 켜려면 바탕화면 아이콘을 누르세요.')) return;
  await api('POST', '/api/shutdown');
  document.body.replaceChildren(el('p', { className: 'bye' }, '런처를 껐어요. 이 창을 닫아도 됩니다.'));
}

// ── 끌어 놓기: 카드끼리 = 순서 바꾸기(전체·분류 탭에서), 분류 탭 위에 놓기 = 그 분류로 옮기기 ──
const grid = $('#grid');
const chipBar = $('#chips');
let drag = null; // { app, el, before, onTab }
const visibleIds = () => [...grid.querySelectorAll('.card')].map((c) => c.dataset.id);

grid.addEventListener('dragstart', (e) => {
  const c = e.target.closest?.('.card');
  if (!c) return;
  drag = { app: state.apps.find((a) => a.id === c.dataset.id), el: c, before: visibleIds().join('\n'), onTab: false };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', c.dataset.id);
  c.classList.add('dragging');
  chipBar.classList.add('card-dragging');
  chipBar.querySelector(`.chip[data-key="cat:${CSS.escape(drag.app.category || '')}"]`)?.classList.add('own'); // 자기 분류엔 못 놓음
});

grid.addEventListener('dragover', (e) => {
  if (!drag) return;
  e.preventDefault();
  if (!canReorder(state.chip)) return;
  const over = e.target.closest?.('.card');
  if (!over || over === drag.el) return;
  const r = over.getBoundingClientRect();
  const after = e.clientX > r.left + r.width / 2;
  if (after ? over.nextElementSibling !== drag.el : over.previousElementSibling !== drag.el) over[after ? 'after' : 'before'](drag.el);
});
grid.addEventListener('drop', (e) => { if (drag) e.preventDefault(); });

grid.addEventListener('dragend', async () => {
  if (!drag) return;
  const d = drag;
  drag = null;
  d.el.classList.remove('dragging');
  chipBar.classList.remove('card-dragging');
  for (const x of chipBar.querySelectorAll('.drop-target, .own')) x.classList.remove('drop-target', 'own');
  if (d.onTab || !canReorder(state.chip)) return render();
  const ids = visibleIds();
  if (ids.join('\n') === d.before) return;
  const full = filterApps(state.apps, { order: state.order }).map((a) => a.id);
  state.order = mergeOrder(full, ids);
  const r = await api('POST', '/api/order', { ids: state.order });
  if (!r.ok) toast(`⚠️ 순서를 저장하지 못했어요: ${r.error}`);
});

// 놓을 수 있는 탭: 다른 분류 탭만 (전체·최근 실행·확인 필요·지금 분류는 아님)
const tabCategory = (e) => {
  const chip = e.target.closest?.('.chip');
  const key = chip?.dataset.key || '';
  return drag && key.startsWith('cat:') && key.slice(4) !== drag.app.category ? { chip, category: key.slice(4) } : null;
};
chipBar.addEventListener('dragover', (e) => {
  const t = tabCategory(e);
  for (const x of chipBar.querySelectorAll('.drop-target')) if (x !== t?.chip) x.classList.remove('drop-target');
  if (!t) return;
  e.preventDefault();
  t.chip.classList.add('drop-target');
});
chipBar.addEventListener('drop', (e) => {
  const t = tabCategory(e);
  if (!t) return;
  e.preventDefault();
  drag.onTab = true;
  moveToCategory(drag.app, t.category);
});

// 분류 탭끼리 끌어서 순서 바꾸기 (전체·최근 실행·확인 필요는 자리 고정)
let tabDrag = null; // { el, before }
const catTabs = () => [...chipBar.querySelectorAll('.chip[data-key^="cat:"]')];
const tabNames = () => catTabs().map((c) => c.dataset.key.slice(4));
chipBar.addEventListener('dragstart', (e) => {
  const c = e.target.closest?.('.chip[data-key^="cat:"]');
  if (!c) return;
  tabDrag = { el: c, before: tabNames().join('\n') };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', c.dataset.key);
  c.classList.add('dragging');
});
chipBar.addEventListener('dragover', (e) => {
  if (!tabDrag) return;
  const over = e.target.closest?.('.chip[data-key^="cat:"]');
  e.preventDefault();
  if (!over || over === tabDrag.el) return;
  const r = over.getBoundingClientRect();
  const after = e.clientX > r.left + r.width / 2;
  if (after ? over.nextElementSibling !== tabDrag.el : over.previousElementSibling !== tabDrag.el) over[after ? 'after' : 'before'](tabDrag.el);
});
chipBar.addEventListener('drop', (e) => { if (tabDrag) e.preventDefault(); });
chipBar.addEventListener('dragend', async () => {
  if (!tabDrag) return;
  const d = tabDrag;
  tabDrag = null;
  d.el.classList.remove('dragging');
  const names = tabNames();
  if (names.join('\n') === d.before) return;
  state.tabOrder = names;
  const r = await api('POST', '/api/tab-order', { names });
  if (!r.ok) toast(`⚠️ 탭 순서를 저장하지 못했어요: ${r.error}`);
});

async function moveToCategory(a, category, { undo = true } = {}) {
  const { id, createdAt, updatedAt, lastLaunchedAt, ...saved } = a;
  const r = await api('PUT', `/api/apps/${enc(id)}`, { ...saved, category });
  if (!r.ok) return toast(`⚠️ ${r.error}`);
  if (!undo) return toast(`'${a.name}'을(를) 되돌렸어요`);
  toast(`'${a.name}'을(를) '${category}' 분류로 옮겼어요`, {
    label: '되돌리기', onClick: () => moveToCategory(r.app, a.category, { undo: false }),
  });
}

$('#search').addEventListener('input', (e) => { state.query = e.target.value; render(); });
$('#add').addEventListener('click', () => openDialog({ app: null, ...dialogOpts() }));
$('#quit').addEventListener('click', quit);
$('#gh-import').addEventListener('click', () => openGithubImport({ onDone: (msg) => { toast(msg); load(); } }));
new EventSource('/api/events').addEventListener('apps', load);

await load();
// 주소 해시로 창 바로 열기 (#add, #edit=<id>) — 스크린샷 실측용
if (location.hash === '#add') $('#add').click();
const m = /^#edit=(.+)$/.exec(location.hash);
const target = m && state.apps.find((a) => a.id === decodeURIComponent(m[1]));
if (target) edit(target);
