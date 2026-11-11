// 祝福之雨 v3：头部水雾 + 雾里的彩虹 + 从雾里落下的轻雨。只在头部周围发生，脸部保持清楚。
// 画面分三层，从后往前：
//   水雾：罩住头的一团很淡的冷白光，脸的位置挖空；里面飘着几颗水汽光点。它把彩虹、雨和人连在一起，彩虹因此不像贴纸。
//   彩虹：在雾里，贴着头顶从发缝上方往右上延伸，边缘发虚，左端化进雾里。
//   雨：三种形态混合——珠串雨线（一根淡线串 2–4 颗珠子）、单颗雨滴（圆珠和小泪滴、白色和浅青色）、远景小雨丝。
//       刚生成时又小又淡，像还在雾里；每颗有自己的倾斜，过了头顶高度后被人挡开、往两侧弯，不贴着脸竖直往下（那样像汗）。
//       落到头发上溅起微小水珠或闪一颗小星星；落到肩膀上碎成两颗小珠弹开，或顺着肩膀滑一小段。
// 只用 Canvas 2D；雨、水花、光点都放在定长对象池里；所有贴图首次绘制时生成，每帧只贴图（水雾每帧在一张小画布上挖掉脸再贴上去）。坐标都是画布像素。
import { bodyShapes, hitShape, rainZone, rainbowPlacement, shoulderTopAt } from '../rules/effects.js';

const TAU = Math.PI * 2;
const BEAD = 0;
const DROP = 1;
const FINE = 2;
const DOT = 0;
const STAR = 1;
const AFTER = 2;
const SLIDE = 3;

