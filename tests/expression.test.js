import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES } from '../src/rules/config.js';
import { createExpressionMachine } from '../src/rules/expression.js';

const STEP = 50;
const NEUTRAL = { smile: 0.05, jaw: 0.03, lipGap: 0.0, squint: 0.2 };
const SMILE = { smile: 0.75, jaw: 0.05, lipGap: 0.1, squint: 0.35 };
const LAUGH = { smile: 0.8, jaw: 0.15, lipGap: 0.42, squint: 0.65 };

function harness() {
  const machine = createExpressionMachine(RULES);
  let now = 0;
  let last;
  const states = [];
  const feed = (ms, faceOrFn, quality) => {
    const end = now + ms;
    while (now < end) {
      const face = typeof faceOrFn === 'function' ? faceOrFn(now) : faceOrFn;
      last = machine.update({ now, face, quality });
      states.push({ t: now, state: last.state });
      now += STEP;
    }
    return last;
  };
  const calibrate = (face = NEUTRAL) => feed(RULES.calibration.durationMs + STEP, face);
  return {
    machine,
    feed,
    calibrate,
    states,
    get now() { return now; },
    get last() { return last; }
  };
}

const firstTime = (states, state, from = 0) =>
  states.find((s) => s.t >= from && s.state === state)?.t ?? null;

test('开场 2 秒校准后才开始判定，并记录自然表情', () => {
  const h = harness();
  const during = h.feed(1000, SMILE);
  assert.equal(during.phase, 'calibrating');
  assert.equal(during.state, 'idle');
  assert.match(during.hint, /校准/);

  const h2 = harness();
  const done = h2.calibrate();
  assert.equal(done.phase, 'running');
  assert.ok(Math.abs(done.baseline.smile - NEUTRAL.smile) < 1e-9);
  assert.ok(Math.abs(done.baseline.jaw - NEUTRAL.jaw) < 1e-9);
});

test('天生嘴角上扬的人：减掉基线后，平时的表情不下雨', () => {
  const h = harness();
  h.calibrate({ smile: 0.25, jaw: 0.03 });
  h.feed(1000, { smile: 0.55, jaw: 0.03 });
  assert.equal(h.last.state, 'idle');
  h.feed(1000, { smile: 0.9, jaw: 0.03 });
  assert.equal(h.last.state, 'smile');
});

test('基线有上限：校准时一直在笑，也不会把微笑判定吃掉', () => {
  const h = harness();
  const done = h.calibrate({ smile: 0.7, jaw: 0.03 });
  assert.equal(done.baseline.smile, RULES.calibration.maxSmileBaseline);
});

test('微笑保持后下雨', () => {
  const h = harness();
  h.calibrate();
  const start = h.now;
  h.feed(1000, SMILE);
  const t = firstTime(h.states, 'smile', start);
  assert.ok(t !== null, '应该进入下雨');
  assert.ok(t - start >= RULES.hold.smileMs, '必须先保持 0.2 秒');
});

test('一闪而过的微笑不触发', () => {
  const h = harness();
  h.calibrate();
  h.feed(150, SMILE);
  h.feed(1000, NEUTRAL);
  assert.equal(firstTime(h.states, 'smile'), null);
});

test('大笑保持 0.3 秒后放烟花', () => {
  const h = harness();
  h.calibrate();
  const start = h.now;
  h.feed(1000, LAUGH);
  const t = firstTime(h.states, 'laugh', start);
  assert.ok(t !== null, '应该进入大笑');
  assert.ok(t - start >= RULES.hold.laughMs);
});

test('说话：嘴快速开合但嘴角不上扬，不触发', () => {
  const h = harness();
  h.calibrate();
  const start = h.now;
  h.feed(4000, (t) => (Math.floor(t / 100) % 2
    ? { smile: 0.08, jaw: 0.4, lipGap: 0.3, squint: 0.2 }
    : { smile: 0.08, jaw: 0.05, lipGap: 0.03, squint: 0.2 }));
  assert.equal(firstTime(h.states, 'smile', start), null);
  assert.equal(firstTime(h.states, 'laugh', start), null);
});

test('边笑边说：保持下雨，短暂张嘴不升级成烟花', () => {
  const h = harness();
  h.calibrate();
  h.feed(600, SMILE);
  assert.equal(h.last.state, 'smile');
  const start = h.now;
  h.feed(4000, (t) => (Math.floor(t / 150) % 2
    ? { smile: 0.7, jaw: 0.4, lipGap: 0.35, squint: 0.35 }
    : SMILE));
  assert.equal(firstTime(h.states, 'laugh', start), null);
  assert.equal(firstTime(h.states, 'idle', start), null);
  assert.equal(h.last.state, 'smile');
});

