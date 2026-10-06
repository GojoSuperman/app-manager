import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitScales, initialView, rotate, zoomTo, sliderToScale, scaleToSlider, drawSteps } from '../public/image-edit.js';

// 배율은 '출력 너비 1px당' 기준(정규화) — 미리보기·저장 크기가 달라도 같은 그림
test('fitScales: 16:9 틀에 채우기(cover)·전체 보기(contain), 90도 돌리면 가로세로 바뀜', () => {
  const s = fitScales(1600, 900, 0); // 이미지도 16:9
  assert.ok(Math.abs(s.cover - 1 / 1600) < 1e-12);
  assert.ok(Math.abs(s.contain - 1 / 1600) < 1e-12);
  const tall = fitScales(900, 1600, 0); // 세로 사진
  assert.ok(Math.abs(tall.cover - 1 / 900) < 1e-12); // 너비를 채움
  assert.ok(Math.abs(tall.contain - (9 / 16) / 1600) < 1e-12); // 높이에 맞춤
  const turned = fitScales(900, 1600, 90); // 돌리면 16:9처럼
  assert.ok(Math.abs(turned.cover - 1 / 1600) < 1e-12);
});

test('initialView: 기본은 꽉 채우기, 가운데, 회전·반전 없음', () => {
  const v = initialView(1280, 800);
  assert.deepEqual({ ...v, scale: 0 }, { iw: 1280, ih: 800, rot: 0, flipX: false, flipY: false, ox: 0, oy: 0, scale: 0 });
  assert.equal(v.scale, fitScales(1280, 800, 0).cover);
});

test('rotate: 90도씩, 돌린 뒤 다시 꽉 채우기', () => {
  let v = initialView(900, 1600);
  v = rotate(v, 90);
  assert.equal(v.rot, 90);
  assert.equal(v.scale, fitScales(900, 1600, 90).cover);
  assert.equal(rotate(rotate(v, -90), -90).rot, 270);
});

test('zoom 슬라이더: 0=전체 보기, 50=꽉 채우기, 100=채우기의 4배 / 왕복', () => {
  const v = initialView(1600, 900 * 1.5); // 채우기와 전체 보기가 다른 그림
  const { cover, contain } = fitScales(v.iw, v.ih, 0);
  assert.ok(Math.abs(sliderToScale(v, 0) - contain) < 1e-12);
  assert.ok(Math.abs(sliderToScale(v, 50) - cover) < 1e-12);
  assert.ok(Math.abs(sliderToScale(v, 100) - cover * 4) < 1e-12);
  assert.ok(Math.abs(scaleToSlider(v, sliderToScale(v, 37)) - 37) < 1e-9);
  assert.equal(zoomTo(v, 50).scale, sliderToScale(v, 50));
});

test('drawSteps: 반전은 화면 기준(회전보다 바깥), 위치·배율은 출력 너비에 비례', () => {
  const v = { ...initialView(100, 50), rot: 90, flipX: true, ox: 0.1, oy: -0.05, scale: 0.01 };
  assert.deepEqual(drawSteps(v, 640, 360), [
    ['translate', 320 + 64, 180 - 32],
    ['scale', -1, 1],
    ['rotate', Math.PI / 2],
    ['scale', 6.4, 6.4],
    ['drawImage', -50, -25],
  ]);
});
