// server/app.js
// 런처 화면과 API. 실패 응답은 항상 { ok:false, error }.
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSecurity } from './security.js';
import { allLaunches } from './app-schema.js';
import { listDir, toWinPath, browseRoots } from './browse.js';
import { listRepos, buildCandidates, cardFromRepo } from './github-import.js';
import { wrapPs } from './launch-plan.js';
import { psQuote } from './wincmd.js';
import { decodeDataUrl, saveThumbnail, captureThumbnail } from './thumbs.js';
import { createConsoleStream } from './console-stream.js';

const PUBLIC_DIR = path.join(import.meta.dirname, '..', 'public');
const SHARED = new Set(['app-schema.js', 'wincmd.js']); // 화면과 같이 쓰는 모듈 (node 전용 import 없음)

export function watchApps(home, onChange) {
  let timer;
  const w = fs.watch(home, (ev, file) => {
    if (file !== 'apps.json') return;
    clearTimeout(timer);
    timer = setTimeout(onChange, 150);
  });
  return () => { clearTimeout(timer); w.close(); };
}

export function createApp({
  store, launcher, token, getPort, localWebBase,
  onShutdown = () => {}, publicDir = PUBLIC_DIR, capture = captureThumbnail, watch = watchApps,
  consoleStream = createConsoleStream(), idle = { connected() {}, disconnected() {} },
  projectsRoot = path.join(os.homedir(), 'projects'), // 앱 추가 창에서 고를 프로젝트 폴더들의 상위 폴더
  usersDir = '/mnt/c/Users', // 찾아보기 바로가기(다운로드·바탕화면·문서)를 찾을 Windows 사용자 폴더
  listGithubRepos = listRepos,
}) {
  const app = express();
  const sec = createSecurity({ token, getPort });
  const fail = (res, status, error) => res.status(status).json({ ok: false, error });
  const fromStore = (res, r, body, okStatus = 200) => (r.ok ? res.status(okStatus).json({ ok: true, ...body(r) }) : fail(res, r.status, r.errors.join(' · ')));
  // 앱 id로 찾고, 비동기 오류는 500으로
  const withApp = (handler) => async (req, res) => {
    const a = store.get(req.params.id);
    if (!a) return fail(res, 404, '앱을 찾지 못했어요');
    try { await handler(a, req, res); } catch (e) { fail(res, 500, e.message); }
  };
  const launchResult = (r) => (r.ok ? { ok: true } : { ok: false, error: r.error });

  app.disable('x-powered-by');
  app.use(sec.hostCheck);
  app.use(express.json({ limit: '8mb' }));
  app.use(sec.csrfCheck);

  app.get('/', (req, res) => {
    const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8').replace('__LAUNCHER_TOKEN__', token);
    res.set('Cache-Control', 'no-store').type('html').send(html);
  });
  app.use(express.static(publicDir, { index: false }));
  app.get('/server/:file', (req, res) => (SHARED.has(req.params.file)
    ? res.type('js').sendFile(path.join(import.meta.dirname, req.params.file))
    : fail(res, 404, '없는 파일이에요')));
  app.use('/thumbs', express.static(store.paths.thumbs));

  app.get('/api/health', (req, res) => res.json({ app: 'my-app-launcher' }));
  app.get('/api/apps', (req, res) => {
    const { apps, warning } = store.load();
    res.json({ ok: true, apps, warning, order: store.readOrder(), categories: store.readCategories(), tabOrder: store.readTabOrder(), labels: store.readLabels() });
  });
  // 앱 추가 창의 프로젝트 폴더 고르기: projectsRoot 아래 폴더 (숨김 제외), 이미 연결된 카드 이름 함께
  app.get('/api/projects', (req, res) => {
    let names = [];
    try {
      names = fs.readdirSync(projectsRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name)
        .sort((x, y) => x.localeCompare(y, 'ko'));
    } catch { /* 폴더가 없으면 빈 목록 */ }
    const { apps } = store.load();
    const dirs = names.map((name) => {
      const p = path.join(projectsRoot, name);
      return { name, path: p, card: apps.find((a) => a.sourceDir === p)?.name || null };
    });
    res.json({ ok: true, root: projectsRoot, dirs });
  });
  // 파일 열기 경로 찾아보기 (목록만 — 파일 내용은 읽지 않는다)
  // WSL이 못 읽는 Windows 폴더는 PowerShell로 목록만 대신 읽는다
  const winList = async (winPath) => {
    const r = await launcher.runPs(wrapPs([
      `Get-ChildItem -LiteralPath ${psQuote(winPath)} -ErrorAction SilentlyContinue | Where-Object { -not ($_.Attributes -band [IO.FileAttributes]::Hidden) } |`,
      "  ForEach-Object { [pscustomobject]@{ name = $_.Name; dir = $_.PSIsContainer; size = $(if ($_.PSIsContainer) { $null } else { $_.Length }) } } |",
      '  ConvertTo-Json -Compress',
    ].join('\n')), { timeoutMs: 20000 });
    if (!r.ok) throw new Error(r.error);
    const v = r.stdout.trim() ? JSON.parse(r.stdout) : [];
    return Array.isArray(v) ? v : [v];
  };
  app.get('/api/browse', async (req, res) => {
    const roots = browseRoots({ project: req.query.project || null, projectsRoot, usersDir });
    const dir = req.query.path || roots[0]?.path || '/';
    const r = await listDir(String(dir), { winList });
    if (!r.ok) return fail(res, 400, r.error);
    res.json({ ...r, winPath: toWinPath(r.path), roots });
  });
  app.post('/api/labels', (req, res) => fromStore(res, store.addLabel(req.body?.name), (r) => ({ labels: r.labels })));
  app.delete('/api/labels/:name', (req, res) => fromStore(res, store.removeLabel(req.params.name), (r) => ({ labels: r.labels })));
  // GitHub에서 가져오기: 내 저장소 체크 목록 → 고른 것만 카드로
  app.get('/api/github/repos', async (req, res) => {
    const r = await listGithubRepos();
    if (!r.ok) return fail(res, 400, r.error);
    res.json({ ok: true, candidates: buildCandidates(r.repos, { projectsRoot, apps: store.load().apps }) });
  });
  app.post('/api/github/import', async (req, res) => {
    const names = Array.isArray(req.body?.names) ? req.body.names : [];
    const r = await listGithubRepos();
    if (!r.ok) return fail(res, 400, r.error);
    const added = [];
    const skipped = [];
    for (const name of names) {
      const c = buildCandidates(r.repos, { projectsRoot, apps: store.load().apps }).find((x) => x.name === name);
      if (!c) { skipped.push({ name, reason: '저장소를 찾지 못했어요' }); continue; }
      if (c.card) { skipped.push({ name, reason: '이미 카드가 있어요' }); continue; }
      const a = store.add(cardFromRepo(c));
      if (a.ok) added.push({ id: a.app.id, name: a.app.name, needsReview: a.app.needsReview });
      else skipped.push({ name, reason: a.errors.join(' · ') });
    }
    res.json({ ok: true, added, skipped });
  });
  app.post('/api/categories', (req, res) => fromStore(res, store.addCategory(req.body?.name), (r) => ({ categories: r.categories })));
  app.delete('/api/categories/:name', (req, res) => fromStore(res, store.removeCategory(req.params.name), (r) => ({ categories: r.categories })));
  app.post('/api/tab-order', (req, res) => fromStore(res, store.writeTabOrder(req.body?.names), (r) => ({ tabOrder: r.tabOrder })));
  app.post('/api/order', (req, res) => fromStore(res, store.writeOrder(req.body?.ids), (r) => ({ order: r.order })));
  app.post('/api/apps', (req, res) => fromStore(res, store.add(req.body), (r) => ({ app: r.app }), 201));
  app.put('/api/apps/:id', (req, res) => fromStore(res, store.update(req.params.id, req.body), (r) => ({ app: r.app })));
  app.delete('/api/apps/:id', (req, res) => fromStore(res, store.remove(req.params.id), (r) => ({ trashName: r.trashName })));
  app.post('/api/trash/:name/restore', (req, res) => fromStore(res, store.restore(req.params.name), (r) => ({ app: r.app })));

  app.post('/api/apps/:id/launch', withApp(async (a, req, res) => {
    const pick = allLaunches(a)[Number(req.body?.index) || 0]; // 0 = 기본 실행
    if (!pick) return fail(res, 400, '없는 실행이에요');
    const r = await launcher.launch({ ...a, launch: pick.launch });
    if (r.ok) store.markLaunched(a.id);
    res.json(launchResult(r));
  }));
  app.post('/api/apps/:id/thumbnail', withApp(async (a, req, res) => {
    if (req.body?.capture) {
      const r = await capture({ app: a, store, chromeDir: launcher.ctx().chromeDir, localWebBase, runPs: launcher.runPs });
      return r.ok ? res.json(r) : fail(res, 400, r.error);
    }
    const d = decodeDataUrl(req.body?.dataUrl);
    if (!d.ok) return fail(res, 400, d.error);
    res.json({ ok: true, thumbnail: saveThumbnail(store, a.id, d.buf, d.ext) });
  }));
  app.post('/api/apps/:id/open-folder', withApp(async (a, req, res) => res.json(launchResult(await launcher.openFolder(a)))));
  app.post('/api/shutdown', (req, res) => {
    res.json({ ok: true });
    setImmediate(onShutdown);
  });

  // 목록 파일이 바뀌면(화면·스킬 어느 쪽이든) 열린 화면에 알림
  const clients = new Set();
  app.get('/api/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write(': 연결됨\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
  });
  // 하단 콘솔: 서버 로그를 누적분부터 흘려보낸다. 이 연결이 모두 끊기면 idle이 유예 뒤 서버를 끈다.
  const consoleClients = new Set();
  app.get('/api/console', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write('retry: 1000\n\n'); // 끊기면 1초 뒤 다시 연결 — 서버 자동 종료 유예(10초) 안에 다시 붙게
    const send = (text) => res.write(`data: ${JSON.stringify(text)}\n\n`);
    consoleClients.add(res);
    consoleStream.attach(send);
    idle.connected();
    req.on('close', () => { consoleClients.delete(res); consoleStream.detach(send); idle.disconnected(); });
  });

  const stopWatch = watch(store.paths.home, () => { for (const c of clients) c.write('event: apps\ndata: {}\n\n'); });
  const ping = setInterval(() => { for (const c of [...clients, ...consoleClients]) c.write(': ping\n\n'); }, 25_000);
  ping.unref();
  app.locals.close = () => { stopWatch(); clearInterval(ping); for (const c of [...clients, ...consoleClients]) c.end(); };

  // 잠금 시간 초과·깨진 JSON 본문 등
  app.use((err, req, res, next) => fail(res, err.status || 500, err.type === 'entity.parse.failed' ? '요청 본문이 올바른 JSON이 아니에요' : err.message));
  return app;
}
