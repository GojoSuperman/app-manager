import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { request } from './helpers/http.js';

const SERVER = path.join(import.meta.dirname, '..', 'server', 'index.js');

function start(env) {
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { out += c; });
  const exited = new Promise((r) => child.once('exit', (code) => r(code)));
  const ready = (text) => new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => (out.includes(text) ? resolve(out)
      : Date.now() - t0 > 8000 ? reject(new Error(`시작 안 됨:\n${out}`)) : setTimeout(tick, 50));
    tick();
  });
  return { child, exited, ready, output: () => out };
}

test('서버: 시작 → 토큰 화면 → 두 번째 실행은 그냥 끝남 → 종료 버튼으로 꺼짐', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-smoke-'));
  const port = 40000 + Math.floor(Math.random() * 9000);
  const env = { MY_APP_LAUNCHER_HOME: home, MY_APP_LAUNCHER_PORT: String(port), MY_APP_LAUNCHER_WEB_PORT: String(port + 1), WSL_DISTRO_NAME: 'Ubuntu' };
  const s1 = start(env);
  try {
    await s1.ready('런처 시작');
    const page = await request(port, { path: '/' });
    const token = /name="launcher-token" content="([0-9a-f]{48})"/.exec(page.text)?.[1];
    assert.ok(token, '화면에 토큰이 들어가야 함');
    assert.deepEqual((await request(port, { path: '/api/health' })).json, { app: 'my-app-launcher' });

    const s2 = start(env);
    assert.equal(await s2.exited, 0);
    assert.match(s2.output(), /이미 실행 중/);

    const r = await request(port, { method: 'POST', path: '/api/shutdown', headers: { origin: `http://127.0.0.1:${port}`, 'x-launcher-token': token } });
    assert.equal(r.json.ok, true);
    assert.equal(await s1.exited, 0);
    assert.match(fs.readFileSync(path.join(home, 'logs', 'server.log'), 'utf8'), /런처를 끕니다/);
  } finally {
    s1.child.kill();
  }
});

test('서버: WSL_DISTRO_NAME 없으면 안내하고 끝남', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-smoke-'));
  const s = start({ MY_APP_LAUNCHER_HOME: home, WSL_DISTRO_NAME: '' });
  assert.equal(await s.exited, 1);
  assert.match(s.output(), /WSL 안에서 실행/);
});

test('서버: 하단 콘솔 연결이 모두 끊기면 유예 뒤 스스로 종료', async () => {
  const http = await import('node:http');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-smoke-'));
  const port = 40000 + Math.floor(Math.random() * 9000);
  const s = start({ MY_APP_LAUNCHER_HOME: home, MY_APP_LAUNCHER_PORT: String(port), MY_APP_LAUNCHER_WEB_PORT: String(port + 1), WSL_DISTRO_NAME: 'Ubuntu', MY_APP_LAUNCHER_IDLE_MS: '300' });
  try {
    await s.ready('런처 시작');
    let text = '';
    const req = http.get({ host: '127.0.0.1', port, path: '/api/console', headers: { host: `127.0.0.1:${port}` } }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
    });
    req.on('error', () => {});
    for (let i = 0; i < 50 && !text.includes('런처 시작'); i++) await new Promise((r) => setTimeout(r, 20));
    assert.match(text, /런처 시작/); // 시작 로그가 콘솔로 replay됨
    req.destroy();
    assert.equal(await s.exited, 0);
    assert.match(fs.readFileSync(path.join(home, 'logs', 'server.log'), 'utf8'), /대시보드 창이 닫혀 서버를 자동 종료합니다/);
  } finally {
    s.child.kill();
  }
});
