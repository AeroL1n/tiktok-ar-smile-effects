import test from 'node:test';
import assert from 'node:assert/strict';
import { blendshapeMap, extractSignals, lipGapRatio } from '../src/rules/signals.js';

function face({ lipGap = 0, scale = 1, offsetX = 0 } = {}) {
  const points = [];
  const p = (x, y) => ({ x: offsetX + x * scale, y: y * scale });
  points[10] = p(0.5, 0.2);
  points[1] = p(0.5, 0.4);
  points[13] = p(0.5, 0.5);
  points[14] = p(0.5, 0.5 + lipGap);
  return points;
}

test('嘴唇间距：闭嘴为 0，张嘴按额头到鼻尖的距离换算', () => {
  assert.equal(lipGapRatio(face()), 0);
  assert.ok(Math.abs(lipGapRatio(face({ lipGap: 0.1 })) - 0.5) < 1e-9);
});

test('嘴唇间距：离镜头远近不影响数值', () => {
  const near = lipGapRatio(face({ lipGap: 0.1 }));
  const far = lipGapRatio(face({ lipGap: 0.1, scale: 0.5, offsetX: 0.2 }));
  assert.ok(Math.abs(near - far) < 1e-9);
});

test('嘴唇间距：按画面宽高换算，横向画面里同样的嘴型数值一致', () => {
  const square = lipGapRatio(face({ lipGap: 0.1 }), 480, 480);
  const wide = lipGapRatio(face({ lipGap: 0.1 }), 640, 480);
  assert.ok(Math.abs(square - wide) < 1e-9);
});

test('嘴唇间距：缺关键点时返回 NaN', () => {
  assert.ok(Number.isNaN(lipGapRatio([])));
  assert.ok(Number.isNaN(lipGapRatio(undefined)));
});

test('表情系数：左右取平均，缺失的系数按 0 处理', () => {
  const categories = [
    { categoryName: 'mouthSmileLeft', score: 0.8 },
    { categoryName: 'mouthSmileRight', score: 0.6 },
    { categoryName: 'jawOpen', score: 0.3 },
    { categoryName: 'browInnerUp', score: 0.5 },
    { categoryName: 'eyeSquintLeft', score: 0.4 }
  ];
  const s = extractSignals(categories, face({ lipGap: 0.1 }), 1, 1);
  assert.ok(Math.abs(s.smile - 0.7) < 1e-9);
  assert.equal(s.jaw, 0.3);
  assert.equal(s.browInnerUp, 0.5);
  assert.equal(s.squint, 0.2);
  assert.equal(s.browDown, 0);
  assert.equal(s.frown, 0);
  assert.equal(blendshapeMap(undefined)('jawOpen'), 0);
});
