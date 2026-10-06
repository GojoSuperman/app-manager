import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLauncherShortcutScript } from '../scripts/install-shortcut.mjs';

test('런처 아이콘: wsl.exe로 launch.sh, 최소화 창, 공백 경로 따옴표', () => {
  const s = buildLauncherShortcutScript({ distro: 'Ubuntu', projDir: '/home/me/내 프로젝트/my-app-launcher' });
  assert.ok(s.includes("$p = Join-Path $d '앱 관리 프로젝트.lnk'"));
  assert.ok(s.includes("$s.TargetPath = Join-Path $env:SystemRoot 'System32\\wsl.exe'"));
  assert.ok(s.includes(`$s.Arguments = '-d Ubuntu --cd "/home/me/내 프로젝트/my-app-launcher" -- bash -lic "bash scripts/launch.sh"'`));
  assert.ok(s.includes('$s.WindowStyle = 7'));
});
