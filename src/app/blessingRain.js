// 祝福之雨：头顶柔光微云 + 局部透亮彩虹 + 沿发丝两侧滑落的清透雨水 + 碰触头肩飞溅微粒。
// 贴合“雨虹滤镜下的温柔自拍”视觉效果，雨围绕头部与肩部发生，脸部保持透亮，收尾时彩虹与柔光自然消散。
// 只用 Canvas 2D，雨滴和星光都放在 TypedArray 对象池里，坐标均为画布像素。
import { bodyShapes, hitShape } from '../rules/effects.js';

const TAU = Math.PI * 2;

export function createBlessingRain(cfg) {
  const maxDrops = cfg.maxDrops;
  const dx = new Float32Array(maxDrops);
  const dy = new Float32Array(maxDrops);
  const dvx = new Float32Array(maxDrops);
  const dvy = new Float32Array(maxDrops);
  const dlen = new Float32Array(maxDrops);
  const dwidth = new Float32Array(maxDrops);
  const dtone = new Float32Array(maxDrops);
  const dfar = new Uint8Array(maxDrops);
  const dhue = new Uint8Array(maxDrops);
  let drops = 0;

  const maxSparks = cfg.maxSparkles;
  const sx = new Float32Array(maxSparks);
  const sy = new Float32Array(maxSparks);
  const svx = new Float32Array(maxSparks);
  const svy = new Float32Array(maxSparks);
  const sage = new Float32Array(maxSparks);
  const smax = new Float32Array(maxSparks);
  const ssize = new Float32Array(maxSparks);
  let sparks = 0;

  let carry = 0;
  let afterglow = 0;
  let level = { emission: 0, glow: 0, residual: 0, rainbow: 0 };
  let lastHead = null;
  let lastHeight = 480;

  function removeDrop(i) {
    drops -= 1;
    dx[i] = dx[drops];
    dy[i] = dy[drops];
    dvx[i] = dvx[drops];
    dvy[i] = dvy[drops];
    dlen[i] = dlen[drops];
    dwidth[i] = dwidth[drops];
    dtone[i] = dtone[drops];
    dfar[i] = dfar[drops];
    dhue[i] = dhue[drops];
  }

  function removeSpark(i) {
    sparks -= 1;
    sx[i] = sx[sparks];
    sy[i] = sy[sparks];
    svx[i] = svx[sparks];
    svy[i] = svy[sparks];
    sage[i] = sage[sparks];
    smax[i] = smax[sparks];
    ssize[i] = ssize[sparks];
  }

  function addSpark(x, y, vx, vy, scale, lifeMs) {
    if (sparks >= maxSparks) return;
    sx[sparks] = x;
    sy[sparks] = y;
    svx[sparks] = vx;
    svy[sparks] = vy;
    sage[sparks] = 0;
    smax[sparks] = lifeMs * (0.7 + Math.random() * 0.6);
    ssize[sparks] = scale * (0.6 + Math.random() * 0.8);
    sparks += 1;
  }

  // 雨滴主要在头部上方发射弧生成，沿发丝两侧滑落，并在肩颈附近自然羽化消散
  function spawnDrop(region, height, head) {
    if (drops >= maxDrops) return;
    const unit = region.width;
    let x;
    let y;

    if (head && Math.random() < cfg.aroundHead) {
      // 沿头顶上方发射弧分布：主要偏向左右两侧发丝外延
      const side = Math.random() < 0.5 ? -1 : 1;
      const spreadRatio = 0.25 + Math.random() * (cfg.spread * 0.65);
      x = head.cx + side * head.rx * spreadRatio + (Math.random() - 0.5) * head.rx * 0.2;
      y = head.cy - head.ry * (0.95 + Math.random() * 0.45);
    } else {
      x = region.left + Math.random() * region.width;
      y = -Math.random() * height * 0.15 - 10;
    }

    const far = Math.random() < cfg.farShare;
    const [vmin, vmax] = far ? cfg.farSpeed : cfg.fallSpeed;
    const speed = height * (vmin + Math.random() * (vmax - vmin));

    dx[drops] = x;
    dy[drops] = y;
    dvy[drops] = speed;
    dvx[drops] = speed * cfg.slant * (0.6 + Math.random() * 0.8) + (head ? (x - head.cx) * 0.15 : 0);

    if (far) {
      // 远景柔和细雨丝
      dlen[drops] = unit * (0.022 + Math.random() * 0.028);
      dwidth[drops] = Math.max(0.7, unit * 0.002);
    } else {
      // 近中景清透水滴
      const [rmin, rmax] = cfg.beadRadius;
      dlen[drops] = unit * (rmin + Math.random() * (rmax - rmin));
      dwidth[drops] = 0;
    }

    dfar[drops] = far ? 1 : 0;
    dhue[drops] = Math.floor(Math.random() * 255);
    dtone[drops] = Math.random();
    drops += 1;
  }

  // 碰触头部发丝轮廓化作飞溅小水花
  function burstOnBody(i, shape, head, unit) {
    if (Math.random() > cfg.sparkleChance) return;
    const x = dx[i];
    const y = dy[i] + dlen[i];
    const nx = (x - shape.cx) / (shape.rx * shape.rx);
    const ny = (y - shape.cy) / (shape.ry * shape.ry);
    const n = Math.hypot(nx, ny) || 1;
    const angle = (Math.random() - 0.5) * 1.1;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const ux = nx / n;
    const uy = ny / n;
    const speed = unit * (0.12 + Math.random() * 0.15);
    addSpark(
      x,
      y,
      (ux * c - uy * s) * speed + head.vx * 0.5,
      (ux * s + uy * c) * speed - unit * 0.03 + head.vy * 0.5,
      unit * 0.005,
      cfg.sparkleMs
    );
  }

  // 保护主播五官：中心区域透明度降至极低，绝不遮挡眼睛与嘴唇
  function faceFade(x, y, head) {
    if (!head) return 1;
    const ex = (x - head.cx) / (head.rx * 0.72);
    const ey = (y - (head.cy + head.ry * 0.1)) / (head.ry * 0.75);
    const d = ex * ex + ey * ey;
    if (d < 1) return 0.15 * d; // 脸部中心极透

    // 在肩颈下方自然消散淡出，避免雨水死板掉落满屏
    const collarY = head.cy + head.ry * (cfg.collarFadeDepth ?? 1.6);
    if (y > collarY) {
      const fadeDist = head.ry * 0.6;
      return Math.max(0, 1 - (y - collarY) / fadeDist);
    }
    return 1;
  }

  function update(dtSec, { envelope, head, region, height }) {
    level = envelope;
    lastHeight = height;
    if (head) lastHead = head;
    const unit = region.width;

    if (envelope.ended) {
      afterglow = 1;
      const h = head ?? lastHead;
      if (h) {
        for (let k = 0; k < cfg.afterglowMotes; k += 1) {
          const a = Math.PI + (k / (cfg.afterglowMotes - 1)) * Math.PI;
          addSpark(
            h.cx + Math.cos(a) * h.rx * 1.05,
            h.cy + Math.sin(a) * h.ry * 1.05,
            (Math.random() - 0.5) * unit * 0.02,
            -unit * (0.04 + Math.random() * 0.04),
            unit * 0.006,
            cfg.afterglowMs
          );
        }
      }
    }
    afterglow = Math.max(0, afterglow - (dtSec * 1000) / cfg.afterglowMs);

    if (envelope.residual <= 0 && envelope.emission <= 0) drops = 0;

    carry += cfg.dropsPerSecond * envelope.emission * dtSec;
    while (carry >= 1) {
      spawnDrop(region, height, head);
      carry -= 1;
    }

    const shapes = head ? bodyShapes(head) : [];
    let i = 0;
    while (i < drops) {
      dx[i] += dvx[i] * dtSec;
      dy[i] += dvy[i] * dtSec;
      const shape = head && !dfar[i] ? hitShape(dx[i], dy[i] + dlen[i], shapes) : null;
      if (shape) {
        burstOnBody(i, shape, head, unit);
        removeDrop(i);
        continue;
      }
      if (dy[i] > height + 40) {
        removeDrop(i);
        continue;
      }
      i += 1;
    }

    const dt = dtSec * 1000;
    const gravity = unit * 0.32;
    let j = 0;
    while (j < sparks) {
      sage[j] += dt;
      if (sage[j] >= smax[j]) {
        removeSpark(j);
        continue;
      }
      svx[j] *= 0.95;
      svy[j] = svy[j] * 0.95 + gravity * 0.15 * dtSec;
      sx[j] += svx[j] * dtSec;
      sy[j] += svy[j] * dtSec;
      j += 1;
    }
  }

  // 绘制头顶柔光微云（柔焦暖白微金光晕）
  function drawGlow(ctx, head, unit) {
    const g = level.glow;
    if (g <= 0.01 || !head) return;
    const cy = head.cy - head.ry * 0.92;
    const r = head.rx * 1.95;
    const halo = ctx.createRadialGradient(head.cx, cy, 0, head.cx, cy, r);
    halo.addColorStop(0, `rgba(255, 248, 226, ${0.34 * g})`);
    halo.addColorStop(0.35, `rgba(224, 242, 255, ${0.18 * g})`);
    halo.addColorStop(0.75, `rgba(180, 220, 255, ${0.06 * g})`);
    halo.addColorStop(1, 'rgba(180, 220, 255, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(head.cx - r, cy - r, r * 2, r * 2);
  }

  // 绘制头顶局部柔光彩虹（完全对标参考图：优雅、低饱和、真实光谱、两端渐隐）
  function drawRainbow(ctx, head, unit) {
    const rAlpha = level.rainbow ?? 0;
    if (rAlpha <= 0.01 || !head) return;

    ctx.save();
    const cx = head.cx;
    const cy = head.cy - head.ry * 0.45;
    const rBase = head.rx * 1.16;
    const arcWidth = head.rx * 0.18;

    // 彩虹真实光谱颜色配置（外红内紫，柔和低饱和，符合真实折射）
    const SPECTRUM = [
      { r: 255, g: 156, b: 168 }, // 柔粉红
      { r: 255, g: 198, b: 142 }, // 柔暖橙
      { r: 255, g: 236, b: 156 }, // 鹅黄
      { r: 172, g: 242, b: 192 }, // 嫩绿
      { r: 142, g: 226, b: 255 }, // 天青
      { r: 196, g: 184, b: 255 }  // 浅罗兰紫
    ];

    const numBands = SPECTRUM.length;
    const bandThickness = arcWidth / numBands;

    // 彩虹弧度范围：头顶上方的拱形弧段
    const startAngle = Math.PI * 1.24;
    const endAngle = Math.PI * 1.76;

    for (let k = 0; k < numBands; k += 1) {
      const radius = rBase - k * bandThickness;
      const { r, g, b } = SPECTRUM[k];
      // 两侧边缘更透，中间更实
      const bandAlpha = 0.42 * rAlpha * (0.85 + 0.15 * Math.sin((k / (numBands - 1)) * Math.PI));
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${bandAlpha})`;
      ctx.lineWidth = bandThickness * 1.35;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.stroke();
    }

    // 彩虹上方轻柔发光层，让彩虹通透不干瘪
    ctx.strokeStyle = `rgba(255, 252, 240, ${0.28 * rAlpha})`;
    ctx.lineWidth = arcWidth * 0.55;
    ctx.beginPath();
    ctx.arc(cx, cy, rBase - arcWidth * 0.45, startAngle + 0.05, endAngle - 0.05);
    ctx.stroke();

    ctx.restore();
  }

  function drawAfterglow(ctx, unit) {
    if (afterglow <= 0.01 || !lastHead) return;
    const h = lastHead;
    const a = afterglow * afterglow;
    ctx.strokeStyle = `rgba(255, 242, 218, ${0.46 * a})`;
    ctx.lineWidth = Math.max(1.8, unit * 0.006) * (0.6 + 0.4 * afterglow);
    ctx.beginPath();
    ctx.ellipse(h.cx, h.cy, h.rx * 1.05, h.ry * 1.03, 0, Math.PI * 1.06, Math.PI * 1.94);
    ctx.stroke();
  }

  // 预渲染高清清透水滴贴图（水滴形、通透内腔、顶部光斑反射与柔光拖尾）
  const BEAD_W = 56;
  const BEAD_H = 110;
  const BEAD_CY = 82;
  const BEAD_R = 13;
  let farSprite = null;
  let dropletSprite = null;
  let sparkSprite = null;

  function makeSprites() {
    farSprite = document.createElement('canvas');
    farSprite.width = 8;
    farSprite.height = 96;
    const d = farSprite.getContext('2d');
    const trail = d.createLinearGradient(0, 0, 0, 96);
    trail.addColorStop(0, 'rgba(214, 235, 255, 0)');
    trail.addColorStop(0.7, 'rgba(235, 245, 255, 0.5)');
    trail.addColorStop(1, 'rgba(255, 255, 255, 0.85)');
    d.fillStyle = trail;
    d.fillRect(3, 0, 2, 96);

    dropletSprite = document.createElement('canvas');
    dropletSprite.width = BEAD_W;
    dropletSprite.height = BEAD_H;
    const g = dropletSprite.getContext('2d');
    const cx = BEAD_W / 2;
    const cy = BEAD_CY;

    // 水滴竖向拖尾微光
    const vGlow = g.createLinearGradient(0, 12, 0, cy);
    vGlow.addColorStop(0, 'rgba(196, 230, 255, 0)');
    vGlow.addColorStop(0.65, 'rgba(214, 242, 255, 0.25)');
    vGlow.addColorStop(1, 'rgba(255, 255, 255, 0.6)');
    g.fillStyle = vGlow;
    g.beginPath();
    g.moveTo(cx - 0.75, 12);
    g.lineTo(cx + 0.75, 12);
    g.lineTo(cx + BEAD_R * 0.4, cy - BEAD_R * 0.55);
    g.lineTo(cx - BEAD_R * 0.4, cy - BEAD_R * 0.55);
    g.closePath();
    g.fill();

    // 晶莹微光晕
    const halo = g.createRadialGradient(cx, cy, BEAD_R * 0.4, cx, cy, BEAD_R * 1.8);
    halo.addColorStop(0, 'rgba(225, 245, 255, 0.35)');
    halo.addColorStop(1, 'rgba(225, 245, 255, 0)');
    g.fillStyle = halo;
    g.fillRect(0, cy - BEAD_R * 2, BEAD_W, BEAD_R * 4);

    // 水滴本体：上尖下圆水滴轮廓
    const body = new Path2D();
    body.moveTo(cx, cy - BEAD_R * 1.55);
    body.bezierCurveTo(cx + BEAD_R * 0.52, cy - BEAD_R * 1.0, cx + BEAD_R, cy - BEAD_R * 0.45, cx + BEAD_R, cy);
    body.arc(cx, cy, BEAD_R, 0, Math.PI);
    body.bezierCurveTo(cx - BEAD_R, cy - BEAD_R * 0.45, cx - BEAD_R * 0.52, cy - BEAD_R * 1.0, cx, cy - BEAD_R * 1.55);

    // 晶莹清透渐变填充
    const fill = g.createRadialGradient(cx - BEAD_R * 0.18, cy - BEAD_R * 0.22, 0, cx, cy, BEAD_R * 1.05);
    fill.addColorStop(0, 'rgba(255, 255, 255, 0.2)');
    fill.addColorStop(0.65, 'rgba(215, 240, 255, 0.38)');
    fill.addColorStop(1, 'rgba(175, 225, 255, 0.65)');
    g.fillStyle = fill;
    g.fill(body);

    // 外轮廓高光细边
    g.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    g.lineWidth = 1.2;
    g.stroke(body);

    // 顶部明亮反射光点
    g.fillStyle = 'rgba(255, 255, 255, 0.98)';
    g.beginPath();
    g.ellipse(cx - BEAD_R * 0.32, cy - BEAD_R * 0.38, BEAD_R * 0.24, BEAD_R * 0.14, -0.55, 0, TAU);
    g.fill();
    g.beginPath();
    g.arc(cx + BEAD_R * 0.38, cy + BEAD_R * 0.4, BEAD_R * 0.08, 0, TAU);
    g.fill();

    sparkSprite = document.createElement('canvas');
    sparkSprite.width = 64;
    sparkSprite.height = 64;
    const sg = sparkSprite.getContext('2d');
    const core = sg.createRadialGradient(32, 32, 0, 32, 32, 13);
    core.addColorStop(0, 'rgba(255, 255, 255, 1)');
    core.addColorStop(0.35, 'rgba(242, 248, 255, 0.85)');
    core.addColorStop(1, 'rgba(214, 238, 255, 0)');
    sg.fillStyle = core;
    sg.fillRect(0, 0, 64, 64);
    sg.fillStyle = 'rgba(255, 255, 255, 0.92)';
    for (const [w, h] of [[28, 2.2], [2.2, 28]]) {
      sg.beginPath();
      sg.ellipse(32, 32, w, h, 0, 0, TAU);
      sg.fill();
    }
  }

  function dropAlpha(i, x, y, head) {
    return level.residual * faceFade(x, y, head);
  }

  function drawFarRain(ctx, head) {
    const shapes = head ? bodyShapes(head) : [];
    for (let i = 0; i < drops; i += 1) {
      if (!dfar[i]) continue;
      const len = dlen[i];
      if (head && hitShape(dx[i], dy[i] + len, shapes)) continue;
      const angle = Math.atan2(dvx[i], dvy[i]);
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      ctx.globalAlpha = 0.42 * dropAlpha(i, dx[i], dy[i] + len, head) * (0.6 + 0.4 * dtone[i]);
      ctx.setTransform(c, -s, s, c, dx[i], dy[i]);
      ctx.drawImage(farSprite, -dwidth[i], 0, dwidth[i] * 2, len);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function drawBeads(ctx, head) {
    for (let i = 0; i < drops; i += 1) {
      if (dfar[i]) continue;
      const r = dlen[i];
      const cx = dx[i];
      const cy = dy[i];
      const angle = Math.atan2(dvx[i], dvy[i]);
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const k = r / BEAD_R;
      const alpha = dropAlpha(i, cx, cy, head);
      if (alpha <= 0.005) continue;
      ctx.globalAlpha = alpha * (0.8 + 0.2 * dtone[i]);
      ctx.setTransform(c * k, -s * k, s * k, c * k, cx, cy);
      ctx.drawImage(dropletSprite, -BEAD_W / 2, -BEAD_CY, BEAD_W, BEAD_H);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function drawDrops(ctx, head) {
    if (!drops || level.residual <= 0.01) return;
    drawFarRain(ctx, head);
    drawBeads(ctx, head);
  }

  function drawSparks(ctx) {
    for (let i = 0; i < sparks; i += 1) {
      const t = sage[i] / smax[i];
      ctx.globalAlpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      const size = ssize[i] * 4.2 * (1 - t * 0.35);
      ctx.drawImage(sparkSprite, sx[i] - size, sy[i] - size, size * 2, size * 2);
    }
    ctx.globalAlpha = 1;
  }

  function draw(ctx, { head, unit }) {
    if (!dropletSprite) makeSprites();
    ctx.save();
    // 使用 screen 混合模式实现极佳的光学叠加，彻底消除塑料感与脏边
    ctx.globalCompositeOperation = 'screen';
    drawGlow(ctx, head, unit);
    drawRainbow(ctx, head, unit);
    drawAfterglow(ctx, unit);
    drawDrops(ctx, head);
    drawSparks(ctx);
    ctx.restore();
  }

  function clear() {
    drops = 0;
    sparks = 0;
    carry = 0;
    afterglow = 0;
    lastHead = null;
    level = { emission: 0, glow: 0, residual: 0, rainbow: 0 };
  }

  return {
    update,
    draw,
    clear,
    get dropCount() { return drops; },
    dropsBelow(x0, x1, y) {
      let n = 0;
      for (let i = 0; i < drops; i += 1) if (!dfar[i] && dx[i] >= x0 && dx[i] <= x1 && dy[i] + dlen[i] > y) n += 1;
      return n;
    },
    get sparkleCount() { return sparks; },
    get active() { return drops > 0 || sparks > 0 || afterglow > 0.01 || level.glow > 0.01 || (level.rainbow ?? 0) > 0.01; }
  };
}
