import { test } from 'node:test';
import assert from 'node:assert/strict';
import { romanize, makeId, validateApp, validateLaunch, allLaunches, LAUNCH_TYPES, LAUNCH_LABELS } from '../server/app-schema.js';

test('실행 방법 5종과 이름표', () => {
  assert.deepEqual(LAUNCH_TYPES, ['url', 'chrome-app', 'windows', 'wsl', 'local-web', 'file']);
  assert.equal(LAUNCH_LABELS.windows, 'Windows 실행');
});

test('romanize: 글자 단위 로마자', () => {
  assert.equal(romanize('성을 지켜라'), 'seongeul jikyeora');
  assert.equal(romanize('발표 연습 (로컬판)'), 'balpyo yeonseup (rokeolpan)');
  assert.equal(romanize('AI 마피아'), 'AI mapia');
});

test('makeId: 띄어쓰기 단위로 하이픈, 영문 없으면 app', () => {
  assert.equal(makeId('성을 지켜라', () => '3f2a'), 'seongeul-jikyeora-3f2a');
  assert.equal(makeId('follow.it', () => '0000'), 'follow-it-0000');
  assert.equal(makeId('★★★', () => 'abcd'), 'app-abcd');
  assert.ok(makeId('가'.repeat(60), () => 'abcd').length <= 45);
});

const base = { name: '앱', launch: { type: 'url', url: 'https://example.com' } };

test('validateApp: 기본값 채움', () => {
  const r = validateApp(base);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    name: '앱', description: '', category: '', thumbnail: null,
    launch: { type: 'url', url: 'https://example.com' }, launchLabel: '', moreLaunches: [],
    sourceDir: null, importedFrom: null, needsReview: false,
  });
});

test('validateApp: 이름 없음·너무 김', () => {
  assert.deepEqual(validateApp({ ...base, name: '  ' }).errors, ['이름을 입력해 주세요']);
  assert.deepEqual(validateApp({ ...base, name: 'x'.repeat(101) }).errors, ['이름은 100자 이하로 적어 주세요']);
});

test('validateApp: 썸네일·원본 폴더 형식', () => {
  assert.equal(validateApp({ ...base, thumbnail: 'thumbs/a-1.png' }).ok, true);
  assert.equal(validateApp({ ...base, thumbnail: '../x.png' }).ok, false);
  assert.equal(validateApp({ ...base, sourceDir: 'relative/dir' }).ok, false);
  assert.equal(validateApp({ ...base, sourceDir: '/home/me/projects/a' }).value.sourceDir, '/home/me/projects/a');
});

test('validateLaunch: 종류별 필수값과 기본값', () => {
  assert.deepEqual(validateLaunch({ type: 'nope' }).errors, ['실행 방법을 골라 주세요']);
  assert.deepEqual(validateLaunch({ type: 'url', url: 'ftp://x' }).errors, ['웹 주소는 http:// 또는 https://로 시작해야 해요']);
  assert.deepEqual(validateLaunch({ type: 'chrome-app', appId: 'abc' }).errors, ['크롬 앱 ID는 a~p 소문자 32자예요']);
  assert.deepEqual(validateLaunch({ type: 'chrome-app', appId: 'a'.repeat(32) }).value,
    { type: 'chrome-app', appId: 'a'.repeat(32), profile: 'Default' });
  // 캡처용 주소(선택): 있으면 저장, 형식 검사
  assert.deepEqual(validateLaunch({ type: 'chrome-app', appId: 'a'.repeat(32), url: ' https://x.dev ' }).value,
    { type: 'chrome-app', appId: 'a'.repeat(32), profile: 'Default', url: 'https://x.dev' });
  assert.deepEqual(validateLaunch({ type: 'chrome-app', appId: 'a'.repeat(32), url: 'x.dev' }).errors, ['캡처용 주소는 http:// 또는 https://로 시작해야 해요']);
  assert.deepEqual(validateLaunch({ type: 'windows', file: 'C:\\Users\\me\\a.bat' }).value,
    { type: 'windows', file: 'C:\\Users\\me\\a.bat', args: [], cwd: null });
  assert.deepEqual(validateLaunch({ type: 'windows', file: 'a.exe', args: 'x' }).errors, ['인자는 문자열 목록이어야 해요']);
  assert.deepEqual(validateLaunch({ type: 'wsl', command: 'npm start' }).value,
    { type: 'wsl', command: 'npm start', cwd: null, window: 'hidden' });
  assert.deepEqual(validateLaunch({ type: 'wsl', command: 'x', window: 'big' }).errors, ['창 설정은 new 또는 hidden이에요']);
  assert.deepEqual(validateLaunch({ type: 'local-web', dir: '/home/me/demo' }).value,
    { type: 'local-web', dir: '/home/me/demo', entry: 'index.html' });
  assert.deepEqual(validateLaunch({ type: 'local-web', dir: '/home/me/demo', entry: '../x.html' }).errors,
    ['시작 페이지는 폴더 안의 상대 경로여야 해요']);
});

