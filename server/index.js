// server/index.js
// 런처 시작점. 바탕화면 아이콘 → scripts/launch.sh → 이 파일 (독립 창에서 실행, Claude 세션 시간 제한과 무관).
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { dataHome, dataPaths, ensureDataDirs, readConfig, LAUNCHER_PORT, LOCAL_WEB_PORT } from './paths.js';
import { createStore } from './store.js';
import { createLauncher } from './launcher.js';
import { createApp } from './app.js';
import { createLocalWebApp } from './local-web.js';
import { createConsoleStream } from './console-stream.js';
import { createIdleShutdown } from './idle-shutdown.js';

// 서버 콘솔(stdout/stderr)을 모아 대시보드 하단 패널로 흘려보낸다
const consoleStream = createConsoleStream();
consoleStream.tee();

const home = dataHome();
ensureDataDirs(home);
const logFile = path.join(dataPaths(home).logs, 'server.log');
// 로그 시각은 현지 시각 (콘솔·server.log를 사람이 읽기 쉽게)
const stamp = () => new Date().toLocaleString('sv-SE');
const log = (msg) => {
  const line = `${stamp()} ${msg}`;
  console.log(line);
  fs.appendFileSync(logFile, `${line}\n`);
};

const distro = process.env.WSL_DISTRO_NAME;
if (!distro) {
  log('오류: WSL_DISTRO_NAME이 비어 있어요. WSL 안에서 실행해 주세요');
  process.exit(1);
}
const port = Number(process.env.MY_APP_LAUNCHER_PORT) || LAUNCHER_PORT;
const webPort = Number(process.env.MY_APP_LAUNCHER_WEB_PORT) || LOCAL_WEB_PORT;
const localWebBase = `http://127.0.0.1:${webPort}`;
const token = crypto.randomBytes(24).toString('hex');

const store = createStore(home);
const launcher = createLauncher({ home, config: readConfig(home), distro, localWebBase, echo: (line) => console.log(`${stamp()} ${line}`) });
let mainServer;
let webServer;
// 업데이트 뒤 다시 켜기: 포트를 다 닫은 뒤 새 코드로 서버를 분리해 띄우고(launch.sh와 같은 방식, 브라우저는 안 엶) 이 서버는 끝낸다.
// 열려 있던 화면은 새 서버가 응답하면 스스로 새로고침한다.
function restart() {
  log('업데이트를 적용하려고 런처를 다시 켭니다');
  app.locals.close();
  const servers = [mainServer, webServer].filter(Boolean);
  let left = servers.length;
  const relaunch = () => {
    const out = fs.openSync(path.join(dataPaths(home).logs, 'server.out'), 'a');
    const child = spawn(process.execPath, [path.join(import.meta.dirname, 'index.js')], {
      cwd: path.join(import.meta.dirname, '..'), detached: true, stdio: ['ignore', out, out], env: process.env,
    });
    child.unref();
    setTimeout(() => process.exit(0), 200).unref();
  };
  for (const s of servers) {
    s.closeAllConnections();
    s.close(() => { if (--left === 0) relaunch(); });
  }
  if (!servers.length) relaunch();
}

function shutdown() {
  log('런처를 끕니다');
  app.locals.close();
  mainServer?.closeAllConnections();
  mainServer?.close();
  webServer?.closeAllConnections();
  webServer?.close();
  setTimeout(() => process.exit(0), 300).unref();
}
// 대시보드 창(하단 콘솔 연결)이 모두 닫히고 유예가 지나면 자동 종료. MY_APP_LAUNCHER_AUTO_SHUTDOWN=0 으로 끔.
const idle = createIdleShutdown({
  graceMs: Number(process.env.MY_APP_LAUNCHER_IDLE_MS) || 10_000,
  onShutdown: () => {
    if (process.env.MY_APP_LAUNCHER_AUTO_SHUTDOWN === '0') return;
    log('대시보드 창이 닫혀 서버를 자동 종료합니다');
    shutdown();
  },
});
const projectsRoot = process.env.MY_APP_LAUNCHER_PROJECTS_ROOT || path.join(os.homedir(), 'projects');
const app = createApp({ store, launcher, token, getPort: () => port, localWebBase, onShutdown: shutdown, onRestart: restart, consoleStream, idle, projectsRoot });
const webApp = createLocalWebApp({ store, getPort: () => webPort });

// 이미 떠 있는 게 이 런처인지 (남의 프로그램이면 열지 않는다)
function isOurs(p) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: p, path: '/api/health', timeout: 1000, headers: { host: `127.0.0.1:${p}` } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body.includes('"app":"my-app-launcher"')));
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function listen(a, p) {
  return new Promise((resolve, reject) => {
    const s = a.listen(p, '127.0.0.1');
    s.once('listening', () => resolve(s));
    s.once('error', reject);
  });
}

try {
  mainServer = await listen(app, port);
} catch (e) {
  if (e.code !== 'EADDRINUSE') throw e;
  if (await isOurs(port)) {
    log(`이미 실행 중이에요: http://127.0.0.1:${port}`);
    process.exit(0);
  }
  log(`오류: 포트 ${port}를 다른 프로그램이 쓰고 있어요. 그 프로그램을 끄거나 MY_APP_LAUNCHER_PORT로 다른 포트를 지정해 주세요`);
  process.exit(1);
}
try {
  webServer = await listen(webApp, webPort);
} catch (e) {
  log(`경고: 로컬 웹 포트 ${webPort}를 열지 못했어요(${e.code}). 로컬 웹 앱은 실행되지 않아요`);
}
log(`런처 시작: http://127.0.0.1:${port} (데이터: ${home})`);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
