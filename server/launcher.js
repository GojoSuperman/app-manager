// server/launcher.js
// 실행 명령(launch-plan)을 실제로 돌린다. Windows 쪽은 powershell.exe -EncodedCommand, 숨김 WSL은 bash -lc.
// exec/spawn은 주입 가능 — 자동 테스트는 실제 Windows 프로그램을 띄우지 않는다.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataPaths } from './paths.js';
import { buildLaunchPlan, buildOpenFolderPlan, encodePs } from './launch-plan.js';

const PS_FALLBACK = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const CHROME_DIRS = [
  'C:\\Program Files\\Google\\Chrome\\Application',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application',
];

// 비대화형 셸(서버를 띄운 셸 등)엔 Windows 경로가 PATH에 없을 수 있어 절대 경로로 폴백
export function resolvePowershell(env = process.env, existsSync = fs.existsSync) {
  for (const dir of (env.PATH || '').split(':')) {
    if (dir && existsSync(`${dir}/powershell.exe`)) return `${dir}/powershell.exe`;
  }
  return PS_FALLBACK;
}

export function winToWsl(p) {
  const m = /^([A-Za-z]):\\(.*)$/.exec(p);
  return m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : p;
}

export function detectChromeDir(config = {}, existsSync = fs.existsSync) {
  if (config.chromeDir) return config.chromeDir;
  return CHROME_DIRS.find((d) => existsSync(winToWsl(`${d}\\chrome.exe`))) || null;
}

export function runPowershell(script, { execFileFn = execFile, psPath = resolvePowershell(), timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    execFileFn(psPath, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePs(script)],
      { cwd: '/mnt/c', timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (e, stdout = '', stderr = '') => {
        if (!e) return resolve({ ok: true, stdout: String(stdout) });
        if (e.code === 'ENOENT') return resolve({ ok: false, error: 'Windows 연동(WSL interop)이 꺼져 있어 Windows 프로그램을 실행할 수 없어요' });
        if (e.killed) return resolve({ ok: false, error: `시간 초과(${timeoutMs / 1000}초)` });
        const last = String(stderr).split(/\r?\n/).map((s) => s.trim()).filter(Boolean).pop();
        resolve({ ok: false, error: last || e.message });
      });
  });
}

export function runWslHidden(command, cwd, { spawnFn = spawn, logFile, settleMs = 1500 }) {
  return new Promise((resolve) => {
    if (cwd && !fs.existsSync(cwd)) return resolve({ ok: false, error: `작업 폴더가 없어요: ${cwd}` });
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const fd = fs.openSync(logFile, 'a');
    let child;
    try {
      child = spawnFn('bash', ['-lc', command], { cwd: cwd || os.homedir(), detached: true, stdio: ['ignore', fd, fd] });
    } catch (e) {
      fs.closeSync(fd);
      return resolve({ ok: false, error: e.message });
    }
    fs.closeSync(fd);
    let done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    child.once('error', (e) => finish({ ok: false, error: e.message }));
    child.once('exit', (code) => finish(code === 0
      ? { ok: true }
      : { ok: false, error: `명령이 오류로 끝났어요 (종료 코드 ${code}). 자세한 내용: ${logFile}` }));
    // 잠깐 지켜보고 살아 있으면 성공으로 보고 분리 (서버·게임처럼 계속 도는 명령)
    const timer = setTimeout(() => { child.unref(); finish({ ok: true }); }, settleMs);
  });
}

export function createLauncher({
  home, config = {}, distro, localWebBase,
  runPs = runPowershell, runWsl = runWslHidden, existsSync = fs.existsSync, echo = () => {},
}) {
  const paths = dataPaths(home);
  const ctx = () => ({ distro, chromeDir: detectChromeDir(config, existsSync), localWebBase });
  const log = (line) => {
    fs.mkdirSync(paths.logs, { recursive: true });
    fs.appendFileSync(path.join(paths.logs, 'launcher.log'), `${new Date().toISOString()} ${line}\n`);
    echo(line); // 하단 콘솔에도 보이게
  };

  async function runPlan(plan, label, logName) {
    if (plan.kind === 'error') {
      log(`${label} 실패: ${plan.error}`);
      return { ok: false, error: plan.error };
    }
    const r = plan.kind === 'wsl'
      ? await runWsl(plan.command, plan.cwd, { logFile: path.join(paths.logs, `wsl-${logName}.log`) })
      : await runPs(plan.script);
    log(`${label} ${r.ok ? '성공' : `실패: ${r.error}`}`);
    return r;
  }

  return {
    ctx,
    runPs,
    launch: (app) => runPlan(buildLaunchPlan(app, ctx()), `실행 ${app.id}`, app.id),
    openFolder: (app) => runPlan(buildOpenFolderPlan(app.sourceDir, ctx()), `폴더 ${app.id}`, app.id),
  };
}
