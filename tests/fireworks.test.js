import test from 'node:test';
import assert from 'node:assert/strict';
import createFireworks, { FIREWORK_LIMITS, stepFireworkParticle } from '../src/app/fireworks.js';
import { createFireworkScheduler } from '../src/rules/effects.js';
import { RULES } from '../src/rules/config.js';

const cfg = { ...RULES.fireworks, lifetimeMs: 2400 };
const region = { left: 0, width: 540 };
const scene = { head: null, region, height: 960 };
const stillHead = { cx: 0, cy: 0, rx: 20, ry: 30, vx: 0, vy: 0 };
const unforced = { drag: 0, gravity: 0, maxSpeed: 5000, restitution: 0.68 };

function seeded(seed = 17) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

function run(fireworks, seconds, fps = 60, input = scene) {
  for (let i = 0; i < Math.round(seconds * fps); i += 1) fireworks.update(1 / fps, input);
}

function near(actual, expected, tolerance = 1e-7) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} 应接近 ${expected}（误差上限 ${tolerance}）`);
}

function outside(p, head) {
  return ((p.x - head.cx) / (head.rx + (p.radius ?? 0))) ** 2
    + ((p.y - head.cy) / (head.ry + (p.radius ?? 0))) ** 2 >= 1 - 1e-8;
}

// 最小 Canvas 替身只记录绘图，不启动浏览器、不依赖真实 DOM。
function withCanvas(body) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const stats = { canvases: 0, gradients: 0 };
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      stats.canvases += 1;
      return {
        width: 0, height: 0,
        getContext() {
          return {
            createRadialGradient() {
              stats.gradients += 1;
              return { addColorStop() {} };
            },
            fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}
          };
        }
      };
    }
  };
  const calls = [];
  const stack = [];
  const context = {
    globalAlpha: 0.43,
    globalCompositeOperation: 'source-over',
    saveCount: 0,
    restoreCount: 0,
    save() {
      this.saveCount += 1;
      stack.push({ globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation });
    },
    restore() {
      this.restoreCount += 1;
      Object.assign(this, stack.pop());
    },
    drawImage(_sprite, ...rect) {
      calls.push({ rect, alpha: this.globalAlpha, blend: this.globalCompositeOperation });
    }
  };
  try {
    return body({ stats, context, calls });
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  }
}

// 连续碰撞和相对速度反射：不是只检查一帧结束点有没有落在头里。
test('高速星点一帧从头部左侧穿到右侧，仍击中左侧并反弹', () => {
  const original = { x: -100, y: 0, vx: 2000, vy: 0, radius: 1 };
  const p = stepFireworkParticle(original, 0.1, stillHead, unforced);
  assert.equal(p.collided, true);
  assert.ok(p.vx < 0);
  assert.ok(p.x < -stillHead.rx);
  assert.ok(outside(p, stillHead));
  near(p.hitX, -21);
  assert.deepEqual(original, { x: -100, y: 0, vx: 2000, vy: 0, radius: 1 }, '纯函数不能改输入');
});

test('移动头部会扫到原本静止的星点，把头部速度传给星点', () => {
  const head = { cx: 40, cy: 0, rx: 10, ry: 15, vx: 400, vy: 0 };
  const p = stepFireworkParticle({ x: 35, y: 0, vx: 0, vy: 0, radius: 0 }, 0.1, head, unforced);
  assert.equal(p.collided, true);
  near(p.vx, 400 * (1 + unforced.restitution));
  assert.ok(p.x > head.cx + head.rx);
  assert.ok(outside(p, head));
});

test('碰撞沿椭圆法线反射，保留切向相对速度', () => {
  const head = { cx: 0, cy: 0, rx: 40, ry: 70, vx: 0, vy: 0 };
  const p = stepFireworkParticle({ x: -90, y: -35, vx: 900, vy: 120, radius: 0 }, 0.1, head, unforced);
  assert.equal(p.collided, true);
  const beforeNormal = 900 * p.nx + 120 * p.ny;
  const afterNormal = p.vx * p.nx + p.vy * p.ny;
  const beforeTangent = -900 * p.ny + 120 * p.nx;
  const afterTangent = -p.vx * p.ny + p.vy * p.nx;
  near(afterNormal, -beforeNormal * unforced.restitution);
  near(afterTangent, beforeTangent);
  assert.ok(outside(p, head));
});

test('头部撞得再快，星点速度也不超过硬上限', () => {
  const head = { cx: 400, cy: 0, rx: 10, ry: 15, vx: 5000, vy: 0 };
  const p = stepFireworkParticle({ x: 50, y: 0, vx: 0, vy: 0, radius: 0 }, 0.1, head,
    { ...unforced, maxSpeed: 300 });
  assert.equal(p.collided, true);
  assert.ok(Math.hypot(p.vx, p.vy) <= 300 + 1e-7);
  assert.ok(outside(p, head));
});

test('头部持续压着限速星点，只投影位置，不重复施加冲量增能', () => {
  let p = { x: 50, y: 0, vx: 0, vy: 0, radius: 0 };
  let hits = 0;
  for (let i = 0; i < 40; i += 1) {
    const head = { cx: 400 + i * 500, cy: 0, rx: 10, ry: 15, vx: 5000, vy: 0 };
    p = stepFireworkParticle(p, 0.1, head, { ...unforced, maxSpeed: 300 });
    if (p.collided) hits += 1;
    near(Math.hypot(p.vx, p.vy), 300);
    assert.ok(outside(p, head));
  }
  assert.equal(hits, 1);
});

test('已离开头部的出射星点不获得额外冲量，接触锁会在离开后解除', () => {
  let p = { x: -20, y: 0, vx: -80, vy: 0, radius: 1, touching: true };
  p = stepFireworkParticle(p, 0.05, stillHead, unforced);
  assert.equal(p.collided, false);
  near(p.vx, -80);
  assert.ok(outside(p, stillHead));
  p = stepFireworkParticle(p, 0.05, stillHead, unforced);
  assert.equal(p.touching, false);
  p.vx = 200;
  p = stepFireworkParticle(p, 0.1, stillHead, unforced);
  assert.equal(p.collided, true, '离开后真正回来，应允许下一次碰撞');
});

test('刚生成在头部中心的粒子能安全投影出边界，没有非数坐标', () => {
  const p = stepFireworkParticle({ x: 0, y: 0, vx: 0, vy: 0, radius: 2 }, 1 / 60, stillHead);
  for (const value of [p.x, p.y, p.vx, p.vy]) assert.ok(Number.isFinite(value));
  assert.ok(outside(p, stillHead));
});

test('头部缺失、非数速度按零速度处理，不能污染物理状态', () => {
  const particle = { x: -100, y: 0, vx: 2000, vy: 0, radius: 1 };
  const expected = stepFireworkParticle(particle, 0.1, stillHead, unforced);
  const missing = stepFireworkParticle(particle, 0.1, { cx: 0, cy: 0, rx: 20, ry: 30 }, unforced);
  const invalid = stepFireworkParticle(particle, 0.1, { ...stillHead, vx: NaN, vy: Infinity }, unforced);
  assert.deepEqual(missing, expected);
  assert.deepEqual(invalid, expected);
  const noShape = stepFireworkParticle(particle, 0.1, { ...stillHead, rx: 0 }, unforced);
  assert.equal(noShape.collided, false);
  near(noShape.x, 100);
});

test('解析阻尼：30、60、120 帧的自由轨迹接近同一个结果', () => {
  const results = [30, 60, 120].map((fps) => {
    let p = { x: 80, y: 50, vx: 250, vy: -200, radius: 1 };
    for (let i = 0; i < fps * 1.5; i += 1) p = stepFireworkParticle(p, 1 / fps);
    return p;
  });
  for (const p of results) {
    for (const key of ['x', 'y', 'vx', 'vy']) near(p[key], results[0][key]);
  }
  assert.ok(results[0].vy > 0, '先上冲、后下坠');
});

test('烟花可在无 DOM、无头部输入时启动和更新，默认导出与命名接口可用', () => {
  const fireworks = createFireworks(cfg, { random: seeded() });
  assert.equal(fireworks.launch(270, 180, 0), true);
  run(fireworks, 0.5);
  assert.equal(fireworks.burstCount, 1);
  assert.equal(fireworks.particleCount, 60);
  assert.equal(fireworks.collisionCount, 0);
});

test('短上冲之后分三次爆开，爆发数和每发星点数都有上限', () => {
  const fireworks = createFireworks(cfg, { random: () => 0.5 });
  fireworks.launch(270, 180, 0);
  fireworks.update(0.15, scene);
  assert.equal(fireworks.particleCount, 0);
  fireworks.update(0.06, scene);
  assert.equal(fireworks.particleCount, 30);
  fireworks.update(0.07, scene);
  assert.equal(fireworks.particleCount, 48);
  fireworks.update(0.09, scene);
  assert.equal(fireworks.particleCount, 60);
  assert.equal(fireworks.launch(170, 180, 0), true);
  assert.equal(fireworks.launch(370, 180, 0), true);
  assert.equal(fireworks.launch(270, 180, 0), false);
  assert.equal(fireworks.burstCount, 3);
});

test('持续大笑一分钟，三发烟花、总粒子和碰撞碎星保持有界', () => {
  const fireworks = createFireworks(cfg, { random: seeded() });
  const scheduler = createFireworkScheduler(cfg);
  const head = { cx: 270, cy: 250, rx: 110, ry: 140, vx: 0, vy: 0 };
  let launched = 0;
  let peak = 0;
  for (let i = 0; i < 60 * 60; i += 1) {
    if (scheduler.update(i * 1000 / 60, true).launch) {
      launched += 1;
      fireworks.launch(270, 115, i * 1000 / 60);
    }
    fireworks.update(1 / 60, { ...scene, head });
    assert.ok(fireworks.burstCount <= cfg.maxConcurrent);
    assert.ok(fireworks.particleCount <= FIREWORK_LIMITS.particles);
    assert.ok(fireworks.particleCount <= fireworks.burstCount
      * (FIREWORK_LIMITS.particlesPerBurst + FIREWORK_LIMITS.fragmentsPerBurst + FIREWORK_LIMITS.contactsPerBurst));
    peak = Math.max(peak, fireworks.particleCount);
  }
  assert.ok(launched > 60, '持续大笑会持续播放');
  assert.ok(peak > 60, '确实有多发同时活跃');
  assert.ok(fireworks.collisionCount > 0, '压力场景包含真实碰撞');
});

test('配置容量再大也受绝对上限约束，小容量的粒子池不能溢出', () => {
  const small = createFireworks({ ...cfg, maxConcurrent: 999, maxParticles: 18, particlesPerBurst: 999 }, { random: () => 0.5 });
  for (let i = 0; i < 50; i += 1) small.launch(270, 180, i);
  assert.equal(small.burstCount, 3);
  run(small, 0.7, 120, { ...scene, head: { cx: 270, cy: 180, rx: 100, ry: 120, vx: 0, vy: 0 } });
  assert.ok(small.particleCount > 0 && small.particleCount <= 18);
  assert.ok(small.collisionCount > 0);
  const zero = createFireworks({ ...cfg, maxParticles: 0 });
  zero.launch(270, 180, 0);
  zero.update(0.7, scene);
  assert.equal(zero.particleCount, 0);
});

test('update 是唯一时间源，launch 的时间原点和 draw 的时间不会改变寿命', () => {
  const a = createFireworks(cfg, { random: seeded() });
  const b = createFireworks(cfg, { random: seeded() });
  a.launch(270, 180, 0);
  b.launch(270, 180, 987654321);
  run(a, 0.8);
  run(b, 0.8);
  withCanvas(({ context }) => {
    for (let i = 0; i < 20; i += 1) b.draw(context, i * 1e12, 540);
  });
  assert.equal(a.burstCount, b.burstCount);
  assert.equal(a.particleCount, b.particleCount);
  a.update(1.6, scene);
  b.update(1.6, scene);
  assert.equal(a.burstCount, 0);
  assert.equal(b.burstCount, 0);
  assert.equal(b.particleCount, 0);
});

test('clear 清空烟花、粒子、碰撞统计和内部时钟，之后可以重新播放', () => {
  const fireworks = createFireworks(cfg, { random: () => 0.5 });
  fireworks.update(1000, scene);
  fireworks.launch(270, 180, 5);
  run(fireworks, 0.33, 120, { ...scene, head: { cx: 270, cy: 180, rx: 100, ry: 120, vx: 0, vy: 0 } });
  assert.ok(fireworks.collisionCount > 0);
  fireworks.clear();
  assert.equal(fireworks.burstCount, 0);
  assert.equal(fireworks.particleCount, 0);
  assert.equal(fireworks.collisionCount, 0);
  const fresh = createFireworks(cfg, { random: () => 0.5 });
  fireworks.launch(270, 180, 5);
  fresh.launch(270, 180, 5);
  run(fireworks, 0.5);
  run(fresh, 0.5);
  withCanvas(({ context, calls }) => {
    fireworks.draw(context, 1e12, 540);
    const actual = calls.splice(0);
    fresh.draw(context, -1000, 540);
    assert.deepEqual(calls, actual, '重置后轨迹、年龄和相位应与新实例一致');
  });
});

test('寿命末端释放全部粒子，长停帧会回收旧烟花，不补出陈旧爆发', () => {
  for (const life of [1600, 2400]) {
    const fireworks = createFireworks({ ...cfg, lifetimeMs: life }, { random: seeded() });
    fireworks.launch(270, 180, 0);
    fireworks.update(0.4, scene);
    assert.ok(fireworks.particleCount > 0);
    fireworks.update(life / 1000 - 0.41, scene);
    assert.equal(fireworks.burstCount, 1);
    fireworks.update(0.011, scene);
    assert.equal(fireworks.burstCount, 0);
    assert.equal(fireworks.particleCount, 0);
    fireworks.launch(270, 180, 0);
    fireworks.update(3600, scene);
    assert.equal(fireworks.burstCount, 0);
    assert.equal(fireworks.particleCount, 0);
  }
});

test('小于固定步长的 dt 能累积，非法或负 dt 不会让时间倒退', () => {
  const fireworks = createFireworks(cfg, { random: () => 0.5 });
  fireworks.launch(270, 180, NaN);
  for (let i = 0; i < 400; i += 1) fireworks.update(0.001, scene);
  assert.equal(fireworks.particleCount, 60);
  const count = fireworks.particleCount;
  for (const dt of [-1, NaN, Infinity, undefined]) fireworks.update(dt, scene);
  assert.equal(fireworks.particleCount, count);
  assert.equal(fireworks.burstCount, 1);
});

test('只碰头部，不把肩膀当作烟花碰撞体', () => {
  const fireworks = createFireworks(cfg, { random: seeded() });
  fireworks.launch(270, 550, 0);
  run(fireworks, 0.7, 60, { ...scene, head: { cx: 270, cy: 180, rx: 60, ry: 80, vx: 0, vy: 0 } });
  assert.ok(fireworks.particleCount > 0);
  assert.equal(fireworks.collisionCount, 0);
});

test('正式系统 30、60、120 帧下的轨迹与移动头部碰撞一致', () => {
  withCanvas(({ context, calls }) => {
    const frames = [30, 60, 120].map((fps) => {
      const fireworks = createFireworks(cfg, { random: seeded() });
      fireworks.launch(270, 180, 123);
      for (let i = 1; i <= fps; i += 1) {
        fireworks.update(1 / fps, { ...scene, head: { cx: 200 + 30 * i / fps, cy: 220, rx: 60, ry: 80, vx: 30, vy: 0 } });
      }
      fireworks.draw(context, 0, 540);
      return { particles: fireworks.particleCount, collisions: fireworks.collisionCount, draws: calls.splice(0) };
    });
    assert.ok(frames[0].collisions > 0);
    for (const frame of frames.slice(1)) {
      assert.equal(frame.particles, frames[0].particles);
      assert.equal(frame.collisions, frames[0].collisions);
      assert.equal(frame.draws.length, frames[0].draws.length);
      frame.draws.forEach((call, i) => {
        call.rect.forEach((value, j) => near(value, frames[0].draws[i].rect[j], 1e-4));
        near(call.alpha, frames[0].draws[i].alpha, 1e-6);
      });
    }
  });
});

test('首次 draw 懒建纹理，后续帧不创建渐变，始终 save/restore', () => {
  withCanvas(({ stats, context, calls }) => {
    const fireworks = createFireworks(cfg, { random: seeded() });
    fireworks.launch(270, 180, 0);
    run(fireworks, 0.8);
    assert.equal(stats.canvases, 0);
    fireworks.draw(context, 800, 540);
    assert.equal(stats.canvases, 6);
    const gradients = stats.gradients;
    const first = calls.splice(0);
    fireworks.draw(context, 999999999, 800);
    assert.equal(stats.gradients, gradients);
    assert.equal(stats.canvases, 6);
    assert.deepEqual(calls, first, 'draw 参数不能推进动画或缩放世界坐标');
    assert.equal(context.globalAlpha, 0.43);
    assert.equal(context.globalCompositeOperation, 'source-over');
    assert.equal(context.saveCount, context.restoreCount);
    for (const call of calls) {
      assert.ok(call.rect.every(Number.isFinite));
      assert.ok(call.alpha >= 0 && call.alpha <= 1);
      assert.equal(call.blend, 'lighter');
      assert.ok(call.rect[2] < 540 * 0.08, '所有绘制都是局部精灵，没有全屏白闪');
    }
  });
});

test('轨迹历史和碰撞亮点绘制数量有硬上限，clear 后 draw 不留下旧帧', () => {
  withCanvas(({ context, calls }) => {
    const fireworks = createFireworks({ ...cfg, trailPoints: 999, particlesPerBurst: 999 }, { random: seeded() });
    for (let i = 0; i < 3; i += 1) fireworks.launch(240 + i * 30, 180, i);
    run(fireworks, 0.7, 120, { ...scene, head: { cx: 270, cy: 250, rx: 120, ry: 150, vx: 0, vy: 0 } });
    fireworks.draw(context, 700, 540);
    assert.ok(calls.length > fireworks.particleCount);
    assert.ok(calls.length <= fireworks.particleCount * (FIREWORK_LIMITS.trailPoints + 2) + 18);
    fireworks.clear();
    calls.length = 0;
    fireworks.draw(context, 1000, 540);
    assert.equal(calls.length, 0);
  });
});

test('渲染异常仍恢复宿主画布状态', () => {
  withCanvas(({ context }) => {
    const fireworks = createFireworks(cfg, { random: seeded() });
    fireworks.launch(270, 180, 0);
    run(fireworks, 0.6);
    context.drawImage = () => { throw new Error('绘制失败'); };
    assert.throws(() => fireworks.draw(context, 600, 540), /绘制失败/);
    assert.equal(context.saveCount, context.restoreCount);
    assert.equal(context.globalAlpha, 0.43);
    assert.equal(context.globalCompositeOperation, 'source-over');
  });
});

test('launch 使用可见宽度作为单位，缺省值等于显式 540', () => {
  withCanvas(({ context, calls }) => {
    const a = createFireworks(cfg, { random: seeded() });
    const b = createFireworks(cfg, { random: seeded() });
    a.launch(270, 180, 0);
    b.launch(270, 180, 0, 540);
    run(a, 0.6);
    run(b, 0.6);
    a.draw(context, 0, 540);
    const first = calls.splice(0);
    b.draw(context, 0, 1000);
    assert.deepEqual(calls, first);
    const doubled = createFireworks(cfg, { random: seeded() });
    doubled.launch(540, 360, 0, 1080);
    run(doubled, 0.6, 60, { head: null, region: { left: 0, width: 1080 }, height: 1920 });
    calls.length = 0;
    doubled.draw(context, 0, 1080);
    assert.equal(calls.length, first.length);
    calls.forEach((call, i) => call.rect.forEach((value, j) => near(value, first[i].rect[j] * 2, 1e-4)));
  });
});
