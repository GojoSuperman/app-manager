import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listDir, toWinPath, browseRoots } from '../server/browse.js';

test('listDir: 폴더 먼저·이름순, 숨김 제외, 파일 크기, 상위 폴더', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-br-'));
  fs.mkdirSync(path.join(d, 'b 폴더'));
  fs.mkdirSync(path.join(d, '.git'));
  fs.writeFileSync(path.join(d, '완성.mp4'), 'xxxx');
  fs.writeFileSync(path.join(d, 'a.txt'), '');
  fs.writeFileSync(path.join(d, '.env'), '');
  const r = await listDir(d);
  assert.equal(r.ok, true);
  assert.equal(r.path, d);
  assert.equal(r.parent, path.dirname(d));
  assert.deepEqual(r.entries.map((e) => [e.name, e.dir]), [['b 폴더', true], ['완성.mp4', false], ['a.txt', false]]); // 한국어 정렬: 한글 먼저
  assert.equal(r.entries.find((e) => e.name === '완성.mp4').size, 4);
  assert.equal((await listDir('/')).parent, null);
});

test('listDir: 없는 폴더·상대 경로는 오류', async () => {
  assert.equal((await listDir('/no/such/dir')).ok, false);
  assert.equal((await listDir('relative')).ok, false);
});

test('listDir: WSL로 못 읽는 Windows 폴더(EIO 등)는 Windows로 대신 읽기', async () => {
  let asked;
  const winList = async (p) => { asked = p; return [{ name: '공모전', dir: true, size: null }, { name: 'a.mp4', dir: false, size: 5 }, { name: '.x', dir: false, size: 1 }]; };
  const r = await listDir('/mnt/z/no-such-for-test/Downloads', { winList });
  assert.equal(asked, 'Z:\\no-such-for-test\\Downloads');
  assert.deepEqual(r.entries.map((e) => e.name), ['공모전', 'a.mp4']);
  // /mnt 밖은 대신 읽지 않는다
  assert.equal((await listDir('/no/such', { winList })).ok, false);
});

test('toWinPath: /mnt/<드라이브>/… 는 Windows 경로로, 나머지는 그대로', () => {
  assert.equal(toWinPath('/mnt/c/Users/me/Downloads/영상 1.mp4'), 'C:\\Users\\me\\Downloads\\영상 1.mp4');
  assert.equal(toWinPath('/mnt/d'), 'D:\\');
  assert.equal(toWinPath('/home/me/p/out.mp4'), '/home/me/p/out.mp4');
});

test('browseRoots: 프로젝트 폴더·~/projects·Windows 다운로드·바탕화면(OneDrive 우선)·문서 중 있는 것만', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-home-'));
  const users = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-users-'));
  for (const p of ['projects/a', 'x']) fs.mkdirSync(path.join(home, p), { recursive: true });
  for (const p of ['me/Downloads', 'me/OneDrive/Desktop', 'me/Documents', 'Public/Downloads', 'Default/Downloads']) fs.mkdirSync(path.join(users, p), { recursive: true });
  const roots = browseRoots({ project: path.join(home, 'projects/a'), projectsRoot: path.join(home, 'projects'), usersDir: users });
  assert.deepEqual(roots.map((r) => r.label), ['이 프로젝트', '~/projects', '다운로드', '바탕화면', '문서']);
  assert.equal(roots[3].path, path.join(users, 'me/OneDrive/Desktop'));
  assert.deepEqual(browseRoots({ project: null, projectsRoot: '/no/such', usersDir: '/no/such' }), []);
});
