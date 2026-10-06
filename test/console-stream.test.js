// test/console-stream.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConsoleStream } from '../server/console-stream.js';

test('push: attach된 client 들에게 텍스트 브로드캐스트', () => {
  const cs = createConsoleStream();
  const a = [];
  const b = [];
  cs.attach((t) => a.push(t));
  cs.attach((t) => b.push(t));
  cs.push('hello\n');
  assert.deepEqual(a, ['hello\n']);
  assert.deepEqual(b, ['hello\n']);
});

test('attach: 기존 링 버퍼를 1회 replay 후 신규 수신', () => {
  const cs = createConsoleStream();
  cs.push('past line\n');
  const got = [];
  cs.attach((t) => got.push(t));
  assert.deepEqual(got, ['past line\n']); // 접속 즉시 누적분 replay
  cs.push('new line\n');
  assert.deepEqual(got, ['past line\n', 'new line\n']);
});

test('attach: 누적된 게 없으면 replay 안 함', () => {
  const cs = createConsoleStream();
  const got = [];
  cs.attach((t) => got.push(t));
  assert.equal(got.length, 0);
});

test('링 버퍼: 상한 초과 시 앞부분 잘리고 꼬리만 replay', () => {
  const cs = createConsoleStream({ limit: 5 });
  cs.push('abcdefgh'); // 8 > 5
  const got = [];
  cs.attach((t) => got.push(t));
  assert.deepEqual(got, ['defgh']); // 마지막 5자만
});

test('detach: 이후 push 를 받지 않음', () => {
  const cs = createConsoleStream();
  const got = [];
  const send = (t) => got.push(t);
  cs.attach(send);
  cs.push('one\n');
  cs.detach(send);
  cs.push('two\n');
  assert.deepEqual(got, ['one\n']);
});

test('tee: 가짜 스트림의 write 를 가로채 원본 호출 + push, 원복 가능', () => {
  const cs = createConsoleStream();
  const got = [];
  cs.attach((t) => got.push(t));

  const writes = [];
  const fakeStream = { write: (chunk, enc, cb) => { writes.push(String(chunk)); if (cb) cb(); return true; } };
  const orig = fakeStream.write;

  const restore = cs.tee([fakeStream]);
  fakeStream.write('server log\n');     // 가로채진 write
  assert.deepEqual(writes, ['server log\n']); // 원본도 호출됨
  assert.deepEqual(got, ['server log\n']);    // push 로도 흘러감

  restore();
  assert.equal(fakeStream.write, orig);  // 원복됨
  fakeStream.write('after restore\n');
  assert.deepEqual(got, ['server log\n']); // 원복 후엔 push 안 됨
});

test('tee: Buffer 청크도 문자열로 변환해 push', () => {
  const cs = createConsoleStream();
  const got = [];
  cs.attach((t) => got.push(t));
  const fakeStream = { write: () => true };
  cs.tee([fakeStream]);
  fakeStream.write(Buffer.from('버퍼 로그\n', 'utf8'));
  assert.deepEqual(got, ['버퍼 로그\n']);
});
