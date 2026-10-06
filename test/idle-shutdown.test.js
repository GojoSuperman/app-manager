// test/idle-shutdown.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIdleShutdown } from '../server/idle-shutdown.js';

// 가짜 타이머/시계: fire 를 수동으로 호출한다
function harness(graceMs = 1000) {
  let clock = 0;
  const timers = new Map();
  let seq = 0;
  let shutdowns = 0;
  const idle = createIdleShutdown({
    onShutdown: () => { shutdowns += 1; },
    graceMs,
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: clock + ms }); return id; },
    clearTimer: (id) => timers.delete(id),
    now: () => clock,
  });
  // 시간을 ms 만큼 흘려 만기된 타이머를 발화
  const advance = (ms) => {
    clock += ms;
    for (const [id, t] of [...timers]) {
      if (t.at <= clock) { timers.delete(id); t.fn(); }
    }
  };
  return { idle, advance, get shutdowns() { return shutdowns; }, pending: () => timers.size };
}

test('연결된 적 없으면 절대 끄지 않는다', () => {
  const h = harness();
  h.idle.disconnected();
  h.advance(60_000);
  assert.equal(h.shutdowns, 0);
  assert.equal(h.pending(), 0);
});

test('마지막 연결 끊김 → 유예 후 종료', () => {
  const h = harness(1000);
  h.idle.connected();
  h.idle.disconnected();
  h.advance(999);
  assert.equal(h.shutdowns, 0);
  h.advance(1);
  assert.equal(h.shutdowns, 1);
});

test('유예 안에 재연결(새로고침) → 종료 취소', () => {
  const h = harness(1000);
  h.idle.connected();
  h.idle.disconnected();
  h.advance(500);
  h.idle.connected(); // 새로고침으로 다시 붙음
  h.advance(5000);
  assert.equal(h.shutdowns, 0);
  assert.equal(h.pending(), 0);
});

test('여러 창 중 하나만 닫히면 유지', () => {
  const h = harness(1000);
  h.idle.connected();
  h.idle.connected();
  h.idle.disconnected();
  h.advance(5000);
  assert.equal(h.shutdowns, 0);
  h.idle.disconnected();
  h.advance(1000);
  assert.equal(h.shutdowns, 1);
});

test('절전(시계 점프) 감지 → 한 번 더 기다렸다가 종료', () => {
  const h = harness(1000);
  h.idle.connected();
  h.idle.disconnected();
  h.advance(60_000); // 타이머는 1초 뒤 예약됐지만 실제로는 60초가 지나 발화
  assert.equal(h.shutdowns, 0); // 재대기
  assert.equal(h.pending(), 1);
  h.advance(1000);
  assert.equal(h.shutdowns, 1);
});

test('절전 후 재대기 중 재연결되면 유지', () => {
  const h = harness(1000);
  h.idle.connected();
  h.idle.disconnected();
  h.advance(60_000);
  h.idle.connected();
  h.advance(10_000);
  assert.equal(h.shutdowns, 0);
});
