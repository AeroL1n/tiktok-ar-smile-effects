// 所有阈值都是初始值，真人测试后再调。
export const RULES = Object.freeze({
  detectionIntervalMs: 50,
  brightnessSampleMs: 1000,
  // 2026-11-11 真机：闭口微笑原始读数约 0.68，扣除开场基线 0.30 后只剩 0.38，达不到 0.5。
  // 门槛放宽到 0.36 / 0.25（比实测 0.38 再留一点余量，平滑后会有波动）；仍要求保持 0.2 秒，避免说话时误触发。
  // 2026-11-12：现场反馈微笑不好触发，从 0.36 / 0.25 放宽到 0.32 / 0.22。
  smile: { enter: 0.32, exit: 0.22 },
  // 大笑：嘴角上扬更高 + 眯眼 + 不皱眉 +（嘴张得大 或 上排牙露出来）。
  // 嘴唇间距 = 上下嘴唇内侧距离 ÷ 额头到鼻尖距离；上唇上提 = mouthUpperUp，反映上排牙是否露出。
  // 依据（2026-11-08 实测）：大笑皱眉最高 0.22，哭脸录制 0.19–0.46；哭脸嘴角多在 0.53–0.77。
  // 2026-11-11：用力大笑的照片皱眉读到 0.276，上限从 0.25 放宽到 0.30（用户确认）。
  laugh: {
    // 2026-11-12：面试官现场难触发，大笑门槛大幅下调（原来是 0.68 / 0.52）。
    smileMin: 0.5,
    // 2026-11-12 二次放宽（现场截图：嘴唇间距 0.19、上唇上提 0.54 仍判成微笑）：
    // 上唇上提 0.60 → 0.52；眯眼 0.45 → 0.44（再低会把露齿笑判成大笑）；嘴唇间距保持 0.26（再低哭脸会误判，录制回放验证过）。
    squintMin: 0.44,
    browDownMax: 0.3,
    lipGapMin: 0.26,
    // 靠上唇上提判断张嘴时，同时要求下巴有一点张开，避免说话时的上唇动作被当成大笑。
    jawWithUpperUp: 0.05,
    jawWithUpperUpMax: 0.22,
    // 备用入口（2026-11-11 真人照片）：嘴角很高、下巴明显张开、嘴唇间距不大，眯眼可以略低于主入口。
    // 主入口不动，保证录制回放里哭脸、边笑边说话、露齿笑、轻笑都不放烟花。
    wideSmile: 0.85,
    wideJaw: 0.2,
    wideLipGap: 0.12,
    wideSquint: 0.44,
    upperUpMin: 0.52,
    exitSmile: 0.6,
    exitLipGap: 0.22,
    exitUpperUp: 0.5
  },
  mouth: { openMin: 0.12 },
  jaw: { yawn: 0.6 },
  hold: { smileMs: 200, laughMs: 250 },
  smoothing: { tauMs: 100 },
  calibration: {
    durationMs: 2000,
    // 校准时在笑会把基线吃到上限、把大笑吃掉；封顶 0.2，最多只扣 0.2。
    maxSmileBaseline: 0.2,
    maxJawBaseline: 0.2,
    maxSampleGapMs: 200
  },
  faceSelection: {
    switchRatio: 1.2,
    switchHoldMs: 500,
    matchDistance: 0.2,
    reacquireMs: 500
  },
  faceLost: { holdMs: 500, resetMs: 1000 },
  quality: { minFaceWidth: 0.15, maxYawDeg: 35, minBrightness: 50 },
  // 烟花：调度器和香槟礼花共用同一个寿命，保证“同屏最多 3 发”两边算法一致。
  fireworks: {
    intervalMs: 800,
    maxConcurrent: 3,
    lifetimeMs: 2400,
    // 按参考录屏的调度：主花只在进入大笑时放，之后有冷却；持续大笑期间由小装饰接力，不再连续放大主花。
    mainCooldownMs: 3200,
    mainFadeGapMs: 1500,
    auxIntervalMs: 450,
    midIntervalMs: 1500,
    smallIntervalMs: 600,
    // 一“发”是一轮齐射：完整一轮 1 朵大花 + 2 朵中花，轻量一轮 2 朵中花。
    // 每次大笑的第 1 轮是完整的，之后每 fullEvery 轮一次，画面不会越来越满。同屏最多 maxConcurrent 轮、maxShells 颗。
    fullEvery: 3,
    maxShells: 9,
    // 布局：big / mid 是大花、中花的绽放半径（可见画面宽度的比例）；sectors 是五个方向（度，0 = 正上方）；
    // spread：每颗在扇区里的随机偏移；gap：同一轮里相邻两颗的间隔（秒）；rotateStep：放不进画面时每次往上转的角度。
    // 烟花品种：大花在几种形态里轮换（连续两轮不重复），中花、小花用最便宜的球形。
    // sphere 球形、spiral 旋转上升 + 旋臂。后续加 lines 线性、chrys 菊花丝线。
    // 权重：球形是主力（和改之前一样），其余三种只是偶尔出现的点缀；中花、小花始终用球形。
    styles: {
      big: { sphere: 1 },
      // 特殊品种的绽放半径比球形小一档，避免整屏开花。
      specialScale: 0.76,
      mid: { sphere: 1 },
      small: { sphere: 1 }
    },
    volley: { big: 0.17, mid: 0.11, small: 0.07, sectors: [-90, -48, 0, 48, 90], spread: 14, gap: [0.15, 0.3], rotateStep: 8,
      // 绽放点最多离脸中心 maxOffset 个头半径，保证所有烟花（包括小花）都在脸周围。
      maxOffset: 1.6 },
    // 光粒和单词的最远距离（头半径倍数）：超过就贴着这个边界停住，不会飞到画面边角。
    contain: { reach: 2.2, wordReach: 2.0 },
    // 单词：按大笑持续的时间升档（fromMs 起），只用英文。直播里大笑多是被弹幕逗笑、翻车自嘲、连麦 PK、收到礼物，
    // 共同点是“笑得停不下来”，所以只写笑声和笑的程度，不写具体事件。不用含粗口的 LMAO、不用 emoji；词表可按地区替换。
    words: {
      tiers: [
        { fromMs: 0, words: ['HAHA', 'hehe'] },
        { fromMs: 3000, words: ['LOL', 'HAHAHA'] },
        { fromMs: 8000, words: ["I'M DEAD", "can't stop"] }
      ],
      fragments: ['ha', 'lol'],
      // 字母三档字号（相对之前的大小）；透明度有起伏；约三分之一用模糊贴图，看起来更远更虚。
      // 三档字号 + 三档透明度一一对应（大=实、小=虚），同一轮里的两个词一定用不同档位。
      // 主词三档占画面宽度的比例；碎词单独小一档。
      sizes: [0.18, 0.12, 0.12],
      fragmentSizes: [0.12, 0.12, 0.12],
      alphas: [0.95, 0.6, 0.6],
      // 手机上的最小可读高度（占画面宽度的比例），低于这个尺寸不出小词。
      minReadable: 0.045,
      blurChance: 0.33
    }
  },
  // 祝福之雨 v3：头部水雾 + 雾里的彩虹 + 从雾里落下的轻雨，只在头部周围发生，脸部保持清楚。时间单位毫秒。
  // 长度单位：rx / ry 是头部椭圆的横、纵半径（盖住头发，rx 约为 0.64 倍脸宽），效果随离镜头远近一起缩放。
  // 避免“像冒汗”：雨不贴着脸和耳朵竖直往下，而是在头外侧的空气里落下、过了头顶高度后向两侧弯开；脸上不画任何水滴；不从头发里冒出来。
  rain: {
    maxDrops: 90,
    maxSplashes: 40,
    maxMotes: 10,
    // 每秒生成的雨（三种形态合计）。开场先起雾 mistLeadMs，再按 openLevel 落几颗（40 × 0.25 × 0.4 秒 = 4 颗），
    // 再用 spreadMs 展开成轻雨，之后保持不变，不持续加密。生成间隔有 ±spawnJitter 的随机。
    dropsPerSecond: 40,
    spawnJitter: 0.4,
    mistLeadMs: 300,
    openMs: 400,
    openLevel: 0.25,
    spreadMs: 700,
    // 收尾期间再次微笑：resumeMs 内回到轻雨。
    resumeMs: 300,
    // 收尾：decayMs 内停止生成；tailMs 后整段结束（已有雨滴落完），之后再微笑就重新开场。
    decayMs: 350,
    tailMs: 3200,
    // glow 是水雾：起得最快、散得最慢。
    glowInMs: 300,
    glowOutMs: 1800,
    rainbowDelayMs: 700,
    rainbowInMs: 1000,
    rainbowOutMs: 900,
    // 转入大笑：快速收住，让烟花当主角。
    cutDecayMs: 150,
    cutFadeMs: 350,
    cutTailMs: 400,
    // 人脸丢失：雾、彩虹在 lostFadeMs 内淡出，不再生成新雨滴。
    lostFadeMs: 500,
    // 生成区（“雨云”）：头顶上方 zoneBottom–zoneTop 个 ry；横向 ±zoneHalfWidth 个 rx。
    zoneTop: 1.0,
    zoneBottom: 0.1,
    zoneHalfWidth: 1.75,
    // 横向分布：centerShare 落在头顶正上方（会落到头发上溅水花），其余从头发轮廓外侧（sideInner–zoneHalfWidth 个 rx）落过，不贴着耳朵。
    centerShare: 0.45,
    sideInner: 1.03,
    // 三种形态：bead 珠串雨线（一根淡线串 2–4 颗珠子），drop 单颗雨滴（圆珠和小泪滴混合），fine 远景小雨丝（人物身后，不碰撞）。
    // speed：下落速度，每秒几个 ry（每秒约 0.85–1.35 个头高，每颗从出生到消失约 1.2–1.8 秒）；size：最大那颗珠子的半径，几个 rx；alpha：亮度。
    forms: {
      bead: { share: 0.25, speed: [2.2, 2.7], size: [0.026, 0.036], alpha: 0.9 },
      drop: { share: 0.45, speed: [2.0, 2.6], size: [0.014, 0.03], alpha: 0.85 },
      fine: { share: 0.3, speed: [1.7, 2.1], size: [0, 0], alpha: 0.32 }
    },
    // 珠串雨线：线长 beadLine 个 ry，串 2–4 颗珠子，从下往上越来越小。
    beadLine: [0.32, 0.5],
    // 单颗雨滴里泪滴形的比例（其余是圆珠）；浅青色的比例（其余是白色）。
    teardropShare: 0.5,
    tealShare: 0.45,
    // 每颗雨滴自己的倾斜，±slant 弧度（约 ±6°）。
    slant: 0.1,
    // 从雾里落出来：生成后 clearAfter 个 ry 的距离内由小、淡逐渐变清楚。
    clearAfter: 0.3,
    // 淡出：落在肩膀范围里的雨要真的落到肩上才处理，淡出线放在肩线以下 shoulderFade 个 ry（通常先碰到肩膀）；
    // 落在肩膀外侧的雨继续往下，从头部中心往下 outerFadeFrom 个 ry 开始变淡，到可见画面底部消失。
    shoulderFade: [0.35, 0.7],
    outerFadeFrom: 2.0,
    // 肩膀的判定带：估算的肩线可能偏，每颗雨在肩线上下 ±shoulderBand 个 ry 之间随机取一个落点，偏差不大时看起来仍是落在肩上。
    shoulderBand: 0.14,
    // 脸部保护：脸的椭圆内不画雨，外面 faceBand 个 rx 的渐变过渡。
    faceBand: 0.25,
    // 落到头发上：hairSplash 溅起 2–3 颗微小水珠，hairStar 闪一颗小星星，其余被吸收。
    hairSplash: 0.5,
    hairStar: 0.15,
    // 落到肩膀上：shoulderBreak 碎成 2 颗小珠往两边弹开，shoulderSlide 顺着肩线往外滑约 slideDistance 个 rx 再淡出，其余（约 15%）被吸收。
    shoulderBreak: 0.45,
    shoulderSlide: 0.4,
    slideMs: 650,
    slideDistance: 0.62,
    splashMs: 300,
    starMs: 420,
    // 收尾时沿头顶轮廓升起几颗淡淡的余光。
    afterglowMs: 900,
    afterglowMotes: 3,
    // 水雾：罩住头的竖向椭圆（宽 ±width 个 rx，高 ±height 个 ry，中心在头顶上方 lift 个 ry），滤色叠加；脸的位置挖空。
    // 水汽光点：同屏最多 maxMotes 颗，很小、很慢地飘。
    mist: {
      width: 2.1,
      height: 1.9,
      lift: 0.95,
      alpha: 0.22,
      followMs: 300
    },
    // 彩虹：在雾里，用两个端点定位，贴着头顶（按屏幕上看到的样子，镜像在绘制时处理）。
    // left / right：[横向几个 rx（正数在屏幕右边），相对头顶几个 ry（负数在头顶上方）]。
    // 左端在头顶中线略偏左、头发上方约 0.15 个头高；右端落在右侧太阳穴上方的头发轮廓上。spanDeg：弧对应的圆心角。
    // band：色带宽度（几个 rx）。screenAlpha：滤色叠加；solidAlpha：普通叠加（亮背景下保住颜色）。
    rainbow: {
      left: [-0.15, -0.3],
      right: [0.9, 0.42],
      spanDeg: 80,
      band: 0.24,
      screenAlpha: 0.62,
      solidAlpha: 0.1,
      breath: 0.05,
      followMs: 260
    }
  },
  head: { followMs: 60, holdMs: 300 }
});
