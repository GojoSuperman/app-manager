import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { decodeDataUrl, saveThumbnail, captureUrl, buildCaptureScript, captureThumbnail, probeUrl } from '../server/thumbs.js';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-thumbs-'));
  const store = createStore(home);
  const { app } = store.add({ name: 'web', launch: { type: 'url', url: 'https://example.com' } });
  return { store, app };
}

test('decodeDataUrl: 형식·크기 검사', () => {
  const ok = decodeDataUrl(`data:image/png;base64,${PNG.toString('base64')}`);
  assert.equal(ok.ext, 'png');
  assert.deepEqual(ok.buf, PNG);
  assert.equal(decodeDataUrl('data:image/jpeg;base64,AAAA').ext, 'jpg');
  assert.equal(decodeDataUrl('data:image/svg+xml;base64,AAAA').ok, false);
  assert.equal(decodeDataUrl('hello').ok, false);
  const big = `data:image/png;base64,${Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64')}`;
  assert.match(decodeDataUrl(big).error, /5MB/);
});

test('saveThumbnail: 파일 쓰고 다른 확장자 판 지움', () => {
  const { store, app } = setup();
  saveThumbnail(store, app.id, PNG, 'jpg');
  const rel = saveThumbnail(store, app.id, PNG, 'png');
  assert.equal(rel, `thumbs/${app.id}.png`);
  assert.deepEqual(fs.readdirSync(store.paths.thumbs), [`${app.id}.png`]);
  assert.equal(store.get(app.id).thumbnail, rel);
});

test('captureUrl: 웹·로컬 웹만', () => {
  const base = 'http://127.0.0.1:4791';
  assert.equal(captureUrl({ id: 'a', launch: { type: 'url', url: 'https://x.dev' } }, base), 'https://x.dev');
  assert.equal(captureUrl({ id: 'a', launch: { type: 'local-web', dir: '/home/me/d', entry: 'index.html' } }, base), `${base}/a/index.html`);
  assert.equal(captureUrl({ id: 'a', launch: { type: 'windows', file: 'x.exe', args: [] } }, base), null);
  assert.equal(captureUrl({ id: 'a', launch: { type: 'url', url: '' } }, base), null);
  assert.equal(captureUrl({ id: 'a', launch: { type: 'chrome-app', appId: 'a'.repeat(32), url: 'https://c.dev' } }, base), 'https://c.dev');
  assert.equal(captureUrl({ id: 'a', launch: { type: 'chrome-app', appId: 'a'.repeat(32) } }, base), null);
  // 기본 실행이 캡처할 수 없으면 추가 실행 중 캡처할 수 있는 것
  assert.equal(captureUrl({ id: 'a', launch: { type: 'windows', file: 'x.exe', args: [] }, moreLaunches: [{ label: '웹', launch: { type: 'url', url: 'https://w.dev' } }] }, base), 'https://w.dev');
});

test('buildCaptureScript: 헤드리스 옵션·시간 제한·출력', () => {
  const s = buildCaptureScript({ chromeDir: 'C:\\Chrome', url: 'https://x.dev/?a=1&b=2', id: 'web-0001' });
  assert.ok(s.includes("$out = Join-Path $env:TEMP 'my-app-launcher-web-0001.png'"));
  assert.ok(s.includes("-FilePath 'C:\\Chrome\\chrome.exe'"));
  assert.ok(s.includes('--headless --disable-gpu --hide-scrollbars --window-size=1280,800'));
  assert.ok(s.includes('https://x.dev/?a=1&b=2'));
  assert.ok(s.includes('WaitForExit(15000)'));
  assert.ok(s.includes('Write-Output $out'));
});

test('captureThumbnail: 성공하면 Windows 임시 파일을 읽어 저장', async () => {
  const { store, app } = setup();
  let script;
  const r = await captureThumbnail({
    app, store, chromeDir: 'C:\\Chrome', localWebBase: 'http://127.0.0.1:4791',
    probe: async () => ({ ok: true }),
    runPs: async (s) => { script = s; return { ok: true, stdout: 'C:\\Users\\me\\AppData\\Local\\Temp\\x.png\r\n' }; },
    readFile: (p) => { assert.equal(p, '/mnt/c/Users/me/AppData/Local/Temp/x.png'); return PNG; },
  });
  assert.deepEqual(r, { ok: true, thumbnail: `thumbs/${app.id}.png` });
  assert.match(script, /--screenshot=/);
});

test('captureThumbnail: 대상 아님·크롬 없음·실패', async () => {
  const { store, app } = setup();
  const base = { store, localWebBase: 'http://127.0.0.1:4791', probe: async () => ({ ok: true }) };
  const notWeb = { ...app, launch: { type: 'wsl', command: 'x', cwd: null, window: 'hidden' } };
  assert.match((await captureThumbnail({ ...base, app: notWeb, chromeDir: 'C:\\C', runPs: async () => ({ ok: true }) })).error, /캡처용 주소|이미지를 올리거나/);
  assert.match((await captureThumbnail({ ...base, app, chromeDir: null, runPs: async () => ({ ok: true }) })).error, /크롬/);
  assert.deepEqual(await captureThumbnail({ ...base, app, chromeDir: 'C:\\C', runPs: async () => ({ ok: false, error: '캡처 시간 초과(15초)' }) }),
    { ok: false, error: '캡처 시간 초과(15초)' });
  assert.equal(store.get(app.id).thumbnail, null); // 실패하면 기본 그림 유지
});

test('captureThumbnail: 사이트가 죽어 있으면 찍지 않는다 (오류 화면이 썸네일로 저장되는 것 방지)', async () => {
  const { store, app } = setup();
  let ran = false;
  const r = await captureThumbnail({
    app, store, chromeDir: 'C:\\C', localWebBase: 'http://127.0.0.1:4791',
    probe: async (url) => { assert.equal(url, 'https://example.com'); return { ok: false, error: '사이트가 응답하지 않아요 (HTTP 404)' }; },
    runPs: async () => { ran = true; return { ok: true, stdout: '' }; },
  });
  assert.deepEqual(r, { ok: false, error: '사이트가 응답하지 않아요 (HTTP 404)' });
  assert.equal(ran, false);
});

test('probeUrl: 404·410·5xx·연결 실패만 죽은 것으로 본다 (403은 봇 차단일 수 있어 통과)', async () => {
  const f = (status) => async () => ({ status });
  assert.deepEqual(await probeUrl('https://x', f(200)), { ok: true });
  assert.deepEqual(await probeUrl('https://x', f(403)), { ok: true });
  assert.deepEqual(await probeUrl('https://x', f(404)), { ok: false, error: '사이트가 응답하지 않아요 (HTTP 404)' });
  assert.deepEqual(await probeUrl('https://x', f(502)), { ok: false, error: '사이트가 응답하지 않아요 (HTTP 502)' });
  const down = await probeUrl('https://x', async () => { throw new Error('getaddrinfo ENOTFOUND x'); });
  assert.deepEqual(down, { ok: false, error: '사이트에 연결하지 못했어요 (getaddrinfo ENOTFOUND x)' });
});
