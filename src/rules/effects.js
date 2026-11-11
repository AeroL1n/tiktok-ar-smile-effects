// 烟花节奏：进入大笑立即放一发，持续大笑每隔 intervalMs 再放，同屏最多 maxConcurrent 发。
// 返回值里还有 laughMs（这次大笑已经持续多久，用来给单词升档）、index（这次大笑里的第几发）、
// full（是不是完整的一发：第一发和之后每 fullEvery 发一次）、tier（单词档位）。
export function createFireworkScheduler(cfg) {
  let active = [];
  let lastLaunchAt = -Infinity;
  let wasLaughing = false;
  let laughStart = 0;
  let index = 0;

  function tierFor(laughMs) {
    const tiers = cfg.words?.tiers ?? [];
    let tier = 0;
    tiers.forEach((t, k) => { if (laughMs >= t.fromMs) tier = k; });
    return tier;
  }

  // 这一版：进入大笑立即放，之后每 intervalMs（800 毫秒）放一轮完整的 1 大 + 2 中 + 1 小。
  function update(now, laughing) {
    active = active.filter((t) => now - t < cfg.lifetimeMs);
    if (laughing && !wasLaughing) {
      laughStart = now;
      index = 0;
    }
    const laughMs = laughing ? now - laughStart : 0;
    let launch = false;
    if (laughing) {
      const due = !wasLaughing || now - lastLaunchAt >= cfg.intervalMs;
      if (due && active.length < cfg.maxConcurrent) {
        active.push(now);
        lastLaunchAt = now;
        launch = true;
        index += 1;
      }
    }
    wasLaughing = laughing;
    return { launch, active: active.length, laughMs, index: launch ? index - 1 : -1, full: launch, tier: tierFor(laughMs) };
  }

  function reset() {
    active = [];
    lastLaunchAt = -Infinity;
    wasLaughing = false;
    laughStart = 0;
    index = 0;
  }

  return { update, reset };
}

