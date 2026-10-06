import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createStore } from '../server/store.js';
import { createApp } from '../server/app.js';
import { request, listen } from './helpers/http.js';

const PNG_URL = `data:image/png;base64,${Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')}`;
const web = (name, url = 'https://example.com') => ({ name, launch: { type: 'url', url } });

async function setup(t, extra = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-app-'));
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-pub-'));
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<meta name="launcher-token" content="__LAUNCHER_TOKEN__">');
  const store = createStore(home);
  const calls = [];
  const launcher = {
    ctx: () => ({ chromeDir: 'C:\\C' }),
    runPs: async () => ({ ok: true, stdout: '' }),
    launch: async (a) => { calls.push(['launch', a]); return a.launch.url === 'https://fail.dev' ? { ok: false, error: '안 됨' } : { ok: true }; },
    openFolder: async (a) => { calls.push(['folder', a.id]); return { ok: true }; },
  };
  let port = 0;
  const app = createApp({
    store, launcher, token: 'tok', getPort: () => port, localWebBase: 'http://127.0.0.1:4791', publicDir,
    onShutdown: () => calls.push(['shutdown']),
    capture: async ({ app: a }) => ({ ok: true, thumbnail: `thumbs/${a.id}.png` }),
    ...extra,
  });
  const server = await listen(app);
  port = server.address().port;
  t.after(() => { server.closeAllConnections(); server.close(); app.locals.close(); });
  const headers = { origin: `http://127.0.0.1:${port}`, 'x-launcher-token': 'tok' };
  const api = (method, p, body) => request(port, { method, path: p, body, headers });
  return { home, store, calls, port, api };
}

test('GET /: 토큰을 넣고 캐시 금지', async (t) => {
  const { port } = await setup(t);
  const r = await request(port, { path: '/' });
  assert.match(r.text, /content="tok"/);
  assert.equal(r.headers['cache-control'], 'no-store');
});

test('공용 모듈은 두 개만 제공', async (t) => {
  const { port } = await setup(t);
  assert.equal((await request(port, { path: '/server/app-schema.js' })).status, 200);
  assert.equal((await request(port, { path: '/server/wincmd.js' })).status, 200);
  assert.equal((await request(port, { path: '/server/store.js' })).status, 404);
});

test('추가·목록·수정·삭제·되돌리기', async (t) => {
  const { api } = await setup(t);
  const add = await api('POST', '/api/apps', web('a'));
  assert.equal(add.status, 201);
  const id = add.json.app.id;
  assert.equal((await api('GET', '/api/apps')).json.apps.length, 1);
  assert.equal((await api('PUT', `/api/apps/${id}`, web('b'))).json.app.name, 'b');
  const del = await api('DELETE', `/api/apps/${id}`);
  assert.equal((await api('GET', '/api/apps')).json.apps.length, 0);
  assert.equal((await api('POST', `/api/trash/${del.json.trashName}/restore`)).json.app.id, id);
  assert.equal((await api('GET', '/api/apps')).json.apps.length, 1);
});

