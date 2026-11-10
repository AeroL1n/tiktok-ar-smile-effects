import { RULES } from '../rules/config.js';

const $ = (id) => document.getElementById(id);

export const els = {
  video: $('camera'),
  overlay: $('overlay'),
  frame: $('cameraFrame'),
  placeholder: $('cameraPlaceholder'),
  placeholderText: $('placeholderText'),
  button: $('cameraButton'),
  live: $('liveIndicator'),
  status: $('stageStatus'),
  hint: $('stageHint'),
  calibration: $('calibrationBar'),
  calibrationFill: $('calibrationFill'),
  dot: $('signalDot'),
  state: $('expressionState'),
  reason: $('expressionReason'),
  error: $('errorMessage'),
  debugToggle: $('debugToggle'),
  debugBody: $('debugBody'),
  thresholds: $('thresholdNote')
};

const STATE_LABELS = {
  calibrating: '校准中',
  idle: '等待表情',
  smile: '微笑 · 下雨',
  laugh: '大笑 · 烟花'
};

const LIVE_LABELS = { idle: '未连接', loading: '启动中', live: '识别中', paused: '已暂停', error: '需处理', demo: '演示中' };

const fmt = (v, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits) : '—');
const setText = (id, text) => { $(id).textContent = text; };

export function setMode(mode, statusText) {
  els.status.textContent = statusText;
  els.status.dataset.mode = mode;
  els.live.textContent = LIVE_LABELS[mode] ?? LIVE_LABELS.idle;
  els.live.dataset.mode = mode;
  els.dot.dataset.mode = mode;
}

export function setError(message = '') {
  els.error.textContent = message;
  els.frame.dataset.error = message ? 'true' : 'false';
}

export function showPlaceholder(text, buttonLabel) {
  els.placeholder.hidden = false;
  els.placeholderText.textContent = text;
  els.button.textContent = buttonLabel;
}

export function hidePlaceholder() {
  els.placeholder.hidden = true;
  els.button.textContent = '重新开启摄像头';
}

export function renderThresholds() {
  const { smile, laugh } = RULES;
  els.thresholds.textContent =
    `微笑：嘴角 ≥ ${fmt(smile.enter)}；` +
    `大笑：嘴角 ≥ ${fmt(laugh.smileMin)}、眯眼 ≥ ${fmt(laugh.squintMin)}、皱眉 < ${fmt(laugh.browDownMax)}，` +
    `且嘴唇间距 ≥ ${fmt(laugh.lipGapMin)} 或上唇上提 ≥ ${fmt(laugh.upperUpMin)}；` +
    `嘴角 < ${fmt(smile.exit)} 停止`;
}

export function renderStage(view) {
  const key = view.phase === 'calibrating' ? 'calibrating' : view.state;
  els.state.textContent = STATE_LABELS[key];
  els.state.dataset.expression = key;
  els.dot.dataset.expression = key;
  els.reason.textContent = view.reason || (key === 'idle' ? '微笑或大笑来触发效果' : '');

  els.hint.textContent = view.hint;
  els.hint.hidden = !view.hint;

  const calibrating = view.phase === 'calibrating';
  els.calibration.hidden = !calibrating;
  els.calibrationFill.style.transform = `scaleX(${calibrating ? view.calibrationProgress : 0})`;
}

function mouthShape(s) {
  if (!s) return '—';
  const { mouth, laugh } = RULES;
  if (s.upperUp >= laugh.upperUpMin) return '上排牙露出';
  if (s.lipGap >= laugh.lipGapMin) return '嘴张得大';
  if (s.lipGap >= mouth.openMin) return '微张';
  return '闭合';
}

// 表情读数每次识别都刷新，截图时数值和画面对得上。
export function renderSignals(m) {
  const c = m.candidates;
  const s = m.signals;
  setText('smileValue', fmt(s?.smile));
  setText('lipGapValue', fmt(s?.lipGap));
  setText('upperUpValue', fmt(s?.upperUp));
  setText('squintValue', fmt(s?.squint));
  setText('browDownValue', fmt(s?.browDown));
  setText('mouthShapeValue', mouthShape(s));
  setText('jawValue', fmt(c?.jaw));
  setText('browInnerUpValue', fmt(c?.browInnerUp));
  setText('frownValue', fmt(c?.frown));
  setText('lipGap3dValue', fmt(c?.lipGap3d));
  setText('pitchValue', Number.isFinite(m.pitch) ? `${fmt(m.pitch, 0)}°` : '—');
  setText('yawValue', Number.isFinite(m.yaw) ? `${fmt(m.yaw, 0)}°` : '—');
  setText('qualityValue', m.quality);
  setText('faceCountValue', String(m.faceCount));
}

