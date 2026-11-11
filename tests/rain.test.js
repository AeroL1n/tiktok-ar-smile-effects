import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES } from '../src/rules/config.js';
import { bodyShapes, createHeadFollower, createRainEnvelope, headEllipse, rainZone, rainbowPlacement, shoulderTopAt } from '../src/rules/effects.js';
import { createBlessingRain } from '../src/app/blessingRain.js';

const cfg = RULES.rain;
const STEP = 16;

function run(env, state, ms, from) {
  let last;
  for (let t = from; t <= from + ms; t += STEP) last = env.update(t, state);
  return { last, t: from + ms };
}

test('开场：先起雾，约 0.3 秒后落几颗，约 1 秒内展开成轻雨，之后持续微笑不再加密', () => {
  const env = createRainEnvelope(cfg);
  env.update(0, 'idle');
  const first = env.update(STEP, 'smile');
  assert.equal(first.started, true);
  assert.equal(first.phase, 'opening');
  assert.equal(first.emission, 0, '先起雾，还没有雨');
  const misty = run(env, 'smile', cfg.mistLeadMs - 2 * STEP, STEP).last;
  assert.equal(misty.emission, 0);
  assert.ok(misty.glow > 0.8, '雾已经起来了');
  const early = run(env, 'smile', cfg.mistLeadMs + cfg.openMs - 2 * STEP, STEP).last;
  assert.equal(early.emission, cfg.openLevel, '开场只落几颗');
  const open = run(env, 'smile', cfg.mistLeadMs + cfg.openMs + cfg.spreadMs + 50, STEP).last;
  assert.equal(open.phase, 'raining');
  assert.equal(open.emission, 1);
  const later = run(env, 'smile', 8000, STEP + cfg.mistLeadMs + cfg.openMs + cfg.spreadMs);
  assert.equal(later.last.emission, 1, '持续微笑雨量不再变化');
  assert.equal(later.last.started, false, '不重播开场');
});

test('收尾顺序：雨先停，彩虹再淡出，雾最后散', () => {
  const env = createRainEnvelope(cfg);
  const { t } = run(env, 'smile', 3000, 0);
  let rainOff = null;
  let bowOff = null;
  let mistOff = null;
  for (let now = t + STEP; now <= t + cfg.tailMs; now += STEP) {
    const e = env.update(now, 'idle');
    if (rainOff === null && e.emission === 0) rainOff = now;
    if (bowOff === null && e.rainbow === 0) bowOff = now;
    if (mistOff === null && e.glow === 0) mistOff = now;
  }
  assert.ok(rainOff < bowOff && bowOff < mistOff, `雨 ${rainOff - t} / 彩虹 ${bowOff - t} / 雾 ${mistOff - t} ms`);
});

test('雨量：开场 0.4 秒内只生成 3–6 颗雨滴', () => {
  const expected = cfg.dropsPerSecond * cfg.openLevel * (cfg.openMs / 1000);
  assert.ok(expected >= 3 && expected <= 6, `开场约 ${expected} 颗`);
});

test('彩虹：雨开始约 0.6 秒后才出现，再慢慢变清楚', () => {
  const env = createRainEnvelope(cfg);
  const before = run(env, 'smile', cfg.rainbowDelayMs - STEP, 0).last;
  assert.equal(before.rainbow, 0);
  const after = run(env, 'smile', cfg.rainbowInMs + 200, cfg.rainbowDelayMs).last;
  assert.equal(after.rainbow, 1);
});

test('收尾：停止生成，已有雨滴保持可见、自然落完，彩虹柔和淡出', () => {
  const env = createRainEnvelope(cfg);
  const { t } = run(env, 'smile', 3000, 0);
  const endStep = env.update(t + STEP, 'idle');
  assert.equal(endStep.ended, true, '结束那一刻发出信号，用来放余光');
  assert.equal(endStep.phase, 'ending');
  const mid = run(env, 'idle', cfg.decayMs + 50, t + STEP).last;
  assert.equal(mid.emission, 0, '停止生成新雨滴');
  assert.equal(mid.residual, 1, '已有雨滴不突然消失');
  assert.ok(mid.rainbow > 0 && mid.rainbow < 1, '彩虹正在淡出');
  const done = run(env, 'idle', cfg.tailMs + 50, t + STEP).last;
  assert.equal(done.phase, 'idle');
  assert.deepEqual([done.rainbow, done.glow, done.residual, done.active], [0, 0, 0, false]);
});

