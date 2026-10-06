import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { request } from './helpers/http.js';

const SCRIPT = path.join(import.meta.dirname, '..', 'scripts', 'launch.sh');

function run(env) {
  const child = spawn('bash', [SCRIPT], { env: { ...process.env, LAUNCHER_NO_BROWSER: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { out += c; });
  const exited = new Promise((r) => child.once('exit', (code) => r(code)));
  const wait = (text) => new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => (out.includes(text) ? resolve() : Date.now() - t0 > 15000 ? reject(new Error(out)) : setTimeout(tick, 100));
    tick();
  });
  return { child, exited, wait, output: () => out };
}

async function healthy(port) {
  try { return (await request(port, { path: '/api/health' })).json?.app === 'my-app-launcher'; } catch { return false; }
}

test('launch.sh: 서버를 뒤에서 띄우고 창은 끝남 → 두 번째는 브라우저만 → 종료 버튼으로 서버 꺼짐', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-launch-'));
  const port = 41000 + Math.floor(Math.random() * 8000);
  const env = { MY_APP_LAUNCHER_HOME: home, MY_APP_LAUNCHER_PORT: String(port), MY_APP_LAUNCHER_WEB_PORT: String(port + 1) };
  const first = run(env);
  assert.equal(await first.exited, 0, first.output());
  assert.match(first.output(), /브라우저를 엽니다/);
  assert.equal(await healthy(port), true); // 창(스크립트)이 끝나도 서버는 살아 있음
  try {
    const second = run(env);
    assert.equal(await second.exited, 0);
    assert.match(second.output(), /이미 실행 중/);
  } finally {
    const page = await request(port, { path: '/' });
    const token = /content="([0-9a-f]{48})"/.exec(page.text)[1];
    await request(port, { method: 'POST', path: '/api/shutdown', headers: { origin: `http://127.0.0.1:${port}`, 'x-launcher-token': token } });
  }
  for (let i = 0; i < 30 && await healthy(port); i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(await healthy(port), false);
});

test('launch.sh: 서버가 못 뜨면 로그를 보여 주고 실패로 끝남', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-launch-'));
  const port = 41000 + Math.floor(Math.random() * 8000);
  const r = run({ MY_APP_LAUNCHER_HOME: home, MY_APP_LAUNCHER_PORT: String(port), WSL_DISTRO_NAME: '' });
  assert.equal(await r.exited, 1);
  assert.match(r.output(), /서버를 띄우지 못했어요/);
  assert.match(r.output(), /WSL 안에서 실행/);
});
