import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES } from '../src/rules/config.js';
import { createHeadFollower, createRainEnvelope, headEllipse } from '../src/rules/effects.js';
import { createBlessingRain } from '../src/app/blessingRain.js';

const cfg = RULES.rain;
const STEP = 16;

function run(env, state, ms, from) {
  let last;
  for (let t = from; t <= from + ms; t += STEP) last = env.update(t, state);
  return { last, t: from + ms };
}

test('雨量：微笑开始先有一点雨，随持续时间逐渐加大到满', () => {
  const env = createRainEnvelope(cfg);
  env.update(0, 'idle');
  const first = env.update(STEP, 'smile');
  assert.ok(first.emission >= cfg.startLevel && first.emission < 0.4);
  const half = run(env, 'smile', cfg.rampMs / 2, STEP).last;
  assert.ok(half.emission > first.emission && half.emission < 1);
  const full = run(env, 'smile', cfg.rampMs * 2, STEP + cfg.rampMs / 2).last;
  assert.equal(full.emission, 1);
  assert.equal(full.glow, 1);
});

test('雨量：微笑结束后 300–500ms 内停止生成新雨滴，已有雨滴 1 秒内消失', () => {
  const env = createRainEnvelope(cfg);
  const { t } = run(env, 'smile', 3000, 0);
  const endStep = env.update(t + STEP, 'idle');
  assert.equal(endStep.ended, true, '结束那一刻要发出信号，用来放余光');
  let emissionZeroAt = null;
  let residualZeroAt = null;
  for (let now = t + STEP; now <= t + 2000; now += STEP) {
    const e = env.update(now, 'idle');
    if (emissionZeroAt === null && e.emission === 0) emissionZeroAt = now - t;
    if (residualZeroAt === null && e.residual === 0) residualZeroAt = now - t;
  }
  assert.ok(emissionZeroAt >= 300 && emissionZeroAt <= 520, `生成停止于 ${emissionZeroAt}ms`);
  assert.ok(residualZeroAt >= 600 && residualZeroAt <= 1020, `雨滴消失于 ${residualZeroAt}ms`);
});

test('雨量：微笑直接转入大笑，雨更快收住，不发“结束”余光', () => {
  const env = createRainEnvelope(cfg);
  const { t } = run(env, 'smile', 3000, 0);
  const step = env.update(t + STEP, 'laugh');
  assert.equal(step.ended, false);
  let emissionZeroAt = null;
  let residualZeroAt = null;
  for (let now = t + STEP; now <= t + 1500; now += STEP) {
    const e = env.update(now, 'laugh');
    if (emissionZeroAt === null && e.emission === 0) emissionZeroAt = now - t;
    if (residualZeroAt === null && e.residual === 0) residualZeroAt = now - t;
  }
  assert.ok(emissionZeroAt <= 200, `生成停止于 ${emissionZeroAt}ms`);
  assert.ok(residualZeroAt <= 400, `雨滴消失于 ${residualZeroAt}ms`);
});

test('雨量：待机时没有任何雨', () => {
  const env = createRainEnvelope(cfg);
  const e = run(env, 'idle', 2000, 0).last;
  assert.deepEqual([e.emission, e.residual, e.glow, e.active], [0, 0, 0, false]);
});

test('头部椭圆：比人脸框略大并向上偏，盖住头发', () => {
  const box = { cx: 0.5, cy: 0.5, width: 0.3, height: 0.4 };
  const e = headEllipse(box, 640, 480);
  assert.ok(e.rx > 0.15 * 640 && e.ry > 0.2 * 480);
  assert.ok(e.cy < 0.5 * 480);
});

