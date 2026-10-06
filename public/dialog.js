// public/dialog.js
// 앱 추가/수정 창. 실행 방법 5종 탭, 시험 실행, 썸네일(올리기·붙여넣기·끌어 놓기·자동 캡처 + 편집기).
import { api } from './api.js';
import { el } from './dom.js';
import { formToLaunch, launchToForm, thumbHue, initials, thumbSrc } from './ui-logic.js';
import { createImageEditor } from './image-edit.js';
import { browse } from './browse.js';
import { LAUNCH_TYPES, LAUNCH_LABELS, allLaunches } from '../server/app-schema.js';

// 종류별 입력칸: [필드, 이름표, 안내 글]
const FIELDS = {
  url: [['url', '웹 주소', 'https://…']],
  'chrome-app': [['appId', '크롬 앱 ID (a~p 32자)', '바로가기 대상의 --app-id= 값'], ['profile', '크롬 프로필', 'Default'], ['url', '캡처용 주소 (선택)', '앱이 여는 https://… — 썸네일 자동 캡처에만 써요']],
  windows: [['file', '실행 파일 (Windows 경로)', 'C:\\…\\app.exe · .bat · .vbs · .ps1'], ['args', '인자 (선택)', '--path "C:\\내 폴더"'], ['winCwd', '작업 폴더 (선택)', '비우면 실행 파일이 있는 폴더']],
  wsl: [['command', 'WSL 명령', 'npm start'], ['wslCwd', '작업 폴더 (선택)', '/home/…/project'], ['window', '창', '']],
  'local-web': [['dir', '폴더 (WSL 경로)', '/home/…/site'], ['entry', '시작 페이지', 'index.html']],
  file: [['filePath', '파일 또는 폴더 경로 (영상·문서 등 결과물)', 'C:\\Users\\…\\완성본.mp4 또는 /home/…/output.pdf']],
};
const CAPTURABLE = new Set(['url', 'local-web', 'chrome-app']);
const TYPE_TIPS = {
  url: '배포된 웹사이트 주소를 기본 브라우저로 엽니다',
  'chrome-app': '크롬에 설치한 웹앱(PWA)을 앱 창으로 엽니다',
  windows: 'Windows 프로그램이나 .bat·.vbs·.ps1을 실행합니다',
  wsl: 'WSL(우분투)에서 명령을 실행합니다 (예: npm start)',
  'local-web': '빌드 없이 여는 index.html 폴더를 런처가 웹으로 띄웁니다',
  file: '영상·문서 같은 결과물이나 폴더를 Windows 기본 프로그램으로 엽니다',
};
const enc = encodeURIComponent;

