// server/store.js
// apps.json 읽기·쓰기. 화면(서버)과 스킬(register.mjs)이 같은 파일을 쓰므로
// 잠금 파일 + 임시 파일에 쓴 뒤 이름 바꾸기 + 직전 판 .bak 보관으로 깨지지 않게 한다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataPaths, ensureDataDirs } from './paths.js';
import { validateApp, makeId, launchKey, allLaunches } from './app-schema.js';

const STALE_LOCK_MS = 10_000;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function parseList(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && Array.isArray(v.apps) ? v.apps : null;
  } catch {
    return null;
  }
}

export function createStore(home, {
  now = () => new Date().toISOString(),
  rand = () => crypto.randomBytes(2).toString('hex'),
  lockTimeoutMs = 3000,
} = {}) {
  const paths = dataPaths(home);
  ensureDataDirs(home);

  function withLock(fn) {
    const deadline = Date.now() + lockTimeoutMs;
    for (;;) {
      try {
        fs.writeFileSync(paths.lock, String(process.pid), { flag: 'wx' });
        break;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        try {
          if (Date.now() - fs.statSync(paths.lock).mtimeMs > STALE_LOCK_MS) { fs.unlinkSync(paths.lock); continue; }
        } catch { continue; } // 그 사이 풀림
        if (Date.now() > deadline) throw new Error('목록 파일이 잠겨 있어요. 잠시 뒤 다시 시도해 주세요');
        sleepSync(20);
      }
    }
    try { return fn(); } finally { fs.rmSync(paths.lock, { force: true }); }
  }

  function load() {
    if (!fs.existsSync(paths.apps)) return { apps: [], warning: null };
    const main = parseList(paths.apps);
    if (main) return { apps: main, warning: null };
    const bak = parseList(paths.bak);
    if (bak) return { apps: bak, warning: '목록 파일(apps.json)이 깨져 있어 직전 판(apps.json.bak)을 불러왔어요' };
    return { apps: [], warning: '목록 파일과 백업이 모두 깨져 있어요. logs/와 apps.json을 확인해 주세요' };
  }

  function save(apps) {
    // 본 파일이 멀쩡할 때만 .bak으로 — 깨진 파일이 멀쩡한 백업을 덮지 않게.
    // 깨진 본 파일은 덮어쓰기 전에 사본으로 남긴다 (손으로 고치다 깨진 목록을 잃지 않게)
    if (parseList(paths.apps)) fs.copyFileSync(paths.apps, paths.bak);
    else if (fs.existsSync(paths.apps)) fs.renameSync(paths.apps, `${paths.apps}.corrupt-${Date.now()}`);
    fs.writeFileSync(paths.tmp, JSON.stringify({ version: 1, apps }, null, 2) + '\n');
    fs.renameSync(paths.tmp, paths.apps);
  }

  // 읽기 → 바꾸기 → 저장을 잠금 안에서. fn이 apps를 직접 고치고 결과를 돌려준다.
  const mutate = (fn) => withLock(() => {
    const { apps } = load();
    const result = fn(apps);
    if (result.ok && !result.noWrite) save(apps);
    delete result.noWrite;
    return result;
  });

  const bad = (status, errors) => ({ ok: false, status, errors });

  function newApp(value, apps) {
    let id;
    do { id = makeId(value.name, rand); } while (apps.some((a) => a.id === id));
    const t = now();
    return { id, ...value, createdAt: t, updatedAt: t, lastLaunchedAt: null };
  }

  // 카드 순서(끌어서 정한 것) — 앱 id 배열. apps.json과 따로 두어 순서만 바꿀 때 목록 파일을 건드리지 않는다.
  function readOrder() {
    try {
      const v = JSON.parse(fs.readFileSync(paths.order, 'utf8'));
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  function writeOrder(ids) {
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) return bad(400, ['순서는 앱 id 목록이어야 해요']);
    const known = new Set(load().apps.map((a) => a.id));
    const order = [...new Set(ids)].filter((id) => known.has(id));
    fs.writeFileSync(paths.order, JSON.stringify(order, null, 2));
    return { ok: true, order };
  }

  const readList = (file) => {
    try {
      const v = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : [];
    } catch {
      return [];
    }
  };

  // 분류 탭 순서(끌어서 정한 것) — 분류 이름 배열
  function writeTabOrder(names) {
    if (!Array.isArray(names) || names.some((x) => typeof x !== 'string')) return bad(400, ['탭 순서는 분류 이름 목록이어야 해요']);
    const tabOrder = [...new Set(names)];
    fs.writeFileSync(paths.tabOrder, JSON.stringify(tabOrder, null, 2));
    return { ok: true, tabOrder };
  }

  // 직접 추가한 분류 — 카드가 없어도 탭으로 보이게 따로 둔다
  const RESERVED = new Set(['전체', '최근 실행', '확인 필요']);
  const readCategories = () => readList(paths.categories);
  const saveCategories = (list) => { fs.writeFileSync(paths.categories, JSON.stringify(list, null, 2)); return { ok: true, categories: list }; };

  function addCategory(raw) {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name || name.length > 30) return bad(400, ['분류 이름은 1~30자로 적어 주세요']);
    if (RESERVED.has(name)) return bad(400, [`'${name}'은(는) 쓸 수 없는 이름이에요`]);
    const list = readCategories();
    if (list.includes(name) || load().apps.some((a) => a.category === name)) return bad(409, [`'${name}' 분류가 이미 있어요`]);
    return saveCategories([...list, name]);
  }

  function removeCategory(name) {
    if (load().apps.some((a) => a.category === name)) return bad(409, ['카드가 있는 분류는 지울 수 없어요. 카드를 다른 분류로 옮긴 뒤 지워 주세요']);
    return saveCategories(readCategories().filter((c) => c !== name));
  }

  // 직접 추가한 실행 이름표 — 수정 창에서 칩으로 골라 쓴다 (기본 이름표는 화면 쪽에 있다)
  function addLabel(raw) {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name || name.length > 20) return bad(400, ['이름표는 1~20자로 적어 주세요']);
    const list = readList(paths.labels);
    if (list.includes(name)) return bad(409, [`'${name}' 이름표가 이미 있어요`]);
    const next = [...list, name];
    fs.writeFileSync(paths.labels, JSON.stringify(next, null, 2));
    return { ok: true, labels: next };
  }

  function removeLabel(name) {
    if (load().apps.some((a) => allLaunches(a).some((x) => x.label === name))) return bad(409, ['카드에서 쓰는 이름표는 지울 수 없어요']);
    const next = readList(paths.labels).filter((x) => x !== name);
    fs.writeFileSync(paths.labels, JSON.stringify(next, null, 2));
    return { ok: true, labels: next };
  }

  // 한 폴더에서 앱이 여럿 나올 수 있다(공개판·로컬판 등). 폴더와 실행 대상이 둘 다 같아야 중복.
  const keysOf = (app) => allLaunches(app).map((x) => launchKey(x.launch));
  const sameSource = (apps, value, exceptId = null) => !!value.sourceDir && apps.some((a) => a.id !== exceptId
    && a.sourceDir === value.sourceDir && keysOf(a).some((k) => keysOf(value).includes(k)));

  function add(input) {
    const v = validateApp(input);
    if (!v.ok) return bad(400, v.errors);
    return mutate((apps) => {
      if (sameSource(apps, v.value)) {
        return bad(409, ['같은 원본 폴더에 실행 방법까지 같은 앱이 이미 있어요']);
      }
      const app = newApp(v.value, apps);
      apps.push(app);
      return { ok: true, app };
    });
  }

  function update(id, input) {
    const v = validateApp(input);
    if (!v.ok) return bad(400, v.errors);
    return mutate((apps) => {
      const i = apps.findIndex((a) => a.id === id);
      if (i < 0) return bad(404, ['앱을 찾지 못했어요']);
      if (sameSource(apps, v.value, id)) {
        return bad(409, ['같은 원본 폴더에 실행 방법까지 같은 앱이 이미 있어요']);
      }
      const old = apps[i];
      // 썸네일은 썸네일 API(setThumbnail)로만 바뀐다 — 수정 창이 연 시점의 옛 값으로 덮지 않게
      apps[i] = { ...old, ...v.value, id, thumbnail: old.thumbnail, createdAt: old.createdAt, lastLaunchedAt: old.lastLaunchedAt, updatedAt: now() };
      return { ok: true, app: apps[i] };
    });
  }

  function remove(id) {
    return mutate((apps) => {
      const i = apps.findIndex((a) => a.id === id);
      if (i < 0) return bad(404, ['앱을 찾지 못했어요']);
      const trashName = `${id}-${Date.now()}.json`;
      fs.writeFileSync(path.join(paths.trash, trashName), JSON.stringify(apps[i], null, 2));
      apps.splice(i, 1);
      return { ok: true, trashName };
    });
  }

  function restore(trashName) {
    if (!/^[A-Za-z0-9._-]+\.json$/.test(String(trashName))) return bad(400, ['휴지통 항목 이름이 올바르지 않아요']);
    const file = path.join(paths.trash, trashName);
    let app;
    try { app = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return bad(404, ['휴지통에서 찾지 못했어요']); }
    const r = mutate((apps) => {
      if (apps.some((a) => a.id === app.id)) return bad(409, ['같은 id의 앱이 이미 있어요']);
      apps.push(app);
      return { ok: true, app };
    });
    if (r.ok) fs.rmSync(file, { force: true });
    return r;
  }

  // 같은 원본 폴더의 카드 중 갱신할 것 고르기. 한 폴더에서 앱이 여럿 나올 수 있어서(공개판·로컬판 등)
  // 실행 대상이 같은 카드 → 없으면 그 폴더 카드가 하나뿐일 때만 그것(주소가 바뀐 재등록) → 아니면 새 카드.
  function pickSourceTarget(apps, value) {
    const same = apps.filter((a) => a.sourceDir === value.sourceDir);
    const key = launchKey(value.launch);
    return same.find((a) => keysOf(a).includes(key)) || (same.length === 1 ? same[0] : null);
  }

  function upsertBySourceDir(input, { asNew = false } = {}) {
    const v = validateApp(input);
    if (!v.ok) return bad(400, v.errors);
    if (!v.value.sourceDir) return bad(400, ['원본 폴더(sourceDir)가 필요해요']);
    return mutate((apps) => {
      const target = asNew ? null : pickSourceTarget(apps, v.value);
      const i = target ? apps.indexOf(target) : -1;
      if (i < 0) {
        const app = newApp(v.value, apps);
        apps.push(app);
        return { ok: true, app, action: 'added' };
      }
      const old = apps[i];
      const next = { ...old, ...v.value };
      // 추가 실행 목록을 안 주면 기존 것 유지. 들어온 실행이 추가 실행 중 하나와 같으면 그 실행만 갱신
      if (input.moreLaunches === undefined) {
        const more = old.moreLaunches || [];
        const j = more.findIndex((m) => launchKey(m.launch) === launchKey(v.value.launch));
        next.moreLaunches = more.map((m, k) => (k === j ? { ...m, launch: v.value.launch } : m));
        if (j >= 0) Object.assign(next, { launch: old.launch, launchLabel: old.launchLabel });
        else if (input.launchLabel === undefined) next.launchLabel = old.launchLabel || '';
      }
      // 썸네일을 새로 주지 않았으면 기존 것 유지
      apps[i] = { ...next, thumbnail: v.value.thumbnail || old.thumbnail, id: old.id,
        createdAt: old.createdAt, lastLaunchedAt: old.lastLaunchedAt, updatedAt: now() };
      return { ok: true, app: apps[i], action: 'updated' };
    });
  }

  function upsertByImportedFrom(input) {
    const v = validateApp(input);
    if (!v.ok) return bad(400, v.errors);
    if (!v.value.importedFrom) return bad(400, ['바로가기 경로(importedFrom)가 필요해요']);
    return mutate((apps) => {
      const found = apps.find((a) => a.importedFrom === v.value.importedFrom);
      if (found) return { ok: true, app: found, action: 'skipped', noWrite: true };
      const app = newApp(v.value, apps);
      apps.push(app);
      return { ok: true, app, action: 'added' };
    });
  }

  function patch(id, fields) {
    mutate((apps) => {
      const a = apps.find((x) => x.id === id);
      if (!a) return { ok: false };
      Object.assign(a, fields);
      return { ok: true };
    });
  }

  return {
    paths,
    load,
    list: () => load().apps,
    get: (id) => load().apps.find((a) => a.id === id) || null,
    add, update, remove, restore, upsertBySourceDir, upsertByImportedFrom,
    readOrder,
    writeOrder,
    readCategories,
    readLabels: () => readList(paths.labels),
    addLabel,
    removeLabel,
    readTabOrder: () => readList(paths.tabOrder),
    writeTabOrder,
    addCategory,
    removeCategory,
    findSourceTarget: (value) => ({ app: pickSourceTarget(load().apps, value) }),
    markLaunched: (id) => patch(id, { lastLaunchedAt: now() }),
    setThumbnail: (id, rel) => patch(id, { thumbnail: rel, updatedAt: now() }),
  };
}