test('头部跟随：平滑追向识别结果，并估算头部速度；短暂丢脸保留位置', () => {
  const f = createHeadFollower(RULES.head);
  f.update({ cx: 100, cy: 100, rx: 50, ry: 60 }, 16);
  let h;
  for (let i = 0; i < 10; i += 1) h = f.update({ cx: 200, cy: 100, rx: 50, ry: 60 }, 16);
  assert.ok(h.cx > 150 && h.cx < 200);
  assert.ok(h.vx > 0, '向右移动时速度为正');
  assert.ok(f.update(null, 100), '丢脸 100ms 仍保留');
  assert.equal(f.update(null, RULES.head.holdMs + 10), null);
});

const region = { left: 0, width: 640 };
const height = 480;
const full = { emission: 1, glow: 1, residual: 1, ended: false };

test('光雨：持续微笑时雨滴数量不超过上限，星光也有上限', () => {
  const rain = createBlessingRain(cfg);
  const head = { cx: 320, cy: 300, rx: 90, ry: 110, vx: 0, vy: 0 };
  for (let i = 0; i < 600; i += 1) rain.update(STEP / 1000, { envelope: full, head, region, height });
  assert.ok(rain.dropCount > 0 && rain.dropCount <= cfg.maxDrops);
  assert.ok(rain.sparkleCount <= cfg.maxSparkles);
});

test('光雨：雨滴碰到头部化作星光，不会穿过头部', () => {
  const rain = createBlessingRain(cfg);
  const head = { cx: 320, cy: 200, rx: 200, ry: 150, vx: 0, vy: 0 };
  for (let i = 0; i < 120; i += 1) rain.update(STEP / 1000, { envelope: full, head, region, height });
  assert.ok(rain.sparkleCount > 0, '应该有雨滴撞到头上变成星光');
});

test('光雨：没有人脸时也能下雨，只是不产生星光', () => {
  const rain = createBlessingRain(cfg);
  for (let i = 0; i < 120; i += 1) rain.update(STEP / 1000, { envelope: full, head: null, region, height });
  assert.ok(rain.dropCount > 0);
  assert.equal(rain.sparkleCount, 0);
});

test('光雨：停止生成后，已有雨滴自然落出画面', () => {
  const rain = createBlessingRain(cfg);
  for (let i = 0; i < 60; i += 1) rain.update(STEP / 1000, { envelope: full, head: null, region, height });
  const off = { emission: 0, glow: 0, residual: 0.5, ended: false };
  for (let i = 0; i < 220; i += 1) rain.update(STEP / 1000, { envelope: off, head: null, region, height });
  assert.equal(rain.dropCount, 0);
});

test('光雨：微笑结束时在头部轮廓留下短暂余光，随后熄灭', () => {
  const rain = createBlessingRain(cfg);
  const head = { cx: 320, cy: 300, rx: 90, ry: 110, vx: 0, vy: 0 };
  rain.update(STEP / 1000, { envelope: full, head, region, height });
  rain.update(STEP / 1000, { envelope: { emission: 0, glow: 0.9, residual: 0.9, ended: true }, head, region, height });
  assert.ok(rain.sparkleCount >= cfg.afterglowMotes);
  const off = { emission: 0, glow: 0, residual: 0, ended: false };
  for (let i = 0; i < 200; i += 1) rain.update(STEP / 1000, { envelope: off, head, region, height });
  assert.equal(rain.active, false);
});

test('光雨：clear 后清空所有粒子', () => {
  const rain = createBlessingRain(cfg);
  for (let i = 0; i < 60; i += 1) rain.update(STEP / 1000, { envelope: full, head: null, region, height });
  rain.clear();
  assert.equal(rain.dropCount, 0);
  assert.equal(rain.active, false);
});

test('光雨：雨完全淡出后，空中剩下的雨滴立即回收', () => {
  const rain = createBlessingRain(cfg);
  for (let i = 0; i < 60; i += 1) rain.update(STEP / 1000, { envelope: full, head: null, region, height });
  assert.ok(rain.dropCount > 0);
  rain.update(STEP / 1000, { envelope: { emission: 0, glow: 0, residual: 0, ended: false }, head: null, region, height });
  assert.equal(rain.dropCount, 0);
});