test('needsReview면 빈 실행 정보 허용, 형식 오류는 여전히 거부', () => {
  assert.equal(validateLaunch({ type: 'url', url: '' }).ok, false);
  assert.equal(validateLaunch({ type: 'url', url: '' }, { allowEmpty: true }).ok, true);
  assert.equal(validateApp({ name: 'x', needsReview: true, launch: { type: 'url', url: '' } }).ok, true);
  assert.equal(validateApp({ name: 'x', needsReview: true, launch: { type: 'url', url: 'ftp://x' } }).ok, false);
});

test('validateApp: 한 카드에 실행 여러 개 — 이름표 필수(여럿일 때), 같은 실행 대상 중복 금지', () => {
  const local = { type: 'url', url: 'http://localhost:3000' };
  const r = validateApp({ ...base, launchLabel: ' 배포판 ', moreLaunches: [{ label: ' 로컬 ', launch: local }] });
  assert.equal(r.ok, true);
  assert.deepEqual([r.value.launchLabel, r.value.moreLaunches], ['배포판', [{ label: '로컬', launch: local }]]);
  assert.deepEqual(allLaunches(r.value).map((x) => x.label), ['배포판', '로컬']);
  assert.deepEqual(validateApp({ ...base, moreLaunches: [{ label: '로컬', launch: local }] }).errors, ['실행이 여러 개면 기본 실행에도 이름표를 붙여 주세요']);
  assert.deepEqual(validateApp({ ...base, launchLabel: 'a', moreLaunches: [{ label: '', launch: local }] }).errors, ['실행 2의 이름표를 적어 주세요']);
  assert.deepEqual(validateApp({ ...base, launchLabel: 'a', moreLaunches: [{ label: 'b', launch: base.launch }] }).errors, ['실행 2가 다른 실행과 같아요']);
  assert.deepEqual(validateApp({ ...base, launchLabel: 'a', moreLaunches: [{ label: 'b', launch: { type: 'url', url: 'ftp://x' } }] }).errors, ['실행 2: 웹 주소는 http:// 또는 https://로 시작해야 해요']);
  assert.equal(validateApp({ ...base, launchLabel: 'x'.repeat(21) }).ok, false);
  assert.equal(validateApp({ ...base, moreLaunches: 'x' }).ok, false);
  const lw = (dir) => ({ type: 'local-web', dir, entry: 'index.html' });
  assert.deepEqual(validateApp({ ...base, launch: lw('/a'), launchLabel: 'a', moreLaunches: [{ label: 'b', launch: lw('/b') }] }).errors, ['로컬 웹 실행은 카드에 하나만 둘 수 있어요']);
});

test('validateLaunch: 파일 열기 — Windows 경로·UNC·WSL 경로, 그 밖은 오류', () => {
  for (const p of ['C:\\Users\\me\\영상.mp4', '\\\\wsl.localhost\\Ubuntu\\a.pdf', '/home/me/p/out.mp4', 'D:\\']) {
    assert.deepEqual(validateLaunch({ type: 'file', path: ` ${p} ` }).value, { type: 'file', path: p }, p);
  }
  assert.deepEqual(validateLaunch({ type: 'file', path: '"C:\\a b\\x.mp4"' }).value, { type: 'file', path: 'C:\\a b\\x.mp4' });
  assert.deepEqual(validateLaunch({ type: 'file', path: '' }).errors, ['열 파일이나 폴더 경로를 입력해 주세요']);
  assert.deepEqual(validateLaunch({ type: 'file', path: 'out.mp4' }).errors, ['경로는 C:\\… 같은 Windows 경로나 /로 시작하는 WSL 경로여야 해요']);
});
