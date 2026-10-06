// server/local-web.js
// local-web 앱 폴더를 127.0.0.1:4791/<id>/ 로 제공. 런처(4790)와 다른 출처라 앱 페이지가 실행 API에 접근하지 못한다.
import express from 'express';
import { createSecurity } from './security.js';
import { allLaunches } from './app-schema.js';

export function createLocalWebApp({ store, getPort }) {
  const app = express();
  const sec = createSecurity({ token: null, getPort });
  const statics = new Map(); // 폴더 → express.static
  app.disable('x-powered-by');
  app.use(sec.hostCheck);
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).send('읽기만 할 수 있어요');
    const m = /^\/([^/]+)(\/.*)?$/.exec(req.path);
    if (!m) return res.status(404).send('앱 id가 필요해요');
    const a = store.get(decodeURIComponent(m[1]));
    const lw = a && allLaunches(a).map((x) => x.launch).find((l) => l.type === 'local-web' && l.dir); // 추가 실행에 있어도 됨
    if (!lw) return res.status(404).send('로컬 웹 앱을 찾지 못했어요');
    // /<id> 로 오면 /<id>/ 로 — 그래야 페이지 안의 상대 경로 링크가 맞게 풀린다
    if (!m[2]) return res.redirect(302, `/${m[1]}/${req.url.slice(req.path.length)}`);
    let serve = statics.get(lw.dir);
    if (!serve) { serve = express.static(lw.dir, { dotfiles: 'ignore' }); statics.set(lw.dir, serve); }
    req.url = req.url.slice(m[1].length + 1);
    serve(req, res, next);
  });
  return app;
}
