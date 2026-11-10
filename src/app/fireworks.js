// 香槟礼花。所有位置/速度用画布像素和秒；只有 update 推进时钟。
// 固定容量粒子池 + 固定长度轨迹，不保存画布残影，也不依赖识别/演示的绝对时间。
const TAU = Math.PI * 2;
const STEP = 1 / 120;
const EPS = 1e-9;
const PALETTE = ['255, 210, 140', '255, 174, 198', '159, 229, 224'];

export const FIREWORK_LIMITS = Object.freeze({
  bursts: 3,
  particles: 256,
  particlesPerBurst: 60,
  collisionFragments: 24,
  contactGlows: 12,
  fragmentsPerBurst: 8,
  contactsPerBurst: 6,
  trailPoints: 10
});

const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
const positive = (n, fallback) => Number.isFinite(n) && n > 0 ? n : fallback;
const boundedInt = (n, fallback, max) => Math.min(max, Math.max(0, Math.floor(finite(n, fallback))));

function limitVelocity(p, maxSpeed) {
  const speed = Math.hypot(p.vx, p.vy);
  if (speed > maxSpeed) {
    p.vx *= maxSpeed / speed;
    p.vy *= maxSpeed / speed;
  }
}

function safeHead(head) {
  if (!head || !Number.isFinite(head.cx) || !Number.isFinite(head.cy)
    || !Number.isFinite(head.rx) || !Number.isFinite(head.ry) || head.rx <= 0 || head.ry <= 0) return null;
  return { cx: head.cx, cy: head.cy, rx: head.rx, ry: head.ry, vx: finite(head.vx), vy: finite(head.vy) };
}

// 对线性阻尼和恒定重力做解析积分，不用每帧 *= 0.96 一类依赖帧率的写法。
function integrate(p, dt, drag, gravity) {
  if (drag <= EPS) {
    p.x += p.vx * dt;
    p.y += p.vy * dt + gravity * dt * dt / 2;
    p.vy += gravity * dt;
    return;
  }
  const decay = Math.exp(-drag * dt);
  const travel = -Math.expm1(-drag * dt) / drag;
  const terminal = gravity / drag;
  p.x += p.vx * travel;
  p.y += (p.vy - terminal) * travel + terminal * dt;
  p.vx *= decay;
  p.vy = p.vy * decay + gravity * travel;
}

