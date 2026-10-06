import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../server/store.js';

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mal-store-'));
  let n = 0;
  const store = createStore(home, { now: () => `2026-10-01T00:00:0${n}Z`, rand: () => `000${n++}` });
  return { home, store };
}
const web = (name, extra = {}) => ({ name, launch: { type: 'url', url: 'https://example.com' }, ...extra });

test('빈 상태: 파일 없으면 빈 목록', () => {
  const { store } = setup();
  assert.deepEqual(store.load(), { apps: [], warning: null });
});

test('add: id·시각 붙이고 파일에 저장', () => {
  const { store } = setup();
  const r = store.add(web('Follow It'));
  assert.equal(r.ok, true);
  assert.equal(r.app.id, 'follow-it-0000');
  assert.equal(r.app.lastLaunchedAt, null);
  const disk = JSON.parse(fs.readFileSync(store.paths.apps, 'utf8'));
  assert.equal(disk.version, 1);
  assert.equal(disk.apps[0].name, 'Follow It');
});

test('add·update: 형식 오류 400, 같은 폴더+같은 실행 대상은 409, 실행 대상이 다르면 같은 폴더 허용', () => {
  const { store } = setup();
  assert.equal(store.add({ name: '' }).status, 400);
  store.add(web('a', { sourceDir: '/home/me/p/a' }));
  assert.equal(store.add(web('b', { sourceDir: '/home/me/p/a' })).status, 409);
  const local = { name: 'a 로컬판', sourceDir: '/home/me/p/a', launch: { type: 'url', url: 'http://localhost:3000' } };
  const r = store.add(local);
  assert.equal(r.ok, true);
  assert.equal(store.update(r.app.id, { ...local, launch: { type: 'url', url: 'https://example.com' } }).status, 409);
  assert.equal(store.update(r.app.id, { ...local, description: '로컬' }).ok, true);
});

test('update: id·createdAt 유지, 없는 id 404', () => {
  const { store } = setup();
  const { app } = store.add(web('a'));
  const r = store.update(app.id, web('바뀐 이름'));
  assert.equal(r.app.id, app.id);
  assert.equal(r.app.createdAt, app.createdAt);
  assert.equal(r.app.name, '바뀐 이름');
  assert.equal(store.update('nope', web('x')).status, 404);
});

test('remove → trash에 남고 restore로 되돌림', () => {
  const { store } = setup();
  const { app } = store.add(web('a'));
  const r = store.remove(app.id);
  assert.equal(store.list().length, 0);
  assert.ok(fs.existsSync(path.join(store.paths.trash, r.trashName)));
  const back = store.restore(r.trashName);
  assert.equal(back.app.id, app.id);
  assert.equal(store.list().length, 1);
  assert.equal(fs.existsSync(path.join(store.paths.trash, r.trashName)), false);
  assert.equal(store.restore('../apps.json').ok, false);
});

test('upsertBySourceDir: 처음엔 추가, 다시 하면 같은 id로 갱신', () => {
  const { store } = setup();
  const a = store.upsertBySourceDir(web('a', { sourceDir: '/home/me/p/a' }));
  assert.equal(a.action, 'added');
  const b = store.upsertBySourceDir(web('a2', { sourceDir: '/home/me/p/a', description: '새 설명' }));
  assert.equal(b.action, 'updated');
  assert.equal(b.app.id, a.app.id);
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].description, '새 설명');
  assert.equal(store.upsertBySourceDir(web('c')).ok, false); // sourceDir 필수
});

test('upsertBySourceDir: 한 폴더에 앱이 여럿이면 실행 대상이 같은 카드를 갱신, --new면 따로 추가', () => {
  const { store } = setup();
  const vbs = (name, file) => ({ name, sourceDir: '/home/me/p/talk', launch: { type: 'windows', file: 'C:\\w\\wscript.exe', args: [file], cwd: null } });
  const pub = store.upsertBySourceDir(vbs('공개', 'C:\\t\\public.vbs'));
  // 실행 대상이 다른 둘째 앱: 기본은 (하나뿐인) 기존 카드 갱신 — 주소가 바뀐 재등록일 수 있어서
  assert.equal(store.findSourceTarget(vbs('로컬', 'C:\\t\\local.vbs')).app.id, pub.app.id);
  const local = store.upsertBySourceDir(vbs('로컬', 'C:\\t\\local.vbs'), { asNew: true });
  assert.equal(local.action, 'added');
  assert.equal(store.list().length, 2);
  // 둘이 된 뒤에는 실행 대상으로 골라 갱신
  const again = store.upsertBySourceDir({ ...vbs('로컬', 'C:\\t\\local.vbs'), description: '로컬판' });
  assert.deepEqual([again.action, again.app.id], ['updated', local.app.id]);
  assert.equal(store.get(pub.app.id).description, '');
  // 여럿인데 실행 대상이 아무것과도 안 맞으면 새 카드
  assert.equal(store.upsertBySourceDir(vbs('셋째', 'C:\\t\\third.vbs')).action, 'added');
  assert.equal(store.list().length, 3);
});

