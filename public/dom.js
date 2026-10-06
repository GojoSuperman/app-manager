// public/dom.js
// 요소 만들기 도우미. 글자는 항상 텍스트 노드로 넣는다(앱 이름 등에 HTML이 섞여도 안전).
export function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'list' || !(k in n)) n.setAttribute(k, v === true ? '' : v);
    else n[k] = v;
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    n.append(c instanceof Node ? c : String(c));
  }
  return n;
}
