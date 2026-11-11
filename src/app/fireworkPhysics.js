// 烟花粒子物理：线性阻尼 + 恒定重力的解析积分，和移动头部椭圆的连续碰撞。
// 从香槟礼花里拆出来，新的大笑烟花复用同一套物理。所有位置/速度用画布像素和秒。
const EPS = 1e-9;

// 人物碰撞体（和雨共用）：头部椭圆 + 肩膀椭圆；肩膀按下巴定位，肩线上沿约在头部中心下 1.15 ry。
export const SHOULDER_TOP = 1.15;
export function bodyShapes(head) {
  return [
    { part: 'head', cx: head.cx, cy: head.cy, rx: head.rx, ry: head.ry },
    { part: 'shoulders', cx: head.cx, cy: head.cy + head.ry * (SHOULDER_TOP + 0.8), rx: head.rx * 3, ry: head.ry * 0.8 }
  ];
}

export const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
export const positive = (n, fallback) => Number.isFinite(n) && n > 0 ? n : fallback;

export function limitVelocity(p, maxSpeed) {
  const speed = Math.hypot(p.vx, p.vy);
  if (speed > maxSpeed) {
    p.vx *= maxSpeed / speed;
    p.vy *= maxSpeed / speed;
  }
}

export function safeHead(head) {
  if (!head || !Number.isFinite(head.cx) || !Number.isFinite(head.cy)
    || !Number.isFinite(head.rx) || !Number.isFinite(head.ry) || head.rx <= 0 || head.ry <= 0) return null;
  return { cx: head.cx, cy: head.cy, rx: head.rx, ry: head.ry, vx: finite(head.vx), vy: finite(head.vy) };
}

// 对线性阻尼和恒定重力做解析积分，不用每帧 *= 0.96 一类依赖帧率的写法。
export function integrate(p, dt, drag, gravity) {
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
export function advanceParticle(p, dt, head, drag, gravity, maxSpeed, restitution) {
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
