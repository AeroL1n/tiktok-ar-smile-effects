import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { RULES } from './rules/config.js';
import { createFaceTracker, getFaceBox, needsRecalibration, yawFromMatrix } from './rules/faceSelection.js';
import { assessQuality, averageLuma, getVisibleRegion } from './rules/quality.js';
import { createExpressionMachine } from './rules/expression.js';
import { bodyShapes, createFireworkScheduler, createHeadFollower, createRainEnvelope, headEllipse, planVolley } from './rules/effects.js';
import { DEMO_PHOTOS, createDemoInput, photoFaceBox, photoLayout, viewToCanvas } from './rules/demo.js';
import { extractSignals, pitchFromMatrix } from './rules/signals.js';
import { createRecorder } from './app/recorder.js';
import { createFireworks } from './app/fireworks.js';
import { createBlessingRain } from './app/blessingRain.js';
import * as ui from './app/ui.js';
import './styles.css';

const { video, overlay, button } = ui.els;
const ctx = overlay.getContext('2d');
const lumaCanvas = document.createElement('canvas');
lumaCanvas.width = 32;
lumaCanvas.height = 24;
const lumaCtx = lumaCanvas.getContext('2d', { willReadFrequently: true });
const assetUrl = (path) => `${import.meta.env.BASE_URL}${path}`;

const tracker = createFaceTracker(RULES.faceSelection);
const machine = createExpressionMachine(RULES);
const scheduler = createFireworkScheduler(RULES.fireworks);
const fireworks = createFireworks(RULES.fireworks);
const rain = createBlessingRain(RULES.rain);
const rainEnvelope = createRainEnvelope(RULES.rain);
const headFollower = createHeadFollower(RULES.head);
const recorder = createRecorder();
let lastRecording = null;

let faceLandmarker;
let stream;
let rafId;
let starting = false;
let viewSize = { width: 0, height: 0 };
let lastDetectAt = 0;
let lastVideoTime = -1;
let lastFrameAt = 0;
let lastLumaAt = -Infinity;
let brightness = null;
let selectedBox = null;
let lastView = null;
let debugGuide = false;
let inputMode = 'camera';
let cameraSession = 0;
let demoInput = null;
let demoClock = 0;
let demoState = null;
// 演示默认用模特照片持续播放微笑效果；假人保留，可拖动、可放大缩小。
const demoSettings = { subject: 'photo', mode: 'auto', sway: true, scale: 1, slow: false, paused: false, bounds: false };
// 两张照片：微笑那张配下雨，大笑那张配烟花。表情按钮切换时换图。
const demoImages = {
  smile: new Image(),
  laugh: new Image()
};
for (const [key, img] of Object.entries(demoImages)) {
  img.decoding = 'async';
}
function activePhoto() {
  return demoSettings.mode === 'laugh' ? DEMO_PHOTOS.laugh : DEMO_PHOTOS.smile;
}
function loadDemoPhoto() {
  for (const [key, img] of Object.entries(demoImages)) if (!img.src) img.src = assetUrl(DEMO_PHOTOS[key].src);
}
const DEMO_WIDTH = 540;
const counters = { detections: 0, frames: 0, since: 0, detectionRate: 0, renderFps: 0 };
const metrics = { raw: null, candidates: null, faceCount: 0, quality: '—', yaw: NaN, pitch: NaN, blendshapes: [] };

new ResizeObserver(([entry]) => {
  viewSize = { width: entry.contentRect.width, height: entry.contentRect.height };
  if (inputMode === 'demo') setupDemoCanvas();
}).observe(ui.els.frame);

function sampleBrightness(now) {
  if (now - lastLumaAt < RULES.brightnessSampleMs) return;
  lastLumaAt = now;
  lumaCtx.drawImage(video, 0, 0, lumaCanvas.width, lumaCanvas.height);
  brightness = averageLuma(lumaCtx.getImageData(0, 0, lumaCanvas.width, lumaCanvas.height).data);
}

function resetSession() {
  tracker.reset();
  machine.reset();
  scheduler.reset();
  fireworks.clear();
  rain.clear();
  rainEnvelope.reset();
  headFollower.reset();
  selectedBox = null;
  lastView = null;
}

