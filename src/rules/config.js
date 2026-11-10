// 所有阈值都是初始值，真人测试后再调。
export const RULES = Object.freeze({
  detectionIntervalMs: 50,
  brightnessSampleMs: 1000,
  smile: { enter: 0.5, exit: 0.35 },
  // 大笑：嘴角上扬更高 + 眯眼 + 不皱眉 +（嘴张得大 或 上排牙露出来）。
  // 嘴唇间距 = 上下嘴唇内侧距离 ÷ 额头到鼻尖距离；上唇上提 = mouthUpperUp，反映上排牙是否露出。
  // 依据（2026-11-08 实测）：大笑皱眉最高 0.22，哭脸录制 0.19–0.46；哭脸嘴角多在 0.53–0.77。
  laugh: {
    smileMin: 0.68,
    squintMin: 0.52,
    browDownMax: 0.25,
    lipGapMin: 0.28,
    upperUpMin: 0.6,
    exitSmile: 0.6,
    exitLipGap: 0.22,
    exitUpperUp: 0.5
  },
  mouth: { openMin: 0.12 },
  jaw: { yawn: 0.6 },
  hold: { smileMs: 200, laughMs: 300 },
  smoothing: { tauMs: 100 },
  calibration: {
    durationMs: 2000,
    maxSmileBaseline: 0.3,
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
  fireworks: { intervalMs: 800, maxConcurrent: 3, lifetimeMs: 1600 },
  // 祝福之雨：头顶轻雨 + 局部彩虹，只在头部周围发生。时间单位毫秒。
  rain: {
    maxDrops: 150,
    maxSparkles: 48,
    maxSplashes: 48,
    sparkleChance: 0.35,
    sparkleMs: 480,
    dropsPerSecond: 80,
    startLevel: 0.25,
    openLevel: 0.25,
    rampMs: 1500,
    glowInMs: 250,
    decayMs: 400,
    laughDecayMs: 150,
    fadeMs: 800,
    laughFadeMs: 350,
    afterglowMs: 900,
    afterglowMotes: 8,
    // 彩虹生命周期：持续微笑约 600ms 后浮现，微笑结束后柔和消退
    rainbowDelayMs: 600,
    rainbowFadeInMs: 800,
    rainbowFadeOutMs: 1000,
    // 下落速度与头部周围分布
    fallSpeed: [0.75, 1.1],
    farSpeed: [0.45, 0.7],
    farShare: 0.35,
    beadRadius: [0.007, 0.014],
    slant: 0.04,
    aroundHead: 0.88,
    spread: 1.6,
    collarFadeDepth: 1.6,
    collideDepth: 0.4
  },
  head: { followMs: 60, holdMs: 300 }
});
