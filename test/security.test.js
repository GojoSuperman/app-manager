import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createSecurity } from '../server/security.js';
import { request, listen } from './helpers/http.js';

async function setup() {
  let port = 0;
  const sec = createSecurity({ token: 'tok', getPort: () => port });
  const app = express();
  app.use(sec.hostCheck, sec.csrfCheck);
  app.all('/x', (req, res) => res.json({ ok: true }));
  const server = await listen(app);
  port = server.address().port;
  return { port, server };
}

test('Host가 다르면 GET도 거부 (DNS 리바인딩)', async (t) => {
  const { port, server } = await setup();
  t.after(() => server.close());
  assert.equal((await request(port, { path: '/x' })).status, 200);
  assert.equal((await request(port, { path: '/x', headers: { host: `localhost:${port}` } })).status, 200);
  const r = await request(port, { path: '/x', headers: { host: `evil.example:${port}` } });
  assert.equal(r.status, 403);
  assert.equal(r.json.ok, false);
  assert.match(r.json.error, /Host/);
});

test('POST: Origin과 토큰이 모두 맞아야 통과', async (t) => {
  const { port, server } = await setup();
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${port}`;
  const post = (headers) => request(port, { method: 'POST', path: '/x', body: {}, headers });
  assert.equal((await post({ origin, 'x-launcher-token': 'tok' })).status, 200);
  assert.equal((await post({ origin: `http://localhost:${port}`, 'x-launcher-token': 'tok' })).status, 200);
  assert.equal((await post({ origin: 'http://127.0.0.1:4791', 'x-launcher-token': 'tok' })).status, 403); // 로컬 웹 앱 페이지
  assert.equal((await post({ 'x-launcher-token': 'tok' })).status, 403); // Origin 없음
  assert.equal((await post({ origin })).status, 403); // 토큰 없음
  assert.equal((await post({ origin, 'x-launcher-token': 'nope' })).status, 403);
});
