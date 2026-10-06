// public/ui-logic.js
// 화면의 순수 로직 (칩·검색·정렬·입력칸 변환). 브라우저와 node 테스트가 같이 쓴다.
// '../server/…' 경로는 브라우저에서 /server/… 로 풀리며, 서버가 이 두 파일만 제공한다.
import { LAUNCH_LABELS } from '../server/app-schema.js';
import { splitWinArgs, joinWinArgs } from '../server/wincmd.js';

export const RECENT_MAX = 12;
const byName = (a, b) => a.name.localeCompare(b.name, 'ko');

export function chipList(apps, manual = [], tabOrder = []) {
  const chips = [{ key: 'all', label: '전체', count: apps.length }];
  const cats = new Map(manual.map((c) => [c, 0])); // 직접 추가한 분류는 카드가 없어도 탭으로
  for (const a of apps) if (a.category) cats.set(a.category, (cats.get(a.category) || 0) + 1);
  // 끌어서 정한 탭 순서대로, 순서에 없는 분류(새로 생긴 것)는 뒤에 가나다순
  const pos = (c) => { const i = tabOrder.indexOf(c); return i < 0 ? Infinity : i; };
  const sorted = [...cats].sort((x, y) => (pos(x[0]) - pos(y[0])) || x[0].localeCompare(y[0], 'ko'));
  for (const [c, n] of sorted) {
    chips.push({ key: `cat:${c}`, label: c, count: n, ...(n === 0 ? { manual: true } : {}) });
  }
  const recent = apps.filter((a) => a.lastLaunchedAt).length;
  if (recent) chips.push({ key: 'recent', label: '최근 실행', count: Math.min(recent, RECENT_MAX) });
  const review = apps.filter((a) => a.needsReview).length;
  if (review) chips.push({ key: 'review', label: '확인 필요', count: review });
  return chips;
}

// 끌어서 정한 순서(id 배열)대로. 순서에 없는 앱(새로 등록된 것)은 눈에 띄게 맨 앞에 이름순.
function sortByOrder(list, order) {
  const pos = new Map(order.map((id, i) => [id, i]));
  return [...list].sort((a, b) => {
    const pa = pos.has(a.id) ? pos.get(a.id) : -1;
    const pb = pos.has(b.id) ? pos.get(b.id) : -1;
    return pa === pb ? byName(a, b) : pa - pb;
  });
}

// 탭(일부 카드)에서 바꾼 순서를 전체 순서에 반영: 그 카드들이 차지하던 자리에 새 순서대로 채운다
export function mergeOrder(fullIds, visibleIds) {
  const visible = new Set(visibleIds);
  let k = 0;
  return fullIds.map((id) => (visible.has(id) ? visibleIds[k++] : id));
}

export const canReorder = (chip) => chip === 'all' || chip.startsWith('cat:');

export function filterApps(apps, { query = '', chip = 'all', order = [] } = {}) {
  const q = query.trim().toLowerCase();
  let list = apps.filter((a) => !q || [a.name, a.description, a.category].some((v) => (v || '').toLowerCase().includes(q)));
  if (chip.startsWith('cat:')) list = list.filter((a) => a.category === chip.slice(4));
  if (chip === 'review') list = list.filter((a) => a.needsReview);
  if (chip === 'recent') {
    return list.filter((a) => a.lastLaunchedAt)
      .sort((a, b) => b.lastLaunchedAt.localeCompare(a.lastLaunchedAt)).slice(0, RECENT_MAX);
  }
  return sortByOrder(list, order);
}

// 실행 이름표: 기본 이름표 + 직접 추가한 것 + 카드들이 이미 쓰는 것
export const DEFAULT_LABELS = ['완성 영상', '유튜브', '배포판', '로컬판', '공개 모드', '결과물 폴더', '제출 서류', '데모', '크롬', '엣지'];
export function labelOptions(apps, saved = []) {
  const used = new Set(apps.flatMap((a) => [a.launchLabel, ...(a.moreLaunches || []).map((m) => m.label)]).filter(Boolean));
  const out = DEFAULT_LABELS.map((label) => ({ label, custom: false, used: used.has(label) }));
  const seen = new Set(DEFAULT_LABELS);
  for (const label of saved) if (!seen.has(label)) { seen.add(label); out.push({ label, custom: true, used: used.has(label) }); }
  for (const label of used) if (!seen.has(label)) { seen.add(label); out.push({ label, custom: false, used: true }); }
  return out;
}

