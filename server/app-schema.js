// server/app-schema.js
// 앱 목록 한 항목의 형식 검사와 id 만들기. 화면(브라우저)도 import하므로 node 전용 모듈을 쓰지 않는다.

export const LAUNCH_TYPES = ['url', 'chrome-app', 'windows', 'wsl', 'local-web', 'file'];
export const LAUNCH_LABELS = {
  url: '웹 주소', 'chrome-app': '크롬 앱', windows: 'Windows 실행', wsl: 'WSL 명령', 'local-web': '로컬 웹', file: '파일 열기',
};

// 개정 로마자 표기 — 음운 변화 없이 글자 단위로만 (id용이라 읽을 수 있으면 충분)
const INITIALS = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const MEDIALS = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const FINALS = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];

export function romanize(text) {
  let out = '';
  for (const ch of String(text)) {
    const c = ch.codePointAt(0) - 0xac00;
    if (c < 0 || c > 11171) { out += ch; continue; }
    out += INITIALS[Math.floor(c / 588)] + MEDIALS[Math.floor((c % 588) / 28)] + FINALS[c % 28];
  }
  return out;
}

export function makeId(name, rand) {
  const slug = romanize(name).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40).replace(/-+$/, '');
  return `${slug || 'app'}-${rand()}`;
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const isAbsPosix = (v) => typeof v === 'string' && v.startsWith('/');

// 실행 대상 식별 문자열 — 같은 폴더의 여러 앱을 구분할 때 쓴다 (창 모드·프로필 같은 부가 설정은 제외)
export function launchKey(l = {}) {
  switch (l.type) {
    case 'url': return `url ${l.url}`;
    case 'chrome-app': return `chrome-app ${l.appId}`;
    case 'windows': return `windows ${l.file} ${JSON.stringify(l.args || [])}`;
    case 'wsl': return `wsl ${l.command} ${l.cwd || ''}`;
    case 'local-web': return `local-web ${l.dir} ${l.entry || 'index.html'}`;
    case 'file': return `file ${l.path}`;
    default: return String(l.type);
  }
}