// 频率和计数每秒刷新一次。
export function renderMetrics(m) {
  setText('baselineValue', m.baseline ? `${fmt(m.baseline.smile)} / ${fmt(m.baseline.jaw)}` : '校准后显示');
  setText('brightnessValue', Number.isFinite(m.brightness) ? fmt(m.brightness, 0) : '—');
  setText('detectionRateValue', `${m.detectionRate} 次/秒`);
  setText('renderFpsValue', `${m.renderFps} 帧/秒`);
  setText('particleValue', `${m.drops} / ${m.sparkles} / ${m.fireworkParticles}`);
  setText('collisionValue', String(m.collisions));
}

export function bindDebugToggle(onChange = () => {}) {
  els.debugToggle.addEventListener('click', () => {
    const open = els.debugToggle.getAttribute('aria-expanded') !== 'true';
    els.debugToggle.setAttribute('aria-expanded', String(open));
    els.debugToggle.textContent = open ? '收起识别与性能数据' : '识别与性能数据';
    els.debugBody.hidden = !open;
    onChange(open);
  });
}

const rec = {
  label: $('recordLabel'),
  button: $('recordButton'),
  status: $('recordStatus'),
  copy: $('copyRecording')
};

export function bindRecorder({ onStart, getLast }) {
  rec.button.addEventListener('click', () => onStart(rec.label.value));
  rec.copy.addEventListener('click', async () => {
    const data = getLast();
    if (!data) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(data));
      rec.copy.textContent = '已复制';
    } catch {
      rec.copy.textContent = '复制失败，请改用电脑上保存的文件';
    }
    setTimeout(() => { rec.copy.textContent = '复制数据'; }, 2000);
  });
}

export function renderRecorder(step) {
  const busy = step.phase === 'countdown' || step.phase === 'recording';
  rec.button.disabled = busy;
  rec.label.disabled = busy;
  if (step.phase === 'countdown') {
    rec.status.textContent = `${Math.ceil(step.remainingMs / 1000)} 秒后开始，请准备好表情`;
  } else if (step.phase === 'recording') {
    rec.status.textContent = `录制中，还剩 ${(step.remainingMs / 1000).toFixed(1)} 秒`;
  }
}

export function setRecordingResult(text, canCopy) {
  if (text) rec.status.textContent = text;
  rec.copy.hidden = !canCopy;
}

const RECORD_HINT = '点“录 3 秒”后有 3 秒准备时间，再连续记录 3 秒。';

export function setRecorderEnabled(enabled) {
  rec.button.disabled = !enabled;
  rec.label.disabled = !enabled;
  rec.status.textContent = enabled ? RECORD_HINT : '演示模式下不能录制，请切回摄像头模式。';
  rec.copy.hidden = true;
}

const modeButtons = [...document.querySelectorAll('[data-input]')];
const demoEls = {
  controls: $('demoControls'),
  fallback: $('demoFallback'),
  states: [...document.querySelectorAll('[data-demo-state]')],
  sway: $('demoSway'),
  bounds: $('demoBounds'),
  scale: $('demoScale'),
  slow: $('demoSlow'),
  pause: $('demoPause'),
  backdrop: $('demoBackdrop')
};

export function bindInputMode(onChange) {
  modeButtons.forEach((b) => b.addEventListener('click', () => onChange(b.dataset.input)));
  demoEls.fallback.addEventListener('click', () => onChange('demo'));
}

export function setInputModeView(mode) {
  modeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.input === mode)));
  els.frame.dataset.input = mode;
  demoEls.controls.hidden = mode !== 'demo';
  els.button.hidden = mode === 'demo';
  demoEls.fallback.hidden = true;
}

export function showDemoFallback(show) {
  demoEls.fallback.hidden = !show;
}

function toggle(button, handler) {
  button.addEventListener('click', () => {
    const on = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(on));
    handler(on);
  });
}

export function bindDemoControls({ onState, onSway, onBounds, onScale, onSlow, onPause, onBackdrop }) {
  demoEls.states.forEach((b) => b.addEventListener('click', () => {
    demoEls.states.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    onState(b.dataset.demoState);
  }));
  demoEls.sway.addEventListener('change', () => onSway(demoEls.sway.checked));
  demoEls.bounds.addEventListener('change', () => onBounds(demoEls.bounds.checked));
  demoEls.scale.addEventListener('input', () => onScale(Number(demoEls.scale.value)));
  toggle(demoEls.slow, onSlow);
  toggle(demoEls.pause, onPause);
  demoEls.backdrop.addEventListener('change', () => onBackdrop(demoEls.backdrop.value));
}

export function renderDemoStage(state) {
  renderStage({ phase: 'running', state, reason: '演示模式：表情由按钮模拟，不是识别结果', hint: '', calibrationProgress: 0 });
}

export function clearSignals(quality) {
  renderSignals({ candidates: null, signals: null, yaw: NaN, pitch: NaN, quality, faceCount: 0 });
}
