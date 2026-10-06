// public/tooltip.js
// 마우스를 올리면 바로 뜨는 안내 말풍선. data-tip(또는 title — 브라우저 기본 툴팁은 늦게 떠서 data-tip으로 옮김)이 있는 요소 모두.
// 수정 창(<dialog>)은 맨 위 층에 그려지므로 말풍선도 그 안에 넣는다.
const DELAY = 250;
let tipEl = null;
let timer = null;
let current = null;

function target(e) {
  const t = e.target.closest?.('[data-tip], [title]');
  if (!t) return null;
  const title = t.getAttribute('title');
  if (title) { t.dataset.tip = title; t.removeAttribute('title'); }
  return t.dataset.tip ? t : null;
}

function hide() {
  clearTimeout(timer);
  current = null;
  tipEl?.remove();
}

function show(t) {
  if (!t.isConnected) return;
  tipEl ??= Object.assign(document.createElement('div'), { className: 'tip-bubble', role: 'tooltip' });
  tipEl.textContent = t.dataset.tip;
  (t.closest('dialog[open]') || document.body).append(tipEl);
  const r = t.getBoundingClientRect();
  const w = tipEl.offsetWidth;
  const h = tipEl.offsetHeight;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
  const top = r.top - h - 8 >= 8 ? r.top - h - 8 : r.bottom + 8; // 위에 자리가 없으면 아래로
  Object.assign(tipEl.style, { left: `${left}px`, top: `${top}px` });
}

document.addEventListener('pointerover', (e) => {
  const t = target(e);
  if (t === current) return;
  hide();
  if (!t) return;
  current = t;
  timer = setTimeout(() => show(t), DELAY);
});
document.addEventListener('pointerdown', hide, true);
document.addEventListener('dragstart', hide, true);
document.addEventListener('scroll', hide, true);
