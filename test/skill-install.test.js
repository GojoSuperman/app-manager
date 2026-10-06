import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listTargets, installSkill } from '../server/skill-install.js';

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-skill-'));
  const skillFile = path.join(home, 'SKILL.md');
  fs.writeFileSync(skillFile, '새 판');
  for (const d of ['.claude', '.claude-edu', '.claude-edu-backup-20260923', '.claude-mem', '.claudeX']) fs.mkdirSync(path.join(home, d));
  fs.mkdirSync(path.join(home, '.claude-edu', 'skills', 'register-to-launcher'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude-edu', 'skills', 'register-to-launcher', 'SKILL.md'), '옛 판');
  return { home, skillFile };
}

test('listTargets: ~/.claude와 ~/.claude-* 폴더, 상태(최신·옛 판·미설치), 백업·플러그인 데이터는 미리 체크 안 함', () => {
  const { home, skillFile } = setup();
  const t = listTargets({ home, env: {}, skillFile });
  assert.deepEqual(t.map((x) => [path.basename(x.dir), x.state, x.checked]), [
    ['.claude', 'missing', true],
    ['.claude-edu', 'outdated', true],
    ['.claude-edu-backup-20260923', 'missing', false],
    ['.claude-mem', 'missing', false],
  ]);
});

test('listTargets: CLAUDE_CONFIG_DIR가 다른 곳이면 맨 앞에 넣고 미리 체크', () => {
  const { home, skillFile } = setup();
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-cfg-'));
  const t = listTargets({ home, env: { CLAUDE_CONFIG_DIR: other }, skillFile });
  assert.deepEqual([t[0].dir, t[0].checked], [other, true]);
});

test('installSkill: 목록에 있는 폴더에만 복사(최신으로), 목록 밖 경로는 거부', () => {
  const { home, skillFile } = setup();
  const r = installSkill({ home, env: {}, skillFile, dirs: [path.join(home, '.claude'), path.join(home, '.claude-edu')] });
  assert.deepEqual(r, { ok: true, installed: [path.join(home, '.claude'), path.join(home, '.claude-edu')] });
  for (const d of ['.claude', '.claude-edu']) assert.equal(fs.readFileSync(path.join(home, d, 'skills', 'register-to-launcher', 'SKILL.md'), 'utf8'), '새 판');
  assert.equal(listTargets({ home, env: {}, skillFile }).find((x) => x.dir.endsWith('.claude')).state, 'current');
  assert.equal(installSkill({ home, env: {}, skillFile, dirs: ['/etc'] }).ok, false);
  assert.equal(installSkill({ home, env: {}, skillFile, dirs: [] }).ok, false);
});
