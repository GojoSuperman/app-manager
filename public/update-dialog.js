// public/update-dialog.js
// ⟳ 업데이트: GitHub의 새 판 확인 → 받기(pull --ff-only + npm install) → 다시 켜기 (화면은 새 서버가 뜨면 새로고침)
import { api } from './api.js';
import { el } from './dom.js';

const WHY = {
  'local-changes': '이 PC에서 고친 파일이 있어서 받지 않았어요 (아무것도 바뀌지 않았어요). 고친 내용을 커밋하거나 되돌린 뒤 다시 시도하세요.',
  diverged: '이 PC의 기록과 GitHub의 기록이 갈라져서 받지 않았어요 (아무것도 바뀌지 않았어요). 터미널에서 `git status`로 확인해 주세요.',
  network: 'GitHub에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.',
  'no-upstream': '이 폴더가 GitHub 저장소와 연결되어 있지 않아요 (추적 브랜치 없음).',
  'no-git': 'git clone으로 받은 경우에만 업데이트할 수 있어요.',
};
const reason = (r) => WHY[r.code] || r.error || '알 수 없는 오류';

// 화면을 열 때 뒤에서 확인 — 새 판이 있으면 버튼을 '업데이트 (N)'로
export async function refreshUpdateButton(btn) {
  const r = await api('GET', '/api/update/check');
  const n = r.ok ? r.behind : 0;
  btn.textContent = n ? `⟳ 업데이트 (${n})` : '⟳ 업데이트';
  btn.classList.toggle('attention', !!n);
}

export async function openUpdateDialog() {
  const box = el('dialog', { className: 'update-dlg' });
  const body = el('div', {}, el('p', { className: 'hint' }, 'GitHub에서 새 판을 확인하는 중…'));
  const btns = el('div', { className: 'btns' });
  const close = () => { box.close(); box.remove(); };
  box.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  box.append(el('h3', {}, '⟳ 업데이트'), body, btns);
  document.body.append(box);
  box.showModal();
  const closeBtn = el('button', { type: 'button', onclick: close }, '닫기');

  const c = await api('GET', '/api/update/check');
  if (!c.ok) { body.replaceChildren(el('p', { className: 'status bad' }, reason(c))); btns.replaceChildren(closeBtn); return; }
  if (!c.behind) { body.replaceChildren(el('p', {}, '✅ 최신 판이에요.')); btns.replaceChildren(closeBtn); return; }
  const go = el('button', { type: 'button', className: 'primary' }, '업데이트 받기');
  body.replaceChildren(
    el('p', {}, `새 판이 있어요 — 변경 ${c.behind}개`),
    el('ul', { className: 'update-commits' }, c.commits.map((x) => el('li', {}, x))),
    el('p', { className: 'hint' }, '받은 뒤 런처를 다시 켜야 적용돼요. 실패하면 아무것도 바꾸지 않아요.'));
  btns.replaceChildren(closeBtn, go);

  go.addEventListener('click', async () => {
    go.disabled = true;
    closeBtn.disabled = true;
    body.replaceChildren(el('p', { className: 'hint' }, '받는 중… (git pull → npm install, 1분쯤 걸릴 수 있어요)'));
    const r = await api('POST', '/api/update');
    closeBtn.disabled = false;
    if (!r.ok) {
      const step = { fetch: '확인', check: '확인', pull: '받기', npm: '의존성 설치(npm install)' }[r.step] || '';
      body.replaceChildren(el('p', { className: 'status bad' }, `${step ? `${step} 단계에서 멈췄어요. ` : ''}${reason(r)}`));
      btns.replaceChildren(closeBtn);
      return;
    }
    if (!r.changed) { body.replaceChildren(el('p', {}, '✅ 이미 최신 판이에요.')); btns.replaceChildren(closeBtn); return; }
    const again = el('button', { type: 'button', className: 'primary' }, '지금 다시 켜기');
    body.replaceChildren(el('p', {}, `✅ 새 판을 받았어요 (변경 ${r.behind}개). 다시 켜면 적용돼요.`),
      el('p', { className: 'hint' }, '등록 스킬이 바뀌었으면 다시 켠 뒤 위쪽 버튼이 "🧩 스킬 업데이트"로 바뀌어요.'));
    btns.replaceChildren(closeBtn, again);
    again.addEventListener('click', () => restartAndReload(body, btns));
  });
}

async function restartAndReload(body, btns) {
  btns.replaceChildren();
  body.replaceChildren(el('p', { className: 'hint' }, '런처를 다시 켜는 중… 잠시 뒤 이 화면이 새로고침돼요.'));
  await api('POST', '/api/restart');
  await new Promise((r) => setTimeout(r, 1500));
  for (let i = 0; i < 40; i++) {
    try {
      const h = await fetch('/api/health', { cache: 'no-store' });
      if (h.ok) { location.reload(); return; }
    } catch { /* 아직 안 뜸 */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  body.replaceChildren(el('p', { className: 'status bad' }, '다시 켜지지 않았어요. 바탕화면 아이콘으로 런처를 다시 열어 주세요.'));
}
