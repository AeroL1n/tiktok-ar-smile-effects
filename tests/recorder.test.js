import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecorder } from '../src/app/recorder.js';
import { lipGapRatio, pitchFromMatrix } from '../src/rules/signals.js';

const frame = (smile) => ({
  blendshapes: [{ categoryName: 'mouthSmileLeft', score: smile }, { categoryName: 'jawOpen', score: 0.1 }],
  extra: { lipGap: 0.25, yaw: NaN }
});

test('录制：先倒计时，再连续记录，结束后返回全部帧', () => {
  const r = createRecorder({ countdownMs: 3000, durationMs: 3000 });
  r.start('light-laugh', 0);
  assert.equal(r.update(1000, frame(0.5)).phase, 'countdown');
  let rows = 0;
  let done;
  for (let t = 3000; t <= 6100; t += 50) {
    const step = r.update(t, frame(0.6));
    if (step.phase === 'recording') rows += 1;
    if (step.phase === 'done') { done = step.result; break; }
  }
  assert.equal(done.label, 'light-laugh');
  assert.equal(done.labelName, '轻轻笑出声');
  assert.equal(done.rows.length, rows);
  assert.equal(rows, 60);
  assert.deepEqual(done.columns, ['t', 'lipGap', 'yaw', 'mouthSmileLeft', 'jawOpen']);
  assert.deepEqual(done.rows[0], [0, 0.25, null, 0.6, 0.1]);
  assert.equal(r.active, false);
});

test('录制：没有人脸的帧不记录，有人脸后再开始记', () => {
  const r = createRecorder({ countdownMs: 0, durationMs: 200 });
  r.start('cry', 0);
  r.update(0, { blendshapes: [], extra: {} });
  r.update(50, frame(0.3));
  r.update(100, { blendshapes: [], extra: { lipGap: 0.2 } });
  const done = r.update(300, frame(0.3)).result;
  assert.equal(done.rows.length, 2);
  assert.equal(done.rows[1][3], null, '丢脸那一帧的表情系数为空');
});

test('录制：未知表情名称归到“其他”，可以中途取消', () => {
  const r = createRecorder({ countdownMs: 0, durationMs: 100 });
  r.start('not-a-label', 0);
  r.cancel();
  assert.equal(r.update(50, frame(0.3)).phase, 'idle');
  r.start('not-a-label', 0);
  assert.equal(r.update(200, frame(0.3)).result.label, 'other');
});

test('含深度的嘴唇间距：嘴唇只在深度方向分开时，平面距离为 0，三维距离不为 0', () => {
  const points = [];
  points[10] = { x: 0.5, y: 0.2, z: 0 };
  points[1] = { x: 0.5, y: 0.4, z: 0 };
  points[13] = { x: 0.5, y: 0.5, z: 0 };
  points[14] = { x: 0.5, y: 0.5, z: 0.1 };
  assert.equal(lipGapRatio(points), 0);
  assert.ok(Math.abs(lipGapRatio(points, 1, 1, true) - 0.5) < 1e-9);
});

test('低头抬头角度：正脸为 0，没有矩阵时为 NaN', () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -40, 1];
  assert.ok(Math.abs(pitchFromMatrix(identity)) < 1e-9);
  const p = (20 * Math.PI) / 180;
  const pitched = [...identity];
  pitched[9] = Math.sin(p);
  pitched[10] = Math.cos(p);
  assert.ok(Math.abs(pitchFromMatrix(pitched) - 20) < 1e-9);
  assert.ok(Number.isNaN(pitchFromMatrix(undefined)));
});