const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createBlessingRain(cfg) {
  const forms = [cfg.forms.bead, cfg.forms.drop, cfg.forms.fine];
  const maxDrops = cfg.maxDrops;
  const dx = new Float32Array(maxDrops);
  const dy = new Float32Array(maxDrops);
  const dvx = new Float32Array(maxDrops);
  const dvy = new Float32Array(maxDrops);
  const dsize = new Float32Array(maxDrops);
  const dline = new Float32Array(maxDrops);
  const dage = new Float32Array(maxDrops);
  const dy0 = new Float32Array(maxDrops);
  const dclear = new Float32Array(maxDrops);
  const dfade0 = new Float32Array(maxDrops);
  const dfade1 = new Float32Array(maxDrops);
  const dband = new Float32Array(maxDrops);
  const dalpha = new Float32Array(maxDrops);
  const dseed = new Float32Array(maxDrops);
  const dform = new Uint8Array(maxDrops);
  const dvariant = new Uint8Array(maxDrops);
  const dcount = new Uint8Array(maxDrops);
  const dcols = [dx, dy, dvx, dvy, dsize, dline, dage, dy0, dclear, dfade0, dfade1, dband, dalpha, dseed, dform, dvariant, dcount];
  let drops = 0;

  const maxSplashes = cfg.maxSplashes;
  const px = new Float32Array(maxSplashes);
  const py = new Float32Array(maxSplashes);
  const pvx = new Float32Array(maxSplashes);
  const pvy = new Float32Array(maxSplashes);
  const pgrav = new Float32Array(maxSplashes);
  const page = new Float32Array(maxSplashes);
  const pmax = new Float32Array(maxSplashes);
  const psize = new Float32Array(maxSplashes);
  const pkind = new Uint8Array(maxSplashes);
  const pteal = new Uint8Array(maxSplashes);
  const pcols = [px, py, pvx, pvy, pgrav, page, pmax, psize, pkind, pteal];
  let splashes = 0;

  // 水汽光点：位置相对雾的中心（单位 rx / ry），这样跟着雾慢慢移动。
  const maxMotes = cfg.maxMotes;
  const mx = new Float32Array(maxMotes);
  const my = new Float32Array(maxMotes);
  const mvx = new Float32Array(maxMotes);
  const mvy = new Float32Array(maxMotes);
  const mage = new Float32Array(maxMotes);
  const mmax = new Float32Array(maxMotes);
  const msize = new Float32Array(maxMotes);
  let motes = 0;

  let carry = 0;
  let gap = 1;
  let clock = 0;
  let level = { emission: 0, rainbow: 0, glow: 0, residual: 0 };
  // detached：换了一个人。旧的人头上的效果原地收尾，不滑到新的人头上；下一次开场时解除。
  let detached = false;
  // presence：人脸还在不在。人脸丢失时，雾和彩虹在 lostFadeMs 内淡出。
  let presence = 0;
  // mistAt / bowAt：雾和彩虹跟随的头部位置，比头部椭圆慢半拍，像空气被带动。
  let mistAt = null;
  let bowAt = null;
  let lastHead = null;
  let bowShown = 0;
  let bowReveal = 0;
  let hairHits = 0;
  let shoulderHits = 0;
  let view = { left: 0, width: 640, top: 0, height: 480 };

  function removeDrop(i) {
    drops -= 1;
    for (const col of dcols) col[i] = col[drops];
  }

  function removeSplash(i) {
    splashes -= 1;
    for (const col of pcols) col[i] = col[splashes];
  }

  function removeMote(i) {
    motes -= 1;
    for (const col of [mx, my, mvx, mvy, mage, mmax, msize]) col[i] = col[motes];
  }

  function addSplash(kind, x, y, vx, vy, gravity, size, lifeMs, teal = 0) {
    if (splashes >= maxSplashes) return;
    px[splashes] = x;
    py[splashes] = y;
    pvx[splashes] = vx;
    pvy[splashes] = vy;
    pgrav[splashes] = gravity;
    page[splashes] = 0;
    pmax[splashes] = lifeMs * rand(0.8, 1.2);
    psize[splashes] = size;
    pkind[splashes] = kind;
    pteal[splashes] = teal;
    splashes += 1;
  }

  function pickForm() {
    const r = Math.random();
    if (r < forms[BEAD].share) return BEAD;
    if (r < forms[BEAD].share + forms[DROP].share) return DROP;
    return FINE;
  }

  // 横向位置（相对头部中线，单位 rx）：centerShare 落在头顶正上方，其余在头外侧，越往外越稀，避开耳朵和脸侧。
  function spawnOffset() {
    if (Math.random() < cfg.centerShare) return (Math.random() + Math.random() - 1) * 0.85;
    const side = Math.random() < 0.5 ? -1 : 1;
    return side * (cfg.sideInner + (cfg.zoneHalfWidth - cfg.sideInner) * Math.random() * Math.random());
  }

  function spawnDrop(zone, head) {
    if (drops >= maxDrops) return;
    const form = pickForm();
    const F = forms[form];
    const offset = spawnOffset();
    const speed = head.ry * rand(F.speed[0], F.speed[1]);
    const tilt = rand(-cfg.slant, cfg.slant);
    const y = rand(zone.y0, zone.y1);
    dx[drops] = head.cx + offset * head.rx;
    dy[drops] = y;
    dvy[drops] = speed * Math.cos(tilt);
    dvx[drops] = speed * Math.sin(tilt);
    dsize[drops] = head.rx * rand(F.size[0], F.size[1]);
    dline[drops] = form === BEAD ? head.ry * rand(cfg.beadLine[0], cfg.beadLine[1]) : form === FINE ? head.ry * rand(0.1, 0.18) : 0;
    dage[drops] = 0;
    dy0[drops] = y;
    dclear[drops] = cfg.clearAfter * head.ry;
    // 淡出线按生成时的头部位置记下，人脸丢失或换人时雨滴也能照常落完。
    // 落在肩膀范围里的雨：淡出线放在肩线以下，通常先碰到肩膀；落在肩膀外侧的雨继续往下，到画面底部附近淡出。
    const x = dx[drops];
    const shoulderTop = shoulderTopAt(bodyShapes(head)[1], x);
    dband[drops] = rand(-cfg.shoulderBand, cfg.shoulderBand) * head.ry;
    if (shoulderTop !== null) {
      dfade0[drops] = shoulderTop + cfg.shoulderFade[0] * head.ry;
      dfade1[drops] = shoulderTop + cfg.shoulderFade[1] * head.ry;
    } else {
      dfade0[drops] = head.cy + cfg.outerFadeFrom * head.ry;
      dfade1[drops] = Math.max(dfade0[drops] + head.ry * 0.4, view.top + view.height);
    }
    // 生成区外沿的雨更淡，看不出生成区的边界。
    const edge = 1 - 0.65 * smooth(0.7, 1, Math.abs(offset) / cfg.zoneHalfWidth);
    dalpha[drops] = F.alpha * edge * rand(0.8, 1);
    dseed[drops] = Math.random();
    dform[drops] = form;
    // variant：第 0 位是否浅青色，第 1 位是否泪滴形（单颗雨滴才用）。
    dvariant[drops] = (Math.random() < cfg.tealShare ? 1 : 0) | (Math.random() < cfg.teardropShare ? 2 : 0);
    dcount[drops] = form === BEAD ? 2 + Math.floor(Math.random() * 3) : 1;
    drops += 1;
  }

  // 落到头发上：溅起 2–3 颗微小水珠（沿头部轮廓往外、往上弹），或闪一颗小星星，其余被吸收。
  // 落到肩膀上：碎成 2 颗小珠往两边弹开，或顺着肩膀斜面滑一小段再淡出，其余被吸收。
  // 头部速度传给水花：晃头时水花跟着甩出去。
  function hitBody(i, shape, head, hitY) {
    const x = dx[i];
    const y = hitY;
    const teal = dvariant[i] & 1;
    const nx = (x - shape.cx) / (shape.rx * shape.rx);
    const ny = (y - shape.cy) / (shape.ry * shape.ry);
    const n = Math.hypot(nx, ny) || 1;
    const ux = nx / n;
    const uy = ny / n;
    const hvx = (head.vx ?? 0) * 0.5;
    const hvy = (head.vy ?? 0) * 0.5;
    const u = head.rx;
    const r = Math.random();
    if (shape.part === 'head') {
      hairHits += 1;
      if (r < cfg.hairSplash) {
        const count = 2 + (Math.random() < 0.5 ? 1 : 0);
        for (let k = 0; k < count; k += 1) {
          const a = rand(-0.8, 0.8);
          const c = Math.cos(a);
          const s = Math.sin(a);
          const speed = u * rand(1.0, 1.6);
          addSplash(DOT, x, y, (ux * c - uy * s) * speed + hvx, (ux * s + uy * c) * speed - u * 0.7 + hvy,
            u * 5, u * rand(0.012, 0.018), cfg.splashMs, teal);
        }
      } else if (r < cfg.hairSplash + cfg.hairStar) {
        addSplash(STAR, x, y, hvx * 0.3, -u * 0.15 + hvy * 0.3, 0, u * rand(0.045, 0.06), cfg.starMs, 0);
      }
      return;
    }
    shoulderHits += 1;
    // 肩膀斜面的切线方向：朝远离身体中线的一侧、往下。
    const side = x < shape.cx ? -1 : 1;
    let tx = -uy;
    let ty = ux;
    if (tx * side < 0) {
      tx = -tx;
      ty = -ty;
    }
    if (r < cfg.shoulderBreak) {
      for (const dir of [-1, 1]) {
        const speed = u * rand(0.7, 1.1);
        addSplash(DOT, x, y, tx * dir * speed + hvx, ty * dir * speed - u * 0.9 + hvy,
          u * 5, u * rand(0.013, 0.019), cfg.splashMs, teal);
      }
    } else if (r < cfg.shoulderBreak + cfg.shoulderSlide) {
      // 顺着肩线往外滑约 slideDistance 个 rx，再淡出。
      const speed = (cfg.slideDistance * u) / (cfg.slideMs / 1000);
      addSplash(SLIDE, x, y, tx * speed + hvx * 0.3, Math.max(0, ty) * speed + u * 0.08, 0, Math.max(dsize[i], u * 0.02), cfg.slideMs, teal);
    }
  }

  // 收尾时沿头顶轮廓升起几颗淡淡的余光。
  function addAfterglow(head) {
    const n = cfg.afterglowMotes;
    for (let k = 0; k < n; k += 1) {
      const a = Math.PI * (1.32 + (0.36 * k) / Math.max(1, n - 1)) + rand(-0.06, 0.06);
      addSplash(AFTER, head.cx + Math.cos(a) * head.rx, head.cy + Math.sin(a) * head.ry,
        rand(-0.04, 0.04) * head.ry, -head.ry * rand(0.12, 0.18), 0, head.rx * rand(0.05, 0.07), cfg.afterglowMs, 0);
    }
  }

  // 脸的范围（眉毛到下巴、两颊之间）。返回点在脸椭圆里的“距离”：< 1 在脸里。
  function faceDistance(x, y, head) {
    const ex = (x - head.cx) / (head.rx * 0.74);
    const ey = (y - (head.cy + head.ry * 0.2)) / (head.ry * 0.72);
    return Math.sqrt(ex * ex + ey * ey);
  }

  // 脸里不画雨，外面一圈渐变过渡，没有硬边。
  function faceFade(x, y, head) {
    if (!head) return 1;
    return smooth(1, 1 + cfg.faceBand / 0.74, faceDistance(x, y, head));
  }

  // 每颗雨的可见度：刚生成时在雾里（淡），落出 clearAfter 后完全清楚；到肩膀附近淡出。
  function emerge(i) {
    return smooth(0, dclear[i], dy[i] - dy0[i]);
  }

  function dropFade(i) {
    return (0.25 + 0.75 * emerge(i)) * (1 - smooth(dfade0[i], dfade1[i], dy[i]));
  }

  function follow(target, head, dtMs, ms) {
    if (!target) return { cx: head.cx, cy: head.cy, rx: head.rx, ry: head.ry };
    const a = dtMs <= 0 ? 1 : 1 - Math.exp(-dtMs / ms);
    target.cx += a * (head.cx - target.cx);
    target.cy += a * (head.cy - target.cy);
    target.rx += a * (head.rx - target.rx);
    target.ry += a * (head.ry - target.ry);
    return target;
  }

  // 水汽光点：在雾的范围内、脸外面随机出现，很慢地往上飘，2–3 秒后消失。
  function spawnMote() {
    if (motes >= maxMotes) return;
    for (let tries = 0; tries < 6; tries += 1) {
      const a = Math.random() * TAU;
      const d = Math.sqrt(Math.random()) * 0.85;
      const x = Math.cos(a) * d * cfg.mist.width;
      const y = Math.sin(a) * d * cfg.mist.height - cfg.mist.lift;
      // 相对头部中心的位置（单位 rx / ry）；落在脸附近就换个位置。
      const fx = x / 0.74;
      const fy = (y - 0.2) / 0.72;
      if (fx * fx + fy * fy < 1.6) continue;
      mx[motes] = x;
      my[motes] = y;
      mvx[motes] = rand(-0.04, 0.04);
      mvy[motes] = -rand(0.03, 0.08);
      mage[motes] = 0;
      mmax[motes] = rand(2, 3);
      msize[motes] = rand(0.012, 0.022);
      motes += 1;
      return;
    }
  }

  // envelope 来自 rules/effects.js 的 createRainEnvelope；head 是当前头部椭圆（可能为 null）；
  // view 是画布上实际可见的区域 { left, width, top, height }，生成区、雾和彩虹都限制在里面。
  function update(dtSec, { envelope, head, view: nextView }) {
    const dtMs = dtSec * 1000;
    clock += dtSec;
    level = envelope;
    if (nextView) view = nextView;
    if (envelope.started) {
      detached = false;
      mistAt = null;
      bowAt = null;
      bowReveal = 0;
    }
    const tracking = head && !detached ? head : null;
    if (tracking) lastHead = tracking;

    presence = tracking ? Math.min(1, presence + dtMs / 200) : Math.max(0, presence - dtMs / cfg.lostFadeMs);
    if (tracking) {
      mistAt = follow(mistAt, tracking, dtMs, cfg.mist.followMs);
      bowAt = follow(bowAt, tracking, dtMs, cfg.rainbow.followMs);
    }
    if (envelope.ended && bowAt && presence > 0) addAfterglow(bowAt);

    // 彩虹出现时从左往右显出来；淡出时整条一起变淡。
    const bow = envelope.rainbow * presence;
    if (bow > bowShown) bowReveal = Math.max(bowReveal, bow);
    bowShown = bow;

    if (envelope.phase === 'idle' && envelope.residual <= 0) {
      drops = 0;
      carry = 0;
    }

    // 只在找得到这个人时生成新雨；人脸丢失或换人时不再生成，已有的雨自然落完。
    if (tracking && envelope.emission > 0) {
      carry += cfg.dropsPerSecond * envelope.emission * dtSec;
      if (carry >= gap) {
        const zone = rainZone(tracking, cfg, view);
        while (carry >= gap) {
          carry -= gap;
          gap = rand(1 - cfg.spawnJitter, 1 + cfg.spawnJitter);
          spawnDrop(zone, tracking);
        }
      }
    } else {
      carry = 0;
    }

    // 水汽光点：雾足够浓时，每秒约 4 颗。
    if (tracking && envelope.glow > 0.4 && Math.random() < 4 * dtSec) spawnMote();
    let m = 0;
    while (m < motes) {
      mage[m] += dtSec;
      if (mage[m] >= mmax[m]) {
        removeMote(m);
        continue;
      }
      mx[m] += mvx[m] * dtSec;
      my[m] += mvy[m] * dtSec;
      m += 1;
    }

    const shapes = head ? bodyShapes(head) : null;
    const bottom = view.top + view.height + 20;
    let i = 0;
    while (i < drops) {
      dage[i] += dtSec;
      dx[i] += dvx[i] * dtSec;
      dy[i] += dvy[i] * dtSec;
      if (dy[i] >= dfade1[i] || dy[i] > bottom) {
        removeDrop(i);
        continue;
      }
      // 远景小雨丝在人物身后，不碰撞。
      // 头部按椭圆判定；肩膀按“肩线 + 判定带”判定：落点在估算肩线上下 ±shoulderBand 之间随机，估算偏一点也像落在肩上。
      if (shapes && dform[i] !== FINE) {
        const bottomY = dy[i] + dsize[i];
        if (hitShape(dx[i], bottomY, [shapes[0]])) {
          hitBody(i, shapes[0], head, bottomY);
          removeDrop(i);
          continue;
        }
        const top = shoulderTopAt(shapes[1], dx[i]);
        if (top !== null && bottomY >= top + dband[i]) {
          hitBody(i, shapes[1], head, top + dband[i]);
          removeDrop(i);
          continue;
        }
      }
      i += 1;
    }

    let j = 0;
    while (j < splashes) {
      page[j] += dtMs;
      if (page[j] >= pmax[j]) {
        removeSplash(j);
        continue;
      }
      if (pkind[j] !== SLIDE) {
        const damp = pkind[j] === DOT ? 0.98 : 0.95;
        pvx[j] *= damp;
        pvy[j] = pvy[j] * damp + pgrav[j] * dtSec;
      }
      px[j] += pvx[j] * dtSec;
      py[j] += pvy[j] * dtSec;
      j += 1;
    }
  }

  // ---------- 贴图：首次绘制时生成，之后每帧只贴图 ----------
  const WHITE = [244, 250, 255];
  const TEAL = [176, 236, 244];
  // 水雾颜色：偏冷的白。
  const MIST = [226, 238, 250];
  const MIST_PX = 96;
  // 彩虹贴图按小尺寸画，绘制时放大，放大本身带来柔和的模糊；不依赖 canvas filter（部分 Safari 不支持）。
  const BOW_R = 18;
  // 色带在贴图里的宽度按典型头型（ry ≈ 1.25 rx）估算的“色带 ÷ 半径”比例取。
  const BOW_TYPICAL = rainbowPlacement({ cx: 0, cy: 0, rx: 1, ry: 1.25 }, cfg.rainbow, { left: -100, width: 200, top: -100, height: 200 });
  const BOW_BAND = Math.max(3, Math.round((BOW_R * BOW_TYPICAL.band) / BOW_TYPICAL.r));
  const BOW_HALF = (cfg.rainbow.spanDeg * Math.PI) / 360;
  const BOW_PAD = 12;
  const BOW_SIZE = 2 * (BOW_R + BOW_BAND + BOW_PAD);
  // 连续光谱，外红内紫，饱和度比纯色低约 20%。
  const SPECTRUM = [
    [0, 'rgba(190, 168, 250, 0)'],
    [0.14, 'rgba(190, 168, 250, 0.7)'],
    [0.32, 'rgba(150, 200, 248, 0.85)'],
    [0.48, 'rgba(164, 228, 186, 0.85)'],
    [0.62, 'rgba(248, 232, 158, 0.9)'],
    [0.78, 'rgba(250, 190, 146, 0.85)'],
    [0.9, 'rgba(246, 150, 158, 0.7)'],
    [1, 'rgba(246, 150, 158, 0)']
  ];

  let sprites = null;
  let mistLayer = null;

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function radial(size, stops, sx = 1, sy = 1) {
    const c = canvas(Math.round(size * sx), Math.round(size * sy));
    const g = c.getContext('2d');
    g.scale(sx, sy);
    const h = size / 2;
    const grad = g.createRadialGradient(h, h, 0, h, h, h);
    stops.forEach(([at, color]) => grad.addColorStop(at, color));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return c;
  }

  const rgba = (c, a) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

  // 一颗珠子：亮芯 + 一小圈柔光。
  function bead(color) {
    return radial(32, [[0, 'rgba(255, 255, 255, 1)'], [0.22, rgba(color, 0.95)], [0.34, rgba(color, 0.4)], [0.6, rgba(color, 0.1)], [1, rgba(color, 0)]]);
  }

  // 小泪滴：下圆上尖，带一点柔光。贴图里珠子中心在 (16, 40)。
  function teardrop(color) {
    const c = canvas(32, 52);
    const g = c.getContext('2d');
    const glow = g.createRadialGradient(16, 38, 0, 16, 38, 14);
    glow.addColorStop(0, rgba(color, 0.35));
    glow.addColorStop(1, rgba(color, 0));
    g.fillStyle = glow;
    g.fillRect(0, 20, 32, 32);
    const body = g.createLinearGradient(0, 12, 0, 46);
    body.addColorStop(0, rgba(color, 0));
    body.addColorStop(0.55, rgba(color, 0.7));
    body.addColorStop(1, 'rgba(255, 255, 255, 1)');
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(16, 12);
    g.bezierCurveTo(18, 24, 21, 32, 21, 37);
    g.arc(16, 40, 5, 0, Math.PI);
    g.bezierCurveTo(11, 32, 14, 24, 16, 12);
    g.fill();
    return c;
  }

  // 细线：上端透明、下端略亮，用于珠串雨线和远景小雨丝。
  function line() {
    const c = canvas(4, 64);
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, rgba(WHITE, 0));
    grad.addColorStop(1, rgba(WHITE, 0.9));
    g.fillStyle = grad;
    g.fillRect(1.25, 0, 1.5, 64);
    return c;
  }

  // 彩虹弧在贴图里的不透明度：左端慢慢化进雾里，右端稍实一些再淡出。
  function bowEnds(t) {
    return smooth(0, 0.5, t) * (1 - smooth(0.8, 1, t));
  }

  function makeRainbow() {
    const c = canvas(BOW_SIZE, BOW_SIZE);
    const g = c.getContext('2d');
    const o = BOW_SIZE / 2;
    // 贴图里弧顶朝上，左端（t = 0）在左；绘制时再旋转到实际方向。
    const a0 = -Math.PI / 2 - BOW_HALF;
    const a1 = -Math.PI / 2 + BOW_HALF;
    const steps = 40;
    const span = (a1 - a0) / steps;
    // 弧周围的光晕：和水雾同色，让彩虹“浮在雾里”。
    const haze = g.createRadialGradient(o, o, BOW_R - BOW_BAND * 1.8, o, o, BOW_R + BOW_BAND * 1.8);
    haze.addColorStop(0, rgba(MIST, 0));
    haze.addColorStop(0.5, rgba(MIST, 0.4));
    haze.addColorStop(1, rgba(MIST, 0));
    const bands = g.createRadialGradient(o, o, BOW_R - BOW_BAND / 2, o, o, BOW_R + BOW_BAND / 2);
    SPECTRUM.forEach(([at, color]) => bands.addColorStop(at, color));
    for (const [style, reach] of [[haze, BOW_BAND * 1.8], [bands, BOW_BAND / 2]]) {
      g.fillStyle = style;
      for (let s = 0; s < steps; s += 1) {
        g.globalAlpha = bowEnds((s + 0.5) / steps);
        g.beginPath();
        g.arc(o, o, BOW_R + reach, a0 + s * span, a0 + (s + 1) * span + 0.004);
        g.arc(o, o, Math.max(0, BOW_R - reach), a0 + (s + 1) * span + 0.004, a0 + s * span, true);
        g.closePath();
        g.fill();
      }
    }
    g.globalAlpha = 1;
    return c;
  }

  function makeSprites() {
    const star = radial(64, [[0, 'rgba(255, 255, 255, 1)'], [0.18, 'rgba(255, 248, 230, 0.6)'], [1, 'rgba(255, 240, 214, 0)']]);
    const s = star.getContext('2d');
    s.fillStyle = 'rgba(255, 252, 240, 0.85)';
    for (const [w, h] of [[26, 1.5], [1.5, 26]]) {
      s.beginPath();
      s.ellipse(32, 32, w, h, 0, 0, TAU);
      s.fill();
    }
    sprites = {
      bead: [bead(WHITE), bead(TEAL)],
      tear: [teardrop(WHITE), teardrop(TEAL)],
      line: line(),
      star,
      after: radial(48, [[0, 'rgba(255, 248, 228, 0.8)'], [0.4, 'rgba(255, 236, 200, 0.3)'], [1, 'rgba(255, 236, 200, 0)']]),
      mote: radial(32, [[0, rgba(MIST, 0.9)], [0.4, rgba(MIST, 0.3)], [1, rgba(MIST, 0)]]),
      // 水雾：竖向椭圆，最亮处偏上，往下、往外逐渐消失，看不到边界。
      mist: (() => {
        const c = canvas(MIST_PX, MIST_PX);
        const g = c.getContext('2d');
        const grad = g.createRadialGradient(MIST_PX / 2, MIST_PX * 0.42, 0, MIST_PX / 2, MIST_PX / 2, MIST_PX / 2);
        grad.addColorStop(0, rgba(MIST, 1));
        grad.addColorStop(0.35, rgba(MIST, 0.6));
        grad.addColorStop(0.7, rgba(MIST, 0.18));
        grad.addColorStop(1, rgba(MIST, 0));
        g.fillStyle = grad;
        g.fillRect(0, 0, MIST_PX, MIST_PX);
        return c;
      })(),
      // 用来把脸从雾里擦掉的柔边椭圆。
      faceMask: radial(64, [[0, 'rgba(0, 0, 0, 1)'], [0.62, 'rgba(0, 0, 0, 1)'], [1, 'rgba(0, 0, 0, 0)']]),
      bow: makeRainbow()
    };
    mistLayer = canvas(MIST_PX, MIST_PX);
  }

  // ---------- 绘制 ----------

  // 水雾：在一张小画布上画好雾、把脸擦掉，再放大贴到画面上，滤色叠加。脸部因此保持干净，头发也不会被冲成灰色。
  function drawMist(ctx, a) {
    const g = level.glow * presence;
    if (g <= 0.01 || !a) return;
    const m = cfg.mist;
    const w = m.width * a.rx;
    const h = m.height * a.ry;
    const cx = a.cx;
    const cy = a.cy - m.lift * a.ry;
    const lg = mistLayer.getContext('2d');
    lg.globalCompositeOperation = 'copy';
    lg.drawImage(sprites.mist, 0, 0, MIST_PX, MIST_PX);
    lg.globalCompositeOperation = 'destination-out';
    const fx = ((a.cx - (cx - w)) / (2 * w)) * MIST_PX;
    const fy = ((a.cy + a.ry * 0.2 - (cy - h)) / (2 * h)) * MIST_PX;
    const fw = ((a.rx * 0.74 * 1.55) / (2 * w)) * MIST_PX;
    const fh = ((a.ry * 0.72 * 1.55) / (2 * h)) * MIST_PX;
    lg.drawImage(sprites.faceMask, fx - fw, fy - fh, fw * 2, fh * 2);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = m.alpha * g;
    ctx.drawImage(mistLayer, cx - w, cy - h, w * 2, h * 2);

    // 水汽光点：很小、很慢地飘，淡入淡出。
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < motes; i += 1) {
      const t = mage[i] / mmax[i];
      ctx.globalAlpha = 0.5 * g * Math.sin(Math.PI * t);
      const r = msize[i] * a.rx * 3;
      ctx.drawImage(sprites.mote, a.cx + mx[i] * a.rx - r, a.cy + my[i] * a.ry - r, r * 2, r * 2);
    }
  }

  // 彩虹：在雾里，滤色叠加像光；再叠一层很淡的普通叠加，亮背景下颜色不会消失。
  // 出现时按 bowReveal 从左往右裁出一段，裁切处补一窄条半透明，避免硬边。
  function drawRainbow(ctx, a) {
    const k = bowShown;
    if (k <= 0.01 || !a) return;
    const bow = cfg.rainbow;
    // 画布在页面上是镜像显示的（前置摄像头习惯）。彩虹按“屏幕上看到的样子”设计：
    // 端点的横向位置取反后再定位，贴图也镜像一次，屏幕上就是：左端在发缝上方，右端落在右侧太阳穴上方，从左往右显出来。
    const p = rainbowPlacement(a, { ...bow, left: [-bow.left[0], bow.left[1]], right: [-bow.right[0], bow.right[1]] }, view);
    const scale = p.r / BOW_R;
    const breath = 1 + bow.breath * Math.sin((clock / 3.2) * TAU);
    const o = BOW_SIZE / 2;
    const x0 = o + Math.cos(-Math.PI / 2 - BOW_HALF) * (BOW_R + BOW_BAND) - 2;
    const x1 = o + Math.cos(-Math.PI / 2 + BOW_HALF) * (BOW_R + BOW_BAND) + 2;
    const cut = Math.min(BOW_SIZE, x0 + (x1 - x0) * Math.min(1, bowReveal * 1.15));
    const strips = [[0, cut, 1], [cut, Math.min(BOW_SIZE, cut + 3), 0.45]];
    // 以圆心为原点：先镜像，再把“弧顶朝上”旋转到实际的弧顶方向。
    const rot = p.tilt + Math.PI / 2;
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    ctx.setTransform(-cr * scale, -sr * scale, -sr * scale, cr * scale, p.cx, p.cy);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    for (const [mode, alpha] of [['screen', bow.screenAlpha], ['source-over', bow.solidAlpha]]) {
      ctx.globalCompositeOperation = mode;
      for (const [sx, ex, w] of strips) {
        if (ex <= sx) continue;
        ctx.globalAlpha = Math.min(1, alpha * k * breath * w);
        ctx.drawImage(sprites.bow, sx, 0, ex - sx, BOW_SIZE, sx - o, -o, ex - sx, BOW_SIZE);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function drawDrops(ctx, head, shapes) {
    for (let i = 0; i < drops; i += 1) {
      const form = dform[i];
      // 远景小雨丝在人物身后：落到人物范围内就不画。
      if (form === FINE && shapes && hitShape(dx[i], dy[i], shapes)) continue;
      const alpha = level.residual * dalpha[i] * dropFade(i) * faceFade(dx[i], dy[i], head);
      if (alpha <= 0.01) continue;
      const speed = Math.hypot(dvx[i], dvy[i]) || 1;
      const c = dvy[i] / speed;
      const s = dvx[i] / speed;
      const grow = 0.6 + 0.4 * emerge(i);
      const size = dsize[i] * grow;
      const teal = dvariant[i] & 1;
      ctx.setTransform(c, -s, s, c, dx[i], dy[i]);
      if (form === FINE) {
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprites.line, -1, -dline[i], 2, dline[i]);
      } else if (form === BEAD) {
        // 珠串雨线：线很淡，主角是珠子；最下面那颗最大，往上越来越小、间距不均匀。
        const len = dline[i] * grow;
        ctx.globalAlpha = alpha * 0.32;
        ctx.drawImage(sprites.line, -1, -len, 2, len);
        const n = dcount[i];
        const seed = dseed[i];
        for (let k = 0; k < n; k += 1) {
          const along = k === 0 ? 0 : len * ((k + 0.35 * Math.sin(seed * 17 + k * 3.1)) / n);
          const r = size * (1 - k * 0.2) * 2;
          ctx.globalAlpha = alpha * (1 - k * 0.15);
          ctx.drawImage(sprites.bead[(teal + k) % 2], -r, -along - r, r * 2, r * 2);
        }
      } else {
        ctx.globalAlpha = alpha;
        if (dvariant[i] & 2) {
          // 泪滴贴图里珠子中心在 (16, 40)，半径 5。
          const k = size / 5;
          ctx.drawImage(sprites.tear[teal], -16 * k, -40 * k, 32 * k, 52 * k);
        } else {
          const r = size * 2;
          ctx.drawImage(sprites.bead[teal], -r, -r, r * 2, r * 2);
        }
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function drawSplashes(ctx, head) {
    for (let i = 0; i < splashes; i += 1) {
      const t = page[i] / pmax[i];
      const kind = pkind[i];
      const fade = (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85) * faceFade(px[i], py[i], head);
      if (fade <= 0.01) continue;
      let sprite;
      let size = psize[i];
      if (kind === STAR) {
        // 星星闪一下：先放大再收小。
        sprite = sprites.star;
        size *= 1.4 * (0.6 + 0.6 * Math.sin(Math.min(1, t * 1.4) * Math.PI));
      } else if (kind === AFTER) {
        sprite = sprites.after;
        size *= 2.2 * (1 - t * 0.3);
      } else {
        sprite = sprites.bead[pteal[i]];
        size *= 2 * (1 - t * 0.35);
      }
      ctx.globalAlpha = fade * (kind === AFTER ? 0.55 : kind === SLIDE ? 0.95 : 0.9);
      ctx.drawImage(sprite, px[i] - size, py[i] - size, size * 2, size * 2);
    }
  }

  function draw(ctx, { head } = {}) {
    if (!sprites) makeSprites();
    const tracked = head && !detached ? head : null;
    const shapes = head ? bodyShapes(head) : null;
    ctx.save();
    drawMist(ctx, mistAt);
    drawRainbow(ctx, bowAt);
    // 雨用“变亮”叠加：暗背景上像发光的水，亮背景上也不会出现灰色色块。雨画在彩虹前面。
    ctx.globalCompositeOperation = 'lighter';
    if (drops && level.residual > 0.01) drawDrops(ctx, tracked, shapes);
    drawSplashes(ctx, tracked);
    ctx.restore();
  }

  // 换了一个人：旧的人头上的雨、雾、彩虹原地收尾，下一次开场时才在新的人头上展开。
  function detach() {
    detached = true;
  }

  function clear() {
    drops = 0;
    splashes = 0;
    motes = 0;
    carry = 0;
    presence = 0;
    detached = false;
    mistAt = null;
    bowAt = null;
    lastHead = null;
    bowShown = 0;
    bowReveal = 0;
    hairHits = 0;
    shoulderHits = 0;
    level = { emission: 0, rainbow: 0, glow: 0, residual: 0 };
  }

  return {
    update,
    draw,
    clear,
    detach,
    get dropCount() { return drops; },
    get splashCount() { return splashes; },
    get sparkleCount() { return splashes; },
    get moteCount() { return motes; },
    // 测试用：落到头发上、肩膀上的雨累计数量。
    get hairHits() { return hairHits; },
    get shoulderHits() { return shoulderHits; },
    // 测试用：x 在 [x0, x1] 之间、珠子低于 y 的雨（远景小雨丝不计入）。
    dropsBelow(x0, x1, y) {
      let n = 0;
      for (let i = 0; i < drops; i += 1) if (dform[i] !== FINE && dx[i] >= x0 && dx[i] <= x1 && dy[i] + dsize[i] > y) n += 1;
      return n;
    },
    // 测试用：所有雨的横向范围和最高、最低位置。
    dropBounds() {
      if (!drops) return null;
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < drops; i += 1) {
        x0 = Math.min(x0, dx[i]);
        x1 = Math.max(x1, dx[i]);
        y0 = Math.min(y0, dy[i]);
        y1 = Math.max(y1, dy[i]);
      }
      return { x0, x1, y0, y1 };
    },
    // 测试用：每颗雨的形态（0 珠串、1 单颗、2 远景）、横向速度和下落速度。
    snapshot() {
      return Array.from({ length: drops }, (_, i) => ({ form: dform[i], x: dx[i], y: dy[i], vx: dvx[i], vy: dvy[i], count: dcount[i] }));
    },
    faceFadeAt: faceFade,
    get rainbowVisible() { return bowShown; },
    get mistVisible() { return level.glow * presence; },
    get anchor() { return bowAt; },
    get active() { return drops > 0 || splashes > 0 || bowShown > 0.01 || level.glow * presence > 0.01; }
  };
}