test('打哈欠：嘴张很大但没有笑，不触发，并说明原因', () => {
  const h = harness();
  h.calibrate();
  const start = h.now;
  h.feed(2000, { smile: 0.05, jaw: 0.85, lipGap: 0.6, squint: 0.5 });
  assert.equal(firstTime(h.states, 'smile', start), null);
  assert.equal(firstTime(h.states, 'laugh', start), null);
  assert.match(h.last.reason, /打哈欠/);
});

test('惊讶（O 形嘴）：嘴张开没有笑，不触发', () => {
  const h = harness();
  h.calibrate();
  h.feed(2000, { smile: 0.1, jaw: 0.45, lipGap: 0.4, squint: 0.1 });
  assert.equal(h.last.state, 'idle');
  assert.match(h.last.reason, /没有笑/);
});

test('大笑时下巴本来就张得小：只要嘴唇间距够大，烟花不会中途退回下雨', () => {
  const h = harness();
  h.calibrate();
  h.feed(2000, { smile: 0.8, jaw: 0.07, lipGap: 0.37, squint: 0.6 });
  assert.equal(h.last.state, 'laugh');
});

test('大笑嘴张得不大，但上排牙露出来（上唇上提高）：放烟花', () => {
  const h = harness();
  h.calibrate();
  h.feed(1500, { smile: 0.8, jaw: 0.27, lipGap: 0.24, squint: 0.7, upperUp: 0.74, browDown: 0.18 });
  assert.equal(h.last.state, 'laugh');
});

test('大笑嘴唇间距接近阈值：0.28 也放烟花', () => {
  const h = harness();
  h.calibrate();
  h.feed(1500, { smile: 0.8, jaw: 0.2, lipGap: 0.3, squint: 0.62, browDown: 0.12 });
  assert.equal(h.last.state, 'laugh');
});

test('大笑收嘴：嘴唇间距和上唇上提都回落才回到下雨', () => {
  const h = harness();
  h.calibrate();
  h.feed(1000, LAUGH);
  assert.equal(h.last.state, 'laugh');
  h.feed(500, { smile: 0.8, jaw: 0.05, lipGap: 0.15, squint: 0.6, upperUp: 0.7 });
  assert.equal(h.last.state, 'laugh', '上排牙还露着，保持烟花');
  h.feed(500, { smile: 0.8, jaw: 0.05, lipGap: 0.15, squint: 0.5, upperUp: 0.3 });
  assert.equal(h.last.state, 'smile');
});

test('大笑中嘴角回落到 0.60 以下：回到下雨', () => {
  const h = harness();
  h.calibrate();
  h.feed(1000, LAUGH);
  h.feed(500, { ...LAUGH, smile: 0.55 });
  assert.equal(h.last.state, 'smile');
});

test('嘴张大但眼睛没眯起：不放烟花，并说明原因', () => {
  const h = harness();
  h.calibrate();
  h.feed(1500, { smile: 0.8, jaw: 0.1, lipGap: 0.45, squint: 0.2 });
  assert.equal(h.last.state, 'smile');
  assert.match(h.last.reason, /眯/);
});

test('哭脸：嘴角高、眯眼、上排牙露出，但皱着眉，不放烟花，只下雨', () => {
  const h = harness();
  h.calibrate();
  const start = h.now;
  h.feed(2000, { smile: 0.77, jaw: 0.27, lipGap: 0.23, squint: 0.76, upperUp: 0.7, browDown: 0.31 });
  assert.equal(firstTime(h.states, 'laugh', start), null);
  assert.equal(h.last.state, 'smile');
  assert.match(h.last.reason, /皱/);
});

test('嘴角不到 0.68：嘴张开、眯眼也只下雨', () => {
  const h = harness();
  h.calibrate();
  h.feed(1500, { smile: 0.63, jaw: 0.29, lipGap: 0.36, squint: 0.65, upperUp: 0.6, browDown: 0.09 });
  assert.equal(h.last.state, 'smile');
  assert.match(h.last.reason, /嘴角/);
});

