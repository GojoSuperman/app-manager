#!/usr/bin/env node
// 자동 등록 스킬(register-to-launcher)이 부르는 등록 명령. 같은 원본 폴더(sourceDir)가 있으면 갱신한다.
// 한 폴더에서 앱이 여럿이면(공개판·로컬판 등) 실행 대상이 같은 카드를 갱신, --new면 무조건 새 카드.
// 사용: node scripts/register.mjs <앱.json | -> [--dry-run] [--capture] [--new]
import fs from 'node:fs';
import path from 'node:path';
import { dataHome, readConfig, LOCAL_WEB_PORT } from '../server/paths.js';
import { createStore } from '../server/store.js';
import { validateApp } from '../server/app-schema.js';
import { saveThumbnail, captureThumbnail } from '../server/thumbs.js';
import { detectChromeDir, runPowershell } from '../server/launcher.js';

const IMG = { '.png': 'png', '.jpg': 'jpg', '.jpeg': 'jpg', '.webp': 'webp' };

export async function main(argv, {
  home = dataHome(),
  readStdin = () => fs.readFileSync(0, 'utf8'),
  out = (o) => console.log(JSON.stringify(o, null, 2)),
  capture = captureThumbnail,
} = {}) {
  const fail = (error) => { out({ ok: false, error }); return 1; };
  const src = argv.find((a) => !a.startsWith('--') || a === '-');
  if (!src) return fail('사용: node scripts/register.mjs <앱.json | -> [--dry-run] [--capture] [--new]');
  let input;
  try {
    input = JSON.parse(src === '-' ? readStdin() : fs.readFileSync(src, 'utf8'));
  } catch (e) {
    return fail(`JSON을 읽지 못했어요: ${e.message}`);
  }
  const { thumbnailFile, ...fields } = input;
  if (!fields.sourceDir) return fail('원본 폴더(sourceDir)가 필요해요');
  let ext = null;
  if (thumbnailFile) {
    ext = IMG[path.extname(thumbnailFile).toLowerCase()];
    if (!ext) return fail('썸네일은 PNG·JPG·WEBP만 쓸 수 있어요');
    if (!fs.existsSync(thumbnailFile)) return fail(`썸네일 파일이 없어요: ${thumbnailFile}`);
  }
  const v = validateApp(fields);
  if (!v.ok) return fail(v.errors.join(' · '));

  const store = createStore(home);
  const asNew = argv.includes('--new');
  if (argv.includes('--dry-run')) {
    const t = asNew ? null : store.findSourceTarget(v.value).app;
    out({ ok: true, dryRun: true, action: t ? 'updated' : 'added', target: t ? { id: t.id, name: t.name } : null, app: v.value });
    return 0;
  }
  const r = store.upsertBySourceDir(v.value, { asNew });
  if (!r.ok) return fail(r.errors.join(' · '));
  const result = { ok: true, action: r.action, id: r.app.id, name: r.app.name, thumbnail: r.app.thumbnail };
  if (thumbnailFile) {
    result.thumbnail = saveThumbnail(store, r.app.id, fs.readFileSync(thumbnailFile), ext);
  } else if (argv.includes('--capture') && !r.app.thumbnail) {
    const c = await capture({
      app: r.app, store, chromeDir: detectChromeDir(readConfig(home)),
      localWebBase: `http://127.0.0.1:${LOCAL_WEB_PORT}`, runPs: runPowershell,
    });
    if (c.ok) result.thumbnail = c.thumbnail; else result.captureError = c.error;
  }
  out(result);
  return 0;
}

if (import.meta.filename === process.argv[1]) process.exit(await main(process.argv.slice(2)));
