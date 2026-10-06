// public/console.js
// 런처 서버의 콘솔(로그)을 화면 하단 패널에 읽기 전용으로 보여 준다 (claude-wsl-launcher와 같은 방식).
// 목적: 서버가 살아 있음을 눈에 보이게 한다. 이 연결이 모두 끊기면 서버가 10초 뒤 스스로 꺼진다.
const drawer = document.getElementById('console');
const pane = document.getElementById('console-pane');
const toggle = document.getElementById('console-toggle');
const MAX_CHARS = 64 * 1024; // 서버 링 버퍼와 같은 상한
const GONE_AFTER_MS = 15_000; // 서버 유예(10초)보다 길게 끊겨 있으면 꺼진 것으로 안내

document.getElementById('console-title').textContent = `● 서버 콘솔 · ${location.host}`;
document.body.classList.add('drawer-open');

function write(text) {
  const atBottom = pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 4;
  pane.textContent = (pane.textContent + text).slice(-MAX_CHARS);
  if (atBottom) pane.scrollTop = pane.scrollHeight;
}

let lostAt = 0;
let goneShown = false;
const es = new EventSource('/api/console');
es.onopen = () => {
  // 서버가 접속 때 누적 로그를 처음부터 다시 보내므로, 재연결이면 비워서 중복을 막는다
  if (lostAt) pane.textContent = '';
  lostAt = 0;
  goneShown = false;
};
es.onmessage = (ev) => write(JSON.parse(ev.data));
es.onerror = () => {
  if (!lostAt) {
    lostAt = Date.now();
    write('\n— 서버 연결이 끊겼어요. 다시 연결하는 중…\n');
  } else if (!goneShown && Date.now() - lostAt > GONE_AFTER_MS) {
    goneShown = true;
    write('— 서버가 꺼졌어요. 다시 쓰려면 바탕화면의 "앱 관리 프로젝트" 아이콘을 누르세요.\n');
  }
};

toggle.addEventListener('click', () => {
  const collapsed = drawer.classList.toggle('collapsed');
  document.body.classList.toggle('drawer-collapsed', collapsed);
  toggle.textContent = collapsed ? '▴' : '▾';
  if (!collapsed) pane.scrollTop = pane.scrollHeight;
});
