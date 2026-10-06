import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataHome, dataPaths, ensureDataDirs, readConfig, writeConfig, LAUNCHER_PORT, LOCAL_WEB_PORT } from '../server/paths.js';

test('포트 상수', () => {
  assert.equal(LAUNCHER_PORT, 4790);
  assert.equal(LOCAL_WEB_PORT, 4791);
});

test('dataHome: 환경 변수 우선, 없으면 ~/.config/my-app-launcher', () => {
  assert.equal(dataHome({ MY_APP_LAUNCHER_HOME: '/tmp/x' }), '/tmp/x');
  assert.equal(dataHome({}), path.join(os.homedir(), '.config', 'my-app-launcher'));
});

test('dataPaths: 파일·폴더 경로', () => {
  const p = dataPaths('/d');
  assert.deepEqual(p, {
    home: '/d', config: '/d/config.json', apps: '/d/apps.json', bak: '/d/apps.json.bak',
    lock: '/d/apps.json.lock', tmp: '/d/apps.json.tmp', thumbs: '/d/thumbs', logs: '/d/logs', trash: '/d/trash', order: '/d/order.json', categories: '/d/categories.json', tabOrder: '/d/tab-order.json', labels: '/d/labels.json',
  });
});

test('ensureDataDirs + config 읽기/쓰기', () => {
  const home = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mal-')), 'data');
  ensureDataDirs(home);
  for (const d of ['thumbs', 'logs', 'trash']) assert.ok(fs.statSync(path.join(home, d)).isDirectory());
  assert.deepEqual(readConfig(home), {});
  writeConfig(home, { launcherDir: '/home/me/projects/my-app-launcher' });
  assert.deepEqual(readConfig(home), { launcherDir: '/home/me/projects/my-app-launcher' });
  fs.writeFileSync(path.join(home, 'config.json'), '{깨짐');
  assert.deepEqual(readConfig(home), {});
});
