#!/usr/bin/env node
// 화면 실측용 스크린샷: node scripts/screenshot.mjs <주소> <저장할 png>
// 썸네일 캡처와 같은 헤드리스 크롬(1280×800)을 쓴다.
import fs from 'node:fs';
import { buildCaptureScript } from '../server/thumbs.js';
import { runPowershell, detectChromeDir, winToWsl } from '../server/launcher.js';
import { readConfig, dataHome } from '../server/paths.js';

const [url, out] = process.argv.slice(2);
if (!url || !out) {
  console.error('사용: node scripts/screenshot.mjs <주소> <저장할 png>');
  process.exit(1);
}
const chromeDir = detectChromeDir(readConfig(dataHome()));
if (!chromeDir) {
  console.error('크롬을 찾지 못했어요');
  process.exit(1);
}
const r = await runPowershell(buildCaptureScript({ chromeDir, url, id: 'screenshot' }), { timeoutMs: 30000 });
if (!r.ok) {
  console.error(r.error);
  process.exit(1);
}
fs.copyFileSync(winToWsl(r.stdout.trim()), out);
console.log(out);
