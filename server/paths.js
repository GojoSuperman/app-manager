// server/paths.js
// 데이터 폴더(저장소 밖) 경로와 설정 파일. 개인 데이터는 여기에만 둔다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const LAUNCHER_PORT = 4790;
export const LOCAL_WEB_PORT = 4791;

export function dataHome(env = process.env) {
  return env.MY_APP_LAUNCHER_HOME || path.join(os.homedir(), '.config', 'my-app-launcher');
}

export function dataPaths(home) {
  const j = (f) => path.join(home, f);
  return {
    home, config: j('config.json'), apps: j('apps.json'), bak: j('apps.json.bak'),
    lock: j('apps.json.lock'), tmp: j('apps.json.tmp'), thumbs: j('thumbs'), logs: j('logs'), trash: j('trash'), order: j('order.json'), categories: j('categories.json'), tabOrder: j('tab-order.json'), labels: j('labels.json'),
  };
}

export function ensureDataDirs(home) {
  const p = dataPaths(home);
  for (const d of [p.home, p.thumbs, p.logs, p.trash]) fs.mkdirSync(d, { recursive: true });
}

export function readConfig(home) {
  try {
    const v = JSON.parse(fs.readFileSync(dataPaths(home).config, 'utf8'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export function writeConfig(home, cfg) {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(dataPaths(home).config, JSON.stringify(cfg, null, 2) + '\n');
}
