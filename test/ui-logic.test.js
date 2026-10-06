import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chipList, filterApps, mergeOrder, canReorder, categoryColors, labelOptions, DEFAULT_LABELS, thumbHue, initials, launchLabel, subtitle, thumbSrc, launchToForm, formToLaunch, RECENT_MAX,
} from '../public/ui-logic.js';

const A = (name, extra = {}) => ({ id: name, name, description: '', category: '', launch: { type: 'url', url: 'https://x.dev' }, lastLaunchedAt: null, needsReview: false, ...extra });
const apps = [
  A('하늘', { category: '게임', lastLaunchedAt: '2026-10-01T01:00:00Z' }),
  A('가람', { category: '도구', description: '문서 변환기' }),
  A('나무', { category: '게임', lastLaunchedAt: '2026-10-01T02:00:00Z' }),
  A('Zeta', { needsReview: true }),
];

test('chipList: 전체·분류(가나다)·최근 실행·확인 필요', () => {
  assert.deepEqual(chipList(apps), [
    { key: 'all', label: '전체', count: 4 },
    { key: 'cat:게임', label: '게임', count: 2 },
    { key: 'cat:도구', label: '도구', count: 1 },
    { key: 'recent', label: '최근 실행', count: 2 },
    { key: 'review', label: '확인 필요', count: 1 },
  ]);
  assert.deepEqual(chipList([A('x')]), [{ key: 'all', label: '전체', count: 1 }]);
});

test('filterApps: 기본은 이름순, 검색, 분류, 최근 실행, 확인 필요', () => {
  assert.deepEqual(filterApps(apps, {}).map((a) => a.name), ['가람', '나무', '하늘', 'Zeta']); // 한국어 정렬: 한글 먼저
  assert.deepEqual(filterApps(apps, { query: '변환' }).map((a) => a.name), ['가람']);
  assert.deepEqual(filterApps(apps, { query: 'ZETA' }).map((a) => a.name), ['Zeta']);
  assert.deepEqual(filterApps(apps, { chip: 'cat:게임' }).map((a) => a.name), ['나무', '하늘']);
  assert.deepEqual(filterApps(apps, { chip: 'recent' }).map((a) => a.name), ['나무', '하늘']);
  assert.deepEqual(filterApps(apps, { chip: 'review' }).map((a) => a.name), ['Zeta']);
  const many = Array.from({ length: 20 }, (_, i) => A(`a${i}`, { lastLaunchedAt: `2026-10-01T00:00:${String(i).padStart(2, '0')}Z` }));
  assert.equal(filterApps(many, { chip: 'recent' }).length, RECENT_MAX);
  assert.equal(filterApps(many, { chip: 'recent' })[0].name, 'a19');
});

test('썸네일 보조', () => {
  assert.equal(thumbHue('가람'), thumbHue('가람'));
  assert.ok(thumbHue('가람') >= 0 && thumbHue('가람') < 360);
  assert.equal(initials(' follow.it'), 'F');
  assert.equal(initials('성을 지켜라'), '성');
  assert.equal(initials(''), '?');
  assert.equal(launchLabel({ type: 'wsl' }), 'WSL 명령');
  assert.equal(subtitle(A('x', { category: '게임', description: '타워 디펜스' })), '게임 · 타워 디펜스');
  assert.equal(thumbSrc({ thumbnail: 'thumbs/a.png', updatedAt: '2026-10-01T00:00:00Z' }), '/thumbs/a.png?v=2026-10-01T00%3A00%3A00Z');
});

test('입력칸 ↔ launch 왕복 (인자 따옴표, 작업 폴더 칸 분리)', () => {
  const win = { type: 'windows', file: 'C:\\Users\\me\\g.exe', args: ['--path', 'C:\\내 폴더'], cwd: null };
  const f = launchToForm(win);
  assert.equal(f.args, '--path "C:\\내 폴더"');
  assert.deepEqual(formToLaunch('windows', f), win);
  const wsl = { type: 'wsl', command: 'npm start', cwd: '/home/me/p', window: 'new' };
  assert.deepEqual(formToLaunch('wsl', launchToForm(wsl)), wsl);
  assert.equal(launchToForm(wsl).winCwd, '');
  assert.deepEqual(formToLaunch('local-web', launchToForm({ type: 'url', url: 'https://x' })), { type: 'local-web', dir: '', entry: 'index.html' });
  assert.deepEqual(formToLaunch('chrome-app', { ...launchToForm({ type: 'url', url: '' }), appId: ' abc ' }), { type: 'chrome-app', appId: 'abc', profile: 'Default' });
  const ca = { type: 'chrome-app', appId: 'a'.repeat(32), profile: 'Default', url: 'https://x.dev' };
  assert.deepEqual(formToLaunch('chrome-app', launchToForm(ca)), ca);
});

