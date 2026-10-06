// public/image-edit.js
// 썸네일 편집기: 카드와 같은 16:9 틀에 이미지를 맞춘다 (휴대폰 연락처 사진처럼 끌어서 위치, 확대, 회전, 반전).
// 배율·위치는 '출력 너비' 기준으로 정규화해 둬서, 작은 미리보기와 저장용 큰 그림이 똑같이 그려진다.
import { el } from './dom.js';

export const ASPECT = 16 / 9;
export const OUT_W = 1280;
export const OUT_H = 720;
const MAX_ZOOM = 4; // 꽉 채우기의 몇 배까지 확대

export function fitScales(iw, ih, rot) {
  const [rw, rh] = rot % 180 ? [ih, iw] : [iw, ih];
  const fx = 1 / rw;
  const fy = 1 / ASPECT / rh;
  return { cover: Math.max(fx, fy), contain: Math.min(fx, fy) };
}

export function initialView(iw, ih) {
  return { iw, ih, rot: 0, flipX: false, flipY: false, ox: 0, oy: 0, scale: fitScales(iw, ih, 0).cover };
}

// 90도씩 돌리고 다시 꽉 채우기 (돌리면 가로세로가 바뀌어 빈 곳이 생기므로)
export function rotate(v, deg) {
  const rot = (((v.rot + deg) % 360) + 360) % 360;
  return { ...v, rot, ox: 0, oy: 0, scale: fitScales(v.iw, v.ih, rot).cover };
}

// 슬라이더 0~100: 0=전체 보기, 50=꽉 채우기, 100=채우기의 4배 (로그 눈금이라 고르게 느껴짐)
export function sliderToScale(v, pos) {
  const { cover, contain } = fitScales(v.iw, v.ih, v.rot);
  const p = Math.min(100, Math.max(0, pos));
  return p <= 50 ? contain * (cover / contain) ** (p / 50) : cover * MAX_ZOOM ** ((p - 50) / 50);
}

export function scaleToSlider(v, scale) {
  const { cover, contain } = fitScales(v.iw, v.ih, v.rot);
  if (scale >= cover) return 50 + 50 * Math.log(scale / cover) / Math.log(MAX_ZOOM);
  if (cover === contain) return 50;
  return 50 * Math.log(scale / contain) / Math.log(cover / contain);
}

export const zoomTo = (v, pos) => ({ ...v, scale: sliderToScale(v, pos) });

// 그리는 순서: 위치 → 반전(화면 기준이라 회전보다 바깥) → 회전 → 배율 → 이미지 가운데 맞춤
export function drawSteps(v, w, h) {
  const k = v.scale * w;
  return [
    ['translate', w / 2 + v.ox * w, h / 2 + v.oy * w],
    ['scale', v.flipX ? -1 : 1, v.flipY ? -1 : 1],
    ['rotate', (v.rot * Math.PI) / 180],
    ['scale', k, k],
    ['drawImage', -v.iw / 2, -v.ih / 2],
  ];
}

export function render(ctx, img, v, w, h) {
  ctx.save();
  ctx.fillStyle = '#1f222b'; // 전체 보기 때 남는 여백 = 카드 색
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  for (const [op, a, b] of drawSteps(v, w, h)) {
    if (op === 'drawImage') ctx.drawImage(img, a, b);
    else if (op === 'rotate') ctx.rotate(a);
    else ctx[op](a, b);
  }
  ctx.restore();
}

// 화면 부품. load(src)로 이미지를 넣고, toDataUrl()로 저장용 그림을 받는다.
export function createImageEditor({ onChange = () => {} } = {}) {
  const canvas = el('canvas', { className: 'editor-canvas', width: 480, height: 270, 'data-tip': '끌어서 위치 조정 · 휠로 확대/축소' });
  const ctx = canvas.getContext('2d');
  const slider = el('input', { type: 'range', min: 0, max: 100, step: 0.5, value: 50, oninput: () => set(zoomTo(view, Number(slider.value))) });
  let img = null;
  let view = null;

  const draw = () => { if (img) render(ctx, img, view, canvas.width, canvas.height); };
  function set(v, { syncSlider = true } = {}) {
    view = v;
    if (syncSlider) slider.value = String(scaleToSlider(view, view.scale));
    draw();
    onChange();
  }

  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!img) return;
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const w = canvas.getBoundingClientRect().width;
    set({ ...view, ox: drag.ox + (e.clientX - drag.x) / w, oy: drag.oy + (e.clientY - drag.y) / w });
  });
  const endDrag = () => { drag = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    if (!img) return;
    e.preventDefault();
    set(zoomTo(view, Number(slider.value) - Math.sign(e.deltaY) * 4));
  }, { passive: false });

  const btn = (label, title, fn) => el('button', { type: 'button', title, onclick: () => img && fn() }, label);
  const node = el('div', { className: 'editor' },
    canvas,
    el('div', { className: 'editor-tools' },
      el('label', { className: 'zoom' }, '🔍', slider),
      btn('⟲', '왼쪽으로 90° 회전', () => set(rotate(view, -90))),
      btn('⟳', '오른쪽으로 90° 회전', () => set(rotate(view, 90))),
      btn('⇋', '좌우 반전', () => set({ ...view, flipX: !view.flipX })),
      btn('⇅', '상하 반전', () => set({ ...view, flipY: !view.flipY })),
      btn('채우기', '틀을 꽉 채우기 (가장자리가 조금 잘릴 수 있어요)', () => set({ ...zoomTo(view, 50), ox: 0, oy: 0 })),
      btn('전체 보기', '이미지 전체가 보이게 (남는 곳은 여백)', () => set({ ...zoomTo(view, 0), ox: 0, oy: 0 })),
      btn('↺ 처음대로', '회전·반전·위치 초기화', () => set(initialView(img.naturalWidth, img.naturalHeight)))));

  return {
    node,
    load: (src) => new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => { img = i; set(initialView(i.naturalWidth, i.naturalHeight)); resolve(); };
      i.onerror = () => reject(new Error('이미지를 읽지 못했어요'));
      i.src = src;
    }),
    hasImage: () => !!img,
    toDataUrl() {
      const out = el('canvas', { width: OUT_W, height: OUT_H });
      render(out.getContext('2d'), img, view, OUT_W, OUT_H);
      return out.toDataURL('image/webp', 0.9);
    },
  };
}