test('형식 오류는 400 + 한 줄 오류, 없는 id는 404, 본문 없으면 400', async (t) => {
  const { api, port } = await setup(t);
  const r = await api('POST', '/api/apps', { name: '', launch: { type: 'url', url: '' } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /이름을 입력해 주세요 · 웹 주소를 입력해 주세요/);
  assert.equal((await api('PUT', '/api/apps/nope', web('x'))).status, 404);
  assert.equal((await api('POST', '/api/apps/nope/launch')).status, 404);
  const bad = await request(port, { method: 'POST', path: '/api/apps', headers: { origin: `http://127.0.0.1:${port}`, 'x-launcher-token': 'tok', 'content-type': 'application/json' } });
  assert.equal(bad.status, 400); // 본문 없음 → 형식 오류
  assert.equal(bad.json.ok, false);
});

test('토큰 없으면 상태 변경 거부', async (t) => {
  const { port } = await setup(t);
  const r = await request(port, { method: 'POST', path: '/api/apps', body: web('a'), headers: { origin: `http://127.0.0.1:${port}` } });
  assert.equal(r.status, 403);
});

test('실행: 성공하면 lastLaunchedAt, 실패하면 이유', async (t) => {
  const { api, store } = await setup(t);
  const ok = (await api('POST', '/api/apps', web('a'))).json.app;
  const bad = (await api('POST', '/api/apps', web('b', 'https://fail.dev'))).json.app;
  assert.deepEqual((await api('POST', `/api/apps/${ok.id}/launch`)).json, { ok: true });
  assert.ok(store.get(ok.id).lastLaunchedAt);
  assert.deepEqual((await api('POST', `/api/apps/${bad.id}/launch`)).json, { ok: false, error: '안 됨' });
  assert.equal(store.get(bad.id).lastLaunchedAt, null);
});

test('썸네일 올리기 → /thumbs로 제공, 자동 캡처', async (t) => {
  const { api, port } = await setup(t);
  const { id } = (await api('POST', '/api/apps', web('a'))).json.app;
  const r = await api('POST', `/api/apps/${id}/thumbnail`, { dataUrl: PNG_URL });
  assert.deepEqual(r.json, { ok: true, thumbnail: `thumbs/${id}.png` });
  assert.equal((await request(port, { path: `/thumbs/${id}.png` })).status, 200);
  assert.equal((await api('POST', `/api/apps/${id}/thumbnail`, { dataUrl: 'data:text/plain;base64,AA' })).status, 400);
  assert.deepEqual((await api('POST', `/api/apps/${id}/thumbnail`, { capture: true })).json, { ok: true, thumbnail: `thumbs/${id}.png` });
});

test('순서: GET /api/apps에 order, POST /api/order로 저장', async (t) => {
  const { api } = await setup(t);
  const a = (await api('POST', '/api/apps', web('a'))).json.app;
  const b = (await api('POST', '/api/apps', web('b'))).json.app;
  assert.deepEqual((await api('GET', '/api/apps')).json.order, []);
  assert.deepEqual((await api('POST', '/api/order', { ids: [b.id, a.id] })).json, { ok: true, order: [b.id, a.id] });
  assert.deepEqual((await api('GET', '/api/apps')).json.order, [b.id, a.id]);
  assert.equal((await api('POST', '/api/order', { ids: 'x' })).status, 400);
});

test('분류 직접 추가·삭제: GET /api/apps에 categories', async (t) => {
  const { api } = await setup(t);
  assert.deepEqual((await api('POST', '/api/categories', { name: '공모전' })).json, { ok: true, categories: ['공모전'] });
  assert.deepEqual((await api('GET', '/api/apps')).json.categories, ['공모전']);
  assert.equal((await api('POST', '/api/categories', { name: '전체' })).status, 400);
  assert.deepEqual((await api('DELETE', `/api/categories/${encodeURIComponent('공모전')}`)).json, { ok: true, categories: [] });
});

test('탭 순서: GET /api/apps에 tabOrder, POST /api/tab-order로 저장', async (t) => {
  const { api } = await setup(t);
  assert.deepEqual((await api('POST', '/api/tab-order', { names: ['도구', '게임'] })).json, { ok: true, tabOrder: ['도구', '게임'] });
  assert.deepEqual((await api('GET', '/api/apps')).json.tabOrder, ['도구', '게임']);
  assert.equal((await api('POST', '/api/tab-order', { names: 'x' })).status, 400);
});

test('실행 여러 개: index로 고른 실행을 띄운다, 없는 index는 400', async (t) => {
  const { api, calls } = await setup(t);
  const local = { type: 'url', url: 'http://localhost:3000' };
  const { id } = (await api('POST', '/api/apps', { ...web('a'), launchLabel: '배포', moreLaunches: [{ label: '로컬', launch: local }] })).json.app;
  assert.deepEqual((await api('POST', `/api/apps/${id}/launch`, { index: 1 })).json, { ok: true });
  assert.deepEqual(calls.at(-1)[1].launch, local);
  await api('POST', `/api/apps/${id}/launch`, {});
  assert.equal(calls.at(-1)[1].launch.url, 'https://example.com');
  assert.equal((await api('POST', `/api/apps/${id}/launch`, { index: 5 })).status, 400);
});

test('프로젝트 폴더 목록: 하위 폴더만 이름순(숨김·파일 제외), 이미 카드가 있으면 그 카드 이름', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-proj-'));
  for (const d of ['b-app', 'a-app', '.hidden']) fs.mkdirSync(path.join(root, d));
  fs.writeFileSync(path.join(root, 'file.txt'), '');
  const { api } = await setup(t, { projectsRoot: root });
  await api('POST', '/api/apps', { ...web('B 앱'), sourceDir: path.join(root, 'b-app') });
  const r = (await api('GET', '/api/projects')).json;
  assert.equal(r.root, root);
  assert.deepEqual(r.dirs, [
    { name: 'a-app', path: path.join(root, 'a-app'), card: null },
    { name: 'b-app', path: path.join(root, 'b-app'), card: 'B 앱' },
  ]);
});

