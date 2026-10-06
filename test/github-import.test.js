import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listRepos, buildCandidates, cardFromRepo } from '../server/github-import.js';

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
  assert.equal(by.old.archived, true);
});

test('cardFromRepo: 웹사이트 있으면 웹 주소 카드, 없으면 확인 필요 카드, 폴더 있으면 원본 폴더', () => {
  assert.deepEqual(cardFromRepo({ name: 'site', description: '내 사이트', homepageUrl: 'https://site.dev', localDir: '/p/site' }),
    { name: 'site', description: '내 사이트', category: '', sourceDir: '/p/site', launch: { type: 'url', url: 'https://site.dev' }, needsReview: false });
  assert.deepEqual(cardFromRepo({ name: 'tool', description: '', homepageUrl: '', localDir: null }),
    { name: 'tool', description: '', category: '', sourceDir: null, launch: { type: 'url', url: '' }, needsReview: true });
});
