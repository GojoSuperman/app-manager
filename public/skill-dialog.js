// public/skill-dialog.js
// 🧩 등록 스킬: Claude Code 설정 폴더(~/.claude, ~/.claude-*)에 등록 스킬을 설치·갱신. 버튼 글자로 상태를 알려 준다.
import { api } from './api.js';
import { el } from './dom.js';

const STATE = { current: ['최신', 'ok'], outdated: ['옛 판 — 갱신 필요', 'warn'], missing: ['미설치', ''] };

// 버튼 글자: 옛 판이 있으면 "업데이트", 하나도 없으면 "설치"
export async function refreshSkillButton(btn) {
  const r = await api('GET', '/api/skill');
  if (!r.ok) return;
  btn.textContent = r.summary === 'outdated' ? '🧩 스킬 업데이트' : r.summary === 'missing' ? '🧩 스킬 설치' : '🧩 등록 스킬';
  btn.classList.toggle('attention', r.summary === 'outdated');
}

export async function openSkillDialog({ onDone }) {
  const box = el('dialog', { className: 'skill-dlg' });
  const list = el('div', { className: 'skill-list' }, el('p', { className: 'hint' }, '확인하는 중…'));
  const status = el('p', { className: 'status' });
  const okBtn = el('button', { type: 'button', className: 'primary' }, '설치·갱신');
  const close = () => { box.close(); box.remove(); };
  box.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  box.append(
    el('h3', {}, '🧩 Claude Code 등록 스킬'),
    el('p', { className: 'hint' }, '프로젝트 폴더의 Claude Code에게 "앱 관리 프로젝트에 등록해줘"라고 말하면 카드를 만들어 주는 스킬이에요. 설치할 Claude 설정 폴더를 고르세요.'),
    list, status,
    el('div', { className: 'btns' }, el('button', { type: 'button', onclick: close }, '닫기'), okBtn));
  document.body.append(box);
  box.showModal();

  const r = await api('GET', '/api/skill');
  if (!r.ok) { list.replaceChildren(el('p', { className: 'status bad' }, r.error)); return; }
  if (!r.targets.length) { list.replaceChildren(el('p', { className: 'hint' }, 'Claude Code 설정 폴더(~/.claude)를 찾지 못했어요. Claude Code를 먼저 설치해 주세요.')); okBtn.disabled = true; return; }
  const checks = r.targets.map((t) => {
    const cb = el('input', { type: 'checkbox', checked: t.checked });
    const [label, cls] = STATE[t.state];
    return [t.dir, cb, el('label', { className: 'skill-row' }, cb, el('code', {}, t.dir.replace(/^\/home\/[^/]+/, '~')), el('span', { className: `tag ${cls}` }, label))];
  });
  list.replaceChildren(...checks.map((c) => c[2]),
    el('p', { className: 'hint' }, '백업 폴더나 플러그인 데이터 폴더처럼 보이는 것은 미리 체크하지 않았어요.'));

  okBtn.addEventListener('click', async () => {
    const dirs = checks.filter(([, cb]) => cb.checked).map(([d]) => d);
    const res = await api('POST', '/api/skill/install', { dirs });
    if (!res.ok) { status.textContent = res.error; status.className = 'status bad'; return; }
    close();
    onDone(`등록 스킬을 ${res.installed.length}곳에 설치했어요. Claude Code에서 새 대화를 열어야 보여요`);
  });
}