test('프로젝트 폴더 목록: 폴더가 없으면 빈 목록', async (t) => {
  const { api } = await setup(t, { projectsRoot: '/no/such/dir' });
  assert.deepEqual((await api('GET', '/api/projects')).json, { ok: true, root: '/no/such/dir', dirs: [] });
});

test('찾아보기: GET /api/browse — 목록 + Windows 경로 + 바로가기', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-proj-'));
  fs.mkdirSync(path.join(root, 'p'));
  fs.writeFileSync(path.join(root, 'p', 'v.mp4'), '');
  const { api } = await setup(t, { projectsRoot: root });
  const r = (await api('GET', `/api/browse?path=${encodeURIComponent(path.join(root, 'p'))}`)).json;
  assert.equal(r.ok, true);
  assert.deepEqual(r.entries.map((e) => e.name), ['v.mp4']);
  assert.ok(r.roots.some((x) => x.label === '~/projects'));
  // path를 안 주면 첫 바로가기(이 프로젝트 → 없으면 ~/projects)
  assert.equal((await api('GET', '/api/browse')).json.path, root);
  assert.equal((await api('GET', '/api/browse?path=relative')).status, 400);
});

test('이름표 직접 추가·삭제: GET /api/apps에 labels', async (t) => {
  const { api } = await setup(t);
  assert.deepEqual((await api('POST', '/api/labels', { name: '시연' })).json, { ok: true, labels: ['시연'] });
  assert.deepEqual((await api('GET', '/api/apps')).json.labels, ['시연']);
  assert.deepEqual((await api('DELETE', `/api/labels/${encodeURIComponent('시연')}`)).json, { ok: true, labels: [] });
});

test('GitHub에서 가져오기: 목록 → 고른 것만 카드, 이미 있으면 건너뜀', async (t) => {
  const repos = [
    { name: 'site', description: '내 사이트', homepageUrl: 'https://site.dev', isPrivate: false, isFork: false, isArchived: false, url: 'https://github.com/me/site' },
    { name: 'tool', description: '', homepageUrl: '', isPrivate: true, isFork: false, isArchived: false, url: 'https://github.com/me/tool' },
  ];
  const { api, store } = await setup(t, { projectsRoot: '/no/such', listGithubRepos: async () => ({ ok: true, repos }) });
  const list = (await api('GET', '/api/github/repos')).json;
  assert.deepEqual(list.candidates.map((c) => [c.name, c.checked]), [['site', true], ['tool', false]]);
  const r = (await api('POST', '/api/github/import', { names: ['site', 'tool'] })).json;
  assert.deepEqual([r.added.length, r.skipped.length], [2, 0]);
  assert.deepEqual(store.list().map((a) => [a.name, a.needsReview]), [['site', false], ['tool', true]]);
  const again = (await api('POST', '/api/github/import', { names: ['site'] })).json;
  assert.deepEqual(again.skipped, [{ name: 'site', reason: '이미 카드가 있어요' }]);
});

test('GitHub에서 가져오기: gh 안내 오류는 그대로 전달', async (t) => {
  const { api } = await setup(t, { listGithubRepos: async () => ({ ok: false, error: 'gh에 로그인해 주세요' }) });
  const r = await api('GET', '/api/github/repos');
  assert.equal(r.status, 400);
  assert.match(r.json.error, /로그인/);
});

