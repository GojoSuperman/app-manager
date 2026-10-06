#!/usr/bin/env node
// 예시 데이터로 체험해 보기: 내 데이터(~/.config/my-app-launcher)와 섞이지 않는 임시 폴더에 예시 카드를 만들고 런처를 띄운다.
// 사용: npm run demo  (브라우저 창을 닫으면 잠시 뒤 저절로 꺼진다)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ensureDataDirs } from '../server/paths.js';
import { createStore } from '../server/store.js';
import { saveThumbnail } from '../server/thumbs.js';

const MARK = '.app-manager-demo'; // 이 표시가 있는 폴더만 다시 만들 때 비운다 (다른 폴더를 지우지 않게)
const PORT = 4799;
const WEB_PORT = 4798;

export function buildDemoHome({ examplesDir, home }) {
  if (fs.existsSync(home) && fs.readdirSync(home).length && !fs.existsSync(path.join(home, MARK))) {
    throw new Error(`예시용 폴더가 아니라서 비우지 않았어요: ${home}`);
  }
  fs.rmSync(home, { recursive: true, force: true });
  ensureDataDirs(home);
  fs.writeFileSync(path.join(home, MARK), '');
  const ex = JSON.parse(fs.readFileSync(path.join(examplesDir, 'apps.example.json'), 'utf8'));
  const store = createStore(home);
  for (const c of ex.categories || []) store.addCategory(c);
  for (const { thumbnailFile, ...a } of ex.apps) {
    if (a.launch.type === 'local-web') a.launch = { ...a.launch, dir: path.join(examplesDir, a.launch.dir) };
    const r = store.add(a);
    if (!r.ok) throw new Error(`예시 카드 '${a.name}'를 만들지 못했어요: ${r.errors.join(' · ')}`);
    if (thumbnailFile) saveThumbnail(store, r.app.id, fs.readFileSync(path.join(examplesDir, thumbnailFile)), 'png');
  }
  return store.list().length;
}

if (import.meta.filename === process.argv[1]) {
  const root = path.join(import.meta.dirname, '..');
  const home = path.join(os.tmpdir(), 'app-manager-demo');
  const n = buildDemoHome({ examplesDir: path.join(root, 'examples'), home });
  const url = `http://127.0.0.1:${PORT}/`;
  console.log(`예시 카드 ${n}장을 만들었어요 (임시 폴더: ${home} — 내 데이터와 따로예요)`);
  console.log(`브라우저에서 여세요: ${url}  (창을 닫으면 잠시 뒤 꺼져요, 바로 끄려면 Ctrl+C)`);
  const server = spawn(process.execPath, [path.join(root, 'server', 'index.js')], {
    stdio: 'inherit',
    env: { ...process.env, MY_APP_LAUNCHER_HOME: home, MY_APP_LAUNCHER_PORT: String(PORT), MY_APP_LAUNCHER_WEB_PORT: String(WEB_PORT) },
  });
  // Windows 기본 브라우저로 열기 (실패해도 주소를 직접 열면 된다)
  setTimeout(() => spawn('cmd.exe', ['/c', 'start', '', url], { stdio: 'ignore', cwd: '/mnt/c' }).on('error', () => {}), 1500);
  server.on('exit', (code) => process.exit(code ?? 0));
}