// 一轮烟花的布局：以人脸为中心，向四周的不同方向各放一颗。
// 方向用“从正上方顺时针”的角度表示（度）：-90 左、-48 左上、0 正上、48 右上、90 右；不往下发（那里是胸口）。
// 完整一轮：1 朵大花 + 2 朵中花 + 1 朵小花；轻量一轮：1 中 + 1 小。每颗占一个扇区，优先避开上一轮用过的扇区。
// 绽放点离脸足够远，花不盖住脸；放不进画面时把方向往上转，直到放得下。
// 目前主流程改成了“主花 + 小装饰”，这个布局函数保留给测试和以后的多点构图使用。
export function planVolley(head, view, { full = true, avoid = [], unit = 540 } = {}, vcfg, random = Math.random) {
  const deg = Math.PI / 180;
  const sectors = vcfg.sectors;
  const order = sectors.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  order.sort((a, b) => Number(avoid.includes(a)) - Number(avoid.includes(b)));
  const take = (allowed) => {
    const k = order.findIndex((i) => allowed(i));
    return order.splice(k >= 0 ? k : 0, 1)[0];
  };
  const upward = (i) => Math.abs(sectors[i]) < 60;
  const sizes = full ? ['big', 'mid', 'mid', 'small'] : ['mid', 'small'];
  const L = view.left ?? 0;
  const T = view.top ?? 0;
  const W = view.width;
  const H = view.height ?? W * 16 / 9;
  const contour = (sx, sy) => 1 / Math.sqrt((sx / head.rx) ** 2 + (sy / head.ry) ** 2);
  const shells = [];
  const used = [];
  let delay = 0;
  // 固定构图，保证每一轮都整齐：大花正上、两朵中花左右对称、小花偏左下。
  const fixed = { 0: 2, 1: 1, 2: 3, 3: 0 };
  sizes.forEach((size, n) => {
    const sector = fixed[n] ?? 2;
    used.push(sector);
    const R = (size === 'big' ? vcfg.big : size === 'mid' ? vcfg.mid : vcfg.small) * unit;
    const theta0 = sectors[sector] + (random() - 0.5) * vcfg.spread * 0.5;
    let best = null;
    let chosen = null;
    for (let k = 0; !chosen; k += 1) {
      const step = vcfg.rotateStep * k;
      const theta = Math.abs(theta0) <= step ? 0 : theta0 - Math.sign(theta0) * step;
      for (const extra of [0, 0.4, 0.8]) {
        const sx = Math.sin(theta * deg);
        const sy = -Math.cos(theta * deg);
        const dist = contour(sx, sy) * 1.12 + R * (0.75 + extra * 0.4);
        let x = head.cx + sx * dist;
        let y = head.cy + sy * dist;
        const maxR = vcfg.maxOffset ?? 1.9;
        const ox = x - head.cx;
        const oy = y - head.cy;
        const kk = Math.hypot(ox / (head.rx * maxR), oy / (head.ry * maxR));
        if (kk > 1) {
          x = head.cx + ox / kk;
          y = head.cy + oy / kk;
        }
        const fits = x - R * 0.8 >= L && x + R * 0.8 <= L + W && y - R * 0.8 >= T && y + R * 0.4 <= T + H;
        if (!fits) continue;
        const sep = Math.min(Infinity, ...shells.map((q) => Math.hypot(x - q.x, y - q.y) - 0.85 * (R + q.radius)));
        const c = { theta, x, y, sx, sy };
        if (sep >= 0) {
          chosen = c;
          break;
        }
        if (!best || sep > best.sep) best = { ...c, sep };
      }
      if (theta === 0 && !chosen) chosen = best;
      if (theta === 0) break;
    }
    if (!chosen) {
      const x = Math.min(L + W - R * 0.8, Math.max(L + R * 0.8, head.cx));
      chosen = { theta: 0, x, y: T + R * 0.8, sx: 0, sy: -1 };
    }
    const fromDist = contour(chosen.sx, chosen.sy) * 1.08;
    if (n > 0) delay += vcfg.gap[0] + random() * (vcfg.gap[1] - vcfg.gap[0]);
    shells.push({
      x: chosen.x, y: chosen.y, radius: R, size, delay, theta: chosen.theta, sector,
      from: { x: head.cx + chosen.sx * fromDist, y: head.cy + chosen.sy * fromDist }
    });
  });
  return { shells, sectors: used };
}

