import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { createLocalWebApp } from '../server/local-web.js';
import { request, listen } from './helpers/http.js';

async function setup(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-lw-'));
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-site-'));
  fs.writeFileSync(path.join(site, 'index.html'), '<img src="thumbs/a.png">');
  fs.mkdirSync(path.join(site, 'sub'));
  fs.writeFileSync(path.join(site, 'sub', '첫 화면.html'), 'sub page');
  fs.writeFileSync(path.join(home, 'secret.txt'), 'secret');
  const store = createStore(home);
  const demo = store.add({ name: 'demo', launch: { type: 'local-web', dir: site } }).app;
  const web = store.add({ name: 'web', launch: { type: 'url', url: 'https://x.dev' } }).app;
  // 로컬 웹이 추가 실행에 있는 카드도 제공
  const mixed = store.add({ name: 'mixed', launch: { type: 'url', url: 'https://m.dev' }, launchLabel: '배포', moreLaunches: [{ label: '로컬', launch: { type: 'local-web', dir: site } }] }).app;
  let port = 0;
  const server = await listen(createLocalWebApp({ store, getPort: () => port }));
  port = server.address().port;
  t.after(() => server.close());
  return { port, demo, web, mixed };
}

test('폴더 제공: index, 하위 경로, 한글 파일 이름', async (t) => {
  const { port, demo } = await setup(t);
  assert.match((await request(port, { path: `/${demo.id}/` })).text, /thumbs\/a\.png/);
  assert.equal((await request(port, { path: `/${demo.id}/sub/${encodeURIComponent('첫 화면.html')}` })).text, 'sub page');
});

test('추가 실행에 있는 로컬 웹도 제공', async (t) => {
  const { port, mixed } = await setup(t);
  assert.match((await request(port, { path: `/${mixed.id}/` })).text, /thumbs\/a\.png/);
});

test('끝 / 없으면 붙여서 이동 (상대 경로 링크 보호)', async (t) => {
  const { port, demo } = await setup(t);
  const r = await request(port, { path: `/${demo.id}?x=1` });
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, `/${demo.id}/?x=1`);
});

test('없는 앱·로컬 웹 아닌 앱·폴더 밖·다른 Host·POST 거부', async (t) => {
  const { port, demo, web } = await setup(t);
  assert.equal((await request(port, { path: '/nope/' })).status, 404);
  assert.equal((await request(port, { path: `/${web.id}/` })).status, 404);
  assert.notEqual((await request(port, { path: `/${demo.id}/../secret.txt` })).status, 200);
  assert.notEqual((await request(port, { path: `/${demo.id}/%2e%2e/secret.txt` })).status, 200);
  assert.equal((await request(port, { path: `/${demo.id}/`, headers: { host: `evil.example:${port}` } })).status, 403);
  assert.equal((await request(port, { method: 'POST', path: `/${demo.id}/`, body: {} })).status, 405);
});
