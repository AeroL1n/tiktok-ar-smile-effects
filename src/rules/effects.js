// 烟花节奏：进入大笑立即放一发，持续大笑每隔 intervalMs 再放，同屏最多 maxConcurrent 发。
export function createFireworkScheduler(cfg) {
  let active = [];
  let lastLaunchAt = -Infinity;
  let wasLaughing = false;

  function update(now, laughing) {
    active = active.filter((t) => now - t < cfg.lifetimeMs);
    let launch = false;
    if (laughing) {
      const due = !wasLaughing || now - lastLaunchAt >= cfg.intervalMs;
      if (due && active.length < cfg.maxConcurrent) {
        active.push(now);
        lastLaunchAt = now;
        launch = true;
      }
    }
    wasLaughing = laughing;
    return { launch, active: active.length };
  }

  function reset() {
    active = [];
    lastLaunchAt = -Infinity;
    wasLaughing = false;
  }

  return { update, reset };
}

// 祝福之雨的生命周期。雨是状态型效果：微笑时持续生成并逐渐变密，结束后停止生成、快速收住。
// emission：新雨滴的生成量；residual：已有雨滴的可见度；glow：头顶柔光和轮廓光的强度。
// rainbow：头顶局部彩虹的可见度（持续微笑触发，微笑结束后柔和消退）。
// 转入大笑时用更短的时间收雨，让烟花成为主角。
export function createRainEnvelope(cfg) {
  let emission;
  let glow;
  let residual;
  let rainbow;
  let smileTime;
  let lastAt;
  let prevState;

  function reset() {
    emission = 0;
    glow = 0;
    residual = 0;
    rainbow = 0;
    smileTime = 0;
    lastAt = null;
    prevState = 'idle';
  }

  function update(now, state) {
    const dt = lastAt === null ? 0 : Math.max(0, now - lastAt);
    lastAt = now;
    const smiling = state === 'smile';
    const laughing = state === 'laugh';
    const ended = prevState === 'smile' && !smiling && !laughing;
    prevState = state;

    if (smiling) {
      smileTime += dt;
      emission = Math.min(1, Math.max(emission, cfg.startLevel) + dt / cfg.rampMs);
      glow = Math.min(1, glow + dt / cfg.glowInMs);
      residual = Math.min(1, residual + dt / cfg.glowInMs);
      if (smileTime >= (cfg.rainbowDelayMs ?? 600)) {
        rainbow = Math.min(1, rainbow + dt / (cfg.rainbowFadeInMs ?? 800));
      }
    } else {
      emission = Math.max(0, emission - dt / (laughing ? cfg.laughDecayMs : cfg.decayMs));
      residual = Math.max(0, residual - dt / (laughing ? cfg.laughFadeMs : cfg.fadeMs));
      glow = Math.max(0, glow - dt / (laughing ? cfg.laughFadeMs : cfg.afterglowMs));
      const rainbowFade = laughing ? cfg.laughFadeMs : (cfg.rainbowFadeOutMs ?? 1000);
      rainbow = Math.max(0, rainbow - dt / rainbowFade);
      if (emission <= 0 && residual <= 0 && glow <= 0) {
        smileTime = 0;
      }
    }
    return {
      emission,
      glow,
      residual,
      rainbow,
      ended,
      active: emission > 0 || residual > 0 || glow > 0
    };
  }

  reset();
  return { update, reset };
}

// 由人脸关键点外框推算头部椭圆（画布像素）。向上多留一截给头发，粒子按这个椭圆碰撞。
export function headEllipse(box, width, height) {
  return {
    cx: box.cx * width,
    cy: (box.cy - box.height * 0.08) * height,
    rx: box.width * 0.56 * width,
    ry: box.height * 0.61 * height
  };
}

// 人物碰撞体：头部椭圆 + 下方一个宽椭圆代表肩膀和上半身。两种输入模式共用，都由头部椭圆推算。
// 肩膀椭圆的上沿落在下巴附近，宽度约为头宽的 2.4 倍，下半部分通常在画面外。
export function bodyShapes(head) {
  return [
    { part: 'head', cx: head.cx, cy: head.cy, rx: head.rx, ry: head.ry },
    { part: 'shoulders', cx: head.cx, cy: head.cy + head.ry * 2.05, rx: head.rx * 2.4, ry: head.ry * 1.15 }
  ];
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
