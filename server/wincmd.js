// server/wincmd.js
// Windows 명령줄 인자 따옴표 처리와 분해. WSL→Windows 실행에서 경로가 깨지지 않게 하는 핵심.
// 화면(브라우저)도 "인자" 입력칸 분해에 쓰므로 node 전용 모듈을 쓰지 않는다.

// PowerShell은 ' 외에 ‘ ’ ‚ ‛ 도 작은따옴표로 취급한다 → 모두 두 번 써서 이스케이프
export function psQuote(s) {
  return "'" + String(s).replace(/['\u2018\u2019\u201A\u201B]/g, (m) => m + m) + "'";
}

// MSVC/CommandLineToArgvW 규칙: 따옴표 앞 역슬래시는 2배+1, 끝 역슬래시는 2배
export function winQuoteArg(a) {
  a = String(a);
  if (a === '') return '""';
  if (!/[\s"]/.test(a)) return a;
  let out = '"';
  let bs = 0;
  for (const ch of a) {
    if (ch === '\\') { bs++; continue; }
    if (ch === '"') { out += '\\'.repeat(bs * 2 + 1) + '"'; bs = 0; continue; }
    out += '\\'.repeat(bs) + ch;
    bs = 0;
  }
  return out + '\\'.repeat(bs * 2) + '"';
}

export function joinWinArgs(args) {
  return args.map(winQuoteArg).join(' ');
}

export function splitWinArgs(s) {
  s = String(s ?? '');
  const out = [];
  let cur = '';
  let inQ = false;
  let has = false; // 빈 따옴표 "" 도 인자 하나로 센다
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      let n = 0;
      while (s[i] === '\\') { n++; i++; }
      if (s[i] === '"') {
        cur += '\\'.repeat(Math.floor(n / 2));
        if (n % 2) { cur += '"'; i++; }
      } else {
        cur += '\\'.repeat(n);
      }
      has = true;
      continue;
    }
    if (c === '"') {
      if (inQ && s[i + 1] === '"') { cur += '"'; i += 2; has = true; continue; }
      inQ = !inQ;
      has = true;
      i++;
      continue;
    }
    if (!inQ && /\s/.test(c)) {
      if (has) { out.push(cur); cur = ''; has = false; }
      i++;
      continue;
    }
    cur += c;
    has = true;
    i++;
  }
  if (has) out.push(cur);
  return out;
}
