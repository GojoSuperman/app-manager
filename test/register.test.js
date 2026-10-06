import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../scripts/register.mjs';
import { createStore } from '../server/store.js';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-reg-'));
  const home = path.join(dir, 'data');
  const outs = [];
  const write = (name, obj) => { const f = path.join(dir, name); fs.writeFileSync(f, JSON.stringify(obj)); return f; };
  const run = (argv, opts = {}) => main(argv, { home, out: (o) => outs.push(o), capture: async () => ({ ok: false, error: '캡처 안 함' }), ...opts });
  return { dir, home, outs, write, run };
}
const app = (extra = {}) => ({ name: '성을 지켜라', sourceDir: '/home/me/projects/td', launch: { type: 'url', url: 'https://td.example.app' }, ...extra });

test('처음엔 추가, 같은 sourceDir 다시 등록하면 같은 id로 갱신', async () => {
  const { home, outs, write, run } = setup();
  assert.equal(await run([write('a.json', app())]), 0);
  assert.equal(outs[0].action, 'added');
  assert.equal(await run([write('b.json', app({ description: '타워 디펜스' }))]), 0);
  assert.equal(outs[1].action, 'updated');
  assert.equal(outs[1].id, outs[0].id);
  const list = createStore(home).list();
  assert.equal(list.length, 1);
  assert.equal(list[0].description, '타워 디펜스');
});

test('--new: 같은 폴더의 다른 앱으로 추가, --dry-run은 갱신될 카드 이름을 알려 줌', async () => {
  const { home, outs, write, run } = setup();
  await run([write('a.json', app())]);
  const edge = write('b.json', app({ name: '성을 지켜라 (엣지)', launch: { type: 'url', url: 'https://td.example.app/edge' } }));
  assert.equal(await run([edge, '--dry-run']), 0);
  assert.deepEqual([outs[1].action, outs[1].target], ['updated', { id: outs[0].id, name: '성을 지켜라' }]);
  assert.equal(await run([edge, '--dry-run', '--new']), 0);
  assert.deepEqual([outs[2].action, outs[2].target], ['added', null]);
  assert.equal(await run([edge, '--new']), 0);
  assert.equal(outs[3].action, 'added');
  assert.equal(createStore(home).list().length, 2);
});

test('표준 입력(-)으로도 받음', async () => {
  const { outs, run } = setup();
  assert.equal(await run(['-'], { readStdin: () => JSON.stringify(app()) }), 0);
  assert.equal(outs[0].ok, true);
});

test('sourceDir 없음·형식 오류·깨진 JSON·인자 없음은 실패', async () => {
  const { outs, write, run, dir } = setup();
  assert.equal(await run([write('a.json', app({ sourceDir: undefined }))]), 1);
  assert.match(outs[0].error, /sourceDir/);
  assert.equal(await run([write('b.json', app({ launch: { type: 'url', url: 'ftp://x' } }))]), 1);
  assert.match(outs[1].error, /http/);
  fs.writeFileSync(path.join(dir, 'c.json'), '{깨짐');
  assert.equal(await run([path.join(dir, 'c.json')]), 1);
  assert.equal(await run([]), 1);
  assert.match(outs[3].error, /사용:/);
});

test('thumbnailFile을 thumbs/로 복사, 형식·존재 검사', async () => {
  const { dir, home, outs, write, run } = setup();
  const img = path.join(dir, 'shot.png');
  fs.writeFileSync(img, Buffer.from('89504e47', 'hex'));
  assert.equal(await run([write('a.json', app({ thumbnailFile: img }))]), 0);
  assert.equal(outs[0].thumbnail, `thumbs/${outs[0].id}.png`);
  assert.ok(fs.existsSync(path.join(home, 'thumbs', `${outs[0].id}.png`)));
  assert.equal(await run([write('b.json', app({ thumbnailFile: path.join(dir, 'x.gif') }))]), 1);
  assert.equal(await run([write('c.json', app({ thumbnailFile: path.join(dir, 'none.png') }))]), 1);
});

test('--dry-run은 저장하지 않고 할 일을 보여 줌', async () => {
  const { home, outs, write, run } = setup();
  assert.equal(await run([write('a.json', app()), '--dry-run']), 0);
  assert.deepEqual([outs[0].dryRun, outs[0].action], [true, 'added']);
  assert.equal(createStore(home).list().length, 0);
});

test('--capture: 썸네일 없을 때만 캡처, 실패해도 등록은 성공', async () => {
  const { outs, write, run } = setup();
  const seen = [];
  const capture = async ({ app: a, store }) => { seen.push(a.id); store.setThumbnail(a.id, `thumbs/${a.id}.png`); return { ok: true, thumbnail: `thumbs/${a.id}.png` }; };
  await run([write('a.json', app()), '--capture'], { capture });
  assert.equal(outs[0].thumbnail, `thumbs/${outs[0].id}.png`);
  assert.equal(seen.length, 1);
  await run([write('b.json', app()), '--capture'], { capture }); // 이미 썸네일 있음 → 안 찍음
  assert.equal(seen.length, 1);
  await run([write('c.json', app({ sourceDir: '/home/me/p/other' })), '--capture']); // 기본 capture는 실패
  assert.deepEqual([outs[2].ok, outs[2].captureError], [true, '캡처 안 함']);
});
