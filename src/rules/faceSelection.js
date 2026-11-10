export function getFaceBox(landmarks) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of landmarks) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  return {
    minX,
    maxX,
    minY,
    maxY,
    width,
    height,
    area: width * height,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2
  };
}

// 从 MediaPipe 的面部变换矩阵（4×4，列主序）算左右转头角度，正脸为 0°。
// 用脸朝向向量（矩阵第 3 列）的水平分量计算，低头抬头不影响结果。
// z 取绝对值：正脸时结果为 0°，不依赖坐标系里 z 轴朝向镜头还是背向镜头。
export function yawFromMatrix(data) {
  if (!data || data.length < 16) return NaN;
  return (Math.atan2(data[8], Math.abs(data[10])) * 180) / Math.PI;
}

function indexOfLargest(boxes) {
  let best = 0;
  for (let i = 1; i < boxes.length; i += 1) {
    if (boxes[i].area > boxes[best].area) best = i;
  }
  return best;
}

function indexOfNearest(boxes, center, maxDistance) {
  let best = -1;
  let bestDistance = maxDistance;
  boxes.forEach((box, i) => {
    const distance = Math.hypot(box.cx - center.cx, box.cy - center.cy);
    if (distance <= bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best;
}

// 跟随画面里最大的脸；大小接近时不来回跳，新脸要大 20% 并保持 0.5 秒才切换。
// switched 的 kind：initial 首次锁定；challenger 被更大的脸替换；
// reacquired 丢失后在原位置附近找回（视为同一人）；replaced 丢失后换成别处的脸。
export function createFaceTracker(cfg) {
  let primary = null;
  let lastSeenAt = -Infinity;
  let challengerSince = null;

  function reset() {
    primary = null;
    lastSeenAt = -Infinity;
    challengerSince = null;
  }

  function update(boxes, now) {
    if (!boxes.length) {
      challengerSince = null;
      return { index: -1, switched: false, kind: null };
    }

    const largest = indexOfLargest(boxes);
    const current = primary ? indexOfNearest(boxes, primary, cfg.matchDistance) : -1;
    let index;
    let kind = null;

    if (current === -1) {
      if (primary && now - lastSeenAt < cfg.reacquireMs) {
        return { index: -1, switched: false, kind: null };
      }
      index = largest;
      if (!primary) {
        kind = 'initial';
      } else {
        const distance = Math.hypot(boxes[index].cx - primary.cx, boxes[index].cy - primary.cy);
        kind = distance <= cfg.matchDistance ? 'reacquired' : 'replaced';
      }
      challengerSince = null;
    } else if (largest !== current && boxes[largest].area > boxes[current].area * cfg.switchRatio) {
      challengerSince ??= now;
      if (now - challengerSince >= cfg.switchHoldMs) {
        index = largest;
        kind = 'challenger';
        challengerSince = null;
      } else {
        index = current;
      }
    } else {
      index = current;
      challengerSince = null;
    }

    primary = { cx: boxes[index].cx, cy: boxes[index].cy };
    lastSeenAt = now;
    return { index, switched: kind !== null, kind };
  }

  return { update, reset };
}

// 换了一个人才需要重新校准；同一人丢失后找回，沿用原来的基线。
export const needsRecalibration = (kind) => kind === 'challenger' || kind === 'replaced';
