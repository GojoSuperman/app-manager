import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolvePowershell, winToWsl, detectChromeDir, runPowershell, runWslHidden, createLauncher } from '../server/launcher.js';

const decode = (args) => Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');

test('resolvePowershell: PATH 우선, 없으면 System32', () => {
  assert.equal(resolvePowershell({ PATH: '/x:/w' }, (p) => p === '/w/powershell.exe'), '/w/powershell.exe');
  assert.equal(resolvePowershell({ PATH: '' }, () => false), '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe');
});

test('winToWsl', () => {
  assert.equal(winToWsl('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'),
    '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe');
});

test('detectChromeDir: 설정 우선 → 표준 경로 → 없음', () => {
  assert.equal(detectChromeDir({ chromeDir: 'D:\\Chrome' }, () => false), 'D:\\Chrome');
  assert.equal(detectChromeDir({}, (p) => p.includes('(x86)')), 'C:\\Program Files (x86)\\Google\\Chrome\\Application');
  assert.equal(detectChromeDir({}, () => false), null);
});

test('runPowershell: 인자와 인코딩', async () => {
  let call;
  const execFileFn = (file, args, opts, cb) => { call = { file, args, opts }; cb(null, '출력\r\n', ''); };
  const r = await runPowershell("Write-Output '한글'", { execFileFn, psPath: 'ps.exe' });
  assert.deepEqual(r, { ok: true, stdout: '출력\r\n' });
  assert.equal(call.file, 'ps.exe');
  assert.deepEqual(call.args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand']);
  assert.equal(decode(call.args), "Write-Output '한글'");
  assert.equal(call.opts.cwd, '/mnt/c');
});

test('runPowershell: 오류 문구 = stderr 마지막 줄, 연동 꺼짐, 시간 초과', async () => {
  const fail = (e, stderr) => (f, a, o, cb) => cb(Object.assign(new Error('x'), e), '', stderr);
  assert.deepEqual(await runPowershell('x', { execFileFn: fail({ code: 2 }, '\r\n파일이 없습니다: C:\\a.exe\r\n'), psPath: 'p' }),
    { ok: false, error: '파일이 없습니다: C:\\a.exe' });
  assert.match((await runPowershell('x', { execFileFn: fail({ code: 'ENOENT' }, ''), psPath: 'p' })).error, /Windows 연동/);
  assert.match((await runPowershell('x', { execFileFn: fail({ killed: true }, ''), psPath: 'p', timeoutMs: 5000 })).error, /시간 초과\(5초\)/);
});

test('runWslHidden: 곧바로 실패하면 오류, 오래 돌면 성공', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-wsl-'));
  const logFile = path.join(dir, 'logs', 'wsl-x.log');
  const bad = await runWslHidden('echo 망함 >&2; exit 3', dir, { logFile, settleMs: 5000 });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /종료 코드 3/);
  assert.match(fs.readFileSync(logFile, 'utf8'), /망함/);
  assert.deepEqual(await runWslHidden('sleep 2', dir, { logFile, settleMs: 100 }), { ok: true });
  assert.match((await runWslHidden('true', '/없는/폴더', { logFile })).error, /작업 폴더가 없어요/);
});

function fakeLauncher() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-launcher-'));
  const calls = [];
  const launcher = createLauncher({
    home, config: {}, distro: 'Ubuntu', localWebBase: 'http://127.0.0.1:4791', existsSync: () => false,
    runPs: async (script) => { calls.push({ ps: script }); return { ok: true, stdout: 'C:\\Users\\me\\Desktop\\a.lnk\r\n' }; },
    runWsl: async (command, cwd, opts) => { calls.push({ wsl: command, cwd, logFile: opts.logFile }); return { ok: true }; },
  });
  return { home, calls, launcher };
}

test('createLauncher: 종류에 따라 PowerShell 또는 WSL', async () => {
  const { home, calls, launcher } = fakeLauncher();
  assert.deepEqual(await launcher.launch({ id: 'a', launch: { type: 'url', url: 'https://example.com' } }), { ok: true, stdout: 'C:\\Users\\me\\Desktop\\a.lnk\r\n' });
  assert.match(calls[0].ps, /Start-Process -FilePath 'https:\/\/example\.com'/);
  await launcher.launch({ id: 'b', launch: { type: 'wsl', command: 'npm start', cwd: '/home/me/p', window: 'hidden' } });
  assert.deepEqual(calls[1], { wsl: 'npm start', cwd: '/home/me/p', logFile: path.join(home, 'logs', 'wsl-b.log') });
  const log = fs.readFileSync(path.join(home, 'logs', 'launcher.log'), 'utf8');
  assert.match(log, /실행 a 성공/);
});

test('createLauncher: 빈 실행 정보는 명령을 부르지 않고 실패 + 로그', async () => {
  const { home, calls, launcher } = fakeLauncher();
  const r = await launcher.launch({ id: 'c', launch: { type: 'url', url: '' } });
  assert.equal(r.ok, false);
  assert.equal(calls.length, 0);
  assert.match(fs.readFileSync(path.join(home, 'logs', 'launcher.log'), 'utf8'), /실행 c 실패: 웹 주소가 비어/);
});

test('createLauncher: 원본 폴더 열기', async () => {
  const { calls, launcher } = fakeLauncher();
  await launcher.openFolder({ id: 'a', sourceDir: '/home/me/p' });
  assert.match(calls[0].ps, /explorer\.exe/);
  assert.equal((await launcher.openFolder({ id: 'a', sourceDir: null })).ok, false);
});

test('createLauncher: echo로 실행 기록을 콘솔에도 흘림', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-echo-'));
  const lines = [];
  const launcher = createLauncher({
    home, config: {}, distro: 'Ubuntu', localWebBase: 'http://127.0.0.1:4791', existsSync: () => false,
    runPs: async () => ({ ok: true, stdout: '' }), runWsl: async () => ({ ok: true }), echo: (l) => lines.push(l),
  });
  await launcher.launch({ id: 'a', launch: { type: 'url', url: 'https://example.com' } });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /실행 a 성공/);
});