// head 是本时间步结束时的位置。把粒子线段转换到移动头部的相对坐标，解椭圆入射根。
// 内部原地更新池中对象；导出的纯函数包装器和正式效果共用这一套物理。
function advanceParticle(p, dt, head, drag, gravity, maxSpeed, restitution) {
  p.collided = false;
  limitVelocity(p, maxSpeed);
  const x0 = p.x;
  const y0 = p.y;
  const vx0 = p.vx;
  const vy0 = p.vy;
  integrate(p, dt, drag, gravity);
  limitVelocity(p, maxSpeed);
  if (!head) {
    p.touching = false;
    return;
  }

  const rx = head.rx + p.radius;
  const ry = head.ry + p.radius;
  const hx0 = head.cx - head.vx * dt;
  const hy0 = head.cy - head.vy * dt;
  const ax = x0 - hx0;
  const ay = y0 - hy0;
  const dx = p.x - x0 - head.vx * dt;
  const dy = p.y - y0 - head.vy * dt;
  const c = (ax / rx) ** 2 + (ay / ry) ** 2 - 1;
  // 接触锁只在真正离开表面后释放；投影产生的微小间隙不能触发下一次冲量。
  const releaseGap = Math.max(0.25, p.radius * 0.3) / Math.min(rx, ry);
  if (c > (1 + releaseGap) ** 2 - 1) p.touching = false;
  let hitAt = null;
  if (c < 0) {
    hitAt = 0;
  } else {
    const a = (dx / rx) ** 2 + (dy / ry) ** 2;
    const b = 2 * (ax * dx / (rx * rx) + ay * dy / (ry * ry));
    const discriminant = b * b - 4 * a * c;
    if (a > EPS && b < 0 && discriminant >= 0) {
      const root = (-b - Math.sqrt(discriminant)) / (2 * a);
      if (root >= -EPS && root <= 1 + EPS) hitAt = Math.max(0, Math.min(1, root));
    }
  }
  if (hitAt === null) return;

  let lx = ax + dx * hitAt;
  let ly = ay + dy * hitAt;
  let radial = Math.hypot(lx / rx, ly / ry);
  if (radial < EPS) {
    // 恰好出现在中心：向相对来速的反方向投影，没有来速时用头顶。
    lx = -(vx0 - head.vx);
    ly = -(vy0 - head.vy);
    if (Math.hypot(lx, ly) < EPS) ly = -1;
    radial = Math.hypot(lx / rx, ly / ry);
  }
  lx /= radial;
  ly /= radial;
  let nx = lx / (rx * rx);
  let ny = ly / (ry * ry);
  const normalLength = Math.hypot(nx, ny);
  nx /= normalLength;
  ny /= normalLength;
  const gap = Math.max(0.05, p.radius * 0.06);
  const contactX = hx0 + head.vx * dt * hitAt + lx;
  const contactY = hy0 + head.vy * dt * hitAt + ly;
  p.x = x0;
  p.y = y0;
  p.vx = vx0;
  p.vy = vy0;
  integrate(p, dt * hitAt, drag, gravity);
  p.x = contactX + nx * gap;
  p.y = contactY + ny * gap;

  const incoming = (p.vx - head.vx) * nx + (p.vy - head.vy) * ny;
  if (incoming < -EPS && !p.touching) {
    p.vx -= (1 + restitution) * incoming * nx;
    p.vy -= (1 + restitution) * incoming * ny;
    limitVelocity(p, maxSpeed);
    p.touching = true;
    p.collided = true;
    p.hitX = contactX;
    p.hitY = contactY;
    p.nx = nx;
    p.ny = ny;
  }

  if ((p.vx - head.vx) * nx + (p.vy - head.vy) * ny < -EPS) {
    // 极快的头部可能仍追上已被限速的星点。只随表面投影，不反复施加冲量。
    p.x = head.cx + lx + nx * gap;
    p.y = head.cy + ly + ny * gap;
  } else {
    integrate(p, dt * (1 - hitAt), drag, gravity);
    // 重力或曲线近似可能让终点略微陷入椭圆，投影到同侧边界，不再加速。
    const q = Math.hypot((p.x - head.cx) / rx, (p.y - head.cy) / ry);
    if (q < 1) {
      p.x = head.cx + lx + nx * gap;
      p.y = head.cy + ly + ny * gap;
    }
  }
  limitVelocity(p, maxSpeed);
}

// 确定性物理测试入口：不修改输入，head.cx/cy 为 dtSec 结束时的位置。
export function stepFireworkParticle(particle, dtSec, head = null, options = {}) {
  const p = {
    ...particle,
    x: finite(particle.x), y: finite(particle.y),
    vx: finite(particle.vx), vy: finite(particle.vy),
    radius: Math.max(0, finite(particle.radius, 1))
  };
  const dt = Math.max(0, finite(dtSec));
  const drag = Math.max(0, finite(options.drag, 1.7));
  const gravity = finite(options.gravity, 81);
  const maxSpeed = positive(options.maxSpeed, 900);
  const restitution = Math.min(1, Math.max(0, finite(options.restitution, 0.68)));
  advanceParticle(p, dt, safeHead(head), drag, gravity, maxSpeed, restitution);
  return p;
}