test('接续：收尾期间再次微笑，从当前雨量接着下，不重播开场', () => {
  const env = createRainEnvelope(cfg);
  let { t } = run(env, 'smile', 3000, 0);
  ({ t } = run(env, 'idle', 200, t + STEP));
  const back = env.update(t + STEP, 'smile');
  assert.equal(back.started, false);
  assert.equal(back.phase, 'raining');
  assert.ok(back.emission > 0, '从当前雨量接着下');
  assert.ok(back.rainbow > 0.5, '彩虹没有重新从零开始');
  const later = run(env, 'smile', cfg.resumeMs + 100, t + STEP).last;
  assert.equal(later.emission, 1);
});

test('接续：完全结束后再微笑，重新开场', () => {
  const env = createRainEnvelope(cfg);
  let { t } = run(env, 'smile', 3000, 0);
  ({ t } = run(env, 'idle', cfg.tailMs + 200, t + STEP));
  const again = env.update(t + STEP, 'smile');
  assert.equal(again.started, true);
  assert.equal(again.phase, 'opening');
  assert.equal(again.emission, 0, '重新开场，先起雾');
});

test('转入大笑：雨和彩虹快速收住，不放收尾余光', () => {
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
  assert.ok(residualZeroAt <= 420, `雨滴消失于 ${residualZeroAt}ms`);
  assert.equal(env.update(t + 1500, 'laugh').rainbow, 0);
});

test('雨量：待机时没有任何雨', () => {
  const env = createRainEnvelope(cfg);
  const e = run(env, 'idle', 2000, 0).last;
  assert.deepEqual([e.emission, e.residual, e.glow, e.rainbow, e.active], [0, 0, 0, 0, false]);
});

test('生成区：在头顶上方；头贴近画面顶部时下移到可见画面以内', () => {
  const head = { cx: 300, cy: 400, rx: 80, ry: 100 };
  const z = rainZone(head, cfg, { top: 0 });
  assert.ok(z.y1 < head.cy - head.ry, '在头顶上方');
  assert.ok(z.y0 >= head.cy - head.ry * 2.2, '头顶上方约一个头高的“雨云”');
  const near = rainZone({ ...head, cy: 110 }, cfg, { top: 30 });
  assert.ok(near.y0 >= 30 && near.y1 > near.y0);
});