function detect(now) {
  sampleBrightness(now);
  const result = faceLandmarker.detectForVideo(video, now);
  const faces = result.faceLandmarks ?? [];
  const boxes = faces.map(getFaceBox);
  const pick = tracker.update(boxes, now);

  if (needsRecalibration(pick.kind)) {
    machine.reset();
    scheduler.reset();
    // 换了一个人：雨和彩虹在旧的人头上原地收尾，不滑到新的人头上。
    rain.detach();
  }

  let face = null;
  let quality = { ok: true, message: '' };
  selectedBox = null;
  metrics.faceCount = faces.length;
  metrics.raw = null;
  metrics.candidates = null;
  metrics.yaw = NaN;
  metrics.pitch = NaN;
  metrics.blendshapes = [];

  if (pick.index >= 0) {
    const categories = result.faceBlendshapes?.[pick.index]?.categories;
    const matrix = result.facialTransformationMatrixes?.[pick.index]?.data;
    const signals = extractSignals(categories, faces[pick.index], video.videoWidth, video.videoHeight);
    face = {
      smile: signals.smile,
      jaw: signals.jaw,
      lipGap: signals.lipGap,
      squint: signals.squint,
      upperUp: signals.upperUp,
      browDown: signals.browDown
    };
    selectedBox = boxes[pick.index];
    metrics.raw = face;
    metrics.candidates = signals;
    metrics.yaw = yawFromMatrix(matrix);
    metrics.pitch = pitchFromMatrix(matrix);
    metrics.blendshapes = categories ?? [];
    const visible = getVisibleRegion(video.videoWidth, video.videoHeight, viewSize.width, viewSize.height);
    quality = assessQuality({ box: selectedBox, yawDeg: metrics.yaw, brightness, visible }, RULES.quality);
  }
  metrics.quality = pick.index < 0 ? '无人脸' : quality.ok ? '合格' : quality.message;

  const view = machine.update({ now, face, quality });

  if (!view.hint && faces.length > 1) {
    view.hint = `检测到 ${faces.length} 张脸，正在跟随最近的一张`;
  }

  const firework = scheduler.update(now, view.state === 'laugh');
  if (firework.launch && selectedBox) {
    const head = headEllipse(selectedBox, overlay.width, overlay.height);
    const w = overlay.width;
    const h = overlay.height;
    const visible = getVisibleRegion(w, h, viewSize.width, viewSize.height);
    const region = { left: visible.x0 * w, width: (visible.x1 - visible.x0) * w, top: visible.y0 * h, height: (visible.y1 - visible.y0) * h };
    launchVolley(head, region, now, firework);
  }

  lastView = view;
  ui.renderStage(view);
  ui.renderSignals({ ...metrics, signals: view.signals });
  recordFrame(now, view);
  counters.detections += 1;
}

// 这一版：每一轮在脸周围的不同方向放一组 1 大 + 2 中 + 1 小，下一轮避开用过的方向。
let lastSectors = [];
function launchVolley(head, region, now, firework) {
  const plan = planVolley(head, region, { full: true, avoid: lastSectors, unit: region.width }, RULES.fireworks.volley);
  lastSectors = plan.sectors;
  fireworks.launchVolley(plan, now, region.width, firework);
}

const STATE_CODE = { idle: 0, smile: 1, laugh: 2 };

function recordFrame(now, view) {
  const c = metrics.candidates;
  const step = recorder.update(now, {
    blendshapes: metrics.blendshapes,
    extra: {
      faces: metrics.faceCount,
      state: view.phase === 'calibrating' ? -1 : STATE_CODE[view.state],
      yaw: metrics.yaw,
      pitch: metrics.pitch,
      lipGap: c?.lipGap,
      lipGap3d: c?.lipGap3d,
      smoothSmile: view.signals?.smile,
      smoothLipGap: view.signals?.lipGap,
      smoothJaw: view.signals?.jaw,
      smoothSquint: view.signals?.squint
    }
  });
  ui.renderRecorder(step);
  if (step.phase === 'done') saveRecording(step.result);
}