export function createFireworks(cfg = {}, { random = Math.random } = {}) {
  const maxBursts = boundedInt(cfg.maxConcurrent, 3, FIREWORK_LIMITS.bursts);
  const maxParticles = boundedInt(cfg.maxParticles, FIREWORK_LIMITS.particles, FIREWORK_LIMITS.particles);
  const perBurst = boundedInt(cfg.particlesPerBurst, 60, FIREWORK_LIMITS.particlesPerBurst);
  const maxFragments = boundedInt(cfg.maxCollisionFragments, 24, FIREWORK_LIMITS.collisionFragments);
  const maxContacts = boundedInt(cfg.maxContactGlows, 12, FIREWORK_LIMITS.contactGlows);
  const trailPoints = boundedInt(cfg.trailPoints, 10, FIREWORK_LIMITS.trailPoints);
  const lifetime = Math.min(5000, Math.max(500, positive(cfg.lifetimeMs, 2400))) / 1000;
  const pool = Array.from({ length: maxParticles }, () => ({
    tx: new Float32Array(trailPoints), ty: new Float32Array(trailPoints), tt: new Float64Array(trailPoints)
  }));
  const bursts = [];
  let count = 0;
  let fragments = 0;
  let contacts = 0;
  let collisions = 0;
  let nextId = 0;
  let clock = 0;
  let carry = 0;
  let lastHead = null;
  let lastRegion = { left: 0, width: 540 };
  let lastHeight = 960;
  let sprites = null;
  const stepHead = {};
  const rand = () => Math.max(0, Math.min(1 - Number.EPSILON, finite(random(), 0.5)));

  function remove(i) {
    if (pool[i].kind === 1) fragments -= 1;
    if (pool[i].kind === 2) contacts -= 1;
    count -= 1;
    [pool[i], pool[count]] = [pool[count], pool[i]];
  }

  function removeBurst(index) {
    const id = bursts[index].id;
    let i = 0;
    while (i < count) {
      if (pool[i].burstId === id) remove(i);
      else i += 1;
    }
    bursts.splice(index, 1);
  }

  function add(b, kind, x, y, vx, vy, size, life, tone, strength) {
    if (count >= maxParticles || life <= 0) return null;
    const p = pool[count++];
    Object.assign(p, {
      burstId: b.id, unit: b.unit, kind, x, y, vx, vy, size,
      radius: size * 0.7, life, age: 0, tone, strength,
      phase: rand() * TAU, touching: false, collided: false,
      trailIndex: 0, trailCount: 0, trailAt: -Infinity
    });
    if (kind === 1) fragments += 1;
    if (kind === 2) contacts += 1;
    limitVelocity(p, b.unit * 1.65);
    return p;
  }

  function launch(px, py, now, unit = 540) {
    if (!Number.isFinite(px) || !Number.isFinite(py) || bursts.length >= maxBursts) return false;
    bursts.push({
      id: ++nextId, x: px, y: py, unit: positive(unit, 540), start: clock + carry,
      ascent: 0.17 + rand() * 0.06, phase: finite(now) * 0.001 % TAU + rand() * TAU,
      wave: 0, fragments: 0, contacts: 0
    });
    return true;
  }

  function emitWave(b, wave) {
    const from = [0, Math.round(perBurst * 0.5), Math.round(perBurst * 0.8)][wave];
    const to = [Math.round(perBurst * 0.5), Math.round(perBurst * 0.8), perBurst][wave];
    const n = to - from;
    for (let k = 0; k < n; k += 1) {
      const angle = b.phase + k * TAU / Math.max(1, n) + (rand() - 0.5) * 0.17 + wave * 0.36;
      const strong = rand() < 0.18;
      const speed = b.unit * (0.28 + rand() * 0.34) * (1 - wave * 0.15);
      const color = rand();
      const tone = color < 0.82 ? 0 : color < 0.92 ? 1 : 2;
      const size = b.unit * (strong ? 0.0033 + rand() * 0.0011 : 0.0012 + rand() * 0.0017);
      const left = lifetime - (clock - b.start);
      add(b, 0,
        b.x + (rand() - 0.5) * b.unit * 0.012,
        b.y + (rand() - 0.5) * b.unit * 0.01,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed * 0.82 - b.unit * 0.035,
        size, left * (0.72 + rand() * 0.28), tone, strong ? 0.95 : 0.45 + rand() * 0.3);
    }
  }

  function emitContact(p, b) {
    if (contacts < maxContacts && b.contacts < FIREWORK_LIMITS.contactsPerBurst) {
      if (add(b, 2, p.hitX, p.hitY, 0, 0, b.unit * 0.005, 0.11, 0, 0.6)) b.contacts += 1;
    }
    const n = rand() < 0.45 ? 2 : 1;
    for (let k = 0; k < n && fragments < maxFragments && b.fragments < FIREWORK_LIMITS.fragmentsPerBurst; k += 1) {
      const a = Math.atan2(p.ny, p.nx) + (rand() - 0.5) * 1.5;
      const speed = b.unit * (0.09 + rand() * 0.09);
      const fragment = add(b, 1, p.x, p.y,
        Math.cos(a) * speed + p.vx * 0.18,
        Math.sin(a) * speed + p.vy * 0.18,
        b.unit * (0.001 + rand() * 0.001), 0.28 + rand() * 0.18, p.tone, 0.65);
      if (fragment) b.fragments += 1;
    }
  }

  function remember(p) {
    const length = p.kind === 1 ? Math.min(4, trailPoints) : trailPoints;
    if (!length || clock - p.trailAt < 0.025 - EPS) return;
    p.tx[p.trailIndex] = p.x;
    p.ty[p.trailIndex] = p.y;
    p.tt[p.trailIndex] = clock;
    p.trailIndex = (p.trailIndex + 1) % length;
    p.trailCount = Math.min(length, p.trailCount + 1);
    p.trailAt = clock;
  }

  function update(dtSec, { head = null, region, height } = {}) {
    lastHead = safeHead(head);
    if (region && Number.isFinite(region.left) && Number.isFinite(region.width) && region.width > 0) {
      lastRegion = { left: region.left, width: region.width };
    }
    lastHeight = positive(height, lastHeight);
    const dt = Math.max(0, finite(dtSec));
    const end = clock + carry + dt;
    // 长时间停帧也按真实 dt 回收；先清理过期烟花，避免为看不见的旧粒子补算几千步。
    for (let i = bursts.length - 1; i >= 0; i -= 1) {
      if (end - bursts[i].start >= lifetime - EPS) removeBurst(i);
    }
    if (!bursts.length) {
      clock = end;
      carry = 0;
      return;
    }
    carry += dt;
    // 单发寿命最多 5 秒，因此即使传入异常长 dt，实际补算也不会超过 600 步。
    while (carry >= STEP - EPS) {
      carry = Math.max(0, carry - STEP);
      clock += STEP;
      if (lastHead) {
        Object.assign(stepHead, lastHead, {
          cx: lastHead.cx - lastHead.vx * carry,
          cy: lastHead.cy - lastHead.vy * carry
        });
      }
      for (const b of bursts) {
        const age = clock - b.start;
        while (b.wave < 3 && age >= b.ascent + [0, 0.055, 0.13][b.wave]) {
          emitWave(b, b.wave++);
        }
      }
      let i = 0;
      while (i < count) {
        const p = pool[i];
        p.age += STEP;
        if (p.age >= p.life || p.y > lastHeight + p.unit * 0.2
          || p.x < lastRegion.left - p.unit * 0.4 || p.x > lastRegion.left + lastRegion.width + p.unit * 0.4) {
          remove(i);
          continue;
        }
        if (p.kind !== 2) {
          advanceParticle(p, STEP, lastHead ? stepHead : null, p.kind === 1 ? 2.4 : 1.25,
            p.unit * (p.kind === 1 ? 0.23 : 0.22), p.unit * 1.65, 0.68);
          if (p.collided) {
            collisions += 1;
            p.trailCount = 0; // 不把碰撞前穿入人脸的路径连成一条亮线。
            p.trailIndex = 0;
            p.trailAt = -Infinity;
            if (p.kind === 0) {
              const b = bursts.find((burst) => burst.id === p.burstId);
              if (b) emitContact(p, b);
            }
          }
          remember(p);
        }
        i += 1;
      }
    }
  }

  // 首次 draw 才创建 6 张 64×64 纹理；正常绘制不再建渐变、不读 DOM、不填整屏。
  function makeSprites() {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    return PALETTE.map((color) => {
      const make = (star) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 64;
        const g = canvas.getContext('2d');
        if (!g) return null;
        const glow = g.createRadialGradient(32, 32, 0, 32, 32, 31);
        glow.addColorStop(0, 'rgba(255, 250, 232, 0.96)');
        glow.addColorStop(0.08, `rgba(${color}, 0.85)`);
        glow.addColorStop(0.22, `rgba(${color}, 0.32)`);
        glow.addColorStop(0.5, `rgba(${color}, 0.07)`);
        glow.addColorStop(1, `rgba(${color}, 0)`);
        g.fillStyle = glow;
        g.fillRect(0, 0, 64, 64);
        if (star) {
          // 星芒本身也由中心向外透明，避免硬十字线。
          const rays = g.createRadialGradient(32, 32, 0, 32, 32, 29);
          rays.addColorStop(0, `rgba(${color}, 0.9)`);
          rays.addColorStop(0.3, `rgba(${color}, 0.48)`);
          rays.addColorStop(1, `rgba(${color}, 0)`);
          g.fillStyle = rays;
          g.beginPath();
          for (let k = 0; k < 16; k += 1) {
            const a = k * TAU / 16;
            const r = k % 4 === 0 ? 30 : k % 2 === 0 ? 12 : 2.4;
            const x = 32 + Math.cos(a) * r;
            const y = 32 + Math.sin(a) * r;
            if (!k) g.moveTo(x, y);
            else g.lineTo(x, y);
          }
          g.closePath();
          g.fill();
        }
        return canvas;
      };
      return { glow: make(false), star: make(true) };
    });
  }

  function faceFade(x, y) {
    if (!lastHead) return 1;
    const d = ((x - lastHead.cx) / (lastHead.rx * 0.85)) ** 2
      + ((y - lastHead.cy - lastHead.ry * 0.12) / (lastHead.ry * 0.7)) ** 2;
    return 0.22 + 0.78 * Math.min(1, d);
  }

  function stamp(ctx, sprite, x, y, radius, alpha) {
    if (!sprite || alpha <= 0.001) return;
    ctx.globalAlpha = alpha * faceFade(x, y);
    ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
  }

  // effectNow 只为兼容宿主签名；生命周期、闪烁相位、上冲全部用内部 update 时钟。
  function draw(ctx, _effectNow, _width) {
    if (!bursts.length && !count) return;
    if (!sprites) sprites = makeSprites();
    if (!sprites) return;
    ctx.save();
    try {
      ctx.globalCompositeOperation = 'lighter';
      for (const b of bursts) {
        const age = Math.max(0, clock + carry - b.start);
        if (age < b.ascent) {
          const t = age / b.ascent;
          const y = b.y + b.unit * 0.085 * (1 - t) ** 2;
          for (let j = 4; j >= 0; j -= 1) {
            stamp(ctx, sprites[0].glow, b.x, y + b.unit * 0.006 * j,
              b.unit * (0.01 - j * 0.0012), (1 - j / 5) * 0.52 * Math.min(1, t * 5));
          }
          stamp(ctx, sprites[0].star, b.x, y, b.unit * 0.019, 0.6 * Math.sin(Math.PI * t));
        } else if (age < b.ascent + 0.12) {
          const fade = 1 - (age - b.ascent) / 0.12;
          stamp(ctx, sprites[0].glow, b.x, b.y, b.unit * 0.028, fade * fade * 0.34);
        }
      }
      for (let i = 0; i < count; i += 1) {
        const p = pool[i];
        const t = p.age / p.life;
        const flicker = 0.78 + 0.22 * Math.sin(p.phase + p.age * 17) ** 2;
        const alpha = p.strength * Math.min(1, p.age / 0.035) * (1 - t) ** 0.8 * flicker;
        const sprite = sprites[p.tone];
        const history = p.kind === 1 ? Math.min(4, trailPoints) : trailPoints;
        for (let j = 0; j < p.trailCount; j += 1) {
          const index = (p.trailIndex - p.trailCount + j + history) % history;
          const freshness = Math.max(0, 1 - (clock - p.tt[index]) / 0.25);
          stamp(ctx, sprite.glow, p.tx[index], p.ty[index], p.size * (2.1 + freshness),
            alpha * freshness * freshness * 0.2);
        }
        stamp(ctx, sprite.glow, p.x, p.y, p.size * (p.kind === 2 ? 4.8 : 3.8) * (1 - t * 0.35), alpha);
        if (p.kind === 2 || (p.kind === 0 && p.strength > 0.9)) {
          stamp(ctx, sprite.star, p.x, p.y, p.size * 5.5 * (1 - t * 0.35), alpha * 0.7);
        }
      }
    } finally {
      ctx.restore();
    }
  }

  function clear() {
    bursts.length = 0;
    count = fragments = contacts = collisions = nextId = 0;
    clock = carry = 0;
    lastHead = null;
    lastRegion = { left: 0, width: 540 };
    lastHeight = 960;
  }

  return {
    launch, update, draw, clear,
    get burstCount() { return bursts.length; },
    get particleCount() { return count; },
    get collisionCount() { return collisions; }
  };
}

export default createFireworks;
