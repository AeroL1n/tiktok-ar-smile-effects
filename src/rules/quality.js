export const FULL_FRAME = Object.freeze({ x0: 0, y0: 0, x1: 1, y1: 1 });

// 视频用 object-fit: cover 显示时，屏幕上实际看得到的那部分画面（归一化坐标）。
export function getVisibleRegion(videoWidth, videoHeight, viewWidth, viewHeight) {
  if (!videoWidth || !videoHeight || !viewWidth || !viewHeight) return FULL_FRAME;
  const videoRatio = videoWidth / videoHeight;
  const viewRatio = viewWidth / viewHeight;
  if (videoRatio > viewRatio) {
    const x0 = (1 - viewRatio / videoRatio) / 2;
    return { x0, y0: 0, x1: 1 - x0, y1: 1 };
  }
  const y0 = (1 - videoRatio / viewRatio) / 2;
  return { x0: 0, y0, x1: 1, y1: 1 - y0 };
}

function fail(issue, message) {
  return { ok: false, issue, message };
}

export function assessQuality({ box, yawDeg = 0, brightness = null, visible = FULL_FRAME }, cfg) {
  if (box.minX < visible.x0 || box.maxX > visible.x1 || box.minY < visible.y0 || box.maxY > visible.y1) {
    return fail('partial', '请把脸移到画面中间');
  }
  if (box.width / (visible.x1 - visible.x0) < cfg.minFaceWidth) {
    return fail('too_small', '请靠近一点');
  }
  if (Math.abs(yawDeg) > cfg.maxYawDeg) {
    return fail('side_face', '请正对镜头');
  }
  if (brightness !== null && brightness < cfg.minBrightness) {
    return fail('too_dark', '光线太暗，请打开灯');
  }
  return { ok: true, issue: null, message: '' };
}

// RGBA 像素的平均亮度，0–255。
export function averageLuma(data) {
  const pixels = data.length / 4;
  if (!pixels) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }
  return sum / pixels;
}