test('彩虹：用两个端点贴着头顶——左端在发缝上方，右端落在右侧太阳穴上方的头发轮廓附近；随脸缩放，限制在画面内', () => {
  const view = { left: 0, width: 540, top: 0, height: 960 };
  const head = { cx: 270, cy: 400, rx: 90, ry: 112 };
  const top = head.cy - head.ry;
  const p = rainbowPlacement(head, cfg.rainbow, view);
  assert.ok(Math.abs(p.left.x - head.cx) < head.rx * 0.3 && p.left.y < top, '左端在头顶中线附近、头发上方');
  assert.ok(p.right.x > head.cx + head.rx * 0.6 && p.right.y > top, '右端在右侧、比头顶低');
  const ex = (p.right.x - head.cx) / head.rx;
  const ey = (p.right.y - head.cy) / head.ry;
  assert.ok(Math.abs(Math.hypot(ex, ey) - 1) < 0.25, '右端贴着头部轮廓');
  const apexY = p.cy - p.r;
  assert.ok(apexY > top - head.ry * 0.8, '弧顶离头顶不远');
  const small = rainbowPlacement({ ...head, rx: 45, ry: 56 }, cfg.rainbow, view);
  assert.ok(Math.abs(small.r - p.r / 2) < 1e-6, '随脸缩放');
  const edge = rainbowPlacement({ cx: 500, cy: 90, rx: 90, ry: 112 }, cfg.rainbow, view);
  for (let k = 0; k <= 8; k += 1) {
    const a = edge.tilt - (cfg.rainbow.spanDeg * Math.PI) / 360 + ((cfg.rainbow.spanDeg * Math.PI) / 180) * (k / 8);
    const x = edge.cx + Math.cos(a) * edge.r;
    const y = edge.cy + Math.sin(a) * edge.r;
    assert.ok(x >= 0 && x <= view.width, '不出左右边');
    assert.ok(y - edge.band >= view.top - 1e-6, '不出上边');
  }
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


const view = { left: 0, width: 540, top: 0, height: 960 };
const head = { cx: 270, cy: 420, rx: 90, ry: 112, vx: 0, vy: 0 };
const smile = { phase: 'raining', emission: 1, rainbow: 1, glow: 1, residual: 1, started: false, ended: false };
const tail = { phase: 'ending', emission: 0, rainbow: 0.5, glow: 0.5, residual: 1, started: false, ended: false };
const steps = (rain, n, args) => { for (let i = 0; i < n; i += 1) rain.update(STEP / 1000, args); };

test('光雨：持续微笑时雨滴和水花都不超过上限', () => {
  const rain = createBlessingRain(cfg);
  steps(rain, 600, { envelope: smile, head, view });
  assert.ok(rain.dropCount > 0 && rain.dropCount <= cfg.maxDrops);
  assert.ok(rain.splashCount <= cfg.maxSplashes);
});

test('光雨：轻雨同屏约 30–60 颗', () => {
  const rain = createBlessingRain(cfg);
  steps(rain, 300, { envelope: smile, head, view });
  let sum = 0;
  for (let i = 0; i < 120; i += 1) {
    rain.update(STEP / 1000, { envelope: smile, head, view });
    sum += rain.dropCount;
  }
  const avg = sum / 120;
  assert.ok(avg >= 30 && avg <= 60, `平均 ${avg.toFixed(1)} 颗`);
});

test('光雨：只在头部周围——从头顶上方生成，横向不超出约 2 倍脸宽；肩膀上方的雨落到肩上才处理，外侧的雨落到画面底部附近才消失', () => {
  const rain = createBlessingRain(cfg);
  const shoulders = bodyShapes(head)[1];
  for (let i = 0; i < 400; i += 1) {
    rain.update(STEP / 1000, { envelope: smile, head, view });
    const b = rain.dropBounds();
    if (!b) continue;
    assert.ok(b.y0 >= head.cy - head.ry * (1 + cfg.zoneTop) - 1, '不从画面顶部落下');
    // 每颗雨有 ±slant 的倾斜，肩膀外侧的雨一路落到画面底部，横向会多走出约 0.8 个 rx。
    const reach = (cfg.zoneHalfWidth + 0.9) * head.rx;
    assert.ok(b.x0 >= head.cx - reach && b.x1 <= head.cx + reach, '不铺满全屏');
    for (const d of rain.snapshot()) {
      if (d.form === 2) continue;
      const top = shoulderTopAt(shoulders, d.x);
      if (top !== null) assert.ok(d.y < top + head.ry * (cfg.shoulderBand + 0.05), '肩膀上方的雨不会穿过肩膀');
    }
  }
});
test('光雨：落到头发和肩膀上都有反馈，雨不会穿过头部', () => {
  const rain = createBlessingRain(cfg);
  let maxSplash = 0;
  for (let i = 0; i < 900; i += 1) {
    rain.update(STEP / 1000, { envelope: smile, head, view });
    maxSplash = Math.max(maxSplash, rain.splashCount);
    assert.equal(rain.dropsBelow(head.cx - head.rx * 0.6, head.cx + head.rx * 0.6, head.cy - head.ry * 0.7), 0, '头顶的雨不会穿过头部');
  }
  assert.ok(rain.hairHits > 0, '有雨落到头发上');
  assert.ok(rain.shoulderHits > 0, '有雨落到肩膀上');
  assert.ok(maxSplash > 0 && maxSplash <= cfg.maxSplashes, `同屏水花最多 ${maxSplash} 个`);
  assert.ok(cfg.hairSplash + cfg.hairStar < 1 && cfg.shoulderBreak + cfg.shoulderSlide < 1, '各有一部分被吸收');
});

test('光雨：雨在空中不提前躲人，碰到了才有反馈；两侧的雨从头发轮廓外侧落过', () => {
  const rain = createBlessingRain(cfg);
  for (let i = 0; i < 300; i += 1) {
    rain.update(STEP / 1000, { envelope: smile, head, view });
    for (const d of rain.snapshot()) assert.ok(Math.abs(d.vx) <= d.vy * Math.tan(cfg.slant) + 1e-3, '只有自己的轻微倾斜');
  }
  assert.ok(cfg.sideInner >= 1, '两侧的雨不贴着耳朵生成');
  assert.ok(cfg.centerShare >= 0.4, '头顶的雨足够多');
});
test('光雨：有珠串雨线、单颗雨滴和远景小雨丝三种形态；珠串上有 2–4 颗珠子', () => {
  const rain = createBlessingRain(cfg);
  const seen = new Set();
  for (let i = 0; i < 300; i += 1) {
    rain.update(STEP / 1000, { envelope: smile, head, view });
    for (const d of rain.snapshot()) {
      seen.add(d.form);
      if (d.form === 0) assert.ok(d.count >= 2 && d.count <= 4);
    }
  }
  assert.deepEqual([...seen].sort(), [0, 1, 2]);
});

test('光雨：脸的范围内不画雨，脸外一圈渐变过渡', () => {
  const rain = createBlessingRain(cfg);
  steps(rain, 10, { envelope: smile, head, view });
  assert.equal(rain.faceFadeAt(head.cx, head.cy + head.ry * 0.15, head), 0, '脸中间');
  assert.equal(rain.faceFadeAt(head.cx + head.rx * 0.7, head.cy + head.ry * 0.15, head), 0, '脸颊');
  assert.equal(rain.faceFadeAt(head.cx + head.rx * 1.4, head.cy, head), 1, '头外侧');
  const mid = rain.faceFadeAt(head.cx + head.rx * 0.95, head.cy + head.ry * 0.15, head);
  assert.ok(mid > 0 && mid < 1, '中间有过渡');
});

test('光雨：雨落得舒展，每秒约 0.8–1.4 个头高；远景雨丝最慢', () => {
  const rain = createBlessingRain(cfg);
  steps(rain, 30, { envelope: smile, head, view });
  const all = rain.snapshot();
  assert.ok(all.length > 5);
  const headHeight = head.ry * 2;
  for (const d of all) assert.ok(d.vy >= headHeight * 0.8 && d.vy <= headHeight * 1.4, `速度 ${(d.vy / headHeight).toFixed(2)} 个头高/秒`);
  assert.ok(cfg.forms.fine.speed[1] <= cfg.forms.drop.speed[0] + 0.2);
});

test('水雾：先于雨出现，人脸丢失时淡出；水汽光点有上限', () => {
  const rain = createBlessingRain(cfg);
  steps(rain, 200, { envelope: smile, head, view });
  assert.ok(rain.mistVisible > 0.9);
  assert.ok(rain.moteCount <= cfg.maxMotes);
  steps(rain, Math.ceil(cfg.lostFadeMs / STEP) + 2, { envelope: smile, head: null, view });
  assert.equal(rain.mistVisible, 0);
});

test('光雨：生成区跟随头部，已经落下的雨滴不跟着头走', () => {
  const rain = createBlessingRain(cfg);
  steps(rain, 120, { envelope: smile, head, view });
  const before = rain.dropBounds();
  const moved = { ...head, cx: head.cx + 150 };
  rain.update(STEP / 1000, { envelope: smile, head: moved, view });
  const after = rain.dropBounds();
  assert.ok(after.x0 < moved.cx - cfg.zoneHalfWidth * moved.rx, '旧雨滴还在原来的位置');
  assert.ok(Math.abs(after.x0 - before.x0) < 10);
  // 肩膀外侧的旧雨要一路落到画面底部，约 3 秒。
  steps(rain, 260, { envelope: smile, head: moved, view });
  const later = rain.dropBounds();
  assert.ok(later.x0 > head.cx - cfg.zoneHalfWidth * head.rx + 100, '新雨滴在新位置生成');
});

test('光雨：收尾时停止生成，已有雨滴自然落完；结束时沿头顶留下几颗余光', () => {
  const rain = createBlessingRain(cfg);
  steps(rain, 120, { envelope: smile, head, view });
  const before = rain.splashCount;
  rain.update(STEP / 1000, { envelope: { ...tail, ended: true }, head, view });
  assert.ok(rain.splashCount >= Math.min(cfg.maxSplashes, before + cfg.afterglowMotes) - 3, '放出余光');
  const n = rain.dropCount;
  assert.ok(n > 0);
  steps(rain, Math.ceil(cfg.tailMs / STEP), { envelope: tail, head, view });
  assert.equal(rain.dropCount, 0, `收尾 ${cfg.tailMs}ms 内雨滴全部落完`);
});

test('光雨：人脸丢失时不再生成新雨滴，彩虹淡出，效果自然结束', () => {
  const rain = createBlessingRain(cfg);
  steps(rain, 120, { envelope: smile, head, view });
  assert.ok(rain.rainbowVisible > 0.9);
  steps(rain, Math.ceil(cfg.lostFadeMs / STEP) + 2, { envelope: smile, head: null, view });
  assert.equal(rain.rainbowVisible, 0);
  steps(rain, 120, { envelope: smile, head: null, view });
  assert.equal(rain.dropCount, 0);
});

test('光雨：换人后雨不滑到新的人头上，下一次开场才在新的人头上展开', () => {
  const rain = createBlessingRain(cfg);
  steps(rain, 120, { envelope: smile, head, view });
  rain.detach();
  const other = { ...head, cx: 120 };
  steps(rain, 180, { envelope: smile, head: other, view });
  assert.equal(rain.dropCount, 0, '换人后不在新的人头上继续下');
  rain.update(STEP / 1000, { envelope: { ...smile, phase: 'opening', started: true }, head: other, view });
  steps(rain, 60, { envelope: smile, head: other, view });
  assert.ok(rain.dropCount > 0);
  assert.ok(Math.abs(rain.anchor.cx - other.cx) < 1);
});

test('光雨：clear 后清空所有粒子', () => {
  const rain = createBlessingRain(cfg);
  steps(rain, 60, { envelope: smile, head, view });
  rain.clear();
  assert.equal(rain.dropCount, 0);
  assert.equal(rain.active, false);
});
