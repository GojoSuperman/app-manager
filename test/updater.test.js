import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyPullError, checkUpdate, runUpdate } from '../server/updater.js';

const repo = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-upd-')); fs.mkdirSync(path.join(d, '.git')); return d; };
// 명령별 가짜 응답 — 부른 순서도 기록
function fake(map) {
  const calls = [];
  const run = async (cmd, args) => {
    const key = `${cmd} ${args.join(' ')}`;
    calls.push(key);
    const hit = Object.entries(map).find(([k]) => key.startsWith(k));
    return hit ? hit[1] : { ok: true, stdout: '' };
  };
  return { run, calls };
}

test('classifyPullError: 로컬 변경·갈라진 기록·네트워크', () => {
  assert.equal(classifyPullError('error: Your local changes to the following files would be overwritten by merge'), 'local-changes');
  assert.equal(classifyPullError('fatal: Not possible to fast-forward, aborting.'), 'diverged');
  assert.equal(classifyPullError('fatal: unable to access \'https://github.com/x/\': Could not resolve host'), 'network');
  assert.equal(classifyPullError('뭔가 다른 오류'), null);
});

test('checkUpdate: fetch 후 받을 커밋 수와 목록, git 폴더가 아니면 안내', async () => {
  const dir = repo();
  const { run, calls } = fake({
    'git rev-list --count HEAD..@{u}': { ok: true, stdout: '2\n' },
    'git log': { ok: true, stdout: 'a1b2c3d 새 기능\ne4f5a6b 버그 수정\n' },
  });
  assert.deepEqual(await checkUpdate(dir, { run }), { ok: true, behind: 2, commits: ['a1b2c3d 새 기능', 'e4f5a6b 버그 수정'] });
  assert.match(calls[0], /^git fetch/);
  const nogit = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-nogit-'));
  assert.equal((await checkUpdate(nogit, { run })).code, 'no-git');
  const net = fake({ 'git fetch': { ok: false, stderr: 'Could not resolve host: github.com' } });
  assert.equal((await checkUpdate(dir, { run: net.run })).code, 'network');
  const noUp = fake({ 'git rev-list': { ok: false, stderr: 'fatal: no upstream configured for branch' } });
  assert.equal((await checkUpdate(dir, { run: noUp.run })).code, 'no-upstream');
});

test('runUpdate: 받을 게 없으면 아무것도 안 함, 있으면 pull --ff-only → npm install, 실패 단계 알려 줌', async () => {
  const dir = repo();
  const none = fake({ 'git rev-list': { ok: true, stdout: '0\n' } });
  assert.deepEqual(await runUpdate(dir, { run: none.run }), { ok: true, changed: false });
  assert.ok(!none.calls.some((c) => c.startsWith('git pull')));

  const ok = fake({ 'git rev-list': { ok: true, stdout: '1\n' }, 'git log': { ok: true, stdout: 'a1 x\n' } });
  assert.deepEqual(await runUpdate(dir, { run: ok.run }), { ok: true, changed: true, behind: 1 });
  assert.ok(ok.calls.includes('git pull --ff-only'));
  assert.ok(ok.calls.some((c) => c.startsWith('npm install')));

  const local = fake({ 'git rev-list': { ok: true, stdout: '1\n' }, 'git pull': { ok: false, stderr: 'Your local changes would be overwritten' } });
  assert.deepEqual(await runUpdate(dir, { run: local.run }), { ok: false, step: 'pull', code: 'local-changes', error: 'Your local changes would be overwritten' });
  assert.ok(!local.calls.some((c) => c.startsWith('npm')));

  const npm = fake({ 'git rev-list': { ok: true, stdout: '1\n' }, 'npm install': { ok: false, stderr: 'ERR network' } });
  assert.equal((await runUpdate(dir, { run: npm.run })).step, 'npm');
});
