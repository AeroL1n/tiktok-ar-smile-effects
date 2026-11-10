const UPPER_LIP_INNER = 13;
const LOWER_LIP_INNER = 14;
const FOREHEAD_TOP = 10;
const NOSE_TIP = 1;

export function blendshapeMap(categories = []) {
  const map = new Map();
  for (const c of categories) map.set(c.categoryName, c.score);
  return (name) => map.get(name) ?? 0;
}

// 上下嘴唇内侧的距离，除以额头到鼻尖的距离。用上半张脸做尺子：张嘴时下巴会动，额头到鼻尖不会；
// 这样离镜头远近不影响数值。关键点是归一化坐标，先按画面宽高换回像素再算距离。
// withDepth 为 true 时把深度也算进去（MediaPipe 的 z 与 x 同一尺度，按画面宽度换算）。
export function lipGapRatio(landmarks, width = 1, height = 1, withDepth = false) {
  const a = landmarks?.[UPPER_LIP_INNER];
  const b = landmarks?.[LOWER_LIP_INNER];
  const top = landmarks?.[FOREHEAD_TOP];
  const nose = landmarks?.[NOSE_TIP];
  if (!a || !b || !top || !nose) return NaN;
  const dist = (p, q) => Math.hypot(
    (p.x - q.x) * width,
    (p.y - q.y) * height,
    withDepth ? ((p.z ?? 0) - (q.z ?? 0)) * width : 0
  );
  const ruler = dist(top, nose);
  if (ruler <= 0) return NaN;
  return dist(a, b) / ruler;
}

// 从头部变换矩阵（4×4，列主序）的脸朝向向量算低头抬头角度。正负方向以实测为准，只用于记录。
export function pitchFromMatrix(data) {
  if (!data || data.length < 16) return NaN;
  return (Math.atan2(data[9], Math.hypot(data[8], data[10])) * 180) / Math.PI;
}

// smile、jaw、lipGap、squint 参与判定；其余只显示或记录，用来收集真人数据。
export function extractSignals(categories, landmarks, width, height) {
  const s = blendshapeMap(categories);
  const pair = (name) => (s(`${name}Left`) + s(`${name}Right`)) / 2;
  return {
    smile: pair('mouthSmile'),
    jaw: s('jawOpen'),
    lipGap: lipGapRatio(landmarks, width, height),
    lipGap3d: lipGapRatio(landmarks, width, height, true),
    squint: pair('eyeSquint'),
    upperUp: pair('mouthUpperUp'),
    cheekSquint: pair('cheekSquint'),
    browDown: pair('browDown'),
    browInnerUp: s('browInnerUp'),
    frown: pair('mouthFrown')
  };
}