test('등록 스킬: GET /api/skill 상태, POST /api/skill/install 설치', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-skhome-'));
  fs.mkdirSync(path.join(home, '.claude'));
  const skillFile = path.join(home, 'SKILL.md');
  fs.writeFileSync(skillFile, 'S');
  const { api } = await setup(t, { skillHome: home, skillEnv: {}, skillFile });
  const r = (await api('GET', '/api/skill')).json;
  assert.deepEqual([r.summary, r.targets.length], ['missing', 1]);
  assert.deepEqual((await api('POST', '/api/skill/install', { dirs: [path.join(home, '.claude')] })).json, { ok: true, installed: [path.join(home, '.claude')] });
  assert.equal((await api('GET', '/api/skill')).json.summary, 'current');
  assert.equal((await api('POST', '/api/skill/install', { dirs: ['/etc'] })).status, 400);
});

test('업데이트: 확인·실행·다시 켜기', async (t) => {
  const restarts = [];
  const { api } = await setup(t, {
    checkUpdate: async () => ({ ok: true, behind: 2, commits: ['a 새 기능', 'b 수정'] }),
    runUpdate: async () => ({ ok: true, changed: true, behind: 2 }),
    onRestart: () => restarts.push(1),
  });
  assert.deepEqual((await api('GET', '/api/update/check')).json, { ok: true, behind: 2, commits: ['a 새 기능', 'b 수정'] });
  assert.deepEqual((await api('POST', '/api/update')).json, { ok: true, changed: true, behind: 2 });
  assert.deepEqual((await api('POST', '/api/restart')).json, { ok: true });
  await new Promise((r) => setImmediate(r));
  assert.equal(restarts.length, 1);
});

test('원본 폴더·종료', async (t) => {
  const { api, calls } = await setup(t);
  const { id } = (await api('POST', '/api/apps', web('a'))).json.app;
  assert.deepEqual((await api('POST', `/api/apps/${id}/open-folder`)).json, { ok: true });
  assert.deepEqual((await api('POST', '/api/shutdown')).json, { ok: true });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls.at(-1), ['shutdown']);
});

test('SSE: 다른 쪽(스킬)이 apps.json을 바꾸면 알림', async (t) => {
  const { home, port } = await setup(t);
  const got = new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/events', headers: { host: `127.0.0.1:${port}` } }, (res) => {
      assert.match(res.headers['content-type'], /^text\/event-stream/);
      res.setEncoding('utf8');
      res.on('data', (c) => { if (c.includes('event: apps')) { req.destroy(); resolve(); } });
    });
    req.on('error', () => {});
    setTimeout(() => reject(new Error('알림이 오지 않음')), 3000);
  });
  await new Promise((r) => setTimeout(r, 100));
  createStore(home).upsertBySourceDir({ ...web('스킬'), sourceDir: '/home/me/p/x' });
  await got;
});

test('GET /api/console: 누적 로그 replay + 실시간 로그, 연결·끊김을 idle에 알림', async (t) => {
  const { createConsoleStream } = await import('../server/console-stream.js');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-con-'));
  const consoleStream = createConsoleStream();
  consoleStream.push('이전 로그\n');
  const events = [];
  const idle = { connected: () => events.push('연결'), disconnected: () => events.push('끊김') };
  let port = 0;
  const app = createApp({ store: createStore(home), launcher: {}, token: 'tok', getPort: () => port, localWebBase: '', consoleStream, idle });
  const server = await listen(app);
  port = server.address().port;
  t.after(() => { server.closeAllConnections(); server.close(); app.locals.close(); });

  let text = '';
  const req = http.get({ host: '127.0.0.1', port, path: '/api/console', headers: { host: `127.0.0.1:${port}` } }, (res) => {
    assert.match(res.headers['content-type'], /^text\/event-stream/);
    res.setEncoding('utf8');
    res.on('data', (c) => { text += c; });
  });
  req.on('error', () => {});
  const until = async (cond) => { for (let i = 0; i < 50 && !cond(); i++) await new Promise((r) => setTimeout(r, 20)); assert.ok(cond(), text); };
  await until(() => text.includes(`data: ${JSON.stringify('이전 로그\n')}`));
  assert.match(text, /^retry: 1000$/m); // 끊기면 1초 뒤 다시 연결 (서버 유예 10초 안에)
  consoleStream.push('새 로그\n');
  await until(() => text.includes(`data: ${JSON.stringify('새 로그\n')}`));
  assert.deepEqual(events, ['연결']);
  req.destroy();
  await until(() => events.length === 2);
  assert.deepEqual(events, ['연결', '끊김']);
});
