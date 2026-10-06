// server/idle-shutdown.js
// (claude-wsl-launcher에서 그대로 가져옴)
// 브라우저(하단 콘솔 SSE) 연결이 모두 끊긴 뒤 유예 시간 안에 재연결이 없으면 서버를 스스로 끈다.
// - 한 번도 연결된 적이 없으면(터미널에서 npm start 만 한 경우) 절대 끄지 않는다.
// - 새로고침은 유예 안에 재연결되므로 영향 없음.
// - 절전에서 깨어난 경우 타이머가 밀려서 한꺼번에 발화 → 시계 점프를 감지하면 한 번 더 기다린다.
// 타이머/시계 주입으로 테스트 가능. 순수 상태 머신.

/**
 * @param {object} opts
 * @param {() => void} opts.onShutdown  유예 만료 시 호출
 * @param {number} [opts.graceMs=10000]
 * @param {(fn:Function, ms:number) => any} [opts.setTimer]
 * @param {(id:any) => void} [opts.clearTimer]
 * @param {() => number} [opts.now]
 */
export function createIdleShutdown({
  onShutdown, graceMs = 10000,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id), now = () => Date.now(),
}) {
  let clients = 0;
  let everConnected = false;
  let timer = null;
  let armedAt = 0;

  function cancel() {
    if (timer !== null) { clearTimer(timer); timer = null; }
  }
  function arm() {
    cancel();
    armedAt = now();
    timer = setTimer(fire, graceMs);
  }
  function fire() {
    timer = null;
    if (clients > 0) return;
    // 절전 등으로 실제 경과가 유예의 2배를 넘으면 브라우저 재연결 기회를 한 번 더 준다
    if (now() - armedAt > graceMs * 2) { arm(); return; }
    onShutdown();
  }

  return {
    connected() { clients += 1; everConnected = true; cancel(); },
    disconnected() {
      clients = Math.max(0, clients - 1);
      if (clients === 0 && everConnected) arm();
    },
    /** 테스트/진단용 */
    state() { return { clients, everConnected, pending: timer !== null }; },
  };
}
