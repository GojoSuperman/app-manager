#!/usr/bin/env node
// 바탕화면에 "앱 관리 프로젝트" 아이콘(.lnk)을 만든다. 같은 이름이 있으면 덮어쓴다.
import path from 'node:path';
import { psQuote, joinWinArgs } from '../server/wincmd.js';
import { wrapPs } from '../server/launch-plan.js';
import { runPowershell } from '../server/launcher.js';

export function buildLauncherShortcutScript({ distro, projDir, name = '앱 관리 프로젝트' }) {
  const args = joinWinArgs(['-d', distro, '--cd', projDir, '--', 'bash', '-lic', 'bash scripts/launch.sh']);
  return wrapPs([
    "$d = [Environment]::GetFolderPath('Desktop')",
    `$p = Join-Path $d ${psQuote(`${name}.lnk`)}`,
    '$s = (New-Object -ComObject WScript.Shell).CreateShortcut($p)',
    "$s.TargetPath = Join-Path $env:SystemRoot 'System32\\wsl.exe'",
    `$s.Arguments = ${psQuote(args)}`,
    '$s.WindowStyle = 7',
    "$s.Description = '앱 관리 프로젝트 열기'",
    '$s.Save()',
    'Write-Output $p',
  ].join('\n'));
}

if (import.meta.filename === process.argv[1]) {
  const distro = process.env.WSL_DISTRO_NAME;
  if (!distro) {
    console.error('오류: WSL_DISTRO_NAME이 비어 있어요. WSL 안에서 실행해 주세요');
    process.exit(1);
  }
  const r = await runPowershell(buildLauncherShortcutScript({ distro, projDir: path.resolve(import.meta.dirname, '..') }));
  if (!r.ok) {
    console.error(`바탕화면 아이콘을 만들지 못했어요: ${r.error}`);
    process.exit(1);
  }
  console.log(`바탕화면 아이콘을 만들었어요: ${r.stdout.trim()}`);
}
