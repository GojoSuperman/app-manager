import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.join(import.meta.dirname, '..');

test('setup.sh: config.json·스킬 설치, 기존 설정 유지, 터미널 아니면 가져오기 건너뜀', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-setup-'));
  const home = path.join(tmp, 'data');
  const claude = path.join(tmp, 'claude');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ chromeDir: 'D:\\Chrome' }));
  const r = spawnSync('bash', [path.join(ROOT, 'scripts', 'setup.sh')], {
    env: { ...process.env, MY_APP_LAUNCHER_HOME: home, CLAUDE_CONFIG_DIR: claude, SKIP_NPM: '1', SKIP_SHORTCUT: '1' },
    input: '', encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')), { chromeDir: 'D:\\Chrome', launcherDir: ROOT });
  assert.equal(fs.readFileSync(path.join(claude, 'skills', 'register-to-launcher', 'SKILL.md'), 'utf8'),
    fs.readFileSync(path.join(ROOT, 'skill', 'register-to-launcher', 'SKILL.md'), 'utf8'));
  for (const d of ['thumbs', 'logs', 'trash']) assert.ok(fs.existsSync(path.join(home, d)));
  // 바로가기 가져오기는 사설판에만 있다 — 스크립트가 있을 때만 안내, 없으면(공개판) 그 단계를 건너뜀
  if (fs.existsSync(path.join(ROOT, 'scripts', 'import-shortcuts.mjs'))) assert.match(r.stdout, /import-shortcuts\.mjs --dry-run/);
  else assert.doesNotMatch(r.stdout, /바로가기 가져오기/);
});

test('setup.sh: SKIP_SKILL=1이면 스킬을 설치하지 않음', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-setup-'));
  const claude = path.join(tmp, 'claude');
  const r = spawnSync('bash', [path.join(ROOT, 'scripts', 'setup.sh')], {
    env: { ...process.env, MY_APP_LAUNCHER_HOME: path.join(tmp, 'data'), CLAUDE_CONFIG_DIR: claude, SKIP_NPM: '1', SKIP_SHORTCUT: '1', SKIP_SKILL: '1' },
    input: '', encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.existsSync(path.join(claude, 'skills', 'register-to-launcher')), false);
  assert.match(r.stdout, /스킬 설치 건너뜀/);
});
