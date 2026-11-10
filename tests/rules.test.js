import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES } from '../src/rules/config.js';
import { createFaceTracker, getFaceBox, needsRecalibration, yawFromMatrix } from '../src/rules/faceSelection.js';
import { assessQuality, averageLuma, getVisibleRegion } from '../src/rules/quality.js';
import { createFireworkScheduler } from '../src/rules/effects.js';

const box = (cx, cy, size) => getFaceBox([
  { x: cx - size / 2, y: cy - size / 2 },
  { x: cx + size / 2, y: cy + size / 2 }
]);

test('多人：跟随最大的脸', () => {
  const tracker = createFaceTracker(RULES.faceSelection);
  const result = tracker.update([box(0.3, 0.5, 0.2), box(0.7, 0.5, 0.35)], 0);
  assert.equal(result.index, 1);
  assert.equal(result.switched, true);
});

test('多人：两张脸大小接近时不来回跳', () => {
  const tracker = createFaceTracker(RULES.faceSelection);
  tracker.update([box(0.3, 0.5, 0.3), box(0.7, 0.5, 0.29)], 0);
  for (let t = 50; t <= 3000; t += 50) {
    const sizeB = t % 100 ? 0.31 : 0.29;
    const r = tracker.update([box(0.3, 0.5, 0.3), box(0.7, 0.5, sizeB)], t);
    assert.equal(r.index, 0, `t=${t} 不应切换`);
  }
});

test('多人：新脸明显更大并保持 0.5 秒才切换', () => {
  const tracker = createFaceTracker(RULES.faceSelection);
  tracker.update([box(0.3, 0.5, 0.2), box(0.7, 0.5, 0.15)], 0);
  let switchedAt = null;
  for (let t = 50; t <= 1500; t += 50) {
    const r = tracker.update([box(0.3, 0.5, 0.2), box(0.7, 0.5, 0.3)], t);
    if (r.switched) { switchedAt = t; assert.equal(r.index, 1); break; }
    assert.equal(r.index, 0);
  }
  assert.ok(switchedAt !== null && switchedAt - 50 >= RULES.faceSelection.switchHoldMs);
});

test('多人：只大一帧不会切换', () => {
  const tracker = createFaceTracker(RULES.faceSelection);
  tracker.update([box(0.3, 0.5, 0.2), box(0.7, 0.5, 0.15)], 0);
  tracker.update([box(0.3, 0.5, 0.2), box(0.7, 0.5, 0.4)], 50);
  const r = tracker.update([box(0.3, 0.5, 0.2), box(0.7, 0.5, 0.15)], 100);
  assert.equal(r.index, 0);
  const r2 = tracker.update([box(0.3, 0.5, 0.2), box(0.7, 0.5, 0.4)], 150);
  assert.equal(r2.index, 0, '计时应该重新开始');
});

test('主角离开画面：短时间内不改跟别人，超过 0.5 秒才切到剩下的人，并要求重新校准', () => {
  const tracker = createFaceTracker(RULES.faceSelection);
  tracker.update([box(0.3, 0.5, 0.3), box(0.8, 0.5, 0.1)], 0);
  assert.equal(tracker.update([box(0.8, 0.5, 0.1)], 200).index, -1);
  const r = tracker.update([box(0.8, 0.5, 0.1)], 600);
  assert.equal(r.index, 0);
  assert.equal(r.kind, 'replaced');
  assert.equal(needsRecalibration(r.kind), true);
});

test('同一个人挡脸后在原位置回来：沿用基线，不重新校准', () => {
  const tracker = createFaceTracker(RULES.faceSelection);
  tracker.update([box(0.5, 0.5, 0.3)], 0);
  tracker.update([], 300);
  const r = tracker.update([box(0.52, 0.5, 0.3)], 1500);
  assert.equal(r.index, 0);
  assert.equal(needsRecalibration(r.kind), false);
});

test('被更大的脸替换：要求重新校准', () => {
  const tracker = createFaceTracker(RULES.faceSelection);
  tracker.update([box(0.3, 0.5, 0.2), box(0.7, 0.5, 0.15)], 0);
  let last;
  for (let t = 50; t <= 1000; t += 50) {
    last = tracker.update([box(0.3, 0.5, 0.2), box(0.7, 0.5, 0.3)], t);
    if (last.switched) break;
  }
  assert.equal(last.kind, 'challenger');
  assert.equal(needsRecalibration(last.kind), true);
});

test('主角移动时持续跟随同一个人', () => {
  const tracker = createFaceTracker(RULES.faceSelection);
  tracker.update([box(0.4, 0.5, 0.3)], 0);
  for (let t = 50, x = 0.4; t <= 1000; t += 50, x += 0.01) {
    const r = tracker.update([box(x, 0.5, 0.3)], t);
    assert.equal(r.switched, false);
  }
});

