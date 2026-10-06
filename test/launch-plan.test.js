import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLaunchPlan, buildOpenFolderPlan, wrapPs, encodePs, toWslUnc, localWebUrl,
} from '../server/launch-plan.js';

const ctx = { distro: 'Ubuntu', chromeDir: 'C:\\Program Files\\Google\\Chrome\\Application', localWebBase: 'http://127.0.0.1:4791' };
const plan = (launch, c = ctx) => buildLaunchPlan({ id: 'demo-0001', launch }, c);

test('encodePs: UTF-16LE Base64', () => {
  assert.equal(Buffer.from(encodePs('한글 ok'), 'base64').toString('utf16le'), '한글 ok');
});

test('wrapPs: 오류를 평문 stderr로, 진행 표시 끔', () => {
  const s = wrapPs('Start-Process x');
  assert.match(s, /\$ErrorActionPreference='Stop'/);
  assert.match(s, /\$ProgressPreference='SilentlyContinue'/);
  assert.match(s, /try \{\nStart-Process x\n\} catch \{ \[Console\]::Error\.WriteLine\(\$_\.Exception\.Message\); exit 1 \}/);
});

test('url', () => {
  const p = plan({ type: 'url', url: "https://example.com/?q=it's" });
  assert.equal(p.kind, 'powershell');
  assert.match(p.script, /Start-Process -FilePath 'https:\/\/example\.com\/\?q=it''s'/);
});

test('chrome-app: chrome_proxy + 프로필 + 앱 ID', () => {
  const p = plan({ type: 'chrome-app', appId: 'a'.repeat(32), profile: 'Profile 1' });
  assert.ok(p.script.includes("-FilePath 'C:\\Program Files\\Google\\Chrome\\Application\\chrome_proxy.exe'"));
  assert.ok(p.script.includes(`-ArgumentList '"--profile-directory=Profile 1" --app-id=${'a'.repeat(32)}'`));
});

test('chrome-app: 크롬 못 찾으면 안내', () => {
  const p = plan({ type: 'chrome-app', appId: 'a'.repeat(32), profile: 'Default' }, { ...ctx, chromeDir: null });
  assert.equal(p.kind, 'error');
  assert.match(p.error, /chromeDir/);
});

test('windows: 파일 존재 검사 + 파일 폴더에서 실행 + 인자 한 문자열', () => {
  const p = plan({ type: 'windows', file: 'C:\\Users\\me\\Godot\\godot.exe', args: ['--path', '\\\\wsl.localhost\\Ubuntu\\home\\me\\내 게임'], cwd: null });
  assert.ok(p.script.includes("if (-not (Test-Path -LiteralPath 'C:\\Users\\me\\Godot\\godot.exe')) { [Console]::Error.WriteLine('파일이 없습니다: C:\\Users\\me\\Godot\\godot.exe'); exit 2 }"));
  assert.ok(p.script.includes("Start-Process -FilePath 'C:\\Users\\me\\Godot\\godot.exe' -ArgumentList '--path \"\\\\wsl.localhost\\Ubuntu\\home\\me\\내 게임\"' -WorkingDirectory 'C:\\Users\\me\\Godot'"));
});

test('windows: .vbs는 wscript, .ps1은 powershell -File, 지정한 cwd 우선', () => {
  const v = plan({ type: 'windows', file: 'C:\\Users\\me\\app\\start.vbs', args: [], cwd: null });
  assert.ok(v.script.includes("Start-Process -FilePath 'wscript.exe' -ArgumentList 'C:\\Users\\me\\app\\start.vbs' -WorkingDirectory 'C:\\Users\\me\\app'"));
  const s = plan({ type: 'windows', file: 'C:\\Users\\me\\도구\\launch.ps1', args: [], cwd: 'C:\\work' });
  assert.ok(s.script.includes("Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File C:\\Users\\me\\도구\\launch.ps1' -WorkingDirectory 'C:\\work'"));
});

test('windows: PATH의 프로그램 이름은 존재 검사 안 함', () => {
  const p = plan({ type: 'windows', file: 'notepad.exe', args: [], cwd: null });
  assert.ok(!p.script.includes('Test-Path'));
  assert.ok(!p.script.includes('-WorkingDirectory'));
});

test('wsl hidden → 런처가 직접 실행', () => {
  assert.deepEqual(plan({ type: 'wsl', command: 'npm start', cwd: '/home/me/p', window: 'hidden' }),
    { kind: 'wsl', command: 'npm start', cwd: '/home/me/p' });
});

test('wsl new → 새 창 wsl.exe -e (바깥 셸 재해석 없음)', () => {
  const p = plan({ type: 'wsl', command: '/home/me/office/start.sh', cwd: null, window: 'new' });
  assert.ok(p.script.includes("Start-Process -FilePath 'wsl.exe' -ArgumentList '-d Ubuntu --cd ~ -e bash -lic /home/me/office/start.sh'"));
});

test('local-web → 4791 주소 열기 (한글 시작 페이지 인코딩)', () => {
  assert.equal(localWebUrl('http://127.0.0.1:4791', 'demo-0001', 'sub/첫 화면.html'),
    'http://127.0.0.1:4791/demo-0001/sub/%EC%B2%AB%20%ED%99%94%EB%A9%B4.html');
  const p = plan({ type: 'local-web', dir: '/home/me/demo', entry: 'index.html' });
  assert.ok(p.script.includes("Start-Process -FilePath 'http://127.0.0.1:4791/demo-0001/index.html'"));
});

test('빈 값(needsReview)은 실행하지 않고 안내', () => {
  for (const launch of [
    { type: 'url', url: '' },
    { type: 'chrome-app', appId: '', profile: 'Default' },
    { type: 'windows', file: '', args: [], cwd: null },
    { type: 'wsl', command: '', cwd: null, window: 'hidden' },
    { type: 'local-web', dir: '', entry: 'index.html' },
  ]) {
    const p = plan(launch);
    assert.equal(p.kind, 'error', launch.type);
    assert.match(p.error, /✏ 수정에서 채워 주세요$/);
  }
});

test('원본 폴더 열기: 탐색기 + \\\\wsl.localhost 경로', () => {
  assert.equal(toWslUnc('/home/me/p', 'Ubuntu'), '\\\\wsl.localhost\\Ubuntu\\home\\me\\p');
  const p = buildOpenFolderPlan('/home/me/내 프로젝트', ctx);
  assert.ok(p.script.includes("Start-Process -FilePath 'explorer.exe' -ArgumentList '\"\\\\wsl.localhost\\Ubuntu\\home\\me\\내 프로젝트\"'"));
  assert.equal(buildOpenFolderPlan(null, ctx).kind, 'error');
});


test('파일 열기: 탐색기로 기본 프로그램 실행, 없으면 알림, WSL 경로는 \\\\wsl.localhost로', () => {
  const w = plan({ type: 'file', path: 'C:\\Users\\me\\바다, 여행.mp4' });
  assert.ok(w.script.includes(`Test-Path -LiteralPath 'C:\\Users\\me\\바다, 여행.mp4'`));
  assert.ok(w.script.includes(`Start-Process -FilePath 'explorer.exe' -ArgumentList '"C:\\Users\\me\\바다, 여행.mp4"'`));
  const l = plan({ type: 'file', path: '/home/me/p/out.mp4' });
  assert.ok(l.script.includes('\\\\wsl.localhost\\Ubuntu\\home\\me\\p\\out.mp4'));
});
