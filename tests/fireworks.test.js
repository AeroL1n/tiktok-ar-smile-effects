import test from 'node:test';
import assert from 'node:assert/strict';
import createFireworks, { FIREWORK_LIMITS, KINDS, stepFireworkParticle } from '../src/app/fireworks.js';
import { createFireworkScheduler } from '../src/rules/effects.js';
import { RULES } from '../src/rules/config.js';

const cfg = RULES.fireworks;
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
            fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {},
            scale() {}, fillText() {}, measureText(text) { return { width: text.length * 26 }; },
            // 中部一条假的笔画带：让 makeWordSprite 能采到字形点，消散才有火星可发。
            getImageData(_x, _y, w, h) {
              const data = new Uint8ClampedArray(w * h * 4);
              for (let py = Math.floor(h * 0.4); py < h * 0.6; py += 2) {
                for (let px = Math.floor(w * 0.3); px < w * 0.7; px += 2) data[(py * w + px) * 4 + 3] = 255;
              }
              return { data };
            }
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
    transform: [1, 0, 0, 1, 0, 0],
    setTransform(...m) { this.transform = m; },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fillRect() {},
    drawImage(_sprite, ...rect) {
      calls.push({ rect, alpha: this.globalAlpha, blend: this.globalCompositeOperation, transform: this.transform });
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

const head = { cx: 270, cy: 420, rx: 90, ry: 112, vx: 0, vy: 0 };
const withHead = { ...scene, head };
const launchAt = (fireworks, opts = {}) => fireworks.launch(270, head.cy - head.ry * 2.1, 0, 540, { full: true, tier: 0, ...opts });
const kinds = (fireworks) => new Set(fireworks.snapshot().particles.map((p) => p.kind));

test('烟花可在无 DOM 时启动和更新，默认导出与命名接口可用', () => {
  const fireworks = createFireworks(cfg, { random: seeded() });
  assert.equal(launchAt(fireworks), true);
  run(fireworks, 1.2);
  assert.equal(fireworks.burstCount, 1);
  assert.ok(fireworks.particleCount > 30);
  assert.equal(fireworks.collisionCount, 0);
});

test('过程：先发射、辅助烟花上冲，到顶停顿后主花绽放，同时弹出一个主词', () => {
  const fireworks = createFireworks(cfg, { random: seeded() });
  launchAt(fireworks);
  run(fireworks, 0.35, 120, withHead);
  assert.ok(kinds(fireworks).has(KINDS.STREAK), '辅助烟花先上冲');
  assert.ok(!kinds(fireworks).has(KINDS.PETAL), '主花还没炸开');
  assert.equal(fireworks.wordCount, 0);
  run(fireworks, 1.0, 120, withHead);
  const petals = fireworks.snapshot().particles.filter((p) => p.kind === KINDS.PETAL).length;
  assert.ok(petals >= 30 && petals <= FIREWORK_LIMITS.petals, `主花 ${petals} 颗`);
  const words = fireworks.snapshot().words;
  assert.equal(words.filter((w) => w.main).length, 1);
  assert.ok(cfg.words.tiers[0].words.includes(words[0].text));
});

test('二次绽放：主花里约 3 颗再炸开一圈，并带出 1–2 个碎词', () => {
  let sawCrackle = false;
  let fragments = 0;
  const fireworks = createFireworks(cfg, { random: seeded(5) });
  launchAt(fireworks);
  for (let i = 0; i < 200; i += 1) {
    fireworks.update(1 / 120, scene);
    const snap = fireworks.snapshot();
    if (snap.particles.some((p) => p.kind === KINDS.CRACKLE)) sawCrackle = true;
    fragments = Math.max(fragments, snap.words.filter((w) => !w.main).length);
  }
  assert.ok(sawCrackle);
  assert.ok(fragments >= 1 && fragments <= 2, `碎词 ${fragments} 个`);
  for (const w of fireworks.snapshot().words) if (!w.main) assert.ok(cfg.words.fragments.includes(w.text));
});

test('辅助烟花：从头两侧发射，不从脸前经过；结局有散落、渐隐、小绽放三种', () => {
  const fates = new Set();
  let sawEmber = false;
  let sawPop = false;
  for (let seed = 1; seed < 12; seed += 1) {
    const fireworks = createFireworks(cfg, { random: seeded(seed) });
    fireworks.update(0, withHead);
    launchAt(fireworks);
    for (let i = 0; i < 160; i += 1) {
      fireworks.update(1 / 120, withHead);
      for (const p of fireworks.snapshot().particles) {
        if (p.kind === KINDS.STREAK) {
          fates.add(p.fate);
          assert.ok(Math.hypot((p.x - head.cx) / head.rx, (p.y - head.cy) / head.ry) >= 0.9, '大致从轮廓外侧放射');
        }
        if (p.kind === KINDS.EMBER) sawEmber = true;
        if (p.kind === KINDS.POP) sawPop = true;
      }
    }
  }
  assert.deepEqual([...fates].sort(), [0, 1, 2]);
  assert.ok(sawEmber && sawPop);
});

test('单词按大笑时长升档：刚笑 HAHA/hehe，笑开后出现 LOL / I\'M DEAD 一类', () => {
  const scheduler = createFireworkScheduler(cfg);
  const fireworks = createFireworks(cfg, { random: seeded() });
  const seen = [];
  const faceScene = { head: { cx: 270, cy: 420, rx: 90, ry: 112, vx: 0, vy: 0 }, region: { left: 0, width: 540 }, height: 960 };
  for (let t = 0; t <= 14000; t += 1000 / 60) {
    const r = scheduler.update(t, true);
    if (r.launch) fireworks.launch(270, 180, t, 540, r);
    fireworks.update(1 / 60, faceScene);
    const w = fireworks.snapshot().words.find((x) => x.main);
    if (w && (!seen.length || seen.at(-1).text !== w.text || t - seen.at(-1).t > 1)) seen.push({ t, text: w.text });
  }
  assert.ok(seen.length >= 3, `至少换了 3 次词（${seen.length}）`);
  assert.ok(cfg.words.tiers[0].words.includes(seen[0].text), '第一个词来自第一档');
  const late = seen.filter((x) => x.t > 8000).map((x) => x.text);
  const latePool = cfg.words.tiers.slice(1).flatMap((t) => t.words);
  assert.ok(late.some((x) => latePool.includes(x)), '后段出现更高档的词');
  for (const tier of cfg.words.tiers) for (const word of tier.words) assert.ok(/^[\x20-\x7e]+$/.test(word));
});


test('调度：进入大笑立即放一轮，之后每 0.8 秒一轮，停下再笑立即放', () => {
  const scheduler = createFireworkScheduler(cfg);
  const launches = [];
  for (let t = 0; t <= 1600; t += 50) if (scheduler.update(t, true).launch) launches.push(t);
  assert.deepEqual(launches, [0, 800, 1600]);
  scheduler.update(1700, false);
  assert.equal(scheduler.update(1700 + cfg.lifetimeMs, true).launch, true);
});


test('单词原地小字渐显、放大，最后从字形散成火星', () => {
  withCanvas(() => {
    const fireworks = createFireworks(cfg, { random: seeded() });
    // 每 0.8 秒补一轮：消散时要从还活着的烟花借粒子和寿命。
    let first = null;
    let late = null;
    let plan = 0;
    let emitted = 0;
    for (let i = 0; i <= 480; i += 1) {
      if (i % 96 === 0) fireworks.launch(head.cx, head.cy - head.ry * 1.6, i / 120, 540, { full: true, tier: 1 });
      fireworks.update(1 / 120, withHead);
      const words = fireworks.snapshot().words;
      if (!first) first = words.find((w) => w.main) ?? null;
      if (!first) continue;
      const same = words.find((w) => w.main && w.born === first.born);
      if (!same) continue;
      if (same.age >= 0.9 && same.age < 1.05 && !late) late = same;
      plan = Math.max(plan, same.dissolve);
      emitted = Math.max(emitted, same.emitted);
    }
    assert.ok(first && late, '主词出现了');
    assert.ok(Math.abs(first.x - late.x) < 1e-6 && Math.abs(first.y - late.y) < 1e-6, '词原地不动，不再下落');
    assert.equal(plan, 13, '大词消散计划 13 颗');
    assert.equal(emitted, 13, '13 颗火星全部散出');
  });
});

test('持续大笑一分钟：烟花数、光粒、单词都有上限，碰撞真实发生', () => {
  const fireworks = createFireworks(cfg, { random: seeded() });
  const scheduler = createFireworkScheduler(cfg);
  let launched = 0;
  let peak = 0;
  for (let i = 0; i < 60 * 60; i += 1) {
    const r = scheduler.update(i * 1000 / 60, true);
    if (r.launch) {
      launched += 1;
      fireworks.launch(head.cx, head.cy - head.ry * 2.1, i * 1000 / 60, 540, r);
    }
    fireworks.update(1 / 60, withHead);
    assert.ok(fireworks.burstCount <= FIREWORK_LIMITS.shells * 3 + 1);
    assert.ok(fireworks.particleCount <= FIREWORK_LIMITS.particles);
    assert.ok(fireworks.wordCount <= FIREWORK_LIMITS.words);
    peak = Math.max(peak, fireworks.particleCount);
  }
  assert.ok(launched > 60);
  assert.ok(peak > 100, `峰值 ${peak}`);
  assert.ok(fireworks.collisionCount > 0);
});

test('帧率降级：质量降低后辅助烟花、二次绽放和碎词变少', () => {
  const count = (q) => {
    const fireworks = createFireworks(cfg, { random: seeded() });
    fireworks.setQuality(q);
    launchAt(fireworks);
    let peak = 0;
    let frag = 0;
    for (let i = 0; i < 240; i += 1) {
      fireworks.update(1 / 120, scene);
      peak = Math.max(peak, fireworks.particleCount);
      frag = Math.max(frag, fireworks.snapshot().words.filter((w) => !w.main).length);
    }
    return { peak, frag };
  };
  const full = count(1);
  const low = count(0.3);
  assert.ok(low.peak < full.peak);
  assert.ok(low.frag <= full.frag);
});

test('配置容量再大也受绝对上限约束，小容量的粒子池不能溢出', () => {
  const small = createFireworks({ ...cfg, maxConcurrent: 999, maxParticles: 18, particlesPerBurst: 999 }, { random: () => 0.5 });
  for (let i = 0; i < 50; i += 1) small.launch(270, 180, i);
  assert.equal(small.burstCount, FIREWORK_LIMITS.shells);
  run(small, 0.9, 120, { ...scene, head: { cx: 270, cy: 230, rx: 100, ry: 120, vx: 0, vy: 0 } });
  assert.ok(small.particleCount > 0 && small.particleCount <= 18);
  const zero = createFireworks({ ...cfg, maxParticles: 0 });
  zero.launch(270, 180, 0);
  zero.update(0.9, scene);
  assert.equal(zero.particleCount, 0);
});

test('update 是唯一时间源：launch 的时间参数和 draw 的时间不会改变寿命', () => {
  const a = createFireworks(cfg, { random: seeded() });
  const b = createFireworks(cfg, { random: seeded() });
  a.launch(270, 180, 0);
  b.launch(270, 180, 987654321 * 1000);
  run(a, 0.8);
  run(b, 0.8);
  withCanvas(({ context }) => {
    for (let i = 0; i < 20; i += 1) b.draw(context, i * 1e12, 540);
  });
  assert.equal(a.particleCount, b.particleCount);
  a.update(2, scene);
  b.update(2, scene);
  // 词会在烟花期间不断续上，所以先等烟花结束、再让最后一批词耗尽。
  a.update(3, scene);
  b.update(3, scene);
  assert.equal(a.burstCount + b.burstCount + b.particleCount, 0);
});

test('clear 清空烟花、光粒、单词、碰撞统计和内部时钟', () => {
  const fireworks = createFireworks(cfg, { random: seeded(3) });
  fireworks.launch(270, 180, 5);
  run(fireworks, 1.2, 120, { ...scene, head: { cx: 270, cy: 260, rx: 100, ry: 120, vx: 0, vy: 0 } });
  assert.ok(fireworks.collisionCount > 0);
  fireworks.clear();
  assert.deepEqual([fireworks.burstCount, fireworks.particleCount, fireworks.wordCount, fireworks.collisionCount], [0, 0, 0, 0]);
});


test('小于固定步长的 dt 能累积，非法或负 dt 不会让时间倒退', () => {
  const a = createFireworks(cfg, { random: seeded() });
  const b = createFireworks(cfg, { random: seeded() });
  a.launch(270, 180, NaN);
  b.launch(270, 180, 0);
  for (let i = 0; i < 700; i += 1) a.update(0.001, scene);
  b.update(0.7, scene);
  assert.equal(a.particleCount, b.particleCount);
  const n = a.particleCount;
  for (const dt of [-1, NaN, Infinity, undefined]) a.update(dt, scene);
  assert.equal(a.particleCount, n);
});

test('寿命末端全部回收，长停帧不补出陈旧爆发', () => {
  const fireworks = createFireworks(cfg, { random: seeded() });
  fireworks.launch(270, 180, 0);
  fireworks.update(0.7, scene);
  assert.ok(fireworks.particleCount > 0);
  fireworks.update(cfg.lifetimeMs / 1000, scene);
  assert.deepEqual([fireworks.burstCount, fireworks.particleCount, fireworks.wordCount], [0, 0, 0]);
  fireworks.launch(270, 180, 0);
  fireworks.update(3600, scene);
  assert.equal(fireworks.particleCount, 0);
});

test('首次 draw 懒建纹理（含全部单词），后续帧不再创建渐变；始终 save/restore，绘制都是局部贴图', () => {
  withCanvas(({ stats, context, calls }) => {
    const fireworks = createFireworks(cfg, { random: seeded() });
    launchAt(fireworks);
    run(fireworks, 0.9);
    assert.equal(stats.canvases, 0);
    fireworks.draw(context, 0, 540);
    const canvases = stats.canvases;
    const gradients = stats.gradients;
    assert.ok(canvases > 8);
    const first = calls.splice(0);
    fireworks.draw(context, 999999999, 800);
    assert.equal(stats.gradients, gradients);
    assert.equal(stats.canvases, canvases);
    assert.deepEqual(calls.map((c) => c.rect), first.map((c) => c.rect), 'draw 参数不推进动画');
    assert.equal(context.globalAlpha, 0.43);
    assert.equal(context.globalCompositeOperation, 'source-over');
    assert.equal(context.saveCount, context.restoreCount);
    for (const call of calls) {
      assert.ok(call.rect.every(Number.isFinite));
      assert.ok(call.alpha >= 0 && call.alpha <= 1);
      assert.ok(call.blend === 'lighter' || call.blend === 'source-over');
    }
  });
});

test('渲染异常仍恢复宿主画布状态', () => {
  withCanvas(({ context }) => {
    const fireworks = createFireworks(cfg, { random: seeded() });
    fireworks.launch(270, 180, 0);
    run(fireworks, 0.7);
    context.drawImage = () => { throw new Error('绘制失败'); };
    assert.throws(() => fireworks.draw(context, 600, 540), /绘制失败/);
    assert.equal(context.saveCount, context.restoreCount);
    assert.equal(context.globalAlpha, 0.43);
    assert.equal(context.globalCompositeOperation, 'source-over');
  });
});

test('30、60、120 帧下的结果一致（固定步长）', () => {
  const results = [30, 60, 120].map((fps) => {
    const fireworks = createFireworks(cfg, { random: seeded() });
    fireworks.update(0, { ...scene, head: { cx: 230, cy: 260, rx: 70, ry: 90, vx: 0, vy: 0 } });
    fireworks.launch(270, 120, 0);
    for (let i = 1; i <= fps; i += 1) fireworks.update(1 / fps, { ...scene, head: { cx: 230 + 30 * i / fps, cy: 260, rx: 70, ry: 90, vx: 30, vy: 0 } });
    return [fireworks.particleCount, fireworks.wordCount, fireworks.collisionCount];
  });
  for (const r of results.slice(1)) assert.deepEqual(r, results[0]);
});
