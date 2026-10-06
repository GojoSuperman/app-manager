import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listRepos, buildCandidates, cardFromRepo, guessLaunch } from '../server/github-import.js';

const repo = (name, extra = {}) => ({ name, description: '', homepageUrl: '', isPrivate: false, isFork: false, isArchived: false, url: `https://github.com/me/${name}`, ...extra });

test('listRepos: gh repo list JSON을 읽음, gh 없음·로그인 안 됨은 안내', async () => {
  let args;
  const ok = await listRepos({ run: async (a) => { args = a; return { ok: true, stdout: JSON.stringify([repo('a')]) }; } });
  assert.equal(ok.ok, true);
  assert.equal(ok.repos[0].name, 'a');
  assert.deepEqual(args.slice(0, 2), ['repo', 'list']);
  assert.ok(args.includes('--json'));
  assert.match((await listRepos({ run: async () => ({ ok: false, code: 'ENOENT' }) })).error, /gh.*설치/);
  assert.match((await listRepos({ run: async () => ({ ok: false, stderr: 'To get started with GitHub CLI, please run:  gh auth login' }) })).error, /gh auth login/);
});

test('buildCandidates: 내려받은 폴더(이름 또는 origin 주소로)·이미 카드 있음·웹사이트 주소, 웹사이트 있고 카드 없으면 미리 체크', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-gh-'));
  fs.mkdirSync(path.join(root, 'site', '.git'), { recursive: true });
  fs.mkdirSync(path.join(root, 'renamed-folder', '.git'), { recursive: true });
  fs.writeFileSync(path.join(root, 'renamed-folder', '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/me/tool.git\n');
  const repos = [
    repo('site', { homepageUrl: 'https://site.dev', description: '내 사이트' }),
    repo('tool'),
    repo('done', { homepageUrl: 'https://done.dev' }),
    repo('old', { isArchived: true }),
  ];
  const apps = [{ name: '이미', sourceDir: null, launch: { type: 'url', url: 'https://done.dev' } }];
  const c = buildCandidates(repos, { projectsRoot: root, apps });
  const by = Object.fromEntries(c.map((x) => [x.name, x]));
  assert.equal(by.site.localDir, path.join(root, 'site'));
  assert.equal(by.tool.localDir, path.join(root, 'renamed-folder'));
  assert.equal(by.done.card, '이미');
  assert.deepEqual([by.site.checked, by.tool.checked, by.done.checked, by.old.checked], [true, false, false, false]);
  assert.equal(by.tool.guess, null); // 폴더는 있지만 실행할 단서 없음
  assert.equal(by.old.archived, true);
});

test('cardFromRepo: 웹사이트 있으면 웹 주소 카드, 없으면 확인 필요 카드, 폴더 있으면 원본 폴더', () => {
  assert.deepEqual(cardFromRepo({ name: 'site', description: '내 사이트', homepageUrl: 'https://site.dev', localDir: '/p/site' }),
    { name: 'site', description: '내 사이트', category: '', sourceDir: '/p/site', launch: { type: 'url', url: 'https://site.dev' }, needsReview: false });
  assert.deepEqual(cardFromRepo({ name: 'tool', description: '', homepageUrl: '', localDir: null }),
    { name: 'tool', description: '', category: '', sourceDir: null, launch: { type: 'url', url: '' }, needsReview: true });
});

const mk = (files) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-guess-'));
  for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), c); }
  return d;
};

test('guessLaunch: README 배포 주소 > package.json homepage > npm start/dev > 정적 index.html, 못 정하면 null', () => {
  const a = mk({ 'README.md': '# 앱\n데모: https://my-app.vercel.app/ 그리고 https://github.com/x/y', 'package.json': '{"scripts":{"dev":"vite"}}' });
  assert.deepEqual(guessLaunch(a), {
    web: { launch: { type: 'url', url: 'https://my-app.vercel.app/' }, how: 'README의 배포 주소' },
    local: { launch: { type: 'wsl', command: 'npm run dev', cwd: a, window: 'new' }, how: 'npm run dev' },
  });
  const b = mk({ 'package.json': '{"homepage":"https://me.github.io/b","scripts":{"start":"node s.js","dev":"x"}}' });
  assert.deepEqual(guessLaunch(b).web.launch, { type: 'url', url: 'https://me.github.io/b' });
  assert.equal(guessLaunch(b).local.how, 'npm start');
  const c = mk({ 'public/index.html': '<h1>x</h1>' });
  assert.deepEqual(guessLaunch(c), { web: null, local: { launch: { type: 'local-web', dir: path.join(c, 'public'), entry: 'index.html' }, how: '정적 사이트 (public/index.html)' } });
  assert.equal(guessLaunch(mk({ 'project.godot': '' })), null);
  assert.equal(guessLaunch(mk({ 'README.md': '그냥 설명' })), null);
  assert.equal(guessLaunch(null), null);
});

test('cardFromRepo: 웹사이트 + 로컬 추측이면 배포판·로컬판 한 카드, 로컬 추측만 있으면 그것으로', () => {
  const local = { launch: { type: 'wsl', command: 'npm start', cwd: '/p/a', window: 'new' }, how: 'npm start' };
  assert.deepEqual(cardFromRepo({ name: 'a', description: '', homepageUrl: 'https://a.dev', localDir: '/p/a', guess: { web: null, local } }), {
    name: 'a', description: '', category: '', sourceDir: '/p/a', launch: { type: 'url', url: 'https://a.dev' }, needsReview: false,
    launchLabel: '배포판', moreLaunches: [{ label: '로컬판', launch: local.launch }],
  });
  assert.deepEqual(cardFromRepo({ name: 'b', description: '', homepageUrl: '', localDir: '/p/b', guess: { web: null, local } }), {
    name: 'b', description: '', category: '', sourceDir: '/p/b', launch: local.launch, needsReview: false,
  });
  // README에서 찾은 배포 주소는 웹사이트 주소처럼 쓴다
  const web = { launch: { type: 'url', url: 'https://c.vercel.app' }, how: 'README의 배포 주소' };
  assert.equal(cardFromRepo({ name: 'c', description: '', homepageUrl: '', localDir: '/p/c', guess: { web, local: null } }).launch.url, 'https://c.vercel.app');
});

test('buildCandidates: 같은 저장소를 가리키는 폴더가 여럿이면 이름이 같은 폴더 우선, 그중 하나라도 카드가 있으면 카드 있음', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-gh2-'));
  for (const d of ['map', 'map-chatbot']) {
    fs.mkdirSync(path.join(root, d, '.git'), { recursive: true });
    fs.writeFileSync(path.join(root, d, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/me/map\n');
  }
  const [c] = buildCandidates([repo('map')], { projectsRoot: root, apps: [{ name: '지도', sourceDir: path.join(root, 'map'), launch: { type: 'url', url: 'https://x' } }] });
  assert.deepEqual([c.localDir, c.card], [path.join(root, 'map'), '지도']);
  const [d] = buildCandidates([repo('map')], { projectsRoot: root, apps: [{ name: '챗봇', sourceDir: path.join(root, 'map-chatbot'), launch: { type: 'url', url: 'https://y' } }] });
  assert.equal(d.card, '챗봇');
});

test('guessLaunch: README 주소 끝의 굵은 글씨 표시·문장부호는 떼기', () => {
  const d = mk({ 'README.md': '**데모**: **https://me.github.io/hotel/viewer.html**. 끝' });
  assert.equal(guessLaunch(d).web.launch.url, 'https://me.github.io/hotel/viewer.html');
});