// 用户 2026-11-08 截图里的读数（转头 ≤ 20°），阈值就是根据它们定的。
// 这是回归测试，防止以后改规则把它们改坏；不能当作阈值的验收依据。早期截图没有上唇上提，按 0 处理。
const MEASURED = [
  ['抿嘴笑', { smile: 0.56, lipGap: 0.01, squint: 0.3 }, 'smile'],
  ['露齿笑', { smile: 0.69, lipGap: 0.14, squint: 0.38 }, 'smile'],
  ['露齿笑（第三轮图二）', { smile: 0.74, lipGap: 0.19, squint: 0.42, upperUp: 0.53 }, 'smile'],
  ['苦笑（已知局限：判成下雨）', { smile: 0.75, lipGap: 0.1, squint: 0.33 }, 'smile'],
  ['大笑 A', { smile: 0.77, lipGap: 0.37, squint: 0.7, browDown: 0.14 }, 'laugh'],
  ['大笑 B', { smile: 0.83, lipGap: 0.37, squint: 0.57, browDown: 0.13 }, 'laugh'],
  ['大笑 C（只露上排牙）', { smile: 0.71, lipGap: 0.51, squint: 0.67, browDown: 0.22 }, 'laugh'],
  ['大笑 D', { smile: 0.79, lipGap: 0.4, squint: 0.67, browDown: 0.14 }, 'laugh'],
  ['大笑（第三轮图三，嘴张得小）', { smile: 0.82, lipGap: 0.26, squint: 0.69, upperUp: 0.78, browDown: 0.01 }, 'laugh'],
  ['大笑（第三轮图六）', { smile: 0.88, lipGap: 0.31, squint: 0.62, upperUp: 0.75, browDown: 0.01 }, 'laugh'],
  ['大笑（第三轮图七）', { smile: 0.8, lipGap: 0.24, squint: 0.7, upperUp: 0.74, browDown: 0.18 }, 'laugh'],
  ['大笑 E（已知局限：嘴角 0.61，判成下雨）', { smile: 0.61, lipGap: 0.32, squint: 0.77 }, 'smile'],
  ['哭脸 A（下雨）', { smile: 0.61, lipGap: 0.21, squint: 0.8, browDown: 0.09 }, 'smile'],
  ['哭脸 B（下雨）', { smile: 0.53, lipGap: 0.28, squint: 0.8, browDown: 0.24 }, 'smile'],
  ['大哭（第三轮图四，下雨）', { smile: 0.63, lipGap: 0.36, squint: 0.65, upperUp: 0.6, browDown: 0.09 }, 'smile']
];

for (const [name, face, expected] of MEASURED) {
  test(`实测回归：${name} → ${expected}`, () => {
    const h = harness();
    h.calibrate({ smile: 0, jaw: 0, lipGap: 0, squint: 0.2 });
    h.feed(1500, { jaw: 0, upperUp: 0, browDown: 0, ...face });
    assert.equal(h.last.state, expected);
  });
}

test('退出迟滞：嘴角回落到 0.35–0.50 之间仍下雨，低于 0.35 才停', () => {
  const h = harness();
  h.calibrate();
  h.feed(600, SMILE);
  assert.equal(h.last.state, 'smile');
  h.feed(1000, { smile: 0.45, jaw: 0.05 });
  assert.equal(h.last.state, 'smile');
  h.feed(1000, { smile: 0.2, jaw: 0.05 });
  assert.equal(h.last.state, 'idle');
});

test('大笑后合上嘴但还在笑：回到下雨，而不是直接停', () => {
  const h = harness();
  h.calibrate();
  h.feed(1000, LAUGH);
  assert.equal(h.last.state, 'laugh');
  h.feed(1000, SMILE);
  assert.equal(h.last.state, 'smile');
});

test('人脸短暂丢失 0.3 秒：保持下雨', () => {
  const h = harness();
  h.calibrate();
  h.feed(600, SMILE);
  h.feed(300, null);
  assert.equal(h.last.state, 'smile');
  assert.equal(h.last.faceStatus, 'lost_hold');
  h.feed(200, SMILE);
  assert.equal(h.last.state, 'smile');
});

test('人脸丢失超过 1 秒：效果停止，提示正对镜头', () => {
  const h = harness();
  h.calibrate();
  h.feed(600, SMILE);
  h.feed(1200, null);
  assert.equal(h.last.state, 'idle');
  assert.equal(h.last.faceStatus, 'lost');
  assert.match(h.last.hint, /没有检测到人脸/);
});

test('画面条件不合格：不新触发，但不打断正在进行的效果', () => {
  const bad = { ok: false, message: '请正对镜头' };
  const h = harness();
  h.calibrate();
  h.feed(1000, SMILE, bad);
  assert.equal(h.last.state, 'idle');
  assert.equal(h.last.hint, '请正对镜头');

  const h2 = harness();
  h2.calibrate();
  h2.feed(600, SMILE);
  h2.feed(1000, SMILE, bad);
  assert.equal(h2.last.state, 'smile');
  h2.feed(1000, LAUGH, bad);
  assert.equal(h2.last.state, 'smile', '画面不合格时不升级成烟花');
});

test('校准期间画面不合格：校准暂停，不计入时间', () => {
  const bad = { ok: false, message: '光线太暗，请打开灯' };
  const h = harness();
  h.feed(1000, NEUTRAL);
  h.feed(3000, NEUTRAL, bad);
  assert.equal(h.last.phase, 'calibrating');
  h.feed(1100, NEUTRAL);
  assert.equal(h.last.phase, 'running');
});

test('reset 后重新校准，清掉上一个人的状态', () => {
  const h = harness();
  h.calibrate();
  h.feed(600, SMILE);
  assert.equal(h.last.state, 'smile');
  h.machine.reset();
  const after = h.feed(50, SMILE);
  assert.equal(after.phase, 'calibrating');
  assert.equal(after.state, 'idle');
});
