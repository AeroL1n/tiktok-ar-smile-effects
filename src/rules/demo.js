// 演示模式的输入：用按钮代替表情识别，用一个可拖动的假人代替人脸位置。不碰页面，方便测试。
// 自动演示的剧本缩短到 10 秒一轮：等待 → 微笑下雨 → 大笑烟花 → 收尾。
// 面试官打开链接约 4 秒就能看到第一次烟花，不用等完原来的双段微笑。
export const DEMO_SCRIPT = Object.freeze([
  ['idle', 800],
  ['smile', 3200],
  ['laugh', 4500],
  ['idle', 1500]
]);

export function scriptedState(tMs, script = DEMO_SCRIPT) {
  const total = script.reduce((sum, [, ms]) => sum + ms, 0);
  let t = ((tMs % total) + total) % total;
  for (const [state, ms] of script) {
    if (t < ms) return state;
    t -= ms;
  }
  return 'idle';
}

// 页面上的指针坐标换成画布坐标：画布用 object-fit: cover 铺满，并且水平镜像显示。
export function viewToCanvas(px, py, view, canvas, mirrored = true) {
  const scale = Math.max(view.width / canvas.width, view.height / canvas.height);
  const offsetX = (view.width - canvas.width * scale) / 2;
  const offsetY = (view.height - canvas.height * scale) / 2;
  const x = mirrored ? view.width - px : px;
  return { x: (x - offsetX) / scale, y: (py - offsetY) / scale };
}

const SWAY_PERIOD_MS = 5700;

export function createDemoInput({ width, height }) {
  const baseRx = width * 0.17;
  let mode = 'auto';
  let sway = true;
  let scale = 1;
  let anchor = { x: width / 2, y: height * 0.4 };
  let dragging = false;
  let swayFrom = 0;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function dragTo(x, y) {
    dragging = true;
    anchor = { x: clamp(x, width * 0.1, width * 0.9), y: clamp(y, height * 0.15, height * 0.8) };
  }

  function endDrag(tMs) {
    dragging = false;
    swayFrom = tMs;
  }

  function update(tMs) {
    const rx = baseRx * scale;
    const offset = sway && !dragging ? Math.sin(((tMs - swayFrom) / SWAY_PERIOD_MS) * Math.PI * 2) * width * 0.08 : 0;
    return {
      state: mode === 'auto' ? scriptedState(tMs) : mode,
      target: { cx: anchor.x + offset, cy: anchor.y, rx, ry: rx * 1.25 }
    };
  }

  return {
    update,
    dragTo,
    endDrag,
    setMode(next) { mode = next; },
    setSway(on, tMs = 0) { sway = on; swayFrom = tMs; },
    setScale(next) { scale = clamp(next, 0.5, 1.6); },
    get mode() { return mode; },
    get sway() { return sway; }
  };
}

// 演示用的两张照片（941×1672），同一张脸、同一个角度：微笑那张用来演示下雨，大笑那张用来演示烟花。
// 人脸框是用 MediaPipe Face Landmarker 对照片识别一次得到的（2026-11-11，归一化到照片宽高），
// 照片不会变，所以直接存结果，演示时不用再加载识别模型，评审打开演示马上就能看到效果。
const MODEL = { width: 941, height: 1672, focusY: 0.38 };
export const DEMO_PHOTOS = Object.freeze({
  smile: Object.freeze({
    ...MODEL,
    src: 'demo/model-smile.jpg',
    face: Object.freeze({ minX: 0.3033, maxX: 0.699, minY: 0.3776, maxY: 0.6467 })
  }),
  laugh: Object.freeze({
    ...MODEL,
    src: 'demo/model-laugh.jpg',
    face: Object.freeze({ minX: 0.305, maxX: 0.6991, minY: 0.3792, maxY: 0.6501 })
  })
});
// 兼容旧的单个照片常量（测试和别处按这个名字引用）。
export const DEMO_PHOTO = DEMO_PHOTOS.smile;

// 照片按“铺满画布、可能裁掉上下或左右”放进画布时的位置和缩放（画布像素）。
export function photoLayout(photo, canvasWidth, canvasHeight) {
  const scale = Math.max(canvasWidth / photo.width, canvasHeight / photo.height);
  const w = photo.width * scale;
  const h = photo.height * scale;
  return { x: (canvasWidth - w) / 2, y: (canvasHeight - h) * photo.focusY, w, h };
}

// 照片里的人脸框换成画布上的归一化人脸框，格式和摄像头模式的 getFaceBox 一样，可以直接交给 headEllipse。
export function photoFaceBox(photo, canvasWidth, canvasHeight) {
  const L = photoLayout(photo, canvasWidth, canvasHeight);
  const minX = (L.x + photo.face.minX * L.w) / canvasWidth;
  const maxX = (L.x + photo.face.maxX * L.w) / canvasWidth;
  const minY = (L.y + photo.face.minY * L.h) / canvasHeight;
  const maxY = (L.y + photo.face.maxY * L.h) / canvasHeight;
  const width = maxX - minX;
  const height = maxY - minY;
  return { minX, maxX, minY, maxY, width, height, area: width * height, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}