// 祝福之雨的生命周期（v2：头顶轻雨 + 彩虹）。
// phase：idle 待机；opening 开场（先落几颗，再展开成轻雨）；raining 持续轻雨；ending 收尾。
// emission：新雨滴的生成量，满值就是“轻雨”，持续微笑不再加密；residual：已有雨滴的可见度；
// rainbow / glow：彩虹和头部水雾的强度。出现顺序：雾 → 雨 → 彩虹；收尾顺序：雨停 → 彩虹淡出 → 雾最后散。started / ended 只在开场、正常收尾那一帧为 true。
// 收尾期间再次微笑：从当前雨量接着下，不重播开场；收尾结束后再微笑才重新开场。
// 转入大笑：快速收住（cut），已有雨滴也很快淡出，让烟花当主角。
export function createRainEnvelope(cfg) {
  let phase;
  let cut;
  let openAt;
  let endAt;
  let emission;
  let rainbow;
  let glow;
  let residual;
  let lastAt;

  function reset() {
    phase = 'idle';
    cut = false;
    openAt = -Infinity;
    endAt = -Infinity;
    emission = 0;
    rainbow = 0;
    glow = 0;
    residual = 0;
    lastAt = null;
  }

  const up = (v, dt, ms) => Math.min(1, v + dt / ms);
  const down = (v, dt, ms) => Math.max(0, v - dt / ms);

  function update(now, state) {
    const dt = lastAt === null ? 0 : Math.max(0, now - lastAt);
    lastAt = now;
    const smiling = state === 'smile';
    const laughing = state === 'laugh';
    let started = false;
    let ended = false;

    if (phase === 'ending' && now - endAt >= (cut ? cfg.cutTailMs : cfg.tailMs)) phase = 'idle';

    if (smiling) {
      if (phase === 'idle') {
        phase = 'opening';
        openAt = now;
        emission = 0;
        started = true;
      } else if (phase === 'ending') {
        phase = 'raining';
      }
    } else if (phase === 'opening' || phase === 'raining') {
      phase = 'ending';
      endAt = now;
      cut = laughing;
      ended = !laughing;
    } else if (phase === 'ending' && laughing && !cut) {
      cut = true;
    }

    if (phase === 'opening') {
      // 先起雾（mistLeadMs 内不落雨），再落几颗，再展开成轻雨。
      const t = now - openAt - cfg.mistLeadMs;
      const ramp = Math.min(1, Math.max(0, t - cfg.openMs) / cfg.spreadMs);
      emission = t < 0 ? 0 : t < cfg.openMs ? cfg.openLevel : cfg.openLevel + (1 - cfg.openLevel) * ramp;
      if (ramp >= 1) phase = 'raining';
    } else if (phase === 'raining') {
      emission = up(emission, dt, cfg.resumeMs);
    } else {
      emission = down(emission, dt, cut ? cfg.cutDecayMs : cfg.decayMs);
    }

    if (phase === 'opening' || phase === 'raining') {
      residual = up(residual, dt, cfg.glowInMs);
      glow = up(glow, dt, cfg.glowInMs);
      if (now - openAt >= cfg.rainbowDelayMs) rainbow = up(rainbow, dt, cfg.rainbowInMs);
    } else {
      // 正常收尾时已有雨滴保持可见、自然落完；只有转大笑时才一起淡出。
      if (cut) residual = down(residual, dt, cfg.cutFadeMs);
      glow = down(glow, dt, cut ? cfg.cutFadeMs : cfg.glowOutMs);
      rainbow = down(rainbow, dt, cut ? cfg.cutFadeMs : cfg.rainbowOutMs);
    }
    if (phase === 'idle') residual = 0;

    return { phase, emission, rainbow, glow, residual, started, ended, active: phase !== 'idle' };
  }

  reset();
  return { update, reset };
}

// 雨的生成区：头顶上方一小片。头贴近画面顶部时，生成区下移到可见画面以内。view.top 是可见画面上沿（画布像素）。
export function rainZone(head, cfg, view) {
  const top = head.cy - head.ry;
  const minY = (view?.top ?? 0) + 2;
  const y0 = Math.max(minY, top - cfg.zoneTop * head.ry);
  const y1 = Math.max(y0 + 4, top - cfg.zoneBottom * head.ry);
  return { cx: head.cx, halfWidth: cfg.zoneHalfWidth * head.rx, y0, y1 };
}

// 彩虹的位置：用两个端点定位，贴着头顶。按“屏幕上看到的样子”计算（不含镜像，镜像由绘制时处理）。
// bow.left / bow.right：两个端点相对头部的位置 [横向几个 rx, 相对头顶几个 ry（负数在头顶上方）]；
// bow.spanDeg：弧对应的圆心角；bow.band：色带宽度（几个 rx）。
// 返回圆心、半径、色带宽度、弧顶方向（tilt，弧度）和两个端点（画布像素）。整条弧限制在可见画面内。
export function rainbowPlacement(head, bow, view) {
  const topY = head.cy - head.ry;
  const L = { x: head.cx + bow.left[0] * head.rx, y: topY + bow.left[1] * head.ry };
  const R = { x: head.cx + bow.right[0] * head.rx, y: topY + bow.right[1] * head.ry };
  const dx = R.x - L.x;
  const dy = R.y - L.y;
  const c = Math.hypot(dx, dy) || 1;
  const half = (bow.spanDeg * Math.PI) / 360;
  const r = c / (2 * Math.sin(half));
  // 弧顶方向：弦的法线里朝上的那个。
  let nx = dy / c;
  let ny = -dx / c;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const mx = (L.x + R.x) / 2;
  const my = (L.y + R.y) / 2;
  let cx = mx - nx * r * Math.cos(half);
  let cy = my - ny * r * Math.cos(half);
  const band = bow.band * head.rx;
  // 限制在可见画面内：取弧上 9 个点的外沿，整体平移。
  const top = view.top ?? 0;
  const margin = Math.min(view.width, view.height ?? view.width) * 0.02;
  const pad = band;
  const tilt = Math.atan2(ny, nx);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  for (let k = 0; k <= 8; k += 1) {
    const a = tilt - half + (2 * half * k) / 8;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
  }
  minX -= pad;
  maxX += pad;
  let shiftX = 0;
  if (minX < view.left + margin) shiftX = view.left + margin - minX;
  else if (maxX > view.left + view.width - margin) shiftX = view.left + view.width - margin - maxX;
  const shiftY = Math.max(0, top + margin - (minY - pad));
  cx += shiftX;
  cy += shiftY;
  return {
    cx,
    cy,
    r,
    band,
    tilt,
    left: { x: L.x + shiftX, y: L.y + shiftY },
    right: { x: R.x + shiftX, y: R.y + shiftY }
  };
}

