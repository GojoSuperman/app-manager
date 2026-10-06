// public/github-dialog.js
// GitHub에서 가져오기: 내 저장소 체크 목록 → 고른 것만 카드로 (실행 방법을 모르면 '확인 필요' 카드)
import { api } from './api.js';
import { el } from './dom.js';

export async function openGithubImport({ onDone }) {
  const box = el('dialog', { className: 'gh-import' });
  const list = el('div', { className: 'gh-list' }, el('p', { className: 'hint' }, 'GitHub 저장소 목록을 읽는 중…'));
  const status = el('p', { className: 'status' });
  const count = el('span', { className: 'hint' });
  const okBtn = el('button', { type: 'button', className: 'primary', disabled: true }, '카드 만들기');
  const close = () => { box.close(); box.remove(); };
  box.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  box.append(
    el('h3', {}, '⬇ GitHub에서 가져오기'),
    el('p', { className: 'hint' }, '카드로 만들 저장소를 고르세요. 웹사이트 주소가 있거나, 내 PC의 폴더에서 실행 방법을 찾으면(🔎 추측) 바로 실행되는 카드가 돼요. 못 찾으면 "확인 필요" 카드가 되고, ✎ 수정이나 등록 스킬로 채우면 돼요.'),
    list, status,
    el('div', { className: 'btns' }, count, el('button', { type: 'button', onclick: close }, '닫기'), okBtn));
  document.body.append(box);
  box.showModal();

  const r = await api('GET', '/api/github/repos');
  if (!r.ok) { list.replaceChildren(el('p', { className: 'status bad' }, r.error)); return; }
  const checks = new Map();
  const update = () => {
    const n = [...checks.values()].filter((c) => c.checked).length;
    count.textContent = `${n}개 고름`;
    okBtn.disabled = n === 0;
  };
  // 아직 카드 없는 것 먼저 → 웹사이트 → 추측 가능 → 확인 필요 순, 그다음 이미 카드 있는 것
  const rank = (c) => (c.card ? 9 : c.homepageUrl ? 0 : c.guess ? 1 : 2);
  const rows = [...r.candidates].sort((a, b) => (rank(a) - rank(b)) || a.name.localeCompare(b.name, 'ko'));
  list.replaceChildren(...rows.map((c) => {
    const cb = el('input', { type: 'checkbox', checked: c.checked, disabled: !!c.card, onchange: update });
    checks.set(c.name, cb);
    const tags = [
      c.homepageUrl ? el('span', { className: 'tag ok', 'data-tip': c.homepageUrl }, '🌐 웹사이트') : null,
      !c.homepageUrl && c.guess?.web ? el('span', { className: 'tag ok', 'data-tip': `${c.guess.web.how}: ${c.guess.web.launch.url} (추측 — 맞는지 확인해 주세요)` }, '🔎 웹 주소') : null,
      c.guess?.local ? el('span', { className: 'tag ok', 'data-tip': `내 PC 폴더에서 찾은 실행 방법 (추측): ${c.guess.local.how}${c.homepageUrl || c.guess.web ? ' — 배포판·로컬판 두 실행으로 담아요' : ''}` }, `🔎 로컬: ${c.guess.local.how}`) : null,
      !c.homepageUrl && !c.guess ? el('span', { className: 'tag', 'data-tip': '실행 방법을 몰라 "확인 필요" 카드가 돼요' }, '확인 필요') : null,
      c.localDir ? el('span', { className: 'tag', 'data-tip': c.localDir }, '📁 내 PC에 있음') : null,
      c.private ? el('span', { className: 'tag' }, '비공개') : null,
      c.archived ? el('span', { className: 'tag' }, '보관됨') : null,
      c.card ? el('span', { className: 'tag done' }, `카드 있음: ${c.card}`) : null,
    ];
    return el('label', { className: c.card ? 'gh-row done' : 'gh-row' }, cb,
      el('span', { className: 'gh-name' }, el('b', {}, c.name), c.description ? el('small', {}, c.description) : null),
      el('span', { className: 'gh-tags' }, ...tags.filter(Boolean)));
  }));
  update();

  okBtn.addEventListener('click', async () => {
    const names = [...checks].filter(([, cb]) => cb.checked && !cb.disabled).map(([n]) => n);
    okBtn.disabled = true;
    status.textContent = '카드를 만드는 중…';
    const res = await api('POST', '/api/github/import', { names });
    if (!res.ok) { status.textContent = res.error; status.className = 'status bad'; okBtn.disabled = false; return; }
    close();
    const review = res.added.filter((a) => a.needsReview).length;
    onDone(`카드 ${res.added.length}장을 만들었어요${review ? ` (확인 필요 ${review}장 — '확인 필요' 탭에서 실행 방법을 채워 주세요)` : ''}${res.skipped.length ? ` · 건너뜀 ${res.skipped.length}` : ''}`);
  });
}
