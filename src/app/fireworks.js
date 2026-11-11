// 大笑烟花。以人脸为中心，一“轮”在脸的四周不同方向各放一颗（完整一轮 1 朵大花 + 2 朵中花，轻量一轮 2 朵中花，
// 位置由 rules/effects.js 的 planVolley 算好传进来）。每一颗约 2.4 秒，过程是（时间从这一颗发射算起）：
//   发射    0–0.4 秒：一颗亮点从脸部轮廓外侧往外飞到绽放点，路径略弯，拖一段淡烟带；不从脸前经过。
//   辅助烟花 0.1–0.5 秒：从脸部轮廓向四周放射的细线，头亮尾虚、长短不一；结局 60% 散成碎粒往下飘、25% 原地渐隐、15% 炸开一朵小花。
//   到顶    0.4 秒：缩成一个亮点，停顿 0.08 秒。
//   绽放闪光 0.48 秒：花心一团亮光 0.1 秒内扩大再消失。
//   主花    0.48 秒起：光粒高速炸开、拉成长条，很快急刹，变短变圆后慢慢飘落；这一轮的主词在第一颗花外侧（远离脸的一边）弹出。
//   二次绽放：大花 3 颗、中花 1 颗光粒飞到约 30% 寿命时再炸开一圈小花并射出几条白色细亮线；大花还会带出 1–2 个碎词。
//   消散    ：寿命后段快速闪烁、缩小、下落、淡出；颜色从饱和色变白，再变成暗淡的冷色（火药燃尽）；
//            同一朵花的光粒有早有晚地熄灭，早熄灭的会在原处留下一点很淡的余烬。
//   碰撞    ：落到头上的光粒和单词沿头部轮廓弹开，头部速度传给它们；碰到的瞬间亮一下。
// 所有位置/速度用画布像素和秒；只有 update 推进时钟，固定步长 1/120 秒，帧率不同结果一致。
// 光粒放在定长对象池里，单词另有一个小池；所有贴图（含单词）首次绘制时生成，之后每帧只贴图。
// 追光遮罩和碰撞用同一套头部、肩膀椭圆，保证压暗区和雨、烟花的碰撞体完全一致。
import { advanceParticle, bodyShapes, finite, limitVelocity, positive, safeHead } from './fireworkPhysics.js';

export { stepFireworkParticle } from './fireworkPhysics.js';

const TAU = Math.PI * 2;
const STEP = 1 / 120;
const EPS = 1e-9;
// 主花三种颜色，每颗随机一种；辅助烟花、碎粒、碎词用金白色（3）；二次绽放的细亮线用白色（4）。
const PALETTE = ['255, 204, 120', '255, 128, 176', '128, 228, 240', '255, 238, 204', '255, 255, 255'];
// 燃尽时的冷色：每种颜色各自对应一种暗淡的冷色。
const COOL = ['226, 140, 96', '176, 104, 190', '104, 150, 226', '214, 160, 120', '190, 206, 240'];
const GOLD = 3;
const WHITE = 4;

const PETAL = 0;
const CRACKLE = 1;
const STREAK = 2;
const EMBER = 3;
const POP = 4;
const SPARK = 5;
const CONTACT = 6;
const GLINT = 7;
const ASH = 8;

// 每种光粒的阻尼、重力（几个 unit/秒²）、能否碰头。主花阻尼大：炸开后很快急刹，再慢慢飘。
// 主花阻尼 8：0.1 秒内速度降到约 45%，滑行距离 = 初速 / 阻尼 ≈ 花的半径；之后以约 0.06 unit/秒的速度飘落。
const PHYSICS = [
  { drag: 8, gravity: 0.5, collide: true },
  { drag: 2.8, gravity: 0.25, collide: true },
  { drag: 1.3, gravity: 0.25, collide: false },
  { drag: 2.0, gravity: 0.35, collide: true },
  { drag: 2.4, gravity: 0.2, collide: true },
  { drag: 2.4, gravity: 0.23, collide: true },
  { drag: 0, gravity: 0, collide: false },
  { drag: 4.0, gravity: 0.05, collide: false },
  { drag: 3.0, gravity: 0.05, collide: false }
];

const FATE_SCATTER = 0;
const FATE_FADE = 1;
const FATE_POP = 2;

export const FIREWORK_LIMITS = Object.freeze({
  shells: 9,
  particles: 760,
  petals: 72,
  midPetals: 42,
  smallPetals: 24,
  secondaries: 3,
  cracklesPer: 10,
  glintsPer: 4,
  streaks: 8,
  embersPer: 5,
  popsPer: 12,
  words: 8,
  fragmentsPerBurst: 8,
  contactsPerBurst: 6,
  trailPoints: 10
});

// 发射慢一点，让人看清拖尾（原来 0.4 秒太快）。
// 从背后射出时要慢，让人看清长拖尾（0.4 → 1.1 秒）。
const ASCENT = 1.1;
const PAUSE = 0.08;
const BLOOM = ASCENT + PAUSE;
// 单词的四段：小字渐显 → 平滑放大 → 停留冒火星 → 原地从字形散成火星。
// 起点 0.55 而不是 0.5：0.5 倍时最大词高约 48px，正好卡在可读线，停一下会看不清。
const WORD_GROW_FROM = 0.55;
const WORD_ENTRY = 0.24;
const WORD_GROW_START = 0.12;
const WORD_GROW_END = 0.62;
const WORD_DISSOLVE = 0.55;
const WORD_DISSOLVE_SPREAD = 0.30;

const boundedInt = (n, fallback, max) => Math.min(max, Math.max(0, Math.floor(finite(n, fallback))));
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// 两端都缓、中间快的曲线：放大像“长大”，不像一弹。
const smoother = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

// 寿命最后 35% 快速闪烁：亮度在高低之间跳变，越到后面暗的时间越长。
function flicker(phase, age, t) {
  // 前段轻微呼吸；最后 30% 明显闪烁：亮度在 0.3 和 1 之间来回，像火药颗粒快烧完。
  if (t < 0.7) return 0.9 + 0.1 * Math.sin(phase + age * 9);
  return 0.65 + 0.35 * Math.sin(phase + age * 10);
}

// 颜色冷却：0 饱和色 → 1 偏白 → 2 暗淡冷色。返回两档和混合比例，绘制时两张贴图交叉淡化。
function colorStage(t) {
  const s = t < 0.3 ? 0 : t < 0.55 ? (t - 0.3) / 0.25 : t < 0.68 ? 1 : 1 + Math.min(1, (t - 0.68) / 0.22);
  const a = Math.min(2, Math.floor(s));
  return [a, Math.min(2, a + 1), s - a];
}

