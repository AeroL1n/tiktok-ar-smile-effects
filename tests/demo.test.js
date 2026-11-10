import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_SCRIPT, createDemoInput, scriptedState, viewToCanvas } from '../src/rules/demo.js';
import { bodyShapes, hitShape } from '../src/rules/effects.js';
import { RULES } from '../src/rules/config.js';
import { createBlessingRain } from '../src/app/blessingRain.js';

test('自动演示剧本：按顺序经过等待、微笑、停止、微笑、大笑，并循环', () => {
  const seen = [];
  const total = DEMO_SCRIPT.reduce((s, [, ms]) => s + ms, 0);
  for (let t = 0; t < total; t += 100) {
    const s = scriptedState(t);
    if (seen.at(-1) !== s) seen.push(s);
  }
  assert.deepEqual(seen, ['idle', 'smile', 'idle', 'smile', 'laugh', 'idle']);
  assert.equal(scriptedState(total + 50), 'idle');
  assert.equal(scriptedState(1600), 'smile');
});

test('碰撞体：头部和肩膀，肩膀在头下方且更宽', () => {
  const [headShape, shoulders] = bodyShapes({ cx: 300, cy: 300, rx: 80, ry: 100 });
  assert.equal(headShape.part, 'head');
  assert.equal(shoulders.part, 'shoulders');
  assert.ok(shoulders.cy > headShape.cy + headShape.ry);
  assert.ok(shoulders.rx > headShape.rx * 2);
});

test('碰撞体：头顶和肩上的点能命中，头旁边的空白处不命中', () => {
  const shapes = bodyShapes({ cx: 300, cy: 300, rx: 80, ry: 100 });
  assert.equal(hitShape(300, 210, shapes)?.part, 'head');
  assert.equal(hitShape(150, 460, shapes)?.part, 'shoulders');
  assert.equal(hitShape(140, 250, shapes), null);
  assert.equal(hitShape(300, 50, shapes), null);
});

test('光雨：雨滴落到肩膀上也会停下，不会穿过肩膀落到画面底部', () => {
  const rain = createBlessingRain(RULES.rain);
  const head = { cx: 320, cy: 120, rx: 60, ry: 75, vx: 0, vy: 0 };
  const env = { emission: 1, glow: 1, residual: 1, ended: false };
  const region = { left: 0, width: 640 };
  const shoulders = bodyShapes(head)[1];
  for (let i = 0; i < 200; i += 1) rain.update(0.016, { envelope: env, head, region, height: 900 });
  assert.ok(rain.dropCount > 0);
  assert.equal(rain.dropsBelow(shoulders.cx - shoulders.rx * 0.5, shoulders.cx + shoulders.rx * 0.5, shoulders.cy), 0);
});

test('演示输入：默认自动演示，可切换成固定状态', () => {
  const demo = createDemoInput({ width: 540, height: 960 });
  assert.equal(demo.mode, 'auto');
  assert.equal(demo.update(1600).state, 'smile');
  demo.setMode('laugh');
  assert.equal(demo.update(0).state, 'laugh');
});

test('演示输入：拖动时假人跟随指针，不再自动轻晃；松手后从新位置继续晃', () => {
  const demo = createDemoInput({ width: 540, height: 960 });
  demo.dragTo(200, 500);
  const a = demo.update(1000).target;
  const b = demo.update(2400).target;
  assert.deepEqual([a.cx, a.cy], [200, 500]);
  assert.equal(b.cx, 200);
  demo.endDrag(3000);
  assert.equal(demo.update(3000).target.cx, 200);
  assert.notEqual(demo.update(4000).target.cx, 200);
});

test('演示输入：假人不会被拖出画面，大小有上下限', () => {
  const demo = createDemoInput({ width: 540, height: 960 });
  demo.setSway(false);
  demo.dragTo(-500, 5000);
  const t = demo.update(0).target;
  assert.ok(t.cx >= 540 * 0.1 && t.cy <= 960 * 0.8);
  demo.setScale(10);
  const big = demo.update(0).target.rx;
  demo.setScale(0.01);
  const small = demo.update(0).target.rx;
  assert.ok(big / small <= 3.3);
});

test('指针坐标换算：考虑铺满裁切和镜像', () => {
  const view = { width: 360, height: 640 };
  const canvas = { width: 540, height: 960 };
  const center = viewToCanvas(180, 320, view, canvas);
  assert.ok(Math.abs(center.x - 270) < 1e-9 && Math.abs(center.y - 480) < 1e-9);
  const left = viewToCanvas(0, 0, view, canvas);
  assert.ok(Math.abs(left.x - 540) < 1e-9, '镜像后屏幕左边对应画布右边');
  const plain = viewToCanvas(0, 0, view, canvas, false);
  assert.ok(Math.abs(plain.x) < 1e-9);
});
