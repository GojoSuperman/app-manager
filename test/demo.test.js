import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDemoHome } from '../scripts/demo.mjs';
import { createStore } from '../server/store.js';

test('buildDemoHome: 예시 카드 8장·썸네일·로컬 웹 절대 경로·분류 탭, 내 데이터와 따로', () => {
  const examples = path.join(import.meta.dirname, '..', 'examples');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'app-manager-demo-test-'));
  buildDemoHome({ examplesDir: examples, home });
  const store = createStore(home);
  const apps = store.list();
  assert.equal(apps.length, 8);
  const weather = apps.find((a) => a.launch.type === 'local-web');
  assert.equal(weather.launch.dir, path.join(examples, 'sites', 'weather'));
  assert.ok(fs.existsSync(path.join(home, weather.thumbnail)));
  assert.equal(apps.filter((a) => a.thumbnail).length, 7);
  assert.equal(apps.find((a) => a.needsReview).name, '독서 기록');
  assert.deepEqual(store.readCategories(), ['개발']);
  // 다시 만들면 처음부터 (중복 없이)
  buildDemoHome({ examplesDir: examples, home });
  assert.equal(createStore(home).list().length, 8);
});