test('filterApps: 정한 순서(order) 우선, 순서에 없는 새 앱은 맨 앞에 이름순', () => {
  const order = ['나무', '하늘', 'Zeta'];
  assert.deepEqual(filterApps(apps, { order }).map((a) => a.name), ['가람', '나무', '하늘', 'Zeta']);
  assert.deepEqual(filterApps(apps, { order: ['Zeta', '가람', '하늘', '나무'] }).map((a) => a.name), ['Zeta', '가람', '하늘', '나무']);
  assert.deepEqual(filterApps(apps, { chip: 'cat:게임', order: ['Zeta', '가람', '하늘', '나무'] }).map((a) => a.name), ['하늘', '나무']);
  // 최근 실행은 순서와 상관없이 시간순
  assert.deepEqual(filterApps(apps, { chip: 'recent', order: ['하늘', '나무'] }).map((a) => a.name), ['나무', '하늘']);
});

test('mergeOrder: 탭 안에서 바꾼 순서를 전체 순서의 같은 자리들에 채워 넣는다', () => {
  // 전체 A B C D E 중 게임 탭(B D E)에서 E를 맨 앞으로 → 게임 칸(2·4·5번째)에 E B D
  assert.deepEqual(mergeOrder(['A', 'B', 'C', 'D', 'E'], ['E', 'B', 'D']), ['A', 'E', 'C', 'B', 'D']);
  assert.deepEqual(mergeOrder(['A', 'B'], ['B', 'A']), ['B', 'A']);
});

test('canReorder: 전체·분류 탭에서만 끌어 정렬 (최근 실행·확인 필요는 아님)', () => {
  assert.equal(canReorder('all'), true);
  assert.equal(canReorder('cat:게임'), true);
  assert.equal(canReorder('recent'), false);
  assert.equal(canReorder('review'), false);
});

test('chipList: 직접 추가한 빈 분류도 탭으로 (0개, manual 표시)', () => {
  const chips = chipList(apps, ['공모전', '게임']);
  assert.deepEqual(chips.filter((c) => c.key.startsWith('cat:')), [
    { key: 'cat:게임', label: '게임', count: 2 },
    { key: 'cat:공모전', label: '공모전', count: 0, manual: true },
    { key: 'cat:도구', label: '도구', count: 1 },
  ]);
});

test('chipList: 분류 탭은 정한 탭 순서대로, 순서에 없는 분류는 뒤에 가나다순', () => {
  const keys = (tabOrder) => chipList(apps, ['공모전'], tabOrder).filter((c) => c.key.startsWith('cat:')).map((c) => c.label);
  assert.deepEqual(keys([]), ['게임', '공모전', '도구']);
  assert.deepEqual(keys(['도구', '게임']), ['도구', '게임', '공모전']);
  assert.deepEqual(keys(['없는분류', '공모전']), ['공모전', '게임', '도구']);
});

test('categoryColors: 분류마다 겹치지 않는 색 (가나다순으로 팔레트 배정, 탭 순서를 바꿔도 색은 그대로)', () => {
  const c = categoryColors(['학습', '게임', '에이전트', '게임', '']);
  assert.deepEqual(Object.keys(c), ['게임', '에이전트', '학습']);
  assert.equal(new Set(Object.values(c)).size, 3);
  assert.deepEqual(categoryColors(['에이전트', '게임', '학습']), c);
});

test('launchLabel: 파일 열기는 확장자로 결과물 종류', () => {
  assert.equal(launchLabel({ type: 'file', path: 'C:\\a\\완성.MP4' }), '영상');
  assert.equal(launchLabel({ type: 'file', path: '/home/me/제출.pdf' }), '문서');
  assert.equal(launchLabel({ type: 'file', path: 'C:\\a\\서류.hwp' }), '문서');
  assert.equal(launchLabel({ type: 'file', path: 'C:\\a\\포스터.png' }), '이미지');
  assert.equal(launchLabel({ type: 'file', path: 'C:\\a\\제출서류' }), '폴더');
  assert.equal(launchLabel({ type: 'file', path: 'C:\\a\\x.zip' }), '파일');
  // 탐색기 '경로로 복사'는 앞뒤에 따옴표가 붙는다 → 떼기
  assert.deepEqual(formToLaunch('file', { filePath: ' "C:\\a\\b c.mp4" ' }), { type: 'file', path: 'C:\\a\\b c.mp4' });
  const f = { type: 'file', path: 'C:\\a\\b.mp4' };
  assert.deepEqual(formToLaunch('file', launchToForm(f)), f);
});

test('labelOptions: 기본 이름표 + 직접 추가한 것 + 카드들이 쓰는 것 (중복 없이, 직접 추가한 것만 지울 수 있음 표시)', () => {
  const cards = [{ launchLabel: '크롬', moreLaunches: [{ label: '엣지' }, { label: '사내판' }] }, { launchLabel: '' }];
  const opts = labelOptions(cards, ['시연', '완성 영상']);
  assert.deepEqual(opts.slice(0, DEFAULT_LABELS.length).map((o) => o.label), DEFAULT_LABELS);
  assert.deepEqual(opts.slice(DEFAULT_LABELS.length), [{ label: '시연', custom: true, used: false }, { label: '사내판', custom: false, used: true }]);
  assert.ok(DEFAULT_LABELS.includes('완성 영상') && DEFAULT_LABELS.includes('유튜브'));
});
