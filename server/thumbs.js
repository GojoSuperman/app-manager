// server/thumbs.js
// 썸네일: 화면에서 올린 이미지(dataURL) 저장, 웹·로컬 웹 앱은 Windows 크롬 헤드리스로 자동 캡처.
// 캡처 실패 시 썸네일은 그대로(null) → 화면이 이름 글자로 만든 기본 그림을 보여 준다.
import fs from 'node:fs';
import path from 'node:path';
import { psQuote, joinWinArgs, winQuoteArg } from './wincmd.js';
import { wrapPs, localWebUrl } from './launch-plan.js';
import { winToWsl } from './launcher.js';
import { allLaunches } from './app-schema.js';

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MAX_BYTES = 5 * 1024 * 1024;

export function decodeDataUrl(s) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(s));
  if (!m) return { ok: false, error: 'PNG·JPG·WEBP 이미지만 올릴 수 있어요' };
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_BYTES) return { ok: false, error: '이미지는 5MB 이하만 올릴 수 있어요' };
  return { ok: true, ext: EXT[m[1]], buf };
}

export function saveThumbnail(store, id, buf, ext) {
  for (const e of Object.values(EXT)) fs.rmSync(path.join(store.paths.thumbs, `${id}.${e}`), { force: true });
  fs.writeFileSync(path.join(store.paths.thumbs, `${id}.${ext}`), buf);
  const rel = `thumbs/${id}.${ext}`;
  store.setThumbnail(id, rel);
  return rel;
}

// 기본 실행부터 차례로, 캡처할 수 있는 실행의 주소
export function captureUrl(app, localWebBase) {
  for (const { launch } of allLaunches(app)) {
    const u = launchCaptureUrl(app, launch, localWebBase);
    if (u) return u;
  }
  return null;
}

function launchCaptureUrl(app, l, localWebBase) {
  if (l.type === 'url' || l.type === 'chrome-app') return l.url || null;
  if (l.type === 'local-web') return l.dir ? localWebUrl(localWebBase, app.id, l.entry || 'index.html') : null;
  return null;
}

// 찍기 전에 살아 있는지 확인 — 죽은 사이트는 크롬 오류 화면이 썸네일로 저장되기 때문.
// 무료 호스팅(Render 등)은 잠에서 깨는 데 수십 초 걸려 넉넉히 60초 기다린다 — 깨운 뒤 찍어야 로딩 화면이 안 찍힌다.
// 403 등은 봇 차단일 수 있어(브라우저로는 열림) 통과시키고, 404·410·5xx·연결 실패만 막는다.
export async function probeUrl(url, fetchFn = fetch) {
  try {
    const r = await fetchFn(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
    if (r.status === 404 || r.status === 410 || r.status >= 500) return { ok: false, error: `사이트가 응답하지 않아요 (HTTP ${r.status})` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `사이트에 연결하지 못했어요 (${e.cause?.code || e.message})` };
  }
}

export function buildCaptureScript({ chromeDir, url, id, timeoutMs = 15000 }) {
  // %TEMP% 경로는 PowerShell 안에서 정해지므로 그 부분만 문자열로 이어 붙인다 (TEMP 경로엔 따옴표가 없다)
  const head = joinWinArgs(['--headless', '--disable-gpu', '--hide-scrollbars', '--window-size=1280,800']);
  return wrapPs([
    `$out = Join-Path $env:TEMP ${psQuote(`my-app-launcher-${id}.png`)}`,
    "$prof = Join-Path $env:TEMP 'my-app-launcher-chrome'",
    'Remove-Item -LiteralPath $out -ErrorAction SilentlyContinue',
    `$a = ${psQuote(head)} + ' "--user-data-dir=' + $prof + '" "--screenshot=' + $out + '" ' + ${psQuote(winQuoteArg(url))}`,
    `$p = Start-Process -FilePath ${psQuote(`${chromeDir}\\chrome.exe`)} -ArgumentList $a -WindowStyle Hidden -PassThru`,
    `if (-not $p.WaitForExit(${timeoutMs})) { $p.Kill(); [Console]::Error.WriteLine('캡처 시간 초과(${timeoutMs / 1000}초)'); exit 1 }`,
    "if (-not (Test-Path -LiteralPath $out)) { [Console]::Error.WriteLine('캡처 파일이 만들어지지 않았어요'); exit 1 }",
    'Write-Output $out',
  ].join('\n'));
}

export async function captureThumbnail({ app, store, chromeDir, localWebBase, runPs, readFile = fs.readFileSync, probe = probeUrl }) {
  const url = captureUrl(app, localWebBase);
  if (!url) {
    return { ok: false, error: app.launch.type === 'chrome-app'
      ? '크롬 앱은 수정 창에 캡처용 주소를 넣어야 자동 캡처할 수 있어요'
      : '웹 주소·로컬 웹·크롬 앱만 자동 캡처할 수 있어요. 이미지를 올리거나 붙여넣어 주세요' };
  }
  if (!chromeDir) return { ok: false, error: '크롬을 찾지 못해 캡처할 수 없어요' };
  const alive = await probe(url);
  if (!alive.ok) return alive;
  const r = await runPs(buildCaptureScript({ chromeDir, url, id: app.id }), { timeoutMs: 30000 });
  if (!r.ok) return { ok: false, error: r.error };
  const buf = readFile(winToWsl(r.stdout.trim()));
  return { ok: true, thumbnail: saveThumbnail(store, app.id, buf, 'png') };
}