export function openDialog({ app, categories, labels = [], onSaved }) {
  let labelOpts = labels; // [{ label, custom, used }] — 칩으로 고르는 이름표
  let addingLabel = false;
  const dlg = document.querySelector('#dialog');
  // 한 카드의 실행들(배포판·로컬판 등). 첫 번째가 기본 실행. 지금 고치는 실행 = variants[cur]
  const variants = allLaunches(app || { launch: { type: 'url', url: '' } })
    .map(({ label, launch }) => ({ label, type: launch.type, fields: launchToForm(launch) }));
  let cur = 0;
  let pendingCapture = false;
  let editing = false; // 편집기에 이미지가 들어 있으면 저장 때 편집 결과를 썸네일로
  let currentSrc = app?.thumbnail ? thumbSrc(app) : null;

  const input = (name, value, props = {}) => el('input', { name, value: value ?? '', ...props });
  // 프로젝트명 = 원본 폴더의 실제 이름(읽기 전용), 별명 = 카드에 보이는 이름(바로가기 이름에서 온 것, 바꿀 수 있음)
  const projectName = app?.sourceDir ? app.sourceDir.replace(/\/+$/, '').split('/').pop() : '';
  const projIn = input('project', projectName, { readOnly: true, placeholder: '연결된 프로젝트 폴더 없음', 'data-tip': app?.sourceDir ? `원본 폴더: ${app.sourceDir} (바꿀 수 없음)` : '' });
  // 새로 추가할 때만: ~/projects 아래 폴더에서 고르기 (고르지 않으면 폴더 없는 카드)
  let sourceDir = app?.sourceDir || null;
  const projSel = el('select', { name: 'projectDir', 'data-tip': '~/projects 아래 프로젝트 폴더와 연결 (카드의 📁 버튼으로 열림)', onchange: pickProject }, el('option', { value: '' }, '연결 안 함 (프로젝트 폴더 없는 앱)'));
  let projectDirs = [];
  if (!app) {
    api('GET', '/api/projects').then((r) => {
      if (!r.ok) return;
      projectDirs = r.dirs;
      // 아직 카드 없는 폴더를 위에 (추가할 때 주로 고르는 것), 이미 카드가 있는 폴더는 아래 묶음으로
      const fresh = r.dirs.filter((d) => !d.card);
      const added = r.dirs.filter((d) => d.card);
      projSel.append(
        el('optgroup', { label: `아직 카드 없음 (${fresh.length}개)` }, fresh.map((d) => el('option', { value: d.path }, d.name))),
        el('optgroup', { label: `이미 카드 있음 (${added.length}개)` }, added.map((d) => el('option', { value: d.path }, `${d.name}  — ${d.card}`))));
    });
  }
  const nameIn = input('name', app?.name, { required: true, maxLength: 100, placeholder: '카드에 보이는 이름 (예: 내 포트폴리오)' });
  const descIn = el('textarea', { name: 'description', rows: 3, maxLength: 300, value: app?.description || '', placeholder: '이 프로젝트가 어떤 건지 적어 주세요 (예: 발표 연습을 녹화해 피드백 받는 앱)' });
  const catIn = input('category', app?.category, { maxLength: 30, placeholder: '새 분류는 직접 입력' });
  // 오른쪽 드롭다운: 지금 있는 분류 탭. 수정 중이면 고르는 즉시(확인 뒤) 카드가 그 분류로 옮겨진다.
  const catSel = el('select', { className: 'cat-select', 'data-tip': app ? '지금 있는 분류 탭에서 고르기 (고르면 확인 뒤 바로 이동)' : '지금 있는 분류 탭에서 고르기', onchange: pickCategory },
    el('option', { value: '' }, '분류 탭 ▾'),
    categories.map((c) => el('option', { value: c, selected: c === app?.category }, c)));
  const vtabs = el('div', { className: 'vtabs' });
  const vbar = el('div', { className: 'vbar' });
  const seg = el('div', { className: 'seg' });
  const sub = el('div', { className: 'sub' });
  const preview = el('div', { className: 'thumb small' });
  const status = el('p', { className: 'status' });
  const captureBtn = el('button', { type: 'button', 'data-tip': '웹 주소·로컬 웹·크롬 앱 화면을 찍어 썸네일로 (최대 15초)', onclick: capture }, '자동 캡처');
  const editor = createImageEditor();
  const editBtn = el('button', { type: 'button', 'data-tip': '지금 썸네일을 다시 맞추기 (위치·크기·회전·반전)', onclick: () => openEditor(currentSrc) }, '✂ 편집');
  const cancelEditBtn = el('button', { type: 'button', 'data-tip': '편집하던 이미지를 버리고 원래 썸네일 유지', onclick: closeEditor }, '편집 취소');
  const fileIn = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, onchange: () => fileIn.files[0] && readImage(fileIn.files[0]) });

  const say = (text, bad = false) => { status.textContent = text; status.className = bad ? 'status bad' : 'status'; };

  function renderType() {
    const v = variants[cur];
    const { fields } = v;
    // 실행 고르기 탭 + ＋ 실행 추가
    vtabs.replaceChildren(...variants.map((x, i) => el('button', {
      type: 'button', className: i === cur ? 'on' : '', 'data-tip': i === 0 ? '기본 실행 — 카드의 ▶ 버튼이 여는 것' : '추가 실행 — 카드의 ▾ 메뉴에서 고름', onclick: () => { cur = i; renderType(); },
    }, x.label || (i ? `실행 ${i + 1}` : '기본 실행'), i === 0 && variants.length > 1 ? el('small', {}, ' 기본') : null)),
    el('button', { type: 'button', className: 'add', 'data-tip': '이 프로젝트의 다른 실행 추가 (로컬판·유튜브·결과물 폴더 등)', onclick: addVariant }, '＋ 실행 추가'));
    // 이름표 · 기본으로 · 삭제 (실행이 여러 개일 때)
    vbar.hidden = variants.length < 2;
    vbar.replaceChildren(
      el('div', { className: 'field vlabel' }, el('span', { className: 'lbl' }, '이름표 (카드의 버튼·메뉴에 보이는 이름)'), labelChips(v)),
      ...(cur > 0 ? [ // replaceChildren에 null을 넘기면 'null' 글자가 들어가므로 배열로
        el('button', { type: 'button', 'data-tip': '이 실행을 카드의 ▶ 버튼(기본 실행)으로', onclick: () => { variants.unshift(...variants.splice(cur, 1)); cur = 0; renderType(); } }, '기본 실행으로'),
        el('button', { type: 'button', className: 'danger', 'data-tip': '이 실행을 카드에서 뺍니다 (저장해야 반영)', onclick: () => { variants.splice(cur, 1); cur = 0; renderType(); } }, '이 실행 삭제'),
      ] : []));
    const type = v.type;
    seg.replaceChildren(...LAUNCH_TYPES.map((t) => el('button', {
      type: 'button', className: t === type ? 'on' : '', 'data-tip': TYPE_TIPS[t], onclick: () => { v.type = t; renderType(); },
    }, LAUNCH_LABELS[t])));
    sub.replaceChildren(...FIELDS[type].map(([key, label, ph]) => el('label', {}, label, key === 'window'
      ? el('select', { onchange: (e) => { fields.window = e.target.value; } },
        el('option', { value: 'new', selected: fields.window === 'new' }, '새 터미널 창'),
        el('option', { value: 'hidden', selected: fields.window !== 'new' }, '숨김 (창 없이)'))
      : key === 'filePath' ? pathRow(fields)
      : input(key, fields[key], { placeholder: ph, oninput: (e) => { fields[key] = e.target.value; } }))));
    captureBtn.disabled = !variants.some((x) => CAPTURABLE.has(x.type));
  }

  // 파일 열기 경로: 직접 입력 또는 Windows 선택 창으로 고르기 (프로젝트 폴더가 있으면 거기서 시작)
  function pathRow(fields) {
    const pathIn = input('filePath', fields.filePath, { placeholder: 'C:\\Users\\…\\완성본.mp4 또는 /home/…/output.pdf', oninput: (e) => { fields.filePath = e.target.value; } });
    const pick = async (kind) => {
      const cur = fields.filePath.trim();
      // 이미 적힌 경로의 폴더에서 시작 (C:\… 는 /mnt/c/… 로)
      const wsl = cur.replace(/^([A-Za-z]):\\/, (m, d) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, '/');
      const startDir = wsl.startsWith('/') ? wsl.replace(/\/[^/]*$/, '') || '/' : null;
      const p = await browse({ kind, project: sourceDir, start: startDir });
      if (!p) return;
      fields.filePath = p;
      pathIn.value = p;
    };
    return el('div', { className: 'path-row' }, pathIn,
      el('button', { type: 'button', 'data-tip': '영상·문서 등 결과물 파일 고르기 (프로젝트 폴더·다운로드·바탕화면에서)', onclick: () => pick('file') }, '📄 파일 선택'),
      el('button', { type: 'button', 'data-tip': '결과물 폴더 고르기', onclick: () => pick('folder') }, '📁 폴더 선택'));
  }

  // 이름표 칩: 기본 이름표 + 직접 추가한 것. ＋로 새 이름표, 직접 추가했고 안 쓰는 것은 ×
  function labelChips(v) {
    const taken = new Set(variants.filter((x) => x !== v).map((x) => x.label));
    const chips = labelOpts.map((o) => el('button', {
      type: 'button', className: o.label === v.label ? 'on' : '', disabled: taken.has(o.label),
      'data-tip': taken.has(o.label) ? '다른 실행이 쓰고 있어요' : `이 실행의 이름표를 '${o.label}'(으)로`,
      onclick: () => { v.label = o.label; renderType(); },
    }, o.label, o.custom && !o.used ? el('span', {
      className: 'chip-x', 'data-tip': '이 이름표 지우기',
      onclick: async (e) => {
        e.stopPropagation();
        const r = await api('DELETE', `/api/labels/${enc(o.label)}`);
        if (!r.ok) return say(r.error, true);
        labelOpts = labelOpts.filter((x) => x !== o);
        if (v.label === o.label) v.label = '';
        renderType();
      },
    }, '×') : null));
    if (addingLabel) {
      const inp = el('input', { className: 'chip-input', maxLength: 20, placeholder: '새 이름표', 'aria-label': '새 이름표' });
      inp.addEventListener('keydown', async (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); addingLabel = false; return renderType(); }
        if (e.key !== 'Enter' || e.isComposing) return;
        e.preventDefault(); // 창의 저장(submit)으로 넘어가지 않게
        const name = inp.value.trim();
        if (!name) { addingLabel = false; return renderType(); }
        if (!labelOpts.some((o) => o.label === name)) {
          const r = await api('POST', '/api/labels', { name });
          if (!r.ok) return say(r.error, true);
          labelOpts = [...labelOpts, { label: name, custom: true, used: false }];
        }
        v.label = name;
        addingLabel = false;
        renderType();
      });
      inp.addEventListener('blur', () => { if (!inp.value.trim() && addingLabel) { addingLabel = false; renderType(); } });
      setTimeout(() => inp.focus());
      chips.push(inp);
    } else {
      chips.push(el('button', { type: 'button', className: 'add', 'data-tip': '새 이름표 추가 (적고 Enter)', onclick: () => { addingLabel = true; renderType(); } }, '＋'));
    }
    return el('div', { className: 'label-chips' }, ...chips);
  }

  function addVariant() {
    variants.push({ label: '', type: 'url', fields: launchToForm({ type: 'url', url: '' }) });
    cur = variants.length - 1;
    renderType();
  }

  function syncThumbUi() {
    editor.node.hidden = !editing;
    preview.hidden = editing;
    editBtn.hidden = editing || !currentSrc;
    cancelEditBtn.hidden = !editing;
  }

  async function openEditor(src) {
    try {
      await editor.load(src);
    } catch (e) {
      return say(e.message, true);
    }
    editing = true;
    pendingCapture = false;
    syncThumbUi();
    say('끌어서 위치를 옮기고, 휠·슬라이더로 크기를 맞추세요. 저장하면 이 모양 그대로 들어가요');
  }

  function closeEditor() {
    editing = false;
    syncThumbUi();
    say('');
  }

  function renderPreview(src) {
    preview.replaceChildren();
    preview.style.background = '';
    if (src) return preview.append(el('img', { src, alt: '' }));
    const name = nameIn.value || '?';
    const h = thumbHue(name);
    preview.style.background = `linear-gradient(135deg, hsl(${h} 45% 30%), hsl(${(h + 40) % 360} 55% 50%))`;
    preview.append(el('span', { className: 'initial' }, initials(name)));
  }

  function readImage(file) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return say('PNG·JPG·WEBP 이미지만 쓸 수 있어요', true);
    const r = new FileReader();
    r.onload = () => openEditor(r.result);
    r.readAsDataURL(file);
  }

  async function capture() {
    if (!app) { pendingCapture = true; closeEditor(); return say('저장할 때 화면을 찍어요'); }
    say('찍는 중… (최대 15초)');
    const r = await api('POST', `/api/apps/${enc(app.id)}/thumbnail`, { capture: true });
    if (!r.ok) return say(r.error, true);
    currentSrc = `/${r.thumbnail}?v=${Date.now()}`;
    renderPreview(currentSrc);
    closeEditor();
    say('썸네일을 바꿨어요. ✂ 편집으로 다듬을 수 있어요');
  }

  function pickProject() {
    const d = projectDirs.find((x) => x.path === projSel.value);
    sourceDir = d?.path || null;
    if (d && !nameIn.value.trim()) { nameIn.value = d.name; nameIn.dispatchEvent(new Event('input')); }
    if (d?.card) say(`이 프로젝트에는 이미 '${d.card}' 카드가 있어요. 한 프로젝트는 카드 하나로 — 그 카드의 ✎ 수정에서 '＋ 실행 추가'를 쓰는 걸 권해요`, true);
    else say('');
  }

  async function pickCategory() {
    const to = catSel.value;
    const from = app?.category || '';
    if (!to || to === catIn.value) return;
    if (!app) { catIn.value = to; return; }
    if (!(await confirmBox(`분류를 '${from || '없음'}' → '${to}'(으)로 바꾸시겠습니까?\n이 카드가 '${to}' 탭으로 이동해요.`, '실행'))) {
      catSel.value = categories.includes(from) ? from : '';
      return;
    }
    // 창에서 고치던 다른 칸은 건드리지 않고, 저장된 앱의 분류만 바꾼다
    const { id, createdAt, updatedAt, lastLaunchedAt, ...saved } = app;
    const r = await api('PUT', `/api/apps/${enc(app.id)}`, { ...saved, category: to });
    if (!r.ok) { catSel.value = from; return say(r.error, true); }
    app.category = to;
    catIn.value = to;
    say(`'${to}' 분류로 옮겼어요`);
  }

  const body = () => ({
    name: nameIn.value, description: descIn.value, category: catIn.value, sourceDir,
    importedFrom: app?.importedFrom || null, thumbnail: app?.thumbnail || null, needsReview: false,
    launch: formToLaunch(variants[0].type, variants[0].fields),
    launchLabel: variants[0].label.trim(),
    moreLaunches: variants.slice(1).map((v) => ({ label: v.label.trim(), launch: formToLaunch(v.type, v.fields) })),
  });

  async function save(e) {
    e.preventDefault();
    const r = app ? await api('PUT', `/api/apps/${enc(app.id)}`, body()) : await api('POST', '/api/apps', body());
    if (!r.ok) return say(r.error, true);
    let note = null;
    if (editing || pendingCapture) {
      const t = await api('POST', `/api/apps/${enc(r.app.id)}/thumbnail`, editing ? { dataUrl: editor.toDataUrl() } : { capture: true });
      if (!t.ok) note = `저장했어요. 썸네일은 넣지 못했어요: ${t.error}`;
    }
    dlg.close();
    onSaved(note);
  }

  nameIn.addEventListener('input', () => { if (!currentSrc) renderPreview(null); });
  dlg.onpaste = (e) => {
    const item = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); readImage(item.getAsFile()); }
  };
  // 탐색기에서 이미지 파일을 창 위로 끌어 놓아도 된다
  dlg.ondragover = (e) => { if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) e.preventDefault(); };
  dlg.ondrop = (e) => {
    const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); readImage(f); }
  };
  renderType();
  renderPreview(currentSrc);
  syncThumbUi();

  dlg.replaceChildren(el('form', { onsubmit: save },
    el('h3', {}, app ? '✏ 앱 수정' : '＋ 앱 추가'),
    app ? el('label', {}, '프로젝트명 (원본 폴더 이름)', projIn) : el('label', {}, '프로젝트 폴더 (선택)', projSel),
    el('label', {}, '별명 * (카드에 보이는 이름)', nameIn),
    el('label', {}, '설명', descIn),
    el('div', { className: 'field' }, el('span', { className: 'lbl' }, '분류'), el('div', { className: 'cat-row' }, catIn, catSel)),
    el('div', { className: 'field' }, el('span', { className: 'lbl' }, '실행 방법 *'), vtabs, vbar, seg, sub),
    el('div', { className: 'field' }, el('span', { className: 'lbl' }, '썸네일'),
      el('div', { className: 'thumbrow' }, preview,
        el('button', { type: 'button', 'data-tip': '썸네일로 쓸 이미지 파일 고르기 (PNG·JPG·WEBP, 고른 뒤 편집기로 맞춤)', onclick: () => fileIn.click() }, '이미지 올리기'),
        el('span', { className: 'hint' }, '또는 Ctrl+V · 끌어 놓기'), captureBtn, editBtn, cancelEditBtn, fileIn),
      editor.node),
    status,
    el('div', { className: 'btns' },
      el('button', { type: 'button', onclick: () => dlg.close() }, '취소'),
      el('button', { type: 'submit', className: 'primary' }, '저장'))));
  dlg.showModal();
  nameIn.focus();
}

// [취소] [실행] 확인 창. 수정 창 위에 하나 더 띄운다.
function confirmBox(message, okLabel) {
  return new Promise((resolve) => {
    const box = el('dialog', { className: 'confirm' });
    const done = (v) => { box.close(); box.remove(); resolve(v); };
    box.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
    box.append(
      el('p', {}, message),
      el('div', { className: 'btns' },
        el('button', { type: 'button', onclick: () => done(false) }, '취소'),
        el('button', { type: 'button', className: 'primary', onclick: () => done(true) }, okLabel)));
    document.body.append(box);
    box.showModal();
    box.querySelector('.primary').focus();
  });
}
