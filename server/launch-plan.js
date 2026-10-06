// server/launch-plan.js
// 실행 방법(launch) → 실제로 돌릴 명령. 순수 함수만 — 실제 실행은 launcher.js.
// Windows 쪽은 전부 PowerShell 스크립트로 만들고 -EncodedCommand로 넘긴다(셸을 거치며 따옴표·역슬래시가 깨지는 문제 차단).
import { psQuote, joinWinArgs } from './wincmd.js';

const FILL = '✏ 수정에서 채워 주세요';
const err = (error) => ({ kind: 'error', error });

export function wrapPs(body) {
  return "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.Encoding]::UTF8\n"
    + `try {\n${body}\n} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;
}

export function encodePs(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

export function toWslUnc(posixPath, distro) {
  return `\\\\wsl.localhost\\${distro}${posixPath.replace(/\//g, '\\')}`;
}

export function localWebUrl(base, id, entry) {
  return `${base}/${encodeURIComponent(id)}/${entry.split('/').map(encodeURIComponent).join('/')}`;
}

const isWinAbs = (p) => /^[A-Za-z]:\\/.test(p) || p.startsWith('\\\\');
const winDir = (p) => p.replace(/\\[^\\]*$/, '');

function startProcess(file, args = [], cwd = null) {
  let s = `Start-Process -FilePath ${psQuote(file)}`;
  if (args.length) s += ` -ArgumentList ${psQuote(joinWinArgs(args))}`;
  if (cwd) s += ` -WorkingDirectory ${psQuote(cwd)}`;
  return s;
}

// 실행 방법 → Windows에서 띄울 { file, args, cwd, checkFile? }
function windowsCommand(launch, ctx, id) {
  switch (launch.type) {
    case 'url':
      if (!launch.url) return err(`웹 주소가 비어 있어요. ${FILL}`);
      return { url: launch.url };
    case 'chrome-app':
      if (!launch.appId) return err(`크롬 앱 ID가 비어 있어요. ${FILL}`);
      if (!ctx.chromeDir) return err('크롬을 찾지 못했어요. 데이터 폴더 config.json의 chromeDir에 크롬 설치 폴더를 적어 주세요');
      return { file: `${ctx.chromeDir}\\chrome_proxy.exe`, args: [`--profile-directory=${launch.profile || 'Default'}`, `--app-id=${launch.appId}`], cwd: null };
    case 'windows': {
      const { file, args = [] } = launch;
      if (!file) return err(`실행 파일이 비어 있어요. ${FILL}`);
      const abs = isWinAbs(file);
      const cwd = launch.cwd || (abs ? winDir(file) : null);
      const checkFile = abs ? file : null;
      const ext = file.toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
      if (ext === '.ps1') return { file: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...args], cwd, checkFile };
      if (ext === '.vbs') return { file: 'wscript.exe', args: [file, ...args], cwd, checkFile };
      return { file, args, cwd, checkFile };
    }
    case 'wsl':
      if (!launch.command) return err(`WSL 명령이 비어 있어요. ${FILL}`);
      // -e: 명령을 바깥 셸 없이 바로 실행 (-- 는 바깥 셸이 $·따옴표를 한 번 더 해석함, 2026-10-01 실측)
      return { file: 'wsl.exe', args: ['-d', ctx.distro, '--cd', launch.cwd || '~', '-e', 'bash', '-lic', launch.command], cwd: null };
    case 'file': {
      if (!launch.path) return err(`열 파일 경로가 비어 있어요. ${FILL}`);
      const p = launch.path.startsWith('/') ? toWslUnc(launch.path, ctx.distro) : launch.path;
      return { file: 'explorer.exe', args: [p], cwd: null, checkFile: p }; // 탐색기가 확장자에 맞는 기본 프로그램으로 연다
    }
    case 'local-web':
      if (!launch.dir) return err(`폴더 경로가 비어 있어요. ${FILL}`);
      return { url: localWebUrl(ctx.localWebBase, id, launch.entry || 'index.html') };
    default:
      return err('알 수 없는 실행 방법이에요');
  }
}

export function buildLaunchPlan(app, ctx) {
  const { launch } = app;
  if (launch.type === 'wsl' && launch.window !== 'new') {
    if (!launch.command) return err(`WSL 명령이 비어 있어요. ${FILL}`);
    return { kind: 'wsl', command: launch.command, cwd: launch.cwd || null };
  }
  const c = windowsCommand(launch, ctx, app.id);
  if (c.kind === 'error') return c;
  if (c.url) return { kind: 'powershell', script: wrapPs(startProcess(c.url)) };
  const lines = [];
  if (c.checkFile) {
    lines.push(`if (-not (Test-Path -LiteralPath ${psQuote(c.checkFile)})) { [Console]::Error.WriteLine(${psQuote(`파일이 없습니다: ${c.checkFile}`)}); exit 2 }`);
  }
  lines.push(startProcess(c.file, c.args, c.cwd));
  return { kind: 'powershell', script: wrapPs(lines.join('\n')) };
}

export function buildOpenFolderPlan(sourceDir, ctx) {
  if (!sourceDir) return err('원본 폴더가 등록되어 있지 않아요');
  return { kind: 'powershell', script: wrapPs(startProcess('explorer.exe', [toWslUnc(sourceDir, ctx.distro)])) };
}
