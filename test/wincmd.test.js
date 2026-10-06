import { test } from 'node:test';
import assert from 'node:assert/strict';
import { psQuote, winQuoteArg, joinWinArgs, splitWinArgs } from '../server/wincmd.js';

test('psQuote: 작은따옴표와 둥근 따옴표 이스케이프', () => {
  assert.equal(psQuote('abc'), "'abc'");
  assert.equal(psQuote("it's"), "'it''s'");
  assert.equal(psQuote('a’b'), "'a’’b'");
  assert.equal(psQuote('C:\\Users\\me\\내 앱'), "'C:\\Users\\me\\내 앱'");
});

test('winQuoteArg: 필요할 때만 따옴표, 역슬래시 규칙', () => {
  assert.equal(winQuoteArg('--path'), '--path');
  assert.equal(winQuoteArg('\\\\wsl.localhost\\Ubuntu\\home\\me'), '\\\\wsl.localhost\\Ubuntu\\home\\me');
  assert.equal(winQuoteArg(''), '""');
  assert.equal(winQuoteArg('C:\\내 앱\\run.bat'), '"C:\\내 앱\\run.bat"');
  assert.equal(winQuoteArg('C:\\a b\\'), '"C:\\a b\\\\"');
  assert.equal(winQuoteArg('say "hi"'), '"say \\"hi\\""');
});

test('splitWinArgs: 실제 바로가기 인자 모양', () => {
  assert.deepEqual(
    splitWinArgs('--profile-directory="Default" --ignore-profile-directory-if-not-exists https://example.com/'),
    ['--profile-directory=Default', '--ignore-profile-directory-if-not-exists', 'https://example.com/']);
  assert.deepEqual(splitWinArgs(' --profile-directory=Default --app-id=abcdefghijklmnopabcdefghijklmnop'),
    ['--profile-directory=Default', '--app-id=abcdefghijklmnopabcdefghijklmnop']);
  assert.deepEqual(splitWinArgs('"C:\\Users\\me\\app\\start.vbs"'), ['C:\\Users\\me\\app\\start.vbs']);
  assert.deepEqual(splitWinArgs('--path \\\\wsl.localhost\\Ubuntu\\home\\me\\game'),
    ['--path', '\\\\wsl.localhost\\Ubuntu\\home\\me\\game']);
  assert.deepEqual(splitWinArgs('-- bash -lc "/home/me/projects/office/start.sh"'),
    ['--', 'bash', '-lc', '/home/me/projects/office/start.sh']);
  assert.deepEqual(splitWinArgs(''), []);
  assert.deepEqual(splitWinArgs('a ""'), ['a', '']);
});

test('왕복: split(join(args)) === args', () => {
  const samples = [
    ['--path', '\\\\wsl.localhost\\Ubuntu\\home\\me\\내 게임'],
    ['C:\\a b\\', 'x"y', '', 'tab\there', 'end\\'],
    ['-NoProfile', '-File', 'C:\\Users\\me\\AppData\\Local\\도구\\launch.ps1'],
    ["it's", '%PATH%', '&', '^'],
  ];
  for (const s of samples) assert.deepEqual(splitWinArgs(joinWinArgs(s)), s);
});