// 由人脸关键点外框推算头部椭圆（画布像素）。向上多留一截给头发，粒子按这个椭圆碰撞。
// 2026-11-11 真人截图校准：原来的椭圆顶部比发顶低约 0.15 个脸高，雨像是钻进头发里才消失；
// 现在向上、向两侧各放大约 15–20%，盖住头发。
export function headEllipse(box, width, height) {
  return {
    cx: box.cx * width,
    cy: (box.cy - box.height * 0.14) * height,
    rx: box.width * 0.64 * width,
    ry: box.height * 0.72 * height
  };
}

// 人物碰撞体：头部椭圆 + 下方一个扁宽椭圆代表肩膀和上半身。两种输入模式共用，都由头部椭圆推算（不检测肩膀本身）。
// 2026-11-11 真人截图校准：下巴约在 head.cy + 0.89 ry；肩线上沿约比下巴低 0.2 个脸高，取 head.cy + 1.15 ry。
// 椭圆扁而宽（半宽 3 个 rx），上沿接近平的肩线；下半部分通常在画面外。
export { SHOULDER_TOP, bodyShapes } from '../app/fireworkPhysics.js';

// 肩线上沿在横坐标 x 处的高度；x 超出肩膀范围时返回 null。
export function shoulderTopAt(shape, x) {
  const t = (x - shape.cx) / shape.rx;
  if (t <= -1 || t >= 1) return null;
  return shape.cy - shape.ry * Math.sqrt(1 - t * t);
}

// 返回点 (x, y) 落入的第一个碰撞体，没碰到返回 null。
export function hitShape(x, y, shapes) {
  for (const s of shapes) {
    const ex = (x - s.cx) / s.rx;
    const ey = (y - s.cy) / s.ry;
    if (ex * ex + ey * ey < 1) return s;
  }
  return null;
}

// 识别每秒约 20 次，渲染 60 帧：渲染侧让头部椭圆平滑地追向最新识别结果，并估算头部速度。
// 人脸丢失后保留 holdMs，避免一闪而过时粒子直接穿过头。
export function createHeadFollower({ followMs, holdMs }) {
  let head = null;
  let lostFor = 0;

  function update(target, dtMs) {
    if (!target) {
      lostFor += dtMs;
      if (lostFor > holdMs) head = null;
      else if (head) {
        head.vx *= 0.8;
        head.vy *= 0.8;
      }
      return head;
    }
    lostFor = 0;
    if (!head) {
      head = { ...target, vx: 0, vy: 0 };
      return head;
    }
    const a = dtMs <= 0 ? 0 : 1 - Math.exp(-dtMs / followMs);
    const px = head.cx;
    const py = head.cy;
    head.cx += a * (target.cx - head.cx);
    head.cy += a * (target.cy - head.cy);
    head.rx += a * (target.rx - head.rx);
    head.ry += a * (target.ry - head.ry);
    if (dtMs > 0) {
      const sec = dtMs / 1000;
      head.vx += 0.3 * ((head.cx - px) / sec - head.vx);
      head.vy += 0.3 * ((head.cy - py) / sec - head.vy);
    }
    return head;
  }

  function reset() {
    head = null;
    lostFor = 0;
  }

  return { update, reset };
}