export function createFireworks(cfg = {}, { random = Math.random } = {}) {
  const maxShells = boundedInt(cfg.maxShells, FIREWORK_LIMITS.shells, FIREWORK_LIMITS.shells);
  // 追光遮罩：亮度按背景自动调整（darken 是最大压暗量，由调用方按画面亮度传进来）；按住不超过 holdMaxMs，之后降到 lowLevel。
  const maskCfg = cfg.mask ?? {};
  const holdMax = positive(maskCfg.holdMaxMs, 4000) / 1000;
  const fadeIn = positive(maskCfg.fadeInMs, 180) / 1000;
  const fadeOut = positive(maskCfg.fadeOutMs, 600) / 1000;
  // 长笑 4 秒后不再回到几乎透明：保持 45%，背景始终是暗的。
  const lowLevel = finite(maskCfg.lowLevel, 0.45);
  const maxParticles = boundedInt(cfg.maxParticles, FIREWORK_LIMITS.particles, FIREWORK_LIMITS.particles);
  const perBurst = boundedInt(cfg.particlesPerBurst, 64, FIREWORK_LIMITS.petals);
  const trailPoints = boundedInt(cfg.trailPoints, 10, FIREWORK_LIMITS.trailPoints);
  const lifetime = Math.min(5000, Math.max(1200, positive(cfg.lifetimeMs, 2400))) / 1000;
  const fragmentWords = cfg.words?.fragments ?? ['ha', 'lol'];
  const mainWords = [...new Set((cfg.words?.tiers ?? []).flatMap((tier) => tier.words))];
  const pool = Array.from({ length: maxParticles }, () => ({
    tx: new Float32Array(trailPoints), ty: new Float32Array(trailPoints), tt: new Float64Array(trailPoints)
  }));
  const words = Array.from({ length: FIREWORK_LIMITS.words }, () => ({}));
  const bursts = [];
  let count = 0;
  let wordCount = 0;
  let collisions = 0;
  let nextId = 0;
  let nextVolley = 0;
  let clock = 0;
  let carry = 0;
  let quality = 1;
  let lastHead = null;
  let lastVolley = 0;
  // 垂落每 2–3 轮出现一次，只给这一轮的第二朵中型花。
  let droopCounter = 0;
  let satelliteSlot = 0;
  let volleySeq = 0;
  let lastShoulderAt = -Infinity;
  // 每一轮的主词在三档里轮换，保证连续几轮的字大小不一样。
  let wordTierRotation = 0;
  // 上一个用过的品种，按尺寸记，避免连续两轮一模一样。
  const lastStyle = {};
  let lastRegion = { left: 0, width: 540, top: 0, height: 960 };
  let lastHeight = 960;
  let sprites = null;
  let darken = 0.4;
  let lastFireAt = -Infinity;
  let maskLevel = 0;
  let maskHold = 0;
  let headBox = null;
  const stepHead = {};
  const rand = () => Math.max(0, Math.min(1 - Number.EPSILON, finite(random(), 0.5)));
  const pick = (list) => list[Math.floor(rand() * list.length)];

  function remove(i) {
    const b = bursts.find((burst) => burst.id === pool[i].burstId);
    if (b) b.live -= 1;
    count -= 1;
    [pool[i], pool[count]] = [pool[count], pool[i]];
  }

  function removeWord(i) {
    wordCount -= 1;
    [words[i], words[wordCount]] = [words[wordCount], words[i]];
  }

  function removeBurst(index) {
    const id = bursts[index].id;
    let i = 0;
    while (i < count) {
      if (pool[i].burstId === id) remove(i);
      else i += 1;
    }
    i = 0;
    while (i < wordCount) {
      if (words[i].burstId === id) removeWord(i);
      else i += 1;
    }
    bursts.splice(index, 1);
  }

  const remaining = (b) => lifetime - (clock - b.start);
  // 脸占满画幅时把“舒适区”收紧，烟花不会一路飞到画面外才淡掉。
  let reachOverride = 0;
  const reachOf = () => (reachOverride > 0 ? reachOverride : cfg.contain?.reach ?? 2.2);

  function add(b, kind, x, y, vx, vy, size, life, tone, strength) {
    if (count >= maxParticles) return null;
    life = Math.min(life, remaining(b));
    if (life <= STEP) return null;
    const p = pool[count++];
    Object.assign(p, {
      burstId: b.id, unit: b.unit, kind, x, y, vx, vy, size,
      droopEligible: !!b.droopBloom && kind === PETAL && rand() < 0.3,
      radius: size * 0.7, life, age: 0, tone, strength,
      phase: rand() * TAU, touching: false, collided: false,
      trailIndex: 0, trailCount: 0, trailAt: -Infinity,
      secondaryAt: -1, fate: FATE_SCATTER
    });
    b.live += 1;
    limitVelocity(p, b.unit * 2.2);
    return p;
  }

  // ---------- 发射 ----------

  // 挑品种：在该尺寸可用的品种里随机，避开上一个用过的。
  function pickStyle(size) {
    const spec = cfg.styles?.[size] ?? { sphere: 1 };
    const entries = Array.isArray(spec)
      ? spec.map((k) => [k, 1])
      : Object.entries(spec).filter(([, w]) => w > 0);
    if (entries.length <= 1) return entries[0]?.[0] ?? 'sphere';
    // 按权重抽，但避开上一轮用过的：连续两轮不同，且球形仍然是绝大多数。
    const options = entries.filter(([k]) => k !== lastStyle[size]);
    const pool = options.length ? options : entries;
    const total = pool.reduce((sum, [, w]) => sum + w, 0);
    let r = rand() * total;
    let style = pool[pool.length - 1][0];
    for (const [k, w] of pool) {
      r -= w;
      if (r <= 0) {
        style = k;
        break;
      }
    }
    lastStyle[size] = style;
    return style;
  }

  // 一发完整构图（进入大笑时）：1 朵大主花 + 左右各 1 朵中型花 + 6–8 条金白细线。
  // 位置固定：主花在头顶上方略偏中线，中型花在左右对称的太阳穴外上方，细线从轮廓两侧升起。
  // 同一发只用一个主色；主花出一个大词，左边那朵中型花出一个小词。
  let mainIndex = 0;
  function launchMain(head, region, now = 0, unit = 540, options = {}) {
    if (!head || bursts.length >= maxShells) return false;
    const u = positive(unit, 540);
    const R = (cfg.volley?.big ?? 0.115) * u;
    const top = region?.top ?? 0;
    const tone = mainIndex % 2;
    const styles = ['sphere', 'sphere', 'spiral', 'sphere', 'fountain'];
    const style = styles[mainIndex % styles.length];
    const tiers = cfg.words?.tiers ?? [];
    const tier = tiers.length ? Math.min(tiers.length - 1, Math.max(0, Math.floor(finite(options.tier, 0)))) : -1;
    wordTierCurrent = Math.max(0, tier);
    const mainX = head.cx + (rand() - 0.5) * head.rx * 0.2;
    const mainY = Math.max(top + R * 0.95, head.cy - head.ry * 1.55);
    // 主花两侧的细线：左右对称、错时，长短不齐。
    const sides = [];
    const lines = 6 + Math.floor(rand() * 3);
    for (let k = 0; k < lines; k += 1) {
      const side = k % 2 === 0 ? -1 : 1;
      sides.push(side * (0.35 + rand() * 0.75));
    }
    bursts.push({
      id: ++nextId, volley: ++nextVolley, x: mainX, y: mainY, R, big: true, size: 'big', style, unit: u,
      sx: head.cx + (mainX - head.cx) * 0.4, sy: mainY + R * 2.2,
      start: clock + carry, tone, phase: finite(now) * 0.001 % TAU,
      bend: (rand() - 0.5) * 0.4,
      streakTimes: sides.map((_, k) => 0.1 + (k / lines) * 0.45).sort((a, b) => a - b),
      sides,
      streakNext: 0, exploded: false, live: 0, fragments: 0, contacts: 0,
      secondaries: FIREWORK_LIMITS.secondaries, fragmentWords: 1, full: true, tier,
      word: options.word !== false, wordSlot: 0
    });
    // 两朵中型花：左右对称，半径约主花的一半多一点，亮度由更少的粒子自然压低。
    const midR = (cfg.volley?.mid ?? 0.07) * u;
    const midY = Math.max(top + midR * 1.4, head.cy - head.ry * 0.95);
    for (const side of [-1, 1]) {
      if (bursts.length >= maxShells) break;
      bursts.push({
        id: ++nextId, volley: nextVolley, x: head.cx + side * head.rx * 1.3, y: midY + midR * 0.3,
        R: midR, big: false, size: 'mid', style: 'sphere', unit: u,
        sx: head.cx + side * head.rx * 1.1, sy: midY + midR * 2.4,
        start: clock + carry + (side < 0 ? 0.25 : 0.4), tone, phase: rand() * TAU,
        bend: (rand() - 0.5) * 0.3,
        streakTimes: [], sides: null, streakNext: 0, exploded: false, live: 0, fragments: 0, contacts: 0,
        secondaries: 0, fragmentWords: 0, full: true, tier,
        // 左边那朵中型花带一个小词，右边不带，避免两个词挤在一起。
        word: side < 0 && options.word !== false, wordSlot: 1
      });
    }
    mainIndex += 1;
    lastVolley = nextVolley;
    return true;
  }

  // 持续大笑期间补一朵中型花：左右交替，不带二次绽放，偶尔带一个小词。
  let midSide = -1;
  function launchMid(head, region, now = 0, unit = 540) {
    if (!head || bursts.length >= maxShells) return false;
    const u = positive(unit, 540);
    const R = (cfg.volley?.mid ?? 0.07) * u;
    const top = region?.top ?? 0;
    midSide = -midSide;
    bursts.push({
      id: ++nextId, volley: ++nextVolley, x: head.cx + midSide * head.rx * 1.3,
      y: Math.max(top + R * 1.4, head.cy - head.ry * 0.95), R, big: false, size: 'mid', style: 'sphere', unit: u,
      sx: head.cx + midSide * head.rx * 1.1, sy: head.cy - head.ry * 0.95 + R * 2.4,
      start: clock + carry, tone: mainIndex % 2, phase: finite(now) * 0.001 % TAU + rand() * TAU,
      bend: (rand() - 0.5) * 0.3,
      streakTimes: [], sides: null, streakNext: 0, exploded: false, live: 0, fragments: 0, contacts: 0,
      secondaries: 0, fragmentWords: 0, full: false, tier: -1,
      word: rand() < 0.5, wordSlot: 1
    });
    return true;
  }

  // 小花：围绕脸的下半圈，四个固定位置轮换（左脸颊、左下巴、右下巴、右脸颊），大小随机、大小不一。
  // 每朵只有十几颗、寿命 1.2 秒，不带二次绽放，主要作用是让烟花“围住”脸而不是只堆在头顶。
  const SMALL_SPOTS = [
    { x: -0.95, y: 0.1 }, { x: -0.55, y: 0.85 }, { x: 0.55, y: 0.85 }, { x: 0.95, y: 0.1 }
  ];
  let smallSpot = 0;
  function launchSmall(head, region, now = 0, unit = 540) {
    if (!head || bursts.length >= maxShells) return false;
    const u = positive(unit, 540);
    const spot = SMALL_SPOTS[smallSpot % SMALL_SPOTS.length];
    smallSpot += 1;
    const R = (cfg.volley?.small ?? 0.045) * u * (0.9 + rand() * 0.4);
    const x = head.cx + spot.x * head.rx;
    const y = head.cy + spot.y * head.ry;
    bursts.push({
      id: ++nextId, volley: ++nextVolley, x, y, R, big: false, size: 'small', style: 'sphere', unit: u,
      sx: x * 0.9 + head.cx * 0.1, sy: y + R * 2.2,
      start: clock + carry, tone: rand() < 0.5 ? (mainIndex % 2) : GOLD,
      phase: finite(now) * 0.001 % TAU + rand() * TAU, bend: (rand() - 0.5) * 0.3,
      streakTimes: [], sides: null, streakNext: 0, exploded: false, live: 0, fragments: 0,
      contacts: 0, secondaries: 0, fragmentWords: 0, full: false, tier: -1, word: false, wordSlot: 1
    });
    return true;
  }

  // 小装饰：持续大笑期间接力的金白细线；约一成机会是一条极小的垂柳（6 条短丝），
  // 只用来让画面有呼吸，不放大主花，也不出单词。
  function launchAux(head, region, now = 0, unit = 540) {
    if (!head || bursts.length >= maxShells * 2) return false;
    const u = positive(unit, 540);
    const R = 0.05 * u;
    const top = region?.top ?? 0;
    const side = rand() < 0.5 ? -1 : 1;
    const x = head.cx + side * head.rx * (1.05 + rand() * 0.3);
    const y = Math.max(top + R * 2, head.cy - head.ry * (0.9 + rand() * 0.4));
    const b = {
      id: ++nextId, volley: nextVolley, x, y, R, big: false, size: 'small', style: 'aux', unit: u,
      sx: head.cx + side * head.rx * 0.9, sy: y + R * 2.6,
      start: clock + carry, tone: GOLD, phase: finite(now) * 0.001 % TAU + rand() * TAU,
      bend: (rand() - 0.5) * 0.3,
      streakTimes: [], sides: null, streakNext: 0, exploded: true, live: 0,
      fragments: 0, contacts: 0, secondaries: 0, fragmentWords: 0, full: false, tier: -1,
      word: false, wordSlot: 1
    };
    bursts.push(b);
    if (quality >= 0.6 && rand() < 0.12) {
      // 极小垂柳：6 条很短的丝，只弯一点点。
      for (let k = 0; k < 6; k += 1) {
        const a = b.phase + (k * TAU) / 6 + (rand() - 0.5) * 0.2;
        const speed = u * 0.06 * (0.8 + rand() * 0.5);
        const p = add(b, PETAL, x, y, Math.cos(a) * speed, Math.sin(a) * speed - u * 0.01,
          u * 0.001, 0.7 + rand() * 0.3, GOLD, 0.55);
        if (p) {
          p.poly = true;
          p.trailLen = 10;
          p.drag = 1.4;
          p.gravity = 0.55;
          p.reach = 1.25;
        }
      }
    } else {
      // 每次补 3–5 条细线，左右都有，长短不齐。
      const lines = 3 + Math.floor(rand() * 3);
      for (let k = 0; k < lines; k += 1) {
        const side = rand() < 0.5 ? -1 : 1;
        emitStreak(b, side * (0.3 + rand() * 0.8));
      }
    }
    return true;
  }

  // 一轮烟花：plan 来自 planVolley（每颗的绽放点、出发点、半径、大小、延迟）。options 里有 tier（单词档位）、full（完整一轮）。
  // 这一轮只出一个主词，放在第一颗花外侧、远离脸的一边。返回实际放出的颗数。
  function launchVolley(plan, now = 0, unit = 540, options = {}) {
    const u = positive(unit, 540);
    const full = options.full !== false;
    const volley = ++nextVolley;
    lastVolley = volley;
    const tiers = cfg.words?.tiers ?? [];
    const tier = tiers.length ? Math.min(tiers.length - 1, Math.max(0, Math.floor(finite(options.tier, 0)))) : -1;
    wordTierCurrent = Math.max(0, tier);
    // 构图 = 原来的一轮（1 大 + 2 中 + 1 小）+ 新增左右两朵（从肩膀后方发射），是叠加不是替换。
    // 肩后这两朵只在大笑开始的前两轮出现，之后只保留原来的烟花。
    // 从背后射出的带拖尾烟花：第一轮出现，之后每 3 秒一次（clock 以秒计）。
    if (!bursts.length) lastShoulderAt = -Infinity;
    const withShoulderPair = clock - lastShoulderAt >= 3;
    if (withShoulderPair) lastShoulderAt = clock;
    const h0 = lastHead;
    const extraR = 0.09 * u;
    const top = lastRegion.top ?? 0;
    const tone = mainIndex % 2;
    let shells = (plan?.shells ?? []).filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y))
      .map((q) => ({ ...q, side: 0 }));
    if (h0 && withShoulderPair) {
      const y = Math.max(top + extraR, h0.cy - h0.ry * 1.1);
      const off = h0.rx * 0.55;
      const area = lastRegion;
      const fits = h0.cx - off - extraR * 0.8 >= area.left && h0.cx + off + extraR * 0.8 <= area.left + area.width;
      if (fits) {
        shells.push({ x: h0.cx - off, y, R: extraR, size: 'big', delay: 0, side: -1, extra: true });
        shells.push({ x: h0.cx + off, y, R: extraR, size: 'big', delay: 0.08, side: 1, extra: true });
      }
    }
    // 单独放一颗（测试、外部调用）时只用传入的 plan。
    if (options.solo && plan?.shells?.length) {
      shells = plan.shells.map((q) => ({ x: q.x, y: q.y, R: q.radius, size: 'big', delay: q.delay ?? 0, side: 0, from: q.from }));
    }
    if (quality < 0.6) shells = shells.filter((q) => !q.extra).slice(0, 2);
    let launched = 0;
    const droopThisRound = (droopCounter++ % 3) === 0;
    shells.forEach((s, n) => {
      if (bursts.length >= maxShells) return;
      const size = s.size === 'big' ? 'big' : s.size === 'small' ? 'small' : 'mid';
      const style = pickStyle(size);
      const big = size === 'big';
      const scale = style === 'sphere' ? 1 : (cfg.styles?.specialScale ?? 0.76);
      const R = positive(s.R ?? s.radius, (size === 'big' ? 0.17 : size === 'mid' ? 0.11 : 0.07) * u * scale);
      // 出发点：新增的两朵从同侧肩膀后方；原来的几朵沿用 plan 给的起点。
      const area = lastRegion;
      let from;
      if (s.from && Number.isFinite(s.from.x)) from = s.from;
      else if (s.side) {
        const side = s.side;
        const hh = lastHead;
        let fx = hh ? hh.cx + side * hh.rx * 1.35 : s.x;
        let fy = hh ? hh.cy + hh.ry * 1.25 : s.y + R * 2.4;
        const margin = R * 0.6;
        fx = Math.min(area.left + area.width - margin, Math.max(area.left + margin, fx));
        fy = Math.min(area.top + (area.height ?? 960) - margin, Math.max(area.top + margin, fy));
        from = { x: fx, y: fy };
      } else {
        from = { x: s.x, y: s.y + R * 2.2 };
      }
      const streaks = Math.round((size === 'big' ? 4 + Math.floor(rand() * 3) : size === 'mid' ? 2 : 1) * quality);
      bursts.push({
        id: ++nextId, volley, x: s.x, y: s.y, sx: from.x, sy: from.y, R, big, size, style, unit: u,
        // 只有从肩膀后方发射的那两朵带拖尾；头部发射的保持原样、不带拖尾。
        hasTrail: !!s.extra, ascent: s.extra ? 1.4 : 0.55,
        start: clock + carry + Math.max(0, finite(s.delay, 0)),
        tone: s.extra ? tone : Math.floor(rand() * 3),
        phase: finite(now) * 0.001 % TAU + rand() * TAU + n, full, tier,
        bend: (rand() - 0.5) * 0.45,
        streakTimes: Array.from({ length: Math.min(FIREWORK_LIMITS.streaks, streaks) }, () => 0.12 + rand() * 0.3).sort((a, b) => a - b),
        sides: s.side ? [s.side * 0.6, s.side * 0.3] : null,
        streakNext: 0, exploded: false, live: 0, fragments: 0, contacts: 0,
        secondaries: style === 'sphere' ? (size === 'big' ? (quality >= 0.6 ? FIREWORK_LIMITS.secondaries : 1) : size === 'mid' && quality >= 0.6 ? 1 : 0) : 0,
        fragmentWords: big && quality >= 0.75 ? 1 : 0,
        droopBloom: droopThisRound && size === 'mid' && n === 2,
        word: options.word !== false && n === 0,
        wordSlot: n === 0 ? 0 : 1
      });
      launched += 1;
    });
    return launched;
  }

  // 单独放一颗（测试和简单调用用）。options.size：'big' | 'mid'。
  function launch(px, py, now, unit = 540, options = {}) {
    if (!Number.isFinite(px) || !Number.isFinite(py) || bursts.length >= maxShells) return false;
    const u = positive(unit, 540);
    const size = options.size === 'mid' ? 'mid' : 'big';
    const R = (size === 'big' ? cfg.volley?.big ?? 0.17 : size === 'mid' ? cfg.volley?.mid ?? 0.11 : cfg.volley?.small ?? 0.07) * u;
    const from = lastHead
      ? { x: lastHead.cx + Math.sign(px - lastHead.cx || 1) * lastHead.rx * 0.5, y: lastHead.cy - lastHead.ry * 1.08 }
      : { x: px, y: py + R * 2.2 };
    return launchVolley({ shells: [{ x: px, y: py, radius: R, size, delay: 0, from }] }, now, u, { ...options, solo: true }) > 0;
  }

  // 发射中的亮点位置：减速飞向绽放点，路径向一侧略弯。
  function rocketAt(b, t) {
    const e = Math.min(1, Math.max(0, t));
    const k = 1 - (1 - e) * (1 - e);
    const dx = b.x - b.sx;
    const dy = b.y - b.sy;
    const side = Math.sin(Math.PI * e) * b.bend;
    let x = b.sx + dx * k - dy * side * 0.25;
    let y = b.sy + dy * k + dx * side * 0.25;
    if (b.style === 'spiral') {
      // 旋转上升：在上升路径上叠加一段绕轴的横向摆动，越往上越明显，尾部拖出螺旋。
      const amp = b.unit * 0.035 * e;
      const nx = dy;
      const ny = -dx;
      const len = Math.hypot(nx, ny) || 1;
      const swing = Math.sin(e * Math.PI * 4 + b.phase) * amp;
      x += (nx / len) * swing;
      y += (ny / len) * swing;
    }
    return { x, y };
  }

  // 辅助烟花：从脸部轮廓外侧向四周放射（左、上、右，不往下），越往两侧越平。
  // 方向偏向这一轮几颗主花所在的位置，从轮廓出发在约 1.1–1.4 个头半径处结束，不飞到画面边缘；
  // 按方向算出来会飞出画面时缩短时长，在黑面上没有单独画出来的空间。
  // 辅助细线：更短、更慢，贴着头发外侧升起，不再冲到画面边缘。
  const STREAK_REACH = [0.7, 1.0];
  const STREAK_LIFE = [0.5, 0.7];
  function streakDir() {
    // 一半朝主花绽放点，一半在它们之间散开。
    const targets = bursts.filter((q) => q.volley === lastVolley).map((q) => Math.atan2(q.x - (lastHead?.cx ?? q.x), -(q.y - (lastHead?.cy ?? q.y))));
    if (targets.length && rand() < 0.6) return pick(targets) + (rand() - 0.5) * 0.5;
    return (rand() - 0.5) * 2 * 105 * Math.PI / 180;
  }

  function emitStreak(b, theta) {
    const h = lastHead;
    const sx = Math.sin(theta);
    const sy = -Math.cos(theta);
    let x;
    let y;
    if (h) {
      const contour = 1 / Math.sqrt((sx / h.rx) ** 2 + (sy / h.ry) ** 2);
      x = h.cx + sx * contour * 1.12;
      y = h.cy + sy * contour * 1.12;
    } else {
      x = b.sx + sx * b.unit * 0.05;
      y = b.sy + sy * b.unit * 0.05;
    }
    // 走多远：1.1–1.4 个头半径；再把时长收紧到“不飞出画面”。
    const reach = h ? h.ry * (STREAK_REACH[0] + rand() * (STREAK_REACH[1] - STREAK_REACH[0])) : b.unit * 0.28;
    let life = STREAK_LIFE[0] + rand() * (STREAK_LIFE[1] - STREAK_LIFE[0]);
    const drift = b.unit * 0.1 * (rand() - 0.5);
    const ex = x + sx * reach;
    const ey = y + sy * reach - b.unit * 0.04;
    const edgeX = ex < lastRegion.left + b.unit * 0.06 || ex > lastRegion.left + lastRegion.width - b.unit * 0.06;
    const edgeY = ey < lastRegion.top + b.unit * 0.04;
    if (edgeX || edgeY) life *= 0.65;
    const speed = reach / life;
    const r = rand();
    const p = add(b, STREAK, x, y, sx * speed + drift, sy * speed - b.unit * 0.04 / life,
      b.unit * (0.0022 + rand() * 0.0012), life, GOLD, 0.75 + rand() * 0.25);
    if (p) p.fate = r < 0.6 ? FATE_SCATTER : r < 0.85 ? FATE_FADE : FATE_POP;
  }

  // 辅助烟花到达各自的位置后：散成碎粒往下飘，或炸开一朵小花（渐隐的不生成新粒子）。
  function endStreak(p, b) {
    if (p.fate === FATE_SCATTER) {
      const n = Math.min(FIREWORK_LIMITS.embersPer, 3 + Math.floor(rand() * 3));
      for (let k = 0; k < n; k += 1) {
        add(b, EMBER, p.x + (rand() - 0.5) * b.unit * 0.01, p.y, p.vx * 0.25 + (rand() - 0.5) * b.unit * 0.08,
          p.vy * 0.15 + rand() * b.unit * 0.04, b.unit * (0.0012 + rand() * 0.0008), 0.45 + rand() * 0.35, GOLD, 0.6);
      }
    } else if (p.fate === FATE_POP) {
      const n = Math.min(FIREWORK_LIMITS.popsPer, 10 + Math.floor(rand() * 3));
      for (let k = 0; k < n; k += 1) {
        const a = k * TAU / n + rand() * 0.3;
        const speed = b.unit * (0.14 + rand() * 0.06);
        add(b, POP, p.x, p.y, Math.cos(a) * speed, Math.sin(a) * speed - b.unit * 0.02,
          b.unit * (0.0016 + rand() * 0.0008), 0.6 + rand() * 0.3, rand() < 0.7 ? GOLD : b.tone, 0.8);
      }
    }
  }

  // 主花：外圈 + 稍慢的内圈。炸开距离约等于花的半径 R（线性阻尼下，初速 / 阻尼 = 滑行距离）。
  // 同一朵花的光粒寿命相差约一倍，消散时有早有晚，不会整齐地一起消失。
  function explode(b) {
    b.exploded = true;
    const max = b.size === 'big' ? FIREWORK_LIMITS.petals : b.size === 'mid' ? FIREWORK_LIMITS.midPetals : FIREWORK_LIMITS.smallPetals;
    const share = b.size === 'big' ? 1 : b.size === 'mid' ? 0.56 : 0.3;
    const n = Math.max(8, Math.min(max, Math.round(perBurst * share * (b.full ? 1 : 0.85))));
    const chosen = new Set();
    const first = Math.floor(rand() * n);
    const picks = Math.min(b.secondaries, n);
    for (let k = 0; k < picks; k += 1) chosen.add((first + Math.round((k * n) / picks)) % n);
    const drag = PHYSICS[PETAL].drag;
    if (b.style === 'fountain') {
      // 喷泉扇形：6–8 条向外略弯的光丝（取代原来的直线“针”），每条长度、弧度都不同。
      const arms = 5 + Math.floor(rand() * 2);
      const perArm = Math.max(2, Math.round(n / arms));
      for (let arm = 0; arm < arms; arm += 1) {
        const a = b.phase + (arm * TAU) / arms + (rand() - 0.5) * 0.12;
        const armLen = 0.5 + rand() * 0.4;
        for (let k = 0; k < perArm; k += 1) {
          const t = (k + 1) / perArm;
          const speed = b.R * PHYSICS[PETAL].drag * (0.35 + 0.65 * t) * armLen * (0.95 + rand() * 0.1);
          const p = add(b, PETAL, b.x, b.y, Math.cos(a) * speed, Math.sin(a) * speed,
            b.unit * (0.0018 + rand() * 0.0007), remaining(b) * (0.55 + rand() * 0.3),
            b.tone, 0.65 + rand() * 0.15);
          if (p) {
            p.poly = true;
            p.trailLen = 14;
            p.drag = 2.2;
            p.gravity = 0.5;
          }
        }
      }
      return finishBloom(b);
    }
    if (b.style === 'willow') {
      // 垂柳：先冲出去，再被重力拉弯垂下来，末端挂一颗小珠；线长、细、弯。
      const m = Math.min(max, 10 + Math.floor(rand() * 3));
      for (let k = 0; k < m; k += 1) {
        const a = b.phase + (k * TAU) / m + (rand() - 0.5) * 0.1;
        const speed = b.R * 1.1 * (0.8 + rand() * 0.5);
        const curl = (rand() - 0.5) * 0.25;
        const p = add(b, PETAL, b.x, b.y,
          Math.cos(a) * speed - Math.sin(a) * speed * curl,
          Math.sin(a) * speed + Math.cos(a) * speed * curl - b.unit * 0.04,
          b.unit * (0.0016 + rand() * 0.0008), remaining(b) * (0.85 + rand() * 0.15),
          rand() < 0.85 ? b.tone : GOLD, 0.55 + rand() * 0.15);
        if (p) {
          p.poly = true;
          p.trailLen = 18;
          p.drag = 1.1;
          p.gravity = 0.62;
          // 垂柳要长一点才像，单独放宽到 2.8 个头半径。
          p.reach = 2.0;
        }
      }
      return finishBloom(b);
    }
    if (b.style === 'chrys') {
      // 菊花丝线：一圈细丝，带一点切向速度，落下时微微打卷；丝很长，拖尾点拉满。
      const m = Math.min(max, Math.round(perBurst * 0.4));
      for (let k = 0; k < m; k += 1) {
        const a = b.phase + (k * TAU) / m + (rand() - 0.5) * 0.05;
        const speed = b.R * drag * (0.75 + rand() * 0.2);
        const curl = 0.18 + rand() * 0.14;
        const p = add(b, PETAL, b.x, b.y,
          Math.cos(a) * speed - Math.sin(a) * speed * curl,
          Math.sin(a) * speed + Math.cos(a) * speed * curl - b.unit * 0.02,
          b.unit * (0.0016 + rand() * 0.0008), remaining(b) * (0.7 + rand() * 0.25),
          rand() < 0.8 ? b.tone : GOLD, 0.55 + rand() * 0.15);
        if (p) {
          p.poly = true;
          p.trailLen = 14;
          p.drag = 1.6;
          p.gravity = 0.55;
        }
      }
      return finishBloom(b);
    }
    for (let k = 0; k < n; k += 1) {
      const inner = k % 4 === 3;
      // 旋转品种：粒子分成三条旋臂，每颗再加一点切向速度，炸开后像风车一样旋开。
      let a = b.phase + k * TAU / n + (rand() - 0.5) * 0.12;
      let twist = 0;
      if (b.style === 'spiral') {
        const arm = k % 3;
        a = b.phase + (arm * TAU) / 3 + (k / n) * 0.9 + (rand() - 0.5) * 0.06;
        twist = 0.45;
      }
      const speed = b.R * drag * (inner ? 0.55 + rand() * 0.1 : 0.92 + rand() * 0.16);
      const radial = Math.cos(a) * speed;
      const tang = Math.sin(a) * speed;
      const strong = rand() < 0.2;
      const life = remaining(b) * (0.5 + rand() * 0.5);
      const vx = radial - Math.sin(a) * speed * twist;
      const vy = (tang + Math.cos(a) * speed * twist) * 0.92 - b.unit * 0.02;
      const p = add(b, PETAL, b.x, b.y, vx, vy,
        b.unit * (strong ? 0.0042 : 0.003 + rand() * 0.001) * (b.size === 'big' ? 1 : b.size === 'mid' ? 0.85 : 0.72), life,
        rand() < 0.85 ? b.tone : GOLD, strong ? 1 : 0.7 + rand() * 0.2);
      if (p && strong) p.bloomEligible = true;
      if (p && chosen.has(k)) p.secondaryAt = life * (0.28 + rand() * 0.06);
    }
    finishBloom(b);
  }

  // 绽放后弹词：一次一个，在画面左上（额头/发际线）和右下（颈侧/肩前）之间轮流。
  // 新词在前一个还没完全消失时就开始浮现（前一个剩约 0.25 秒时），交接是叠化的，不会断档。
  // 词跟随花朵颜色；小词（ha / lol）太小，已经去掉。
  let wordSlot = 0;
  let wordPairAt = -Infinity;
  let wordStarted = false;
  let wordTierCurrent = 0;
  function spawnWordPair(unit, tone, tier = 0) {
    if (!lastHead) return false;
    const h = lastHead;
    const slot = wordSlot;
    const tierWords = cfg.words?.tiers?.[Math.max(0, Math.min((cfg.words?.tiers?.length ?? 1) - 1, tier))]?.words ?? ['HAHA'];
    const text = pick(tierWords);
    const wc = cfg.words ?? {};
    const sizes = wc.sizes ?? [0.18, 0.12];
    const alphas = wc.alphas ?? [0.95, 0.6];
    const life = 1.6;
    // 画布是镜像显示的：画布 +x 出现在屏幕左侧。
    // 左上：额头/发际线高度，内边缘 0.70 个头半径；右下：下颌/颈侧，同样 0.70，并往上收到 0.55 ry。
    const aspectOf = (t) => (t.length * 27 + 112) / 196;
    const roomOf = (sd) => (sd > 0
      ? lastRegion.left + lastRegion.width - h.cx
      : h.cx - lastRegion.left);
    let dir = slot === 0 ? 1 : -1;
    const edgeK = 0.70;
    // 该侧明显更窄时换到宽的一侧，不把词挤回脸上。
    if (roomOf(dir) < roomOf(-dir) * 0.7) dir = -dir;
    // 外侧实在放不下一整串时等比缩小，缩到 0.55 为止；宁可字小一点，也不挡住五官。
    const take = (word, sizeFrac, edgeK) => {
      const aspect = aspectOf(word);
      const room = Math.max(unit * 0.12, roomOf(dir) - h.rx * edgeK);
      const halfFull = unit * sizeFrac * aspect / 2;
      const k = Math.max(0.55, Math.min(1, (room - unit * 0.05) / (2 * halfFull)));
      const scaled = sizeFrac * k;
      const half = unit * scaled * aspect / 2 + unit * 0.02;
      return { scaled, half, x: h.cx + dir * (h.rx * edgeK + half) };
    };
    let big = take(text, sizes[0], edgeK);
    let bigY = slot === 0 ? h.cy - h.ry * 0.55 : h.cy + h.ry * 0.55;
    // 摄像头里脸常常占满可见宽度，两侧连缩到 0.55 都放不下：改到发际线上方居中，
    // 宁可离脸远一点，也不把字挤回脸上（演示照片里空间够，不会走到这里）。
    if (big.half * 2 > roomOf(dir) - h.rx * edgeK + unit * 0.02) {
      const aspect = aspectOf(text);
      const halfFull = unit * sizes[0] * aspect / 2;
      const room = Math.max(unit * 0.12, lastRegion.width / 2 - unit * 0.06);
      const k = Math.max(0.55, Math.min(1, (room - unit * 0.05) / (2 * halfFull)));
      const half = unit * sizes[0] * k * aspect / 2 + unit * 0.02;
      big = { scaled: sizes[0] * k, half, x: h.cx + (slot === 0 ? -0.22 : 0.22) * h.rx };
      bigY = h.cy - h.ry * 1.15;
    }
    const push = (word, wordTone, place, wy, alpha, blur, main, tilt) => {
      if (wordCount >= FIREWORK_LIMITS.words) return;
      const w = words[wordCount++];
      const half = place.half;
      Object.assign(w, {
        burstId: -1, unit, text: word, tone: wordTone, main, born: clock,
        x: Math.min(lastRegion.left + lastRegion.width - half, Math.max(lastRegion.left + half, place.x)),
        // 按字高留边：字框上下还有光晕留白，0.28 倍字高能保证墨迹不顶出画面。
        y: Math.min(lastRegion.top + lastRegion.height - unit * place.scaled * 0.28, Math.max(lastRegion.top + unit * place.scaled * 0.28, wy)),
        vx: 0, vy: unit * 0.01,
        size: unit * place.scaled, radius: unit * place.scaled * 0.42, age: 0, life, hold: 0.35,
        alpha, blur, tilt, spin: (rand() - 0.5) * 0.15, phase: rand() * TAU,
        touching: false, collided: false,
        dissolvePlan: null, dissolveNext: 0
      });
    };
    push(text, tone, big, bigY, alphas[0], false, true, 0);
    wordSlot = 1 - slot;
    wordPairAt = clock;
    wordStarted = true;
    return true;
  }

  // 词的生命周期不看烟花：前一个还剩约 0.4 秒时，下一个在另一角马上开始浮现。
  function keepWordsAlive() {
    if (!bursts.length || !lastHead) return;
    // 等第一朵花真正炸开后再出词，避免发射阶段就出现文字。
    if (!bursts.some((b) => b.exploded)) return;
    if (!wordStarted) {
      spawnWordPair(lastRegion.width || 540, Math.floor(rand() * 3), wordTierCurrent);
      return;
    }
    // 单位必须跟可见画幅走：摄像头竖屏裁切后只有约 270 宽，写死 540 会让字大一倍。
    if (clock - wordPairAt >= 1.2) spawnWordPair(lastRegion.width || 540, Math.floor(rand() * 3), wordTierCurrent);
  }

  function finishBloom(b) {
    // 词由 keepWordsAlive 独立驱动，不再跟每一朵花绑定。
  }

  // 二次绽放：一圈小花 + 几条又细又长的白色亮线；大花还会带出碎词。
  function crackle(p, b) {
    const n = Math.min(FIREWORK_LIMITS.cracklesPer, 8 + Math.floor(rand() * 3));
    const drag = PHYSICS[CRACKLE].drag;
    for (let k = 0; k < n; k += 1) {
      const a = k * TAU / n + rand() * 0.4;
      const speed = b.R * drag * (0.3 + rand() * 0.1);
      add(b, CRACKLE, p.x, p.y, p.vx * 0.3 + Math.cos(a) * speed, p.vy * 0.3 + Math.sin(a) * speed,
        b.unit * (0.0016 + rand() * 0.0008), 0.55 + rand() * 0.3, rand() < 0.5 ? GOLD : p.tone, 0.85);
    }
    const lines = Math.round(FIREWORK_LIMITS.glintsPer * (0.5 + 0.5 * quality));
    for (let k = 0; k < lines; k += 1) {
      const a = rand() * TAU;
      const speed = b.R * PHYSICS[GLINT].drag * (0.55 + rand() * 0.25);
      add(b, GLINT, p.x, p.y, Math.cos(a) * speed, Math.sin(a) * speed, b.unit * 0.0016, 0.22 + rand() * 0.1, WHITE, 0.95);
    }
    if (b.fragmentWords > 0 && wordCount < 2) {
      b.fragmentWords -= 1;
      addWord(b, pick(fragmentWords), GOLD, p.x, p.y, p.vx * 0.4, p.vy * 0.4 - b.unit * 0.04, false, 2);
    }
  }

  // 光粒提前熄灭时，有一部分在原处留下一点很淡的余烬，像花的轮廓残影。
  function leaveAsh(p, b) {
    // 大部分主花光粒熄灭后都留一点余烬：暖色小点，慢慢往下飘再淡掉。
    if (rand() > 0.85) return;
    add(b, ASH, p.x, p.y, p.vx * 0.15 + (rand() - 0.5) * b.unit * 0.01,
      p.vy * 0.15 + b.unit * (0.02 + rand() * 0.02), p.size * 1.1, 0.5 + rand() * 0.35, GOLD, 0.5);
  }

  // 接触反馈：小闪光 + 沿法线的溅射；只有大粒子和单词火星会再开一朵微型花。
  function emitContact(p, b) {
    collisions += 1;
    if (b.contacts < FIREWORK_LIMITS.contactsPerBurst) {
      if (add(b, CONTACT, p.hitX, p.hitY, 0, 0, b.unit * 0.006, 0.14, GOLD, 0.7)) b.contacts += 1;
    }
    // 溅射：3–4 颗短命火星沿表面喷出，碰得越快喷得越远。
    const incoming = Math.hypot(p.vx, p.vy) / b.unit;
    const boost = Math.min(1.6, 0.5 + incoming * 2.2);
    const base = Math.atan2(p.ny, p.nx);
    const n = 3 + Math.floor(rand() * 2);
    const fx = b.contactFx ?? 0;
    if (fx < 12) {
      b.contactFx = fx + n;
      for (let k = 0; k < n; k += 1) {
        const a = base + (rand() - 0.5) * 1.7;
        const speed = b.unit * (0.10 + rand() * 0.09) * boost;
        const sp = add(b, SPARK, p.hitX, p.hitY,
          Math.cos(a) * speed + p.vx * 0.12,
          Math.sin(a) * speed + p.vy * 0.12 - b.unit * 0.02,
          b.unit * (0.0014 + rand() * 0.001), 0.22 + rand() * 0.16,
          rand() < 0.7 ? p.tone : GOLD, 0.7);
        if (sp) { sp.contacted = true; sp.bloomEligible = false; }
      }
    }
    // 微绽放：每轮最多两朵，只给大粒子和单词火星；瓣状向外，不往脸心炸。
    if (p.bloomEligible && (b.blooms ?? 0) < 2) {
      b.blooms = (b.blooms ?? 0) + 1;
      miniBloom(p, b);
    }
  }

  function miniBloom(p, b) {
    const count = 6 + Math.floor(rand() * 2);
    const base = Math.atan2(p.ny, p.nx);
    const ox = p.hitX + p.nx * b.unit * 0.01;
    const oy = p.hitY + p.ny * b.unit * 0.01;
    for (let k = 0; k < count; k += 1) {
      const spread = (k / Math.max(1, count - 1) - 0.5) * 2.2 + (rand() - 0.5) * 0.2;
      const a = base + spread;
      const speed = b.unit * (0.06 + rand() * 0.05);
      const sp = add(b, SPARK, ox, oy, Math.cos(a) * speed, Math.sin(a) * speed,
        b.unit * (0.002 + rand() * 0.0012), 0.3 + rand() * 0.12,
        rand() < 0.6 ? p.tone : GOLD, 0.8);
      if (sp) { sp.contacted = true; sp.bloomEligible = false; }
    }
  }

  // ---------- 单词 ----------
  let lastMain = null;

  // 按笑的档位挑主词，和上一发不重复。
  function pickMainWord(b) {
    const tiers = cfg.words?.tiers ?? [];
    if (b.tier < 0 || !tiers.length) return null;
    const list = tiers[b.tier].words;
    let word = pick(list);
    if (list.length > 1 && word === lastMain) word = list[(list.indexOf(word) + 1) % list.length];
    lastMain = word;
    return word;
  }

  // tier：0 大、1 中、2 小；字号、透明度、虚实都按这一档取，画面上能明显看出错落。
  function addWord(b, text, tone, x, y, vx, vy, main, tier = 0) {
    if (wordCount >= FIREWORK_LIMITS.words) return null;
    const life = Math.min(remaining(b), main ? 1.7 : 1.1);
    if (life <= 0.2) return null;
    const w = words[wordCount++];
    const wc = cfg.words ?? {};
    const sizes = wc.sizes ?? [1, 0.7, 0.5];
    const alphas = wc.alphas ?? [1, 0.8, 0.6];
    const k = Math.min(sizes.length - 1, Math.max(0, Math.round(tier)));
    const fragSizes = wc.fragmentSizes ?? [0.085, 0.065, 0.045];
    const minReadable = (wc.minReadable ?? 0.045) * b.unit;
    const size = Math.max(minReadable, b.unit * (main ? sizes[k] : fragSizes[k]));
    Object.assign(w, {
      burstId: b.id, unit: b.unit, text, tone, main, born: clock, x, y, vx, vy, size,
      radius: size * 0.42, age: 0, life, hold: main ? 0.45 : 0.12,
      alpha: alphas[k] ?? 1, tilt: 0,
      blur: k === 2 || rand() < (wc.blurChance ?? 0.33),
      spin: (rand() - 0.5) * 0.28, phase: rand() * TAU,
      touching: false, collided: false,
      dissolvePlan: null, dissolveNext: 0
    });
    return w;
  }

  const shortTrail = (kind) => kind === SPARK || kind === EMBER || kind === ASH;

  function remember(p) {
    if (p.kind === GLINT) return;
    const length = p.trailLen ? Math.min(FIREWORK_LIMITS.trailPoints, p.trailLen) : shortTrail(p.kind) ? Math.min(4, trailPoints) : trailPoints;
    if (!length || clock - p.trailAt < (p.trailLen ? 0.018 : 0.025) - EPS) return;
    p.tx[p.trailIndex] = p.x;
    p.ty[p.trailIndex] = p.y;
    p.tt[p.trailIndex] = clock;
    p.trailIndex = (p.trailIndex + 1) % length;
    p.trailCount = Math.min(length, p.trailCount + 1);
    p.trailAt = clock;
  }

  function stepParticles(head) {
    let i = 0;
    while (i < count) {
      const p = pool[i];
      p.age += STEP;
      const b = bursts.find((burst) => burst.id === p.burstId);
      if (p.age >= p.life || p.y > lastHeight + p.unit * 0.2
        || p.x < lastRegion.left - p.unit * 0.4 || p.x > lastRegion.left + lastRegion.width + p.unit * 0.4) {
        if (p.kind === STREAK && b && p.age >= p.life) endStreak(p, b);
        // 提前熄灭（离这一颗结束还有 0.3 秒以上）的主花光粒留下一点余烬。
        // 熄灭的主花光粒都留一小点余烬（不论是提前熄灭还是寿命走完）。
        if (p.kind === PETAL && b && p.age >= p.life) leaveAsh(p, b);
        remove(i);
        continue;
      }
      // 垂落收尾：只有被挑中的那几颗（每轮一朵中花里约三成）、寿命最后 25% 才切换；
    // 0.35 秒内在半空淡出，不再落到肩膀。
    // 出现下落趋势时立刻散成粒子：不再拖长线、不再像水滴，把速度打散成小颗粒，再闪一下消失。
    if (p.droopEligible && !p.droop && p.age >= p.life * 0.75) {
      p.droop = true;
      p.poly = false;
      p.trailCount = 0;
      const a = rand() * TAU;
      const kick = b.unit * (0.03 + rand() * 0.03);
      p.vx += Math.cos(a) * kick;
      p.vy += Math.sin(a) * kick + b.unit * 0.01;
      p.drag = 2.6;
      p.gravity = 0.9;
      p.life = Math.min(p.life, p.age + 0.28);
      p.age = Math.min(p.age, p.life - 0.01);
    }
    if (p.kind === PETAL && p.secondaryAt > 0 && p.age >= p.secondaryAt && b) {
        crackle(p, b);
        remove(i);
        continue;
      }
      if (p.kind !== CONTACT) {
        const phys = PHYSICS[p.kind];
        // 品种可以给单颗光粒指定阻尼和重力（垂柳需要“重力明显大于阻尼”，才会弯着往下掉）。
        advanceParticle(p, STEP, phys.collide ? head : null, p.drag ?? phys.drag, p.unit * (p.gravity ?? phys.gravity), p.unit * 2.2, 0.62);
        if (p.collided) {
          // 不把碰撞前穿进人脸的路径连成一条亮线。
          p.trailCount = 0;
          p.trailIndex = 0;
          p.trailAt = -Infinity;
          // 一颗粒子一辈子只触发一次接触反馈，避免贴着椭圆滑动时连珠闪。
          if (b && !p.contacted && (p.kind === PETAL || p.kind === CRACKLE || p.kind === SPARK)) {
            p.contacted = true;
            emitContact(p, b);
          } else {
            collisions += 1;
          }
        }
        // 软边界：不设硬墙。接近边界时逐渐加阻尼、离得越远淡得越快，粒子自己能慢下来并消散。
        if (head && p.kind !== CONTACT && p.kind !== STREAK) {
          const reach = p.reach ?? reachOf();
          const rr = Math.hypot((p.x - head.cx) / (head.rx * reach), (p.y - head.cy) / (head.ry * reach));
          if (rr > 0.8) {
            const k = Math.min(1, (rr - 0.8) / 0.35);
            // 越靠外，每秒衰减越强：0.8 处几乎无感，1.15 处约每秒减半。
            const damp = Math.exp(-k * k * 6 * STEP);
            p.vx *= damp;
            p.vy *= damp;
            if (p.life - p.age > 0.05) p.age += STEP * k * k * 3;
          }
        }
        remember(p);
      }
      i += 1;
    }
  }

  // 单词：原地不动——小字渐显、放大、停留，最后从字形采样点散成火星（火星会碰头）。
  // 不再下落：放大已经是主位移，再叠下落会打架；碰撞交给散出去的火星。
  function stepWords() {
    let i = 0;
    while (i < wordCount) {
      const w = words[i];
      w.age += STEP;
      if (w.age >= w.life || w.y > lastHeight + w.unit * 0.2) {
        removeWord(i);
        continue;
      }
      // 消散只在浏览器里有字形采样点；测试环境没有 canvas 时安静跳过。
      if (w.age >= w.life - WORD_DISSOLVE && typeof document !== 'undefined') {
        const spr = wordSprite(w.text, w.tone);
        // 采样点挂在清晰版贴图上：spr 本身只有 sharp / soft 两张图。
        const pts = spr?.sharp?.points;
        if (pts?.length) {
          if (!w.dissolvePlan) buildDissolvePlan(w, pts.length);
          emitDissolve(w, spr);
        }
      }
      i += 1;
    }
  }

  // 词的尺寸与角度：绘制和火星出生点共用同一套，保证火星从当前字面上长出来。
  function wordPose(w, age, aspect) {
    const scale = (WORD_GROW_FROM + (1 - WORD_GROW_FROM) * smoother(WORD_GROW_START, WORD_GROW_END, age))
      * (1 - 0.10 * smooth(w.life - WORD_DISSOLVE, w.life, age));
    const angle = (w.tilt ?? 0) + (w.spin ?? 0) * Math.min(1, age / w.life) * 2;
    const h = w.size * scale;
    return { h, width: h * aspect, angle, cos: Math.cos(angle), sin: Math.sin(angle) };
  }

  // 消散计划：大词 13 颗、小词 6 颗，出生先后随机错开 0–0.3 秒。
  // 不按从左到右扫：那像擦除，和“缓缓散开”不是一回事。
  function buildDissolvePlan(w, pointCount) {
    const want = Math.min(pointCount, w.main ? 13 : 6);
    const order = Array.from({ length: pointCount }, (_, k) => k);
    for (let k = order.length - 1; k > 0; k -= 1) {
      const j = Math.floor(rand() * (k + 1));
      [order[k], order[j]] = [order[j], order[k]];
    }
    w.dissolvePlan = order.slice(0, want)
      .map((index) => ({ index, at: rand() * WORD_DISSOLVE_SPREAD }))
      .sort((a, b) => a.at - b.at);
    w.dissolveNext = 0;
  }

  // 找一颗剩余寿命最长的烟花当容器：火星的寿命要按它的剩余时间截断。
  // 0.5 秒是下限：最后一对词可能在烟花停了之后才散，这时只剩它自己那一轮可以借。
  function liveBurst() {
    let best = null;
    let bestLeft = 0.5;
    for (const b of bursts) {
      const left = remaining(b);
      if (left > bestLeft) {
        bestLeft = left;
        best = b;
      }
    }
    return best;
  }

  function emitDissolve(w, spr) {
    const b = liveBurst();
    if (!b) return;
    const pose = wordPose(w, w.age, spr.sharp.aspect);
    const elapsed = w.age - (w.life - WORD_DISSOLVE);
    while (w.dissolveNext < w.dissolvePlan.length && w.dissolvePlan[w.dissolveNext].at <= elapsed) {
      const pt = spr.sharp.points[w.dissolvePlan[w.dissolveNext].index];
      w.dissolveNext += 1;
      if (!pt) continue;
      const dx = pt.x - 0.5;
      const dy = pt.y - 0.5;
      // 速度随离字心的距离变大：边缘先散、字心最后才化，像一整块被慢慢吹散。
      const speed = w.unit * (0.08 + rand() * 0.06);
      const X = w.x - pose.cos * dx * pose.width - pose.sin * dy * pose.h;
      const Y = w.y - pose.sin * dx * pose.width + pose.cos * dy * pose.h;
      const sp = add(b, SPARK, X, Y,
        (-pose.cos * dx - pose.sin * dy) * speed,
        (-pose.sin * dx + pose.cos * dy) * speed - w.unit * 0.02,
        w.unit * (0.0032 + rand() * 0.0012), 0.4 + rand() * 0.2,
        rand() < 0.65 ? w.tone : GOLD, 0.85);
      if (sp) sp.bloomEligible = true;
    }
  }


  function update(dtSec, { head = null, region, height } = {}) {
    lastHead = safeHead(head);
    if (region && Number.isFinite(region.left) && Number.isFinite(region.width) && region.width > 0) {
      lastRegion = {
        left: region.left,
        width: region.width,
        top: Number.isFinite(region.top) ? region.top : 0,
        height: positive(region.height, lastRegion.height ?? 960)
      };
    }
    lastHeight = positive(height, lastHeight);
    headBox = lastHead;
    const dt = Math.max(0, finite(dtSec));
    const end = clock + carry + dt;
    // 长时间停帧也按真实 dt 回收；先清理过期烟花，避免为看不见的旧粒子补算几千步。
    for (let i = bursts.length - 1; i >= 0; i -= 1) {
      if (end - bursts[i].start >= lifetime - EPS) removeBurst(i);
    }
    if (!bursts.length) {
      // 烟花已经放完：让剩下的单词照常走完寿命，不能停在半空。
      if (wordCount) {
        let i = 0;
        while (i < wordCount) {
          words[i].age += dt;
          if (words[i].age >= words[i].life) removeWord(i);
          else i += 1;
        }
      }
      clock = end;
      carry = 0;
      stepMask(dt);
      return;
    }
    carry += dt;
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
        // 同一轮里后面几颗有延迟，还没到发射时间就什么都不做。
        if (age < 0) continue;
        while (b.streakNext < b.streakTimes.length && age >= b.streakTimes[b.streakNext]) {
          const slot = b.streakNext;
          b.streakNext += 1;
          // 主花的两条装饰细线位置固定、左右对称；其余场合仍按主花方向随机散开。
          emitStreak(b, b.sides ? (b.sides[slot] ?? 0) : streakDir());
        }
        if (!b.exploded && age >= (b.ascent ?? ASCENT) + PAUSE) explode(b);
      }
      const h = lastHead ? stepHead : null;
      stepParticles(h);
      stepWords();
      keepWordsAlive();
    }
    stepMask(dt);
  }


  // ---------- 贴图 ----------
  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function glowSprite(color, star) {
    const c = canvas(64, 64);
    const g = c.getContext('2d');
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
    return c;
  }

  // 单词贴图：圆润粗体（系统字体，不额外下载）。普通叠加：一圈淡深色描边 + 彩色柔光 + 实色字，
  // 浅色、深色背景下都能看清。清晰版用于本体，模糊版（低分辨率画再放大）用于残影。
  const WORD_FONT = "800 48px 'Arial Rounded MT Bold', 'Nunito', 'Avenir Next', system-ui, sans-serif";
  const wordSprites = new Map();

  function makeWordSprite(text, tone, scale) {
    const probe = canvas(4, 4).getContext('2d');
    if (!probe) return null;
    probe.font = WORD_FONT;
    // 四周留足的空白：光晕是模糊出来的，贴图边缘离字太近会被裁成直角，看起来像一个矩形。
    const pad = 56;
    const width = Math.ceil(finite(probe.measureText?.(text)?.width, text.length * 28)) + pad * 2;
    const height = 84 + pad * 2;
    const c = canvas(Math.max(8, Math.round(width * scale)), Math.round(height * scale));
    const g = c.getContext('2d');
    g.scale?.(scale, scale);
    g.font = WORD_FONT;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    // 两遍光晕：外层大而淡，内层小而亮，字周围是一团渐隐的雾，不是一圈边。
    g.shadowColor = `rgba(${PALETTE[tone]}, 0.55)`;
    g.shadowBlur = 48;
    g.fillStyle = `rgba(${PALETTE[tone]}, 0.9)`;
    g.fillText?.(text, width / 2, height / 2);
    g.shadowColor = `rgba(${PALETTE[tone]}, 0.9)`;
    g.shadowBlur = 20;
    // 描边更轻，主要靠光晕和后面的火星撑起轮廓。
    g.strokeStyle = 'rgba(40, 24, 48, 0.25)';
    g.lineWidth = 3;
    g.strokeText?.(text, width / 2, height / 2);
    g.shadowBlur = 0;
    g.fillStyle = `rgba(${PALETTE[tone]}, 1)`;
    g.fillText?.(text, width / 2, height / 2);
    // 字形采样点：扫描贴图的像素，取 24 个落在笔画上的点（只算一次），用于火星聚字和碎字。
    const points = [];
    try {
      const data = g.getImageData?.(0, 0, c.width, c.height)?.data;
      if (data) {
        const cand = [];
        const step = 5;
        for (let y = 0; y < c.height; y += step) {
          for (let x = 0; x < c.width; x += step) {
            if (data[(y * c.width + x) * 4 + 3] > 110) cand.push({ x: x / c.width, y: y / c.height });
          }
        }
        while (cand.length && points.length < 24) points.push(cand.splice(Math.floor(rand() * cand.length), 1)[0]);
      }
    } catch {
      // 没有 getImageData（测试环境）时就没有采样点，文字照常显示。
    }
    return { image: c, aspect: width / height, points };
  }

  function wordSprite(text, tone) {
    const key = `${tone}|${text}`;
    let s = wordSprites.get(key);
    if (!s) {
      const sharp = makeWordSprite(text, tone, 1);
      const soft = makeWordSprite(text, tone, 0.3);
      s = sharp && soft ? { sharp, soft } : null;
      wordSprites.set(key, s);
    }
    return s;
  }

  // 每种颜色三档贴图：饱和色、偏白、暗淡冷色（颜色冷却时交叉淡化）。
  function makeSprites() {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    const colors = PALETTE.map((color, i) => {
      const white = color.split(',').map((v) => Math.round(Number(v) * 0.4 + 255 * 0.6)).join(', ');
      return {
        glow: glowSprite(color, false),
        star: glowSprite(color, true),
        stages: [null, glowSprite(white, false), glowSprite(COOL[i], false)]
      };
    });
    colors.forEach((c) => { c.stages[0] = c.glow; });
    // 追光遮罩用的柔边椭圆：中心白、外圈渐变到透明。
    const spot = canvas(256, 256);
    const sg = spot.getContext('2d');
    const grad = sg.createRadialGradient(128, 128, 0, 128, 128, 128);
    // 亮的中心只占一小块，往外很长一段慢慢变暗，看起来像一盏柔光灯照着人，而不是一块边缘清楚的椭圆。
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.22, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.42, 'rgba(255, 255, 255, 0.78)');
    grad.addColorStop(0.6, 'rgba(255, 255, 255, 0.45)');
    grad.addColorStop(0.78, 'rgba(255, 255, 255, 0.18)');
    grad.addColorStop(0.9, 'rgba(255, 255, 255, 0.06)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    sg.fillStyle = grad;
    sg.fillRect(0, 0, 256, 256);
    colors.spotlight = spot;
    for (const text of mainWords) for (let tone = 0; tone < 3; tone += 1) wordSprite(text, tone);
    for (const text of fragmentWords) wordSprite(text, GOLD);
    return colors;
  }

  // 脸的范围内光粒和单词变得很淡，不挡住主播的脸。
  function faceFade(x, y) {
    if (!lastHead) return 1;
    const d = ((x - lastHead.cx) / (lastHead.rx * 0.8)) ** 2
      + ((y - lastHead.cy - lastHead.ry * 0.15) / (lastHead.ry * 0.72)) ** 2;
    return 0.15 + 0.85 * smooth(0.6, 1.2, d);
  }

  function stamp(ctx, sprite, x, y, radius, alpha) {
    if (!sprite || alpha <= 0.001) return;
    ctx.globalAlpha = Math.min(1, alpha * faceFade(x, y));
    ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
  }

  // 沿速度方向拉长的光粒：速度越快越长，减速后变回圆珠。
  function streakStamp(ctx, sprite, x, y, vx, vy, radius, stretch, alpha) {
    if (!sprite || alpha <= 0.001) return;
    const speed = Math.hypot(vx, vy);
    const len = 1 + stretch;
    const c = speed > EPS ? vx / speed : 1;
    const s = speed > EPS ? vy / speed : 0;
    ctx.globalAlpha = Math.min(1, alpha * faceFade(x, y));
    ctx.setTransform(c * len, s * len, -s, c, x, y);
    ctx.drawImage(sprite, -radius, -radius, radius * 2, radius * 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // 轨迹经过身体（头和肩膀椭圆）时画淡，看起来是从人背后升出来的。
  function occlusion(x, y) {
    const h = lastHead;
    if (!h) return 1;
    let d = Infinity;
    for (const shape of bodyShapes(h)) {
      const ex = (x - shape.cx) / shape.rx;
      const ey = (y - shape.cy) / shape.ry;
      d = Math.min(d, Math.hypot(ex, ey));
    }
    if (d < 1) return 0.45;
    if (d < 1.15) return 0.45 + 0.55 * ((d - 1) / 0.15);
    return 1;
  }

  function drawRocket(ctx, b, age) {
    if (age < 0) return;
    const spr = sprites[GOLD];
    const ascent = b.ascent ?? ASCENT;
    if (age < ascent) {
      const t = age / ascent;
      const head = rocketAt(b, t);
      if (!b.hasTrail) {
        // 头部发射的烟花保持原样：只有一个亮点，不带拖尾。
        stamp(ctx, spr.glow, head.x, head.y, b.unit * 0.012, 0.8);
        stamp(ctx, spr.star, head.x, head.y, b.unit * 0.016, 0.45 * Math.sin(Math.PI * t));
        return;
      }
      const inside = (x, y) => {
        const h = lastHead;
        if (!h) return false;
        return bodyShapes(h).some((shape) => ((x - shape.cx) / shape.rx) ** 2 + ((y - shape.cy) / shape.ry) ** 2 < 1);
      };
      // 从背后射出的拖尾：一串密集的小粒子（不是线），头密尾疏，横向抖动，经过身体时整颗不画。
      const span = 0.6;
      const steps = 28;
      for (let k = steps; k >= 0; k -= 1) {
        const tt = t - (k / steps) * span;
        if (tt < 0) continue;
        const q = rocketAt(b, tt);
        const jx = Math.sin(b.phase * 5 + k * 12.9898) * b.unit * 0.006;
        const jy = Math.cos(b.phase * 4 + k * 7.233) * b.unit * 0.004;
        const x = q.x + jx;
        const y = q.y + jy;
        if (inside(x, y)) continue;
        const along = 1 - k / steps;
        // 尺寸抖动用确定性噪声，draw 不能消耗随机数（否则同一帧画两次结果不同）。
        const size = b.unit * (0.0032 + 0.0022 * along) * (0.75 + 0.5 * (0.5 + 0.5 * Math.sin(k * 12.9 + b.phase)));
        stamp(ctx, sprites[GOLD].glow, x, y, size * 2.8, along * along);
      }
      stamp(ctx, spr.glow, head.x, head.y, b.unit * 0.016, 0.95);
      stamp(ctx, spr.star, head.x, head.y, b.unit * 0.02, 0.5 * Math.sin(Math.PI * t));
    } else if (age < ascent + PAUSE) {
      const k = (age - ascent) / PAUSE;
      stamp(ctx, spr.star, b.x, b.y, b.unit * (0.018 - k * 0.008), 0.9);
    } else if (age < ascent + PAUSE + 0.12) {
      const k = (age - ascent - PAUSE) / 0.12;
      stamp(ctx, sprites[WHITE].glow, b.x, b.y, b.R * (0.12 + 0.28 * k), (1 - k) * (1 - k) * 0.7);
      stamp(ctx, sprites[b.tone].glow, b.x, b.y, b.R * (0.3 + 0.45 * k), (1 - k) * 0.28);
    }
  }

  // 离脸越远越淡：1.7 个头半径以内不衰减，到 2.2 完全消失。
  function distanceFade(x, y, reach = null) {
    if (!lastHead) return 1;
    const r = reach ?? reachOf();
    const d = Math.hypot((x - lastHead.cx) / (lastHead.rx * r), (y - lastHead.cy) / (lastHead.ry * r));
    return 1 - smooth(1.7 / r, 1, d);
  }

  function drawParticle(ctx, p) {
    const t = p.age / p.life;
    const sprite = sprites[p.tone];
    if (p.poly) {
      const fade = (1 - t) ** 0.7;
      const alpha = p.strength * Math.min(1, p.age / 0.05) * fade;
      drawTrailLine(ctx, p, alpha, sprite);
      return;
    }
    const fade = p.kind === ASH ? Math.sin(Math.PI * Math.min(1, t)) : (1 - t) ** 0.7;
    const alpha = p.strength * Math.min(1, p.age / 0.035) * fade * (p.kind === ASH ? 1 : flicker(p.phase, p.age, t)) * distanceFade(p.x, p.y);
    const history = shortTrail(p.kind) ? Math.min(4, trailPoints) : trailPoints;
    const trailAlpha = p.kind === STREAK ? 0.55 : p.kind === PETAL ? 0.22 : 0.18;
    for (let j = 0; j < p.trailCount; j += 1) {
      const index = (p.trailIndex - p.trailCount + j + history) % history;
      const freshness = Math.max(0, 1 - (clock - p.tt[index]) / (p.kind === STREAK ? 0.3 : 0.22));
      stamp(ctx, sprite.glow, p.tx[index], p.ty[index], p.size * (1.6 + freshness * 1.2), alpha * freshness * freshness * trailAlpha);
    }
    const shrink = 1 - t * 0.45;
    if (p.kind === PETAL || p.kind === CRACKLE || p.kind === POP) {
      // 颜色冷却：饱和色 → 偏白 → 暗淡冷色，两档贴图交叉淡化。
      const [a, c, mix] = colorStage(t);
      const speed = Math.hypot(p.vx, p.vy) / p.unit;
      // 线性绽放和菊花丝线要固定拉长的光柱，其余按速度拉长。
      const stretch = p.kind === PETAL ? Math.max(Math.min(3, speed * 6), p.lineStretch ?? 0) : 0;
      const r = p.size * (p.kind === PETAL ? 3.8 : 3.4) * shrink;
      streakStamp(ctx, sprite.stages[a], p.x, p.y, p.vx, p.vy, r, stretch, alpha * (1 - mix));
      if (mix > 0.01) streakStamp(ctx, sprite.stages[c], p.x, p.y, p.vx, p.vy, r, stretch, alpha * mix);
      if (p.kind === PETAL && p.strength > 0.9 && t < 0.6) stamp(ctx, sprite.star, p.x, p.y, p.size * 5 * shrink, alpha * 0.7);
    } else if (p.kind === STREAK) {
      streakStamp(ctx, sprite.glow, p.x, p.y, p.vx, p.vy, p.size * 3.4, 1.6, alpha);
    } else if (p.kind === GLINT) {
      // 二次绽放的白色细亮线：又细又长，很快熄灭。
      streakStamp(ctx, sprite.glow, p.x, p.y, p.vx, p.vy, p.size * 3, 9 * (1 - t), alpha);
    } else if (p.kind === CONTACT) {
      stamp(ctx, sprite.glow, p.x, p.y, p.size * 4.8, alpha);
      stamp(ctx, sprite.star, p.x, p.y, p.size * 5.5, alpha * 0.7);
    } else if (p.kind === ASH) {
      // 余烬用暖金色，带明显闪烁，在浅色背景上也看得见。
      // 余烬用偏橙的金色、稍大、带闪烁；浅色背景上也能看出一点暖光。
      stamp(ctx, sprites[0].glow, p.x, p.y, p.size * 4.4, Math.min(1, alpha * 1.4) * (0.65 + 0.35 * Math.sin(p.phase + p.age * 14)));
    } else {
      stamp(ctx, sprite.glow, p.x, p.y, p.size * 3.6 * shrink, alpha);
    }
  }

  function drawWord(ctx, w) {
    const spr = wordSprite(w.text, w.tone);
    if (!spr) return;
    const t = w.age / w.life;
    const dissolveAt = w.life - WORD_DISSOLVE;
    const pose = wordPose(w, w.age, spr.sharp.aspect);
    const inK = smooth(0, WORD_ENTRY, w.age);
    // 消散段：缩小按整段走，变淡提前到 1.5 秒结束，最后一段时间只剩火星在飘。
    const outK = smooth(dissolveAt, w.life, w.age);
    const fadeK = smooth(dissolveAt + 0.08, w.life - 0.10, w.age);
    // 入场先用模糊贴图，放大时慢慢对焦到清晰版：小字像从光里“浮”出来，不是突然贴上去。
    const sharpK = smooth(0.02, 0.26, w.age);
    // 字本身不闪烁：字号大，闪烁会被看成卡顿/频闪；末段的闪烁交给散出去的火星。
    const alpha = inK * (1 - fadeK) * (w.alpha ?? 1) * distanceFade(w.x, w.y);
    const h = pose.h;
    const width = pose.width;
    const pts = spr.sharp.points ?? [];
    const sparkR = h * 0.055;
    // 词本身也在画布镜像坐标里，先设好变换，火星和字在同一坐标系。
    ctx.setTransform(-pose.cos, -pose.sin, -pose.sin, pose.cos, w.x, w.y);
    const spark = (lx, ly, a, r = sparkR) => {
      if (a <= 0.01) return;
      ctx.globalAlpha = Math.min(1, a);
      ctx.drawImage(sprites[GOLD].glow, lx - r, ly - r, r * 2, r * 2);
    };
    // 出现：火星从外围向笔画聚拢，字在火星落位的过程中浮出来。
    if (pts.length && w.age < 0.62) {
      const n = Math.min(pts.length, 14);
      for (let k = 0; k < n; k += 1) {
        const delay = (k / n) * 0.14;
        const u = smooth(delay, delay + 0.34, w.age);
        if (u <= 0 || u >= 1) continue;
        const pt = pts[(k * 5 + 3) % pts.length];
        const dx = pt.x - 0.5;
        const dy = pt.y - 0.5;
        const out = 1 + 0.7 * (1 - u);
        spark(dx * width * out, dy * h * out, 0.75 * (1 - u) + 0.1, sparkR * (0.9 - 0.25 * u));
      }
    }
    // 停留：放大结束到消散开始，每帧从笔画上飘出几颗火星，作为“要散了”的预兆。
    if (pts.length && w.age >= WORD_GROW_END && w.age < dissolveAt) {
      for (let k = 0; k < 3; k += 1) {
        const pt = pts[Math.floor((w.age * 9 + k * 3.7) * 13) % pts.length];
        const lx = (pt.x - 0.5) * width;
        const ly = (pt.y - 0.5) * h;
        const ph = w.age * 16 + k;
        spark(lx + Math.cos(ph) * h * 0.09, ly + Math.sin(ph * 0.8) * h * 0.09, 0.5 * (1 - t), sparkR * 0.6);
      }
    }
    // 消散时的火星由 stepWords 生成真实粒子（会参与碰撞），这里不再画假火星。
    // 本体：模糊版和清晰版交叉淡化；本来就是虚词（blur）的全程用模糊版。
    if (w.blur || sharpK >= 0.999) {
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.drawImage((w.blur ? spr.soft : spr.sharp).image, -width / 2, -h / 2, width, h);
    } else {
      ctx.globalAlpha = Math.min(1, alpha * (1 - sharpK));
      if (ctx.globalAlpha > 0.002) ctx.drawImage(spr.soft.image, -width / 2, -h / 2, width, h);
      ctx.globalAlpha = Math.min(1, alpha * sharpK);
      if (ctx.globalAlpha > 0.002) ctx.drawImage(spr.sharp.image, -width / 2, -h / 2, width, h);
    }
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // effectNow / width 只为兼容宿主签名；生命周期、闪烁相位全部用内部 update 时钟。
  // 追光遮罩：以头部和肩膀椭圆为亮区，只在亮区以外压暗，椭圆边缘一圈柔和过渡；脸的位置完全不动。
  // 不用分割模型：椭圆遮罩烘焙成一张随头位置变化的贴图，每帧按当前头部位置刷新。
  // 亮区 = 椭圆外扩 soft 个像素后整块填白，再用渐变把外圈淡出去；只在大笑烟花期间生效，停止后完全不画。
  // 亮度贴图按 1/4 分辨率画（宽高各 1/4），再用 destination-out 放大贴到画面上：
  // 放大让边缘更柔，画布也小 16 倍。坐标统一换成贴图坐标。
  const MASK_SCALE = 4;
  let maskCanvas = null;
  let maskCtx = null;
  let darkCanvas = null;
  let darkCtx = null;
  function ensureMask(w, h) {
    const mw = Math.max(2, Math.ceil(w / MASK_SCALE));
    const mh = Math.max(2, Math.ceil(h / MASK_SCALE));
    if (!maskCanvas) {
      maskCanvas = canvas(mw, mh);
      maskCtx = maskCanvas.getContext('2d');
    } else if (maskCanvas.width !== mw || maskCanvas.height !== mh) {
      maskCanvas.width = mw;
      maskCanvas.height = mh;
    }
    return maskCtx;
  }

  // 亮区贴图：取一张柔边的椭圆光斑贴图，按身体范围拉到合适大小铺一张；
  // 椭圆边缘的平滑过渡来自贴图本身的渐变，不需要逐帧做模糊，快很多。
  function paintMask(w, h) {
    const g = ensureMask(w, h);
    if (!g || !headBox) return null;
    const mw = maskCanvas.width;
    const mh = maskCanvas.height;
    const k = mw / w;
    // 第一步：在这张小画布上画出亮区（头部和肩膀的柔边椭圆）。
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, mw, mh);
    const [head, shoulders] = bodyShapes(headBox);
    // 亮区贴图铺得比人本身大一圈，过渡才有足够长的距离，不会在人身边形成一圈清楚的“屏幕边”。
    const x0 = Math.min(head.cx - head.rx * 2.0, shoulders.cx - shoulders.rx * 1.1) * k;
    const x1 = Math.max(head.cx + head.rx * 2.0, shoulders.cx + shoulders.rx * 1.1) * k;
    const y0 = (head.cy - head.ry * 1.9) * k;
    const y1 = (shoulders.cy + shoulders.ry * 1.1) * k;
    g.drawImage(sprites.spotlight, x0, y0, x1 - x0, y1 - y0);
    // 第二步：在另一张小画布上铺半透明黑，再把亮区挖掉，得到“只在椭圆以外压暗”的贴图。
    // 必须单独合成：直接在画面上挖会把已经画好的照片一起擦掉，人变成暗色剪影。
    if (!darkCanvas) {
      darkCanvas = canvas(mw, mh);
      darkCtx = darkCanvas.getContext('2d');
    } else if (darkCanvas.width !== mw || darkCanvas.height !== mh) {
      darkCanvas.width = mw;
      darkCanvas.height = mh;
    }
    darkCtx.setTransform(1, 0, 0, 1, 0, 0);
    darkCtx.globalCompositeOperation = 'source-over';
    darkCtx.globalAlpha = 1;
    darkCtx.clearRect(0, 0, mw, mh);
    darkCtx.fillStyle = `rgba(8, 10, 20, ${Math.min(1, darken * maskLevel).toFixed(3)})`;
    darkCtx.fillRect(0, 0, mw, mh);
    // 暗角：四角比中间再深约 10%，视线更集中。
    const vig = darkCtx.createRadialGradient(mw / 2, mh / 2, Math.min(mw, mh) * 0.25, mw / 2, mh / 2, Math.max(mw, mh) * 0.62);
    vig.addColorStop(0, 'rgba(6, 8, 16, 0)');
    vig.addColorStop(1, 'rgba(6, 8, 16, 0.10)');
    darkCtx.fillStyle = vig;
    darkCtx.fillRect(0, 0, mw, mh);
    darkCtx.globalCompositeOperation = 'destination-out';
    darkCtx.drawImage(maskCanvas, 0, 0);
    return darkCanvas;
  }

  // 更新遮罩强度：第一朵烟花出现时渐入，之后持续大笑超过 holdMax 秒降到 lowLevel；最后一朵消散后渐出。
  function stepMask(dt) {
    if (bursts.length) lastFireAt = clock;
    const active = clock - lastFireAt < 0.15;
    const target = active ? (Math.max(0, clock - lastFireAt) < holdMax ? 1 : lowLevel) : 0;
    const rate = target > maskLevel ? dt / fadeIn : dt / fadeOut;
    maskLevel = target > maskLevel ? Math.min(target, maskLevel + rate) : Math.max(target, maskLevel - rate);
  }

  function draw(ctx, _effectNow, _width, w = lastRegion.width, h = lastHeight) {
    if (!bursts.length && !count && !wordCount && maskLevel <= 0.005) return;
    if (!sprites) sprites = makeSprites();
    if (!sprites) return;
    ctx.save();
    try {
      if (maskLevel > 0.005 && headBox) {
        const shade = paintMask(w, h);
        if (shade) {
          // 压暗层已在单独的画布上挖出追光椭圆：椭圆以内（头部和肩膀）完全不压暗，外圈柔和过渡。
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          ctx.drawImage(shade, 0, 0, shade.width, shade.height, 0, 0, w, h);
        }
      }
      ctx.globalCompositeOperation = 'lighter';
      for (const b of bursts) drawRocket(ctx, b, clock + carry - b.start);
      for (let i = 0; i < count; i += 1) drawParticle(ctx, pool[i]);
      // 浅色背景下“变亮”叠加会把颜色冲成白色：主花、小花的光粒再用普通叠加补一层小而淡的实色芯，保住颜色。
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < count; i += 1) {
        const p = pool[i];
        if (p.kind !== PETAL && p.kind !== CRACKLE && p.kind !== POP) continue;
        const t = p.age / p.life;
        const [a] = colorStage(t);
        stamp(ctx, sprites[p.tone].stages[a], p.x, p.y, p.size * 2.2 * (1 - t * 0.45), p.strength * 0.35 * (1 - t) * flicker(p.phase, p.age, t));
      }
      // 单词用普通叠加：浅色背景下不会被“变亮”冲成白色。
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < wordCount; i += 1) drawWord(ctx, words[i]);
    } finally {
      ctx.restore();
    }
  }

  function clear() {
    bursts.length = 0;
    count = wordCount = collisions = nextId = nextVolley = 0;
    clock = carry = 0;
    lastHead = null;
    lastMain = null;
    lastRegion = { left: 0, width: 540, top: 0, height: 960 };
    lastHeight = 960;
    lastFireAt = -Infinity;
    maskLevel = 0;
    headBox = null;
    // 词的独立节拍也要复位，否则 clear 之后第一轮词的出现时间会和新建实例不同。
    wordStarted = false;
    wordSlot = 0;
    wordPairAt = -Infinity;
    volleySeq = 0;
    satelliteSlot = 0;
    mainIndex = 0;
    droopCounter = 0;
    wordTierCurrent = 0;
  }


  return {
    launch, launchVolley, launchMain, launchMid, launchSmall, launchAux, update, draw, clear,
    // 帧率降级：1 = 完整；越小中花、辅助烟花、二次绽放、碎词越少。
    setQuality(q) { quality = Math.min(1, Math.max(0.3, finite(q, 1))); },
    // 按画面亮度设置追光遮罩的最大压暗量（0 = 不压暗）。亮背景多压，暗背景少压或不压。
    setDarken(d) { darken = Math.min(0.85, Math.max(0, finite(d, 0.4))); },
    // 脸的占比越大，reach 越小：同样的规则在摄像头里也不会飞出画面。
    setReach(r) { reachOverride = Math.min(2.4, Math.max(1.2, finite(r, 0))); },
    get maskLevel() { return maskLevel; },
    get darken() { return darken; },
    get quality() { return quality; },
    get burstCount() { return bursts.length; },
    // 同屏有几轮（同一轮的几颗算一轮）。
    get volleyCount() { return new Set(bursts.map((b) => b.volley)).size; },
    get particleCount() { return count; },
    get wordCount() { return wordCount; },
    get collisionCount() { return collisions; },
    // 测试用：当前光粒、单词和每颗烟花的快照。
    snapshot() {
      return {
        particles: pool.slice(0, count).map((p) => ({ kind: p.kind, x: p.x, y: p.y, vx: p.vx, vy: p.vy, tone: p.tone, fate: p.fate, age: p.age, life: p.life, stretch: p.lineStretch ?? 0, poly: p.poly === true })),
        words: words.slice(0, wordCount).map((w) => ({
          text: w.text, main: w.main, born: w.born, x: w.x, y: w.y, size: w.size, age: w.age, life: w.life,
          dissolve: w.dissolvePlan ? w.dissolvePlan.length : 0, emitted: w.dissolveNext ?? 0
        })),
        shells: bursts.map((b) => ({ x: b.x, y: b.y, big: b.big, size: b.size, style: b.style, exploded: b.exploded, volley: b.volley }))
      };
    }
  };
}

export const KINDS = Object.freeze({ PETAL, CRACKLE, STREAK, EMBER, POP, SPARK, CONTACT, GLINT, ASH });
export { colorStage };
export default createFireworks;
