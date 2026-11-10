// 演示模式的输入：用按钮代替表情识别，用一个可拖动的假人代替人脸位置。不碰页面，方便测试。
// 自动演示的剧本：等待 → 微笑（看雨变密）→ 停止（看余光）→ 微笑 → 直接转大笑（看雨收住、烟花接上）。
export const DEMO_SCRIPT = Object.freeze([
  ['idle', 1500],
  ['smile', 4000],
  ['idle', 2000],
  ['smile', 3000],
  ['laugh', 3000],
  ['idle', 2000]
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