// 분류 색 띠용 팔레트 — 어두운 배경에서 서로 확실히 구분되는 10색
const CAT_COLORS = ['#4fc3f7', '#ffd54f', '#ba68c8', '#81c784', '#ff8a65', '#f06292', '#4db6ac', '#9575cd', '#aed581', '#e57373'];
export function categoryColors(categories) {
  const names = [...new Set(categories.filter(Boolean))].sort((x, y) => x.localeCompare(y, 'ko'));
  return Object.fromEntries(names.map((c, i) => [c, CAT_COLORS[i % CAT_COLORS.length]]));
}

export function thumbHue(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

export function initials(name) {
  const t = String(name).trim();
  return t ? [...t][0].toUpperCase() : '?';
}

// 카드 배지. 파일 열기는 확장자로 결과물 종류를 보여 준다
const FILE_KINDS = [
  ['영상', /\.(mp4|mov|webm|mkv|avi|m4v)$/i],
  ['문서', /\.(pdf|hwp|hwpx|docx?|pptx?|xlsx?|md|txt)$/i],
  ['이미지', /\.(png|jpe?g|gif|webp|svg)$/i],
  ['음악', /\.(mp3|wav|m4a|flac)$/i],
];
export function launchLabel(launch) {
  if (launch?.type !== 'file') return LAUNCH_LABELS[launch?.type] || '?';
  const p = String(launch.path || '');
  const kind = FILE_KINDS.find(([, re]) => re.test(p));
  if (kind) return kind[0];
  return /\.[A-Za-z0-9]{1,5}$/.test(p.split(/[\\/]/).pop()) ? '파일' : '폴더';
}
export const subtitle = (app) => [app.category, app.description].filter(Boolean).join(' · ');
export const thumbSrc = (app) => `/${app.thumbnail}?v=${encodeURIComponent(app.updatedAt || '')}`;

export function launchToForm(l) {
  return {
    url: l.type === 'url' || l.type === 'chrome-app' ? l.url || '' : '',
    appId: l.type === 'chrome-app' ? l.appId : '',
    profile: l.type === 'chrome-app' ? l.profile : 'Default',
    file: l.type === 'windows' ? l.file : '',
    args: l.type === 'windows' ? joinWinArgs(l.args || []) : '',
    winCwd: l.type === 'windows' ? l.cwd || '' : '',
    command: l.type === 'wsl' ? l.command : '',
    wslCwd: l.type === 'wsl' ? l.cwd || '' : '',
    window: l.type === 'wsl' ? l.window : 'hidden',
    dir: l.type === 'local-web' ? l.dir : '',
    entry: l.type === 'local-web' ? l.entry : 'index.html',
    filePath: l.type === 'file' ? l.path : '',
  };
}

export function formToLaunch(type, f) {
  const t = (v) => (v || '').trim();
  switch (type) {
    case 'url': return { type, url: t(f.url) };
    case 'chrome-app': return { type, appId: t(f.appId), profile: t(f.profile) || 'Default', ...(t(f.url) ? { url: t(f.url) } : {}) };
    case 'windows': return { type, file: t(f.file), args: splitWinArgs(f.args || ''), cwd: t(f.winCwd) || null };
    case 'wsl': return { type, command: t(f.command), cwd: t(f.wslCwd) || null, window: f.window === 'new' ? 'new' : 'hidden' };
    case 'local-web': return { type, dir: t(f.dir), entry: t(f.entry) || 'index.html' };
    case 'file': return { type, path: t(f.filePath).replace(/^"(.*)"$/, '$1') }; // 탐색기 '경로로 복사'의 따옴표
    default: return { type };
  }
}
