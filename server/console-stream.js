// server/console-stream.js
// (claude-wsl-launcher에서 그대로 가져옴)
// 서버의 stdout/stderr 를 가로채 링 버퍼에 모으고, 접속한(SSE) 클라이언트에게 흘려보낸다.
// push/attach/detach 는 순수 로직(테스트 가능). tee 만 스트림을 가로채는 부수효과.

const DEFAULT_LIMIT = 64 * 1024; // 콘솔 스크롤백 상한(문자 수)

export function createConsoleStream({ limit = DEFAULT_LIMIT } = {}) {
  let ring = '';
  const clients = new Set();

  function push(text) {
    ring += text;
    if (ring.length > limit) ring = ring.slice(ring.length - limit);
    // 스냅샷 복사: send 가 동기적으로 detach 해도 순회 안전.
    for (const send of [...clients]) {
      try { send(text); } catch { /* 한 클라이언트 오류가 로깅을 막지 않게 */ }
    }
  }

  function attach(send) {
    if (ring) send(ring); // 접속 즉시 누적 로그 1회 replay
    clients.add(send);
  }

  function detach(send) {
    clients.delete(send);
  }

  /**
   * 주어진 스트림들의 .write 를 가로채 원본 호출 + push.
   * @param {Array} streams 기본값 [process.stdout, process.stderr]
   * @returns {Function} 원복 함수
   */
  function tee(streams = [process.stdout, process.stderr]) {
    const restores = streams.map((stream) => {
      const orig = stream.write; // 원본 참조(원복 시 정확히 되돌리기 위해 bind 안 함)
      stream.write = (chunk, enc, cb) => {
        try { push(typeof chunk === 'string' ? chunk : chunk.toString()); } catch { /* 무시 */ }
        return orig.call(stream, chunk, enc, cb);
      };
      return () => { stream.write = orig; };
    });
    return () => restores.forEach((r) => r());
  }

  return { push, attach, detach, tee };
}