test('upsertByImportedFrom: 이미 있으면 건너뜀', () => {
  const { store } = setup();
  const from = 'C:\\Users\\me\\Desktop\\앱\\a.lnk';
  assert.equal(store.upsertByImportedFrom(web('a', { importedFrom: from })).action, 'added');
  assert.equal(store.upsertByImportedFrom(web('a 다른 이름', { importedFrom: from })).action, 'skipped');
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].name, 'a');
});

test('저장할 때마다 직전 판을 .bak으로', () => {
  const { store } = setup();
  store.add(web('a'));
  store.add(web('b'));
  const bak = JSON.parse(fs.readFileSync(store.paths.bak, 'utf8'));
  assert.deepEqual(bak.apps.map((x) => x.name), ['a']);
});

test('깨진 본 파일: .bak에서 읽고 경고', () => {
  const { store } = setup();
  store.add(web('a'));
  store.add(web('b'));
  fs.writeFileSync(store.paths.apps, '{깨짐');
  const r = store.load();
  assert.deepEqual(r.apps.map((x) => x.name), ['a']);
  assert.match(r.warning, /apps\.json\.bak/);
});

test('깨진 본 파일은 다음 저장 때 멀쩡한 .bak을 덮지 않는다', () => {
  const { store } = setup();
  store.add(web('a'));
  store.add(web('b')); // bak = [a]
  fs.writeFileSync(store.paths.apps, '{깨짐');
  store.add(web('c')); // .bak에서 [a]를 읽어 [a, c]로 저장
  assert.deepEqual(store.list().map((x) => x.name), ['a', 'c']);
  const bak = JSON.parse(fs.readFileSync(store.paths.bak, 'utf8'));
  assert.deepEqual(bak.apps.map((x) => x.name), ['a']);
});

test('둘 다 깨지면 빈 목록 + 경고', () => {
  const { store } = setup();
  fs.writeFileSync(store.paths.apps, 'x');
  fs.writeFileSync(store.paths.bak, 'y');
  const r = store.load();
  assert.deepEqual(r.apps, []);
  assert.ok(r.warning);
});

test('잠금: 다른 쪽이 잡고 있으면 기다렸다 진행, 오래된 잠금은 해제', () => {
  const { store } = setup();
  fs.writeFileSync(store.paths.lock, 'other');
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(store.paths.lock, old, old);
  assert.equal(store.add(web('a')).ok, true);
  assert.equal(fs.existsSync(store.paths.lock), false);
});

test('잠금: 새 잠금이 풀리지 않으면 오류', () => {
  const { home } = setup();
  const store = createStore(home, { lockTimeoutMs: 200 });
  fs.writeFileSync(store.paths.lock, 'other');
  assert.throws(() => store.add(web('a')), /잠겨/);
});

test('두 저장소가 번갈아 써도 둘 다 남는다', () => {
  const { home } = setup();
  const s1 = createStore(home);
  const s2 = createStore(home);
  s1.add(web('화면에서'));
  s2.upsertBySourceDir(web('스킬에서', { sourceDir: '/home/me/p/x' }));
  assert.deepEqual(s1.list().map((x) => x.name).sort(), ['스킬에서', '화면에서']);
});

test('markLaunched·setThumbnail', () => {
  const { store } = setup();
  const { app } = store.add(web('a'));
  store.markLaunched(app.id);
  assert.ok(store.get(app.id).lastLaunchedAt);
  store.setThumbnail(app.id, `thumbs/${app.id}.png`);
  assert.equal(store.get(app.id).thumbnail, `thumbs/${app.id}.png`);
});

test('update(PUT)는 썸네일을 바꾸지 않는다 — 수정 창이 옛 값을 보내도 방금 찍은 썸네일 유지', () => {
  const { store } = setup();
  const { app } = store.add(web('a'));
  store.setThumbnail(app.id, `thumbs/${app.id}.png`);
  const r = store.update(app.id, { ...web('a'), thumbnail: null });
  assert.equal(r.app.thumbnail, `thumbs/${app.id}.png`);
});