// 绕竖直轴转 deg 度、再绕水平轴低头 pitch 度的 4×4 变换矩阵（列主序）。
function headMatrix(deg, pitch = 0) {
  const y = (deg * Math.PI) / 180;
  const p = (pitch * Math.PI) / 180;
  const ry = [[Math.cos(y), 0, Math.sin(y)], [0, 1, 0], [-Math.sin(y), 0, Math.cos(y)]];
  const rx = [[1, 0, 0], [0, Math.cos(p), -Math.sin(p)], [0, Math.sin(p), Math.cos(p)]];
  const r = ry.map((row) => [0, 1, 2].map((j) => row.reduce((s, v, k) => s + v * rx[k][j], 0)));
  const data = new Array(16).fill(0);
  for (let c = 0; c < 3; c += 1) for (let row = 0; row < 3; row += 1) data[c * 4 + row] = r[row][c];
  data[14] = -40;
  data[15] = 1;
  return data;
}

test('转头角度：从头部变换矩阵算出，40° 不会被算成 90°', () => {
  assert.ok(Math.abs(yawFromMatrix(headMatrix(0))) < 1e-9);
  assert.ok(Math.abs(yawFromMatrix(headMatrix(18)) - 18) < 1e-9);
  assert.ok(Math.abs(yawFromMatrix(headMatrix(-40)) + 40) < 1e-9);
  assert.ok(Math.abs(yawFromMatrix(headMatrix(70)) - 70) < 1e-9);
});

test('转头角度：低头抬头不影响左右转头的结果', () => {
  assert.ok(Math.abs(yawFromMatrix(headMatrix(20, 25)) - 20) < 1e-9);
  assert.ok(Math.abs(yawFromMatrix(headMatrix(0, -30))) < 1e-9);
});

test('转头角度：没有矩阵时返回 NaN，画面检查不因此拦截', () => {
  assert.ok(Number.isNaN(yawFromMatrix(undefined)));
  assert.equal(assessQuality({ box: box(0.5, 0.5, 0.3), yawDeg: NaN }, RULES.quality).ok, true);
});

test('画面质量：出画、太小、侧脸、太暗分别给出提示', () => {
  const cfg = RULES.quality;
  assert.equal(assessQuality({ box: box(0.5, 0.5, 0.3) }, cfg).ok, true);
  assert.equal(assessQuality({ box: box(0.05, 0.5, 0.3) }, cfg).issue, 'partial');
  assert.equal(assessQuality({ box: box(0.5, 0.5, 0.1) }, cfg).issue, 'too_small');
  assert.equal(assessQuality({ box: box(0.5, 0.5, 0.3), yawDeg: 50 }, cfg).issue, 'side_face');
  assert.equal(assessQuality({ box: box(0.5, 0.5, 0.3), brightness: 20 }, cfg).issue, 'too_dark');
  assert.equal(assessQuality({ box: box(0.5, 0.5, 0.3), brightness: 120 }, cfg).ok, true);
});

test('竖屏裁切：脸在原始画面里，但被裁掉的部分算出画', () => {
  const visible = getVisibleRegion(640, 480, 400, 500);
  assert.ok(Math.abs(visible.x0 - 0.2) < 1e-9 && Math.abs(visible.x1 - 0.8) < 1e-9);
  assert.deepEqual([visible.y0, visible.y1], [0, 1]);
  const r = assessQuality({ box: box(0.2, 0.5, 0.2), visible }, RULES.quality);
  assert.equal(r.issue, 'partial');
});

test('平均亮度计算', () => {
  const dark = new Uint8ClampedArray([10, 10, 10, 255, 20, 20, 20, 255]);
  assert.ok(Math.abs(averageLuma(dark) - 15) < 1e-6);
});

test('烟花：进入大笑立即放一发，之后每 0.8 秒一发', () => {
  const s = createFireworkScheduler(RULES.fireworks);
  const launches = [];
  for (let t = 0; t <= 3000; t += 50) {
    if (s.update(t, true).launch) launches.push(t);
  }
  assert.deepEqual(launches, [0, 800, 1600, 2400]);
});

test('烟花：同屏数量有上限，持续大笑不会无限增长', () => {
  const s = createFireworkScheduler({ intervalMs: 100, maxConcurrent: 3, lifetimeMs: 1000 });
  let maxActive = 0;
  let count = 0;
  for (let t = 0; t <= 10000; t += 50) {
    const r = s.update(t, true);
    if (r.launch) count += 1;
    maxActive = Math.max(maxActive, r.active);
  }
  assert.equal(maxActive, 3);
  assert.ok(count <= 3 * 11);
});

test('烟花：停止大笑后再大笑，立即放一发', () => {
  const s = createFireworkScheduler(RULES.fireworks);
  s.update(0, true);
  s.update(100, false);
  assert.equal(s.update(200, true).launch, true);
});
