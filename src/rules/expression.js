function emaAlpha(dt, tauMs) {
  return dt <= 0 ? 1 : 1 - Math.exp(-dt / tauMs);
}

// 表情状态机：基线校准 → 平滑 → 判定。输入是选中那张脸的原始系数，输出当前状态和提示。
export function createExpressionMachine(cfg) {
  let phase;
  let state;
  let baseline;
  let calib;
  let smooth;
  let lastTickAt;
  let lostSince;
  let holdTarget;
  let holdSince;

  function reset() {
    phase = 'calibrating';
    state = 'idle';
    baseline = null;
    calib = { elapsed: 0, smile: 0, jaw: 0, weight: 0, lastAt: null };
    smooth = null;
    lastTickAt = null;
    lostSince = null;
    holdTarget = null;
    holdSince = null;
  }

  function setState(next, now) {
    const prev = state;
    state = next;
    holdTarget = null;
    holdSince = null;
    return prev !== next ? { from: prev, to: next, at: now } : null;
  }

  function calibrationProgress() {
    return Math.min(1, calib.elapsed / cfg.calibration.durationMs);
  }

  function snapshot(extra) {
    return {
      phase,
      state,
      baseline,
      calibrationProgress: calibrationProgress(),
      signals: smooth ? { ...smooth } : null,
      transition: null,
      faceStatus: 'ok',
      hint: '',
      reason: '',
      ...extra
    };
  }

  function updateCalibration(raw, now) {
    const dt = calib.lastAt === null ? 0 : Math.min(now - calib.lastAt, cfg.calibration.maxSampleGapMs);
    calib.lastAt = now;
    calib.elapsed += dt;
    calib.smile += raw.smile;
    calib.jaw += raw.jaw;
    calib.weight += 1;
    if (calib.elapsed >= cfg.calibration.durationMs) {
      baseline = {
        smile: Math.min(calib.smile / calib.weight, cfg.calibration.maxSmileBaseline),
        jaw: Math.min(calib.jaw / calib.weight, cfg.calibration.maxJawBaseline)
      };
      phase = 'running';
      smooth = null;
    }
  }

  function updateSmoothing(raw, now) {
    const adjusted = {
      smile: Math.max(0, raw.smile - baseline.smile),
      jaw: Math.max(0, raw.jaw - baseline.jaw),
      lipGap: Number.isFinite(raw.lipGap) ? raw.lipGap : 0,
      squint: raw.squint ?? 0,
      upperUp: raw.upperUp ?? 0,
      browDown: raw.browDown ?? 0
    };
    if (!smooth) {
      smooth = adjusted;
    } else {
      const a = emaAlpha(now - lastTickAt, cfg.smoothing.tauMs);
      for (const key of Object.keys(adjusted)) smooth[key] += a * (adjusted[key] - smooth[key]);
    }
  }

  // 只往上升级的目标要先保持一段时间；往下退出立即生效。
  function holdFor(target, ms, now) {
    if (holdTarget !== target) {
      holdTarget = target;
      holdSince = now;
    }
    return now - holdSince >= ms;
  }

  function mouthOpenForLaugh(s) {
    return s.lipGap >= cfg.laugh.lipGapMin || s.upperUp >= cfg.laugh.upperUpMin;
  }

  function isLaugh(s) {
    const l = cfg.laugh;
    return s.smile >= l.smileMin && s.squint >= l.squintMin && s.browDown < l.browDownMax && mouthOpenForLaugh(s);
  }

  function explain(s) {
    const { smile, jaw, mouth, laugh } = cfg;
    if (s.smile < smile.enter && s.jaw >= jaw.yawn) return '嘴张得很大但没有笑（像打哈欠），不触发';
    if (s.smile < smile.enter && s.lipGap >= mouth.openMin) return '嘴张开但没有笑，不触发';
    if (s.smile < smile.enter) return '嘴角上扬不够';
    if (!mouthOpenForLaugh(s)) return '';
    if (s.browDown >= laugh.browDownMax) return '皱着眉，不像大笑，只下雨';
    if (s.smile < laugh.smileMin) return '嘴张开了，但嘴角上扬不够大笑';
    if (s.squint < laugh.squintMin) return '嘴张开了，但眼睛没有眯起，不算大笑';
    return '';
  }

  function decide(now, allowUpgrade) {
    const s = smooth;
    const { smile, laugh, hold } = cfg;
    const laughCond = isLaugh(s);
    const smileCond = s.smile >= smile.enter;

    if (state === 'laugh') {
      if (s.smile < smile.exit) return { transition: setState('idle', now), reason: '' };
      const mouthClosing = s.lipGap < laugh.exitLipGap && s.upperUp < laugh.exitUpperUp;
      if (s.smile < laugh.exitSmile || mouthClosing) return { transition: setState('smile', now), reason: '' };
      return { transition: null, reason: '' };
    }

    if (state === 'smile' && s.smile < smile.exit) {
      return { transition: setState('idle', now), reason: explain(s) };
    }

    if (!allowUpgrade) {
      holdTarget = null;
      return { transition: null, reason: '画面条件不满足，暂停新触发' };
    }

    if (laughCond) {
      if (holdFor('laugh', hold.laughMs, now)) return { transition: setState('laugh', now), reason: '' };
      return { transition: null, reason: '大笑保持中…' };
    }

    if (state === 'idle' && smileCond) {
      if (holdFor('smile', hold.smileMs, now)) return { transition: setState('smile', now), reason: '' };
      return { transition: null, reason: '微笑保持中…' };
    }

    holdTarget = null;
    return { transition: null, reason: explain(s) };
  }

  // input: { now, face: { smile, jaw, lipGap, squint, upperUp, browDown } | null, quality: { ok, message } }
  function update({ now, face, quality = { ok: true, message: '' } }) {
    if (!face) {
      lostSince ??= now;
      holdTarget = null;
      const lostMs = now - lostSince;
      lastTickAt = now;
      if (lostMs >= cfg.faceLost.resetMs) {
        const transition = state !== 'idle' ? setState('idle', now) : null;
        smooth = null;
        return snapshot({ transition, faceStatus: 'lost', hint: '没有检测到人脸，请正对镜头', reason: '没有人脸' });
      }
      const hint = lostMs >= cfg.faceLost.holdMs ? '没有检测到人脸，请正对镜头' : '';
      return snapshot({ faceStatus: 'lost_hold', hint, reason: '人脸短暂丢失，保持当前状态' });
    }

    if (lostSince !== null && now - lostSince >= cfg.faceLost.holdMs) smooth = null;
    lostSince = null;

    if (phase === 'calibrating') {
      lastTickAt = now;
      if (!quality.ok) {
        calib.lastAt = null;
        return snapshot({ faceStatus: 'quality', hint: quality.message, reason: '校准暂停：' + quality.message });
      }
      updateCalibration(face, now);
      if (phase === 'calibrating') {
        return snapshot({ hint: '正在校准，请保持自然表情', reason: '正在记录自然表情' });
      }
    }

    updateSmoothing(face, now);
    lastTickAt = now;
    const { transition, reason } = decide(now, quality.ok);
    return snapshot({
      transition,
      faceStatus: quality.ok ? 'ok' : 'quality',
      hint: quality.ok ? '' : quality.message,
      reason
    });
  }

  reset();
  return { update, reset, get state() { return state; } };
}