async function saveRecording(result) {
  if (!result.rows.length) {
    ui.setRecordingResult('这 3 秒没有检测到人脸，没有保存。请正对镜头后重录', false);
    return;
  }
  lastRecording = result;
  ui.setRecordingResult(`已录 ${result.rows.length} 帧（${result.labelName}），正在保存…`, true);
  try {
    const res = await fetch('/__recordings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    });
    if (!res.ok) throw new Error(String(res.status));
    const { file } = await res.json();
    ui.setRecordingResult(`已保存 ${result.rows.length} 帧：${result.labelName}（${file}）`, true);
  } catch {
    ui.setRecordingResult(`已录 ${result.rows.length} 帧，但没能存到电脑上，请点“复制数据”发给 Claude`, true);
  }
}

// 调试框：蓝色虚线是人脸框；橙色虚线是雨和烟花用的头部、肩膀碰撞范围，用来和真人画面对照校准。
function drawFaceGuide(head) {
  if (!selectedBox) return;
  const w = overlay.width;
  const h = overlay.height;
  ctx.save();
  ctx.strokeStyle = 'rgba(176, 230, 255, 0.7)';
  ctx.lineWidth = Math.max(1.5, w / 420);
  ctx.setLineDash([8, 10]);
  ctx.beginPath();
  ctx.ellipse(selectedBox.cx * w, selectedBox.cy * h, (selectedBox.width / 2) * w, (selectedBox.height / 2) * h, 0, 0, Math.PI * 2);
  ctx.stroke();
  if (head) {
    ctx.strokeStyle = 'rgba(255, 199, 138, 0.75)';
    ctx.setLineDash([4, 8]);
    for (const shape of bodyShapes(head)) {
      ctx.beginPath();
      ctx.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function renderEffects(w, h, head, effectNow) {
  if (inputMode === 'demo') drawDemoScene(w, h, head);
  else if (debugGuide) drawFaceGuide(head);
  rain.draw(ctx, { head });
  fireworks.draw(ctx, effectNow, w, w, h);
}

// region：画布上实际可见的区域（摄像头画面铺满裁切后，左右或上下会有一截看不到）。
function stepEffects({ dt, effectNow, state, target, w, h, region }) {
  const head = headFollower.update(target, dt * 1000);
  const envelope = rainEnvelope.update(effectNow, state);
  rain.update(dt, { envelope, head, view: region });
  fireworks.update(dt, { head, region, height: h });
  // 追光遮罩：亮背景多压暗，暗背景少压（演示照片按亮背景处理）。
  const bright = inputMode === 'demo' ? 180 : brightness;
  // 背景压暗加强：最暗 85%，亮度 50 以下也有 30% 的基础压暗，180 的演示照片直接到顶。
  fireworks.setDarken(bright === null ? 0.5 : Math.min(0.85, 0.3 + Math.max(0, (bright - 50) / 130) * 0.55));
  // 脸占可见宽度的比例越大，烟花的舒适区越小：摄像头里脸常常比演示照片大一倍。
  const tight = region.width > 0 && head ? Math.min(1, (head.rx * 2) / region.width) : 0.5;
  fireworks.setReach(2.2 - 0.7 * Math.max(0, (tight - 0.6) / 0.4));
  ctx.clearRect(0, 0, w, h);
  renderEffects(w, h, head, effectNow);
}

function countFrame(now) {
  counters.frames += 1;
  if (now - counters.since < 1000) return;
  counters.detectionRate = counters.detections;
  counters.renderFps = counters.frames;
  // 按帧率降级：低于 45 帧先减少辅助烟花和碎词，再减少二次绽放；回到 55 帧以上慢慢恢复。
  if (counters.renderFps < 45) fireworks.setQuality(fireworks.quality - 0.2);
  else if (counters.renderFps >= 55) fireworks.setQuality(fireworks.quality + 0.1);
  counters.detections = 0;
  counters.frames = 0;
  counters.since = now;
  ui.renderMetrics({
    baseline: inputMode === 'demo' ? null : lastView?.baseline,
    brightness: inputMode === 'demo' ? NaN : brightness,
    detectionRate: counters.detectionRate,
    renderFps: counters.renderFps,
    drops: rain.dropCount,
    sparkles: rain.splashCount,
    bursts: fireworks.burstCount,
    fireworkParticles: fireworks.particleCount
  });
}

function cameraFrame(now) {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

  const w = video.videoWidth || 640;
  const h = video.videoHeight || 480;
  if (overlay.width !== w || overlay.height !== h) {
    overlay.width = w;
    overlay.height = h;
  }

  if (now - lastDetectAt >= RULES.detectionIntervalMs && video.currentTime !== lastVideoTime) {
    lastDetectAt = now;
    lastVideoTime = video.currentTime;
    detect(now);
  }

  const dt = Math.min(0.05, (now - (lastFrameAt || now)) / 1000);
  lastFrameAt = now;
  const visible = getVisibleRegion(w, h, viewSize.width, viewSize.height);
  stepEffects({
    dt,
    effectNow: now,
    state: lastView?.phase === 'running' ? lastView.state : 'idle',
    target: selectedBox ? headEllipse(selectedBox, w, h) : null,
    w,
    h,
    region: { left: visible.x0 * w, width: (visible.x1 - visible.x0) * w, top: visible.y0 * h, height: (visible.y1 - visible.y0) * h }
  });
  countFrame(now);
}

// 演示模式：画布按画面框的宽高比铺满，不裁切；表情和头部位置来自按钮和拖动。
function setupDemoCanvas() {
  const ratio = viewSize.width && viewSize.height ? viewSize.height / viewSize.width : 16 / 9;
  const w = DEMO_WIDTH;
  const h = Math.round(DEMO_WIDTH * ratio);
  if (overlay.width !== w || overlay.height !== h || !demoInput) {
    overlay.width = w;
    overlay.height = h;
    demoInput = createDemoInput({ width: w, height: h });
    demoInput.setMode(demoSettings.mode);
    demoInput.setSway(demoSettings.sway, demoClock);
    demoInput.setScale(demoSettings.scale);
    headFollower.reset();
  }
}

function demoFrame(now) {
  const realDt = Math.min(0.05, (now - (lastFrameAt || now)) / 1000);
  lastFrameAt = now;
  if (demoSettings.paused) return;
  const dt = realDt * (demoSettings.slow ? 0.25 : 1);
  demoClock += dt * 1000;
  const w = overlay.width;
  const h = overlay.height;
  const input = demoInput.update(demoClock);
  const state = input.state;
  // 照片模式：头部位置来自对照片识别一次得到的人脸框，和摄像头模式走同一个 headEllipse。
  // 照片在画布里是镜像画的，人脸框也要左右镜像。
  const target = demoSettings.subject === 'photo' ? headEllipse(mirrorBox(photoFaceBox(activePhoto(), w, h)), w, h) : input.target;
  if (state !== demoState) {
    demoState = state;
    ui.renderDemoStage(state);
  }
  const head = headFollower.update(target, 0);
  const firework = scheduler.update(demoClock, state === 'laugh');
  if (firework.launch && head) launchVolley(head, { left: 0, width: w, top: 0, height: h }, demoClock, firework);
  stepEffects({ dt, effectNow: demoClock, state, target, w, h, region: { left: 0, width: w, top: 0, height: h } });
  countFrame(now);
}

function drawDemoScene(w, h, head) {
  if (demoSettings.subject === 'photo') {
    drawDemoPhoto(w, h, head);
    return;
  }
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#68789a');
  bg.addColorStop(0.55, '#454f69');
  bg.addColorStop(1, '#262c3d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  if (!head) return;
  const [headShape, shoulders] = bodyShapes(head);
  ctx.save();
  ctx.fillStyle = 'rgba(38, 44, 62, 0.92)';
  ctx.beginPath();
  ctx.ellipse(shoulders.cx, shoulders.cy, shoulders.rx, shoulders.ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(214, 182, 160, 0.95)';
  ctx.beginPath();
  ctx.ellipse(headShape.cx, headShape.cy + headShape.ry * 0.08, headShape.rx * 0.84, headShape.ry * 0.88, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(46, 36, 34, 0.95)';
  ctx.beginPath();
  ctx.ellipse(headShape.cx, headShape.cy - headShape.ry * 0.28, headShape.rx * 0.92, headShape.ry * 0.62, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  if (demoSettings.bounds) {
    ctx.strokeStyle = 'rgba(255, 199, 138, 0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    for (const shape of [headShape, shoulders]) {
      ctx.beginPath();
      ctx.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

const mirrorBox = (box) => ({ ...box, minX: 1 - box.maxX, maxX: 1 - box.minX, cx: 1 - box.cx });

// 照片铺满画布。画布在页面上是镜像显示的，照片先镜像一次，屏幕上就是原图的方向。
function drawDemoPhoto(w, h, head) {
  ctx.fillStyle = '#c9c9c7';
  ctx.fillRect(0, 0, w, h);
  const photo = activePhoto();
  const img = demoImages[demoSettings.mode === 'laugh' ? 'laugh' : 'smile'];
  if (!img.complete) return;
  const L = photoLayout(photo, w, h);
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(img, L.x, L.y, L.w, L.h);
  ctx.restore();
  if (demoSettings.bounds && head) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 199, 138, 0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    for (const shape of bodyShapes(head)) {
      ctx.beginPath();
      ctx.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function frame(now) {
  rafId = requestAnimationFrame(frame);
  if (inputMode === 'demo') demoFrame(now);
  else cameraFrame(now);
}

async function loadModel() {
  if (faceLandmarker) return;
  ui.setMode('loading', '正在加载识别模型…');
  try {
    const vision = await FilesetResolver.forVisionTasks(assetUrl('wasm'));
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: assetUrl('models/face_landmarker.task'), delegate: 'GPU' },
      runningMode: 'VIDEO',
      numFaces: 3,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true
    });
  } catch (error) {
    throw new Error('识别模型加载失败，请检查网络后重试。', { cause: error });
  }
}

function cameraErrorMessage(error) {
  switch (error.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return '摄像头权限被拒绝。请在浏览器地址栏左侧的网站设置里允许使用摄像头，然后点击重试。';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return '没有找到可用的摄像头。请连接摄像头后重试。';
    case 'NotReadableError':
      return '摄像头正被其他应用占用。请关闭其他使用摄像头的应用后重试。';
    default:
      return error.message || '摄像头启动失败，请重试。';
  }
}

async function start() {
  if (starting || inputMode !== 'camera') return;
  stop({ silent: true });
  starting = true;
  const session = cameraSession;
  const switched = () => session !== cameraSession;
  button.disabled = true;
  ui.setMode('loading', '正在启动摄像头…');
  ui.setError('');

  try {
    if (!window.isSecureContext) {
      throw new Error('摄像头只能在 HTTPS 页面中使用。请通过 https:// 地址打开。');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前浏览器不支持摄像头。请使用最新版 Chrome 或 Safari。');
    }
    await loadModel();
    if (switched()) return;
    ui.setMode('loading', '正在打开摄像头…');
    const opened = await navigator.mediaDevices.getUserMedia({
      audio: false,
      // 4:3 保留最多竖向视野；分辨率能高就高，竖屏裁切后仍清楚。摄像头不支持时会自动退到接近的值。
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }
    });
    if (switched()) {
      opened.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = opened;
    video.srcObject = stream;
    await video.play();
    if (switched()) return;
    if (document.hidden) {
      stop();
      return;
    }
    resetSession();
    ui.hidePlaceholder();
    ui.showDemoFallback(false);
    ui.setMode('live', '正在识别');
    rafId = requestAnimationFrame(frame);
  } catch (error) {
    if (switched()) return;
    stop({ silent: true });
    ui.setError(cameraErrorMessage(error));
    ui.setMode('error', '无法启动');
    ui.showPlaceholder('摄像头没有启动，可以先看演示', '重试');
    ui.showDemoFallback(true);
  } finally {
    if (!switched()) {
      starting = false;
      button.disabled = false;
    }
  }
}

function stop({ silent = false, manual = false } = {}) {
  // 使尚未结束的模型加载 / 摄像头申请失效，避免关闭后旧请求又打开摄像头。
  cameraSession += 1;
  starting = false;
  button.disabled = false;
  cancelAnimationFrame(rafId);
  stream?.getTracks().forEach((track) => track.stop());
  stream = undefined;
  video.srcObject = null;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  resetSession();
  if (recorder.active) {
    recorder.cancel();
    ui.renderRecorder({ phase: 'idle' });
    ui.setRecordingResult('录制被中断：摄像头已关闭，请重新录', false);
  }
  if (!silent) {
    ui.clearSignals('—');
    ui.renderStage({ phase: 'running', state: 'idle', reason: '微笑下雨，大笑放烟花', hint: '', calibrationProgress: 0 });
    ui.setMode(manual ? 'idle' : 'paused', manual ? '摄像头已关闭' : '已暂停');
    ui.showPlaceholder(manual ? '摄像头已关闭，点击下方按钮可重新开启。' : '页面切到后台时已关闭摄像头', '开启摄像头');
  }
}

button.addEventListener('click', () => {
  if (stream) stop({ manual: true });
  else start();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (stream || starting)) stop();
});
window.addEventListener('pagehide', () => stop({ silent: true }));

ui.bindDebugToggle((open) => { debugGuide = open; });
ui.bindPanelClose();

function setInputMode(mode) {
  if (mode === inputMode) return;
  cameraSession += 1;
  if (stream || starting) stop({ silent: true });
  else {
    cancelAnimationFrame(rafId);
    resetSession();
  }
  starting = false;
  button.disabled = false;
  inputMode = mode;
  lastFrameAt = 0;
  ui.setInputModeView(mode);
  ui.setError('');
  ui.clearSignals(mode === 'demo' ? '演示模式' : '—');
  if (mode === 'demo') {
    ui.hidePlaceholder();
    ui.setMode('demo', '演示模式 · 模拟表情');
    ui.setRecorderEnabled(false);
    demoState = null;
    loadDemoPhoto();
    ui.setDemoSubjectView(demoSettings.subject);
    setupDemoCanvas();
    rafId = requestAnimationFrame(frame);
  } else {
    demoInput = null;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ui.setRecorderEnabled(true);
    ui.renderStage({ phase: 'running', state: 'idle', reason: '微笑下雨，大笑放烟花', hint: '', calibrationProgress: 0 });
    ui.showPlaceholder('打开前置摄像头开始识别。视频只在本机处理，不会上传。', '开启摄像头');
    ui.setMode('idle', '等待摄像头');
  }
}

ui.bindInputMode(setInputMode);
ui.bindDemoSubject((subject) => {
  demoSettings.subject = subject;
  headFollower.reset();
  rain.clear();
  rainEnvelope.reset();
  fireworks.clear();
  scheduler.reset();
});
ui.bindDemoControls({
  onState: (mode) => { demoSettings.mode = mode; demoInput?.setMode(mode); },
  onSway: (on) => { demoSettings.sway = on; demoInput?.setSway(on, demoClock); },
  onBounds: (on) => { demoSettings.bounds = on; },
  onScale: (value) => { demoSettings.scale = value; demoInput?.setScale(value); },
  onSlow: (on) => { demoSettings.slow = on; },
  onPause: (on) => { demoSettings.paused = on; }
});

function pointerToCanvas(event) {
  const rect = overlay.getBoundingClientRect();
  return viewToCanvas(event.clientX - rect.left, event.clientY - rect.top, rect, overlay);
}

ui.els.frame.addEventListener('pointerdown', (event) => {
  if (inputMode !== 'demo' || !demoInput || demoSettings.subject === 'photo') return;
  ui.els.frame.setPointerCapture(event.pointerId);
  const p = pointerToCanvas(event);
  demoInput.dragTo(p.x, p.y);
});
ui.els.frame.addEventListener('pointermove', (event) => {
  if (inputMode !== 'demo' || !demoInput || !ui.els.frame.hasPointerCapture(event.pointerId)) return;
  const p = pointerToCanvas(event);
  demoInput.dragTo(p.x, p.y);
});
const endDrag = (event) => {
  if (inputMode !== 'demo' || !demoInput) return;
  if (ui.els.frame.hasPointerCapture(event.pointerId)) ui.els.frame.releasePointerCapture(event.pointerId);
  demoInput.endDrag(demoClock);
};
ui.els.frame.addEventListener('pointerup', endDrag);
ui.els.frame.addEventListener('pointercancel', endDrag);
ui.renderThresholds();
ui.bindRecorder({
  onStart: (slug) => {
    if (!stream) {
      ui.setRecordingResult('请先开启摄像头，再录制', false);
      return;
    }
    recorder.start(slug, performance.now());
    ui.setRecordingResult('', false);
  },
  getLast: () => lastRecording
});

// 打开链接先看效果：默认进入演示模式（自动轮播），摄像头在右上角随时切换。
setInputMode('demo');