export function validateLaunch(launch, { allowEmpty = false } = {}) {
  const errors = [];
  const l = launch && typeof launch === 'object' ? launch : {};
  // 필수 칸이 비었을 때: needsReview(allowEmpty)면 통과, 아니면 오류
  const need = (v, msg) => { if (!v && !allowEmpty) errors.push(msg); return v; };
  let value;
  switch (l.type) {
    case 'url': {
      const url = need(str(l.url), '웹 주소를 입력해 주세요');
      if (url && !/^https?:\/\/\S+$/i.test(url)) errors.push('웹 주소는 http:// 또는 https://로 시작해야 해요');
      value = { type: 'url', url };
      break;
    }
    case 'chrome-app': {
      const appId = need(str(l.appId), '크롬 앱 ID를 입력해 주세요');
      if (appId && !/^[a-p]{32}$/.test(appId)) errors.push('크롬 앱 ID는 a~p 소문자 32자예요');
      const profile = str(l.profile) || 'Default';
      if (/["']/.test(profile)) errors.push('프로필 이름에 따옴표를 쓸 수 없어요');
      // 캡처용 주소(선택): 크롬 앱은 ID만으로 주소를 알 수 없어 썸네일 자동 캡처에만 쓴다
      const url = str(l.url);
      if (url && !/^https?:\/\/\S+$/i.test(url)) errors.push('캡처용 주소는 http:// 또는 https://로 시작해야 해요');
      value = { type: 'chrome-app', appId, profile, ...(url ? { url } : {}) };
      break;
    }
    case 'windows': {
      const file = need(str(l.file), '실행 파일 경로를 입력해 주세요');
      const args = l.args === undefined ? [] : l.args;
      if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) errors.push('인자는 문자열 목록이어야 해요');
      value = { type: 'windows', file, args: Array.isArray(args) ? args : [], cwd: str(l.cwd) || null };
      break;
    }
    case 'wsl': {
      const command = need(str(l.command), 'WSL 명령을 입력해 주세요');
      const cwd = str(l.cwd) || null;
      if (cwd && !isAbsPosix(cwd)) errors.push('작업 폴더는 /로 시작하는 WSL 경로여야 해요');
      const window = l.window === undefined || l.window === '' ? 'hidden' : l.window;
      if (!['new', 'hidden'].includes(window)) errors.push('창 설정은 new 또는 hidden이에요');
      value = { type: 'wsl', command, cwd, window };
      break;
    }
    case 'local-web': {
      const dir = need(str(l.dir), '폴더 경로를 입력해 주세요');
      if (dir && !isAbsPosix(dir)) errors.push('폴더는 /로 시작하는 WSL 경로여야 해요');
      const entry = str(l.entry) || 'index.html';
      if (entry.startsWith('/') || entry.split('/').includes('..')) errors.push('시작 페이지는 폴더 안의 상대 경로여야 해요');
      value = { type: 'local-web', dir, entry };
      break;
    }
    case 'file': {
      // 결과물(영상·문서·폴더 등)을 Windows 기본 프로그램으로 열기
      const p = need(str(l.path).replace(/^"(.*)"$/, '$1').trim(), '열 파일이나 폴더 경로를 입력해 주세요'); // 탐색기 '경로로 복사'의 따옴표 떼기
      if (p && !/^([A-Za-z]:\\|\\\\|\/)/.test(p)) errors.push('경로는 C:\\… 같은 Windows 경로나 /로 시작하는 WSL 경로여야 해요');
      value = { type: 'file', path: p };
      break;
    }
    default:
      return { ok: false, errors: ['실행 방법을 골라 주세요'] };
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

export function validateApp(input) {
  const a = input && typeof input === 'object' ? input : {};
  const errors = [];
  const name = str(a.name);
  if (!name) errors.push('이름을 입력해 주세요');
  else if (name.length > 100) errors.push('이름은 100자 이하로 적어 주세요');
  const description = str(a.description);
  if (description.length > 300) errors.push('설명은 300자 이하로 적어 주세요');
  const category = str(a.category);
  if (category.length > 30) errors.push('분류는 30자 이하로 적어 주세요');
  const thumbnail = a.thumbnail ? String(a.thumbnail) : null;
  if (thumbnail && !/^thumbs\/[A-Za-z0-9._-]+$/.test(thumbnail)) errors.push('썸네일 경로 형식이 올바르지 않아요');
  const sourceDir = str(a.sourceDir) || null;
  if (sourceDir && !isAbsPosix(sourceDir)) errors.push('원본 폴더는 /로 시작하는 WSL 경로여야 해요');
  const importedFrom = str(a.importedFrom) || null;
  const needsReview = a.needsReview === true;
  const l = validateLaunch(a.launch, { allowEmpty: needsReview });
  if (!l.ok) errors.push(...l.errors);
  // 한 프로젝트의 여러 실행(배포판·로컬판·공개 모드 등)을 한 카드에: 기본 실행 + 추가 실행들
  const launchLabel = str(a.launchLabel);
  const more = a.moreLaunches === undefined ? [] : a.moreLaunches;
  const moreLaunches = [];
  if (!Array.isArray(more)) errors.push('추가 실행은 목록이어야 해요');
  else {
    if (more.length && !launchLabel) errors.push('실행이 여러 개면 기본 실행에도 이름표를 붙여 주세요');
    const keys = new Set(l.ok ? [launchKey(l.value)] : []);
    more.forEach((m, i) => {
      const n = `실행 ${i + 2}`;
      const label = str(m?.label);
      if (!label) errors.push(`${n}의 이름표를 적어 주세요`);
      else if (label.length > 20) errors.push(`${n}의 이름표는 20자 이하로 적어 주세요`);
      const v = validateLaunch(m?.launch);
      if (!v.ok) return errors.push(...v.errors.map((e) => `${n}: ${e}`));
      if (keys.has(launchKey(v.value))) errors.push(`${n}가 다른 실행과 같아요`);
      keys.add(launchKey(v.value));
      moreLaunches.push({ label, launch: v.value });
    });
  }
  if (launchLabel.length > 20) errors.push('기본 실행의 이름표는 20자 이하로 적어 주세요');
  // 로컬 웹 주소는 카드 id로 정해지므로(127.0.0.1:4791/<id>/) 카드당 하나
  if (l.ok && [l.value, ...moreLaunches.map((m) => m.launch)].filter((x) => x.type === 'local-web').length > 1) {
    errors.push('로컬 웹 실행은 카드에 하나만 둘 수 있어요');
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { name, description, category, thumbnail, launch: l.value, launchLabel, moreLaunches, sourceDir, importedFrom, needsReview } };
}

// 카드의 실행 전부 — [{ label, launch }], 첫 번째가 기본 실행
export const allLaunches = (app) => [{ label: app.launchLabel || '', launch: app.launch }, ...(app.moreLaunches || [])];