test('깨진 본 파일은 저장 전에 corrupt 사본으로 남긴다', () => {
  const { store } = setup();
  store.add(web('a'));
  fs.writeFileSync(store.paths.apps, '{"version":1,"apps":[손으로 고치다 깨짐,]}');
  store.add(web('b'));
  const copies = fs.readdirSync(store.paths.home).filter((f) => f.startsWith('apps.json.corrupt-'));
  assert.equal(copies.length, 1);
  assert.equal(fs.readFileSync(path.join(store.paths.home, copies[0]), 'utf8'), '{"version":1,"apps":[손으로 고치다 깨짐,]}');
});

test('순서(order.json): 저장·읽기, 없는 id·중복은 정리, 깨진 파일은 빈 순서', () => {
  const { home, store } = setup();
  const a = store.add(web('a')).app;
  const b = store.add(web('b')).app;
  assert.deepEqual(store.readOrder(), []);
  assert.deepEqual(store.writeOrder([b.id, 'gone', a.id, b.id]), { ok: true, order: [b.id, a.id] });
  assert.deepEqual(store.readOrder(), [b.id, a.id]);
  assert.equal(store.writeOrder('x').ok, false);
  fs.writeFileSync(path.join(home, 'order.json'), '{깨짐');
  assert.deepEqual(store.readOrder(), []);
});

test('직접 추가한 분류(categories.json): 추가·중복·예약어·길이 검사, 빈 분류만 삭제', () => {
  const { store } = setup();
  assert.deepEqual(store.readCategories(), []);
  assert.deepEqual(store.addCategory(' 공모전 '), { ok: true, categories: ['공모전'] });
  assert.equal(store.addCategory('공모전').status, 409);
  store.add({ ...web('a'), category: '게임' });
  assert.equal(store.addCategory('게임').status, 409); // 카드에서 이미 쓰는 분류
  for (const bad of ['', '전체', '최근 실행', '확인 필요', 'x'.repeat(31)]) assert.equal(store.addCategory(bad).status, 400, bad);
  assert.equal(store.removeCategory('게임').status, 409); // 카드가 있으면 못 지움
  assert.deepEqual(store.removeCategory('공모전'), { ok: true, categories: [] });
});

test('탭 순서(tab-order.json): 저장·읽기, 문자열 목록만, 중복 정리', () => {
  const { store } = setup();
  assert.deepEqual(store.readTabOrder(), []);
  assert.deepEqual(store.writeTabOrder(['도구', '게임', '도구']), { ok: true, tabOrder: ['도구', '게임'] });
  assert.deepEqual(store.readTabOrder(), ['도구', '게임']);
  assert.equal(store.writeTabOrder([1]).ok, false);
});

test('실행 여러 개 카드: 추가 실행도 중복 판정·갱신 대상 판정에 쓴다', () => {
  const { store } = setup();
  const pub = { type: 'url', url: 'https://pub.dev' };
  const local = { type: 'url', url: 'http://localhost:3000' };
  const card = store.add({ name: '발표 연습', sourceDir: '/home/me/p/t', launch: pub, launchLabel: '공개', moreLaunches: [{ label: '로컬', launch: local }] }).app;
  assert.equal(store.add({ name: 'x', sourceDir: '/home/me/p/t', launch: local }).status, 409);
  assert.equal(store.findSourceTarget({ sourceDir: '/home/me/p/t', launch: local }).app.id, card.id);
  // 추가 실행 목록을 주지 않고 재등록하면 기존 추가 실행은 남긴다
  const r = store.upsertBySourceDir({ name: '발표 연습', sourceDir: '/home/me/p/t', launch: pub, description: '새 설명' });
  assert.deepEqual([r.action, r.app.moreLaunches, r.app.launchLabel], ['updated', [{ label: '로컬', launch: local }], '공개']);
});

test('직접 추가한 이름표(labels.json): 추가·중복·길이 검사, 쓰는 중이면 삭제 불가', () => {
  const { store } = setup();
  assert.deepEqual(store.addLabel(' 시연 '), { ok: true, labels: ['시연'] });
  assert.equal(store.addLabel('시연').status, 409);
  assert.equal(store.addLabel('').status, 400);
  assert.equal(store.addLabel('x'.repeat(21)).status, 400);
  store.add({ ...web('a'), launchLabel: '시연', moreLaunches: [{ label: '로컬', launch: { type: 'url', url: 'http://localhost:1' } }] });
  assert.equal(store.removeLabel('시연').status, 409);
  store.addLabel('안씀');
  assert.deepEqual(store.removeLabel('안씀'), { ok: true, labels: ['시연'] });
});
