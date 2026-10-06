// server/security.js
// 브라우저의 다른 사이트(또는 로컬 웹 앱 페이지)가 실행 API를 부르지 못하게 막는다.
// - Host 검사: DNS 리바인딩 차단 (모든 요청)
// - Origin + 토큰 검사: CSRF 차단 (상태를 바꾸는 요청). 토큰은 서버 시작마다 새로 만들어 화면 HTML에 넣는다.

export function createSecurity({ token, getPort }) {
  const hosts = () => [`127.0.0.1:${getPort()}`, `localhost:${getPort()}`];
  const deny = (res, error) => res.status(403).json({ ok: false, error });
  return {
    hostCheck(req, res, next) {
      if (!hosts().includes(req.headers.host)) return deny(res, '허용되지 않은 주소(Host)예요');
      next();
    },
    csrfCheck(req, res, next) {
      if (req.method === 'GET' || req.method === 'HEAD') return next();
      if (!hosts().map((h) => `http://${h}`).includes(req.headers.origin)) return deny(res, '허용되지 않은 출처(Origin)예요');
      if (req.headers['x-launcher-token'] !== token) return deny(res, '토큰이 맞지 않아요. 화면을 새로고침해 주세요');
      next();
    },
  };
}
