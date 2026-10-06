// public/api.js
// 토큰을 붙인 API 호출. 실패해도 예외 대신 { ok:false, error }를 돌려준다.
const token = document.querySelector('meta[name="launcher-token"]').content;

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Launcher-Token': token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: '런처 서버에 연결할 수 없어요. 런처가 꺼졌는지 확인해 주세요' };
  }
  try {
    return await res.json();
  } catch {
    return { ok: false, error: `서버 응답을 읽지 못했어요 (${res.status})` };
  }
}
